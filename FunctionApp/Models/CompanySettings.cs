using System;

namespace FinanceHubFunctions.Models
{
    public class CompanySettings
    {
        public int Id { get; set; }
        public string? CompanyName { get; set; }
        public string? Address { get; set; }
        public string? CompanyAddress { get; set; }
        public string? PhoneNumber { get; set; }
        public string? CompanyPhone { get; set; }
        public string? Email { get; set; }
        public string? CompanyEmail { get; set; }
        public string? CompanyRegistrationNumber { get; set; }
        public string? TaxRegistrationNumber { get; set; }
        public string? VatRegistrationNumber { get; set; }
        public string? VATNumber { get; set; }
        public string? BankName { get; set; }
        public string? BankAccountNumber { get; set; }
        public string? AccountNumber { get; set; }
        public string? BankSortCode { get; set; }
        public string? SortCode { get; set; }
        public string? BankIBAN { get; set; }
        public string? BankSwiftCode { get; set; }
        public string? DefaultCurrency { get; set; }
        public string? CurrencySymbol { get; set; }
        public string? DefaultVATRate { get; set; }
        public string? InvoicePrefix { get; set; }
        public string? QuotePrefix { get; set; }
        public string? InvoiceTermsDays { get; set; }
        public string? PaymentTerms { get; set; }
        public string? InvoiceFooterText { get; set; }
        public string? FooterText { get; set; }
        public string? LogoUrl { get; set; }
        public string? DocumentLogoUrl { get; set; }  // Logo used in PDF documents (invoices, quotes, payslips, etc.)
        public string? EmailLogoUrl { get; set; }      // Logo used in email templates
        public string? InvoicesEmail { get; set; }
        public string? QuotesEmail { get; set; }
        public string? PaymentsEmail { get; set; }
        public DateTime? IncorporationDate { get; set; } // ISO date for startup cost classification
        public DateTime? CompanyInceptionDate { get; set; }
        public int? FYStartMonth { get; set; }
        public int? FYStartDay { get; set; }
        public int? NextInvoiceNumber { get; set; }
        public int? NextQuoteNumber { get; set; }
        public string? SmtpServer { get; set; }
        public int? SmtpPort { get; set; }
        public string? SmtpFromAddress { get; set; }
        public string? SmtpUsername { get; set; }
        public string? SmtpPassword { get; set; }
        public string? DirectorName { get; set; }
        public string? DirectorSignature { get; set; }
        public bool? HasAuthorizedOfficer { get; set; }
        public string? AuthorizedOfficerName { get; set; }
        public string? AuthorizedOfficerSignature { get; set; }
        public string? Directors { get; set; } // Comma-separated list of director names for DLA
        public bool? PsaApproved { get; set; } // HMRC PAYE Settlement Agreement approved
        public string? PsaContactName { get; set; } // PSA HMRC reference or contact name
        public int? VatQuarterStartMonth { get; set; } // 1-12: the month your first VAT quarter starts (e.g. 2 = Feb for Feb/Mar/Apr)
        public string? VatAccountingMethod { get; set; } // 'invoice' (default) or 'cash' (UK Cash Accounting Scheme)
        public DateTime? VatEffectiveDate { get; set; } // Date VAT registration became effective — quarters before this are not required
        public string? Utr { get; set; } // HMRC Unique Taxpayer Reference (10 digits)
        public decimal? AmapRate45p { get; set; }        // HMRC AMAP rate for first N miles (default 0.55 from 2026/27, else 0.45)
        public decimal? AmapRate25p { get; set; }        // HMRC AMAP rate over threshold (default 0.25)
        public decimal? AmapThresholdMiles { get; set; } // HMRC AMAP mileage threshold (default 10,000)
        public bool? AllowDataDeletion { get; set; }    // Master switch: when false, ALL record deletion is blocked (production safety)
        public bool? AllowDividendDeletion { get; set; } // Legacy/granular: also allows dividend deletion (either flag enables it)
        public string? HmrcGatewayUserId { get; set; }   // HMRC Online Services User ID (used for VAT MTD & Payroll RTI)
        public string? HmrcGatewayPassword { get; set; } // NOT stored in DB — Key Vault only (transient, for save/load)
    }
}