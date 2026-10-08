#nullable enable
using System;
using System.Data;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    public sealed class VatSettlementFunctions
    {
        private readonly FinanceHubDbContext _db;
        private readonly SettlementAuthService _auth;
        private readonly ILogger<VatSettlementFunctions> _logger;

        public VatSettlementFunctions(FinanceHubDbContext db, SettlementAuthService auth, ILogger<VatSettlementFunctions> logger)
        {
            _db = db;
            _auth = auth;
            _logger = logger;
        }

        [Function("SettleVatReturn")]
        public async Task<HttpResponseData> SettleVatReturn(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "vat-returns/{id:int}/settlement")] HttpRequestData req, int id)
        {
            async Task<HttpResponseData> Error(HttpStatusCode status, string message)
            {
                var response = req.CreateResponse(status);
                await response.WriteAsJsonAsync(new { error = message }, status);
                return response;
            }

            var authorization = await _auth.ValidateRequest(req);
            if (!authorization.IsAuthorized) return await Error(authorization.StatusCode, authorization.Error!);

            var body = await req.ReadAsStringAsync();
            if (!ForeignCurrencyHelper.TryRead<VatSettlementRequest>(body, out var request, out var parseError))
                return await Error(HttpStatusCode.BadRequest, parseError!);
            using var document = JsonDocument.Parse(body!);
            var allowed = new[] { "amount", "settlementDate", "bankTransactionId", "reference", "differenceReason" };
            var names = document.RootElement.EnumerateObject().Select(property => property.Name).ToList();
            if (names.Any(name => !allowed.Contains(name, StringComparer.OrdinalIgnoreCase))
                || names.Distinct(StringComparer.OrdinalIgnoreCase).Count() != names.Count)
                return await Error(HttpStatusCode.BadRequest, "Only amount, settlementDate, bankTransactionId, reference and differenceReason are accepted");
            var date = document.RootElement.EnumerateObject().FirstOrDefault(property =>
                string.Equals(property.Name, "settlementDate", StringComparison.OrdinalIgnoreCase)).Value;
            if (date.ValueKind != JsonValueKind.String || !DateTime.TryParseExact(date.GetString(), "yyyy-MM-dd",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
                return await Error(HttpStatusCode.BadRequest, "settlementDate must be an ISO date (yyyy-MM-dd)");
            request!.SettlementDate = parsedDate;
            if (VatSettlementPolicy.Notes(id, request).Length > 2000)
                return await Error(HttpStatusCode.BadRequest, "Settlement reference and differenceReason exceed the ledger notes limit");

            try
            {
                return await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    _db.ChangeTracker.Clear();
                    await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                    var record = await _db.VatReturns.SingleOrDefaultAsync(item => item.Id == id);
                    if (record == null) return await Error(HttpStatusCode.NotFound, "VAT return not found");
                    var marker = VatSettlementPolicy.Marker(id);
                    var linked = await _db.CompanyLedger.Where(entry => entry.Notes != null && entry.Notes.Contains(marker)).ToListAsync();
                    var existing = linked.Count == 1 ? linked[0] : null;
                    if (linked.Count > 0 && (existing == null || existing.EntryType != VatSettlementPolicy.EntryType(record)
                        || !VatSettlementPolicy.Identical(existing, request)))
                        return await Error(HttpStatusCode.Conflict, "VAT return already has a different or ambiguous settlement; review required");

                    var validation = VatSettlementPolicy.Validate(record, request, DateTime.UtcNow);
                    if (validation != null) return await Error(HttpStatusCode.BadRequest, validation);

                    BankTransaction? bank = null;
                    if (request.BankTransactionId.HasValue)
                    {
                        var bankId = request.BankTransactionId.Value;
                        bank = await _db.BankTransactions.SingleOrDefaultAsync(item => item.Id == bankId);
                        var account = bank == null ? null : await _db.BankAccounts.SingleOrDefaultAsync(item => item.Id == bank.BankAccountId);
                        validation = VatSettlementPolicy.ValidateBank(record, request, bank, account);
                        if (validation != null) return await Error(HttpStatusCode.BadRequest, validation);
                        var matches = await _db.ReconciliationMatches.Where(match => match.BankTransactionId == bankId).ToListAsync();
                        if (matches.Any(match => existing == null || match.RelatedType != "CompanyLedger"
                                || match.RelatedId != existing.Id.ToString(CultureInfo.InvariantCulture))
                            || (bank!.IsReconciled && existing == null)
                            || await _db.Expenses.AnyAsync(item => item.SettlementBankTransactionId == bankId)
                            || await _db.DlaEntries.AnyAsync(item => item.SettlementBankTransactionId == bankId))
                            return await Error(HttpStatusCode.Conflict, "Bank transaction is reconciled or linked elsewhere; review required");
                        var bankMarker = VatSettlementPolicy.BankMarker(bankId);
                        var existingId = existing?.Id ?? 0;
                        if (await _db.CompanyLedger.AnyAsync(entry => entry.Id != existingId
                            && entry.Notes != null && entry.Notes.Contains(bankMarker)))
                            return await Error(HttpStatusCode.Conflict, "Bank transaction is already linked to another ledger entry");
                    }

                    if (existing != null)
                    {
                        var retry = req.CreateResponse(HttpStatusCode.OK);
                        await retry.WriteAsJsonAsync(VatSettlementPolicy.Project(record, existing), HttpStatusCode.OK);
                        return retry;
                    }

                    var start = request.SettlementDate!.Value.Date;
                    var end = start.AddDays(1);
                    var legacy = await _db.CompanyLedger.Where(entry => (entry.EntryType == "VAT_Paid" || entry.EntryType == "VAT_Reclaim")
                        && entry.Amount == request.Amount && entry.EffectiveDate >= start && entry.EffectiveDate < end).ToListAsync();
                    if (legacy.Count > 0)
                        return await Error(HttpStatusCode.Conflict, "A VAT cash entry with the same amount/date already exists; review required");

                    var entry = new CompanyLedgerEntry
                    {
                        Title = $"VAT settlement: {record.QuarterLabel}",
                        EntryType = VatSettlementPolicy.EntryType(record),
                        Amount = request.Amount!.Value,
                        EffectiveDate = start,
                        PeriodKey = start.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                        TaxYear = start.Month > 4 || (start.Month == 4 && start.Day >= 6) ? start.Year : start.Year - 1,
                        Notes = VatSettlementPolicy.Notes(id, request)
                    };
                    _db.CompanyLedger.Add(entry);
                    await _db.SaveChangesAsync();
                    if (bank != null)
                    {
                        _db.ReconciliationMatches.Add(new ReconciliationMatch
                        {
                            BankTransactionId = bank.Id,
                            RelatedType = "CompanyLedger",
                            RelatedId = entry.Id.ToString(CultureInfo.InvariantCulture),
                            MatchType = "Manual",
                            Notes = marker + " " + VatSettlementPolicy.BankMarker(bank.Id),
                            CreatedDate = DateTime.UtcNow
                        });
                        bank.IsReconciled = true;
                        bank.ReconciledOn = DateTime.UtcNow;
                        bank.ReconciledBy = "VAT settlement";
                        bank.ModifiedDate = DateTime.UtcNow;
                        await _db.SaveChangesAsync();
                    }
                    await transaction.CommitAsync();
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    await response.WriteAsJsonAsync(VatSettlementPolicy.Project(record, entry), HttpStatusCode.OK);
                    return response;
                });
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Error settling VAT return {Id}", id);
                return await Error(HttpStatusCode.ServiceUnavailable, "Settlement could not be confirmed; retry the identical request");
            }
        }
    }
}