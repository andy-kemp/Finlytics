#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed record PendingCashExpense(string ExternalId, decimal Amount, string PaymentDate, string Description);
    public sealed record CashBaselineRequest(decimal? BookBalance, decimal? StatementBalance, string? AsOfDate,
        string? Reason, List<PendingCashExpense>? PendingExpenses);
    public sealed record CashTransferSnapshot(int Id, string? ExternalId, decimal SignedAmount);
    public sealed record CashBaselineRecord(int BankAccountId, decimal BookBalance, decimal StatementBalance,
        string AsOfDate, decimal RecordedCashAtCreation, DateTime SnapshotAtUtc,
        List<PendingCashExpense> PendingExpenses, string SourceSnapshotHash, string Reason, int LedgerEntryId,
        List<CashTransferSnapshot> InternalTransferSnapshot, Dictionary<string, int> RecordCounts,
        decimal HistoricalExpenseAdjustment = 0, List<CashBaselineAmendmentRecord>? Amendments = null);

    public sealed class RecordedCashSources
    {
        public List<Invoice> Invoices { get; init; } = new();
        public List<Expense> Expenses { get; init; } = new();
        public List<DlaEntry> DlaEntries { get; init; } = new();
        public List<DlaPayment> DlaPayments { get; init; } = new();
        public List<CompanyLedgerEntry> LedgerEntries { get; init; } = new();
        public List<PayrollSettings> PayrollSettings { get; init; } = new();
        public List<PayrollRun> PayrollRuns { get; init; } = new();
        public List<BankTransaction> BankTransactions { get; init; } = new();
        public List<BankAccount> BankAccounts { get; init; } = new();

        public bool IncludePayroll => PayrollRuns.Count > 0
            || !string.IsNullOrEmpty(PayrollSettings.OrderBy(item => item.Id).FirstOrDefault()?.EmployerPAYEReference);

        public IEnumerable<(DateTime Date, decimal Amount)> CashMovements()
        {
            foreach (var invoice in Invoices.Where(item => item.Status == "Paid"))
                yield return (invoice.DatePaid ?? invoice.DateIssued, CashBaselinePolicy.Pennies(invoice.AmountGross));
            foreach (var expense in Expenses.Where(item => !item.IsDLA && (item.SettlementDate ?? item.DatePaid).HasValue))
                yield return ((expense.SettlementDate ?? expense.DatePaid)!.Value,
                    -CashBaselinePolicy.Pennies(expense.ActualGbpPaid ?? expense.AmountGross ?? 0));
            var loans = DlaEntries.GroupBy(item => item.DlaId).ToDictionary(group => group.Key, group => group.Last());
            foreach (var payment in DlaPayments)
                yield return (payment.PaymentDate, CashBaselinePolicy.Pennies(payment.Amount)
                    * (payment.DlaId != null && loans.TryGetValue(payment.DlaId, out var loan)
                        && loan.Direction == "OwedToCompany" ? 1 : -1));
            foreach (var loan in DlaEntries.Where(item => item.Direction == "OwedToCompany"))
                yield return (loan.DatePaid ?? loan.EntryDate, -CashBaselinePolicy.Pennies(loan.AmountGross));
            var outgoing = new HashSet<string> { "Dividend_Paid", "CorpTax_Paid", "VAT_Paid", "DLA_Payment", "DLA_Out" };
            if (IncludePayroll) outgoing.UnionWith(new[] { "Salary", "EmployeeNI", "EmployerNI", "PAYE" });
            foreach (var entry in LedgerEntries.Where(item => !CashBaselinePolicy.IsRepresentedDla(item, DlaEntries)))
            {
                if (entry.EntryType == "VAT_Reclaim" || entry.EntryType == "DLA_In")
                    yield return (entry.EffectiveDate, CashBaselinePolicy.Pennies(entry.Amount));
                else if (outgoing.Contains(entry.EntryType))
                    yield return (entry.EffectiveDate, -CashBaselinePolicy.Pennies(entry.Amount));
            }
        }

        public decimal Calculate(DateTime now) => CashMovements().Where(item => item.Date <= now).Sum(item => item.Amount);

        public byte[] SerializedSnapshot() => JsonSerializer.SerializeToUtf8Bytes(new
        {
            invoices = Invoices.OrderBy(item => item.Id), expenses = Expenses.OrderBy(item => item.Id),
            dlaEntries = DlaEntries.OrderBy(item => item.Id), dlaPayments = DlaPayments.OrderBy(item => item.Id),
            ledgerEntries = LedgerEntries.Where(item => item.EntryType != CashBaselinePolicy.EntryType).OrderBy(item => item.Id),
            payrollSettings = PayrollSettings.OrderBy(item => item.Id), payrollRuns = PayrollRuns.OrderBy(item => item.Id),
            bankTransactions = BankTransactions.OrderBy(item => item.Id), bankAccounts = BankAccounts.OrderBy(item => item.Id),
            includePayroll = IncludePayroll
        }, CashBaselinePolicy.Json);

        public string Hash() => Convert.ToHexString(SHA256.HashData(SerializedSnapshot())).ToLowerInvariant();
        public Dictionary<string, int> Counts() => new()
        {
            ["invoices"] = Invoices.Count, ["expenses"] = Expenses.Count, ["dlaEntries"] = DlaEntries.Count,
            ["dlaPayments"] = DlaPayments.Count,
            ["ledgerEntries"] = LedgerEntries.Count(item => item.EntryType != CashBaselinePolicy.EntryType),
            ["payrollSettings"] = PayrollSettings.Count, ["payrollRuns"] = PayrollRuns.Count,
            ["bankTransactions"] = BankTransactions.Count, ["bankAccounts"] = BankAccounts.Count
        };
    }

    public static class CashBaselinePolicy
    {
        public const string EntryType = "Cash_Baseline";
        public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
        {
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
        };
        public static decimal Pennies(decimal amount) => Math.Floor(amount * 100m + 0.5m) / 100m;
        public static string Marker(int accountId) => $"[CASH-BASELINE:{accountId}]";
        public static bool IsReserved(CompanyLedgerEntry entry) => string.Equals(entry.EntryType, EntryType, StringComparison.OrdinalIgnoreCase)
            || (entry.Notes?.Contains("[CASH-BASELINE:", StringComparison.OrdinalIgnoreCase) ?? false);
        public static bool IsRepresentedDla(CompanyLedgerEntry entry, IEnumerable<DlaEntry> loans)
        {
            if (!entry.EntryType.StartsWith("DLA_", StringComparison.Ordinal)) return false;
            if ((entry.Title ?? "").Trim().StartsWith("DLA Startup:", StringComparison.OrdinalIgnoreCase)) return true;
            var ids = loans.Select(item => item.DlaId.Trim().ToUpperInvariant()).Where(item => item.Length > 0).ToHashSet();
            if (ids.Contains((entry.DlaReference ?? "").Trim().ToUpperInvariant())) return true;
            var match = Regex.Match(entry.Notes ?? "", @"(?:DLA ID:\s*|Payment for DLA\s+)(DLA-[A-Z0-9-]+)", RegexOptions.IgnoreCase);
            return match.Success && ids.Contains(match.Groups[1].Value.ToUpperInvariant());
        }
        public static bool IsInternal(BankTransaction item) => item.Category == "Internal Transfer"
            || Regex.IsMatch(item.Description ?? "", @"\bpot transfer\b", RegexOptions.IgnoreCase);
        public static decimal SignedAmount(BankTransaction item) => Math.Abs(item.Amount ?? 0) * (item.Direction == "In" ? 1 : -1);
        public static bool TryDate(string? value, out DateTime date) => DateTime.TryParseExact(value, "yyyy-MM-dd",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

        public static string? Validate(CashBaselineRequest request, DateTime now)
        {
            if (!request.BookBalance.HasValue || !request.StatementBalance.HasValue
                || Math.Abs(request.BookBalance.Value) > 9999999999999999.99m || Math.Abs(request.StatementBalance.Value) > 9999999999999999.99m
                || request.BookBalance != Pennies(request.BookBalance.Value) || request.StatementBalance != Pennies(request.StatementBalance.Value))
                return "bookBalance and statementBalance must be explicit GBP amounts with at most two decimal places";
            if (!TryDate(request.AsOfDate, out var cutoff) || cutoff.Date > now.Date)
                return "asOfDate must be an explicit non-future ISO date (yyyy-MM-dd)";
            if (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Length > 250)
                return "reason must document owner consent and statement provenance (1-250 characters)";
            if (request.PendingExpenses == null || request.PendingExpenses.Count > 20)
                return "pendingExpenses must be an explicit array with at most 20 items";
            if (request.PendingExpenses.Any(item => item == null || string.IsNullOrWhiteSpace(item.ExternalId)
                || item.ExternalId.Length > 120 || item.Amount <= 0 || item.Amount > 9999999999999999.99m || item.Amount != Pennies(item.Amount)
                || !TryDate(item.PaymentDate, out var date) || date > cutoff || string.IsNullOrWhiteSpace(item.Description) || item.Description.Length > 100)
                || request.PendingExpenses.Select(item => item.ExternalId).Distinct(StringComparer.Ordinal).Count() != request.PendingExpenses.Count)
                return "Pending expenses need unique externalId, positive GBP pennies, paymentDate on/before asOfDate and description";
            if (request.StatementBalance.Value + request.PendingExpenses.Sum(item => item.Amount) != request.BookBalance.Value)
                return "bookBalance must equal statementBalance plus pendingExpenses";
            return null;
        }

        public static string? ValidateAccount(int accountId, IEnumerable<BankAccount> accounts)
        {
            var active = accounts.Where(item => item.IsActive && item.Currency == "GBP").ToList();
            return active.Count == 1 && active[0].Id == accountId ? null
                : "Cash baseline requires the sole active GBP business bank account; multi-account routing is unsupported";
        }

        public static string? ValidateSources(int accountId, CashBaselineRequest request, RecordedCashSources sources, DateTime now)
        {
            TryDate(request.AsOfDate, out var cutoff);
            if (sources.CashMovements().Any(item => item.Date.Date > cutoff && item.Date <= now)
                || sources.BankTransactions.Any(item => item.BankAccountId == accountId && item.TransactionDate?.Date > cutoff))
                return "Recorded cash or bank transactions exist after asOfDate; historical baseline requires review";
            foreach (var pending in request.PendingExpenses!)
            {
                var matches = sources.BankTransactions.Where(item => item.ExternalId == pending.ExternalId
                    || item.MonzoTransactionId == pending.ExternalId || item.TrueLayerTransactionId == pending.ExternalId).ToList();
                if (matches.Count == 0) continue;
                var bank = matches.Count == 1 ? matches[0] : null;
                if (matches.Count != 1 || bank == null || bank.BankAccountId != accountId || bank.Direction != "Out"
                    || Math.Abs(bank.Amount ?? 0) != pending.Amount || bank.TransactionDate?.ToString("yyyy-MM-dd") != pending.PaymentDate
                    || IsInternal(bank) || bank.IsReconciled
                    || sources.Expenses.Any(item => item.SettlementBankTransactionId == bank.Id)
                    || sources.DlaEntries.Any(item => item.SettlementBankTransactionId == bank.Id))
                    return "An imported pending expense is ambiguous, mismatched or already recorded";
            }
            if (sources.BankTransactions.Any(item => item.BankAccountId == accountId && IsInternal(item)
                && (!item.TransactionDate.HasValue || !item.Amount.HasValue || (item.Direction != "In" && item.Direction != "Out"))))
                return "Internal transfer snapshot requires valid dates, amounts and directions";
            return null;
        }

        public static CashBaselineRecord Create(int accountId, CashBaselineRequest request, RecordedCashSources sources, DateTime now) =>
            new(accountId, request.BookBalance!.Value, request.StatementBalance!.Value, request.AsOfDate!, sources.Calculate(now), now,
                request.PendingExpenses!.ToList(), sources.Hash(), request.Reason!, 0,
                sources.BankTransactions.Where(item => item.BankAccountId == accountId && IsInternal(item)).OrderBy(item => item.Id)
                    .Select(item => new CashTransferSnapshot(item.Id, item.ExternalId, SignedAmount(item))).ToList(), sources.Counts());

        public static string Notes(CashBaselineRecord record) => Marker(record.BankAccountId) + "\n" + JsonSerializer.Serialize(record, Json);
        public static CashBaselineRecord Read(CompanyLedgerEntry entry, int accountId)
        {
            var prefix = Marker(accountId) + "\n";
            if (entry.EntryType != EntryType || entry.Notes == null || !entry.Notes.StartsWith(prefix, StringComparison.Ordinal))
                throw new InvalidOperationException("Cash baseline audit record is invalid; review required");
            var record = JsonSerializer.Deserialize<CashBaselineRecord>(entry.Notes.Substring(prefix.Length), Json)
                ?? throw new InvalidOperationException("Cash baseline metadata is missing");
            if (record.BankAccountId != accountId || record.BookBalance != entry.Amount
                || record.HistoricalExpenseAdjustment != 0 || record.Amendments != null
                || !TryDate(record.AsOfDate, out var date) || date != entry.EffectiveDate.Date
                || Validate(new(record.BookBalance, record.StatementBalance, record.AsOfDate, record.Reason, record.PendingExpenses), record.SnapshotAtUtc) != null
                || record.SourceSnapshotHash?.Length != 64 || record.InternalTransferSnapshot == null || record.RecordCounts == null)
                throw new InvalidOperationException("Cash baseline metadata conflicts with its ledger record");
            return record with { LedgerEntryId = entry.Id };
        }
        public static bool Identical(CashBaselineRecord record, CashBaselineRequest request) =>
            record.BookBalance == request.BookBalance && record.StatementBalance == request.StatementBalance
            && record.AsOfDate == request.AsOfDate && record.Reason == request.Reason
            && JsonSerializer.Serialize(record.PendingExpenses, Json) == JsonSerializer.Serialize(request.PendingExpenses, Json);
    }
}