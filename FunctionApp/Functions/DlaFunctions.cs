using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using FinanceHubFunctions.Services;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Data;
using Microsoft.Extensions.Logging;
using System.Text.Json;

namespace FinanceHubFunctions.Functions
{
    public class DlaFunctions
    {
        private readonly ILogger<DlaFunctions> _logger;
        private readonly IDlaRepository _dlaRepository;
        private readonly IDlaPaymentRepository _dlaPaymentRepository;
        private readonly ICompanyLedgerRepository _companyLedgerRepository;
        private readonly ICompanySettingsRepository _companySettingsRepository;
        private readonly IExpenseRepository _expenseRepository;
        private readonly BlobStorageService _blobStorageService;
        private readonly DlaClassificationService _classificationService;
        private readonly DeletionGuardService _guard;
        private readonly IMissingReceiptDeclarationRepository _declarationRepo;
        private readonly MissingReceiptDeclarationPdfService _pdfService;
        private readonly FinanceHubDbContext _dbContext;
        private readonly EmailService _emailService;

        private static string? ResolveDlaNotificationRecipient(CompanySettings? settings)
        {
            if (settings == null) return null;

            var candidates = new[]
            {
                settings.PaymentsEmail,
                settings.Email,
                settings.CompanyEmail,
                settings.SmtpFromAddress
            };

            return candidates.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        }

