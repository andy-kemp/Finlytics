using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using Microsoft.EntityFrameworkCore;

sealed class TestCompanyLedgerRepository(FinanceHubDbContext db) : ICompanyLedgerRepository
{
    public async Task<IEnumerable<CompanyLedgerEntry>> GetAllAsync() =>
        await db.CompanyLedger.OrderBy(entry => entry.EffectiveDate).ToListAsync();
    public async Task<IEnumerable<CompanyLedgerEntry>> GetByPeriodAsync(string periodKey) =>
        await db.CompanyLedger.Where(entry => periodKey == "all" || entry.PeriodKey == periodKey)
            .OrderBy(entry => entry.EffectiveDate).ToListAsync();
    public async Task<IEnumerable<CompanyLedgerEntry>> GetByTaxYearAsync(int taxYear) =>
        await db.CompanyLedger.Where(entry => entry.TaxYear == taxYear).OrderBy(entry => entry.EffectiveDate).ToListAsync();
    public async Task<CompanyLedgerEntry?> GetByIdAsync(int id) => await db.CompanyLedger.FindAsync(id);
    public async Task<CompanyLedgerEntry> CreateAsync(CompanyLedgerEntry entry)
    {
        db.CompanyLedger.Add(entry);
        await db.SaveChangesAsync();
        return entry;
    }
    public Task<CompanyLedgerEntry> UpdateAsync(CompanyLedgerEntry entry) => throw new NotSupportedException();
    public Task DeleteAsync(int id) => throw new NotSupportedException();
    public Task<CompanyAggregates> GetAggregatesAsync(string periodKey) => throw new NotSupportedException();
    public Task<CompanyAggregates> GetYtdAggregatesAsync(int taxYear) => throw new NotSupportedException();
}