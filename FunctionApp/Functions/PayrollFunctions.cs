using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;
using System.Globalization;

namespace FinanceHubFunctions.Functions
{
    public class PayrollFunctions
    {
        private readonly ILogger<PayrollFunctions> _logger;
        private readonly IPayrollRunRepository? _payrollRunRepository;
        private readonly IPayslipRepository? _payslipRepository;
        private readonly IPayrollSettingsRepository? _payrollSettingsRepository;
        private readonly FinanceHubDbContext? _db;
        private readonly EmailService? _emailService;
        private readonly ICompanyLedgerRepository? _companyLedgerRepository;
        private readonly FpsService? _fpsService;
        private readonly EpsService? _epsService;
        private readonly PayslipPdfService? _payslipPdfService;
        private readonly DeletionGuardService? _guard;

        public PayrollFunctions(
            ILogger<PayrollFunctions> logger,
            IPayrollRunRepository? payrollRunRepository = null,
            IPayslipRepository? payslipRepository = null,
            IPayrollSettingsRepository? payrollSettingsRepository = null,
            FinanceHubDbContext? db = null,
            EmailService? emailService = null,
            ICompanyLedgerRepository? companyLedgerRepository = null,
            FpsService? fpsService = null,
            EpsService? epsService = null,
            BlobStorageService? blobStorageService = null,
            DeletionGuardService? guard = null)
        {
            _logger = logger;
            _payrollRunRepository = payrollRunRepository;
            _payslipRepository = payslipRepository;
            _payrollSettingsRepository = payrollSettingsRepository;
            _db = db;
            _emailService = emailService;
            _companyLedgerRepository = companyLedgerRepository;
            _fpsService = fpsService;
            _epsService = epsService;
            _payslipPdfService = blobStorageService != null ? new PayslipPdfService(blobStorageService) : null;
            _guard = guard;
        }