        private async Task<string> GenerateNextBatchPaymentReferenceAsync(DateTime paymentDate, CancellationToken cancellationToken = default)
        {
            var periodPrefix = $"DLA-{paymentDate:yyyyMM}-";

            var existingReferences = await _dbContext.DlaPayments
                .AsNoTracking()
                .Where(payment => payment.PaymentReference != null && payment.PaymentReference.StartsWith(periodPrefix))
                .Select(payment => payment.PaymentReference!)
                .ToListAsync(cancellationToken);

            var nextSequence = 1;
            foreach (var existingReference in existingReferences)
            {
                var rawReference = existingReference.Split(" (", 2, StringSplitOptions.None)[0].Trim();
                if (!rawReference.StartsWith(periodPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var suffix = rawReference[periodPrefix.Length..];
                if (int.TryParse(suffix, out var sequenceNumber) && sequenceNumber >= nextSequence)
                {
                    nextSequence = sequenceNumber + 1;
                }
            }

            return $"{periodPrefix}{nextSequence:D3}";
        }

        public DlaFunctions(
            ILogger<DlaFunctions> logger,
            IDlaRepository dlaRepository,
            IDlaPaymentRepository dlaPaymentRepository,
            ICompanyLedgerRepository companyLedgerRepository,
            ICompanySettingsRepository companySettingsRepository,
            IExpenseRepository expenseRepository,
            BlobStorageService blobStorageService,
            DeletionGuardService guard,
            IMissingReceiptDeclarationRepository declarationRepo,
            MissingReceiptDeclarationPdfService pdfService,
            FinanceHubDbContext dbContext,
            EmailService emailService)
        {
            _logger = logger;
            _dlaRepository = dlaRepository;
            _dlaPaymentRepository = dlaPaymentRepository;
            _companyLedgerRepository = companyLedgerRepository;
            _companySettingsRepository = companySettingsRepository;
            _expenseRepository = expenseRepository;
            _blobStorageService = blobStorageService;
            _classificationService = new DlaClassificationService();
            _guard = guard;
            _declarationRepo = declarationRepo;
            _pdfService = pdfService;
            _dbContext = dbContext;
            _emailService = emailService;
        }

        [Function("GetDlaEntries")]
        public async Task<HttpResponseData> GetDlaEntries(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dla")] HttpRequestData req)
        {
            _logger.LogInformation("Getting all DLA entries");

            try
            {
                var dlaEntries = await _dlaRepository.GetAllAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(dlaEntries);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting DLA entries");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("GetTrivialBenefitSummary")]
        public async Task<HttpResponseData> GetTrivialBenefitSummary(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "trivialbenefits/summary")] HttpRequestData req)
        {
            _logger.LogInformation("Getting trivial benefit summary");
            try
            {
                var queryParams = req.Url.Query
                    .TrimStart('?')
                    .Split('&')
                    .Select(p => p.Split('='))
                    .Where(p => p.Length == 2)
                    .ToDictionary(p => p[0], p => Uri.UnescapeDataString(p[1]), StringComparer.OrdinalIgnoreCase);

                var taxYear = queryParams.GetValueOrDefault("taxYear") ?? string.Empty;
                var recipientFilter = queryParams.GetValueOrDefault("recipient") ?? string.Empty;

                var allDla = await _dlaRepository.GetAllAsync();
                var allExp = await _expenseRepository.GetAllAsync();

                var dlaEntries = allDla
                    .Where(d => d.IsTrivialBenefit && (string.IsNullOrEmpty(taxYear) || d.TaxYear == taxYear))
                    .Select(d => new {
                        id = d.DlaId,
                        source = "DLA",
                        description = d.Description,
                        amount = d.AmountGross,
                        date = d.EntryDate,
                        taxYear = d.TaxYear,
                        benefitType = d.TrivialBenefitType,
                        recipient = d.TrivialBenefitRecipient ?? d.Director
                    })
                    .ToList();

                var expEntries = allExp
                    .Where(e => e.IsTrivialBenefit && (string.IsNullOrEmpty(taxYear) || e.TaxYear == taxYear))
                    .Select(e => new {
                        id = e.ExpenseId,
                        source = "Expense",
                        description = e.Supplier,
                        amount = e.AmountGross,
                        date = (DateTime?)(e.DatePaid ?? e.EntryDate),
                        taxYear = e.TaxYear,
                        benefitType = e.TrivialBenefitType,
                        recipient = e.TrivialBenefitRecipient ?? (string?)null
                    })
                    .ToList();

                var allEntries = dlaEntries.Select(d => (object)d).Concat(expEntries.Select(e => (object)e)).ToList();

                // Build per-recipient counts
                const int limit = 6;
                var byRecipient = dlaEntries.Select(d => new { d.recipient, entry = (object)d })
                    .Concat(expEntries.Where(e => e.recipient != null).Select(e => new { e.recipient, entry = (object)e }))
                    .GroupBy(x => x.recipient, StringComparer.OrdinalIgnoreCase)
                    .Select(g => new {
                        recipient = g.Key,
                        count = g.Count(),
                        limit,
                        remaining = Math.Max(0, limit - g.Count()),
                        isAtLimit = g.Count() >= limit
                    })
                    .OrderBy(r => r.recipient)
                    .ToList();

                // If filtering by recipient, get that recipient's count
                var filteredCount = string.IsNullOrEmpty(recipientFilter)
                    ? allEntries.Count
                    : byRecipient.FirstOrDefault(r => string.Equals(r.recipient, recipientFilter, StringComparison.OrdinalIgnoreCase))?.count ?? 0;
                var filteredRemaining = Math.Max(0, limit - filteredCount);

                var summary = new {
                    taxYear,
                    recipient = recipientFilter,
                    count = filteredCount,
                    limit,
                    remaining = filteredRemaining,
                    isAtLimit = filteredCount >= limit,
                    byRecipient,
                    entries = allEntries
                };

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(summary);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting trivial benefit summary");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("CreateDlaEntry")]
        public async Task<HttpResponseData> CreateDlaEntry(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla")] HttpRequestData req)
        {
            _logger.LogInformation("Creating new DLA entry");

            try
            {
                var dlaEntry = await req.ReadFromJsonAsync<DlaEntry>();
                if (dlaEntry == null)
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("Invalid DLA entry data");
                    return errorResponse;
                }

                // ── Trivial Benefit enforcement (HMRC s.323) ──────────────────────────────
                if (dlaEntry.IsTrivialBenefit)
                {
                    if (dlaEntry.AmountGross > 50.00m)
                    {
                        var tb400 = req.CreateResponse(HttpStatusCode.BadRequest);
                        await tb400.WriteStringAsync("Trivial benefit amount cannot exceed \u00a350.00 \u2014 amounts above this are void for HMRC exemption purposes.");
                        return tb400;
                    }

                    // Default recipient to the director name if not explicitly set
                    if (string.IsNullOrWhiteSpace(dlaEntry.TrivialBenefitRecipient))
                        dlaEntry.TrivialBenefitRecipient = dlaEntry.Director;

                    var taxYearKey = dlaEntry.TaxYear;
                    var recipient = dlaEntry.TrivialBenefitRecipient;
                    var allDla = await _dlaRepository.GetAllAsync();
                    var allExp = await _expenseRepository.GetAllAsync();
                    var dlaCount = allDla.Count(d => d.IsTrivialBenefit && d.TaxYear == taxYearKey
                        && string.Equals(d.TrivialBenefitRecipient ?? d.Director, recipient, StringComparison.OrdinalIgnoreCase));
                    var expCount = allExp.Count(e => e.IsTrivialBenefit && e.TaxYear == taxYearKey
                        && string.Equals(e.TrivialBenefitRecipient, recipient, StringComparison.OrdinalIgnoreCase));
                    var totalCount = dlaCount + expCount;
                    if (totalCount >= 6)
                    {
                        var tb400 = req.CreateResponse(HttpStatusCode.BadRequest);
                        await tb400.WriteStringAsync($"Trivial benefit limit reached: {recipient} already has 6 of 6 recorded in tax year {taxYearKey}. HMRC allows a maximum of 6 trivial benefits per employee/director per tax year.");
                        return tb400;
                    }

                    // Force category to Trivial Benefit and CT tag to NonCT (non-deductible)
                    dlaEntry.Category = "Trivial Benefit";
                    dlaEntry.CtTag = "NonCT";
                }

                // Generate DLA ID: DLA-YYYY-NNNN (uses max existing ID + 1 to handle deletions correctly)
                dlaEntry.DlaId = await _dlaRepository.GenerateNextDlaIdAsync();
                dlaEntry.CreatedDate = DateTime.UtcNow;
                dlaEntry.ModifiedDate = DateTime.UtcNow;

                // Set period key from entry date
                dlaEntry.PeriodKey = dlaEntry.EntryDate.ToString("yyyy-MM");

                // Auto-classify based on incorporation date
                var companySettings = await _companySettingsRepository.GetDefaultAsync();
                var (isStartup, classificationSource) = _classificationService.ClassifyDlaEntry(
                    dlaEntry.EntryDate,
                    companySettings?.IncorporationDate,
                    null // No manual override from API call
                );
                dlaEntry.IsStartupCost = isStartup;
                dlaEntry.ClassificationSource = classificationSource;

                // Auto-set CT tag – use supplied value or derive from category
                if (string.IsNullOrWhiteSpace(dlaEntry.CtTag))
                {
                    dlaEntry.CtTag = dlaEntry.Category switch
                    {
                        "Client Entertainment" => "NonCT",
                        "Client Gifts"         => "NonCT",
                        _                      => "Revenue"
                    };
                }

                // Initialize payment tracking
                dlaEntry.AmountPaid = 0m;
                dlaEntry.RemainingBalance = dlaEntry.AmountGross;
                if (string.IsNullOrWhiteSpace(dlaEntry.Direction))
                {
                    dlaEntry.Direction = "OwedToDirector";
                }

                var createdEntry = await _dlaRepository.CreateAsync(dlaEntry);

                // Only create a Company Ledger entry when the company is lending money TO the director
                // (OwedToCompany = actual cash outflow from company). OwedToDirector entries are liabilities
                // owed back to the director — those are recorded via DLA payment transactions only.
                if (string.Equals(dlaEntry.Direction, "OwedToCompany", StringComparison.OrdinalIgnoreCase))
                {
                    var titleRaw = $"DLA loan to director: {dlaEntry.Description}";
                    var ledgerEntry = new CompanyLedgerEntry
                    {
                        Title = titleRaw.Length > 255 ? titleRaw[..252] + "..." : titleRaw,
                        EntryType = "DLA_Out",
                        Amount = dlaEntry.AmountGross,
                        EffectiveDate = dlaEntry.DatePaid ?? dlaEntry.EntryDate,
                        Notes = $"DLA ID: {dlaEntry.DlaId}. {dlaEntry.Notes}",
                        DlaReference = dlaEntry.DlaId,
                        PeriodKey = dlaEntry.PeriodKey,
                        TaxYear = int.Parse(dlaEntry.TaxYear?.Split('/')[0] ?? dlaEntry.EntryDate.Year.ToString()),
                        FinancialYear = dlaEntry.FinancialYear
                    };
                    await _companyLedgerRepository.CreateAsync(ledgerEntry);
                    _logger.LogInformation($"Created Company Ledger DLA_Out entry for director loan {dlaEntry.DlaId}");
                }

                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(createdEntry);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating DLA entry");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                var inner = ex.InnerException?.Message;
                var detail = string.IsNullOrWhiteSpace(inner) ? ex.Message : $"{ex.Message} | Inner: {inner}";
                await errorResponse.WriteStringAsync($"Error: {detail}");
                return errorResponse;
            }
        }

        [Function("CreateDlaStartup")]
        public async Task<HttpResponseData> CreateDlaStartup(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla/startup")] HttpRequestData req)
        {
            _logger.LogInformation("Creating DLA startup capture");

            try
            {
                var request = await req.ReadFromJsonAsync<DlaStartupRequest>();
                if (request == null)
                {
                    var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badRequest.WriteStringAsync("Invalid request");
                    return badRequest;
                }

                if (string.IsNullOrWhiteSpace(request.Director))
                {
                    var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badRequest.WriteStringAsync("Director is required");
                    return badRequest;
                }

                if (request.SupportingDocumentCount <= 0)
                {
                    var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badRequest.WriteStringAsync("At least one supporting document is required");
                    return badRequest;
                }

                var batchId = string.IsNullOrWhiteSpace(request.BatchId)
                    ? $"DLA-START-{DateTime.UtcNow:yyyyMMddHHmmss}"
                    : request.BatchId.Trim();

                var createdEntries = new List<DlaEntry>();
                var entryDate = request.EntryDate ?? DateTime.UtcNow.Date;
                var mode = request.Mode?.Trim().ToLowerInvariant() ?? "single";

                if (mode == "single")
                {
                    if (!request.TotalAmount.HasValue || request.TotalAmount.Value <= 0)
                    {
                        var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                        await badRequest.WriteStringAsync("Total amount must be greater than 0");
                        return badRequest;
                    }

                    if (string.IsNullOrWhiteSpace(request.Rationale))
                    {
                        var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                        await badRequest.WriteStringAsync("Rationale is required for single amount capture");
                        return badRequest;
                    }

                    var entry = new DlaEntry
                    {
                        Director = request.Director,
                        Direction = "OwedToDirector",
                        EntryDate = entryDate,
                        Description = $"Director-funded startup costs (aggregate): {request.Rationale}",
                        Category = string.IsNullOrWhiteSpace(request.Category) ? "Startup Costs" : request.Category,
                        CtTag = string.IsNullOrWhiteSpace(request.CtTag) ? "Revenue" : request.CtTag,
                        AmountNet = request.TotalAmount.Value,
                        VatAmount = 0m,
                        AmountGross = request.TotalAmount.Value,
                        PeriodKey = entryDate.ToString("yyyy-MM"),
                        TaxYear = entryDate.ToString("yyyy"),
                        FinancialYear = entryDate.Year.ToString(),
                        IsStartupCost = true,
                        SourceBatchId = batchId
                    };

                    entry.DlaId = await _dlaRepository.GenerateNextDlaIdAsync();
                    entry.CreatedDate = DateTime.UtcNow;
                    entry.ModifiedDate = DateTime.UtcNow;
                    entry.AmountPaid = 0m;
                    entry.RemainingBalance = entry.AmountGross;

                    var created = await _dlaRepository.CreateAsync(entry);
                    createdEntries.Add(created);

                    var ledgerEntry = new CompanyLedgerEntry
                    {
                        Title = $"DLA Startup: {entry.Description}",
                        EntryType = "DLA_Out",
                        Amount = entry.AmountGross,
                        EffectiveDate = entry.EntryDate,
                        Notes = $"DLA ID: {entry.DlaId}. CT Tag: {entry.CtTag}",
                        PeriodKey = entry.PeriodKey,
                        TaxYear = entryDate.Year,
                        FinancialYear = entry.FinancialYear
                    };

                    await _companyLedgerRepository.CreateAsync(ledgerEntry);
                }
                else
                {
                    if (request.Items == null || request.Items.Count == 0)
                    {
                        var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                        await badRequest.WriteStringAsync("At least one item is required for itemised capture");
                        return badRequest;
                    }

                    foreach (var item in request.Items)
                    {
                        if (item.AmountGross <= 0)
                        {
                            continue;
                        }

                        var itemDate = item.EntryDate ?? entryDate;
                        var entry = new DlaEntry
                        {
                            Director = request.Director,
                            Direction = "OwedToDirector",
                            EntryDate = itemDate,
                            Description = item.Description,
                            Category = string.IsNullOrWhiteSpace(item.Category) ? "Startup Costs" : item.Category,
                            CtTag = string.IsNullOrWhiteSpace(item.CtTag) ? "Revenue" : item.CtTag,
                            AmountNet = item.AmountNet,
                            VatAmount = item.VatAmount,
                            AmountGross = item.AmountGross,
                            PeriodKey = itemDate.ToString("yyyy-MM"),
                            TaxYear = itemDate.ToString("yyyy"),
                            FinancialYear = itemDate.Year.ToString(),
                            IsStartupCost = true,
                            SourceBatchId = batchId
                        };

                        entry.DlaId = await _dlaRepository.GenerateNextDlaIdAsync();
                        entry.CreatedDate = DateTime.UtcNow;
                        entry.ModifiedDate = DateTime.UtcNow;
                        entry.AmountPaid = 0m;
                        entry.RemainingBalance = entry.AmountGross;

                        var created = await _dlaRepository.CreateAsync(entry);
                        createdEntries.Add(created);

                        var ledgerEntry = new CompanyLedgerEntry
                        {
                            Title = $"DLA Startup: {entry.Description}",
                            EntryType = "DLA_Out",
                            Amount = entry.AmountGross,
                            EffectiveDate = entry.EntryDate,
                            Notes = $"DLA ID: {entry.DlaId}. CT Tag: {entry.CtTag}",
                            PeriodKey = entry.PeriodKey,
                            TaxYear = itemDate.Year,
                            FinancialYear = entry.FinancialYear
                        };

                        await _companyLedgerRepository.CreateAsync(ledgerEntry);
                    }
                }

                var total = createdEntries.Sum(e => e.AmountGross);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    BatchId = batchId,
                    TotalAmount = total,
                    EntryCount = createdEntries.Count,
                    Message = $"DLA Created: £{total:N2} owed to director"
                });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating DLA startup capture");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                var detail = ex.InnerException?.Message;
                await errorResponse.WriteStringAsync($"Error: {ex.Message}{(string.IsNullOrWhiteSpace(detail) ? string.Empty : $" | Inner: {detail}")}");
                return errorResponse;
            }
        }

        [Function("UpdateDlaEntry")]
        public async Task<HttpResponseData> UpdateDlaEntry(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "dla/{id}")] HttpRequestData req,
            int id)
        {
            _logger.LogInformation($"Updating DLA entry {id}");

            try
            {
                var existingEntry = await _dlaRepository.GetByIdAsync(id);
                if (existingEntry == null)
                {
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteStringAsync($"DLA entry {id} not found");
                    return notFoundResponse;
                }

                var updatedData = await req.ReadFromJsonAsync<DlaEntry>();
                if (updatedData == null)
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("Invalid DLA entry data");
                    return errorResponse;
                }

                // Preserve system fields
                existingEntry.Director = updatedData.Director;
                existingEntry.Description = updatedData.Description;
                existingEntry.Category = updatedData.Category;
                existingEntry.AmountNet = updatedData.AmountNet;
                existingEntry.VatAmount = updatedData.VatAmount;
                existingEntry.AmountGross = updatedData.AmountGross;
                existingEntry.EntryDate = updatedData.EntryDate;
                existingEntry.DatePaid = updatedData.DatePaid;
                existingEntry.PaymentMethod = updatedData.PaymentMethod;
                existingEntry.Notes = updatedData.Notes;

                // Recalculate remaining balance whenever amounts change (Bug fix: totals not updating)
                existingEntry.RemainingBalance = existingEntry.AmountGross - existingEntry.AmountPaid;

                if (!string.IsNullOrWhiteSpace(updatedData.Direction))
                {
                    existingEntry.Direction = updatedData.Direction;
                }

                // CT tag: use supplied value, or auto-derive from category for disallowed types
                if (!string.IsNullOrWhiteSpace(updatedData.CtTag))
                {
                    existingEntry.CtTag = updatedData.CtTag;
                }
                else if (!string.IsNullOrWhiteSpace(updatedData.Category))
                {
                    existingEntry.CtTag = updatedData.Category switch
                    {
                        "Client Entertainment" => "NonCT",
                        "Client Gifts"         => "NonCT",
                        _                      => existingEntry.CtTag ?? "Revenue"
                    };
                }

                if (!string.IsNullOrWhiteSpace(updatedData.TaxYear))
                {
                    existingEntry.TaxYear = updatedData.TaxYear;
                }

                if (!string.IsNullOrWhiteSpace(updatedData.FinancialYear))
                {
                    existingEntry.FinancialYear = updatedData.FinancialYear;
                }

                if (updatedData.EntryDate != default)
                {
                    existingEntry.PeriodKey = updatedData.EntryDate.ToString("yyyy-MM");
                    
                    // Re-classify if manual override not set
                    if (updatedData.ClassificationSource != "manual")
                    {
                        var companySettings = await _companySettingsRepository.GetDefaultAsync();
                        var (isStartup, classificationSource) = _classificationService.ClassifyDlaEntry(
                            updatedData.EntryDate,
                            companySettings?.IncorporationDate,
                            null
                        );
                        existingEntry.IsStartupCost = isStartup;
                        existingEntry.ClassificationSource = classificationSource;
                    }
                }
                
                // Allow manual override of classification
                if (updatedData.ClassificationSource == "manual")
                {
                    existingEntry.IsStartupCost = updatedData.IsStartupCost;
                    existingEntry.ClassificationSource = "manual";
                }

                existingEntry.ModifiedDate = DateTime.UtcNow;

                var updated = await _dlaRepository.UpdateAsync(existingEntry);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(updated);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error updating DLA entry {id}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("PatchDlaNoReceiptReason")]
        public async Task<HttpResponseData> PatchDlaNoReceiptReason(
            [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "dla/{id}/no-receipt-reason")] HttpRequestData req,
            int id)
        {
            try
            {
                var existingEntry = await _dlaRepository.GetByIdAsync(id);
                if (existingEntry == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteStringAsync($"DLA entry {id} not found");
                    return notFound;
                }
                var body = await req.ReadFromJsonAsync<System.Text.Json.JsonElement>();
                string? reason = null;
                if (body.TryGetProperty("reason", out var reasonProp))
                    reason = reasonProp.GetString();
                if (string.IsNullOrWhiteSpace(reason))
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Reason is required");
                    return bad;
                }
                existingEntry.NoReceiptReason = reason;
                existingEntry.ModifiedDate = DateTime.UtcNow;
                await _dlaRepository.UpdateAsync(existingEntry);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { success = true });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error patching DLA entry {id} no-receipt-reason");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("DeleteDlaEntry")]
        public async Task<HttpResponseData> DeleteDlaEntry(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "dla/{id}")] HttpRequestData req,
            int id)
        {
            _logger.LogInformation($"Deleting DLA entry {id}");

            var blocked = await _guard.GuardAsync(req, "DLA entry");
            if (blocked != null) return blocked;

            try
            {
                await _dlaRepository.DeleteAsync(id);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteStringAsync($"DLA entry {id} deleted successfully");
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error deleting DLA entry {id}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("UploadDlaReceipt")]
        public async Task<HttpResponseData> UploadDlaReceipt(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla/{id}/upload")] HttpRequestData req,
            int id)
        {
            _logger.LogInformation($"Uploading receipt for DLA entry {id}");

            try
            {
                if (_dlaRepository == null || _blobStorageService == null)
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.ServiceUnavailable);
                    await errorResponse.WriteStringAsync("Service not available");
                    return errorResponse;
                }

                var dlaEntry = await _dlaRepository.GetByIdAsync(id);
                if (dlaEntry == null)
                {
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteStringAsync($"DLA entry {id} not found");
                    return notFoundResponse;
                }

                // Parse multipart form data using MultipartReader for binary-safe parsing
                var contentType = req.Headers.GetValues("Content-Type").FirstOrDefault();
                if (string.IsNullOrEmpty(contentType) || !contentType.Contains("boundary="))
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("No multipart boundary found in Content-Type");
                    return errorResponse;
                }

