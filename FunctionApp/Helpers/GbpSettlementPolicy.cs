using System;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed class GbpSettlementRequest
    {
        public decimal? ActualGbpPaid { get; set; }
        public DateTime? SettlementDate { get; set; }
        public int? SettlementBankTransactionId { get; set; }
    }

    public static class GbpSettlementPolicy
    {
        public static string? Validate(IForeignCurrencyRecord record, GbpSettlementRequest request, bool isDla)
        {
            if (record.OriginalCurrency != "EUR" && record.OriginalCurrency != "USD")
                return "GBP settlement is only available for foreign currency records";
            if (!request.ActualGbpPaid.HasValue || request.ActualGbpPaid <= 0 || request.ActualGbpPaid > 9999999999999999.99m
                || decimal.Round(request.ActualGbpPaid.Value, 2) != request.ActualGbpPaid.Value)
                return "actualGbpPaid must be a positive GBP amount in whole pennies";
            if (!request.SettlementDate.HasValue) return "settlementDate is required";
            if (request.SettlementBankTransactionId <= 0) return "settlementBankTransactionId must be positive";
            if (isDla && request.SettlementBankTransactionId.HasValue)
                return "DLA invoice payments are personal; company bank reimbursements cannot be linked as invoice settlements";
            return null;
        }

        public static bool Conflicts(IForeignCurrencyRecord record, GbpSettlementRequest request) =>
            record.ActualGbpPaid.HasValue && (record.ActualGbpPaid != request.ActualGbpPaid
                || record.SettlementDate?.Date != request.SettlementDate?.Date
                || record.SettlementBankTransactionId != request.SettlementBankTransactionId);

        public static string? ValidateBank(IForeignCurrencyRecord record, GbpSettlementRequest request,
            BankTransaction? bank, BankAccount? account)
        {
            if (bank == null) return "Settlement bank transaction does not exist";
            if (account == null || !account.IsActive || !string.Equals(account.Currency ?? "GBP", "GBP", StringComparison.OrdinalIgnoreCase))
                return "Settlement requires an active GBP bank account";
            if (bank.Direction != "Out") return "Settlement bank transaction must be Out";
            if (!bank.Amount.HasValue || bank.Amount == decimal.MinValue
                || Math.Abs(bank.Amount.Value) != request.ActualGbpPaid)
                return "Bank amount must equal actualGbpPaid in pennies";
            if (!bank.TransactionDate.HasValue || bank.TransactionDate.Value.Date != request.SettlementDate?.Date)
                return "Bank transaction date must equal settlementDate";
            if (bank.OriginalCurrency != null && !string.Equals(bank.OriginalCurrency, record.OriginalCurrency, StringComparison.OrdinalIgnoreCase))
                return "Bank original currency does not match the invoice";
            if (bank.OriginalAmount.HasValue && (bank.OriginalAmount == decimal.MinValue
                || Math.Abs(bank.OriginalAmount.Value) != record.OriginalAmountGross))
                return "Bank original amount does not match the invoice";
            return null;
        }
    }
}