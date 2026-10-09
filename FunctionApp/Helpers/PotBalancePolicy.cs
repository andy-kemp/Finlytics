#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed record PotBalanceRequest(decimal? VatPotBalance, decimal? CtPotBalance, string? AsOfDate, string? Reference);
    public sealed record PotBalanceRecord(int BankAccountId, decimal VatPotBalance, decimal CtPotBalance,
        string AsOfDate, DateTime RecordedAtUtc, string Reference, int LedgerEntryId);

    public static class PotBalancePolicy
    {
        public const string EntryType = "Bank_PotSnapshot";
        public const decimal MaximumBalance = 9999999999999999.99m;
        public static string Marker(int accountId) => $"[POT-BALANCES:{accountId}]";
        public static bool IsReserved(CompanyLedgerEntry entry) =>
            string.Equals(entry.EntryType, EntryType, StringComparison.OrdinalIgnoreCase)
            || (entry.Notes?.Contains("[POT-BALANCES:", StringComparison.OrdinalIgnoreCase) ?? false);

        private static bool ValidBalance(decimal? value) => value.HasValue && value.Value >= 0
            && value.Value <= MaximumBalance && decimal.Round(value.Value, 2) == value.Value;

        public static string? Validate(PotBalanceRequest request, DateTime now)
        {
            if (!ValidBalance(request.VatPotBalance) || !ValidBalance(request.CtPotBalance))
                return "vatPotBalance and ctPotBalance must be explicit nonnegative GBP whole-penny amounts within decimal(18,2)";
            if (!CashBaselinePolicy.TryDate(request.AsOfDate, out var date)
                || date < new DateTime(2000, 1, 1) || date > now.Date)
                return "asOfDate must be an explicit ISO date (yyyy-MM-dd) from 2000-01-01 through today (UTC)";
            if (string.IsNullOrWhiteSpace(request.Reference) || request.Reference.Length > 250)
                return "reference must document the owner's actual balance assertion (1-250 characters)";
            return null;
        }

        public static PotBalanceRecord Create(int accountId, PotBalanceRequest request, DateTime now) =>
            new(accountId, request.VatPotBalance!.Value, request.CtPotBalance!.Value,
                request.AsOfDate!, now, request.Reference!, 0);

        public static string Notes(PotBalanceRecord record) => Marker(record.BankAccountId) + "\n"
            + JsonSerializer.Serialize(record, CashBaselinePolicy.Json);

        public static PotBalanceRecord Read(CompanyLedgerEntry entry, DateTime now)
        {
            if (entry.EntryType != EntryType || entry.Notes == null)
                throw new InvalidOperationException("Invalid pot snapshot audit record");
            var separator = entry.Notes.IndexOf('\n');
            if (separator < 0) throw new InvalidOperationException("Missing pot snapshot metadata");
            var record = JsonSerializer.Deserialize<PotBalanceRecord>(entry.Notes.Substring(separator + 1), CashBaselinePolicy.Json)
                ?? throw new InvalidOperationException("Missing pot snapshot metadata");
            if (record.BankAccountId <= 0 || entry.Notes.Substring(0, separator) != Marker(record.BankAccountId)
                || record.LedgerEntryId != entry.Id || entry.Amount != 0
                || record.RecordedAtUtc.Kind != DateTimeKind.Utc || record.RecordedAtUtc > now
                || Validate(new(record.VatPotBalance, record.CtPotBalance, record.AsOfDate, record.Reference), record.RecordedAtUtc) != null
                || !CashBaselinePolicy.TryDate(record.AsOfDate, out var date) || date != entry.EffectiveDate.Date)
                throw new InvalidOperationException("Pot snapshot metadata conflicts with its ledger record");
            return record;
        }

        public static bool Identical(PotBalanceRecord record, PotBalanceRequest request) =>
            record.VatPotBalance == request.VatPotBalance && record.CtPotBalance == request.CtPotBalance
            && record.AsOfDate == request.AsOfDate && record.Reference == request.Reference;

        public static PotBalanceRecord? Latest(IEnumerable<PotBalanceRecord> records) =>
            records.OrderByDescending(record => record.AsOfDate, StringComparer.Ordinal)
                .ThenByDescending(record => record.LedgerEntryId).FirstOrDefault();
    }
}