using System;
using System.Linq;
using System.Text.Json;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public static class ForeignCurrencyHelper
    {
        private const decimal MaximumMoney = 9999999999999999.99m;
        private const decimal MaximumRate = 9999999999.99999999m;

        public static bool TryRead<T>(string? body, out T? value, out string? error) where T : class
        {
            try
            {
                value = JsonSerializer.Deserialize<T>(body ?? "", new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                error = value == null ? "Request body is required" : null;
                return error == null;
            }
            catch (JsonException)
            {
                value = null;
                error = "Invalid JSON: monetary amounts and exchange rates must be finite decimal numbers";
                return false;
            }
        }

        public static bool HasProperty(string body, string name)
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.EnumerateObject().Any(property => property.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
        }

        public static void PreserveOmitted<T>(T incoming, T existing, string body) where T : class
        {
            using var document = JsonDocument.Parse(body);
            var names = document.RootElement.EnumerateObject().Select(property => property.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var property in typeof(T).GetProperties().Where(property => property.CanRead && property.CanWrite))
            {
                if (!names.Contains(property.Name)) property.SetValue(incoming, property.GetValue(existing));
            }
        }

        public static void Copy(IForeignCurrencyRecord source, IForeignCurrencyRecord target)
        {
            target.OriginalCurrency = source.OriginalCurrency;
            target.OriginalAmountNet = source.OriginalAmountNet;
            target.OriginalVatAmount = source.OriginalVatAmount;
            target.OriginalAmountGross = source.OriginalAmountGross;
            target.ExchangeRateToGbp = source.ExchangeRateToGbp;
            target.ExchangeRateDate = source.ExchangeRateDate;
            target.ExchangeRateSource = source.ExchangeRateSource;
            target.EstimatedGbpGross = source.EstimatedGbpGross;
            target.ActualGbpPaid = source.ActualGbpPaid;
            target.SettlementDate = source.SettlementDate;
            target.SettlementBankTransactionId = source.SettlementBankTransactionId;
        }

        public static string? Validate(IForeignCurrencyRecord record, bool isNew = false, IForeignCurrencyRecord? existing = null)
        {
            var isDla = record is DlaEntry || record is DlaStartupRequest || record is DlaStartupItem || record is Expense { IsDLA: true };
            if (record.SettlementBankTransactionId.HasValue && (isDla || existing == null
                || existing.SettlementBankTransactionId != record.SettlementBankTransactionId))
                return isDla ? "Personal DLA invoice payments cannot link company bank reimbursements" : "Use PATCH expenses/{id}/gbp-settlement to link a bank transaction";
            if (existing?.ActualGbpPaid.HasValue == true && (GbpSettlementPolicy.Conflicts(existing, new GbpSettlementRequest
                {
                    ActualGbpPaid = record.ActualGbpPaid,
                    SettlementDate = record.SettlementDate,
                    SettlementBankTransactionId = record.SettlementBankTransactionId
                }) || existing.OriginalCurrency != record.OriginalCurrency || existing.OriginalAmountGross != record.OriginalAmountGross))
                return "A confirmed settlement and its original invoice amount/currency cannot be changed";
            if (record is Expense && existing != null && !isDla
                && (existing.ActualGbpPaid != record.ActualGbpPaid || existing.SettlementDate != record.SettlementDate
                    || existing.SettlementBankTransactionId != record.SettlementBankTransactionId))
                return "Use PATCH expenses/{id}/gbp-settlement to confirm settlement";
            var currency = record.OriginalCurrency?.Trim().ToUpperInvariant();
            if (currency == null && isNew) currency = "GBP";
            if (currency != null && currency != "GBP" && currency != "EUR" && currency != "USD")
                return "originalCurrency must be GBP, EUR or USD";
            record.OriginalCurrency = currency;
            if (record.ExchangeRateToGbp.HasValue && (record.ExchangeRateToGbp < 0.00000001m || record.ExchangeRateToGbp > MaximumRate))
                return "exchangeRateToGbp must be a positive finite decimal within decimal(18,8)";
            if (record.ExchangeRateSource?.Length > 100) return "exchangeRateSource must not exceed 100 characters";
            var amounts = new[] { record.OriginalAmountNet, record.OriginalVatAmount, record.OriginalAmountGross, record.EstimatedGbpGross, record.ActualGbpPaid };
            if (amounts.Any(amount => amount.HasValue && (amount.Value < 0 || amount.Value > MaximumMoney)))
                return "Currency amounts must be non-negative and within decimal(18,2)";
            if (currency == "EUR" || currency == "USD")
            {
                if (!record.OriginalAmountNet.HasValue || !record.OriginalVatAmount.HasValue || !record.OriginalAmountGross.HasValue || record.OriginalAmountGross <= 0)
                    return "Foreign currency requires originalAmountNet, originalVatAmount and a positive originalAmountGross";
                if (Math.Abs(record.OriginalAmountNet.Value + record.OriginalVatAmount.Value - record.OriginalAmountGross.Value) > 0.01m)
                    return "Original net plus original tax must equal original gross";
                if (!record.ExchangeRateToGbp.HasValue || !record.ExchangeRateDate.HasValue || string.IsNullOrWhiteSpace(record.ExchangeRateSource))
                    return "Foreign currency requires exchangeRateToGbp, exchangeRateDate and exchangeRateSource";
            }
            if (record.SettlementBankTransactionId.HasValue && record.SettlementBankTransactionId <= 0)
                return "settlementBankTransactionId must be positive";
            if ((record.SettlementDate.HasValue || record.SettlementBankTransactionId.HasValue) && !record.ActualGbpPaid.HasValue)
                return "Settlement metadata requires actualGbpPaid";
            if (record.ActualGbpPaid.HasValue && !record.SettlementDate.HasValue)
                return "actualGbpPaid requires settlementDate";
            if (record.ActualGbpPaid.HasValue)
                return GbpSettlementPolicy.Validate(record, new GbpSettlementRequest
                {
                    ActualGbpPaid = record.ActualGbpPaid,
                    SettlementDate = record.SettlementDate,
                    SettlementBankTransactionId = record.SettlementBankTransactionId
                }, isDla);
            return null;
        }

        public static string? ValidateBank(BankTransaction transaction)
        {
            var currency = transaction.OriginalCurrency?.Trim().ToUpperInvariant();
            if (currency != null && currency != "GBP" && currency != "EUR" && currency != "USD")
                return "originalCurrency must be GBP, EUR or USD";
            transaction.OriginalCurrency = currency;
            if (currency != null && !transaction.OriginalAmount.HasValue)
                return "Bank originalCurrency requires signed originalAmount from CSV Local amount";
            if (transaction.OriginalAmount.HasValue && (currency == null || transaction.OriginalAmount.Value < -MaximumMoney || transaction.OriginalAmount.Value > MaximumMoney))
                return "Bank originalAmount requires originalCurrency and must fit decimal(18,2)";
            return null;
        }
    }
}