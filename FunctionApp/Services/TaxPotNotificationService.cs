#nullable enable
using System;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Services
{
    public sealed class TaxPotNotificationService
    {
        private static readonly SemaphoreSlim SendLock = new(1, 1);
        private readonly FinanceHubDbContext _db;
        private readonly MonzoClient _monzo;
        private readonly EmailService _email;
        private readonly ILogger<TaxPotNotificationService> _logger;

        public TaxPotNotificationService(FinanceHubDbContext db, MonzoClient monzo, EmailService email, ILogger<TaxPotNotificationService> logger)
        {
            _db = db;
            _monzo = monzo;
            _email = email;
            _logger = logger;
        }

        public async Task SendDaily(MonzoSyncResult sync)
        {
            if (string.Equals(Environment.GetEnvironmentVariable("TaxPotDailyEmailEnabled"), "false", StringComparison.OrdinalIgnoreCase)) return;
            await SendLock.WaitAsync();
            try
            {
                var day = MonzoSyncPolicy.ToUkLocal(sync.SyncedAtUtc).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                if (await _monzo.TaxPotDigestSentOn() == day) return;
                if (!sync.VatPot.HasValue || !sync.CtPot.HasValue || sync.Warnings.Count > 0)
                {
                    _logger.LogWarning("Tax pot digest skipped: fresh pot balances or a clean bank sync are unavailable");
                    return;
                }
                var settings = await _db.CompanySettings.AsNoTracking().OrderBy(company => company.Id).FirstOrDefaultAsync();
                if (settings == null) throw new InvalidOperationException("Company settings unavailable for tax pot estimates");
                var recipient = new[] { Environment.GetEnvironmentVariable("TaxPotNotificationEmail"),
                    Environment.GetEnvironmentVariable("MonzoNotificationEmail"), settings.CompanyEmail, settings.Email }
                    .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
                if (recipient == null) throw new InvalidOperationException("Tax pot email recipient is not configured");
                var sources = new RecordedCashSources
                {
                    Invoices = await _db.Invoices.AsNoTracking().ToListAsync(),
                    Expenses = await _db.Expenses.AsNoTracking().ToListAsync(),
                    DlaEntries = await _db.DlaEntries.AsNoTracking().ToListAsync(),
                    LedgerEntries = await _db.CompanyLedger.AsNoTracking().ToListAsync(),
                    PayrollSettings = await _db.PayrollSettings.AsNoTracking().ToListAsync(),
                    PayrollRuns = await _db.PayrollRuns.AsNoTracking().ToListAsync()
                };
                var today = MonzoSyncPolicy.ToUkLocal(sync.SyncedAtUtc);
                var returns = await _db.VatReturns.AsNoTracking().ToListAsync();
                var vat = new TaxPotComparison("VAT", sync.VatPot.Value, TaxPotEmailPolicy.UnfiledVat(sources, settings, returns, today));
                var ct = new TaxPotComparison("Corporation Tax", sync.CtPot.Value, TaxPotEmailPolicy.CorporationTax(sources, settings, today));
                var (success, error) = await _email.SendSystemEmailAsync(recipient.Trim(), $"Finlytics: daily tax pot check - {day}",
                    TaxPotEmailPolicy.Html(vat, ct, sync.SyncedAtUtc, sync.Warnings));
                if (!success) throw new InvalidOperationException($"Tax pot email delivery failed: {error}");
                await _monzo.SaveSecret("MonzoTaxPotDigestSentOn", day);
                _logger.LogInformation("Daily tax pot email sent for {Day}; VAT difference {Vat}, CT difference {Ct}", day, vat.Difference, ct.Difference);
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Daily tax pot email failed; bank sync remains committed and the email is not marked sent");
            }
            finally { SendLock.Release(); }
        }
    }
}