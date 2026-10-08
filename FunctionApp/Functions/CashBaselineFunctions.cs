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
    public sealed class CashBaselineFunctions
    {
        private readonly FinanceHubDbContext _db;
        private readonly SettlementAuthService _auth;
        private readonly ILogger<CashBaselineFunctions> _logger;

        public CashBaselineFunctions(FinanceHubDbContext db, SettlementAuthService auth, ILogger<CashBaselineFunctions> logger)
        {
            _db = db;
            _auth = auth;
            _logger = logger;
        }

        private static async Task<HttpResponseData> Error(HttpRequestData req, HttpStatusCode status, string message)
        {
            var response = req.CreateResponse(status);
            await response.WriteAsJsonAsync(new { error = message }, status);
            return response;
        }

        private static async Task<HttpResponseData> Result(HttpRequestData req, CashBaselineRecord? baseline)
        {
            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            await response.WriteStringAsync(JsonSerializer.Serialize(baseline, CashBaselinePolicy.Json));
            return response;
        }

        private static bool HasDuplicateProperties(JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                var properties = element.EnumerateObject().ToList();
                return properties.Select(item => item.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != properties.Count
                    || properties.Any(item => HasDuplicateProperties(item.Value));
            }
            return element.ValueKind == JsonValueKind.Array && element.EnumerateArray().Any(HasDuplicateProperties);
        }

        private Task<System.Collections.Generic.List<CompanyLedgerEntry>> Baselines() => _db.CompanyLedger
            .Where(entry => entry.EntryType == CashBaselinePolicy.EntryType
                || (entry.Notes != null && entry.Notes.Contains("[CASH-BASELINE:"))).ToListAsync();

        [Function("GetBankCashBaseline")]
        public async Task<HttpResponseData> GetBankCashBaseline(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "bank/accounts/{id:int}/cash-baseline")] HttpRequestData req, int id)
        {
            var authorization = await _auth.ValidateRequest(req);
            if (!authorization.IsAuthorized) return await Error(req, authorization.StatusCode, authorization.Error!);
            try
            {
                var accounts = await _db.BankAccounts.AsNoTracking().ToListAsync();
                if (!accounts.Any(item => item.Id == id)) return await Error(req, HttpStatusCode.NotFound, "Bank account not found");
                var accountError = CashBaselinePolicy.ValidateAccount(id, accounts);
                if (accountError != null) return await Error(req, HttpStatusCode.Conflict, accountError);
                var entries = await Baselines();
                if (entries.Count == 0) return await Result(req, null);
                if (entries.Count != 1) return await Error(req, HttpStatusCode.Conflict, "Ambiguous cash baseline records; review required");
                return await Result(req, CashBaselinePolicy.Read(entries[0], id));
            }
            catch (Exception exception) when (exception is InvalidOperationException || exception is JsonException)
            {
                return await Error(req, HttpStatusCode.Conflict, "Cash baseline audit record is invalid; review required");
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Error reading cash baseline for account {Id}", id);
                return await Error(req, HttpStatusCode.ServiceUnavailable, "Cash baseline is unavailable");
            }
        }

        [Function("CreateBankCashBaseline")]
        public async Task<HttpResponseData> CreateBankCashBaseline(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "bank/accounts/{id:int}/cash-baseline")] HttpRequestData req, int id)
        {
            var authorization = await _auth.ValidateRequest(req);
            if (!authorization.IsAuthorized) return await Error(req, authorization.StatusCode, authorization.Error!);

            CashBaselineRequest? request;
            try
            {
                var body = await req.ReadAsStringAsync();
                if (string.IsNullOrWhiteSpace(body) || body.Length > 16000)
                    return await Error(req, HttpStatusCode.BadRequest, "A bounded cash baseline JSON object is required");
                using var document = JsonDocument.Parse(body);
                if (document.RootElement.ValueKind != JsonValueKind.Object || HasDuplicateProperties(document.RootElement))
                    return await Error(req, HttpStatusCode.BadRequest, "A JSON object with unique field names is required");
                request = JsonSerializer.Deserialize<CashBaselineRequest>(body, CashBaselinePolicy.Json);
                if (request == null) return await Error(req, HttpStatusCode.BadRequest, "Cash baseline request is required");
            }
            catch (JsonException)
            {
                return await Error(req, HttpStatusCode.BadRequest, "Only bookBalance, statementBalance, asOfDate, reason and pendingExpenses with externalId, amount, paymentDate, description are accepted");
            }
            var validation = CashBaselinePolicy.Validate(request, DateTime.UtcNow);
            if (validation != null) return await Error(req, HttpStatusCode.BadRequest, validation);

            try
            {
                return await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    _db.ChangeTracker.Clear();
                    await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                    var accounts = await _db.BankAccounts.AsNoTracking().ToListAsync();
                    if (!accounts.Any(item => item.Id == id)) return await Error(req, HttpStatusCode.NotFound, "Bank account not found");
                    var accountError = CashBaselinePolicy.ValidateAccount(id, accounts);
                    if (accountError != null) return await Error(req, HttpStatusCode.Conflict, accountError);
                    var entries = await Baselines();
                    if (entries.Count > 1) return await Error(req, HttpStatusCode.Conflict, "Ambiguous cash baseline records; review required");
                    if (entries.Count == 1)
                    {
                        var existing = CashBaselinePolicy.Read(entries[0], id);
                        return CashBaselinePolicy.Identical(existing, request)
                            ? await Result(req, existing)
                            : await Error(req, HttpStatusCode.Conflict, "Cash baseline is immutable; submitted details differ from the audit record");
                    }

                    var sources = new RecordedCashSources
                    {
                        BankAccounts = accounts,
                        Invoices = await _db.Invoices.AsNoTracking().ToListAsync(),
                        Expenses = await _db.Expenses.AsNoTracking().ToListAsync(),
                        DlaEntries = await _db.DlaEntries.AsNoTracking().ToListAsync(),
                        DlaPayments = await _db.DlaPayments.AsNoTracking().ToListAsync(),
                        LedgerEntries = await _db.CompanyLedger.AsNoTracking().ToListAsync(),
                        PayrollSettings = await _db.PayrollSettings.AsNoTracking().ToListAsync(),
                        PayrollRuns = await _db.PayrollRuns.AsNoTracking().ToListAsync(),
                        BankTransactions = await _db.BankTransactions.AsNoTracking().ToListAsync()
                    };
                    var now = DateTime.UtcNow;
                    validation = CashBaselinePolicy.ValidateSources(id, request, sources, now);
                    if (validation != null) return await Error(req, HttpStatusCode.Conflict, validation);
                    var pendingIds = sources.BankTransactions.Where(bank => request.PendingExpenses!.Any(pending =>
                        pending.ExternalId == bank.ExternalId || pending.ExternalId == bank.MonzoTransactionId
                        || pending.ExternalId == bank.TrueLayerTransactionId)).Select(bank => bank.Id).ToList();
                    if (await _db.ReconciliationMatches.AnyAsync(match => pendingIds.Contains(match.BankTransactionId)))
                        return await Error(req, HttpStatusCode.Conflict, "An imported pending expense is already matched");
                    foreach (var bankId in pendingIds)
                    {
                        var marker = VatSettlementPolicy.BankMarker(bankId);
                        if (sources.LedgerEntries.Any(entry => entry.Notes?.Contains(marker, StringComparison.Ordinal) == true))
                            return await Error(req, HttpStatusCode.Conflict, "An imported pending expense is already linked to the ledger");
                    }
                    var baseline = CashBaselinePolicy.Create(id, request, sources, now);
                    var notes = CashBaselinePolicy.Notes(baseline);
                    if (notes.Length > 2000)
                        return await Error(req, HttpStatusCode.BadRequest, "Cash baseline audit metadata exceeds the existing 2000-character notes limit");
                    CashBaselinePolicy.TryDate(baseline.AsOfDate, out var date);
                    var entry = new CompanyLedgerEntry
                    {
                        Title = "Audited main-account cash baseline",
                        EntryType = CashBaselinePolicy.EntryType,
                        Amount = baseline.BookBalance,
                        EffectiveDate = date,
                        PeriodKey = date.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                        TaxYear = date.Month > 4 || (date.Month == 4 && date.Day >= 6) ? date.Year : date.Year - 1,
                        Notes = notes
                    };
                    _db.CompanyLedger.Add(entry);
                    await _db.SaveChangesAsync();
                    await transaction.CommitAsync();
                    return await Result(req, baseline with { LedgerEntryId = entry.Id });
                });
            }
            catch (Exception exception) when (exception is InvalidOperationException || exception is JsonException)
            {
                _logger.LogWarning(exception, "Conflicting cash baseline for account {Id}", id);
                return await Error(req, HttpStatusCode.Conflict, "Cash baseline audit record is invalid; review required");
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Error creating cash baseline for account {Id}", id);
                return await Error(req, HttpStatusCode.ServiceUnavailable, "Cash baseline could not be confirmed; retry the identical request");
            }
        }
    }
}