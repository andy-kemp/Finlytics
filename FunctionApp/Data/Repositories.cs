using Microsoft.EntityFrameworkCore;
using FinanceHubFunctions.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace FinanceHubFunctions.Data
{
    public class CustomerRepository : ICustomerRepository
    {
        private readonly FinanceHubDbContext _context;

        public CustomerRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Customer>> GetAllAsync()
        {
            return await _context.Customers.ToListAsync();
        }

        public async Task<Customer?> GetByIdAsync(string id)
        {
            return await _context.Customers.FindAsync(id);
        }

        public async Task<Customer?> GetByCodeAsync(string code)
        {
            return await _context.Customers.FirstOrDefaultAsync(c => c.Code == code);
        }

        public async Task<Customer> CreateAsync(Customer customer)
        {
            _context.Customers.Add(customer);
            await _context.SaveChangesAsync();
            return customer;
        }

        public async Task<Customer> UpdateAsync(Customer customer)
        {
            _context.Customers.Update(customer);
            await _context.SaveChangesAsync();
            return customer;
        }

        public async Task DeleteAsync(string id)
        {
            var customer = await GetByIdAsync(id);
            if (customer != null)
            {
                _context.Customers.Remove(customer);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class SupplierRepository : ISupplierRepository
    {
        private readonly FinanceHubDbContext _context;

        public SupplierRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Supplier>> GetAllAsync()
        {
            return await _context.Suppliers.AsNoTracking().ToListAsync();
        }

        public async Task<Supplier?> GetByIdAsync(string id)
        {
            return await _context.Suppliers.FindAsync(id);
        }

        public async Task<Supplier?> GetByCodeAsync(string code)
        {
            return await _context.Suppliers.FirstOrDefaultAsync(s => s.Code == code);
        }

        public async Task<Supplier> CreateAsync(Supplier supplier)
        {
            _context.Suppliers.Add(supplier);
            await _context.SaveChangesAsync();
            return supplier;
        }

        public async Task<Supplier> UpdateAsync(Supplier supplier)
        {
            _context.Suppliers.Update(supplier);
            await _context.SaveChangesAsync();
            return supplier;
        }

        public async Task DeleteAsync(string id)
        {
            var supplier = await GetByIdAsync(id);
            if (supplier != null)
            {
                _context.Suppliers.Remove(supplier);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class InvoiceRepository : IInvoiceRepository
    {
        private readonly FinanceHubDbContext _context;

        public InvoiceRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Invoice>> GetAllAsync()
        {
            return await _context.Invoices.OrderByDescending(i => i.DateIssued).ToListAsync();
        }

        public async Task<Invoice?> GetByIdAsync(int id)
        {
            return await _context.Invoices.FindAsync(id);
        }

        public async Task<Invoice?> GetByInvoiceNumberAsync(string invoiceNumber)
        {
            return await _context.Invoices.FirstOrDefaultAsync(i => i.InvoiceNumber == invoiceNumber);
        }

        public async Task<IEnumerable<Invoice>> GetByFinancialYearAsync(string financialYear)
        {
            return await _context.Invoices
                .Where(i => i.FinancialYear == financialYear)
                .OrderByDescending(i => i.DateIssued)
                .ToListAsync();
        }

        public async Task<IEnumerable<Invoice>> GetByStatusAsync(string status)
        {
            return await _context.Invoices
                .Where(i => i.Status == status)
                .OrderByDescending(i => i.DateIssued)
                .ToListAsync();
        }

        public async Task<IEnumerable<Invoice>> GetOverdueAsync()
        {
            var today = DateTime.UtcNow.Date;
            // Invoices that are Issued (sent to customer) with a DueDate in the past
            // and either never reminded or last reminded more than 7 days ago
            return await _context.Invoices
                .Where(i => i.Status == "Issued"
                    && i.DueDate.HasValue
                    && i.DueDate.Value.Date < today
                    && (i.ReminderSentAt == null || i.ReminderSentAt.Value.Date <= today.AddDays(-7)))
                .OrderBy(i => i.DueDate)
                .ToListAsync();
        }

        public async Task<Invoice> CreateAsync(Invoice invoice)
        {
            _context.Invoices.Add(invoice);
            await _context.SaveChangesAsync();
            return invoice;
        }

        public async Task<Invoice> UpdateAsync(Invoice invoice)
        {
            var existingInvoice = await _context.Invoices.FindAsync(invoice.Id);
            if (existingInvoice != null)
            {
                _context.Entry(existingInvoice).CurrentValues.SetValues(invoice);
                existingInvoice.LineItems = invoice.LineItems;
                
                // Explicitly mark LineItems as modified to ensure EF Core persists changes
                _context.Entry(existingInvoice).Property(e => e.LineItems).IsModified = true;
                
                await _context.SaveChangesAsync();
                return existingInvoice;
            }
            
            _context.Invoices.Update(invoice);
            await _context.SaveChangesAsync();
            return invoice;
        }

        public async Task DeleteAsync(int id)
        {
            var invoice = await GetByIdAsync(id);
            if (invoice != null)
            {
                _context.Invoices.Remove(invoice);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class ExpenseRepository : IExpenseRepository
    {
        private readonly FinanceHubDbContext _context;

        public ExpenseRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Expense>> GetAllAsync()
        {
            return await _context.Expenses.AsNoTracking().OrderByDescending(e => e.EntryDate).ToListAsync();
        }

        public async Task<Expense?> GetByIdAsync(int id)
        {
            return await _context.Expenses.FindAsync(id);
        }

        public async Task<IEnumerable<Expense>> GetByFinancialYearAsync(string financialYear)
        {
            return await _context.Expenses
                .Where(e => e.FinancialYear == financialYear)
                .OrderByDescending(e => e.EntryDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<Expense>> GetByCategoryAsync(string category)
        {
            return await _context.Expenses
                .Where(e => e.Category == category)
                .OrderByDescending(e => e.EntryDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<Expense>> GetDueRecurringAsync()
        {
            var today = DateTime.UtcNow.Date;
            return await _context.Expenses
                .Where(e => e.IsRecurring
                    && e.RecurringNextDate.HasValue
                    && e.RecurringNextDate.Value.Date <= today)
                .OrderBy(e => e.RecurringNextDate)
                .ToListAsync();
        }

        public async Task<Expense> CreateAsync(Expense expense)
        {
            _context.Expenses.Add(expense);
            await _context.SaveChangesAsync();
            return expense;
        }

        public async Task<Expense> UpdateAsync(Expense expense)
        {
            _context.Expenses.Update(expense);
            await _context.SaveChangesAsync();
            return expense;
        }

        public async Task<bool> MarkDeclarationFiledAsync(int id, string declarationRef)
        {
            // Direct SQL UPDATE — avoids EF Core change-tracker conflicts after SaveChangesAsync in same request
            var updated = await _context.Expenses
                .Where(e => e.Id == id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(e => e.HasMissingReceiptDeclaration, true)
                    .SetProperty(e => e.MissingReceiptDeclarationRef, declarationRef)
                    .SetProperty(e => e.VATAmount, 0m)
                    .SetProperty(e => e.VATRate, 0m)
                    .SetProperty(e => e.VATIncluded, false)
                    .SetProperty(e => e.AmountNet, e => e.AmountGross));
            return updated > 0;
        }

        public async Task DeleteAsync(int id)
        {
            var expense = await GetByIdAsync(id);
            if (expense != null)
            {
                _context.Expenses.Remove(expense);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class DlaRepository : IDlaRepository
    {
        private readonly FinanceHubDbContext _context;

        public DlaRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<DlaEntry>> GetAllAsync()
        {
            return await _context.DlaEntries.AsNoTracking().OrderByDescending(d => d.EntryDate).ToListAsync();
        }

        public async Task<DlaEntry?> GetByIdAsync(int id)
        {
            return await _context.DlaEntries.FindAsync(id);
        }

        public async Task<string> GenerateNextDlaIdAsync()
        {
            var currentYear = DateTime.Now.Year;
            var yearStr = currentYear.ToString();

            // Find the highest existing DLA number for this year (OrderByDescending on zero-padded string is safe)
            var lastDla = await _context.DlaEntries
                .AsNoTracking()
                .Where(d => d.DlaId != null && d.DlaId.StartsWith($"DLA-{yearStr}-"))
                .OrderByDescending(d => d.DlaId)
                .FirstOrDefaultAsync();

            int nextNumber = 1;
            if (lastDla != null && !string.IsNullOrEmpty(lastDla.DlaId))
            {
                // Extract number from DLA-2026-0001 format
                var parts = lastDla.DlaId.Split('-');
                if (parts.Length == 3 && int.TryParse(parts[2], out int lastNumber))
                {
                    nextNumber = lastNumber + 1;
                }
            }

            // Skip any IDs that already exist (handles gaps from deletion or concurrent inserts)
            string candidate;
            do
            {
                candidate = $"DLA-{yearStr}-{nextNumber:D4}";
                var alreadyExists = await _context.DlaEntries.AsNoTracking().AnyAsync(d => d.DlaId == candidate);
                if (!alreadyExists) break;
                nextNumber++;
            } while (true);

            return candidate;
        }

        public async Task<IEnumerable<DlaEntry>> GetByPeriodKeyAsync(string periodKey)
        {
            return await _context.DlaEntries
                .AsNoTracking()
                .Where(d => d.PeriodKey == periodKey)
                .OrderByDescending(d => d.EntryDate)
                .ToListAsync();
        }

        public async Task<DlaEntry?> GetByDlaIdAsync(string dlaId)
        {
            return await _context.DlaEntries
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.DlaId == dlaId);
        }

        public async Task<IEnumerable<DlaEntry>> GetByFinancialYearAsync(string financialYear)
        {
            return await _context.DlaEntries
                .AsNoTracking()
                .Where(d => d.FinancialYear == financialYear)
                .OrderByDescending(d => d.EntryDate)
                .ToListAsync();
        }

        public async Task<DlaEntry> CreateAsync(DlaEntry dlaEntry)
        {
            _context.DlaEntries.Add(dlaEntry);
            await _context.SaveChangesAsync();
            return dlaEntry;
        }

        public async Task<DlaEntry> UpdateAsync(DlaEntry dlaEntry)
        {
            _context.DlaEntries.Update(dlaEntry);
            await _context.SaveChangesAsync();
            return dlaEntry;
        }

        public async Task<bool> MarkDeclarationFiledAsync(int id, string declarationRef)
        {
            // Direct SQL UPDATE — avoids EF Core change-tracker conflicts after SaveChangesAsync in same request
            var updated = await _context.DlaEntries
                .Where(e => e.Id == id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(e => e.HasMissingReceiptDeclaration, true)
                    .SetProperty(e => e.MissingReceiptDeclarationRef, declarationRef)
                    .SetProperty(e => e.VatAmount, 0m)
                    .SetProperty(e => e.AmountNet, e => e.AmountGross)  // Gross IS the cost — VAT not reclaimable
                    .SetProperty(e => e.ModifiedDate, DateTime.UtcNow));
            return updated > 0;
        }

        public async Task DeleteAsync(int id)
        {
            var dlaEntry = await GetByIdAsync(id);
            if (dlaEntry != null)
            {
                _context.DlaEntries.Remove(dlaEntry);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class DlaPaymentRepository : IDlaPaymentRepository
    {
        private readonly FinanceHubDbContext _context;

        public DlaPaymentRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<List<DlaPayment>> GetAllAsync()
        {
            return await _context.DlaPayments
                .AsNoTracking()
                .OrderByDescending(p => p.PaymentDate)
                .ToListAsync();
        }

        public async Task<List<DlaPayment>> GetByDlaIdAsync(string dlaId)
        {
            return await _context.DlaPayments
                .AsNoTracking()
                .Where(p => p.DlaId == dlaId)
                .OrderByDescending(p => p.PaymentDate)
                .ToListAsync();
        }

        public async Task<DlaPayment?> GetByIdAsync(int id)
        {
            return await _context.DlaPayments.FindAsync(id);
        }

        public async Task<DlaPayment> CreateAsync(DlaPayment payment)
        {
            _context.DlaPayments.Add(payment);
            await _context.SaveChangesAsync();
            return payment;
        }

        public async Task<DlaPayment> UpdateAsync(DlaPayment payment)
        {
            _context.DlaPayments.Update(payment);
            await _context.SaveChangesAsync();
            return payment;
        }

        public async Task DeleteAsync(int id)
        {
            var payment = await GetByIdAsync(id);
            if (payment != null)
            {
                _context.DlaPayments.Remove(payment);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<string> GenerateNextPaymentIdAsync()
        {
            var currentYear = DateTime.Now.Year;
            var yearStr = currentYear.ToString();
            
            // Find the highest payment number for this year
            var lastPayment = await _context.DlaPayments
                .Where(p => p.PaymentId!.StartsWith($"DLA-PAY-{yearStr}-"))
                .OrderByDescending(p => p.PaymentId)
                .FirstOrDefaultAsync();

            int nextNumber = 1;
            if (lastPayment != null && !string.IsNullOrEmpty(lastPayment.PaymentId))
            {
                // Extract number from DLA-PAY-2026-0001 format
                var parts = lastPayment.PaymentId.Split('-');
                if (parts.Length == 4 && int.TryParse(parts[3], out int lastNumber))
                {
                    nextNumber = lastNumber + 1;
                }
            }

            return $"DLA-PAY-{yearStr}-{nextNumber:D4}";
        }

        public async Task<List<DlaPayment>> GetByPeriodAsync(string periodKey)
        {
            return await _context.DlaPayments
                .AsNoTracking()
                .Where(p => p.PeriodKey == periodKey)
                .OrderByDescending(p => p.PaymentDate)
                .ToListAsync();
        }

        public async Task<decimal> GetTotalPaymentsForDlaAsync(string dlaId)
        {
            return await _context.DlaPayments
                .Where(p => p.DlaId == dlaId)
                .SumAsync(p => p.Amount);
        }
    }

    public class QuoteRepository : IQuoteRepository
    {
        private readonly FinanceHubDbContext _context;

        public QuoteRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Quote>> GetAllAsync()
        {
            return await _context.Quotes.OrderByDescending(q => q.DateIssued).ToListAsync();
        }

        public async Task<Quote?> GetByIdAsync(int id)
        {
            return await _context.Quotes.FindAsync(id);
        }

        public async Task<Quote?> GetByQuoteNumberAsync(string quoteNumber)
        {
            return await _context.Quotes.FirstOrDefaultAsync(q => q.QuoteNumber == quoteNumber);
        }

        public async Task<IEnumerable<Quote>> GetByStatusAsync(string status)
        {
            return await _context.Quotes
                .Where(q => q.Status == status)
                .OrderByDescending(q => q.DateIssued)
                .ToListAsync();
        }

        public async Task<Quote> CreateAsync(Quote quote)
        {
            _context.Quotes.Add(quote);
            await _context.SaveChangesAsync();
            return quote;
        }

        public async Task<Quote> UpdateAsync(Quote quote)
        {
            var existingQuote = await _context.Quotes.FindAsync(quote.Id);
            if (existingQuote != null)
            {
                _context.Entry(existingQuote).CurrentValues.SetValues(quote);
                existingQuote.LineItems = quote.LineItems;
                _context.Entry(existingQuote).Property(e => e.LineItems).IsModified = true;
                await _context.SaveChangesAsync();
            }
            return quote;
        }

        public async Task DeleteAsync(int id)
        {
            var quote = await GetByIdAsync(id);
            if (quote != null)
            {
                _context.Quotes.Remove(quote);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class CompanyLedgerRepository : ICompanyLedgerRepository
    {
        private readonly FinanceHubDbContext _context;

        public CompanyLedgerRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<CompanyLedgerEntry>> GetAllAsync()
        {
            return await _context.CompanyLedger
                .OrderBy(e => e.EffectiveDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<CompanyLedgerEntry>> GetByPeriodAsync(string periodKey)
        {
            return await _context.CompanyLedger
                .Where(e => periodKey == "all" || e.PeriodKey == periodKey)
                .OrderBy(e => e.EffectiveDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<CompanyLedgerEntry>> GetByTaxYearAsync(int taxYear)
        {
            return await _context.CompanyLedger
                .Where(e => e.TaxYear == taxYear)
                .OrderBy(e => e.EffectiveDate)
                .ToListAsync();
        }

        public async Task<CompanyLedgerEntry?> GetByIdAsync(int id)
        {
            return await _context.CompanyLedger.FindAsync(id);
        }

        public async Task<CompanyLedgerEntry> CreateAsync(CompanyLedgerEntry entry)
        {
            _context.CompanyLedger.Add(entry);
            await _context.SaveChangesAsync();
            return entry;
        }

        public async Task<CompanyLedgerEntry> UpdateAsync(CompanyLedgerEntry entry)
        {
            _context.CompanyLedger.Update(entry);
            await _context.SaveChangesAsync();
            return entry;
        }

        public async Task DeleteAsync(int id)
        {
            var entry = await GetByIdAsync(id);
            if (entry != null)
            {
                _context.CompanyLedger.Remove(entry);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<CompanyAggregates> GetYtdAggregatesAsync(int taxYear)
        {
            // UK tax year: 6 April taxYear → 5 April taxYear+1
            // Filter by EffectiveDate rather than TaxYear field, which may not be set consistently on older entries
            var startDate = new DateTime(taxYear, 4, 6);
            var endDate   = new DateTime(taxYear + 1, 4, 5, 23, 59, 59);
            var entries = await _context.CompanyLedger
                .Where(e => e.EffectiveDate >= startDate && e.EffectiveDate <= endDate)
                .OrderBy(e => e.EffectiveDate)
                .ToListAsync();
            return BuildAggregates(entries);
        }

        public async Task<CompanyAggregates> GetAggregatesAsync(string periodKey)
        {
            var entries = await GetByPeriodAsync(periodKey);
            
            return BuildAggregates(entries);
        }

        private static CompanyAggregates BuildAggregates(IEnumerable<CompanyLedgerEntry> entries)
        {
            var aggregates = new CompanyAggregates();
            foreach (var entry in entries)
            {
                switch (entry.EntryType)
                {
                    case "Salary":             aggregates.SalaryGross      += entry.Amount; break;
                    case "EmployeeNI":         aggregates.EmployeeNI       += entry.Amount; break;
                    case "EmployerNI":         aggregates.EmployerNI       += entry.Amount; break;
                    case "PAYE":               aggregates.PayeRemitted     += entry.Amount; break;
                    case "CorpTax_Reserve":    aggregates.CorpTaxReserved  += entry.Amount; break;
                    case "CorpTax_Paid":       aggregates.CorpTaxPaid      += entry.Amount; break;
                    case "Dividend_Declared":  aggregates.DividendsDeclared += entry.Amount; break;
                    case "Dividend_Paid":      aggregates.DividendsPaid    += entry.Amount; break;
                    case "DLA_In":             aggregates.DlaNet           += entry.Amount; break;
                    case "DLA_Out":            aggregates.DlaNet           -= entry.Amount; break;
                }
            }
            return aggregates;
        }
    }

    public class ShareholderRepository : IShareholderRepository
    {
        private readonly FinanceHubDbContext _context;

        public ShareholderRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Shareholder>> GetAllAsync()
        {
            return await _context.Shareholders.ToListAsync();
        }

        public async Task<Shareholder?> GetByIdAsync(int id)
        {
            return await _context.Shareholders.FindAsync(id);
        }

        public async Task<IEnumerable<Shareholder>> GetActiveAsync()
        {
            return await _context.Shareholders
                .Where(s => s.IsActive)
                .ToListAsync();
        }

        public async Task<Shareholder> CreateAsync(Shareholder shareholder)
        {
            _context.Shareholders.Add(shareholder);
            await _context.SaveChangesAsync();
            return shareholder;
        }

        public async Task<Shareholder> UpdateAsync(Shareholder shareholder)
        {
            _context.Shareholders.Update(shareholder);
            await _context.SaveChangesAsync();
            return shareholder;
        }

        public async Task DeleteAsync(int id)
        {
            var shareholder = await GetByIdAsync(id);
            if (shareholder != null)
            {
                _context.Shareholders.Remove(shareholder);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class CompanySettingsRepository : ICompanySettingsRepository
    {
        private readonly FinanceHubDbContext _context;

        public CompanySettingsRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<CompanySettings?> GetDefaultAsync()
        {
            return await _context.CompanySettings.FirstOrDefaultAsync();
        }

        public async Task<CompanySettings?> GetByIdAsync(int id)
        {
            return await _context.CompanySettings.FindAsync(id);
        }

        public async Task<CompanySettings> UpdateAsync(CompanySettings settings)
        {
            _context.CompanySettings.Update(settings);
            await _context.SaveChangesAsync();
            return settings;
        }
    }

    public class EmployeeRepository : IEmployeeRepository
    {
        private readonly FinanceHubDbContext _context;

        public EmployeeRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Employee>> GetAllAsync()
        {
            return await _context.Employees.ToListAsync();
        }

        public async Task<Employee?> GetByIdAsync(int id)
        {
            return await _context.Employees.FindAsync(id);
        }

        public async Task<IEnumerable<Employee>> GetDirectorsAsync()
        {
            return await _context.Employees
                .Where(e => e.IsDirector && e.IsActive)
                .ToListAsync();
        }

        public async Task<Employee> CreateAsync(Employee employee)
        {
            _context.Employees.Add(employee);
            await _context.SaveChangesAsync();
            return employee;
        }

        public async Task<Employee> UpdateAsync(Employee employee)
        {
            _context.Employees.Update(employee);
            await _context.SaveChangesAsync();
            return employee;
        }

        public async Task DeleteAsync(int id)
        {
            var employee = await GetByIdAsync(id);
            if (employee != null)
            {
                _context.Employees.Remove(employee);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<string> GenerateNextEmployeeNumberAsync()
        {
            var lastEmployee = await _context.Employees
                .OrderByDescending(e => e.Id)
                .FirstOrDefaultAsync();

            if (!string.IsNullOrWhiteSpace(lastEmployee?.EmployeeNumber) && lastEmployee.EmployeeNumber.StartsWith("EMP-"))
            {
                var numericPart = lastEmployee.EmployeeNumber.Replace("EMP-", "");
                if (int.TryParse(numericPart, out int lastNumber))
                {
                    return $"EMP-{(lastNumber + 1).ToString("D3")}";
                }
            }

            return "EMP-001";
        }
    }

    public class AssetRepository : IAssetRepository
    {
        private readonly FinanceHubDbContext _context;

        public AssetRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Asset>> GetAllAsync()
        {
            return await _context.Assets.ToListAsync();
        }

        public async Task<Asset?> GetByIdAsync(int id)
        {
            return await _context.Assets.FindAsync(id);
        }

        public async Task<Asset?> GetByAssetIdAsync(string assetId)
        {
            return await _context.Assets.FirstOrDefaultAsync(a => a.AssetId == assetId);
        }

        public async Task<IEnumerable<Asset>> GetByCategoryAsync(string category)
        {
            return await _context.Assets.Where(a => a.Category == category).ToListAsync();
        }

        public async Task<IEnumerable<Asset>> GetByStatusAsync(string status)
        {
            return await _context.Assets.Where(a => a.Status == status).ToListAsync();
        }

        public async Task<Asset> CreateAsync(Asset asset)
        {
            _context.Assets.Add(asset);
            await _context.SaveChangesAsync();
            return asset;
        }

        public async Task<Asset> UpdateAsync(Asset asset)
        {
            var tracked = _context.ChangeTracker.Entries<Asset>()
                .FirstOrDefault(e => e.Entity.Id == asset.Id);
            if (tracked != null)
            {
                tracked.CurrentValues.SetValues(asset);
            }
            else
            {
                _context.Assets.Update(asset);
            }
            await _context.SaveChangesAsync();
            return asset;
        }

        public async Task DeleteAsync(int id)
        {
            var asset = await GetByIdAsync(id);
            if (asset != null)
            {
                _context.Assets.Remove(asset);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<string> GenerateNextAssetIdAsync()
        {
            var lastAsset = await _context.Assets
                .OrderByDescending(a => a.Id)
                .FirstOrDefaultAsync();

            if (lastAsset?.AssetId != null && lastAsset.AssetId.StartsWith("AST-"))
            {
                var numericPart = lastAsset.AssetId.Replace("AST-", "");
                if (int.TryParse(numericPart, out int lastNumber))
                {
                    return $"AST-{(lastNumber + 1).ToString("D3")}";
                }
            }

            return "AST-001";
        }
    }

    public class SubscriptionRepository : ISubscriptionRepository
    {
        private readonly FinanceHubDbContext _context;

        public SubscriptionRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Subscription>> GetAllAsync()
        {
            return await _context.Subscriptions.ToListAsync();
        }

        public async Task<Subscription?> GetByIdAsync(int id)
        {
            return await _context.Subscriptions.FindAsync(id);
        }

        public async Task<Subscription?> GetBySubscriptionIdAsync(string subscriptionId)
        {
            return await _context.Subscriptions.FirstOrDefaultAsync(s => s.SubscriptionId == subscriptionId);
        }

        public async Task<IEnumerable<Subscription>> GetByTypeAsync(string type)
        {
            return await _context.Subscriptions.Where(s => s.Type == type).ToListAsync();
        }

        public async Task<IEnumerable<Subscription>> GetByStatusAsync(string status)
        {
            return await _context.Subscriptions.Where(s => s.Status == status).ToListAsync();
        }

        public async Task<IEnumerable<Subscription>> GetExpiringWithinDaysAsync(int days)
        {
            var thresholdDate = DateTime.UtcNow.AddDays(days);
            return await _context.Subscriptions
                .Where(s => s.RenewalDate.HasValue && s.RenewalDate.Value <= thresholdDate)
                .ToListAsync();
        }

        public async Task<Subscription> CreateAsync(Subscription subscription)
        {
            _context.Subscriptions.Add(subscription);
            await _context.SaveChangesAsync();
            return subscription;
        }

        public async Task<Subscription> UpdateAsync(Subscription subscription)
        {
            _context.Subscriptions.Update(subscription);
            await _context.SaveChangesAsync();
            return subscription;
        }

        public async Task DeleteAsync(int id)
        {
            var subscription = await GetByIdAsync(id);
            if (subscription != null)
            {
                _context.Subscriptions.Remove(subscription);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<string> GenerateNextSubscriptionIdAsync()
        {
            var lastSubscription = await _context.Subscriptions
                .OrderByDescending(s => s.Id)
                .FirstOrDefaultAsync();

            if (lastSubscription?.SubscriptionId != null && lastSubscription.SubscriptionId.StartsWith("SUB-"))
            {
                var numericPart = lastSubscription.SubscriptionId.Replace("SUB-", "");
                if (int.TryParse(numericPart, out int lastNumber))
                {
                    return $"SUB-{(lastNumber + 1).ToString("D3")}";
                }
            }

            return "SUB-001";
        }
    }

    public class BankAccountRepository : IBankAccountRepository
    {
        private readonly FinanceHubDbContext _context;

        public BankAccountRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<BankAccount>> GetAllAsync()
        {
            return await _context.BankAccounts.ToListAsync();
        }

        public async Task<BankAccount?> GetByIdAsync(int id)
        {
            return await _context.BankAccounts.FindAsync(id);
        }

        public async Task<BankAccount> CreateAsync(BankAccount account)
        {
            _context.BankAccounts.Add(account);
            await _context.SaveChangesAsync();
            return account;
        }

        public async Task<BankAccount> UpdateAsync(BankAccount account)
        {
            _context.BankAccounts.Update(account);
            await _context.SaveChangesAsync();
            return account;
        }

        public async Task DeleteAsync(int id)
        {
            var account = await GetByIdAsync(id);
            if (account != null)
            {
                _context.BankAccounts.Remove(account);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class BankTransactionRepository : IBankTransactionRepository
    {
        private readonly FinanceHubDbContext _context;

        public BankTransactionRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<BankTransaction>> GetAllAsync()
        {
            return await _context.BankTransactions.ToListAsync();
        }

        public async Task<IEnumerable<BankTransaction>> GetByAccountIdAsync(int bankAccountId)
        {
            return await _context.BankTransactions
                .Where(t => t.BankAccountId == bankAccountId)
                .OrderByDescending(t => t.TransactionDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<BankTransaction>> GetUnreconciledAsync()
        {
            return await _context.BankTransactions
                .Where(t => !t.IsReconciled)
                .OrderByDescending(t => t.TransactionDate)
                .ToListAsync();
        }

        public async Task<BankTransaction?> GetByIdAsync(int id)
        {
            return await _context.BankTransactions.FindAsync(id);
        }

        public async Task<BankTransaction> CreateAsync(BankTransaction transaction)
        {
            _context.BankTransactions.Add(transaction);
            await _context.SaveChangesAsync();
            return transaction;
        }

        public async Task<IEnumerable<BankTransaction>> CreateManyAsync(IEnumerable<BankTransaction> transactions)
        {
            var incoming = transactions.ToList();
            var accountIds = incoming.Select(transaction => transaction.BankAccountId).Distinct().ToList();
            var existing = await _context.BankTransactions
                .Where(transaction => accountIds.Contains(transaction.BankAccountId))
                .ToListAsync();
            var knownIds = new HashSet<string>(StringComparer.Ordinal);
            var knownRows = new HashSet<string>(StringComparer.Ordinal);
            var unidentifiedRows = new HashSet<string>(StringComparer.Ordinal);
            static string RowKey(BankTransaction transaction) =>
                System.Text.Json.JsonSerializer.Serialize(new object?[] {
                    transaction.BankAccountId, transaction.TransactionDate, transaction.Amount,
                    transaction.Direction?.Trim().ToUpperInvariant(), transaction.Reference?.Trim(), transaction.Description?.Trim()
                });
            static IEnumerable<string> IdKeys(BankTransaction transaction) =>
                new[] { transaction.ExternalId, transaction.MonzoTransactionId, transaction.TrueLayerTransactionId }
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Select(id => $"{transaction.BankAccountId}:{id}");
            foreach (var transaction in existing)
            {
                foreach (var id in IdKeys(transaction)) knownIds.Add(id);
                knownRows.Add(RowKey(transaction));
                if (!IdKeys(transaction).Any()) unidentifiedRows.Add(RowKey(transaction));
            }
            var created = new List<BankTransaction>();
            foreach (var transaction in incoming)
            {
                var ids = IdKeys(transaction).ToList();
                var row = RowKey(transaction);
                if (ids.Any(knownIds.Contains) || (ids.Count == 0 ? knownRows.Contains(row) : unidentifiedRows.Contains(row))) continue;
                if (existing.Concat(created).Any(other => FinanceHubFunctions.Helpers.MonzoSyncPolicy.PossibleCrossFeedDuplicate(transaction, other)))
                    throw new FinanceHubFunctions.Helpers.BankDuplicateReviewException();
                created.Add(transaction);
                foreach (var id in ids) knownIds.Add(id);
                knownRows.Add(row);
                if (ids.Count == 0) unidentifiedRows.Add(row);
            }
            _context.BankTransactions.AddRange(created);
            await _context.SaveChangesAsync();
            return created;
        }

        public async Task<BankTransaction> UpdateAsync(BankTransaction transaction)
        {
            _context.BankTransactions.Update(transaction);
            await _context.SaveChangesAsync();
            return transaction;
        }

        public async Task DeleteAsync(int id)
        {
            var transaction = await GetByIdAsync(id);
            if (transaction != null)
            {
                _context.BankTransactions.Remove(transaction);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class ReconciliationRuleRepository : IReconciliationRuleRepository
    {
        private readonly FinanceHubDbContext _context;

        public ReconciliationRuleRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<ReconciliationRule>> GetAllAsync()
        {
            return await _context.ReconciliationRules.ToListAsync();
        }

        public async Task<ReconciliationRule?> GetByIdAsync(int id)
        {
            return await _context.ReconciliationRules.FindAsync(id);
        }

        public async Task<ReconciliationRule> CreateAsync(ReconciliationRule rule)
        {
            _context.ReconciliationRules.Add(rule);
            await _context.SaveChangesAsync();
            return rule;
        }

        public async Task<ReconciliationRule> UpdateAsync(ReconciliationRule rule)
        {
            _context.ReconciliationRules.Update(rule);
            await _context.SaveChangesAsync();
            return rule;
        }

        public async Task DeleteAsync(int id)
        {
            var rule = await GetByIdAsync(id);
            if (rule != null)
            {
                _context.ReconciliationRules.Remove(rule);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class ReconciliationMatchRepository : IReconciliationMatchRepository
    {
        private readonly FinanceHubDbContext _context;

        public ReconciliationMatchRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<ReconciliationMatch>> GetByTransactionIdAsync(int transactionId)
        {
            return await _context.ReconciliationMatches
                .Where(m => m.BankTransactionId == transactionId)
                .ToListAsync();
        }

        public async Task<ReconciliationMatch> CreateAsync(ReconciliationMatch match)
        {
            _context.ReconciliationMatches.Add(match);
            await _context.SaveChangesAsync();
            return match;
        }

        public async Task DeleteAsync(int id)
        {
            var match = await _context.ReconciliationMatches.FindAsync(id);
            if (match != null)
            {
                _context.ReconciliationMatches.Remove(match);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class PayrollRunRepository : IPayrollRunRepository
    {
        private readonly FinanceHubDbContext _context;

        public PayrollRunRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<PayrollRun>> GetAllAsync()
        {
            return await _context.PayrollRuns.OrderByDescending(r => r.PayDate).ToListAsync();
        }

        public async Task<PayrollRun?> GetByIdAsync(int id)
        {
            return await _context.PayrollRuns.FindAsync(id);
        }

        public async Task<PayrollRun> CreateAsync(PayrollRun run)
        {
            _context.PayrollRuns.Add(run);
            await _context.SaveChangesAsync();
            return run;
        }

        public async Task<PayrollRun> UpdateAsync(PayrollRun run)
        {
            _context.PayrollRuns.Update(run);
            await _context.SaveChangesAsync();
            return run;
        }

        public async Task DeleteAsync(int id)
        {
            var run = await GetByIdAsync(id);
            if (run != null)
            {
                _context.PayrollRuns.Remove(run);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class PayslipRepository : IPayslipRepository
    {
        private readonly FinanceHubDbContext _context;

        public PayslipRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Payslip>> GetByPayrollRunIdAsync(int payrollRunId)
        {
            return await _context.Payslips
                .Where(p => p.PayrollRunId == payrollRunId)
                .ToListAsync();
        }

        public async Task<Payslip?> GetByIdAsync(int id)
        {
            return await _context.Payslips.FindAsync(id);
        }

        public async Task<Payslip> CreateAsync(Payslip payslip)
        {
            _context.Payslips.Add(payslip);
            await _context.SaveChangesAsync();
            return payslip;
        }

        public async Task<Payslip> UpdateAsync(Payslip payslip)
        {
            _context.Payslips.Update(payslip);
            await _context.SaveChangesAsync();
            return payslip;
        }

        public async Task DeleteAsync(int id)
        {
            var payslip = await GetByIdAsync(id);
            if (payslip != null)
            {
                _context.Payslips.Remove(payslip);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class PayrollSettingsRepository : IPayrollSettingsRepository
    {
        private readonly FinanceHubDbContext _context;

        public PayrollSettingsRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<PayrollSettings?> GetAsync()
        {
            return await _context.PayrollSettings.FirstOrDefaultAsync();
        }

        public async Task<PayrollSettings> UpdateAsync(PayrollSettings settings)
        {
            _context.PayrollSettings.Update(settings);
            await _context.SaveChangesAsync();
            return settings;
        }
    }

    public class VatReturnRepository : IVatReturnRepository
    {
        private readonly FinanceHubDbContext _context;

        public VatReturnRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<VatReturn>> GetAllAsync()
        {
            return await _context.VatReturns
                .OrderByDescending(v => v.QuarterStartDate)
                .ToListAsync();
        }

        public async Task<VatReturn?> GetByIdAsync(int id)
        {
            return await _context.VatReturns.FindAsync(id);
        }

        public async Task<VatReturn> CreateAsync(VatReturn vatReturn)
        {
            vatReturn.CreatedDate = DateTime.UtcNow;
            vatReturn.ModifiedDate = DateTime.UtcNow;
            _context.VatReturns.Add(vatReturn);
            await _context.SaveChangesAsync();
            return vatReturn;
        }

        public async Task<VatReturn> UpdateAsync(VatReturn vatReturn)
        {
            vatReturn.ModifiedDate = DateTime.UtcNow;
            _context.VatReturns.Update(vatReturn);
            await _context.SaveChangesAsync();
            return vatReturn;
        }

        public async Task DeleteAsync(int id)
        {
            var vatReturn = await GetByIdAsync(id);
            if (vatReturn != null)
            {
                _context.VatReturns.Remove(vatReturn);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class MileageTripRepository : IMileageTripRepository
    {
        private readonly FinanceHubDbContext _context;

        public MileageTripRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<MileageTrip>> GetAllAsync()
        {
            return await _context.MileageTrips
                .AsNoTracking()
                .OrderByDescending(t => t.TripDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<MileageTrip>> GetByTaxYearAsync(string taxYear)
        {
            return await _context.MileageTrips
                .AsNoTracking()
                .Where(t => t.TaxYear == taxYear)
                .OrderByDescending(t => t.TripDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<MileageTrip>> GetByDirectorAndTaxYearAsync(string director, string taxYear)
        {
            return await _context.MileageTrips
                .AsNoTracking()
                .Where(t => t.Director == director && t.TaxYear == taxYear)
                .OrderByDescending(t => t.TripDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<MileageTrip>> GetDraftTripsByDirectorAsync(string director)
        {
            return await _context.MileageTrips
                .AsNoTracking()
                .Where(t => t.Director == director && t.Status == "Draft")
                .OrderBy(t => t.TripDate)
                .ToListAsync();
        }

        public async Task<MileageTrip?> GetByIdAsync(int id)
        {
            return await _context.MileageTrips.FindAsync(id);
        }

        public async Task<MileageTrip> CreateAsync(MileageTrip trip)
        {
            trip.CreatedAt = DateTime.UtcNow;
            _context.MileageTrips.Add(trip);
            await _context.SaveChangesAsync();
            return trip;
        }

        public async Task<MileageTrip> UpdateAsync(MileageTrip trip)
        {
            trip.UpdatedAt = DateTime.UtcNow;
            _context.MileageTrips.Update(trip);
            await _context.SaveChangesAsync();
            return trip;
        }

        public async Task DeleteAsync(int id)
        {
            var trip = await GetByIdAsync(id);
            if (trip != null)
            {
                _context.MileageTrips.Remove(trip);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<decimal> GetCumulativeMilesByTaxYearAsync(string director, string taxYear)
        {
            return await _context.MileageTrips
                .AsNoTracking()
                .Where(t => t.Director == director && t.TaxYear == taxYear && t.Status != "Deleted")
                .SumAsync(t => t.Miles);
        }

        public async Task<string> GenerateNextTripIdAsync()
        {
            var yearStr = DateTime.Now.Year.ToString();
            var last = await _context.MileageTrips
                .Where(t => t.TripId.StartsWith($"MIL-{yearStr}-"))
                .OrderByDescending(t => t.TripId)
                .FirstOrDefaultAsync();

            int nextNumber = 1;
            if (last != null && !string.IsNullOrEmpty(last.TripId))
            {
                var parts = last.TripId.Split('-');
                if (parts.Length == 3 && int.TryParse(parts[2], out int lastNumber))
                    nextNumber = lastNumber + 1;
            }
            return $"MIL-{yearStr}-{nextNumber:D4}";
        }
    }

    public class MileageClaimRepository : IMileageClaimRepository
    {
        private readonly FinanceHubDbContext _context;

        public MileageClaimRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<MileageClaim>> GetAllAsync()
        {
            return await _context.MileageClaims
                .AsNoTracking()
                .OrderByDescending(c => c.PeriodEnd)
                .ToListAsync();
        }

        public async Task<IEnumerable<MileageClaim>> GetByDirectorAsync(string director)
        {
            return await _context.MileageClaims
                .AsNoTracking()
                .Where(c => c.Director == director)
                .OrderByDescending(c => c.PeriodEnd)
                .ToListAsync();
        }

        public async Task<IEnumerable<MileageClaim>> GetByTaxYearAsync(string taxYear)
        {
            return await _context.MileageClaims
                .AsNoTracking()
                .Where(c => c.TaxYear == taxYear)
                .OrderByDescending(c => c.PeriodEnd)
                .ToListAsync();
        }

        public async Task<IEnumerable<MileageClaim>> GetByDirectorAndTaxYearAsync(string director, string taxYear)
        {
            return await _context.MileageClaims
                .AsNoTracking()
                .Where(c => c.Director == director && c.TaxYear == taxYear)
                .OrderByDescending(c => c.PeriodEnd)
                .ToListAsync();
        }

        public async Task<MileageClaim?> GetByIdAsync(int id)
        {
            return await _context.MileageClaims.FindAsync(id);
        }

        public async Task<MileageClaim> CreateAsync(MileageClaim claim)
        {
            claim.CreatedAt = DateTime.UtcNow;
            _context.MileageClaims.Add(claim);
            await _context.SaveChangesAsync();
            return claim;
        }

        public async Task<MileageClaim> UpdateAsync(MileageClaim claim)
        {
            claim.UpdatedAt = DateTime.UtcNow;
            _context.MileageClaims.Update(claim);
            await _context.SaveChangesAsync();
            return claim;
        }

        public async Task DeleteAsync(int id)
        {
            var claim = await GetByIdAsync(id);
            if (claim != null)
            {
                _context.MileageClaims.Remove(claim);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<string> GenerateNextClaimRefAsync()
        {
            var yearStr = DateTime.Now.Year.ToString();
            var last = await _context.MileageClaims
                .Where(c => c.ClaimRef.StartsWith($"MILCLAIM-{yearStr}-"))
                .OrderByDescending(c => c.ClaimRef)
                .FirstOrDefaultAsync();

            int nextNumber = 1;
            if (last != null && !string.IsNullOrEmpty(last.ClaimRef))
            {
                var parts = last.ClaimRef.Split('-');
                if (parts.Length == 3 && int.TryParse(parts[2], out int lastNumber))
                    nextNumber = lastNumber + 1;
            }
            return $"MILCLAIM-{yearStr}-{nextNumber:D3}";
        }
    }

    public class MissingReceiptDeclarationRepository : IMissingReceiptDeclarationRepository
    {
        private readonly FinanceHubDbContext _context;

        public MissingReceiptDeclarationRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<MissingReceiptDeclaration?> GetByExpenseIdAsync(int expenseId)
        {
            return await _context.MissingReceiptDeclarations
                .AsNoTracking()
                .Where(d => d.ExpenseId == expenseId && d.Status != DeclarationStatus.Voided)
                .OrderByDescending(d => d.CreatedAt)
                .FirstOrDefaultAsync();
        }

        public async Task<MissingReceiptDeclaration?> GetByDlaEntryIdAsync(int dlaEntryId)
        {
            return await _context.MissingReceiptDeclarations
                .AsNoTracking()
                .Where(d => d.DlaEntryId == dlaEntryId && d.Status != DeclarationStatus.Voided)
                .OrderByDescending(d => d.CreatedAt)
                .FirstOrDefaultAsync();
        }

        public async Task<MissingReceiptDeclaration?> GetByIdAsync(int id)
        {
            return await _context.MissingReceiptDeclarations
                .FirstOrDefaultAsync(d => d.Id == id);
        }

        public async Task<MissingReceiptDeclaration> CreateAsync(MissingReceiptDeclaration declaration)
        {
            declaration.CreatedAt = DateTime.UtcNow;
            _context.MissingReceiptDeclarations.Add(declaration);
            await _context.SaveChangesAsync();
            return declaration;
        }

        public async Task<MissingReceiptDeclaration> UpdateAsync(MissingReceiptDeclaration declaration)
        {
            _context.MissingReceiptDeclarations.Update(declaration);
            await _context.SaveChangesAsync();
            return declaration;
        }

        public async Task<string> GenerateNextDeclarationIdAsync()
        {
            var dateStr = DateTime.UtcNow.ToString("yyyyMMdd");
            var prefix = $"MRD-{dateStr}-";
            var last = await _context.MissingReceiptDeclarations
                .Where(d => d.DeclarationId != null && d.DeclarationId.StartsWith(prefix))
                .OrderByDescending(d => d.DeclarationId)
                .FirstOrDefaultAsync();

            int nextNumber = 1;
            if (last != null && !string.IsNullOrEmpty(last.DeclarationId))
            {
                var parts = last.DeclarationId.Split('-');
                if (parts.Length == 3 && int.TryParse(parts[2], out int lastNumber))
                    nextNumber = lastNumber + 1;
            }
            return $"{prefix}{nextNumber:D3}";
        }
    }

    public class ExpenseAuditEventRepository : IExpenseAuditEventRepository
    {
        private readonly FinanceHubDbContext _context;

        public ExpenseAuditEventRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<ExpenseAuditEvent>> GetByExpenseIdAsync(int expenseId)
        {
            return await _context.ExpenseAuditEvents
                .AsNoTracking()
                .Where(e => e.ExpenseId == expenseId)
                .OrderByDescending(e => e.OccurredAt)
                .ToListAsync();
        }

        public async Task<ExpenseAuditEvent> CreateAsync(ExpenseAuditEvent auditEvent)
        {
            auditEvent.OccurredAt = DateTime.UtcNow;
            _context.ExpenseAuditEvents.Add(auditEvent);
            await _context.SaveChangesAsync();
            return auditEvent;
        }
    }

    public class CreditNoteRepository : ICreditNoteRepository
    {
        private readonly FinanceHubDbContext _context;

        public CreditNoteRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<CreditNote>> GetAllAsync()
            => await _context.CreditNotes.OrderByDescending(c => c.DateIssued).ToListAsync();

        public async Task<CreditNote?> GetByIdAsync(int id)
            => await _context.CreditNotes.FindAsync(id);

        public async Task<CreditNote?> GetByCreditNoteNumberAsync(string number)
            => await _context.CreditNotes.FirstOrDefaultAsync(c => c.CreditNoteNumber == number);

        public async Task<IEnumerable<CreditNote>> GetByCustomerIdAsync(string customerId)
            => await _context.CreditNotes
                .Where(c => c.CustomerId == customerId)
                .OrderByDescending(c => c.DateIssued)
                .ToListAsync();

        public async Task<IEnumerable<CreditNote>> GetByStatusAsync(string status)
            => await _context.CreditNotes
                .Where(c => c.Status == status)
                .OrderByDescending(c => c.DateIssued)
                .ToListAsync();

        public async Task<IEnumerable<CreditNote>> GetPendingByCustomerIdAsync(string customerId)
            => await _context.CreditNotes
                .Where(c => c.CustomerId == customerId && c.Status == "Issued")
                .OrderByDescending(c => c.DateIssued)
                .ToListAsync();

        public async Task<CreditNote> CreateAsync(CreditNote creditNote)
        {
            _context.CreditNotes.Add(creditNote);
            await _context.SaveChangesAsync();
            return creditNote;
        }

        public async Task<CreditNote> UpdateAsync(CreditNote creditNote)
        {
            var existing = await _context.CreditNotes.FindAsync(creditNote.Id);
            if (existing != null)
            {
                _context.Entry(existing).CurrentValues.SetValues(creditNote);
                await _context.SaveChangesAsync();
            }
            return creditNote;
        }

        public async Task DeleteAsync(int id)
        {
            var cn = await GetByIdAsync(id);
            if (cn != null)
            {
                _context.CreditNotes.Remove(cn);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<string> GenerateNextCreditNoteNumberAsync()
        {
            var year = DateTime.UtcNow.Year;
            var prefix = $"CN-{year}-";
            var lastNumber = await _context.CreditNotes
                .Where(c => c.CreditNoteNumber.StartsWith(prefix))
                .OrderByDescending(c => c.CreditNoteNumber)
                .Select(c => c.CreditNoteNumber)
                .FirstOrDefaultAsync();

            int next = 1;
            if (lastNumber != null)
            {
                var parts = lastNumber.Split('-');
                if (parts.Length == 3 && int.TryParse(parts[2], out var n))
                    next = n + 1;
            }
            return $"{prefix}{next:D3}";
        }
    }

    public class TeamMemberRepository : ITeamMemberRepository
    {
        private readonly FinanceHubDbContext _context;
        public TeamMemberRepository(FinanceHubDbContext context) => _context = context;

        public async Task<IEnumerable<TeamMember>> GetAllAsync()
            => await _context.TeamMembers.ToListAsync();

        public async Task<IEnumerable<TeamMember>> GetByCompanyIdAsync(int companyId)
            => await _context.TeamMembers.Where(m => m.CompanyId == companyId).ToListAsync();

        public async Task<TeamMember?> GetByIdAsync(int id)
            => await _context.TeamMembers.FindAsync(id);

        public async Task<TeamMember?> GetByClerkUserIdAsync(string clerkUserId)
            => await _context.TeamMembers.FirstOrDefaultAsync(m => m.ClerkUserId == clerkUserId);

        public async Task<TeamMember?> GetByEmailAndCompanyAsync(string email, int companyId)
            => await _context.TeamMembers.FirstOrDefaultAsync(m => m.Email == email && m.CompanyId == companyId);

        public async Task<TeamMember?> GetByInviteTokenAsync(string token)
            => await _context.TeamMembers.FirstOrDefaultAsync(m => m.InviteToken == token);

        public async Task<TeamMember> CreateAsync(TeamMember member)
        {
            _context.TeamMembers.Add(member);
            await _context.SaveChangesAsync();
            return member;
        }

        public async Task<TeamMember> UpdateAsync(TeamMember member)
        {
            _context.TeamMembers.Update(member);
            await _context.SaveChangesAsync();
            return member;
        }

        public async Task DeleteAsync(int id)
        {
            var member = await _context.TeamMembers.FindAsync(id);
            if (member != null)
            {
                _context.TeamMembers.Remove(member);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class AccountantRepository : IAccountantRepository
    {
        private readonly FinanceHubDbContext _context;
        public AccountantRepository(FinanceHubDbContext context) => _context = context;

        public async Task<IEnumerable<Accountant>> GetAllAsync()
            => await _context.Accountants.ToListAsync();

        public async Task<Accountant?> GetByIdAsync(int id)
            => await _context.Accountants.FindAsync(id);

        public async Task<Accountant?> GetByEmailAsync(string email)
            => await _context.Accountants.FirstOrDefaultAsync(a => a.Email == email);

        public async Task<Accountant?> GetByClerkUserIdAsync(string clerkUserId)
            => await _context.Accountants.FirstOrDefaultAsync(a => a.ClerkUserId == clerkUserId);

        public async Task<Accountant> CreateAsync(Accountant accountant)
        {
            _context.Accountants.Add(accountant);
            await _context.SaveChangesAsync();
            return accountant;
        }

        public async Task<Accountant> UpdateAsync(Accountant accountant)
        {
            _context.Accountants.Update(accountant);
            await _context.SaveChangesAsync();
            return accountant;
        }

        public async Task DeleteAsync(int id)
        {
            var a = await _context.Accountants.FindAsync(id);
            if (a != null)
            {
                _context.Accountants.Remove(a);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class CompanyAccountantRepository : ICompanyAccountantRepository
    {
        private readonly FinanceHubDbContext _context;
        public CompanyAccountantRepository(FinanceHubDbContext context) => _context = context;

        public async Task<IEnumerable<CompanyAccountant>> GetByCompanyIdAsync(int companyId)
            => await _context.CompanyAccountants.Where(ca => ca.CompanyId == companyId).ToListAsync();

        public async Task<IEnumerable<CompanyAccountant>> GetByAccountantIdAsync(int accountantId)
            => await _context.CompanyAccountants.Where(ca => ca.AccountantId == accountantId).ToListAsync();

        public async Task<CompanyAccountant?> GetByIdAsync(int id)
            => await _context.CompanyAccountants.FindAsync(id);

        public async Task<CompanyAccountant?> GetByInviteTokenAsync(string token)
            => await _context.CompanyAccountants.FirstOrDefaultAsync(ca => ca.InviteToken == token);

        public async Task<CompanyAccountant?> GetByCompanyAndAccountantAsync(int companyId, int accountantId)
            => await _context.CompanyAccountants.FirstOrDefaultAsync(ca => ca.CompanyId == companyId && ca.AccountantId == accountantId);

        public async Task<CompanyAccountant> CreateAsync(CompanyAccountant ca)
        {
            _context.CompanyAccountants.Add(ca);
            await _context.SaveChangesAsync();
            return ca;
        }

        public async Task<CompanyAccountant> UpdateAsync(CompanyAccountant ca)
        {
            _context.CompanyAccountants.Update(ca);
            await _context.SaveChangesAsync();
            return ca;
        }

        public async Task DeleteAsync(int id)
        {
            var ca = await _context.CompanyAccountants.FindAsync(id);
            if (ca != null)
            {
                _context.CompanyAccountants.Remove(ca);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class RecurringInvoiceTemplateRepository : IRecurringInvoiceTemplateRepository
    {
        private readonly FinanceHubDbContext _context;

        public RecurringInvoiceTemplateRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<RecurringInvoiceTemplate>> GetAllAsync()
        {
            return await _context.RecurringInvoiceTemplates
                .OrderByDescending(t => t.CreatedDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<RecurringInvoiceTemplate>> GetActiveAsync()
        {
            return await _context.RecurringInvoiceTemplates
                .Where(t => t.IsActive)
                .OrderBy(t => t.NextRunDate)
                .ToListAsync();
        }

        public async Task<IEnumerable<RecurringInvoiceTemplate>> GetDueTemplatesAsync()
        {
            var today = DateTime.UtcNow.Date;
            return await _context.RecurringInvoiceTemplates
                .Where(t => t.IsActive && t.NextRunDate.HasValue && t.NextRunDate.Value.Date <= today)
                .ToListAsync();
        }

        public async Task<RecurringInvoiceTemplate?> GetByIdAsync(int id)
        {
            return await _context.RecurringInvoiceTemplates.FindAsync(id);
        }

        public async Task<RecurringInvoiceTemplate> CreateAsync(RecurringInvoiceTemplate template)
        {
            template.CreatedDate = DateTime.UtcNow;
            template.ModifiedDate = DateTime.UtcNow;
            _context.RecurringInvoiceTemplates.Add(template);
            await _context.SaveChangesAsync();
            return template;
        }

        public async Task<RecurringInvoiceTemplate> UpdateAsync(RecurringInvoiceTemplate template)
        {
            var existing = await _context.RecurringInvoiceTemplates.FindAsync(template.Id);
            if (existing != null)
            {
                _context.Entry(existing).CurrentValues.SetValues(template);
                existing.DefaultLineItems = template.DefaultLineItems;
                _context.Entry(existing).Property(e => e.DefaultLineItems).IsModified = true;
                existing.ModifiedDate = DateTime.UtcNow;
                await _context.SaveChangesAsync();
                return existing;
            }

            template.ModifiedDate = DateTime.UtcNow;
            _context.RecurringInvoiceTemplates.Update(template);
            await _context.SaveChangesAsync();
            return template;
        }

        public async Task DeleteAsync(int id)
        {
            var template = await GetByIdAsync(id);
            if (template != null)
            {
                _context.RecurringInvoiceTemplates.Remove(template);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class CategorizationRuleRepository : ICategorizationRuleRepository
    {
        private readonly FinanceHubDbContext _context;

        public CategorizationRuleRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<CategorizationRule>> GetAllAsync()
        {
            return await _context.CategorizationRules
                .OrderBy(r => r.Priority)
                .ToListAsync();
        }

        public async Task<IEnumerable<CategorizationRule>> GetActiveAsync()
        {
            return await _context.CategorizationRules
                .Where(r => r.IsActive)
                .OrderBy(r => r.Priority)
                .ToListAsync();
        }

        public async Task<CategorizationRule?> GetByIdAsync(int id)
        {
            return await _context.CategorizationRules.FindAsync(id);
        }

        public async Task<CategorizationRule> CreateAsync(CategorizationRule rule)
        {
            rule.CreatedDate = DateTime.UtcNow;
            rule.ModifiedDate = DateTime.UtcNow;
            _context.CategorizationRules.Add(rule);
            await _context.SaveChangesAsync();
            return rule;
        }

        public async Task<CategorizationRule> UpdateAsync(CategorizationRule rule)
        {
            rule.ModifiedDate = DateTime.UtcNow;
            _context.CategorizationRules.Update(rule);
            await _context.SaveChangesAsync();
            return rule;
        }

        public async Task DeleteAsync(int id)
        {
            var rule = await GetByIdAsync(id);
            if (rule != null)
            {
                _context.CategorizationRules.Remove(rule);
                await _context.SaveChangesAsync();
            }
        }
    }

    public class GoCardlessMandateRepository : IGoCardlessMandateRepository
    {
        private readonly FinanceHubDbContext _context;

        public GoCardlessMandateRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<GoCardlessMandate>> GetAllAsync()
        {
            return await _context.GoCardlessMandates
                .OrderByDescending(m => m.CreatedDate)
                .ToListAsync();
        }

        public async Task<GoCardlessMandate?> GetByIdAsync(int id)
        {
            return await _context.GoCardlessMandates.FindAsync(id);
        }

        public async Task<IEnumerable<GoCardlessMandate>> GetByCustomerIdAsync(string customerId)
        {
            return await _context.GoCardlessMandates
                .Where(m => m.CustomerId == customerId)
                .OrderByDescending(m => m.CreatedDate)
                .ToListAsync();
        }

        public async Task<GoCardlessMandate?> GetByGoCardlessMandateIdAsync(string goCardlessMandateId)
        {
            return await _context.GoCardlessMandates
                .FirstOrDefaultAsync(m => m.GoCardlessMandateId == goCardlessMandateId);
        }

        public async Task<GoCardlessMandate> CreateAsync(GoCardlessMandate mandate)
        {
            mandate.CreatedDate = DateTime.UtcNow;
            _context.GoCardlessMandates.Add(mandate);
            await _context.SaveChangesAsync();
            return mandate;
        }

        public async Task<GoCardlessMandate> UpdateAsync(GoCardlessMandate mandate)
        {
            _context.GoCardlessMandates.Update(mandate);
            await _context.SaveChangesAsync();
            return mandate;
        }
    }

    public class GoCardlessPaymentRepository : IGoCardlessPaymentRepository
    {
        private readonly FinanceHubDbContext _context;

        public GoCardlessPaymentRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<GoCardlessPayment>> GetAllAsync()
        {
            return await _context.GoCardlessPayments
                .OrderByDescending(p => p.CreatedDate)
                .ToListAsync();
        }

        public async Task<GoCardlessPayment?> GetByIdAsync(int id)
        {
            return await _context.GoCardlessPayments.FindAsync(id);
        }

        public async Task<GoCardlessPayment?> GetByGoCardlessPaymentIdAsync(string goCardlessPaymentId)
        {
            return await _context.GoCardlessPayments
                .FirstOrDefaultAsync(p => p.GoCardlessPaymentId == goCardlessPaymentId);
        }

        public async Task<IEnumerable<GoCardlessPayment>> GetByInvoiceIdAsync(int invoiceId)
        {
            return await _context.GoCardlessPayments
                .Where(p => p.InvoiceId == invoiceId)
                .OrderByDescending(p => p.CreatedDate)
                .ToListAsync();
        }

        public async Task<GoCardlessPayment> CreateAsync(GoCardlessPayment payment)
        {
            payment.CreatedDate = DateTime.UtcNow;
            _context.GoCardlessPayments.Add(payment);
            await _context.SaveChangesAsync();
            return payment;
        }

        public async Task<GoCardlessPayment> UpdateAsync(GoCardlessPayment payment)
        {
            _context.GoCardlessPayments.Update(payment);
            await _context.SaveChangesAsync();
            return payment;
        }
    }

    public class BillRepository : IBillRepository
    {
        private readonly FinanceHubDbContext _context;

        public BillRepository(FinanceHubDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Bill>> GetAllAsync()
        {
            return await _context.Bills.OrderByDescending(b => b.DateIssued).ToListAsync();
        }

        public async Task<Bill?> GetByIdAsync(int id)
        {
            return await _context.Bills.FindAsync(id);
        }

        public async Task<Bill?> GetByBillNumberAsync(string billNumber)
        {
            return await _context.Bills.FirstOrDefaultAsync(b => b.BillNumber == billNumber);
        }

        public async Task<IEnumerable<Bill>> GetByStatusAsync(string status)
        {
            return await _context.Bills
                .Where(b => b.Status == status)
                .OrderByDescending(b => b.DateIssued)
                .ToListAsync();
        }

        public async Task<IEnumerable<Bill>> GetBySupplierIdAsync(string supplierId)
        {
            return await _context.Bills
                .Where(b => b.SupplierId == supplierId)
                .OrderByDescending(b => b.DateIssued)
                .ToListAsync();
        }

        public async Task<IEnumerable<Bill>> GetOverdueAsync()
        {
            var today = DateTime.UtcNow.Date;
            return await _context.Bills
                .Where(b => b.Status != "Paid" && b.Status != "Cancelled" && b.Status != "Draft"
                    && b.DueDate.HasValue && b.DueDate.Value.Date < today)
                .OrderBy(b => b.DueDate)
                .ToListAsync();
        }

        public async Task<Bill> CreateAsync(Bill bill)
        {
            _context.Bills.Add(bill);
            await _context.SaveChangesAsync();
            return bill;
        }

        public async Task<Bill> UpdateAsync(Bill bill)
        {
            var existing = await _context.Bills.FindAsync(bill.Id);
            if (existing != null)
            {
                _context.Entry(existing).CurrentValues.SetValues(bill);
                existing.LineItems = bill.LineItems;
                existing.Attachments = bill.Attachments;
                _context.Entry(existing).Property(e => e.LineItems).IsModified = true;
                _context.Entry(existing).Property(e => e.Attachments).IsModified = true;
                await _context.SaveChangesAsync();
                return existing;
            }

            _context.Bills.Update(bill);
            await _context.SaveChangesAsync();
            return bill;
        }

        public async Task DeleteAsync(int id)
        {
            var bill = await GetByIdAsync(id);
            if (bill != null)
            {
                _context.Bills.Remove(bill);
                await _context.SaveChangesAsync();
            }
        }

        public async Task<string> GenerateNextBillNumberAsync()
        {
            var year = DateTime.UtcNow.Year;
            var prefix = $"BILL-{year}-";
            var lastBill = await _context.Bills
                .Where(b => b.BillNumber.StartsWith(prefix))
                .OrderByDescending(b => b.BillNumber)
                .FirstOrDefaultAsync();

            int nextSeq = 1;
            if (lastBill != null)
            {
                var seqStr = lastBill.BillNumber.Replace(prefix, "");
                if (int.TryParse(seqStr, out var seqNum))
                    nextSeq = seqNum + 1;
            }

            return $"{prefix}{nextSeq:D4}";
        }
    }
}
