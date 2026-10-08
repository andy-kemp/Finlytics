using System;

namespace FinanceHubFunctions.Models
{
    public class ForeignCurrencyMetadata : IForeignCurrencyRecord
    {
        public string? OriginalCurrency { get; set; }
        public decimal? OriginalAmountNet { get; set; }
        public decimal? OriginalVatAmount { get; set; }
        public decimal? OriginalAmountGross { get; set; }
        public decimal? ExchangeRateToGbp { get; set; }
        public DateTime? ExchangeRateDate { get; set; }
        public string? ExchangeRateSource { get; set; }
        public decimal? EstimatedGbpGross { get; set; }
        public decimal? ActualGbpPaid { get; set; }
        public DateTime? SettlementDate { get; set; }
        public int? SettlementBankTransactionId { get; set; }
    }
}