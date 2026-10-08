using System;
using System.Collections.Generic;

namespace FinanceHubFunctions.Models
{
    public class Expense : IForeignCurrencyRecord
    {
        public int Id { get; set; }
        public string? ExpenseId { get; set; }
        public string? Supplier { get; set; }
        public string? SupplierFreeText { get; set; }
        public string? Reference { get; set; }
        public string? Category { get; set; }
        public string? VATApplicability { get; set; }
        public bool VATIncluded { get; set; }
        public decimal? VATRate { get; set; }
        public decimal? AmountNet { get; set; }
        public decimal? VATAmount { get; set; }
        public decimal? AmountGross { get; set; }
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
        public DateTime? EntryDate { get; set; }
        public DateTime? DatePaid { get; set; }
        public string? PaymentMethod { get; set; }
        public string? Notes { get; set; }
        public string? TaxYear { get; set; }
        public string? FinancialYear { get; set; }
        public string? ReceiptUrl { get; set; }
        public bool IsDLA { get; set; }
        public List<string>? Attachments { get; set; }
        public string? CtTag { get; set; } // Revenue | Capital | NonCT
        // Trivial Benefit (HMRC s.323 — max £50, max 6 per recipient per tax year, non-cash only)
        public bool IsTrivialBenefit { get; set; } = false;
        public string? TrivialBenefitType { get; set; } // e.g. "Gift Card (Amazon)", "Gift Card (Other)", "Other"
        public string? TrivialBenefitRecipient { get; set; } // Employee or director name — limit is 6 per recipient per tax year
        // Recurring expense
        public bool IsRecurring { get; set; } = false;
        public string? RecurringFrequency { get; set; } // "Monthly" | "Quarterly" | "Annual"
        public DateTime? RecurringNextDate { get; set; }
        // Missing Receipt Declaration
        public bool HasMissingReceiptDeclaration { get; set; } = false;
        public string? MissingReceiptDeclarationRef { get; set; } // e.g. MRD-20260315-001
        public string? NoReceiptReason { get; set; }

        // Employee portal — approval workflow
        public int? SubmittedByTeamMemberId { get; set; }
        public string? ApprovalStatus { get; set; } = "NotRequired"; // NotRequired | Draft | Submitted | Approved | Rejected
        public int? ApprovedByTeamMemberId { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? RejectionReason { get; set; }
        public DateTime? SubmittedAt { get; set; }
    }
}
