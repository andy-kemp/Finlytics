using System;

namespace FinanceHubFunctions.Models
{
    public class VatReturn
    {
        public int Id { get; set; }
        public string QuarterLabel { get; set; } = ""; // e.g. "Q1 2025/26"
        public string MonthsLabel { get; set; } = ""; // e.g. "Feb – Apr 2025"
        public DateTime QuarterStartDate { get; set; }
        public DateTime QuarterEndDate { get; set; }
        public decimal VatIn { get; set; }   // VAT charged on sales/invoices
        public decimal VatOut { get; set; }  // VAT reclaimed on purchases/expenses
        public decimal VatOwed { get; set; } // Net = VatIn - VatOut (positive = owe HMRC)
        public string Status { get; set; } = "Filed"; // always "Filed" — records are created on filing
        public DateTime? FiledDate { get; set; }
        public string? Reference { get; set; }   // HMRC return reference
        public string? Notes { get; set; }
        public string? ConfirmationPdfUrl { get; set; } // URL to uploaded submission confirmation PDF
        public DateTime CreatedDate { get; set; }
        public DateTime ModifiedDate { get; set; }
    }
}