        [Function("GetPayrollRuns")]
        public async Task<HttpResponseData> GetPayrollRuns(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "payroll/runs")] HttpRequestData req)
        {
            if (_payrollRunRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payroll run repository not available" });
                return response;
            }

            var runs = await _payrollRunRepository.GetAllAsync();
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(runs);
            return ok;
        }

        [Function("CreatePayrollRun")]
        public async Task<HttpResponseData> CreatePayrollRun(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "payroll/runs")] HttpRequestData req)
        {
            if (_payrollRunRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payroll run repository not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var run = JsonSerializer.Deserialize<PayrollRun>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (run == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid payroll run payload" });
                return bad;
            }

            run.CreatedDate = DateTime.UtcNow;
            run.ModifiedDate = DateTime.UtcNow;
            run.Frequency ??= "Monthly";
            run.Status ??= "Draft";

            var created = await _payrollRunRepository.CreateAsync(run);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(created);
            return ok;
        }

        [Function("UpdatePayrollRun")]
        public async Task<HttpResponseData> UpdatePayrollRun(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "payroll/runs/{id:int}")] HttpRequestData req,
            int id)
        {
            if (_payrollRunRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payroll run repository not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var run = JsonSerializer.Deserialize<PayrollRun>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (run == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid payroll run payload" });
                return bad;
            }

            run.Id = id;
            run.ModifiedDate = DateTime.UtcNow;
            var updated = await _payrollRunRepository.UpdateAsync(run);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(updated);
            return ok;
        }

        [Function("DeletePayrollRun")]
        public async Task<HttpResponseData> DeletePayrollRun(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "payroll/runs/{id:int}")] HttpRequestData req,
            int id)
        {
            if (_payrollRunRepository == null || _db == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Repositories not available" });
                return response;
            }

            if (_guard != null)
            {
                var blocked = await _guard.GuardAsync(req, "payroll run");
                if (blocked != null) return blocked;
            }

            // Remove all CompanyLedger entries created by this payroll run
            // (identified by Notes starting with "Payroll Run #{id}")
            var runPrefix = $"Payroll Run #{id}";
            var ledgerEntries = await _db.CompanyLedger
                .Where(e => e.Notes != null && e.Notes.StartsWith(runPrefix))
                .ToListAsync();
            if (ledgerEntries.Count > 0)
            {
                _db.CompanyLedger.RemoveRange(ledgerEntries);
                _logger.LogInformation("Removing {Count} ledger entries for PayrollRun #{Id}", ledgerEntries.Count, id);
            }

            // Remove all payslips for this run
            var payslips = await _db.Payslips.Where(p => p.PayrollRunId == id).ToListAsync();
            if (payslips.Count > 0)
                _db.Payslips.RemoveRange(payslips);

            await _db.SaveChangesAsync();

            await _payrollRunRepository.DeleteAsync(id);

            _logger.LogInformation("Deleted PayrollRun #{Id} with {Ledger} ledger entries and {Slips} payslips",
                id, ledgerEntries.Count, payslips.Count);

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(new { deleted = id, ledgerEntriesRemoved = ledgerEntries.Count, payslipsRemoved = payslips.Count });
            return ok;
        }

        [Function("GetPayslipsByRun")]
        public async Task<HttpResponseData> GetPayslipsByRun(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "payroll/runs/{id:int}/payslips")] HttpRequestData req,
            int id)
        {
            if (_payslipRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payslip repository not available" });
                return response;
            }

            var payslips = await _payslipRepository.GetByPayrollRunIdAsync(id);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(payslips);
            return ok;
        }

        [Function("CreatePayslip")]
        public async Task<HttpResponseData> CreatePayslip(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "payroll/runs/{id:int}/payslips")] HttpRequestData req,
            int id)
        {
            if (_payslipRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payslip repository not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var payslip = JsonSerializer.Deserialize<Payslip>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (payslip == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid payslip payload" });
                return bad;
            }

            payslip.PayrollRunId = id;
            payslip.CreatedDate = DateTime.UtcNow;
            var created = await _payslipRepository.CreateAsync(payslip);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(created);
            return ok;
        }

        [Function("UpdatePayslip")]
        public async Task<HttpResponseData> UpdatePayslip(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "payroll/payslips/{id:int}")] HttpRequestData req,
            int id)
        {
            if (_payslipRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payslip repository not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var payslip = JsonSerializer.Deserialize<Payslip>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (payslip == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid payslip payload" });
                return bad;
            }

            payslip.Id = id;
            var updated = await _payslipRepository.UpdateAsync(payslip);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(updated);
            return ok;
        }

        [Function("DeletePayslip")]
        public async Task<HttpResponseData> DeletePayslip(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "payroll/payslips/{id:int}")] HttpRequestData req,
            int id)
        {
            if (_payslipRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payslip repository not available" });
                return response;
            }

            if (_guard != null)
            {
                var blocked = await _guard.GuardAsync(req, "payslip");
                if (blocked != null) return blocked;
            }

            await _payslipRepository.DeleteAsync(id);
            return req.CreateResponse(HttpStatusCode.OK);
        }

        [Function("GetPayrollSettings")]
        public async Task<HttpResponseData> GetPayrollSettings(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "payroll/settings")] HttpRequestData req)
        {
            if (_payrollSettingsRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payroll settings repository not available" });
                return response;
            }

            var settings = await _payrollSettingsRepository.GetAsync();
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(settings ?? new PayrollSettings());
            return ok;
        }

        [Function("UpdatePayrollSettings")]
        public async Task<HttpResponseData> UpdatePayrollSettings(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "payroll/settings")] HttpRequestData req)
        {
            if (_payrollSettingsRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Payroll settings repository not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var settings = JsonSerializer.Deserialize<PayrollSettings>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (settings == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid payroll settings payload" });
                return bad;
            }

            settings.ModifiedDate = DateTime.UtcNow;
            var updated = await _payrollSettingsRepository.UpdateAsync(settings);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(updated);
            return ok;
        }

        // ── HMRC RTI helpers ──────────────────────────────────────────────────
        // Thin wrappers — logic lives in PayrollCalculations (shared with PayrollSchedulerFunction)

        private static int     GetTaxMonth(DateTime d)                         => PayrollCalculations.GetTaxMonth(d);
        private static string  GetTaxYear(DateTime d)                          => PayrollCalculations.GetTaxYear(d);
        private static decimal ParseTaxCodeAllowance(string? tc)               => PayrollCalculations.ParseTaxCodeAllowance(tc);
        private static bool    IsScottishTaxCode(string? tc)                   => PayrollCalculations.IsScottishTaxCode(tc);
        private static decimal CalcEmployeeNI(decimal g, string? cat, PayrollTaxYearRates rates) => PayrollCalculations.CalcEmployeeNI(g, cat, rates);
        private static decimal CalcEmployerNI(decimal g, string? cat, PayrollTaxYearRates rates) => PayrollCalculations.CalcEmployerNI(g, cat, rates);
        private static decimal CalcTax(
            decimal ytdGrossBefore, decimal ytdTaxBefore,
            decimal grossThisPeriod, string? taxCode, int taxMonth, PayrollTaxYearRates rates)
            => PayrollCalculations.CalcTax(ytdGrossBefore, ytdTaxBefore, grossThisPeriod, taxCode, taxMonth, rates);

        // ── Generate Payroll Run ──────────────────────────────────────────────

        [Function("GeneratePayrollRun")]
        public async Task<HttpResponseData> GeneratePayrollRun(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "payroll/runs/generate")] HttpRequestData req)
        {
            if (_db == null)
            {
                var r = req.CreateResponse(HttpStatusCode.InternalServerError);
                await r.WriteAsJsonAsync(new { error = "Database context not available" });
                return r;
            }

            var body = await new StreamReader(req.Body).ReadToEndAsync();
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            if (!root.TryGetProperty("month", out var monthEl) ||
                !root.TryGetProperty("year",  out var yearEl))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "month and year are required" });
                return bad;
            }

            int month = monthEl.GetInt32();
            int year  = yearEl.GetInt32();

            // Clamp payday to 28 to handle February
            int payDay = 25;
            var settings = await _db.PayrollSettings.FirstOrDefaultAsync();
            if (settings?.PayDayOfMonth is int configDay) payDay = Math.Min(configDay, DateTime.DaysInMonth(year, month));

            var payDate   = new DateTime(year, month, payDay);
            int taxMonth  = GetTaxMonth(payDate);
            string taxYear = GetTaxYear(payDate);

            PayrollTaxYearRates rates;
            try
            {
                rates = PayrollCalculations.RatesFor(taxYear);
            }
            catch (InvalidOperationException ex)
            {
                var noRates = req.CreateResponse(HttpStatusCode.BadRequest);
                await noRates.WriteAsJsonAsync(new { error = ex.Message });
                return noRates;
            }

            // Duplicate check
            var existing = await _db.PayrollRuns
                .FirstOrDefaultAsync(r => r.TaxYear == taxYear && r.TaxMonth == taxMonth);
            if (existing != null)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteAsJsonAsync(new { error = $"A payroll run already exists for Tax Month {taxMonth} ({taxYear})." });
                return conflict;
            }

            string defaultTaxCode = settings?.DefaultTaxCode ?? "1257L";
            string defaultNiCat   = settings?.DefaultNiCategory ?? "A";

            var employees = await _db.Employees.Where(e => e.IsActive).ToListAsync();
            if (!employees.Any())
            {
                var empty = req.CreateResponse(HttpStatusCode.BadRequest);
                await empty.WriteAsJsonAsync(new { error = "No active employees found. Add employees first." });
                return empty;
            }

            var payslips = new List<Payslip>();
            decimal totalGross = 0, totalTax = 0, totalEmpNI = 0, totalErNI = 0, totalNet = 0;

            foreach (var emp in employees)
            {
                decimal grossPay = Math.Round((emp.AnnualSalary ?? 0m) / 12m, 2);
                string  taxCode  = emp.TaxCode ?? defaultTaxCode;
                string  niCat    = defaultNiCat;

                // YTD totals from previous payslips this tax year
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

                decimal tax    = CalcTax(ytdGrossBefore, ytdTaxBefore, grossPay, taxCode, taxMonth, rates);
                decimal empNI  = CalcEmployeeNI(grossPay, niCat, rates);
                decimal erNI   = CalcEmployerNI(grossPay, niCat, rates);
                decimal netPay = grossPay - tax - empNI;

                payslips.Add(new Payslip
                {
                    EmployeeId          = emp.Id,
                    EmployeeNumber      = emp.EmployeeNumber,
                    EmployeeName        = emp.Name,
                    TaxCode             = taxCode,
                    NiCategory          = niCat,
                    NiNumber            = emp.NationalInsuranceNumber,
                    GrossPay            = grossPay,
                    Tax                 = tax,
                    NationalInsurance   = empNI,
                    EmployerNi          = erNI,
                    Pension             = 0m,
                    NetPay              = netPay,
                    TaxYear             = taxYear,
                    TaxMonth            = taxMonth,
                    YtdGross            = ytdGrossBefore + grossPay,
                    YtdTax              = ytdTaxBefore   + tax,
                    YtdEmployeeNi       = ytdEmpNIBefore + empNI,
                    YtdEmployerNi       = ytdErNIBefore  + erNI,
                    DirectorsNiMethod   = emp.IsDirector ? "AP" : null,
                    CreatedDate         = DateTime.UtcNow
                });

                totalGross += grossPay;
                totalTax   += tax;
                totalEmpNI += empNI;
                totalErNI  += erNI;
                totalNet   += netPay;
            }

            var run = new PayrollRun
            {
                PeriodStart     = new DateTime(year, month, 1),
                PeriodEnd       = new DateTime(year, month, DateTime.DaysInMonth(year, month)),
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

            foreach (var slip in payslips)
            {
                slip.PayrollRunId = run.Id;
                _db.Payslips.Add(slip);
            }
            await _db.SaveChangesAsync();

            _logger.LogInformation("Generated payroll run {RunId} for {TaxYear} month {TaxMonth}: gross={Total}",
                run.Id, taxYear, taxMonth, totalGross);

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(new { run, payslips });
            return ok;
        }

        // ── Post Payroll Run — creates ledger entries + sends emails ─────────

        [Function("PostPayrollRun")]
        public async Task<HttpResponseData> PostPayrollRun(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "payroll/runs/{id:int}/post")] HttpRequestData req,
            int id)
        {
            if (_db == null || _companyLedgerRepository == null)
            {
                var r = req.CreateResponse(HttpStatusCode.InternalServerError);
                await r.WriteAsJsonAsync(new { error = "Database or ledger repository not available" });
                return r;
            }

            var run = await _db.PayrollRuns.FindAsync(id);
            if (run == null)
            {
                var r = req.CreateResponse(HttpStatusCode.NotFound);
                await r.WriteAsJsonAsync(new { error = "Payroll run not found" });
                return r;
            }
            if (run.Status == "Posted")
            {
                var r = req.CreateResponse(HttpStatusCode.Conflict);
                await r.WriteAsJsonAsync(new { error = "This payroll run is already posted." });
                return r;
            }

            var payslips = await _db.Payslips.Where(p => p.PayrollRunId == id).ToListAsync();
            var company  = await _db.CompanySettings.FirstOrDefaultAsync();
            var settings = await _db.PayrollSettings.FirstOrDefaultAsync();

            var periodKey = run.PayDate.ToString("yyyy-MM");
            var taxYearInt = int.TryParse(run.TaxYear?.Split('-')[0], out var ty) ? ty : run.PayDate.Year;
            var monthName  = run.PayDate.ToString("MMMM yyyy", CultureInfo.InvariantCulture);

            // 1. Create Company Ledger entries:
            //    - One Salary entry per employee (gross pay)
            //    - One combined HMRC entry for all PAYE + all Employer NI (paid as a single bill)
            var savedEntries = new List<CompanyLedgerEntry>();
            var hmrcDueDate  = run.PayDate.AddMonths(1).ToString("MMMM yyyy", CultureInfo.InvariantCulture);

            // Per-employee salary entries
            foreach (var slip in payslips)
            {
                var empName = slip.EmployeeName ?? $"Employee #{slip.EmployeeId}";

                if ((slip.GrossPay ?? 0) != 0)
                    savedEntries.Add(await _companyLedgerRepository.CreateAsync(new CompanyLedgerEntry
                    {
                        Title         = $"Salary – {empName}: {monthName}",
                        EntryType     = "Salary",
                        Amount        = slip.GrossPay ?? 0,
                        EffectiveDate = run.PayDate,
                        PeriodKey     = periodKey,
                        TaxYear       = taxYearInt,
                        Notes         = $"Payroll Run #{id} · Tax Year {run.TaxYear} Month {run.TaxMonth}"
                    }));
            }

            // Separate ledger entries for PAYE (income tax) and Employer NI
            // These must be separate so ytdAggregates correctly picks up employerNI for CT deduction
            var totalEmployerNi = payslips.Sum(p => p.EmployerNi ?? 0m);
            var totalPaye       = run.TotalTax ?? 0m;
            if (totalPaye != 0m)
                savedEntries.Add(await _companyLedgerRepository.CreateAsync(new CompanyLedgerEntry
                {
                    Title         = $"HMRC PAYE (Income Tax): {monthName}",
                    EntryType     = "PAYE",
                    Amount        = totalPaye,
                    EffectiveDate = run.PayDate,
                    PeriodKey     = periodKey,
                    TaxYear       = taxYearInt,
                    Notes         = $"Payroll Run #{id} · {payslips.Count} employee(s) · pay HMRC by 22nd {hmrcDueDate}"
                }));
            if (totalEmployerNi != 0m)
                savedEntries.Add(await _companyLedgerRepository.CreateAsync(new CompanyLedgerEntry
                {
                    Title         = $"Employer NI: {monthName}",
                    EntryType     = "EmployerNI",
                    Amount        = totalEmployerNi,
                    EffectiveDate = run.PayDate,
                    PeriodKey     = periodKey,
                    TaxYear       = taxYearInt,
                    Notes         = $"Payroll Run #{id} · {payslips.Count} employee(s) · pay HMRC by 22nd {hmrcDueDate}"
                }));

            // 2. Mark run as Posted
            run.Status       = "Posted";
            run.ModifiedDate = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            // 3. Send emails
            var accessToken = req.Headers.TryGetValues("x-ms-token-aad-access-token", out var toks)
                ? toks.FirstOrDefault() ?? string.Empty
                : string.Empty;

            var emailResults = new List<object>();

            if (_emailService != null)
            {
                // 3a. Per-employee payslip email with PDF attachment
                var employeeIds = payslips.Select(p => p.EmployeeId).Distinct().ToList();
                var employees   = await _db.Employees.Where(e => employeeIds.Contains(e.Id)).ToListAsync();

                foreach (var slip in payslips)
                {
                    var emp = employees.FirstOrDefault(e => e.Id == slip.EmployeeId);
                    if (string.IsNullOrWhiteSpace(emp?.Email)) continue;
                    try
                    {
                        byte[] pdfBytes;
                        if (_payslipPdfService != null)
                            pdfBytes = await _payslipPdfService.GeneratePayslipPdfAsync(slip, run, company, settings);
                        else
                        {
                            var pdfHtml = GeneratePayslipHtml(slip, run, company, settings);
                            pdfBytes = HtmlPdfService.ConvertHtmlToPdf(pdfHtml);
                        }
                        var result   = await _emailService.SendPayslipEmailAsync(
                            emp.Email, slip, run, company, pdfBytes, accessToken);
                        emailResults.Add(new { employee = emp.Name, email = emp.Email, success = result.Success, error = result.Error });
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send payslip email to {Email}", emp?.Email);
                        emailResults.Add(new { employee = emp?.Name, email = emp?.Email, success = false, error = ex.Message });
                    }
                }

                // 3b. Employer summary email with BACS CSV attachment
                try
                {
                    var summaryTo = company?.CompanyEmail ?? company?.SmtpFromAddress;
                    if (!string.IsNullOrWhiteSpace(summaryTo))
                    {
                        var employees2 = await _db.Employees.Where(e => employeeIds.Contains(e.Id)).ToListAsync();
                        var bacsCsv    = GenerateBacsCsv(payslips, employees2, run, settings);
                        var bacsFile   = $"BACS-{run.PayDate:yyyy-MM}.csv";
                        await _emailService.SendPayrollSummaryEmailAsync(
                            summaryTo, run, payslips, employees2, company, settings, accessToken, bacsCsv, bacsFile);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to send payroll summary email");
                }
            }

            _logger.LogInformation("Posted payroll run {Id} for {Month}: {Entries} ledger entries, {Emails} emails",
                id, monthName, savedEntries.Count, emailResults.Count);

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(new { run, ledgerEntries = savedEntries, emailResults });
            return ok;
        }

        // ── Payslip HTML for PDF generation ──────────────────────────────────

        private static string GeneratePayslipHtml(Payslip slip, PayrollRun run, CompanySettings? company, PayrollSettings? settings = null)
        {
            var fmt      = (decimal? v) => (v ?? 0m).ToString("N2");
            var period   = run.PayDate.ToString("MMMM yyyy", CultureInfo.InvariantCulture);
            var payDate  = run.PayDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture);
            var nextMo   = run.PayDate.AddMonths(1).ToString("MMMM yyyy", CultureInfo.InvariantCulture);
            var compName = company?.CompanyName ?? "Company";
            var compAddr = company?.CompanyAddress ?? company?.Address ?? "";
            var logoUrl  = company?.LogoUrl ?? "";
            var genDate  = DateTime.UtcNow.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture);
            var annSalary= (slip.GrossPay ?? 0m) * 12m;
            var totalDeductions = (slip.Tax ?? 0m) + (slip.NationalInsurance ?? 0m) + (slip.Pension ?? 0m);
            var payeRef  = settings?.EmployerPAYEReference ?? settings?.AccountsOfficeReference ?? "—";
            var aor      = settings?.AccountsOfficeReference ?? "—";

            // All styles are inline for PdfSharpCore compatibility (no flexbox, no grid, no complex CSS selectors)
            var logoHtml = string.IsNullOrWhiteSpace(logoUrl)
                ? $"<div style='font-size:14pt;font-weight:bold;color:#0f2a4a;'>{compName}</div>"
                : $"<img src='{logoUrl}' alt='{compName}' style='max-height:52px;max-width:180px;display:block;margin-bottom:4px;' /><div style='font-size:13pt;font-weight:bold;color:#0f2a4a;'>{compName}</div>";
            var pensionRow   = (slip.Pension ?? 0m) != 0m ? $"<tr><td style='padding:5px 6px;border-bottom:1px solid #f3f4f6;'>Pension</td><td style='padding:5px 6px;border-bottom:1px solid #f3f4f6;text-align:right;'>&#x00a3;{fmt(slip.Pension)}</td></tr>" : "";
            var erPensionRow = (slip.Pension ?? 0m) != 0m ? $"<tr><td style='padding:5px 8px;border-bottom:1px solid #fef9c3;color:#78350f;'>Employer Pension Contribution</td><td style='padding:5px 8px;border-bottom:1px solid #fef9c3;color:#78350f;text-align:right;'>&#x00a3;{fmt(slip.Pension)}</td><td style='padding:5px 8px;color:#a07000;'>Pension provider</td></tr>" : "";

            return $@"<!DOCTYPE html>
