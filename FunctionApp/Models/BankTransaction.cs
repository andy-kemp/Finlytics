using System;

namespace FinanceHubFunctions.Models
{
    public class BankTransaction
    {
        public int Id { get; set; }
        public int BankAccountId { get; set; }
        public DateTime? TransactionDate { get; set; }
        public decimal? Amount { get; set; }
        public string? OriginalCurrency { get; set; }
        public decimal? OriginalAmount { get; set; }
        public string? Description { get; set; }
        public string? Reference { get; set; }
        public string? Category { get; set; }
        public string? Direction { get; set; } // In / Out
        public decimal? Balance { get; set; }
        public string? ExternalId { get; set; }
        public string? Source { get; set; } // CSV, Manual, API, TrueLayer
        public bool IsReconciled { get; set; }
        public DateTime? ReconciledOn { get; set; }
        public string? ReconciledBy { get; set; }
        public DateTime? CreatedDate { get; set; }
        public DateTime? ModifiedDate { get; set; }
        // Monzo-specific
        public string? MonzoTransactionId { get; set; }
        public string? MonzoMerchantName { get; set; }
        public string? MonzoCategory { get; set; }
        public string? MonzoNotes { get; set; }
        // TrueLayer-specific
        public string? TrueLayerTransactionId { get; set; }
        public string? TrueLayerMerchantName { get; set; }
        public string? TrueLayerCategory { get; set; }
    }
}
