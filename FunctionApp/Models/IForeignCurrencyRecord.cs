using System;

namespace FinanceHubFunctions.Models
{
    public interface IForeignCurrencyRecord
    {
        string? OriginalCurrency { get; set; }
        decimal? OriginalAmountNet { get; set; }
        decimal? OriginalVatAmount { get; set; }
        decimal? OriginalAmountGross { get; set; }
        decimal? ExchangeRateToGbp { get; set; }
        DateTime? ExchangeRateDate { get; set; }
        string? ExchangeRateSource { get; set; }
        decimal? EstimatedGbpGross { get; set; }
        decimal? ActualGbpPaid { get; set; }
        DateTime? SettlementDate { get; set; }
        int? SettlementBankTransactionId { get; set; }
    }
}