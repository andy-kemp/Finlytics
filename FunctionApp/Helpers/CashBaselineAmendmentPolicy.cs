#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed record CashBaselineAmendmentRecord(int BankAccountId, int BaselineLedgerEntryId,
        decimal Amount, string Reason, List<int> ExpenseIds, List<string> ExternalIds,
        DateTime RecordedAtUtc, int LedgerEntryId = 0);

    public static class CashBaselineAmendmentPolicy
    {
        public const string EntryType = "Cash_BaselineAmendment";
        public static string Marker(int accountId) => $"[CASH-BASELINE-AMENDMENT:{accountId}]";
        public static bool IsReserved(CompanyLedgerEntry entry) =>
            string.Equals(entry.EntryType, EntryType, StringComparison.OrdinalIgnoreCase)
            || (entry.Notes?.Contains("[CASH-BASELINE-AMENDMENT:", StringComparison.OrdinalIgnoreCase) ?? false);
        public static string Notes(CashBaselineAmendmentRecord record) =>
            Marker(record.BankAccountId) + "\n" + JsonSerializer.Serialize(record, CashBaselinePolicy.Json);

        public static CashBaselineAmendmentRecord Read(CompanyLedgerEntry entry, CashBaselineRecord baseline,
            IEnumerable<Expense> currentExpenses, DateTime now)
        {
            var prefix = Marker(baseline.BankAccountId) + "\n";
            if (entry.Id <= 0 || entry.EntryType != EntryType || entry.Notes == null
                || entry.Notes.Length > 2000 || !entry.Notes.StartsWith(prefix, StringComparison.Ordinal))
                throw new InvalidOperationException("Cash baseline amendment audit record is invalid");
            using var document = JsonDocument.Parse(entry.Notes.Substring(prefix.Length));
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || document.RootElement.EnumerateObject().Select(item => item.Name)
                    .Distinct(StringComparer.OrdinalIgnoreCase).Count() != document.RootElement.EnumerateObject().Count())
                throw new InvalidOperationException("Cash baseline amendment fields must be unique");
            var record = JsonSerializer.Deserialize<CashBaselineAmendmentRecord>(document.RootElement, CashBaselinePolicy.Json)
                ?? throw new InvalidOperationException("Cash baseline amendment metadata is missing");
            var expenses = currentExpenses.Select(item => item.Id).ToHashSet();
            if (baseline.LedgerEntryId <= 0 || record.BankAccountId != baseline.BankAccountId
                || record.BaselineLedgerEntryId != baseline.LedgerEntryId
                || (record.LedgerEntryId != 0 && record.LedgerEntryId != entry.Id)
                || record.Amount <= 0 || record.Amount > 9999999999999999.99m
                || record.Amount != CashBaselinePolicy.Pennies(record.Amount) || record.Amount != entry.Amount
                || string.IsNullOrWhiteSpace(record.Reason) || record.Reason.Length > 250
                || record.RecordedAtUtc.Kind != DateTimeKind.Utc || record.RecordedAtUtc < baseline.SnapshotAtUtc
                || record.RecordedAtUtc > now || entry.EffectiveDate.Date != record.RecordedAtUtc.Date
                || record.ExpenseIds == null || record.ExpenseIds.Count == 0
                || record.ExpenseIds.Any(expenseId => expenseId <= 0 || !expenses.Contains(expenseId))
                || record.ExpenseIds.Distinct().Count() != record.ExpenseIds.Count
                || record.ExternalIds == null || record.ExternalIds.Count != record.ExpenseIds.Count
                || record.ExternalIds.Any(externalId => string.IsNullOrWhiteSpace(externalId) || externalId.Length > 120)
                || record.ExternalIds.Distinct(StringComparer.Ordinal).Count() != record.ExternalIds.Count
                || record.ExternalIds.Any(externalId => baseline.PendingExpenses.Any(pending => pending.ExternalId == externalId)))
                throw new InvalidOperationException("Cash baseline amendment metadata conflicts with its audit record");
            return record with { LedgerEntryId = entry.Id };
        }

        public static CashBaselineRecord Compose(CashBaselineRecord baseline,
            IEnumerable<CompanyLedgerEntry> entries, IEnumerable<Expense> currentExpenses, DateTime now)
        {
            var expenses = currentExpenses.ToList();
            var amendments = entries.Where(IsReserved).OrderBy(entry => entry.Id)
                .Select(entry => Read(entry, baseline, expenses, now)).ToList();
            if (amendments.Select(item => item.LedgerEntryId).Distinct().Count() != amendments.Count
                || amendments.SelectMany(item => item.ExpenseIds).Distinct().Count() != amendments.Sum(item => item.ExpenseIds.Count)
                || amendments.SelectMany(item => item.ExternalIds).Distinct(StringComparer.Ordinal).Count() != amendments.Sum(item => item.ExternalIds.Count))
                throw new InvalidOperationException("Cash baseline amendments reuse audit or source IDs");
            return baseline with { HistoricalExpenseAdjustment = amendments.Sum(item => item.Amount), Amendments = amendments };
        }
    }
}