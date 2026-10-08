using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Data
{
    public class FinanceHubDbContext : DbContext
    {
        public FinanceHubDbContext(DbContextOptions<FinanceHubDbContext> options) : base(options)
        {
        }

        // Core entities
        public DbSet<Customer> Customers { get; set; }
        public DbSet<Supplier> Suppliers { get; set; }
        public DbSet<Employee> Employees { get; set; }
        public DbSet<Invoice> Invoices { get; set; }
        public DbSet<Expense> Expenses { get; set; }
        public DbSet<Quote> Quotes { get; set; }
        public DbSet<CompanyLedgerEntry> CompanyLedger { get; set; }
        public DbSet<DlaEntry> DlaEntries { get; set; }
        public DbSet<DlaPayment> DlaPayments { get; set; }
        public DbSet<Shareholder> Shareholders { get; set; }
        public DbSet<CompanySettings> CompanySettings { get; set; }
        public DbSet<FinanceHubSettings> FinanceHubSettings { get; set; }
        public DbSet<Asset> Assets { get; set; }
        public DbSet<Subscription> Subscriptions { get; set; }
        public DbSet<BankAccount> BankAccounts { get; set; }
        public DbSet<BankTransaction> BankTransactions { get; set; }
        public DbSet<ReconciliationRule> ReconciliationRules { get; set; }
        public DbSet<ReconciliationMatch> ReconciliationMatches { get; set; }
        public DbSet<PayrollRun> PayrollRuns { get; set; }
        public DbSet<Payslip> Payslips { get; set; }
        public DbSet<PayrollSettings> PayrollSettings { get; set; }
        public DbSet<VatReturn> VatReturns { get; set; }
        public DbSet<HmrcToken> HmrcTokens { get; set; }
        public DbSet<MileageTrip> MileageTrips { get; set; }
        public DbSet<MileageClaim> MileageClaims { get; set; }
        public DbSet<BikEntry> BikEntries { get; set; }
        public DbSet<DividendDeclaration> DividendDeclarations { get; set; }
        public DbSet<DividendAllocation> DividendAllocations { get; set; }
        public DbSet<MissingReceiptDeclaration> MissingReceiptDeclarations { get; set; }
        public DbSet<ExpenseAuditEvent> ExpenseAuditEvents { get; set; }
        public DbSet<CreditNote> CreditNotes { get; set; }
        public DbSet<TeamMember> TeamMembers { get; set; }
        public DbSet<Accountant> Accountants { get; set; }
        public DbSet<CompanyAccountant> CompanyAccountants { get; set; }
        public DbSet<RecurringInvoiceTemplate> RecurringInvoiceTemplates { get; set; }
        public DbSet<CategorizationRule> CategorizationRules { get; set; }
        public DbSet<GoCardlessMandate> GoCardlessMandates { get; set; }
        public DbSet<GoCardlessPayment> GoCardlessPayments { get; set; }
        public DbSet<Bill> Bills { get; set; }

        private static void ConfigureForeignCurrency<TEntity>(Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity> entity)
            where TEntity : class, IForeignCurrencyRecord
        {
            entity.Property(record => record.OriginalCurrency).HasMaxLength(3);
            entity.Property(record => record.OriginalAmountNet).HasColumnType("decimal(18,2)");
            entity.Property(record => record.OriginalVatAmount).HasColumnType("decimal(18,2)");
            entity.Property(record => record.OriginalAmountGross).HasColumnType("decimal(18,2)");
            entity.Property(record => record.ExchangeRateToGbp).HasColumnType("decimal(18,8)");
            entity.Property(record => record.ExchangeRateSource).HasMaxLength(100);
            entity.Property(record => record.EstimatedGbpGross).HasColumnType("decimal(18,2)");
            entity.Property(record => record.ActualGbpPaid).HasColumnType("decimal(18,2)");
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Customer configuration
            modelBuilder.Entity<Customer>(entity =>
            {
                entity.ToTable("Customers");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).HasMaxLength(50);
                entity.Property(e => e.Code).HasMaxLength(50);
                entity.Property(e => e.CustomerCode).HasMaxLength(50);
                entity.Property(e => e.Name).HasMaxLength(255);
                entity.Property(e => e.CustomerName).HasMaxLength(255);
                entity.Property(e => e.Email).HasMaxLength(255);
                entity.Property(e => e.BillingEmail).HasMaxLength(255);
                entity.Property(e => e.Phone).HasMaxLength(50);
                entity.Property(e => e.Address).HasMaxLength(1000);
                entity.Property(e => e.BillingAddress).HasMaxLength(1000);
                entity.Property(e => e.DefaultDayRate).HasMaxLength(50);
                entity.Property(e => e.DefaultHourlyRate).HasMaxLength(50);
                entity.Property(e => e.ContactName).HasMaxLength(255);
                entity.Property(e => e.CcEmail).HasMaxLength(255);
                entity.HasIndex(e => e.Code);
            });

            // Supplier configuration
            modelBuilder.Entity<Supplier>(entity =>
            {
                entity.ToTable("Suppliers");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).HasMaxLength(50);
                entity.Property(e => e.Code).HasMaxLength(50);
                entity.Property(e => e.SupplierCode).HasMaxLength(50);
                entity.Property(e => e.Name).HasMaxLength(255);
                entity.Property(e => e.Email).HasMaxLength(255);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.PayeeType).HasMaxLength(50);
                entity.Property(e => e.PrimaryContact).HasMaxLength(255);
                entity.Property(e => e.RemittanceEmail).HasMaxLength(255);
                entity.Property(e => e.Phone).HasMaxLength(50);
                entity.Property(e => e.PaymentMethod).HasMaxLength(100);
                entity.Property(e => e.PaymentTerms).HasMaxLength(100);
                entity.Property(e => e.Currency).HasMaxLength(10);
                entity.Property(e => e.VATRegistration).HasMaxLength(50);
                entity.Property(e => e.AccountNumber).HasMaxLength(50);
                entity.Property(e => e.SortCode).HasMaxLength(20);
                entity.Property(e => e.IBAN).HasMaxLength(100);
                entity.HasIndex(e => e.Code);
            });

            // Employee configuration
            modelBuilder.Entity<Employee>(entity =>
            {
                entity.ToTable("Employees");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.EmployeeNumber).HasMaxLength(50);
                entity.Property(e => e.Name).HasMaxLength(255);
                entity.Property(e => e.Email).HasMaxLength(255);
                entity.Property(e => e.NationalInsuranceNumber).HasMaxLength(50);
                entity.Property(e => e.TaxCode).HasMaxLength(50);
                entity.Property(e => e.AnnualSalary).HasColumnType("decimal(18,2)");
                entity.Property(e => e.PaymentSchedule).HasMaxLength(50);
                entity.Property(e => e.StartDate).HasMaxLength(50);
                entity.Property(e => e.BankAccountName).HasMaxLength(255);
                entity.Property(e => e.BankAccountNumber).HasMaxLength(50);
                entity.Property(e => e.BankSortCode).HasMaxLength(20);
                entity.Property(e => e.Address).HasMaxLength(1000);
                entity.Property(e => e.PhoneNumber).HasMaxLength(50);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.IsDirector).HasDefaultValue(false);
                entity.HasIndex(e => e.EmployeeNumber);
            });

            // Invoice configuration
            modelBuilder.Entity<Invoice>(entity =>
            {
                entity.ToTable("Invoices");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.InvoiceNumber).IsRequired().HasMaxLength(50);
                entity.Property(e => e.CustomerId).HasMaxLength(50);
                entity.Property(e => e.CustomerName).HasMaxLength(255);
                entity.Property(e => e.BillingEmail).HasMaxLength(255);
                entity.Property(e => e.POReference).HasMaxLength(255);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.AmountNet).HasColumnType("decimal(18,2)");
                entity.Property(e => e.DiscountPercent).HasColumnType("decimal(5,2)");
                entity.Property(e => e.DiscountAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.DiscountNote).HasMaxLength(500);
                entity.Property(e => e.VATAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.FinancialYear).HasMaxLength(50);
                entity.Property(e => e.VatNumber).HasMaxLength(50);
                entity.Property(e => e.PdfUrl).HasMaxLength(500);
                entity.Property(e => e.ReminderSentAt);
                entity.Property(e => e.ReminderCount).HasDefaultValue(0);
                entity.HasIndex(e => e.InvoiceNumber).IsUnique();
                entity.Property(e => e.LineItems)
                    .HasColumnType("nvarchar(max)")
                    .HasConversion(
                        v => v == null || v.Count == 0 ? null : System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                        v => string.IsNullOrEmpty(v) ? new List<InvoiceLine>() : System.Text.Json.JsonSerializer.Deserialize<List<InvoiceLine>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new List<InvoiceLine>()
                    );
            });

            // Expense configuration
            modelBuilder.Entity<Expense>(entity =>
            {
                entity.ToTable("Expenses");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.ExpenseId).HasMaxLength(50);
                entity.Property(e => e.Supplier).HasMaxLength(255);
                entity.Property(e => e.SupplierFreeText).HasMaxLength(255);
                entity.Property(e => e.Reference).HasMaxLength(255);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.VATApplicability).HasMaxLength(50);
                entity.Property(e => e.VATRate).HasColumnType("decimal(5,2)");
                entity.Property(e => e.AmountNet).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VATAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.PaymentMethod).HasMaxLength(100);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.TaxYear).HasMaxLength(50);
                entity.Property(e => e.FinancialYear).HasMaxLength(50);
                entity.Property(e => e.ReceiptUrl).HasMaxLength(500);
                entity.Property(e => e.CtTag).HasMaxLength(20);
                entity.Property(e => e.IsTrivialBenefit).HasDefaultValue(false);
                entity.Property(e => e.TrivialBenefitType).HasMaxLength(100);
                entity.Property(e => e.IsRecurring).HasDefaultValue(false);
                entity.Property(e => e.RecurringFrequency).HasMaxLength(20);
                entity.Property(e => e.RecurringNextDate);
                entity.Ignore(e => e.Attachments); // Store as JSON or in blob metadata
                ConfigureForeignCurrency(entity);
            });

            // Quote configuration
            modelBuilder.Entity<Quote>(entity =>
            {
                entity.ToTable("Quotes");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.QuoteNumber).IsRequired().HasMaxLength(50);
                entity.Property(e => e.CustomerId).HasMaxLength(50);
                entity.Property(e => e.CustomerName).HasMaxLength(255);
                entity.Property(e => e.ContactEmail).HasMaxLength(255);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.AmountNet).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VATAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.PdfUrl).HasMaxLength(500);
                entity.HasIndex(e => e.QuoteNumber).IsUnique();
                entity.Property(e => e.LineItems)
                    .HasColumnType("nvarchar(max)")
                    .HasConversion(
                        v => v == null || v.Count == 0 ? null : System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                        v => string.IsNullOrEmpty(v) ? new List<QuoteLine>() : System.Text.Json.JsonSerializer.Deserialize<List<QuoteLine>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new List<QuoteLine>()
                    );
            });

            // CompanyLedgerEntry configuration
            modelBuilder.Entity<CompanyLedgerEntry>(entity =>
            {
                entity.ToTable("CompanyLedger");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.Title).HasMaxLength(255);
                entity.Property(e => e.EntryType).IsRequired().HasMaxLength(50);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.DlaReference).HasMaxLength(50);
                entity.Property(e => e.PeriodKey).HasMaxLength(50);
                entity.Property(e => e.FinancialYear).HasMaxLength(50);
                entity.HasIndex(e => new { e.PeriodKey, e.EntryType });
            });

            // Shareholder configuration
            modelBuilder.Entity<Shareholder>(entity =>
            {
                entity.ToTable("Shareholders");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.Name).IsRequired().HasMaxLength(255);
                entity.Property(e => e.ShareholderType).HasMaxLength(50);
                entity.Property(e => e.ShareClassName).HasMaxLength(50);
                entity.Property(e => e.SharesOwned);
                entity.Property(e => e.ShareCertificateNumber).HasMaxLength(50);
                entity.Property(e => e.Email).HasMaxLength(255);
                entity.Property(e => e.Address).HasMaxLength(1000);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.BankAccountName).HasMaxLength(255);
                entity.Property(e => e.BankSortCode).HasMaxLength(20);
                entity.Property(e => e.AccountNumber).HasMaxLength(50);
            });

            // DlaEntry configuration
            modelBuilder.Entity<DlaEntry>(entity =>
            {
                entity.ToTable("DlaEntries");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.DlaId).IsRequired().HasMaxLength(50);
                entity.Property(e => e.Direction).HasMaxLength(50);
                entity.Property(e => e.Description).IsRequired().HasMaxLength(500);
                entity.Property(e => e.CtTag).HasMaxLength(20);
                entity.Property(e => e.SourceBatchId).HasMaxLength(60);
                entity.Property(e => e.AmountNet).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.PaymentMethod).HasMaxLength(100);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.ReceiptUrl).HasMaxLength(500);
                entity.Property(e => e.PdfUrl).HasMaxLength(500);
                entity.Property(e => e.PeriodKey).HasMaxLength(20);
                entity.Property(e => e.TaxYear).HasMaxLength(50);
                entity.Property(e => e.FinancialYear).HasMaxLength(50);
                entity.HasIndex(e => e.DlaId).IsUnique();
                entity.HasIndex(e => e.PeriodKey);
                ConfigureForeignCurrency(entity);
            });

            // DlaPayment configuration
            modelBuilder.Entity<DlaPayment>(entity =>
            {
                entity.ToTable("DlaPayments");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.PaymentId).IsRequired().HasMaxLength(50);
                entity.Property(e => e.DlaId).IsRequired().HasMaxLength(50);
                entity.Property(e => e.Director).IsRequired().HasMaxLength(255);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.PaymentMethod).HasMaxLength(100);
                entity.Property(e => e.PaymentReference).HasMaxLength(255);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.ReceiptUrl).HasMaxLength(500);
                entity.Property(e => e.PeriodKey).HasMaxLength(20);
                entity.HasIndex(e => e.PaymentId).IsUnique();
                entity.HasIndex(e => e.DlaId);
                entity.HasIndex(e => e.PeriodKey);
            });

            // CompanySettings configuration
            modelBuilder.Entity<CompanySettings>(entity =>
            {
                entity.ToTable("CompanySettings");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.CompanyName).HasMaxLength(255);
                entity.Property(e => e.Address).HasMaxLength(1000);
                entity.Property(e => e.CompanyAddress).HasMaxLength(1000);
                entity.Property(e => e.PhoneNumber).HasMaxLength(50);
                entity.Property(e => e.CompanyPhone).HasMaxLength(50);
                entity.Property(e => e.Email).HasMaxLength(255);
                entity.Property(e => e.CompanyEmail).HasMaxLength(255);
                entity.Property(e => e.CompanyRegistrationNumber).HasMaxLength(50);
                entity.Property(e => e.TaxRegistrationNumber).HasMaxLength(50);
                entity.Property(e => e.Utr).HasMaxLength(20);
                entity.Property(e => e.VatRegistrationNumber).HasMaxLength(50);
                entity.Property(e => e.VATNumber).HasMaxLength(50);
                entity.Property(e => e.BankName).HasMaxLength(255);
                entity.Property(e => e.BankAccountNumber).HasMaxLength(50);
                entity.Property(e => e.AccountNumber).HasMaxLength(50);
                entity.Property(e => e.BankSortCode).HasMaxLength(20);
                entity.Property(e => e.SortCode).HasMaxLength(20);
                entity.Property(e => e.BankIBAN).HasMaxLength(100);
                entity.Property(e => e.BankSwiftCode).HasMaxLength(50);
                entity.Property(e => e.DefaultCurrency).HasMaxLength(10);
                entity.Property(e => e.CurrencySymbol).HasMaxLength(5);
                entity.Property(e => e.DefaultVATRate).HasMaxLength(10);
                entity.Property(e => e.InvoicePrefix).HasMaxLength(20);
                entity.Property(e => e.QuotePrefix).HasMaxLength(20);
                entity.Property(e => e.InvoiceTermsDays).HasMaxLength(10);
                entity.Property(e => e.PaymentTerms).HasMaxLength(255);
                entity.Property(e => e.InvoiceFooterText).HasMaxLength(2000);
                entity.Property(e => e.FooterText).HasMaxLength(2000);
                entity.Property(e => e.LogoUrl).HasMaxLength(500);
                entity.Property(e => e.InvoicesEmail).HasMaxLength(255);
                entity.Property(e => e.QuotesEmail).HasMaxLength(255);
                entity.Property(e => e.PaymentsEmail).HasMaxLength(255);
                entity.Property(e => e.SmtpServer).HasMaxLength(255);
                entity.Property(e => e.SmtpFromAddress).HasMaxLength(255);
                entity.Property(e => e.SmtpUsername).HasMaxLength(255);
                entity.Property(e => e.SmtpPassword).HasMaxLength(500);
                entity.Property(e => e.DirectorName).HasMaxLength(255);
                entity.Property(e => e.DirectorSignature).HasColumnType("nvarchar(max)");
                entity.Property(e => e.AuthorizedOfficerName).HasMaxLength(255);
                entity.Property(e => e.AuthorizedOfficerSignature).HasColumnType("nvarchar(max)");
                entity.Property(e => e.Directors).HasMaxLength(1000);
                entity.Property(e => e.PsaApproved);
                entity.Property(e => e.PsaContactName).HasMaxLength(255);
            });

            // FinanceHubSettings configuration
            modelBuilder.Entity<FinanceHubSettings>(entity =>
            {
                entity.ToTable("FinanceHubSettings");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.SmtpProvider).HasMaxLength(100);
                entity.Property(e => e.SmtpServer).HasMaxLength(255);
                entity.Property(e => e.SmtpUsername).HasMaxLength(255);
                entity.Property(e => e.SmtpPassword).HasMaxLength(500);
                entity.Property(e => e.SmtpFromAddress).HasMaxLength(255);
                entity.Property(e => e.SmtpFromName).HasMaxLength(255);
                entity.Property(e => e.PaymentGatewayApiKey).HasMaxLength(500);
                entity.Property(e => e.PaymentGatewayProvider).HasMaxLength(100);
                entity.Property(e => e.BlobStorageConnectionString).HasMaxLength(1000);
                entity.Property(e => e.InvoicesContainerName).HasMaxLength(100);
                entity.Property(e => e.ReceiptsContainerName).HasMaxLength(100);
                entity.Property(e => e.CertificatesContainerName).HasMaxLength(100);
                entity.Property(e => e.DefaultTimeZone).HasMaxLength(100);
                entity.Property(e => e.DateFormat).HasMaxLength(50);
                entity.Property(e => e.TimeFormat).HasMaxLength(50);
                entity.Property(e => e.MaintenanceMessage).HasMaxLength(1000);
                entity.Property(e => e.LastModifiedBy).HasMaxLength(255);
            });

            // Asset configuration
            modelBuilder.Entity<Asset>(entity =>
            {
                entity.ToTable("Assets");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.AssetId).HasMaxLength(50);
                entity.Property(e => e.Name).HasMaxLength(255);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.Description).HasMaxLength(2000);
                entity.Property(e => e.SerialNumber).HasMaxLength(255);
                entity.Property(e => e.Manufacturer).HasMaxLength(255);
                entity.Property(e => e.Model).HasMaxLength(255);
                entity.Property(e => e.SupplierId).HasMaxLength(50);
                entity.Property(e => e.SupplierName).HasMaxLength(255);
                entity.Property(e => e.AssignedToEmployeeId).HasMaxLength(50);
                entity.Property(e => e.AssignedToEmployeeName).HasMaxLength(255);
                entity.Property(e => e.Location).HasMaxLength(255);
                entity.Property(e => e.DepreciationMethod).HasMaxLength(50);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.DisposalMethod).HasMaxLength(50);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.InvoiceUrl).HasMaxLength(2048);
                entity.Property(e => e.PurchasePrice).HasColumnType("decimal(18,2)");
                entity.Property(e => e.ResidualValue).HasColumnType("decimal(18,2)");
                entity.Property(e => e.CurrentValue).HasColumnType("decimal(18,2)");
                entity.Property(e => e.DisposalValue).HasColumnType("decimal(18,2)");
                entity.HasIndex(e => e.AssetId);
                entity.HasIndex(e => e.Category);
                entity.HasIndex(e => e.Status);
            });

            // Subscription configuration
            modelBuilder.Entity<Subscription>(entity =>
            {
                entity.ToTable("Subscriptions");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.SubscriptionId).HasMaxLength(50);
                entity.Property(e => e.Name).HasMaxLength(255);
                entity.Property(e => e.Type).HasMaxLength(100);
                entity.Property(e => e.Vendor).HasMaxLength(255);
                entity.Property(e => e.AccountId).HasMaxLength(255);
                entity.Property(e => e.LicenseKey).HasMaxLength(255);
                entity.Property(e => e.BillingCycle).HasMaxLength(50);
                entity.Property(e => e.AssignedToEmployeeIds).HasMaxLength(2000);
                entity.Property(e => e.AdminContact).HasMaxLength(255);
                entity.Property(e => e.AdminEmail).HasMaxLength(255);
                entity.Property(e => e.LoginUrl).HasMaxLength(1000);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.CostPerCycle).HasColumnType("decimal(18,2)");
                entity.Property(e => e.MonthlyBudget).HasColumnType("decimal(18,2)");
                entity.HasIndex(e => e.SubscriptionId);
                entity.HasIndex(e => e.Type);
                entity.HasIndex(e => e.Status);
            });

            // BankAccount configuration
            modelBuilder.Entity<BankAccount>(entity =>
            {
                entity.ToTable("BankAccounts");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.AccountName).HasMaxLength(255);
                entity.Property(e => e.BankName).HasMaxLength(255);
                entity.Property(e => e.SortCode).HasMaxLength(20);
                entity.Property(e => e.AccountNumber).HasMaxLength(20);
                entity.Property(e => e.Currency).HasMaxLength(10);
                entity.Property(e => e.OpeningBalance).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.TrueLayerAccountId).HasMaxLength(255);
                entity.Property(e => e.TrueLayerProvider).HasMaxLength(255);
                entity.HasIndex(e => e.AccountName);
            });

            // BankTransaction configuration
            modelBuilder.Entity<BankTransaction>(entity =>
            {
                entity.Property(e => e.OriginalCurrency).HasMaxLength(3);
                entity.Property(e => e.OriginalAmount).HasColumnType("decimal(18,2)");
                entity.ToTable("BankTransactions");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.Description).HasMaxLength(2000);
                entity.Property(e => e.Reference).HasMaxLength(255);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.Direction).HasMaxLength(10);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Balance).HasColumnType("decimal(18,2)");
                entity.Property(e => e.ExternalId).HasMaxLength(255);
                entity.Property(e => e.Source).HasMaxLength(50);
                entity.Property(e => e.TrueLayerTransactionId).HasMaxLength(255);
                entity.Property(e => e.TrueLayerMerchantName).HasMaxLength(500);
                entity.Property(e => e.TrueLayerCategory).HasMaxLength(100);
                entity.Property(e => e.ReconciledBy).HasMaxLength(255);
                entity.HasIndex(e => e.BankAccountId);
                entity.HasIndex(e => e.TransactionDate);
                entity.HasIndex(e => e.ExternalId);
            });

            // ReconciliationRule configuration
            modelBuilder.Entity<ReconciliationRule>(entity =>
            {
                entity.ToTable("ReconciliationRules");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.Name).HasMaxLength(255);
                entity.Property(e => e.MatchText).HasMaxLength(500);
                entity.Property(e => e.Counterparty).HasMaxLength(255);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.AmountMin).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountMax).HasColumnType("decimal(18,2)");
                entity.HasIndex(e => e.IsActive);
            });

            // ReconciliationMatch configuration
            modelBuilder.Entity<ReconciliationMatch>(entity =>
            {
                entity.ToTable("ReconciliationMatches");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.RelatedType).HasMaxLength(50);
                entity.Property(e => e.RelatedId).HasMaxLength(100);
                entity.Property(e => e.MatchType).HasMaxLength(20);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.HasIndex(e => e.BankTransactionId);
            });

            // PayrollRun configuration
            modelBuilder.Entity<PayrollRun>(entity =>
            {
                entity.ToTable("PayrollRuns");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.Frequency).HasMaxLength(50);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.TaxYear).HasMaxLength(10);
                entity.Property(e => e.FpsStatus).HasMaxLength(50);
                entity.Property(e => e.FpsCorrelationId).HasMaxLength(100);
                entity.Property(e => e.TotalGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.TotalTax).HasColumnType("decimal(18,2)");
                entity.Property(e => e.TotalEmployeeNi).HasColumnType("decimal(18,2)");
                entity.Property(e => e.TotalEmployerNi).HasColumnType("decimal(18,2)");
                entity.Property(e => e.TotalNetPay).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.HasIndex(e => e.PayDate);
                entity.HasIndex(e => new { e.TaxYear, e.TaxMonth });
            });

            // Payslip configuration
            modelBuilder.Entity<Payslip>(entity =>
            {
                entity.ToTable("Payslips");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.EmployeeName).HasMaxLength(255);
                entity.Property(e => e.TaxCode).HasMaxLength(20);
                entity.Property(e => e.NiCategory).HasMaxLength(10);
                entity.Property(e => e.NiNumber).HasMaxLength(20);
                entity.Property(e => e.TaxYear).HasMaxLength(10);
                entity.Property(e => e.StarterDeclaration).HasMaxLength(5);
                entity.Property(e => e.DirectorsNiMethod).HasMaxLength(10);
                entity.Property(e => e.PaymentReference).HasMaxLength(100);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.GrossPay).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Tax).HasColumnType("decimal(18,2)");
                entity.Property(e => e.NationalInsurance).HasColumnType("decimal(18,2)");
                entity.Property(e => e.EmployerNi).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Pension).HasColumnType("decimal(18,2)");
                entity.Property(e => e.NetPay).HasColumnType("decimal(18,2)");
                entity.Property(e => e.YtdGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.YtdTax).HasColumnType("decimal(18,2)");
                entity.Property(e => e.YtdEmployeeNi).HasColumnType("decimal(18,2)");
                entity.Property(e => e.YtdEmployerNi).HasColumnType("decimal(18,2)");
                entity.HasIndex(e => e.PayrollRunId);
                entity.HasIndex(e => e.EmployeeId);
            });

            // PayrollSettings configuration
            modelBuilder.Entity<PayrollSettings>(entity =>
            {
                entity.ToTable("PayrollSettings");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.EmployerPAYEReference).HasMaxLength(50);
                entity.Property(e => e.AccountsOfficeReference).HasMaxLength(50);
                entity.Property(e => e.PensionProvider).HasMaxLength(255);
                entity.Property(e => e.DefaultTaxCode).HasMaxLength(20);
                entity.Property(e => e.DefaultNiCategory).HasMaxLength(10);
            });

            // VatReturn configuration
            modelBuilder.Entity<VatReturn>(entity =>
            {
                entity.ToTable("VatReturns");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.QuarterLabel).HasMaxLength(50);
                entity.Property(e => e.MonthsLabel).HasMaxLength(100);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.Reference).HasMaxLength(255);
                entity.Property(e => e.VatIn).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatOut).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VatOwed).HasColumnType("decimal(18,2)");
            });

            // HmrcToken configuration
            modelBuilder.Entity<HmrcToken>(entity =>
            {
                entity.ToTable("HmrcTokens");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.AccessToken).IsRequired();
                entity.Property(e => e.Scope).HasMaxLength(500);
            });

            modelBuilder.Entity<MileageTrip>(entity =>
            {
                entity.ToTable("MileageTrips");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.TripId).IsRequired().HasMaxLength(50);
                entity.HasIndex(e => e.TripId).IsUnique();
                entity.Property(e => e.Director).IsRequired().HasMaxLength(100);
                entity.Property(e => e.StartLocation).IsRequired().HasMaxLength(500);
                entity.Property(e => e.EndLocation).IsRequired().HasMaxLength(500);
                entity.Property(e => e.Miles).HasColumnType("decimal(8,2)");
                entity.Property(e => e.Purpose).IsRequired().HasMaxLength(500);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.TaxYear).IsRequired().HasMaxLength(10);
                entity.Property(e => e.Status).IsRequired().HasMaxLength(20);
                entity.Property(e => e.MilesAt45p).HasColumnType("decimal(8,2)");
                entity.Property(e => e.MilesAt25p).HasColumnType("decimal(8,2)");
                entity.Property(e => e.AmountAt45p).HasColumnType("decimal(10,2)");
                entity.Property(e => e.AmountAt25p).HasColumnType("decimal(10,2)");
                entity.Property(e => e.TotalAmount).HasColumnType("decimal(10,2)");
                entity.Property(e => e.MapLink).HasMaxLength(1000);
                entity.Property(e => e.Notes).HasMaxLength(1000);
            });

            modelBuilder.Entity<MileageClaim>(entity =>
            {
                entity.ToTable("MileageClaims");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.ClaimRef).IsRequired().HasMaxLength(50);
                entity.HasIndex(e => e.ClaimRef).IsUnique();
                entity.Property(e => e.Director).IsRequired().HasMaxLength(100);
                entity.Property(e => e.TaxYear).IsRequired().HasMaxLength(10);
                entity.Property(e => e.TotalMiles).HasColumnType("decimal(8,2)");
                entity.Property(e => e.MilesAt45p).HasColumnType("decimal(8,2)");
                entity.Property(e => e.MilesAt25p).HasColumnType("decimal(8,2)");
                entity.Property(e => e.TotalAmount).HasColumnType("decimal(10,2)");
                entity.Property(e => e.Status).IsRequired().HasMaxLength(20);
                entity.Property(e => e.Notes).HasMaxLength(1000);
            });

            // BikEntry (P11D Benefits in Kind) configuration
            modelBuilder.Entity<BikEntry>(entity =>
            {
                entity.ToTable("BikEntries");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.TaxYear).IsRequired().HasMaxLength(10);
                entity.Property(e => e.RecipientName).IsRequired().HasMaxLength(255);
                entity.Property(e => e.RecipientType).HasMaxLength(20).HasDefaultValue("Director");
                entity.Property(e => e.BenefitCategory).IsRequired().HasMaxLength(100);
                entity.Property(e => e.Description).HasMaxLength(500);
                entity.Property(e => e.CashEquivalent).HasColumnType("decimal(18,2)");
                entity.Property(e => e.IsExempt).HasDefaultValue(false);
                entity.Property(e => e.ExemptionReason).HasMaxLength(255);
                entity.Property(e => e.P11DSection).HasMaxLength(5);
                entity.Property(e => e.TotalEventCost).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Notes).HasMaxLength(1000);
                entity.HasIndex(e => e.TaxYear);
                entity.HasIndex(e => e.RecipientName);
            });

            // DividendDeclaration configuration
            modelBuilder.Entity<DividendDeclaration>(entity =>
            {
                entity.ToTable("DividendDeclarations");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.DividendRef).IsRequired().HasMaxLength(50);
                entity.Property(e => e.DividendType).HasMaxLength(50);
                entity.Property(e => e.ShareClass).HasMaxLength(50);
                entity.Property(e => e.MeetingLocation).HasMaxLength(255);
                entity.Property(e => e.AmountPerShare).HasColumnType("decimal(18,4)");
                entity.Property(e => e.TotalAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.DirectorName).HasMaxLength(255);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Ignore(e => e.Allocations);
                entity.HasIndex(e => e.DividendRef);
                entity.HasIndex(e => e.Status);
            });

            // DividendAllocation configuration
            modelBuilder.Entity<DividendAllocation>(entity =>
            {
                entity.ToTable("DividendAllocations");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.ShareholderName).IsRequired().HasMaxLength(255);
                entity.Property(e => e.ShareClass).HasMaxLength(50);
                entity.Property(e => e.AmountPerShare).HasColumnType("decimal(18,4)");
                entity.Property(e => e.TotalAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.BankAccountName).HasMaxLength(255);
                entity.Property(e => e.SortCode).HasMaxLength(20);
                entity.Property(e => e.AccountNumber).HasMaxLength(50);
                entity.Property(e => e.VoucherRef).HasMaxLength(50);
                entity.HasIndex(e => e.DividendDeclarationId);
            });

            // MissingReceiptDeclaration configuration
            modelBuilder.Entity<MissingReceiptDeclaration>(entity =>
            {
                entity.ToTable("MissingReceiptDeclarations");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.DeclarationId).HasMaxLength(50);
                entity.HasIndex(e => e.DeclarationId).IsUnique();
                entity.Property(e => e.ExpenseId).IsRequired(false);
                entity.HasIndex(e => e.ExpenseId);
                entity.Property(e => e.DlaEntryId).IsRequired(false);
                entity.HasIndex(e => e.DlaEntryId);
                entity.Property(e => e.DeclarerName).HasMaxLength(200);
                entity.Property(e => e.DeclarerRole).HasMaxLength(100);
                entity.Property(e => e.DeclarerEmail).HasMaxLength(256);
                entity.Property(e => e.AmountGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Currency).HasMaxLength(10).HasDefaultValue("GBP");
                entity.Property(e => e.MerchantOrPayee).HasMaxLength(200);
                entity.Property(e => e.BankTransactionRef).HasMaxLength(100);
                entity.Property(e => e.ExpenseCategory).HasMaxLength(100);
                entity.Property(e => e.Description).HasMaxLength(1000);
                entity.Property(e => e.OtherReasonText).HasMaxLength(500);
                entity.Property(e => e.VatAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.TypedSignature).HasMaxLength(200);
                entity.Property(e => e.PdfBlobRef).HasMaxLength(500);
                entity.Property(e => e.HashSha256).HasMaxLength(64);
                entity.Property(e => e.VoidedReason).HasMaxLength(500);
                entity.Property(e => e.DeclarationType).HasConversion<string>();
                entity.Property(e => e.ReasonReceiptMissing).HasConversion<string>();
                entity.Property(e => e.SignatureType).HasConversion<string>();
                entity.Property(e => e.Status).HasConversion<string>();
            });

            // ExpenseAuditEvent configuration
            modelBuilder.Entity<ExpenseAuditEvent>(entity =>
            {
                entity.ToTable("ExpenseAuditEvents");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ExpenseId);
                entity.Property(e => e.ActorName).HasMaxLength(200);
                entity.Property(e => e.ActorEmail).HasMaxLength(256);
                entity.Property(e => e.Details).HasMaxLength(2000);
                entity.Property(e => e.EventType).HasConversion<string>();
            });

            // Expense — add new columns (nullable, so no migration data needed)
            modelBuilder.Entity<Expense>(entity =>
            {
                entity.Property(e => e.HasMissingReceiptDeclaration).HasDefaultValue(false);
                entity.Property(e => e.MissingReceiptDeclarationRef).HasMaxLength(50);
            });

            // DlaEntry — declaration tracking columns
            modelBuilder.Entity<DlaEntry>(entity =>
            {
                entity.Property(e => e.HasMissingReceiptDeclaration).HasDefaultValue(false);
                entity.Property(e => e.MissingReceiptDeclarationRef).HasMaxLength(50);
            });

            // Seed default settings
            modelBuilder.Entity<CompanySettings>().HasData(
                new CompanySettings
                {
                    Id = 1,
                    CompanyName = "Default Company",
                    DefaultCurrency = "GBP",
                    CurrencySymbol = "£",
                    FYStartMonth = 4,
                    FYStartDay = 1,
                    NextInvoiceNumber = 1,
                    NextQuoteNumber = 1
                }
            );

            modelBuilder.Entity<FinanceHubSettings>().HasData(
                new FinanceHubSettings
                {
                    Id = 1,
                    InvoicesContainerName = "invoices",
                    ReceiptsContainerName = "receipts",
                    CertificatesContainerName = "certificates",
                    DefaultTimeZone = "GMT Standard Time",
                    DateFormat = "dd/MM/yyyy",
                    TimeFormat = "HH:mm",
                    SessionTimeoutMinutes = 60,
                    MaintenanceMode = false
                }
            );

            // CreditNote configuration
            modelBuilder.Entity<CreditNote>(entity =>
            {
                entity.ToTable("CreditNotes");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.CreditNoteNumber).HasMaxLength(50).IsRequired();
                entity.Property(e => e.CustomerId).HasMaxLength(50);
                entity.Property(e => e.CustomerName).HasMaxLength(255);
                entity.Property(e => e.CustomerEmail).HasMaxLength(255);
                entity.Property(e => e.OriginalInvoiceNumber).HasMaxLength(50);
                entity.Property(e => e.AppliedToInvoiceNumber).HasMaxLength(50);
                entity.Property(e => e.Reason).HasMaxLength(2000);
                entity.Property(e => e.ReasonCategory).HasMaxLength(50);
                entity.Property(e => e.AmountNet).HasPrecision(18, 2);
                entity.Property(e => e.VATRate).HasPrecision(5, 2);
                entity.Property(e => e.VATAmount).HasPrecision(18, 2);
                entity.Property(e => e.AmountGross).HasPrecision(18, 2);
                entity.Property(e => e.Currency).HasMaxLength(3);
                entity.Property(e => e.Status).HasMaxLength(20);
                entity.Property(e => e.PdfUrl).HasMaxLength(1000);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.FinancialYear).HasMaxLength(20);
                entity.HasIndex(e => e.CreditNoteNumber).IsUnique();
                entity.HasIndex(e => e.CustomerId);
                entity.HasIndex(e => e.Status);
            });

            // TeamMembers
            modelBuilder.Entity<TeamMember>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Email).IsRequired().HasMaxLength(256);
                entity.Property(e => e.ClerkUserId).HasMaxLength(200);
                entity.Property(e => e.DisplayName).HasMaxLength(200);
                entity.Property(e => e.Role).IsRequired().HasMaxLength(50).HasDefaultValue("Employee");
                entity.Property(e => e.Status).IsRequired().HasMaxLength(50).HasDefaultValue("Invited");
                entity.Property(e => e.InviteToken).HasMaxLength(200);
                entity.Property(e => e.InvitedBy).HasMaxLength(200);
                entity.HasIndex(e => e.ClerkUserId);
                entity.HasIndex(e => e.CompanyId);
                entity.HasIndex(e => e.InviteToken);
                entity.HasIndex(e => new { e.Email, e.CompanyId }).IsUnique();
            });

            // Accountants
            modelBuilder.Entity<Accountant>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Email).IsRequired().HasMaxLength(256);
                entity.Property(e => e.ClerkUserId).HasMaxLength(200);
                entity.Property(e => e.Name).IsRequired().HasMaxLength(200).HasDefaultValue("");
                entity.Property(e => e.FirmName).HasMaxLength(300);
                entity.Property(e => e.Status).IsRequired().HasMaxLength(50).HasDefaultValue("Invited");
                entity.HasIndex(e => e.ClerkUserId);
                entity.HasIndex(e => e.Email).IsUnique();
            });

            // CompanyAccountants (junction: Company ↔ Accountant)
            modelBuilder.Entity<CompanyAccountant>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.AccessLevel).IsRequired().HasMaxLength(50).HasDefaultValue("ReadOnly");
                entity.Property(e => e.InviteToken).HasMaxLength(200);
                entity.Property(e => e.InvitedBy).HasMaxLength(200);
                entity.Property(e => e.Status).IsRequired().HasMaxLength(50).HasDefaultValue("Invited");
                entity.HasIndex(e => e.AccountantId);
                entity.HasIndex(e => e.CompanyId);
                entity.HasIndex(e => e.InviteToken);
                entity.HasIndex(e => new { e.CompanyId, e.AccountantId }).IsUnique();
            });

            // RecurringInvoiceTemplate configuration
            modelBuilder.Entity<RecurringInvoiceTemplate>(entity =>
            {
                entity.ToTable("RecurringInvoiceTemplates");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.CustomerId).HasMaxLength(50);
                entity.Property(e => e.CustomerName).HasMaxLength(255);
                entity.Property(e => e.BillingEmail).HasMaxLength(255);
                entity.Property(e => e.POReference).HasMaxLength(255);
                entity.Property(e => e.VatNumber).HasMaxLength(50);
                entity.Property(e => e.Frequency).HasMaxLength(20);
                entity.Property(e => e.Notes).HasMaxLength(2000);
                entity.Property(e => e.DiscountPercent).HasColumnType("decimal(5,2)");
                entity.Property(e => e.DiscountAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.DiscountNote).HasMaxLength(500);
                entity.Property(e => e.DefaultLineItems)
                    .HasColumnType("nvarchar(max)")
                    .HasConversion(
                        v => v == null || v.Count == 0 ? null : System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                        v => string.IsNullOrEmpty(v) ? new List<InvoiceLine>() : System.Text.Json.JsonSerializer.Deserialize<List<InvoiceLine>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new List<InvoiceLine>()
                    );
                entity.HasIndex(e => e.IsActive);
                entity.HasIndex(e => e.NextRunDate);
            });

            // CategorizationRule configuration
            modelBuilder.Entity<CategorizationRule>(entity =>
            {
                entity.ToTable("CategorizationRules");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.Name).HasMaxLength(255);
                entity.Property(e => e.MatchPattern).HasMaxLength(500);
                entity.Property(e => e.MatchField).HasMaxLength(50);
                entity.Property(e => e.Direction).HasMaxLength(10);
                entity.Property(e => e.AmountMin).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountMax).HasColumnType("decimal(18,2)");
                entity.Property(e => e.TargetCategory).HasMaxLength(100);
                entity.HasIndex(e => e.IsActive);
                entity.HasIndex(e => e.Priority);
            });

            // GoCardless Mandate configuration
            modelBuilder.Entity<GoCardlessMandate>(entity =>
            {
                entity.ToTable("GoCardlessMandates");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.CustomerId).HasMaxLength(50);
                entity.Property(e => e.CustomerName).HasMaxLength(255);
                entity.Property(e => e.GoCardlessMandateId).HasMaxLength(100);
                entity.Property(e => e.GoCardlessCustomerId).HasMaxLength(100);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.Scheme).HasMaxLength(20);
                entity.Property(e => e.BankAccountHolder).HasMaxLength(255);
                entity.Property(e => e.BankAccountEndDigits).HasMaxLength(10);
                entity.Property(e => e.Reference).HasMaxLength(100);
                entity.HasIndex(e => e.CustomerId);
                entity.HasIndex(e => e.GoCardlessMandateId);
                entity.HasIndex(e => e.Status);
            });

            // GoCardless Payment configuration
            modelBuilder.Entity<GoCardlessPayment>(entity =>
            {
                entity.ToTable("GoCardlessPayments");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.InvoiceNumber).HasMaxLength(50);
                entity.Property(e => e.GoCardlessPaymentId).HasMaxLength(100);
                entity.Property(e => e.GoCardlessMandateId).HasMaxLength(100);
                entity.Property(e => e.Amount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.Currency).HasMaxLength(10);
                entity.Property(e => e.Description).HasMaxLength(500);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.FailureReason).HasMaxLength(500);
                entity.HasIndex(e => e.InvoiceId);
                entity.HasIndex(e => e.GoCardlessPaymentId);
                entity.HasIndex(e => e.Status);
            });

            // Bill / Accounts Payable configuration
            modelBuilder.Entity<Bill>(entity =>
            {
                entity.ToTable("Bills");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).ValueGeneratedOnAdd();
                entity.Property(e => e.BillNumber).HasMaxLength(50);
                entity.Property(e => e.SupplierId).HasMaxLength(50);
                entity.Property(e => e.SupplierName).HasMaxLength(255);
                entity.Property(e => e.SupplierReference).HasMaxLength(100);
                entity.Property(e => e.Status).HasMaxLength(50);
                entity.Property(e => e.AmountNet).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VATAmount).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountGross).HasColumnType("decimal(18,2)");
                entity.Property(e => e.AmountPaid).HasColumnType("decimal(18,2)");
                entity.Property(e => e.VATApplicability).HasMaxLength(50);
                entity.Property(e => e.Currency).HasMaxLength(10);
                entity.Property(e => e.Category).HasMaxLength(100);
                entity.Property(e => e.CtTag).HasMaxLength(20);
                entity.Property(e => e.PaymentMethod).HasMaxLength(100);
                entity.Property(e => e.TaxYear).HasMaxLength(20);
                entity.Property(e => e.FinancialYear).HasMaxLength(20);
                entity.Property(e => e.DocumentUrl).HasMaxLength(2048);
                entity.Property(e => e.PaymentReference).HasMaxLength(100);
                entity.Property(e => e.RecurringFrequency).HasMaxLength(50);
                entity.Property(e => e.ApprovedBy).HasMaxLength(255);

                entity.Property(e => e.LineItems).HasConversion(
                    v => System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                    v => System.Text.Json.JsonSerializer.Deserialize<System.Collections.Generic.List<BillLine>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new()
                );
                entity.Property(e => e.Attachments).HasConversion(
                    v => v == null ? null : System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                    v => v == null ? null : System.Text.Json.JsonSerializer.Deserialize<System.Collections.Generic.List<string>>(v, (System.Text.Json.JsonSerializerOptions?)null)
                );

                entity.HasIndex(e => e.Status);
                entity.HasIndex(e => e.SupplierId);
                entity.HasIndex(e => e.DueDate);
                entity.HasIndex(e => e.BillNumber);
            });
        }
    }
}