                var boundary = contentType.Split("boundary=")[1].Trim();

                var reader = new Microsoft.AspNetCore.WebUtilities.MultipartReader(boundary, req.Body);
                Microsoft.AspNetCore.WebUtilities.MultipartSection? section;

                while ((section = await reader.ReadNextSectionAsync()) != null)
                {
                    // Check for Content-Disposition with a filename
                    var contentDisposition = section.ContentDisposition;
                    if (string.IsNullOrEmpty(contentDisposition)) continue;
                    if (!contentDisposition.Contains("filename=")) continue;

                    // Extract filename from Content-Disposition header
                    var fileNameMatch = System.Text.RegularExpressions.Regex.Match(
                        contentDisposition, @"filename[*]?=""?([^"";]+)""?");
                    if (!fileNameMatch.Success) continue;

                    var fileName = System.IO.Path.GetFileName(fileNameMatch.Groups[1].Value.Trim());

                    // Read file bytes binary-safe via MemoryStream
                    using var ms = new System.IO.MemoryStream();
                    await section.Body.CopyToAsync(ms);
                    var fileBytes = ms.ToArray();

                    if (fileBytes.Length == 0) continue;

                    // Upload to blob storage
                    var blobUrl = await _blobStorageService.UploadReceiptAsync(id, dlaEntry.DlaId, fileBytes, fileName);

                    // Update DLA entry with receipt URL
                    dlaEntry.ReceiptUrl = blobUrl;
                    dlaEntry.ModifiedDate = DateTime.UtcNow;
                    await _dlaRepository.UpdateAsync(dlaEntry);

                    _logger.LogInformation($"Receipt uploaded successfully: {blobUrl}");

                    var successResponse = req.CreateResponse(HttpStatusCode.OK);
                    await successResponse.WriteAsJsonAsync(new { url = blobUrl, fileName = fileName });
                    return successResponse;
                }

