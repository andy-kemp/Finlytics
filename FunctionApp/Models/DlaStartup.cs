using System;
using System.Collections.Generic;

namespace FinanceHubFunctions.Models
{
    public class DlaStartupRequest : ForeignCurrencyMetadata
    {
        public string Mode { get; set; } = "Single"; // Single | Itemised
        public string Director { get; set; } = string.Empty;
        public string? BatchId { get; set; }
        public DateTime? EntryDate { get; set; }
        public string? Category { get; set; }
        public string? CtTag { get; set; } // Revenue | Capital | NonCT
        public decimal? TotalAmount { get; set; }
        public string? Rationale { get; set; }
        public int SupportingDocumentCount { get; set; } = 0;
        public List<DlaStartupItem> Items { get; set; } = new();
    }

    public class DlaStartupItem : ForeignCurrencyMetadata
    {
        public DateTime? EntryDate { get; set; }
        public string Description { get; set; } = string.Empty;
        public string? Category { get; set; }
        public string? CtTag { get; set; }
        public decimal AmountNet { get; set; }
        public decimal VatAmount { get; set; }
        public decimal AmountGross { get; set; }
    }
}
