using System;

namespace FinanceHubFunctions.Models
{
    public class DlaEntry : IForeignCurrencyRecord
    {
        public int Id { get; set; }
        public string DlaId { get; set; } = string.Empty; // DLA-YYYY-NNNN format
        public string Director { get; set; } = string.Empty; // Director name
        public string Direction { get; set; } = "OwedToDirector"; // OwedToDirector | OwedToCompany
        public DateTime EntryDate { get; set; }
        public string Description { get; set; } = string.Empty;
        public decimal AmountNet { get; set; }
        public decimal VatAmount { get; set; }
        public decimal AmountGross { get; set; }
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
        public string? Category { get; set; }
        public string? CtTag { get; set; } // Revenue | Capital | NonCT
        public bool IsStartupCost { get; set; } = false;
        public string? ClassificationSource { get; set; } = "auto"; // auto | manual
        public string? SourceBatchId { get; set; }
        
        // Payment tracking
        public bool PayInInstallments { get; set; } = false; // If true, allows partial payments
        public decimal AmountPaid { get; set; } = 0m; // Total amount paid so far
        public decimal RemainingBalance { get; set; } = 0m; // AmountGross - AmountPaid
        
        public DateTime? DatePaid { get; set; } // Date fully paid (if PayInInstallments = false)
        public string? PaymentMethod { get; set; }
        public string? Notes { get; set; }
        public string? ReceiptUrl { get; set; }
        public string? PdfUrl { get; set; }
        // Trivial Benefit (HMRC s.323 — max £50, max 6 per recipient per tax year, non-cash only)
        public bool IsTrivialBenefit { get; set; } = false;
        public string? TrivialBenefitType { get; set; } // e.g. "Gift Card (Amazon)", "Gift Card (Other)", "Other"
        public string? TrivialBenefitRecipient { get; set; } // Employee or director name — limit is 6 per recipient per tax year
        public string PeriodKey { get; set; } = string.Empty; // yyyy-MM
        public string? TaxYear { get; set; }
        public string? FinancialYear { get; set; }
        public DateTime CreatedDate { get; set; } = DateTime.UtcNow;
        public DateTime? ModifiedDate { get; set; }

        // Missing Receipt Declaration
        public bool HasMissingReceiptDeclaration { get; set; } = false;
        public string? MissingReceiptDeclarationRef { get; set; } // e.g. MRD-20260315-001
        public string? NoReceiptReason { get; set; }
    }
}
