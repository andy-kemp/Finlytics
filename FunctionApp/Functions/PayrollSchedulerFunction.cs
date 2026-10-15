using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    /// <summary>
    /// Runs daily at 07:00 UTC and automatically generates (and optionally posts)
    /// a payroll run when the configured number of days before pay day is reached.
    ///
    /// Enabled via PayrollSettings:
    ///   AutoRunEnabled       = true
    ///   AutoRunDaysBefore    = 7   (default — generate 1 week before pay day)
    ///   AutoPostImmediately  = false (default — create draft for review; set true to auto-post)
    /// </summary>
    public class PayrollSchedulerFunction
    {
        private readonly ILogger<PayrollSchedulerFunction> _logger;
        private readonly FinanceHubDbContext? _db;

        public PayrollSchedulerFunction(
            ILogger<PayrollSchedulerFunction> logger,
            FinanceHubDbContext? db = null)
        {
            _logger = logger;
            _db = db;
        }

        [Function("PayrollAutoScheduler")]
        public async Task Run([TimerTrigger("0 0 7 * * *")] TimerInfo timer)
        {
            _logger.LogInformation("PayrollAutoScheduler triggered at {Time} UTC", DateTime.UtcNow);

            if (_db == null)
            {
                _logger.LogError("PayrollAutoScheduler: database context not available — skipping");
                return;
            }

            // ── 1. Read settings ──────────────────────────────────────────────
            var settings = await _db.PayrollSettings.FirstOrDefaultAsync();
            if (settings == null || !settings.AutoRunEnabled)
            {
                _logger.LogDebug("PayrollAutoScheduler: auto-run disabled — nothing to do");
                return;
            }

            int payDay      = settings.PayDayOfMonth ?? 25;
            int daysBefore  = settings.AutoRunDaysBefore ?? 7;
            bool autoPost   = settings.AutoPostImmediately;

            // ── 2. Calculate target run date for current month ────────────────
            var today = DateTime.UtcNow.Date;
            var year  = today.Year;
            var month = today.Month;

            var daysInMonth  = DateTime.DaysInMonth(year, month);
            var actualPayDay = Math.Min(payDay, daysInMonth);
            var payDate      = new DateTime(year, month, actualPayDay);

            // If pay day is already past this month, look at next month
            if (payDate < today)
            {
                month = today.AddMonths(1).Month;
                year  = today.AddMonths(1).Year;
                daysInMonth  = DateTime.DaysInMonth(year, month);
                actualPayDay = Math.Min(payDay, daysInMonth);
                payDate      = new DateTime(year, month, actualPayDay);
            }

            var triggerDate = payDate.AddDays(-daysBefore);

            if (today != triggerDate)
            {
                _logger.LogDebug(
                    "PayrollAutoScheduler: not trigger day. Today={Today}, TriggerDate={TriggerDate} ({DaysBefore}d before pay day {PayDate})",
                    today, triggerDate, daysBefore, payDate);
                return;
            }

            _logger.LogInformation(
                "PayrollAutoScheduler: trigger day reached. Generating payroll for {PayDate} (auto-post={AutoPost})",
                payDate, autoPost);

            // ── 3. Idempotency — check if a run already exists for this month ─
            var taxYear  = PayrollCalculations.GetTaxYear(payDate);
            var taxMonth = PayrollCalculations.GetTaxMonth(payDate);

            PayrollTaxYearRates rates;
            try
            {
                rates = PayrollCalculations.RatesFor(taxYear);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "PayrollAutoScheduler: {Message} — skipping", ex.Message);
                return;
            }

            var existing = await _db.PayrollRuns
                .AnyAsync(r => r.TaxYear == taxYear && r.TaxMonth == taxMonth);
            if (existing)
            {
                _logger.LogInformation(
                    "PayrollAutoScheduler: run for {TaxYear} M{TaxMonth} already exists — skipping",
                    taxYear, taxMonth);
                return;
            }

            // ── 4. Load employees + defaults ─────────────────────────────────
            string defaultTaxCode = settings.DefaultTaxCode ?? "1257L";
            string defaultNiCat   = settings.DefaultNiCategory ?? "A";

            var employees = await _db.Employees.Where(e => e.IsActive).ToListAsync();
            if (!employees.Any())
            {
                _logger.LogWarning("PayrollAutoScheduler: no active employees found — skipping");
                return;
            }

            // ── 5. Calculate payslips ─────────────────────────────────────────
            var payslips   = new List<Payslip>();
            decimal totalGross = 0, totalTax = 0, totalEmpNI = 0, totalErNI = 0, totalNet = 0;

            foreach (var emp in employees)
            {
                decimal grossPay = Math.Round((emp.AnnualSalary ?? 0m) / 12m, 2);
                string  taxCode  = emp.TaxCode ?? defaultTaxCode;
                string  niCat    = defaultNiCat;

                var priorPayslips = await _db.Payslips
                    .Join(_db.PayrollRuns,
                          p => p.PayrollRunId, r => r.Id,
                          (p, r) => new { p, r })
                    .Where(x => x.p.EmployeeId == emp.Id
                             && x.r.TaxYear == taxYear
                             && x.r.TaxMonth < taxMonth)
                    .Select(x => x.p)
                    .ToListAsync();

                decimal ytdGrossBefore = priorPayslips.Sum(p => p.GrossPay ?? 0m);
                decimal ytdTaxBefore   = priorPayslips.Sum(p => p.Tax ?? 0m);
                decimal ytdEmpNIBefore = priorPayslips.Sum(p => p.NationalInsurance ?? 0m);
                decimal ytdErNIBefore  = priorPayslips.Sum(p => p.EmployerNi ?? 0m);

                decimal tax   = PayrollCalculations.CalcTax(ytdGrossBefore, ytdTaxBefore, grossPay, taxCode, taxMonth, rates);
                decimal empNI = PayrollCalculations.CalcEmployeeNI(grossPay, niCat, rates);
                decimal erNI  = PayrollCalculations.CalcEmployerNI(grossPay, niCat, rates);
                decimal net   = grossPay - tax - empNI;

                payslips.Add(new Payslip
                {
                    EmployeeId        = emp.Id,
                    EmployeeName      = emp.Name,
                    TaxCode           = taxCode,
                    NiCategory        = niCat,
                    NiNumber          = emp.NationalInsuranceNumber,
                    GrossPay          = grossPay,
                    Tax               = tax,
                    NationalInsurance = empNI,
                    EmployerNi        = erNI,
                    Pension           = 0m,
                    NetPay            = net,
                    TaxYear           = taxYear,
                    TaxMonth          = taxMonth,
                    YtdGross          = ytdGrossBefore + grossPay,
                    YtdTax            = ytdTaxBefore   + tax,
                    YtdEmployeeNi     = ytdEmpNIBefore + empNI,
                    YtdEmployerNi     = ytdErNIBefore  + erNI,
                    DirectorsNiMethod = emp.IsDirector ? "AP" : null,
                    CreatedDate       = DateTime.UtcNow
                });

                totalGross += grossPay;
                totalTax   += tax;
                totalEmpNI += empNI;
                totalErNI  += erNI;
                totalNet   += net;
            }

            // ── 6. Create PayrollRun ──────────────────────────────────────────
            var run = new PayrollRun
            {
                PeriodStart     = new DateTime(year, month, 1),
                PeriodEnd       = new DateTime(year, month, daysInMonth),
                PayDate         = payDate,
                Frequency       = "Monthly",
                Status          = "Draft",
                TaxYear         = taxYear,
                TaxMonth        = taxMonth,
                FpsStatus       = "Pending",
                TotalGross      = totalGross,
                TotalTax        = totalTax,
                TotalEmployeeNi = totalEmpNI,
                TotalEmployerNi = totalErNI,
                TotalNetPay     = totalNet,
                CreatedDate     = DateTime.UtcNow,
                ModifiedDate    = DateTime.UtcNow
            };

            _db.PayrollRuns.Add(run);
            await _db.SaveChangesAsync();

            // Attach payslips to the saved run
            foreach (var slip in payslips)
                slip.PayrollRunId = run.Id;
            _db.Payslips.AddRange(payslips);
            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "PayrollAutoScheduler: generated run #{RunId} for {TaxYear} M{TaxMonth} with {Count} payslips",
                run.Id, taxYear, taxMonth, payslips.Count);

            // ── 7. Auto-post if configured ────────────────────────────────────
            if (!autoPost)
            {
                _logger.LogInformation(
                    "PayrollAutoScheduler: AutoPostImmediately=false — run #{RunId} is Draft, review and post manually",
                    run.Id);
            }
            else
            {
                await PostRunAsync(run, payslips, settings);
            }

            // ── 8. Update last-triggered timestamp ────────────────────────────
            settings.AutoRunLastTriggered = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        // ── Internal post logic (mirrors PayrollFunctions.PostPayrollRun) ────
        private async Task PostRunAsync(PayrollRun run, List<Payslip> payslips, PayrollSettings settings)
        {
            var company    = await _db!.CompanySettings.FirstOrDefaultAsync();
            var periodKey  = run.PayDate.ToString("yyyy-MM");
            var taxYearInt = int.TryParse(run.TaxYear?.Split('-')[0], out var ty) ? ty : run.PayDate.Year;
            var monthName  = run.PayDate.ToString("MMMM yyyy", CultureInfo.InvariantCulture);
            var hmrcDue    = run.PayDate.AddMonths(1).ToString("MMMM yyyy", CultureInfo.InvariantCulture);

            var ledgerEntries = new List<CompanyLedgerEntry>();

            foreach (var slip in payslips)
            {
                var empName = slip.EmployeeName ?? $"Employee #{slip.EmployeeId}";

                if ((slip.GrossPay ?? 0) != 0)
                    ledgerEntries.Add(new CompanyLedgerEntry
                    {
                        Title         = $"Salary – {empName}: {monthName}",
                        EntryType     = "Salary",
                        Amount        = slip.GrossPay ?? 0,
                        EffectiveDate = run.PayDate,
                        PeriodKey     = periodKey,
                        TaxYear       = taxYearInt,
                        Notes         = $"Payroll Run #{run.Id} · Tax Year {run.TaxYear} Month {run.TaxMonth} [auto-posted]"
                    });

                if ((slip.NationalInsurance ?? 0) != 0)
                    ledgerEntries.Add(new CompanyLedgerEntry
                    {
                        Title         = $"Employee NI – {empName}: {monthName}",
                        EntryType     = "EmployeeNI",
                        Amount        = slip.NationalInsurance ?? 0,
                        EffectiveDate = run.PayDate,
                        PeriodKey     = periodKey,
                        TaxYear       = taxYearInt,
                        Notes         = $"Payroll Run #{run.Id} [auto-posted]"
                    });

                if ((slip.EmployerNi ?? 0) != 0)
                    ledgerEntries.Add(new CompanyLedgerEntry
                    {
                        Title         = $"Employer NI – {empName}: {monthName}",
                        EntryType     = "EmployerNI",
                        Amount        = slip.EmployerNi ?? 0,
                        EffectiveDate = run.PayDate,
                        PeriodKey     = periodKey,
                        TaxYear       = taxYearInt,
                        Notes         = $"Payroll Run #{run.Id} — pay to HMRC by 22nd {hmrcDue} [auto-posted]"
                    });
            }

            if ((run.TotalTax ?? 0) != 0)
                ledgerEntries.Add(new CompanyLedgerEntry
                {
                    Title         = $"PAYE Income Tax: {monthName}",
                    EntryType     = "PAYE",
                    Amount        = run.TotalTax ?? 0,
                    EffectiveDate = run.PayDate,
                    PeriodKey     = periodKey,
                    TaxYear       = taxYearInt,
                    Notes         = $"Payroll Run #{run.Id} · {payslips.Count} employee(s) — PAYE+NI due HMRC by 22nd {hmrcDue} [auto-posted]"
                });

            _db.CompanyLedger.AddRange(ledgerEntries);
            run.Status       = "Posted";
            run.ModifiedDate = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "PayrollAutoScheduler: auto-posted run #{RunId} — {Ledger} ledger entries created",
                run.Id, ledgerEntries.Count);

            // Note: payslip emails are not sent from the timer trigger (no user AAD session token).
            // Employees will receive their payslips if you open the run and use the re-send option.
            _logger.LogInformation(
                "PayrollAutoScheduler: payslip emails skipped (no user session in timer trigger) — send manually from the Payroll page");
        }
    }
}
