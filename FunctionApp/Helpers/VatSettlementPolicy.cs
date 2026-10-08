#nullable enable
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.RegularExpressions;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed class VatSettlementRequest
    {
        public decimal? Amount { get; set; }
        public DateTime? SettlementDate { get; set; }
        public int? BankTransactionId { get; set; }
        public string? Reference { get; set; }
        public string? DifferenceReason { get; set; }
    }

    public static class VatSettlementPolicy
    {
        public static string Marker(int id) => $"[VAT-RETURN:{id}]";
        public static string BankMarker(int id) => $"[BANK-TX:{id}]";
        public static bool HasMarker(string? notes, int id) => notes?.Contains(Marker(id), StringComparison.Ordinal) == true;
        public static bool HasVatMarker(string? notes) => Regex.IsMatch(notes ?? "", @"\[VAT-RETURN:[1-9][0-9]*\]");
        public static int? LinkedReturnId(string? notes)
        {
            var match = Regex.Match(notes ?? "", @"\[VAT-RETURN:([1-9][0-9]*)\]");
            return match.Success && int.TryParse(match.Groups[1].Value, out var id) ? id : null;
        }
        public static string EntryType(VatReturn record) => record.VatOwed > 0 ? "VAT_Paid" : "VAT_Reclaim";

        public static Dictionary<string, object?> Project(VatReturn record, CompanyLedgerEntry? entry)
        {
            var properties = JsonSerializer.SerializeToElement(record, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            var result = new Dictionary<string, object?>();
            foreach (var property in properties.EnumerateObject()) result.Add(property.Name, property.Value);
            var saved = entry == null ? null : Read(entry);
            result.Add("settlementStatus", entry != null ? (record.VatOwed > 0 ? "Paid" : "RefundReceived")
                : record.VatOwed > 0 ? "AwaitingPayment" : record.VatOwed < 0 ? "AwaitingRefund" : "NoSettlementRequired");
            result.Add("settlementAmount", entry?.Amount);
            result.Add("settlementDate", entry?.EffectiveDate);
            result.Add("settlementBankTransactionId", saved?.BankTransactionId);
            result.Add("settlementLedgerEntryId", entry?.Id);
            result.Add("settlementReference", saved?.Reference);
            return result;
        }

        public static string? Validate(VatReturn record, VatSettlementRequest request, DateTime today)
        {
            if (record.Status != "Filed" || !record.FiledDate.HasValue) return "VAT return must be filed";
            if (record.VatOwed == 0 || record.VatOwed == decimal.MinValue) return "VAT return requires no settlement";
            if (!request.Amount.HasValue || request.Amount <= 0 || request.Amount > 9999999999999999.99m
                || decimal.Round(request.Amount.Value, 2) != request.Amount.Value)
                return "amount must be a positive GBP amount in whole pennies";
            if (!request.SettlementDate.HasValue || request.SettlementDate.Value.Year < 2000
                || request.SettlementDate.Value.Date > today.Date || request.SettlementDate.Value.TimeOfDay != TimeSpan.Zero)
                return "settlementDate must be a date from 2000 and not in the future";
            if (request.BankTransactionId <= 0) return "bankTransactionId must be positive";
            if (request.Reference == null) return "reference is required";
            if (request.Amount != Math.Abs(record.VatOwed) && string.IsNullOrWhiteSpace(request.DifferenceReason))
                return "differenceReason is required when the actual settlement differs from VAT owed";
            if (HasVatMarker(request.Reference) || HasVatMarker(request.DifferenceReason)
                || Regex.IsMatch((request.Reference ?? "") + (request.DifferenceReason ?? ""), @"\[BANK-TX:[1-9][0-9]*\]"))
                return "reference and differenceReason cannot contain settlement markers";
            return null;
        }

        public static string Notes(int id, VatSettlementRequest request) => Marker(id)
            + (request.BankTransactionId.HasValue ? " " + BankMarker(request.BankTransactionId.Value) : "")
            + "\n" + JsonSerializer.Serialize(request);

        public static VatSettlementRequest? Read(CompanyLedgerEntry entry)
        {
            var index = entry.Notes?.IndexOf('\n') ?? -1;
            if (index < 0) return null;
            try { return JsonSerializer.Deserialize<VatSettlementRequest>(entry.Notes!.Substring(index + 1)); }
            catch (JsonException) { return null; }
        }

        public static bool Identical(CompanyLedgerEntry entry, VatSettlementRequest request)
        {
            var saved = Read(entry);
            return saved != null && entry.Amount == request.Amount && entry.EffectiveDate.Date == request.SettlementDate?.Date
                && saved.Amount == request.Amount && saved.SettlementDate == request.SettlementDate
                && saved.BankTransactionId == request.BankTransactionId && saved.Reference == request.Reference
                && saved.DifferenceReason == request.DifferenceReason;
        }

        public static bool ChangesFiledFigures(VatReturn existing, VatReturn updated) =>
            existing.QuarterStartDate != updated.QuarterStartDate || existing.QuarterEndDate != updated.QuarterEndDate
            || existing.VatIn != updated.VatIn || existing.VatOut != updated.VatOut || existing.VatOwed != updated.VatOwed
            || existing.FiledDate != updated.FiledDate || existing.Status != updated.Status;

        public static string? ValidateBank(VatReturn record, VatSettlementRequest request, BankTransaction? bank, BankAccount? account)
        {
            if (bank == null) return "Bank transaction does not exist";
            if (account == null || !account.IsActive || !string.Equals(account.Currency, "GBP", StringComparison.OrdinalIgnoreCase))
                return "Settlement requires an active GBP bank account";
            if (string.Equals(bank.Category, "Internal Transfer", StringComparison.OrdinalIgnoreCase)
                || Regex.IsMatch((bank.Description ?? "") + " " + (bank.Category ?? "") + " " + (account.AccountName ?? ""), @"\bpot\b|pot transfer", RegexOptions.IgnoreCase))
                return "Internal transfers are not VAT settlements";
            if (bank.Direction != (record.VatOwed > 0 ? "Out" : "In")) return "Bank direction does not match VAT owed";
            if (!bank.Amount.HasValue || bank.Amount == decimal.MinValue || Math.Abs(bank.Amount.Value) != request.Amount)
                return "Bank amount must equal settlement amount";
            if (bank.TransactionDate?.Date != request.SettlementDate?.Date) return "Bank date must equal settlementDate";
            return null;
        }
    }
}