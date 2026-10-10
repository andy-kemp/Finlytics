#nullable enable
using System;
using System.Collections.Generic;
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
    public sealed class MonthlyReconciliationFunctions
    {
        private readonly FinanceHubDbContext _db;
        private readonly SettlementAuthService _auth;
        private readonly BlobStorageService? _blobs;
        private readonly ILogger<MonthlyReconciliationFunctions> _logger;

        public MonthlyReconciliationFunctions(FinanceHubDbContext db, SettlementAuthService auth,
            ILogger<MonthlyReconciliationFunctions> logger, BlobStorageService? blobs = null)
        {
            _db = db;
            _auth = auth;
            _logger = logger;
            _blobs = blobs;
        }

        private sealed class Refusal : Exception
        {
            public Refusal(string message) : base(message) { }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Refusal(message);
        }

        [Function("ApplyMonthlyReconciliation")]
        public async Task<HttpResponseData> Apply(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "reconciliation/monthly/apply")] HttpRequestData req)
        {
            var authorization = await _auth.ValidateRequest(req);
            if (!authorization.IsAuthorized)
                return await ReceiptInboxFunctions.Json(req, authorization.StatusCode, new { error = authorization.Error });

            MonthlyReconciliationRequest? request;
            try
            {
                var body = await req.ReadAsStringAsync();
                if (string.IsNullOrWhiteSpace(body) || body.Length > 200_000)
                    return await ReceiptInboxFunctions.Json(req, HttpStatusCode.BadRequest, new { error = "A bounded reconciliation request is required" });
                request = JsonSerializer.Deserialize<MonthlyReconciliationRequest>(body, CashBaselinePolicy.Json);
            }
            catch (JsonException)
            {
                return await ReceiptInboxFunctions.Json(req, HttpStatusCode.BadRequest, new { error = "Invalid reconciliation request" });
            }
            var validation = request == null ? "Reconciliation request is required" : MonthlyReconciliationPolicy.Validate(request);
            if (validation != null) return await ReceiptInboxFunctions.Json(req, HttpStatusCode.BadRequest, new { error = validation });
            if (request!.Actions!.Any(action => action.ReceiptBlob != null) && _blobs == null)
                return await ReceiptInboxFunctions.Json(req, HttpStatusCode.ServiceUnavailable, new { error = "Receipt storage is not configured" });

            var copied = new List<string>();
            try
            {
                var result = await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    _db.ChangeTracker.Clear();
                    copied.Clear();
                    await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                    var outcome = await ApplyActions(request, copied);
                    await transaction.CommitAsync();
                    return outcome;
                });
                foreach (var (blob, expenseId) in result.Receipts)
                {
                    try
                    {
                        var metadata = await _blobs!.GetInboxMetadataAsync(blob);
                        if (metadata != null) await _blobs.SetInboxMetadataAsync(blob, ReceiptInboxPolicy.WithStatus(metadata, "matched", expenseId));
                    }
                    catch (Exception exception)
                    {
                        _logger.LogWarning(exception, "Inbox receipt {Blob} was attached but not marked matched", blob);
                    }
                }
                return await ReceiptInboxFunctions.Json(req, HttpStatusCode.OK, new { linked = result.Linked, expenses = result.Expenses });
            }
            catch (Exception exception)
            {
                foreach (var blob in copied)
                {
                    try { await _blobs!.DeleteReceiptAsync(blob); }
                    catch (Exception cleanup) { _logger.LogWarning(cleanup, "Could not remove copied receipt {Blob}", blob); }
                }
                if (exception is Refusal)
                    return await ReceiptInboxFunctions.Json(req, HttpStatusCode.Conflict, new { error = exception.Message });
                _logger.LogError(exception, "Monthly reconciliation failed");
                return await ReceiptInboxFunctions.Json(req, HttpStatusCode.ServiceUnavailable,
                    new { error = "Reconciliation could not be confirmed; nothing was changed. Reload and retry." });
            }
        }

        private sealed record Outcome(int Linked, List<object> Expenses, List<(string Blob, int ExpenseId)> Receipts);

        private async Task<Outcome> ApplyActions(MonthlyReconciliationRequest request, List<string> copied)
        {
            var accountId = request.BankAccountId!.Value;
            var accounts = await _db.BankAccounts.AsNoTracking().ToListAsync();
            Require(accounts.Any(account => account.Id == accountId), "Bank account not found");
            var accountError = CashBaselinePolicy.ValidateAccount(accountId, accounts);
            Require(accountError == null, accountError ?? "");

            var baselines = await _db.CompanyLedger.AsNoTracking().Where(entry => entry.EntryType == CashBaselinePolicy.EntryType
                || (entry.Notes != null && entry.Notes.Contains("[CASH-BASELINE:"))).ToListAsync();
            Require(baselines.Count <= 1, "Ambiguous cash baseline records; review required");
            DateTime? cutoff = null;
            if (baselines.Count == 1 && CashBaselinePolicy.TryDate(CashBaselinePolicy.Read(baselines[0], accountId).AsOfDate, out var asOf)) cutoff = asOf;

            var externalIds = request.Actions!.Select(action => action.ExternalId!).ToList();
            var accountBanks = await _db.BankTransactions.Where(bank => bank.BankAccountId == accountId).ToListAsync();
            var banks = accountBanks.Where(bank => (bank.ExternalId != null && externalIds.Contains(bank.ExternalId))
                || (bank.MonzoTransactionId != null && externalIds.Contains(bank.MonzoTransactionId))).ToList();
            Require(!banks.Any(bank => accountBanks.Any(other => MonzoSyncPolicy.PossibleCrossFeedDuplicate(bank, other))),
                "Selected payments have possible CSV/Monzo duplicates; resolve the bank rows before creating or linking accounting records");
            var bankIds = banks.Select(bank => bank.Id).ToList();
            var matches = await _db.ReconciliationMatches.AsNoTracking().ToListAsync();
            var settled = await _db.Expenses.AsNoTracking().Where(expense => expense.SettlementBankTransactionId != null
                && bankIds.Contains(expense.SettlementBankTransactionId.Value)).AnyAsync();
            var settledDla = await _db.DlaEntries.AsNoTracking().Where(entry => entry.SettlementBankTransactionId != null
                && bankIds.Contains(entry.SettlementBankTransactionId.Value)).AnyAsync();
            Require(!settled && !settledDla, "A selected bank transaction is already settled against a record");
            var reservedNotes = await _db.CompanyLedger.AsNoTracking().Where(entry => entry.Notes != null && entry.Notes.Contains("[BANK-TX:"))
                .Select(entry => entry.Notes!).ToListAsync();
            var settings = await _db.CompanySettings.AsNoTracking().FirstOrDefaultAsync();
            var suppliers = await _db.Suppliers.AsNoTracking().ToListAsync();
            var codes = (await _db.Expenses.AsNoTracking().Select(expense => expense.ExpenseId).ToListAsync()).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var now = DateTime.UtcNow;

            var linked = 0;
            var created = new List<(MonthlyReconciliationAction Action, BankTransaction Bank, Expense Expense)>();
            foreach (var action in request.Actions!)
            {
                var candidates = banks.Where(bank => bank.ExternalId == action.ExternalId || bank.MonzoTransactionId == action.ExternalId).ToList();
                Require(candidates.Count == 1, $"Statement transaction {action.ExternalId} must be imported exactly once before reconciling");
                var bank = candidates[0];
                Require(!bank.IsReconciled && !matches.Any(match => match.BankTransactionId == bank.Id), $"{bank.Description} is already reconciled");
                Require(!CashBaselinePolicy.IsInternal(bank), $"{bank.Description} is an internal pot transfer");
                Require(!reservedNotes.Any(notes => notes.Contains(VatSettlementPolicy.BankMarker(bank.Id), StringComparison.Ordinal)),
                    $"{bank.Description} is reserved by a VAT settlement");
                Require(bank.TransactionDate.HasValue && bank.Amount is > 0, $"{bank.Description} has no date or amount");

                if (action.Action == "link")
                {
                    var id = int.Parse(action.RelatedId!, CultureInfo.InvariantCulture);
                    object? record = action.RelatedType switch
                    {
                        "Invoice" => await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id && item.Status == "Paid"),
                        "Expense" => await _db.Expenses.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id && !item.IsDLA),
                        "DLA-Payment" => await _db.DlaPayments.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id),
                        "CompanyLedger" => await _db.CompanyLedger.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id
                            && MonthlyReconciliationPolicy.CashLedgerTypes.Contains(item.EntryType)),
                        _ => null
                    };
                    Require(record != null, $"{action.RelatedType} {id} is not a recorded cash movement");
                    Require(MonthlyReconciliationPolicy.RelatedAmount(action.RelatedType!, record!) == bank.Amount,
                        $"{action.RelatedType} {id} amount differs from {bank.Description}");
                    var incoming = action.RelatedType == "Invoice" || (record is CompanyLedgerEntry entry && entry.EntryType is "VAT_Reclaim" or "DLA_In");
                    if (record is DlaPayment payment)
                        incoming = await _db.DlaEntries.AsNoTracking().AnyAsync(loan => loan.DlaId == payment.DlaId && loan.Direction == "OwedToCompany");
                    Require(incoming == (bank.Direction == "In"), $"{action.RelatedType} {id} direction differs from {bank.Description}");
                    Require(!matches.Any(match => match.RelatedType == action.RelatedType && match.RelatedId == action.RelatedId),
                        $"{action.RelatedType} {id} is already linked to another bank transaction");
                    _db.ReconciliationMatches.Add(new ReconciliationMatch
                    {
                        BankTransactionId = bank.Id, RelatedType = action.RelatedType, RelatedId = action.RelatedId,
                        MatchType = "Manual", Notes = MonthlyReconciliationPolicy.Actor, CreatedDate = now
                    });
                    linked++;
                }
                else
                {
                    Require(bank.Direction == "Out", $"{bank.Description} is money in; only payments out can become expenses");
                    Require(cutoff == null || bank.TransactionDate!.Value.Date > cutoff.Value,
                        $"{bank.Description} is on or before the cash baseline date {cutoff:yyyy-MM-dd}; it needs an audited baseline amendment instead");
                    Require(MonthlyReconciliationPolicy.ValidateVat(bank, action.VatAmount) is null,
                        MonthlyReconciliationPolicy.ValidateVat(bank, action.VatAmount) ?? "");
                    var supplier = suppliers.Where(item => string.Equals(item.Name, action.Supplier!.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
                    Require(supplier.Count <= 1, $"Supplier {action.Supplier} is ambiguous");
                    var expense = MonthlyReconciliationPolicy.BuildExpense(bank, action, supplier.SingleOrDefault(), settings);
                    Require(codes.Add(expense.ExpenseId!), $"Expense {expense.ExpenseId} already exists");
                    if (action.ReceiptBlob != null)
                    {
                        var metadata = await _blobs!.GetInboxMetadataAsync(action.ReceiptBlob);
                        Require(metadata != null && ReceiptInboxPolicy.IsOpen(ReceiptInboxPolicy.Read(action.ReceiptBlob, 0, null, metadata)),
                            "A selected inbox receipt is no longer available");
                    }
                    _db.Expenses.Add(expense);
                    created.Add((action, bank, expense));
                }
                bank.IsReconciled = true;
                bank.ReconciledOn = now;
                bank.ReconciledBy = MonthlyReconciliationPolicy.Actor;
            }
            await _db.SaveChangesAsync();

            var receipts = new List<(string Blob, int ExpenseId)>();
            foreach (var (action, bank, expense) in created)
            {
                if (action.ReceiptBlob != null)
                {
                    var item = ReceiptInboxPolicy.Read(action.ReceiptBlob, 0, null, (await _blobs!.GetInboxMetadataAsync(action.ReceiptBlob))!);
                    var copy = await _blobs.CopyInboxToExpenseReceiptAsync(action.ReceiptBlob, expense.Id, expense.ExpenseId!, ReceiptInboxPolicy.SafeName(item.FileName));
                    copied.Add(copy.BlobName);
                    expense.ReceiptUrl = copy.Url;
                    expense.Notes += $" Receipt matched from inbox ({item.FileName}).";
                    receipts.Add((action.ReceiptBlob, expense.Id));
                }
                _db.ReconciliationMatches.Add(new ReconciliationMatch
                {
                    BankTransactionId = bank.Id, RelatedType = "Expense", RelatedId = expense.Id.ToString(CultureInfo.InvariantCulture),
                    MatchType = "Manual", Notes = MonthlyReconciliationPolicy.Actor, CreatedDate = now
                });
            }
            await _db.SaveChangesAsync();
            return new(linked, created.Select(item => (object)new { externalId = item.Action.ExternalId, id = item.Expense.Id, expenseId = item.Expense.ExpenseId }).ToList(), receipts);
        }
    }
}