                var noFileResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                await noFileResponse.WriteStringAsync("No file found in request");
                return noFileResponse;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error uploading DLA receipt for entry {id}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteAsJsonAsync(new { error = ex.Message });
                return errorResponse;
            }
        }

        [Function("ViewDlaReceipt")]
        public async Task<HttpResponseData> ViewDlaReceipt(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dla/{id}/receipts/{filename}")] HttpRequestData req,
            int id,
            string filename)
        {
            _logger.LogInformation($"Viewing DLA receipt {filename} for entry {id}");

            try
            {
                if (_blobStorageService == null || _dlaRepository == null)
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.ServiceUnavailable);
                    await errorResponse.WriteStringAsync("Service not available");
                    return errorResponse;
                }

                var dlaEntry = await _dlaRepository.GetByIdAsync(id);
                if (dlaEntry == null)
                {
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteStringAsync($"DLA entry {id} not found");
                    return notFoundResponse;
                }

                var blobName = $"{dlaEntry.DlaId}/{filename}";
                var (fileBytes, contentType, _) = await _blobStorageService.DownloadReceiptAsync(blobName);

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", contentType);
                response.Headers.Add("Content-Disposition", $"inline; filename=\"{filename}\"");
                await response.Body.WriteAsync(fileBytes);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error viewing DLA receipt {filename} for entry {id}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("RecordDlaPayment")]
        public async Task<HttpResponseData> RecordDlaPayment(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla/{dlaId}/payment")] HttpRequestData req,
            string dlaId)
        {
            _logger.LogInformation($"Recording payment for DLA entry {dlaId}");

            try
            {
                var dlaEntry = await _dlaRepository.GetByDlaIdAsync(dlaId);

                if (dlaEntry == null)
                {
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteStringAsync($"DLA entry {dlaId} not found");
                    return notFoundResponse;
                }

                // Parse payment request
                var paymentData = await req.ReadFromJsonAsync<DlaPaymentRequest>();
                if (paymentData == null || paymentData.PaymentAmount <= 0)
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("Invalid payment amount");
                    return errorResponse;
                }

                // Validate payment amount doesn't exceed remaining balance
                if (paymentData.PaymentAmount > dlaEntry.RemainingBalance)
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync($"Payment amount ({paymentData.PaymentAmount:C}) exceeds remaining balance ({dlaEntry.RemainingBalance:C})");
                    return errorResponse;
                }

                // Update DLA entry balance
                dlaEntry.AmountPaid += paymentData.PaymentAmount;
                dlaEntry.RemainingBalance = dlaEntry.AmountGross - dlaEntry.AmountPaid;
                dlaEntry.ModifiedDate = DateTime.UtcNow;

                // If fully paid, set DatePaid
                bool isFullPayment = dlaEntry.RemainingBalance == 0;
                if (isFullPayment)
                {
                    dlaEntry.DatePaid = paymentData.PaymentDate;
                }

                await _dlaRepository.UpdateAsync(dlaEntry);

                // Create DLA payment record
                var paymentId = await _dlaPaymentRepository.GenerateNextPaymentIdAsync();
                var paymentRecord = new DlaPayment
                {
                    PaymentId = paymentId,
                    DlaId = dlaEntry.DlaId,
                    Director = dlaEntry.Director,
                    Amount = paymentData.PaymentAmount,
                    PaymentDate = paymentData.PaymentDate,
                    PaymentMethod = paymentData.PaymentMethod,
                    Notes = paymentData.Notes,
                    PeriodKey = paymentData.PaymentDate.ToString("yyyy-MM")
                };

                await _dlaPaymentRepository.CreateAsync(paymentRecord);

                // Create Company Ledger entry for repayment
                var repaymentType = string.Equals(dlaEntry.Direction, "OwedToCompany", StringComparison.OrdinalIgnoreCase)
                    ? "DLA_Out"
                    : "DLA_In";

                var repaymentLabel = string.Equals(dlaEntry.Direction, "OwedToCompany", StringComparison.OrdinalIgnoreCase)
                    ? "Repayment from director"
                    : "Repayment to director";

                var ledgerTitle = $"DLA {repaymentLabel}: {dlaEntry.Director} - {dlaEntry.Description}";
                if (ledgerTitle.Length > 250) ledgerTitle = ledgerTitle[..250];
                var ledgerEntry = new CompanyLedgerEntry
                {
                    Title = ledgerTitle,
                    EntryType = repaymentType,
                    Amount = paymentData.PaymentAmount,
                    EffectiveDate = paymentData.PaymentDate,
                    Notes = $"Payment for DLA {dlaEntry.DlaId}. {paymentData.Notes ?? ""} | Remaining balance: {dlaEntry.RemainingBalance:C}",
                    DlaReference = dlaEntry.DlaId,
                    IsFullPayment = isFullPayment,
                    PeriodKey = paymentData.PaymentDate.ToString("yyyy-MM"),
                    TaxYear = paymentData.PaymentDate.Year,
                    FinancialYear = $"{paymentData.PaymentDate.Year}/{(paymentData.PaymentDate.Year + 1) % 100:D2}"
                };

                await _companyLedgerRepository.CreateAsync(ledgerEntry);
                _logger.LogInformation($"Created Company Ledger payment entry for DLA {dlaEntry.DlaId}");

                // Send confirmation email with CSV for bank upload
                var emailAttempted = false;
                var emailSent = false;
                string? emailWarning = null;
                string? emailRecipient = null;
                try
                {
                    var settings = await _companySettingsRepository.GetDefaultAsync();
                    var recipientEmail = string.IsNullOrWhiteSpace(paymentData.RecipientEmail)
                        ? ResolveDlaNotificationRecipient(settings)
                        : paymentData.RecipientEmail.Trim();
                    emailRecipient = recipientEmail;
                    if (!paymentData.SendEmail)
                    {
                        _logger.LogInformation("DLA payment confirmation email skipped for {DlaId}: sendEmail=false", dlaEntry.DlaId);
                    }
                    else if (!string.IsNullOrWhiteSpace(recipientEmail))
                    {
                        emailAttempted = true;
                        var csvLines = new List<string> { "DLA ID,Director,Description,Amount,Payment Date,Payment Method,Reference" };
                        csvLines.Add($"\"{dlaEntry.DlaId}\",\"{dlaEntry.Director}\",\"{(dlaEntry.Description ?? "").Replace("\"", "\"\"")}\",{paymentData.PaymentAmount:F2},{paymentData.PaymentDate:yyyy-MM-dd},\"{paymentData.PaymentMethod ?? ""}\",\"{paymentRecord.PaymentId}\"");
                        csvLines.Add($",,TOTAL,{paymentData.PaymentAmount:F2},,,");
                        var csvContent = string.Join("\r\n", csvLines);
                        var csvBytes = System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(csvContent)).ToArray();

                        var emailResult = await _emailService.SendDlaPaymentEmailAsync(
                            recipientEmail,
                            dlaEntry.DlaId,
                            dlaEntry.Director,
                            dlaEntry.Description,
                            paymentData.PaymentAmount,
                            paymentData.PaymentDate,
                            paymentData.PaymentMethod,
                            paymentRecord.PaymentId,
                            dlaEntry.AmountPaid,
                            dlaEntry.RemainingBalance,
                            isFullPayment,
                            csvBytes,
                            $"DLA-Payment-{dlaEntry.DlaId}-{paymentData.PaymentDate:yyyyMMdd}.csv");

                        emailSent = emailResult.Success;
                        if (!emailResult.Success)
                        {
                            emailWarning = string.IsNullOrWhiteSpace(emailResult.Error) ? "Email send failed" : emailResult.Error;
                            _logger.LogWarning("DLA payment confirmation email failed for {DlaId}: {EmailError}", dlaEntry.DlaId, emailWarning);
                        }
                    }
                    else
                    {
                        emailWarning = "No recipient email configured in Company Settings.";
                        _logger.LogWarning("DLA payment confirmation email skipped for {DlaId}: no recipient email configured", dlaEntry.DlaId);
                    }
                }
                catch (Exception emailEx)
                {
                    emailWarning = emailEx.Message;
                    _logger.LogWarning(emailEx, "Failed to send DLA payment confirmation email (payment was still recorded successfully)");
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    dlaEntry.DlaId,
                    PaymentAmount = paymentData.PaymentAmount,
                    dlaEntry.AmountPaid,
                    dlaEntry.RemainingBalance,
                    IsFullyPaid = isFullPayment,
                    PaymentId = paymentRecord.PaymentId,
                    Message = isFullPayment ? "DLA fully paid off" : $"Payment recorded. Remaining balance: {dlaEntry.RemainingBalance:C}",
                    EmailNotification = new
                    {
                        attempted = emailAttempted,
                        sent = emailSent,
                        recipient = emailRecipient,
                        warning = emailWarning
                    }
                });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error recording payment for DLA entry {dlaId}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        private string GetContentType(string fileName)
        {
            var extension = System.IO.Path.GetExtension(fileName).ToLowerInvariant();
            return extension switch
            {
                ".pdf" => "application/pdf",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".gif" => "image/gif",
                ".txt" => "text/plain",
                _ => "application/octet-stream"
            };
        }

        [Function("BatchRecordDlaPayments")]
        public async Task<HttpResponseData> BatchRecordDlaPayments(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla/batch-payment")] HttpRequestData req)
        {
            _logger.LogInformation("Recording batch DLA payments");

            try
            {
                var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
                var request = JsonSerializer.Deserialize<DlaBatchPaymentRequest>(requestBody,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (request == null || request.DlaIds == null || !request.DlaIds.Any())
                {
                    _logger.LogWarning("Batch payment request had no DLA IDs. Body: {Body}", requestBody);
                    var badReq = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badReq.WriteAsJsonAsync(new { error = "No DLA IDs provided", receivedBody = requestBody.Length > 500 ? requestBody[..500] : requestBody });
                    return badReq;
                }

                _logger.LogInformation($"Batch payment request received: {request.DlaIds.Count} DLA IDs");

                // Generate a shared batch reference for this payment run
                string generatedReference = await GenerateNextBatchPaymentReferenceAsync(request.PaymentDate);
                string batchRef = $"BATCH-{DateTime.UtcNow:yyyyMMdd-HHmmss}";
                string paymentRef = $"{generatedReference} ({batchRef})";

                // Load all entries once
                var allEntries = await _dlaRepository.GetAllAsync();

                var succeeded = new List<object>();
                var errors = new List<object>();
                decimal totalPaid = 0m;

                // Validate all entries up-front before starting the transaction
                var validEntries = new List<(string dlaId, DlaEntry entry)>();
                foreach (var dlaId in request.DlaIds)
                {
                    var entry = allEntries.FirstOrDefault(d =>
                        string.Equals(d.DlaId, dlaId, StringComparison.OrdinalIgnoreCase));

                    if (entry == null)
                    {
                        _logger.LogWarning($"Batch payment: DLA ID '{dlaId}' not found in {allEntries.Count()} entries");
                        errors.Add(new { dlaId, error = "Not found" });
                        continue;
                    }

                    // Self-heal: if RemainingBalance is stale/zero but entry clearly isn't paid, recompute
                    if (entry.RemainingBalance <= 0 && entry.AmountGross > 0 && entry.AmountPaid < entry.AmountGross && entry.DatePaid == null)
                    {
                        entry.RemainingBalance = entry.AmountGross - entry.AmountPaid;
                        _logger.LogWarning($"Batch payment: Self-healed RemainingBalance for {entry.DlaId} to {entry.RemainingBalance}");
                    }

                    if (entry.RemainingBalance <= 0)
                    {
                        _logger.LogWarning($"Batch payment: DLA ID '{dlaId}' skipped — RemainingBalance={entry.RemainingBalance}, AmountPaid={entry.AmountPaid}, AmountGross={entry.AmountGross}, DatePaid={entry.DatePaid}");
                        errors.Add(new { dlaId, error = "Already fully paid" });
                        continue;
                    }

                    validEntries.Add((dlaId: dlaId, entry: entry));
                }

                _logger.LogInformation($"Batch payment validation: {validEntries.Count} valid, {errors.Count} errors out of {request.DlaIds.Count} requested");

                // Process all valid entries inside a single transaction — all or nothing
                // Must use execution strategy wrapper because SqlServerRetryingExecutionStrategy
                // does not support user-initiated transactions directly.
                var strategy = _dbContext.Database.CreateExecutionStrategy();
                await strategy.ExecuteAsync(async () =>
                {
                    using var transaction = await _dbContext.Database.BeginTransactionAsync();
                    try
                    {
                        // Pre-generate payment IDs: get the starting number once, then increment in-memory
                        var basePaymentId = await _dlaPaymentRepository.GenerateNextPaymentIdAsync();
                        var baseParts = basePaymentId.Split('-');
                        int paymentCounter = int.Parse(baseParts[3]);
                        string paymentYearStr = baseParts[2];

                        foreach (var (dlaId, entry) in validEntries)
                        {
                            var paymentAmount = entry.RemainingBalance;

                            // Mark entry as fully paid
                            entry.AmountPaid += paymentAmount;
                            entry.RemainingBalance = 0;
                            entry.DatePaid = request.PaymentDate;
                            entry.ModifiedDate = DateTime.UtcNow;
                            await _dlaRepository.UpdateAsync(entry);

                            // Create payment record with sequentially generated ID
                            var paymentId = $"DLA-PAY-{paymentYearStr}-{paymentCounter:D4}";
                            paymentCounter++;
                            var paymentRecord = new DlaPayment
                            {
                                PaymentId = paymentId,
                                DlaId = entry.DlaId,
                                Director = entry.Director,
                                Amount = paymentAmount,
                                PaymentDate = request.PaymentDate,
                                PaymentMethod = request.PaymentMethod,
                                PaymentReference = paymentRef,
                                Notes = string.IsNullOrWhiteSpace(request.Notes)
                                    ? $"Batch payment {batchRef}"
                                    : $"Batch payment {batchRef}. {request.Notes}",
                                PeriodKey = request.PaymentDate.ToString("yyyy-MM")
                            };
                            await _dlaPaymentRepository.CreateAsync(paymentRecord);

                            // Create Company Ledger entry
                            var repaymentType = string.Equals(entry.Direction, "OwedToCompany",
                                StringComparison.OrdinalIgnoreCase) ? "DLA_Out" : "DLA_In";
                            var repaymentLabel = string.Equals(entry.Direction, "OwedToCompany",
                                StringComparison.OrdinalIgnoreCase) ? "Repayment from director" : "Repayment to director";

                            var ledgerTitle = $"DLA {repaymentLabel}: {entry.Director} - {entry.Description}";
                            if (ledgerTitle.Length > 250) ledgerTitle = ledgerTitle[..250];
                            var ledgerEntry = new CompanyLedgerEntry
                            {
                                Title = ledgerTitle,
                                EntryType = repaymentType,
                                Amount = paymentAmount,
                                EffectiveDate = request.PaymentDate,
                                Notes = $"Batch payment ref: {paymentRef}. {request.Notes ?? ""}".TrimEnd(new[] { ' ', '.' }) + ".",
                                DlaReference = entry.DlaId,
                                IsFullPayment = true,
                                PeriodKey = request.PaymentDate.ToString("yyyy-MM"),
                                TaxYear = request.PaymentDate.Year,
                                FinancialYear = $"{request.PaymentDate.Year}/{(request.PaymentDate.Year + 1) % 100:D2}"
                            };
                            await _companyLedgerRepository.CreateAsync(ledgerEntry);

                            succeeded.Add(new
                            {
                                dlaId = entry.DlaId,
                                description = entry.Description,
                                amountPaid = paymentAmount,
                                paymentId = paymentRecord.PaymentId
                            });
                            totalPaid += paymentAmount;
                        }

                        // All entries processed successfully — commit the transaction
                        await transaction.CommitAsync();
                    }
                    catch (Exception)
                    {
                        // Transaction failed — roll back ALL changes so nothing is left half-done
                        await transaction.RollbackAsync();
                        throw; // re-throw so the strategy wrapper catches it
                    }
                });

                if (succeeded.Count == 0 && validEntries.Count > 0)
                {
                    // This shouldn't happen unless the transaction threw (handled above)
                    var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errorResponse.WriteAsJsonAsync(new { batchRef, error = "Transaction completed but no entries were processed." });
                    return errorResponse;
                }

                // Send confirmation email with CSV attachment for bank upload
                var emailAttempted = false;
                var emailSent = false;
                string? emailWarning = null;
                string? emailRecipient = null;
                try
                {
                    var settings = await _companySettingsRepository.GetDefaultAsync();
                    var recipientEmailFromRequest = request.RecipientEmail?.Trim();

                    // If caller explicitly provided a recipient, use that first.
                    string? recipientEmail = string.IsNullOrWhiteSpace(recipientEmailFromRequest)
                        ? null
                        : recipientEmailFromRequest;

                    // Otherwise prefer the director's own email from the Employees table.
                    var directorNames = validEntries
                        .Select(e => e.entry.Director)
                        .Where(d => !string.IsNullOrWhiteSpace(d))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();

                    if (string.IsNullOrWhiteSpace(recipientEmail) && directorNames.Any())
                    {
                        var directorEmails = await _dbContext.Employees
                            .AsNoTracking()
                            .Where(emp => emp.IsDirector && emp.Email != null && directorNames.Contains(emp.Name))
                            .Select(emp => emp.Email)
                            .ToListAsync();

                        var validDirectorEmails = directorEmails
                            .Where(e => !string.IsNullOrWhiteSpace(e))
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList();

                        if (validDirectorEmails.Any())
                            recipientEmail = string.Join(",", validDirectorEmails);
                    }

                    // Fall back to company settings if no director email found
                    if (string.IsNullOrWhiteSpace(recipientEmail))
                        recipientEmail = ResolveDlaNotificationRecipient(settings);

                    emailRecipient = recipientEmail;
                    if (!request.SendEmail)
                    {
                        _logger.LogInformation("DLA batch payment email skipped for {BatchRef}: sendEmail=false", batchRef);
                    }
                    else if (!string.IsNullOrWhiteSpace(recipientEmail) && validEntries.Any())
                    {
                        emailAttempted = true;
                        var csvLines = new List<string> { "DLA ID,Director,Description,Amount,Payment Date,Payment Method,Reference" };
                        foreach (var (dlaId, entry) in validEntries)
                        {
                            var amt = entry.AmountGross; // full amount that was remaining
                            csvLines.Add($"\"{entry.DlaId}\",\"{entry.Director}\",\"{(entry.Description ?? "").Replace("\"", "\"\"")}\",{amt:F2},{request.PaymentDate:yyyy-MM-dd},\"{request.PaymentMethod ?? ""}\",\"{paymentRef.Replace("\"", "\"\"")}\"");
                        }
                        csvLines.Add($",,TOTAL,{totalPaid:F2},,,");
                        var csvContent = string.Join("\r\n", csvLines);
                        var csvBytes = System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(csvContent)).ToArray();

                        var entryList = validEntries
                            .Select(e => (e.entry.DlaId, e.entry.Director ?? "", e.entry.Description ?? "", e.entry.AmountGross))
                            .ToList();

                        var emailResult = await _emailService.SendDlaBatchPaymentEmailAsync(
                            recipientEmail,
                            batchRef,
                            request.PaymentDate,
                            request.PaymentMethod,
                            paymentRef,
                            totalPaid,
                            entryList,
                            errors.Count,
                            csvBytes,
                            $"DLA-Payment-{batchRef}.csv");

                        emailSent = emailResult.Success;
                        if (!emailResult.Success)
                        {
                            emailWarning = string.IsNullOrWhiteSpace(emailResult.Error) ? "Email send failed" : emailResult.Error;
                            _logger.LogWarning("DLA batch payment confirmation email failed for {BatchRef}: {EmailError}", batchRef, emailWarning);
                        }
                    }
                    else if (string.IsNullOrWhiteSpace(recipientEmail))
                    {
                        emailWarning = "No recipient email configured in Company Settings.";
                        _logger.LogWarning("DLA batch payment confirmation email skipped for {BatchRef}: no recipient email configured", batchRef);
                    }
                }
                catch (Exception emailEx)
                {
                    emailWarning = emailEx.Message;
                    _logger.LogWarning(emailEx, "Failed to send batch payment confirmation email (payments were still recorded successfully)");
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    reference = generatedReference,
                    batchRef,
                    totalAmount = totalPaid,
                    success = succeeded,
                    errors,
                    EmailNotification = new
                    {
                        attempted = emailAttempted,
                        sent = emailSent,
                        recipient = emailRecipient,
                        warning = emailWarning
                    }
                });

                return response;
            }
            catch (Exception ex)
            {
                var innerMsg = ex.InnerException?.InnerException?.Message 
                    ?? ex.InnerException?.Message 
                    ?? ex.Message;
                _logger.LogError(ex, "Error recording batch DLA payments. Inner: {InnerError}", innerMsg);
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {innerMsg}");
                return errorResponse;
            }
        }

        [Function("GetDlaPayments")]
        public async Task<HttpResponseData> GetDlaPayments(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dla/{dlaId}/payments")] HttpRequestData req,
            string dlaId)
        {
            _logger.LogInformation($"Getting DLA payments for {dlaId}");

            try
            {
                var payments = await _dlaPaymentRepository.GetByDlaIdAsync(dlaId);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(payments);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error getting DLA payments for {dlaId}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("GetAllDlaPayments")]
        public async Task<HttpResponseData> GetAllDlaPayments(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dla/payments")] HttpRequestData req)
        {
            _logger.LogInformation("Getting all DLA payments");

            try
            {
                var payments = await _dlaPaymentRepository.GetAllAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(payments);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting all DLA payments");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        // ─── DLA Missing Receipt Declaration endpoints ───────────────────

        [Function("GetDlaDeclaration")]
        public async Task<HttpResponseData> GetDlaDeclaration(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dla/{id}/declaration")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _declarationRepo.GetByDlaEntryIdAsync(id);
                if (declaration == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { message = "No declaration found for this DLA entry" });
                    return notFound;
                }
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(declaration);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting declaration for DLA entry {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        [Function("CreateDlaDeclaration")]
        public async Task<HttpResponseData> CreateDlaDeclaration(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla/{id}/declaration")] HttpRequestData req,
            int id)
        {
            try
            {
                var body = await new StreamReader(req.Body).ReadToEndAsync();
                var dto = JsonSerializer.Deserialize<MissingReceiptDeclarationDto>(body,
                    new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true,
                        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
                    });

                if (dto == null || string.IsNullOrWhiteSpace(dto.Description))
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Description is required" });
                    return bad;
                }

                var dlaEntry = await _dlaRepository.GetByIdAsync(id);
                if (dlaEntry == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "DLA entry not found" });
                    return notFound;
                }

                var declarationId = await _declarationRepo.GenerateNextDeclarationIdAsync();

                var declaration = new MissingReceiptDeclaration
                {
                    DeclarationId = declarationId,
                    DlaEntryId = id,
                    ExpenseId = null,
                    CreatedAt = DateTime.UtcNow,
                    DeclarationType = DeclarationType.DirectorExpenseDeclaration,
                    DeclarerName = dto.DeclarerName,
                    DeclarerRole = dto.DeclarerRole,
                    DeclarerEmail = dto.DeclarerEmail,
                    AmountGross = dto.AmountGross ?? dlaEntry.AmountGross,
                    Currency = dto.Currency ?? "GBP",
                    ExpenseDate = dto.ExpenseDate ?? dlaEntry.EntryDate,
                    MerchantOrPayee = dto.MerchantOrPayee,
                    BankTransactionRef = dto.BankTransactionRef,
                    ExpenseCategory = dto.ExpenseCategory ?? dlaEntry.Category,
                    Description = dto.Description,
                    ReasonReceiptMissing = dto.ReasonReceiptMissing,
                    OtherReasonText = dto.OtherReasonText,
                    VatReclaimable = false,
                    VatAmount = 0m,
                    AcknowledgementDisallowable = dto.AcknowledgementDisallowable,
                    SignatureType = dto.SignatureType,
                    TypedSignature = dto.TypedSignature,
                    Status = DeclarationStatus.Draft
                };

                var created = await _declarationRepo.CreateAsync(declaration);
                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(created);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating declaration for DLA entry {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        [Function("FinaliseDlaDeclaration")]
        public async Task<HttpResponseData> FinaliseDlaDeclaration(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla/{id}/declaration/finalise")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _declarationRepo.GetByDlaEntryIdAsync(id);
                if (declaration == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "No draft declaration found" });
                    return notFound;
                }

                if (declaration.Status == DeclarationStatus.Finalised)
                {
                    var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                    await conflict.WriteAsJsonAsync(new { error = "Declaration is already finalised" });
                    return conflict;
                }

                if (!declaration.AcknowledgementDisallowable)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Acknowledgement of CT disallowable status is required before finalising" });
                    return bad;
                }

                var company = await _companySettingsRepository.GetDefaultAsync();

                var tracked = await _declarationRepo.GetByIdAsync(declaration.Id);
                tracked!.Status = DeclarationStatus.Finalised;
                tracked.FinalisedAt = DateTime.UtcNow;

                try
                {
                    var (blobRef, hash) = await _pdfService.GenerateAndUploadAsync(tracked, company);
                    tracked.PdfBlobRef = blobRef;
                    tracked.HashSha256 = hash;
                }
                catch (Exception pdfEx)
                {
                    _logger.LogWarning(pdfEx, "PDF generation failed for DLA declaration {DeclarationId}", declaration.DeclarationId);
                }

                var finalised = await _declarationRepo.UpdateAsync(tracked);

                // Direct SQL UPDATE — mark declaration on file, zero VAT, set net = gross (VAT not reclaimable)
                await _dlaRepository.MarkDeclarationFiledAsync(id, declaration.DeclarationId!);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(finalised);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error finalising declaration for DLA entry {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        [Function("VoidDlaDeclaration")]
        public async Task<HttpResponseData> VoidDlaDeclaration(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "dla/{id}/declaration/void")] HttpRequestData req,
            int id)
        {
            try
            {
                var body = await new StreamReader(req.Body).ReadToEndAsync();
                var dto = JsonSerializer.Deserialize<VoidDeclarationDto>(body,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                var declaration = await _declarationRepo.GetByDlaEntryIdAsync(id);
                if (declaration == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "No declaration found" });
                    return notFound;
                }

                var tracked = await _declarationRepo.GetByIdAsync(declaration.Id);
                tracked!.Status = DeclarationStatus.Voided;
                tracked.VoidedAt = DateTime.UtcNow;
                tracked.VoidedReason = dto?.Reason;
                await _declarationRepo.UpdateAsync(tracked);

                var dlaEntry = await _dlaRepository.GetByIdAsync(id);
                if (dlaEntry != null)
                {
                    dlaEntry.HasMissingReceiptDeclaration = false;
                    dlaEntry.MissingReceiptDeclarationRef = null;
                    dlaEntry.ModifiedDate = DateTime.UtcNow;
                    await _dlaRepository.UpdateAsync(dlaEntry);
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { message = "Declaration voided" });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error voiding declaration for DLA entry {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        [Function("DownloadDlaDeclarationPdf")]
        public async Task<HttpResponseData> DownloadDlaDeclarationPdf(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "dla/{id}/declaration/pdf")] HttpRequestData req,
            int id)
        {
            try
            {
                var declaration = await _declarationRepo.GetByDlaEntryIdAsync(id);
                if (declaration == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "No declaration found" });
                    return notFound;
                }

                if (declaration.Status == DeclarationStatus.Finalised && !string.IsNullOrEmpty(declaration.PdfBlobRef))
                {
                    var storedPdf = await _pdfService.GetStoredPdfAsync(declaration.PdfBlobRef);
                    if (storedPdf != null)
                    {
                        var blobResponse = req.CreateResponse(HttpStatusCode.OK);
                        blobResponse.Headers.Add("Content-Type", "application/pdf");
                        blobResponse.Headers.Add("Content-Disposition",
                            $"inline; filename=\"{declaration.DeclarationId}.pdf\"");
                        await blobResponse.Body.WriteAsync(storedPdf);
                        return blobResponse;
                    }
                }

                var company = await _companySettingsRepository.GetDefaultAsync();
                var (pdfBytes, _) = await _pdfService.GeneratePdfAsync(declaration, company);

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/pdf");
                response.Headers.Add("Content-Disposition",
                    $"inline; filename=\"{declaration.DeclarationId ?? "declaration"}.pdf\"");
                await response.Body.WriteAsync(pdfBytes);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error downloading declaration PDF for DLA entry {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }
    }
}
