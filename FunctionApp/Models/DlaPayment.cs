using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace FinanceHubFunctions.Models
{
    public class DlaPayment
    {
        [Key]
        public int Id { get; set; }
        
        [Required]
        public string? PaymentId { get; set; } // DLA-PAY-YYYY-NNNN format
        
        [Required]  
        public string? DlaId { get; set; } // Which DLA entry this payment is for
        
        [Required]
        public string? Director { get; set; } // Director name (must match DLA entry)
        
        [Required]
        public decimal Amount { get; set; } // Payment amount (positive = payment made)
        
        public DateTime PaymentDate { get; set; }
        
        public string? PaymentMethod { get; set; } // Bank Transfer, Cash, Cheque, etc.
        
        public string? PaymentReference { get; set; } // Bank reference, cheque number, etc.
        
        public string? Notes { get; set; }
        
        // For tracking purposes
        public string? PeriodKey { get; set; } // YYYY-MM for grouping
        
        public DateTime CreatedDate { get; set; } = DateTime.UtcNow;
        
        public string? ReceiptUrl { get; set; } // Optional receipt/proof of payment
    }

    public class DlaPaymentRequest
    {
        public decimal PaymentAmount { get; set; }
        public DateTime PaymentDate { get; set; }
        public string? PaymentMethod { get; set; }
        public string? Notes { get; set; }
        public bool SendEmail { get; set; } = false;
        public string? RecipientEmail { get; set; }
    }

    public class DlaBatchPaymentRequest
    {
        public List<string> DlaIds { get; set; } = new();
        public DateTime PaymentDate { get; set; }
        public string? PaymentMethod { get; set; }
        public string? Reference { get; set; }
        public string? Notes { get; set; }
        public bool SendEmail { get; set; } = true;
        public string? RecipientEmail { get; set; }
    }
}