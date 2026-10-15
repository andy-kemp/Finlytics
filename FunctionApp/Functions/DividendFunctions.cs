using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Globalization;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Services;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FinanceHubFunctions.Functions
{
    public class DividendFunctions
    {
        private readonly FinanceHubDbContext _db;
        private readonly EmailService? _emailService;
        private readonly IPayrollSettingsRepository? _payrollSettingsRepo;
        private readonly BlobStorageService? _blobStorage;
        private readonly DeletionGuardService? _guard;

        public DividendFunctions(
            FinanceHubDbContext db,
            EmailService? emailService = null,
            IPayrollSettingsRepository? payrollSettingsRepo = null,
            BlobStorageService? blobStorage = null,
            DeletionGuardService? guard = null)
        {
            _db = db;
            _emailService = emailService;
            _payrollSettingsRepo = payrollSettingsRepo;
            _blobStorage = blobStorage;
            _guard = guard;
        }

        // ─── GET /api/dividends ───────────────────────────────────────────────
        [Function("GetDividends")]
        public async Task<HttpResponseData> GetDividends(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dividends")] HttpRequestData req)
        {
            try
            {
                var declarations = await _db.DividendDeclarations
                    .OrderByDescending(d => d.CreatedDate)
                    .ToListAsync();

                // Attach allocation counts for the list view
                var ids = declarations.Select(d => d.Id).ToList();
                var countsByDeclaration = await _db.DividendAllocations
                    .Where(a => ids.Contains(a.DividendDeclarationId))
                    .GroupBy(a => a.DividendDeclarationId)
                    .Select(g => new { Id = g.Key, Count = g.Count() })
                    .ToDictionaryAsync(x => x.Id, x => x.Count);

                var result = declarations.Select(d => new
                {
                    d.Id, d.DividendRef, d.DividendType, d.ShareClass,
                    d.MeetingDate, d.RecordDate, d.PaymentDate,
                    d.AmountPerShare, d.TotalAmount, d.Status,
                    d.DirectorName, d.CreatedDate, d.FinalisedDate,
                    AllocationCount = countsByDeclaration.GetValueOrDefault(d.Id, 0)
                });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─── POST /api/dividends ──────────────────────────────────────────────
        [Function("CreateDividend")]
        public async Task<HttpResponseData> CreateDividend(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dividends")] HttpRequestData req)
        {
            try
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var declaration = await JsonSerializer.DeserializeAsync<DividendDeclaration>(req.Body, options);
                if (declaration == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Invalid request body.");
                    return bad;
                }

                declaration.Status = "Draft";
                declaration.CreatedDate = DateTime.UtcNow;
                declaration.FinalisedDate = null;

                // Auto-generate DividendRef if not supplied
                if (string.IsNullOrWhiteSpace(declaration.DividendRef))
                {
                    var year = declaration.MeetingDate.Year;
                    var count = await _db.DividendDeclarations
                        .CountAsync(d => d.MeetingDate.Year == year) + 1;
                    declaration.DividendRef = $"DIV-{year}-{count:D3}";
                }

                _db.DividendDeclarations.Add(declaration);
                await _db.SaveChangesAsync();

                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(declaration);
                return response;
            }
            catch (Exception ex)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─── GET /api/dividends/{id} ──────────────────────────────────────────
        [Function("GetDividendById")]
        public async Task<HttpResponseData> GetDividendById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dividends/{id:int}")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _db.DividendDeclarations.FindAsync(id);
                if (declaration == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "Dividend declaration not found." });
                    return notFound;
                }

                declaration.Allocations = await _db.DividendAllocations
                    .Where(a => a.DividendDeclarationId == id)
                    .OrderBy(a => a.ShareholderName)
                    .ToListAsync();

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(declaration);
                return response;
            }
            catch (Exception ex)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─── PUT /api/dividends/{id} ──────────────────────────────────────────
        // Updates the declaration header AND replaces all allocations atomically
        [Function("UpdateDividend")]
        public async Task<HttpResponseData> UpdateDividend(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "dividends/{id:int}")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _db.DividendDeclarations.FindAsync(id);
                if (declaration == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "Dividend declaration not found." });
                    return notFound;
                }
                if (declaration.Status == "Finalised")
                {
                    var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                    await conflict.WriteAsJsonAsync(new { error = "Cannot edit a finalised dividend." });
                    return conflict;
                }

                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var incoming = await JsonSerializer.DeserializeAsync<DividendDeclaration>(req.Body, options);
                if (incoming == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Invalid request body.");
                    return bad;
                }

                // Update header fields
                declaration.DividendType = incoming.DividendType;
                declaration.ShareClass = incoming.ShareClass;
                declaration.MeetingDate = incoming.MeetingDate;
                declaration.MeetingLocation = incoming.MeetingLocation;
                declaration.RecordDate = incoming.RecordDate;
                declaration.PaymentDate = incoming.PaymentDate;
                declaration.AmountPerShare = incoming.AmountPerShare;
                declaration.DirectorName = incoming.DirectorName;
                declaration.Notes = incoming.Notes;

                // Replace allocations
                if (incoming.Allocations?.Count > 0)
                {
                    var existing = _db.DividendAllocations.Where(a => a.DividendDeclarationId == id);
                    _db.DividendAllocations.RemoveRange(existing);

                    decimal total = 0;
                    var refBase = declaration.DividendRef.Replace("DIV-", ""); // e.g. "2026-001"

                    foreach (var alloc in incoming.Allocations)
                    {
                        alloc.Id = 0;
                        alloc.DividendDeclarationId = id;
                        alloc.TotalAmount = Math.Round(alloc.NumberOfShares * alloc.AmountPerShare, 2);

                        // VoucherRef: DV{classLetter}-{year}-{seqNum}-{initials}
                        // e.g. DVA-2026-001-AK  (class A Ordinary, Andrew Kemp)
                        var classLetter = string.IsNullOrWhiteSpace(alloc.ShareClass)
                            ? "X"
                            : alloc.ShareClass.Trim().Substring(0, 1).ToUpper();
                        var initials = GetShareholderInitials(alloc.ShareholderName);
                        alloc.VoucherRef = $"DV{classLetter}-{refBase}-{initials}";

                        total += alloc.TotalAmount;
                        _db.DividendAllocations.Add(alloc);
                    }
                    declaration.TotalAmount = total;
                }

                await _db.SaveChangesAsync();

                declaration.Allocations = await _db.DividendAllocations
                    .Where(a => a.DividendDeclarationId == id)
                    .OrderBy(a => a.ShareholderName)
                    .ToListAsync();

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(declaration);
                return response;
            }
            catch (Exception ex)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─── DELETE /api/dividends/{id} ───────────────────────────────────────
        [Function("DeleteDividend")]
        public async Task<HttpResponseData> DeleteDividend(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "dividends/{id:int}")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _db.DividendDeclarations.FindAsync(id);
                if (declaration == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                // Check deletion guard: AllowDataDeletion (master) OR AllowDividendDeletion (legacy dividend-specific) must be enabled.
                // Draft dividends still require at least one flag — this protects test/prod data integrity.
                var companySettings = await _db.CompanySettings.FirstOrDefaultAsync();
                bool deletionPermitted = companySettings?.AllowDataDeletion == true || companySettings?.AllowDividendDeletion == true;

                if (!deletionPermitted)
                {
                    var forbidden = req.CreateResponse(HttpStatusCode.Forbidden);
                    await forbidden.WriteAsJsonAsync(new { error = "Deletion is disabled. Enable 'Allow Data Deletion' (or 'Allow Dividend Deletion') in Settings → Company → Compliance & Audit to delete dividend records." });
                    return forbidden;
                }

                // Finalised dividends also require explicit opt-in (protects ledger integrity).
                if (declaration.Status == "Finalised" && companySettings?.AllowDividendDeletion != true && companySettings?.AllowDataDeletion != true)
                {
                    var forbidden = req.CreateResponse(HttpStatusCode.Forbidden);
                    await forbidden.WriteAsJsonAsync(new { error = "Cannot delete a finalised dividend. Enable 'Allow Dividend Deletion' in Company Settings → Compliance to permit this action." });
                    return forbidden;
                }

                // Load allocations for ALL deletion paths.
                // EF ignores the navigation property so we must remove them explicitly —
                // never rely on DB-level cascade which may not be configured.
                var allocations = await _db.DividendAllocations
                    .Where(a => a.DividendDeclarationId == id)
                    .ToListAsync();

                // Finalised path: also clean up linked ledger entries
                if (declaration.Status == "Finalised")
                {
                    // Remove per-allocation Dividend_Paid ledger entries
                    foreach (var alloc in allocations)
                    {
                        if (alloc.LedgerEntryId.HasValue)
                        {
                            var ledgerEntry = await _db.CompanyLedger.FindAsync(alloc.LedgerEntryId.Value);
                            if (ledgerEntry != null)
                                _db.CompanyLedger.Remove(ledgerEntry);
                        }
                    }

                    // Remove the top-level Dividend_Declared ledger entry
                    var declaredEntry = await _db.CompanyLedger
                        .Where(e => e.Title != null && e.Title.Contains(declaration.DividendRef) && e.EntryType == "Dividend_Declared")
                        .FirstOrDefaultAsync();
                    if (declaredEntry != null)
                        _db.CompanyLedger.Remove(declaredEntry);
                }

                // Explicitly remove allocations first (avoids FK constraint violations)
                if (allocations.Count > 0)
                    _db.DividendAllocations.RemoveRange(allocations);

                _db.DividendDeclarations.Remove(declaration);
                await _db.SaveChangesAsync();
                return req.CreateResponse(HttpStatusCode.NoContent);
            }
            catch (Exception ex)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─── POST /api/dividends/{id}/finalise ───────────────────────────────
        // Creates Dividend_Declared + per-shareholder Dividend_Paid ledger entries,
        // then emails the BAC CSV to the payroll email address.
        [Function("FinaliseDividend")]
        public async Task<HttpResponseData> FinaliseDividend(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dividends/{id:int}/finalise")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _db.DividendDeclarations.FindAsync(id);
                if (declaration == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "Dividend declaration not found." });
                    return notFound;
                }
                if (declaration.Status == "Finalised")
                {
                    var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                    await conflict.WriteAsJsonAsync(new { error = "Dividend is already finalised." });
                    return conflict;
                }

                var allocations = await _db.DividendAllocations
                    .Where(a => a.DividendDeclarationId == id)
                    .ToListAsync();

                if (allocations.Count == 0)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Cannot finalise — no allocations exist." });
                    return bad;
                }

                // Companies Act 2006 s830: dividends may only be paid from distributable profits.
                // Records may not include opening reserves, so allow an explicit, noted override.
                var companySettings = await _db.CompanySettings.AsNoTracking().OrderBy(company => company.Id).FirstOrDefaultAsync();
                if (companySettings != null)
                {
                    var sources = new RecordedCashSources
                    {
                        Invoices = await _db.Invoices.AsNoTracking().ToListAsync(),
                        Expenses = await _db.Expenses.AsNoTracking().ToListAsync(),
                        DlaEntries = await _db.DlaEntries.AsNoTracking().ToListAsync(),
                        LedgerEntries = await _db.CompanyLedger.AsNoTracking().ToListAsync(),
                        PayrollSettings = await _db.PayrollSettings.AsNoTracking().ToListAsync(),
                        PayrollRuns = await _db.PayrollRuns.AsNoTracking().ToListAsync()
                    };
                    var reserves = TaxPotEmailPolicy.DistributableReserves(sources, companySettings, declaration.MeetingDate.Date.AddDays(1).AddTicks(-1));
                    if (declaration.TotalAmount > reserves)
                    {
                        var confirmed = string.Equals(System.Web.HttpUtility.ParseQueryString(req.Url.Query)["confirmReserves"], "true", StringComparison.OrdinalIgnoreCase);
                        if (!confirmed)
                        {
                            var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                            await conflict.WriteAsJsonAsync(new
                            {
                                code = "InsufficientReserves",
                                error = $"This dividend of £{declaration.TotalAmount:N2} exceeds the distributable reserves of £{reserves:N2} " +
                                        "calculated from your recorded post-tax profits less dividends already declared. " +
                                        "Paying it could be unlawful unless the company has reserves not recorded in Finlytics.",
                                amount = declaration.TotalAmount,
                                availableReserves = reserves
                            });
                            return conflict;
                        }
                        declaration.Notes = $"{declaration.Notes}{(string.IsNullOrWhiteSpace(declaration.Notes) ? "" : "\n")}" +
                            $"Finalised on {DateTime.UtcNow:dd/MM/yyyy} with director confirmation that reserves are sufficient; " +
                            $"recorded distributable reserves were £{reserves:N2}.";
                    }
                }

                var periodKey = declaration.PaymentDate.ToString("yyyy-MM");
                var taxYear = declaration.PaymentDate.Month >= 4
                    ? declaration.PaymentDate.Year
                    : declaration.PaymentDate.Year - 1;
                var financialYear = $"FY{taxYear}/{(taxYear + 1) % 100:D2}";

                // 1. Create Dividend_Declared ledger entry
                var declaredEntry = new CompanyLedgerEntry
                {
                    Title = $"{declaration.DividendType} Dividend Declared — {declaration.DividendRef}",
                    EntryType = "Dividend_Declared",
                    Amount = declaration.TotalAmount,
                    EffectiveDate = declaration.MeetingDate,
                    Notes = $"{declaration.DividendRef}: {declaration.ShareClass} shares @ £{declaration.AmountPerShare:F4}/share. " +
                            $"Meeting: {declaration.MeetingDate:dd/MM/yyyy} at {declaration.MeetingLocation ?? "registered office"}.",
                    PeriodKey = periodKey,
                    TaxYear = taxYear,
                    FinancialYear = financialYear
                };
                _db.CompanyLedger.Add(declaredEntry);
                await _db.SaveChangesAsync();

                // 2. Create Dividend_Paid ledger entries per shareholder
                foreach (var alloc in allocations)
                {
                    var paidEntry = new CompanyLedgerEntry
                    {
                        Title = $"Dividend Paid — {alloc.VoucherRef ?? declaration.DividendRef} — {alloc.ShareholderName}",
                        EntryType = "Dividend_Paid",
                        Amount = alloc.TotalAmount,
                        EffectiveDate = declaration.PaymentDate,
                        Notes = $"{alloc.NumberOfShares:N0} {alloc.ShareClass} shares × £{alloc.AmountPerShare:F4} = £{alloc.TotalAmount:F2}",
                        PeriodKey = periodKey,
                        TaxYear = taxYear,
                        FinancialYear = financialYear
                    };
                    _db.CompanyLedger.Add(paidEntry);
                    await _db.SaveChangesAsync();
                    alloc.LedgerEntryId = paidEntry.Id;
                }

                // 3. Mark declaration as finalised
                declaration.Status = "Finalised";
                declaration.FinalisedDate = DateTime.UtcNow;
                await _db.SaveChangesAsync();

                // 4. Build BAC CSV
                var csvBytes = BuildBacCsv(declaration, allocations);

                // 5. Email to payroll email
                string? payrollEmail = null;
                if (_payrollSettingsRepo != null && _emailService != null)
                {
                    try
                    {
                        var settings = await _payrollSettingsRepo.GetAsync();
                        payrollEmail = settings?.PayrollEmail;

                        if (!string.IsNullOrWhiteSpace(payrollEmail))
                        {
                            var accessToken = FinanceHubFunctions.Helpers.AuthHelper.GetAccessToken(req) ?? "";
                            await _emailService.SendBacPaymentEmailAsync(
                                toEmail: payrollEmail,
                                dividendRef: declaration.DividendRef,
                                dividendType: declaration.DividendType,
                                shareClass: declaration.ShareClass,
                                paymentDate: declaration.PaymentDate,
                                totalAmount: declaration.TotalAmount,
                                shareholderCount: allocations.Count,
                                csvBytes: csvBytes,
                                accessToken: accessToken);
                        }
                    }
                    catch (Exception emailEx)
                    {
                        Console.WriteLine($"[DividendFunctions] BAC email warning: {emailEx.Message}");
                        // Non-fatal — dividend is finalised, email is best-effort
                    }
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    success = true,
                    message = $"Dividend {declaration.DividendRef} finalised successfully.",
                    dividendRef = declaration.DividendRef,
                    totalAmount = declaration.TotalAmount,
                    allocationCount = allocations.Count,
                    ledgerEntriesCreated = allocations.Count + 1,
                    bacEmailSentTo = payrollEmail ?? "(no payroll email configured)"
                });
                return response;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DividendFunctions] FinaliseDividend ERROR: {ex}");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─── GET /api/dividends/{id}/minutes-pdf ──────────────────────────────
        [Function("GetDividendMinutesPdf")]
        public async Task<HttpResponseData> GetDividendMinutesPdf(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dividends/{id:int}/minutes-pdf")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _db.DividendDeclarations.FindAsync(id);
                if (declaration == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                var company = await _db.CompanySettings.FirstOrDefaultAsync();

                // Load company logo
                byte[]? logoBytes = null;
                string? logoMime = null;
                if (_blobStorage != null && company != null)
                {
                    try
                    {
                        if (!string.IsNullOrWhiteSpace(company.DocumentLogoUrl))
                        {
                            var (b, m) = await _blobStorage.GetLogoBytesFromUrlAsync(company.DocumentLogoUrl);
                            logoBytes = b; logoMime = m;
                        }
                        if (logoBytes == null)
                        {
                            (logoBytes, logoMime) = await _blobStorage.GetLogoAsync(company.Id);
                        }
                    }
                    catch { /* non-fatal */ }
                }

                var allocs = await _db.DividendAllocations
                    .Where(a => a.DividendDeclarationId == id)
                    .ToListAsync();

                var pdfBytes = GenerateBoardMinutesPdf(declaration, company, logoBytes, allocs);

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/pdf");
                response.Headers.Add("Content-Disposition",
                    $"attachment; filename=\"{declaration.DividendRef}-Board-Minutes.pdf\"");
                await response.Body.WriteAsync(pdfBytes);
                return response;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DividendFunctions] GetDividendMinutesPdf ERROR: {ex}");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message, detail = ex.ToString() });
                return err;
            }
        }

        // ─── GET /api/dividends/{id}/voucher-pdf/{allocationId} ───────────────
        [Function("GetDividendVoucherPdf")]
        public async Task<HttpResponseData> GetDividendVoucherPdf(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dividends/{id:int}/voucher-pdf/{allocationId:int}")] HttpRequestData req,
            int id,
            int allocationId)
        {
            try
            {
                var declaration = await _db.DividendDeclarations.FindAsync(id);
                if (declaration == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                var alloc = await _db.DividendAllocations
                    .FirstOrDefaultAsync(a => a.Id == allocationId && a.DividendDeclarationId == id);
                if (alloc == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                var company = await _db.CompanySettings.FirstOrDefaultAsync();

                byte[]? logoBytes = null;
                string? logoMime = null;
                if (_blobStorage != null && company != null)
                {
                    try
                    {
                        if (!string.IsNullOrWhiteSpace(company.DocumentLogoUrl))
                        {
                            var (b, m) = await _blobStorage.GetLogoBytesFromUrlAsync(company.DocumentLogoUrl);
                            logoBytes = b; logoMime = m;
                        }
                        if (logoBytes == null)
                        {
                            (logoBytes, logoMime) = await _blobStorage.GetLogoAsync(company.Id);
                        }
                    }
                    catch { /* non-fatal */ }
                }

                var pdfBytes = GenerateDividendVoucherPdf(declaration, alloc, company, logoBytes);

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/pdf");
                response.Headers.Add("Content-Disposition",
                    $"attachment; filename=\"{alloc.VoucherRef ?? declaration.DividendRef}-Voucher-{SanitiseFilename(alloc.ShareholderName)}.pdf\"");
                await response.Body.WriteAsync(pdfBytes);
                return response;
            }
            catch (Exception ex)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─── POST /api/dividends/{id}/email-voucher/{allocationId} ───────────
        [Function("EmailDividendVoucher")]
        public async Task<HttpResponseData> EmailDividendVoucher(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dividends/{id:int}/email-voucher/{allocationId:int}")] HttpRequestData req,
            int id,
            int allocationId)
        {
            try
            {
                var accessToken = FinanceHubFunctions.Helpers.AuthHelper.GetAccessToken(req) ?? "";

                var declaration = await _db.DividendDeclarations.FindAsync(id);
                if (declaration == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                var alloc = await _db.DividendAllocations
                    .FirstOrDefaultAsync(a => a.Id == allocationId && a.DividendDeclarationId == id);
                if (alloc == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                // Resolve email: prefer request body override, then Shareholders table
                string? toEmail = null;
                try
                {
                    var body = await new System.IO.StreamReader(req.Body).ReadToEndAsync();
                    if (!string.IsNullOrWhiteSpace(body))
                    {
                        var payload = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(body);
                        if (payload.TryGetProperty("email", out var emailProp))
                            toEmail = emailProp.GetString();
                    }
                }
                catch { /* ignore body parse errors */ }

                if (string.IsNullOrWhiteSpace(toEmail) && alloc.ShareholderId.HasValue)
                {
                    var sh = await _db.Set<Shareholder>().FindAsync(alloc.ShareholderId.Value);
                    toEmail = sh?.Email;
                }

                if (string.IsNullOrWhiteSpace(toEmail))
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "No email address found for this shareholder. Please provide one." });
                    return bad;
                }

                if (_emailService == null)
                {
                    var errResp = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errResp.WriteAsJsonAsync(new { error = "Email service not configured." });
                    return errResp;
                }

                var company = await _db.CompanySettings.FirstOrDefaultAsync();
                byte[]? logoBytes = null;
                if (_blobStorage != null && company != null)
                {
                    try
                    {
                        if (!string.IsNullOrWhiteSpace(company.DocumentLogoUrl))
                        {
                            var (b, _) = await _blobStorage.GetLogoBytesFromUrlAsync(company.DocumentLogoUrl);
                            logoBytes = b;
                        }
                        if (logoBytes == null)
                        {
                            (logoBytes, _) = await _blobStorage.GetLogoAsync(company.Id);
                        }
                    }
                    catch { /* non-fatal */ }
                }
                var pdfBytes = GenerateDividendVoucherPdf(declaration, alloc, company, logoBytes);

                var result = await _emailService.SendDividendVoucherEmailAsync(
                    toEmail: toEmail,
                    shareholderName: alloc.ShareholderName,
                    voucherRef: alloc.VoucherRef ?? declaration.DividendRef,
                    shareClass: alloc.ShareClass,
                    numberOfShares: alloc.NumberOfShares,
                    amountPerShare: alloc.AmountPerShare,
                    totalAmount: alloc.TotalAmount,
                    paymentDate: declaration.PaymentDate,
                    pdfBytes: pdfBytes,
                    accessToken: accessToken
                );

                if (!result.Success)
                {
                    var errResp = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errResp.WriteAsJsonAsync(new { error = result.Error ?? "Failed to send voucher email." });
                    return errResp;
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { message = $"Voucher emailed to {toEmail}", toEmail });
                return response;
            }
            catch (Exception ex)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // BAC CSV builder
        // ─────────────────────────────────────────────────────────────────────
        private static byte[] BuildBacCsv(DividendDeclaration declaration, List<DividendAllocation> allocations)
        {
            var sb = new StringBuilder();
            sb.AppendLine("\"Name\",\"Sort Code\",\"Account Number\",\"Reference\",\"Amount\"");

            foreach (var alloc in allocations)
            {
                sb.AppendLine(
                    $"\"{EscCsv(alloc.BankAccountName ?? alloc.ShareholderName)}\"," +
                    $"\"{EscCsv(alloc.SortCode ?? "")}\"," +
                    $"\"{EscCsv(alloc.AccountNumber ?? "")}\"," +
                    $"\"{EscCsv(alloc.VoucherRef ?? declaration.DividendRef)}\"," +
                    $"\"{alloc.TotalAmount:F2}\"");
            }

            return Encoding.UTF8.GetBytes(sb.ToString());
        }

        private static string EscCsv(string val) => val?.Replace("\"", "\"\"") ?? "";

        // ─────────────────────────────────────────────────────────────────────
        // Board Minutes PDF (QuestPDF)
        // ─────────────────────────────────────────────────────────────────────
        private static byte[] GenerateBoardMinutesPdf(
            DividendDeclaration declaration,
            CompanySettings? company,
            byte[]? logoBytes,
            List<DividendAllocation>? allocations = null)
        {
            QuestPDF.Settings.License = LicenseType.Community;

            var companyName = company?.CompanyName ?? "The Company";
            var regNumber = company?.CompanyRegistrationNumber ?? "";
            var address = company?.CompanyAddress ?? company?.Address ?? "";

            // Extract signature image bytes from the base64/data-URL stored in company settings
            byte[]? signatureBytes = null;
            var sigDataUrl = company?.DirectorSignature;
            if (!string.IsNullOrWhiteSpace(sigDataUrl))
            {
                try
                {
                    var base64 = sigDataUrl.Contains(",") ? sigDataUrl.Split(',')[1] : sigDataUrl;
                    signatureBytes = Convert.FromBase64String(base64);
                }
                catch { /* ignore — fall back to text line */ }
            }

            return Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(35, Unit.Point);
                    page.DefaultTextStyle(x => x.FontSize(10).FontFamily("Arial"));

                    page.Header().Column(headerCol =>
                    {
                        headerCol.Item().Row(row =>
                        {
                            if (logoBytes != null)
                            {
                                row.ConstantItem(70).PaddingRight(10).Image(logoBytes);
                            }
                            row.RelativeItem().Column(col =>
                            {
                                col.Item().Text(companyName).Bold().FontSize(16);
                                if (!string.IsNullOrEmpty(regNumber))
                                    col.Item().Text($"Company No. {regNumber}").FontSize(9).FontColor("#666666");
                                if (!string.IsNullOrEmpty(address))
                                    col.Item().Text(address).FontSize(9).FontColor("#666666");
                            });
                        });
                        headerCol.Item().PaddingTop(12).LineHorizontal(1).LineColor("#2563EB");
                    });

                    page.Content().PaddingTop(16).Column(col =>
                    {
                        // Title
                        col.Item().AlignCenter().Text("MINUTES OF A BOARD MEETING")
                            .Bold().FontSize(14);
                        col.Item().AlignCenter().Text($"OF THE DIRECTORS OF {companyName.ToUpper()}")
                            .FontSize(11);
                        col.Item().PaddingVertical(8).LineHorizontal(0.5f).LineColor("#DDDDDD");

                        // Meeting details
                        col.Item().PaddingVertical(6).Table(table =>
                        {
                            table.ColumnsDefinition(c => { c.ConstantColumn(120); c.RelativeColumn(); });
                            AddRow(table, "Date:", declaration.MeetingDate.ToString("dd MMMM yyyy"));
                            AddRow(table, "Place:", declaration.MeetingLocation ?? "Registered Office");
                            AddRow(table, "Present:", declaration.DirectorName ?? "(Director)");
                            AddRow(table, "Chairman:", declaration.DirectorName ?? "(Director)");
                        });

                        col.Item().PaddingVertical(8).LineHorizontal(0.5f).LineColor("#DDDDDD");

                        // Resolution body
                        col.Item().PaddingBottom(8).Text("IT WAS RESOLVED THAT:").Bold();

                        // Build per-share-class breakdown from allocations
                        if (allocations != null && allocations.Count > 0)
                        {
                            var shareGroups = allocations
                                .GroupBy(a => new { SC = a.ShareClass ?? "", Rate = a.AmountPerShare })
                                .Select(g => new
                                {
                                    ShareClass = g.Key.SC,
                                    AmountPerShare = g.Key.Rate,
                                    TotalShares = g.Sum(x => x.NumberOfShares),
                                    TotalAmount = g.Sum(x => x.TotalAmount)
                                })
                                .OrderBy(g => g.ShareClass)
                                .ToList();

                            if (shareGroups.Count == 1)
                            {
                                var grp = shareGroups[0];
                                col.Item().PaddingBottom(6).Text(text =>
                                {
                                    text.Span("A ");
                                    text.Span((declaration.DividendType ?? "Interim").ToUpper()).Bold();
                                    text.Span(" dividend be declared on the ");
                                    text.Span(grp.ShareClass.Length > 0 ? grp.ShareClass : (declaration.ShareClass ?? "Ordinary")).Bold();
                                    text.Span(" shares at the rate of ");
                                    text.Span($"£{grp.AmountPerShare:F4}").Bold();
                                    text.Span(" per share, amounting to a total of ");
                                    text.Span($"£{grp.TotalAmount:N2}").Bold().FontColor("#2563EB");
                                    text.Span(".");
                                });
                            }
                            else
                            {
                                col.Item().PaddingBottom(4).Text(text =>
                                {
                                    text.Span("A ");
                                    text.Span((declaration.DividendType ?? "Interim").ToUpper()).Bold();
                                    text.Span(" dividend be declared as follows:");
                                });
                                col.Item().PaddingBottom(8).Table(table =>
                                {
                                    table.ColumnsDefinition(c =>
                                    {
                                        c.RelativeColumn(3);
                                        c.RelativeColumn(2);
                                        c.RelativeColumn(2);
                                        c.RelativeColumn(2);
                                    });
                                    table.Cell().Background("#EFF6FF").Padding(5).Text("Share Class").Bold().FontSize(9).FontColor("#1E40AF");
                                    table.Cell().Background("#EFF6FF").Padding(5).AlignRight().Text("Shares").Bold().FontSize(9).FontColor("#1E40AF");
                                    table.Cell().Background("#EFF6FF").Padding(5).AlignRight().Text("Rate/Share").Bold().FontSize(9).FontColor("#1E40AF");
                                    table.Cell().Background("#EFF6FF").Padding(5).AlignRight().Text("Amount").Bold().FontSize(9).FontColor("#1E40AF");
                                    foreach (var grp in shareGroups)
                                    {
                                        table.Cell().BorderBottom(0.5f).BorderColor("#E2E8F0").Padding(5).Text(grp.ShareClass).FontSize(9);
                                        table.Cell().BorderBottom(0.5f).BorderColor("#E2E8F0").Padding(5).AlignRight().Text($"{grp.TotalShares:N0}").FontSize(9);
                                        table.Cell().BorderBottom(0.5f).BorderColor("#E2E8F0").Padding(5).AlignRight().Text($"£{grp.AmountPerShare:F4}").FontSize(9);
                                        table.Cell().BorderBottom(0.5f).BorderColor("#E2E8F0").Padding(5).AlignRight().Text($"£{grp.TotalAmount:N2}").Bold().FontSize(9).FontColor("#2563EB");
                                    }
                                });
                            }
                        }
                        else
                        {
                            // Fallback: no allocations loaded
                            col.Item().PaddingBottom(6).Text(text =>
                            {
                                text.Span("A ");
                                text.Span((declaration.DividendType ?? "Interim").ToUpper()).Bold();
                                text.Span(" dividend be declared on the ");
                                text.Span(declaration.ShareClass ?? "Ordinary").Bold();
                                text.Span(" shares of the company at the rate of ");
                                text.Span($"£{declaration.AmountPerShare:F4}").Bold();
                                text.Span(" per share.");
                            });
                        }

                        col.Item().PaddingBottom(6).Text(text =>
                        {
                            text.Span("The dividend shall be payable on ");
                            text.Span(declaration.PaymentDate.ToString("dd MMMM yyyy")).Bold();
                            text.Span(" to shareholders registered on the record date of ");
                            text.Span(declaration.RecordDate.ToString("dd MMMM yyyy")).Bold();
                            text.Span(".");
                        });

                        col.Item().PaddingBottom(6).Text(text =>
                        {
                            text.Span("The total amount of the dividend shall be ");
                            text.Span($"£{declaration.TotalAmount:N2}").Bold().FontColor("#2563EB");
                            text.Span(".");
                        });

                        col.Item().PaddingBottom(6).Text(text =>
                        {
                            text.Span("The directors confirm that, having regard to the company's financial position, " +
                                      "there are sufficient distributable reserves to support this dividend, and that it is in the best " +
                                      "interests of the company to declare it at this time.");
                        });

                        col.Item().PaddingVertical(8).LineHorizontal(0.5f).LineColor("#DDDDDD");

                        col.Item().PaddingBottom(6).Text("THERE BEING NO FURTHER BUSINESS the meeting was concluded.")
                            .Italic();

                        // Signature block
                        col.Item().PaddingTop(24).Table(table =>
                        {
                            table.ColumnsDefinition(c => { c.RelativeColumn(); c.RelativeColumn(); });
                            table.Cell().PaddingTop(8).Column(sigCol =>
                            {
                                if (signatureBytes != null)
                                {
                                    // Render the stored signature image (height ~40pt, left-aligned)
                                    sigCol.Item().Height(40).AlignLeft().Image(signatureBytes).FitHeight();
                                }
                                else
                                {
                                    sigCol.Item().PaddingBottom(40).Text("").FontSize(8);
                                }
                                sigCol.Item().BorderBottom(1).BorderColor("#333333").PaddingBottom(4)
                                    .Text(declaration.DirectorName ?? "_______________________").FontSize(9);
                                sigCol.Item().Text("Signed (Director)").FontSize(8).FontColor("#666666");
                            });
                            table.Cell().PaddingTop(8).Column(dateCol =>
                            {
                                dateCol.Item().PaddingBottom(40).Text("").FontSize(8);
                                dateCol.Item().BorderBottom(1).BorderColor("#333333").PaddingBottom(4)
                                    .Text(declaration.MeetingDate.ToString("dd MMMM yyyy")).FontSize(9);
                                dateCol.Item().Text("Date").FontSize(8).FontColor("#666666");
                            });
                        });

                        // Reference footer
                        col.Item().PaddingTop(16).AlignCenter()
                            .Text($"Reference: {declaration.DividendRef}")
                            .FontSize(8).FontColor("#999999");
                    });

                    page.Footer().AlignCenter().Text(text =>
                    {
                        text.Span($"{companyName}").FontSize(8).FontColor("#999999");
                        text.Span("  ·  ").FontSize(8).FontColor("#CCCCCC");
                        text.Span($"Confidential — {declaration.DividendRef}").FontSize(8).FontColor("#999999");
                    });
                });
            }).GeneratePdf();
        }

        // ─────────────────────────────────────────────────────────────────────
        // Dividend Voucher PDF (QuestPDF)
        // ─────────────────────────────────────────────────────────────────────
        private static byte[] GenerateDividendVoucherPdf(
            DividendDeclaration declaration,
            DividendAllocation alloc,
            CompanySettings? company,
            byte[]? logoBytes)
        {
            QuestPDF.Settings.License = LicenseType.Community;

            var companyName = company?.CompanyName ?? "The Company";
            var regNumber = company?.CompanyRegistrationNumber ?? "";
            var address = company?.CompanyAddress ?? company?.Address ?? "";

            return Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(35, Unit.Point);
                    page.DefaultTextStyle(x => x.FontSize(10).FontFamily("Arial"));

                    page.Header().Column(headerCol =>
                    {
                        headerCol.Item().Row(row =>
                        {
                            if (logoBytes != null)
                            {
                                row.ConstantItem(70).PaddingRight(10).Image(logoBytes);
                            }
                            row.RelativeItem().Column(col =>
                            {
                                col.Item().Text(companyName).Bold().FontSize(16);
                                if (!string.IsNullOrEmpty(regNumber))
                                    col.Item().Text($"Company No. {regNumber}").FontSize(9).FontColor("#666666");
                                if (!string.IsNullOrEmpty(address))
                                    col.Item().Text(address).FontSize(9).FontColor("#666666");
                            });
                            row.ConstantItem(120).AlignRight().Column(col =>
                            {
                                col.Item().Text("DIVIDEND VOUCHER").Bold().FontSize(12).FontColor("#2563EB");
                                col.Item().Text(alloc.VoucherRef ?? declaration.DividendRef)
                                    .FontSize(9).FontColor("#666666");
                                var issuedDate = declaration.FinalisedDate ?? declaration.CreatedDate;
                                col.Item().Text($"Issued: {issuedDate:dd/MM/yyyy}")
                                    .FontSize(9).FontColor("#666666");
                            });
                        });
                        headerCol.Item().PaddingTop(12).LineHorizontal(1).LineColor("#2563EB");
                    });

                    page.Content().PaddingTop(16).Column(col =>
                    {
                        // Recipient
                        col.Item().PaddingBottom(12).Background("#F0F7FF").Padding(12).Column(inner =>
                        {
                            inner.Item().Text("SHAREHOLDER").FontSize(8).FontColor("#666666").Bold();
                            inner.Item().Text(alloc.ShareholderName).Bold().FontSize(13);
                        });

                        col.Item().PaddingVertical(8).LineHorizontal(0.5f).LineColor("#DDDDDD");

                        // Dividend details
                        col.Item().PaddingBottom(8).Text("DIVIDEND DETAILS").FontSize(9).Bold().FontColor("#666666");

                        col.Item().Table(table =>
                        {
                            table.ColumnsDefinition(c => { c.RelativeColumn(2); c.RelativeColumn(3); });
                            AddRow(table, "Dividend Type:", declaration.DividendType);
                            AddRow(table, "Share Class:", alloc.ShareClass);
                            AddRow(table, "Number of Shares:", $"{alloc.NumberOfShares:N0}");
                            AddRow(table, "Rate per Share:", $"£{alloc.AmountPerShare:F4}");
                            AddRow(table, "Record Date:", declaration.RecordDate.ToString("dd MMMM yyyy"));
                            AddRow(table, "Payment Date:", declaration.PaymentDate.ToString("dd MMMM yyyy"));
                        });

                        col.Item().PaddingVertical(12).LineHorizontal(0.5f).LineColor("#DDDDDD");

                        // Amount box
                        col.Item().PaddingBottom(16).Background("#F0FDF4").Padding(16).Row(row =>
                        {
                            row.RelativeItem().Column(inner =>
                            {
                                inner.Item().Text("TOTAL DIVIDEND PAYMENT").FontSize(9).Bold().FontColor("#166534");
                                inner.Item().Text($"£{alloc.TotalAmount:N2}").Bold().FontSize(22).FontColor("#166534");
                                inner.Item().Text($"{alloc.NumberOfShares:N0} shares × £{alloc.AmountPerShare:F4}")
                                    .FontSize(9).FontColor("#666666");
                            });
                        });

                        // Tax note
                        col.Item().PaddingBottom(12).Background("#FFFBEB").Padding(10).Column(inner =>
                        {
                            inner.Item().Text("TAX NOTE").FontSize(8).Bold().FontColor("#92400E");
                            inner.Item().PaddingTop(4).Text(text =>
                            {
                                text.Span("This dividend is paid net. Shareholders may have a personal tax liability depending on their other income. " +
                                          "The first £500 of dividend income (2024/25) is covered by the Dividend Allowance. " +
                                          "Tax above that threshold is payable via self-assessment.").FontSize(8).FontColor("#92400E");
                            });
                        });

                        col.Item().PaddingVertical(8).LineHorizontal(0.5f).LineColor("#DDDDDD");

                        // Signature block
                        // Extract director signature bytes (base64 data-URL)
                        byte[]? sigBytes = null;
                        if (!string.IsNullOrEmpty(company?.DirectorSignature))
                        {
                            try
                            {
                                var sigDataUrl = company.DirectorSignature;
                                var commaIdx = sigDataUrl.IndexOf(',');
                                var sigBase64 = commaIdx >= 0 ? sigDataUrl.Substring(commaIdx + 1) : sigDataUrl;
                                sigBytes = Convert.FromBase64String(sigBase64);
                            }
                            catch { /* ignore malformed signature data */ }
                        }

                        col.Item().PaddingTop(16).Table(table =>
                        {
                            table.ColumnsDefinition(c => { c.RelativeColumn(); c.RelativeColumn(); });
                            table.Cell().Column(sigCol =>
                            {
                                if (sigBytes != null)
                                {
                                    sigCol.Item().Height(40).Image(sigBytes).FitHeight();
                                }
                                else
                                {
                                    sigCol.Item().PaddingBottom(30).Text("").FontSize(8);
                                }
                                sigCol.Item().BorderBottom(1).BorderColor("#333333").PaddingBottom(4)
                                    .Text(declaration.DirectorName ?? "_______________________").FontSize(9);
                                sigCol.Item().Text("Authorised Signatory").FontSize(8).FontColor("#666666");
                                sigCol.Item().Text("On behalf of " + companyName).FontSize(8).FontColor("#888888");
                            });
                            table.Cell().Column(dateCol =>
                            {
                                dateCol.Item().PaddingBottom(30).Text("").FontSize(8);
                                dateCol.Item().BorderBottom(1).BorderColor("#333333").PaddingBottom(4)
                                    .Text(declaration.PaymentDate.ToString("dd MMMM yyyy")).FontSize(9);
                                dateCol.Item().Text("Date").FontSize(8).FontColor("#666666");
                            });
                        });
                    });

                    page.Footer().Row(row =>
                    {
                        row.RelativeItem().Text(text =>
                        {
                            text.Span($"{companyName}").FontSize(8).FontColor("#999999");
                            if (!string.IsNullOrEmpty(regNumber))
                                text.Span($"  ·  Registered No. {regNumber}").FontSize(8).FontColor("#BBBBBB");
                        });
                        row.ConstantItem(120).AlignRight()
                            .Text($"Voucher: {alloc.VoucherRef ?? declaration.DividendRef}")
                            .FontSize(8).FontColor("#999999");
                    });
                });
            }).GeneratePdf();
        }

        // ─────────────────────────────────────────────────────────────────────
        // Helpers
        // ─────────────────────────────────────────────────────────────────────
        private static void AddRow(TableDescriptor table, string label, string value)
        {
            table.Cell().Text(label).Bold().FontSize(9).FontColor("#555555");
            table.Cell().Text(value ?? "—").FontSize(9);
        }

        private static string SanitiseFilename(string name) =>
            string.Concat(name.Split(Path.GetInvalidFileNameChars())).Replace(" ", "-");

        /// <summary>
        /// Derives shareholder initials from a full name.
        /// "Andrew Kemp" → "AK", "Mary Margaret Smith" → "MMS"
        /// </summary>
        private static string GetShareholderInitials(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "XX";
            return string.Concat(
                name.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Select(w => char.ToUpper(w[0]))
            );
        }
    }
}