<html lang='en'>
<head><meta charset='UTF-8'></head>
<body style='font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#1f2937;background:#fff;margin:0;padding:0;'>
<div style='padding:22px 28px;'>

  <!-- Header -->
  <table style='width:100%;border-collapse:collapse;border-bottom:3px solid #0f2a4a;margin-bottom:14px;'>
    <tr>
      <td style='width:55%;padding-bottom:10px;vertical-align:bottom;'>
        {logoHtml}
        <div style='font-size:8.5pt;color:#6b7280;margin-top:2px;'>Employee Payslip</div>
      </td>
      <td style='padding-bottom:10px;vertical-align:bottom;text-align:right;font-size:8.5pt;color:#374151;'>
        <div style='display:inline-block;background:#0f2a4a;color:#fff;font-size:7pt;padding:2px 8px;margin-bottom:5px;text-transform:uppercase;'>Private &amp; Confidential</div><br/>
        <strong style='color:#0f2a4a;'>Pay Period:</strong> {period}<br/>
        <strong style='color:#0f2a4a;'>Pay Date:</strong> {payDate}<br/>
        <strong style='color:#0f2a4a;'>Tax Year:</strong> {run.TaxYear} &nbsp;&middot;&nbsp; <strong style='color:#0f2a4a;'>Month:</strong> {run.TaxMonth}
      </td>
    </tr>
  </table>

  <!-- Employee Info Bar -->
  <table style='width:100%;border-collapse:collapse;background:#f3f4f6;border:1px solid #e5e7eb;margin-bottom:12px;'>
    <tr>
      <td style='width:25%;padding:9px 10px;vertical-align:top;'>
        <div style='color:#9ca3af;font-size:7.5pt;text-transform:uppercase;'>Employee</div>
        <div style='font-weight:600;color:#111827;font-size:9pt;'>{slip.EmployeeName ?? "&#x2014;"}</div>
      </td>
      <td style='width:25%;padding:9px 10px;vertical-align:top;'>
        <div style='color:#9ca3af;font-size:7.5pt;text-transform:uppercase;'>NI Number</div>
        <div style='font-weight:600;color:#111827;font-size:9pt;'>{slip.NiNumber ?? "&#x2014;"}</div>
      </td>
      <td style='width:25%;padding:9px 10px;vertical-align:top;'>
        <div style='color:#9ca3af;font-size:7.5pt;text-transform:uppercase;'>Tax Code</div>
        <div style='font-weight:600;color:#111827;font-size:9pt;'>{slip.TaxCode ?? "&#x2014;"}</div>
      </td>
      <td style='width:25%;padding:9px 10px;vertical-align:top;'>
        <div style='color:#9ca3af;font-size:7.5pt;text-transform:uppercase;'>NI Category</div>
        <div style='font-weight:600;color:#111827;font-size:9pt;'>{slip.NiCategory ?? "A"}</div>
      </td>
    </tr>
  </table>

  <!-- Earnings / Deductions side-by-side -->
  <table style='width:100%;border-collapse:collapse;margin-bottom:12px;'>
    <tr>
      <td style='width:49%;vertical-align:top;padding-right:10px;'>
        <div style='font-size:7.5pt;font-weight:700;color:#0f2a4a;text-transform:uppercase;border-bottom:2px solid #0f2a4a;padding-bottom:4px;margin-bottom:0;'>Earnings</div>
        <table style='width:100%;border-collapse:collapse;'>
          <tbody>
            <tr><td style='padding:5px 4px;border-bottom:1px solid #f3f4f6;'>Basic Pay</td><td style='padding:5px 4px;border-bottom:1px solid #f3f4f6;text-align:right;'>&#x00a3;{fmt(slip.GrossPay)}</td></tr>
          </tbody>
          <tfoot>
            <tr style='background:#f9fafb;'><td style='padding:7px 4px;border-top:2px solid #d1d5db;font-weight:700;'>Total Earnings</td><td style='padding:7px 4px;border-top:2px solid #d1d5db;text-align:right;font-weight:700;'>&#x00a3;{fmt(slip.GrossPay)}</td></tr>
          </tfoot>
        </table>
      </td>
      <td style='width:2%;'></td>
      <td style='width:49%;vertical-align:top;padding-left:10px;'>
        <div style='font-size:7.5pt;font-weight:700;color:#0f2a4a;text-transform:uppercase;border-bottom:2px solid #0f2a4a;padding-bottom:4px;margin-bottom:0;'>Deductions</div>
        <table style='width:100%;border-collapse:collapse;'>
          <tbody>
            <tr><td style='padding:5px 4px;border-bottom:1px solid #f3f4f6;'>Income Tax (Code {slip.TaxCode ?? "1257L"})</td><td style='padding:5px 4px;border-bottom:1px solid #f3f4f6;text-align:right;'>&#x00a3;{fmt(slip.Tax)}</td></tr>
            <tr><td style='padding:5px 4px;border-bottom:1px solid #f3f4f6;'>National Insurance (Cat {slip.NiCategory ?? "A"})</td><td style='padding:5px 4px;border-bottom:1px solid #f3f4f6;text-align:right;'>&#x00a3;{fmt(slip.NationalInsurance)}</td></tr>
            {pensionRow}
          </tbody>
          <tfoot>
            <tr style='background:#f9fafb;'><td style='padding:7px 4px;border-top:2px solid #d1d5db;font-weight:700;'>Total Deductions</td><td style='padding:7px 4px;border-top:2px solid #d1d5db;text-align:right;font-weight:700;'>&#x00a3;{fmt(totalDeductions)}</td></tr>
          </tfoot>
        </table>
      </td>
    </tr>
  </table>

  <!-- Net Pay -->
  <table style='width:100%;border-collapse:collapse;margin-bottom:12px;'>
    <tr>
      <td style='width:49%;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;vertical-align:middle;'>
        <div style='font-size:7.5pt;color:#6b7280;margin-bottom:3px;'>Net Pay (Amount Paid)</div>
        <div style='font-size:18pt;font-weight:700;color:#166534;'>&#x00a3;{fmt(slip.NetPay)}</div>
      </td>
      <td style='width:2%;'></td>
      <td style='width:49%;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;vertical-align:middle;'>
        <div style='font-size:7.5pt;color:#6b7280;margin-bottom:3px;'>Payment Method</div>
        <div style='font-size:12pt;font-weight:700;color:#374151;'>BACS</div>
        <div style='font-size:8pt;color:#6b7280;margin-top:4px;'>Annual Salary: <strong style='color:#374151;'>&#x00a3;{annSalary.ToString("N2")}</strong></div>
      </td>
    </tr>
  </table>

  <!-- YTD Running Totals -->
  <div style='font-size:7.5pt;font-weight:700;color:#0f2a4a;text-transform:uppercase;border-bottom:2px solid #0f2a4a;padding-bottom:4px;margin-bottom:7px;'>Tax Year to Date &#x2014; Running Totals</div>
  <table style='width:100%;border-collapse:collapse;margin-bottom:12px;'>
    <thead>
      <tr style='background:#f3f4f6;'>
        <th style='padding:5px 8px;text-align:left;font-size:8pt;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;'>YTD Gross Pay</th>
        <th style='padding:5px 8px;text-align:right;font-size:8pt;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;'>YTD Income Tax</th>
        <th style='padding:5px 8px;text-align:right;font-size:8pt;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;'>YTD Employee NI</th>
        <th style='padding:5px 8px;text-align:right;font-size:8pt;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;'>YTD Employer NI</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style='padding:6px 8px;font-weight:600;'>&#x00a3;{fmt(slip.YtdGross)}</td>
        <td style='padding:6px 8px;text-align:right;'>&#x00a3;{fmt(slip.YtdTax)}</td>
        <td style='padding:6px 8px;text-align:right;'>&#x00a3;{fmt(slip.YtdEmployeeNi)}</td>
        <td style='padding:6px 8px;text-align:right;'>&#x00a3;{fmt(slip.YtdEmployerNi)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Employer Contributions -->
  <div style='font-size:7.5pt;font-weight:700;color:#92400e;text-transform:uppercase;border-bottom:2px solid #f59e0b;padding-bottom:4px;margin-bottom:7px;'>Employer Contributions (Company Cost &#x2014; Not Deducted From Employee)</div>
  <table style='width:100%;border-collapse:collapse;margin-bottom:8px;'>
    <thead>
      <tr style='background:#fef3c7;'>
        <th style='width:50%;padding:5px 8px;text-align:left;font-size:8pt;color:#92400e;font-weight:600;border-bottom:1px solid #fde68a;'>Description</th>
        <th style='width:20%;padding:5px 8px;text-align:right;font-size:8pt;color:#92400e;font-weight:600;border-bottom:1px solid #fde68a;'>This Period</th>
        <th style='width:30%;padding:5px 8px;text-align:left;font-size:8pt;color:#92400e;font-weight:600;border-bottom:1px solid #fde68a;'>Payment Due</th>
      </tr>
    </thead>
    <tbody>
      <tr><td style='padding:6px 8px;border-bottom:1px solid #fef9c3;color:#78350f;'>Employer National Insurance (Cat {slip.NiCategory ?? "A"})</td><td style='padding:6px 8px;border-bottom:1px solid #fef9c3;color:#78350f;text-align:right;'>&#x00a3;{fmt(slip.EmployerNi)}</td><td style='padding:6px 8px;border-bottom:1px solid #fef9c3;color:#a07000;'>HMRC by 22nd {nextMo}</td></tr>
      {erPensionRow}
    </tbody>
    <tfoot>
      <tr style='background:#fef3c7;'>
        <td style='padding:7px 8px;border-top:2px solid #f59e0b;font-weight:700;color:#92400e;'>Total Employer Contributions</td>
        <td style='padding:7px 8px;border-top:2px solid #f59e0b;font-weight:700;color:#92400e;text-align:right;'>&#x00a3;{fmt((slip.EmployerNi ?? 0m) + (slip.Pension ?? 0m))}</td>
        <td style='border-top:2px solid #f59e0b;'></td>
      </tr>
    </tfoot>
  </table>
  <div style='font-size:8pt;color:#9ca3af;margin-top:5px;'>Pay HMRC: <strong style='color:#374151;'>Ref {aor}</strong> &nbsp;&middot;&nbsp; Sort code <strong style='color:#374151;'>08-32-10</strong> &nbsp;&middot;&nbsp; Account <strong style='color:#374151;'>12001039</strong></div>

  <div style='margin-top:16px;font-size:7.5pt;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:8px;'>
    {compName}{(string.IsNullOrWhiteSpace(compAddr) ? "" : " &nbsp;&middot;&nbsp; " + compAddr)}<br/>
    Employer PAYE Ref: <strong style='color:#374151;'>{payeRef}</strong> &nbsp;&middot;&nbsp; Generated {genDate} UTC
  </div>
</div>
</body></html>";

        }

        // ── Get BACS rows as JSON (for modal) ─────────────────────────────────

        [Function("GetBacsRows")]
        public async Task<HttpResponseData> GetBacsRows(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "payroll/runs/{id:int}/bacs/rows")] HttpRequestData req,
            int id)
        {
            if (_db == null)
            {
                var r = req.CreateResponse(HttpStatusCode.InternalServerError);
                await r.WriteAsJsonAsync(new { error = "Database not available" });
                return r;
            }

            var run = await _db.PayrollRuns.FindAsync(id);
            if (run == null)
            {
                var r = req.CreateResponse(HttpStatusCode.NotFound);
                await r.WriteAsJsonAsync(new { error = "Payroll run not found" });
                return r;
            }

            var payslips  = await _db.Payslips.Where(p => p.PayrollRunId == id).ToListAsync();
            var empIds    = payslips.Select(p => p.EmployeeId).Distinct().ToList();
            var employees = await _db.Employees.Where(e => empIds.Contains(e.Id)).ToListAsync();
            var settings  = await _db.PayrollSettings.FirstOrDefaultAsync();
            var monthName = run.PayDate.ToString("MMMM yyyy", CultureInfo.InvariantCulture);

            var rows = new List<object>();

            foreach (var slip in payslips)
            {
                var emp = employees.FirstOrDefault(e => e.Id == slip.EmployeeId);
                var hasBankDetails = !string.IsNullOrWhiteSpace(emp?.BankSortCode)
                                  && !string.IsNullOrWhiteSpace(emp?.BankAccountNumber);
                rows.Add(new
                {
                    name           = emp?.Name ?? $"Employee #{slip.EmployeeId}",
                    sortCode       = FormatSortCode(emp?.BankSortCode),
                    accountNumber  = emp?.BankAccountNumber ?? "",
                    amount         = (slip.NetPay ?? 0m).ToString("N2"),
                    reference      = $"SALARY {monthName}",
                    hasBankDetails,
                    isHmrc         = false
                });
            }

            var totalPaye       = run.TotalTax ?? 0m;
            var totalEmployeeNi = run.TotalEmployeeNi ?? 0m;
            var totalEmployerNi = run.TotalEmployerNi ?? 0m;
            var totalHmrc       = totalPaye + totalEmployeeNi + totalEmployerNi;
            var aor             = settings?.AccountsOfficeReference ?? "—";

            rows.Add(new
            {
                name           = "HMRC",
                sortCode       = "08-32-10",
                accountNumber  = "12001039",
                amount         = totalHmrc.ToString("N2"),
                reference      = aor,
                hasBankDetails = true,
                isHmrc         = true
            });

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(new { rows });
            return ok;
        }

        // ── Download BACS CSV ──────────────────────────────────────────────────

        [Function("DownloadBacsCsv")]
        public async Task<HttpResponseData> DownloadBacsCsv(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "payroll/runs/{id:int}/bacs")] HttpRequestData req,
            int id)
        {
            if (_db == null)
            {
                var r = req.CreateResponse(HttpStatusCode.InternalServerError);
                await r.WriteAsJsonAsync(new { error = "Database not available" });
                return r;
            }

            var run = await _db.PayrollRuns.FindAsync(id);
            if (run == null)
            {
                var r = req.CreateResponse(HttpStatusCode.NotFound);
                await r.WriteAsJsonAsync(new { error = "Payroll run not found" });
                return r;
            }

            var payslips  = await _db.Payslips.Where(p => p.PayrollRunId == id).ToListAsync();
            var empIds    = payslips.Select(p => p.EmployeeId).Distinct().ToList();
            var employees = await _db.Employees.Where(e => empIds.Contains(e.Id)).ToListAsync();
            var settings  = await _db.PayrollSettings.FirstOrDefaultAsync();

            var csvBytes = GenerateBacsCsv(payslips, employees, run, settings);
            var fileName = $"BACS-{run.PayDate:yyyy-MM}.csv";

            var ok = req.CreateResponse(HttpStatusCode.OK);
            ok.Headers.Add("Content-Type", "text/csv");
            ok.Headers.Add("Content-Disposition", $"attachment; filename=\"{fileName}\"");
            await ok.Body.WriteAsync(csvBytes, 0, csvBytes.Length);
            return ok;
        }

        private static byte[] GenerateBacsCsv(List<Payslip> payslips, List<Employee> employees, PayrollRun run, PayrollSettings? settings)
        {
            var sb        = new System.Text.StringBuilder();
            var monthName = run.PayDate.ToString("MMMM yyyy", CultureInfo.InvariantCulture);

            sb.AppendLine("Name,Sort Code,Account Number,Amount,Reference");

            foreach (var slip in payslips)
            {
                var emp = employees.FirstOrDefault(e => e.Id == slip.EmployeeId);
                sb.AppendLine(string.Join(",", new[]
                {
                    CsvEscape(emp?.Name ?? $"Employee #{slip.EmployeeId}"),
                    CsvEscape(FormatSortCode(emp?.BankSortCode)),
                    CsvEscape(emp?.BankAccountNumber ?? ""),
                    (slip.NetPay ?? 0m).ToString("N2"),
                    CsvEscape($"SALARY {monthName}")
                }));
            }

            var totalPaye       = run.TotalTax ?? 0m;
            var totalEmployeeNi = run.TotalEmployeeNi ?? 0m;
            var totalEmployerNi = run.TotalEmployerNi ?? 0m;
            var totalHmrc       = totalPaye + totalEmployeeNi + totalEmployerNi;
            var aor             = settings?.AccountsOfficeReference ?? "";

            sb.AppendLine(string.Join(",", new[]
            {
                "HMRC",
                "08-32-10",
                "12001039",
                totalHmrc.ToString("N2"),
                CsvEscape(aor)
            }));

            return System.Text.Encoding.UTF8.GetBytes(sb.ToString());
        }

        private static string FormatSortCode(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            var digits = new string(raw.Where(char.IsDigit).ToArray());
            if (digits.Length == 6)
                return $"{digits[..2]}-{digits[2..4]}-{digits[4..6]}";
            return raw;
        }

        private static string CsvEscape(string? val)
        {
            if (val == null) return "";
            if (val.Contains(',') || val.Contains('"') || val.Contains('\n'))
                return $"\"{val.Replace("\"", "\"\"")}\"";
            return val;
        }
    }
}
