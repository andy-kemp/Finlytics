using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using FinanceHubFunctions.Services;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Data;
using Microsoft.Extensions.Logging;
using FinanceHubFunctions.Helpers;
using QuestPDF.Fluent;
using QuestPDF.Infrastructure;

namespace FinanceHubFunctions.Functions
{
    public class ExpenseFunctions
    {
        private readonly SharePointService _sharePointService;
        private readonly ILogger<ExpenseFunctions> _logger;
        private readonly IExpenseRepository? _expenseRepository;
        private readonly ISupplierRepository? _supplierRepository;
        private readonly FinanceHubDbContext? _dbContext;
        private readonly BlobStorageService? _blobStorageService;
        private readonly ICompanyLedgerRepository? _companyLedgerRepository;
        private readonly DeletionGuardService? _guard;

        public ExpenseFunctions(
            SharePointService sharePointService,
            ILogger<ExpenseFunctions> logger,
            IExpenseRepository? expenseRepository = null,
            ISupplierRepository? supplierRepository = null,
            FinanceHubDbContext? dbContext = null,
            BlobStorageService? blobStorageService = null,
            ICompanyLedgerRepository? companyLedgerRepository = null,
            DeletionGuardService? guard = null)
        {
            _sharePointService = sharePointService;
            _logger = logger;
            _expenseRepository = expenseRepository;
            _supplierRepository = supplierRepository;
            _dbContext = dbContext;
            _blobStorageService = blobStorageService;
            _companyLedgerRepository = companyLedgerRepository;
            _guard = guard;
        }

        private string GenerateSupplierCode(string supplierName, List<Supplier> existingSuppliers)
        {
            // Validate supplier name
            if (string.IsNullOrWhiteSpace(supplierName))
            {
                throw new ArgumentException("Supplier name cannot be empty");
            }

            // Remove special characters and take only letters
            var cleanName = new string(supplierName.Where(c => char.IsLetter(c)).ToArray());
            
            if (string.IsNullOrEmpty(cleanName))
            {
                // If no letters, use "SUP" as default prefix
                cleanName = "SUP";
            }
            
            // Take first 3 letters of supplier name, uppercase, pad if necessary
            var prefix = cleanName.Length >= 3 
                ? cleanName.Substring(0, 3).ToUpper() 
                : cleanName.ToUpper().PadRight(3, 'X');
            
            // Find all existing codes with same prefix
            var existingCodes = existingSuppliers
                .Where(s => !string.IsNullOrEmpty(s.SupplierCode) && s.SupplierCode.StartsWith(prefix))
                .Select(s => s.SupplierCode)
                .ToList();
            
            // Find next available number
            var nextNumber = 1;
            while (existingCodes.Contains($"{prefix}{nextNumber:D3}"))
            {
                nextNumber++;
            }
            
            return $"{prefix}{nextNumber:D3}";
        }

        [Function("GetExpenses")]
        public async Task<HttpResponseData> GetExpenses(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "expenses")] HttpRequestData req)
        {
            try
            {
                List<Expense> expenses;
                
                // Use database-first approach with SharePoint fallback
                if (_expenseRepository != null)
                {
                    var dbExpenses = await _expenseRepository.GetAllAsync();

                    // ?companyOnly=true — only company-card expenses (excludes all employee claims)
                    // Default — company expenses + approved employee claims (for company ledger / CT calc)
                    // Always excludes pending/draft/rejected employee claims
                    var queryParams = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
                    var companyOnly = string.Equals(queryParams["companyOnly"], "true", StringComparison.OrdinalIgnoreCase);

                    if (companyOnly)
                    {
                        expenses = dbExpenses
                            .Where(e => e.SubmittedByTeamMemberId == null)
                            .ToList();
                    }
                    else
                    {
                        expenses = dbExpenses
                            .Where(e => e.SubmittedByTeamMemberId == null
                                || e.ApprovalStatus == "Approved")
                            .ToList();
                    }
                }
                else
                {
                    var accessToken = AuthHelper.GetAccessToken(req);
                    expenses = await _sharePointService.GetExpenses(accessToken ?? "");
                }
                
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(expenses);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting expenses");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        private string CalculateTaxYear(DateTime date)
        {
            var year = date.Year;
            // UK tax year starts April 6
            if (date.Month < 4 || (date.Month == 4 && date.Day < 6))
            {
                return $"{year - 1}/{year.ToString().Substring(2)}";
            }
            return $"{year}/{(year + 1).ToString().Substring(2)}";
        }

        private static string GetDefaultCtTag(string? category) => category switch
        {
            "Client Entertainment" => "NonCT",  // S1298 CTA 2009 – wholly disallowed
            "Client Gifts"         => "NonCT",  // Disallowed unless branded <£50/client/year
            _                      => "Revenue"  // Default: CT-allowable revenue expense
        };

        private string CalculateFinancialYear(DateTime date, CompanySettings? settings)
        {
            if (settings == null || settings.FYStartMonth == null || settings.FYStartDay == null)
            {
                // Fall back to tax year if no FY settings
                return CalculateTaxYear(date);
            }

            var year = date.Year;
            var fyMonth = settings.FYStartMonth.Value;
            var fyDay = settings.FYStartDay.Value;

            if (date.Month < fyMonth || (date.Month == fyMonth && date.Day < fyDay))
            {
                return $"{year - 1}/{year.ToString().Substring(2)}";
            }
            return $"{year}/{(year + 1).ToString().Substring(2)}";
        }

        [Function("CreateExpense")]
        public async Task<HttpResponseData> CreateExpense(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "expenses")] HttpRequestData req)
        {
            try
            {
                var accessToken = AuthHelper.GetAccessToken(req);
                
                var requestBody = await req.ReadAsStringAsync();
                var expense = JsonSerializer.Deserialize<Expense>(requestBody, new JsonSerializerOptions 
                { 
                    PropertyNameCaseInsensitive = true 
                });

                if (expense == null)
                {
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteAsJsonAsync(new { error = "Invalid expense data" });
                    return badResponse;
                }

                // Validate required fields
                if (string.IsNullOrWhiteSpace(expense.Supplier) && string.IsNullOrWhiteSpace(expense.SupplierFreeText))
                {
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteAsJsonAsync(new { error = "Supplier name is required" });
                    return badResponse;
                }

                // ── Trivial Benefit enforcement (HMRC s.323) ────────────────────────────
                if (expense.IsTrivialBenefit)
                {
                    if ((expense.AmountGross ?? 0) > 50.00m)
                    {
                        var tb400 = req.CreateResponse(HttpStatusCode.BadRequest);
                        await tb400.WriteStringAsync("Trivial benefit amount cannot exceed £50.00 — amounts above this are void for HMRC exemption purposes.");
                        return tb400;
                    }

                    if (_expenseRepository != null && _dbContext != null)
                    {
                        var taxYearKey = CalculateTaxYear(expense.EntryDate ?? expense.DatePaid ?? DateTime.Now);
                        var recipient = expense.TrivialBenefitRecipient ?? "";

                        if (!string.IsNullOrWhiteSpace(recipient))
                        {
                            var allExp = await _expenseRepository.GetAllAsync();
                            var expCount = allExp.Count(e => e.IsTrivialBenefit && e.TaxYear == taxYearKey
                                && string.Equals(e.TrivialBenefitRecipient, recipient, StringComparison.OrdinalIgnoreCase));
                            var dlaCount = await _dbContext.Set<DlaEntry>().CountAsync(d => d.IsTrivialBenefit && d.TaxYear == taxYearKey
                                && (d.TrivialBenefitRecipient ?? d.Director) == recipient);
                            if (expCount + dlaCount >= 6)
                            {
                                var tb400 = req.CreateResponse(HttpStatusCode.BadRequest);
                                await tb400.WriteStringAsync($"Trivial benefit limit reached: {recipient} already has 6 of 6 recorded in tax year {taxYearKey}. HMRC allows a maximum of 6 trivial benefits per employee/director per tax year.");
                                return tb400;
                            }
                        }
                    }

                    // Force category and CT tag
                    expense.Category = "Trivial Benefit";
                    expense.CtTag = "NonCT";
                }

                // Get company settings for FY calculation
                CompanySettings? companySettings = null;
                if (_dbContext != null)
                {
                    companySettings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
                }

                // Set EntryDate to DatePaid if not provided
                if (!expense.EntryDate.HasValue && expense.DatePaid.HasValue)
                {
                    expense.EntryDate = expense.DatePaid;
                }

                // Calculate Tax Year and Financial Year
                var entryDate = expense.EntryDate ?? DateTime.Now;
                expense.TaxYear = CalculateTaxYear(entryDate);
                expense.FinancialYear = CalculateFinancialYear(entryDate, companySettings);

                // Set CT tag – use supplied value or derive from category
                expense.CtTag = string.IsNullOrWhiteSpace(expense.CtTag)
                    ? GetDefaultCtTag(expense.Category)
                    : expense.CtTag;

                // Check if supplier exists and get supplier code
                string? supplierCode = null;
                string? supplierLookupId = null;
                if (!string.IsNullOrEmpty(expense.Supplier))
                {
                    List<Supplier> suppliers;
                    if (_supplierRepository != null)
                    {
                        var dbSuppliers = await _supplierRepository.GetAllAsync();
                        suppliers = dbSuppliers.ToList();
                    }
                    else
                    {
                        var token = AuthHelper.GetAccessToken(req);
                        suppliers = await _sharePointService.GetSuppliers(token ?? "");
                    }
                    
                    var existingSupplier = suppliers.FirstOrDefault(s => 
                        s.Name?.Equals(expense.Supplier, StringComparison.OrdinalIgnoreCase) == true);
                    
                    if (existingSupplier != null)
                    {
                        supplierLookupId = existingSupplier.Id;
                        supplierCode = existingSupplier.SupplierCode;
                    }
                    else
                    {
                        // Create new supplier - auto-generate supplier code
                        var supplierName = expense.Supplier;
                        supplierCode = GenerateSupplierCode(supplierName, suppliers);
                        
                        // Generate unique ID (similar to SharePoint pattern)
                        var newId = Guid.NewGuid().ToString();
                        
                        var newSupplier = new Supplier
                        {
                            Id = newId,
                            Code = supplierCode,  // Code field is required
                            SupplierCode = supplierCode,  // Legacy field for compatibility
                            Name = supplierName,
                            Category = expense.Category ?? "Other",
                            DefaultVATRate = (int?)(expense.VATRate ?? 20)
                        };
                        
                        _logger.LogInformation($"Creating new supplier: {supplierName} with ID: {newId}, code: {supplierCode}");
                        
                        // Create supplier using database-first approach
                        if (_supplierRepository != null)
                        {
                            var createdSupplier = await _supplierRepository.CreateAsync(newSupplier);
                            supplierLookupId = createdSupplier.Id.ToString();
                            supplierCode = createdSupplier.SupplierCode;
                            _logger.LogInformation($"Supplier created successfully with ID: {supplierLookupId}, Code: {supplierCode}");
                            
                            // IMPORTANT: Detach ALL entities from the context to avoid tracking conflicts
                            if (_dbContext != null)
                            {
                                // Detach the newly created supplier
                                _dbContext.Entry(createdSupplier).State = EntityState.Detached;
                                
                                // Clear all tracked entities to ensure clean state for expense creation
                                _dbContext.ChangeTracker.Clear();
                            }
                        }
                        else
                        {
                            var token = AuthHelper.GetAccessToken(req);
                            var created = await _sharePointService.CreateSupplier(newSupplier, token ?? "");
                            if (created)
                            {
                                // Get the newly created supplier
                                var updatedSuppliers = await _sharePointService.GetSuppliers(token ?? "");
                                var createdSupplier = updatedSuppliers.FirstOrDefault(s => 
                                    s.Name?.Equals(expense.Supplier, StringComparison.OrdinalIgnoreCase) == true);
                                if (createdSupplier != null)
                                {
                                    supplierLookupId = createdSupplier.Id;
                                    supplierCode = createdSupplier.SupplierCode;
                                }
                            }
                        }
                    }
                }

                // Generate Expense ID: SUPCODE-YEAR-NNN
                if (string.IsNullOrEmpty(supplierCode))
                {
                    supplierCode = "UNK";
                }

                int? createdDbId = null;
                string? createdExpenseCode = null;
                string ledgerId;
                if (_expenseRepository != null)
                {
                    // Get count of expenses for this supplier this year
                    var year = entryDate.Year;
                    var existingExpenses = await _expenseRepository.GetAllAsync();
                    var yearExpenses = existingExpenses
                        .Where(e => e.ExpenseId != null && e.ExpenseId.StartsWith($"{supplierCode}-{year}-"))
                        .ToList();
                    
                    var nextNumber = yearExpenses.Count + 1;
                    expense.ExpenseId = $"{supplierCode}-{year}-{nextNumber:D3}";
                    
                    var createdExpense = await _expenseRepository.CreateAsync(expense);
                    createdDbId = createdExpense.Id;
                    createdExpenseCode = createdExpense.ExpenseId;
                    ledgerId = createdExpense.Id.ToString();
                    
                    // If this is a DLA expense, create a Company Ledger entry
                    if (expense.IsDLA && _companyLedgerRepository != null)
                    {
                        var dlaEntry = new CompanyLedgerEntry
                        {
                            Title = $"DLA Payment: {expense.Supplier} - {expense.Category}",
                            EntryType = "DLA_Out",
                            Amount = expense.AmountGross ?? 0,
                            EffectiveDate = expense.DatePaid ?? expense.EntryDate ?? DateTime.Now,
                            Notes = $"Expense ID: {expense.ExpenseId}. {expense.Notes}",
                            PeriodKey = (expense.DatePaid ?? expense.EntryDate ?? DateTime.Now).ToString("yyyy-MM"),
                            TaxYear = int.Parse(expense.TaxYear?.Split('/')[0] ?? year.ToString()),
                            FinancialYear = expense.FinancialYear
                        };
                        
                        await _companyLedgerRepository.CreateAsync(dlaEntry);
                        _logger.LogInformation($"Created DLA Company Ledger entry for expense {expense.ExpenseId}");
                    }
                }
                else
                {
                    var token = AuthHelper.GetAccessToken(req);
                    var expenseId = await _sharePointService.CreateExpense(expense, token ?? "", supplierLookupId);
                    ledgerId = expenseId.ToString();
                    createdExpenseCode = expense.ExpenseId;
                }

                if (!createdDbId.HasValue && int.TryParse(ledgerId, out var parsedId))
                {
                    createdDbId = parsedId;
                }
                
                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(new
                {
                    success = true,
                    id = createdDbId,
                    expenseId = createdExpenseCode,
                    legacyId = ledgerId
                });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating expense");
                var errorMessage = ex.Message;
                if (ex.InnerException != null)
                {
                    errorMessage += $" Inner: {ex.InnerException.Message}";
                    if (ex.InnerException.InnerException != null)
                    {
                        errorMessage += $" InnerInner: {ex.InnerException.InnerException.Message}";
                    }
                }
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = errorMessage });
                return response;
            }
        }

        [Function("UpdateExpense")]
        public async Task<HttpResponseData> UpdateExpense(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "expenses/{id}")] HttpRequestData req,
            int id)
        {
            try
            {
                var requestBody = await req.ReadAsStringAsync();
                _logger.LogInformation($"UpdateExpense: Received body for id={id}: {requestBody?.Substring(0, Math.Min(500, requestBody?.Length ?? 0))}");

                var expense = JsonSerializer.Deserialize<Expense>(requestBody, new JsonSerializerOptions 
                { 
                    PropertyNameCaseInsensitive = true 
                });

                if (expense == null)
                {
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteAsJsonAsync(new { error = "Invalid expense data" });
                    return badResponse;
                }

                _logger.LogInformation($"UpdateExpense: Deserialized - Supplier={expense.Supplier}, DatePaid={expense.DatePaid}, EntryDate={expense.EntryDate}, Category={expense.Category}");

                if (_dbContext != null)
                {
                    // ── Database path ──────────────────────────────────────────────────
                    // NOTE: Do NOT call SharePoint here - the supplier is already stored
                    // in the DB Expense.Supplier field and no SharePoint lookup is needed.
                    var existing = await _dbContext.Expenses.FindAsync(id);
                    if (existing == null)
                    {
                        _logger.LogWarning($"UpdateExpense: Expense {id} not found in DB");
                        var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                        await notFoundResponse.WriteAsJsonAsync(new { error = "Expense not found" });
                        return notFoundResponse;
                    }

                    _logger.LogInformation($"UpdateExpense: Updating expense {id}, old DatePaid={existing.DatePaid}, new DatePaid={expense.DatePaid}");

                    // Get company settings for FY recalculation
                    CompanySettings? companySettings = null;
                    try { companySettings = await _dbContext.CompanySettings.FirstOrDefaultAsync(); } catch { }

                    // Determine the effective date (prefer DatePaid from the request)
                    var effectiveDate = expense.DatePaid ?? expense.EntryDate ?? existing.DatePaid ?? existing.EntryDate ?? DateTime.Now;

                    existing.Supplier         = expense.Supplier;
                    existing.SupplierFreeText = expense.SupplierFreeText;
                    existing.Reference        = expense.Reference;
                    existing.Category         = expense.Category;
                    existing.VATApplicability = expense.VATApplicability;
                    existing.VATIncluded      = expense.VATIncluded;
                    existing.VATRate          = expense.VATRate;
                    existing.AmountNet        = expense.AmountNet;
                    existing.VATAmount        = expense.VATAmount;
                    existing.AmountGross      = expense.AmountGross;
                    existing.DatePaid         = effectiveDate;
                    existing.EntryDate        = effectiveDate; // always keep both in sync
                    existing.PaymentMethod    = expense.PaymentMethod;
                    existing.Notes            = expense.Notes;
                    existing.TaxYear          = CalculateTaxYear(effectiveDate);
                    existing.FinancialYear    = CalculateFinancialYear(effectiveDate, companySettings);
                    existing.IsDLA            = expense.IsDLA;
                    existing.CtTag            = string.IsNullOrWhiteSpace(expense.CtTag)
                                                    ? GetDefaultCtTag(expense.Category)
                                                    : expense.CtTag;

                    await _dbContext.SaveChangesAsync();
                    _logger.LogInformation($"UpdateExpense: Saved successfully. New DatePaid={existing.DatePaid}, EntryDate={existing.EntryDate}");
                }
                else
                {
                    // SharePoint fallback path
                    var accessToken = AuthHelper.GetAccessToken(req);
                    string? supplierLookupId = null;
                    if (!string.IsNullOrEmpty(expense.Supplier))
                    {
                        try
                        {
                            var suppliers = await _sharePointService.GetSuppliers(accessToken ?? "");
                            var existingSupplier = suppliers.FirstOrDefault(s =>
                                s.Name?.Equals(expense.Supplier, StringComparison.OrdinalIgnoreCase) == true);
                            if (existingSupplier != null)
                                supplierLookupId = existingSupplier.Id.ToString();
                        }
                        catch (Exception spEx)
                        {
                            _logger.LogWarning($"UpdateExpense: SharePoint supplier lookup failed (non-fatal): {spEx.Message}");
                        }
                    }
                    await _sharePointService.UpdateExpense(id, expense, accessToken ?? "", supplierLookupId);
                }
                
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { success = true });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"UpdateExpense: Error updating expense {id}: {ex.Message}");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("PatchExpenseNoReceiptReason")]
        public async Task<HttpResponseData> PatchExpenseNoReceiptReason(
            [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "expenses/{id}/no-receipt-reason")] HttpRequestData req,
            int id)
        {
            try
            {
                if (_dbContext == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.ServiceUnavailable);
                    await bad.WriteStringAsync("Database not available");
                    return bad;
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
                var existing = await _dbContext.Expenses.FindAsync(id);
                if (existing == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteStringAsync($"Expense {id} not found");
                    return notFound;
                }
                existing.NoReceiptReason = reason;
                await _dbContext.SaveChangesAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { success = true });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error patching expense {id} no-receipt-reason");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync($"Error: {ex.Message}");
                return errorResponse;
            }
        }

        [Function("DeleteExpense")]
        public async Task<HttpResponseData> DeleteExpense(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "expenses/{id}")] HttpRequestData req,
            int id)
        {
            try
            {
                _logger.LogInformation($"DeleteExpense: Deleting expense with ID {id}");

                if (_guard != null)
                {
                    var blocked = await _guard.GuardAsync(req, "expense");
                    if (blocked != null) return blocked;
                }

                if (_dbContext != null)
                {
                    var expense = await _dbContext.Expenses.FindAsync(id);
                    if (expense == null)
                    {
                        var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                        await notFoundResponse.WriteAsJsonAsync(new { error = "Expense not found" });
                        return notFoundResponse;
                    }

                    // Note: Attachments in blob storage are left orphaned for now
                    // A cleanup job could be added later to remove orphaned blobs
                    if (!string.IsNullOrEmpty(expense.ReceiptUrl))
                    {
                        _logger.LogInformation($"DeleteExpense: Expense {id} had attachments that may need manual cleanup");
                    }

                    _dbContext.Expenses.Remove(expense);
                    await _dbContext.SaveChangesAsync();

                    _logger.LogInformation($"DeleteExpense: Successfully deleted expense {id}");
                }
                else
                {
                    // SharePoint fallback - not implemented for delete
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteAsJsonAsync(new { error = "Delete operation requires database connection" });
                    return badResponse;
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { success = true, message = $"Expense {id} deleted successfully" });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error deleting expense {id}");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("GetCategories")]
        public async Task<HttpResponseData> GetCategories(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "categories")] HttpRequestData req)
        {
            try
            {
                var categories = await _sharePointService.GetCategories("");
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(categories);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting categories");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("GetVATApplicabilities")]
        public async Task<HttpResponseData> GetVATApplicabilities(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "vatapplicabilities")] HttpRequestData req)
        {
            try
            {
                var vatApplicabilities = await _sharePointService.GetVATApplicabilities("");
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(vatApplicabilities);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting VAT applicabilities");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("GetPaymentMethods")]
        public async Task<HttpResponseData> GetPaymentMethods(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "paymentmethods")] HttpRequestData req)
        {
            try
            {
                var paymentMethods = await _sharePointService.GetPaymentMethods("");
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(paymentMethods);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting payment methods");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("UploadReceipt")]
        public async Task<HttpResponseData> UploadReceipt(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "expenses/{id}/upload")] HttpRequestData req,
            int id)
        {
            try
            {
                _logger.LogInformation($"UploadReceipt: Starting upload for expense ID {id}");
                
                if (_blobStorageService == null)
                {
                    _logger.LogError("BlobStorageService not configured");
                    var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errorResponse.WriteAsJsonAsync(new { error = "Blob storage not configured" });
                    return errorResponse;
                }

                // Get expense to get the ExpenseId code
                Expense? expense = null;
                if (_expenseRepository != null)
                {
                    expense = await _expenseRepository.GetByIdAsync(id);
                }

                if (expense == null || string.IsNullOrEmpty(expense.ExpenseId))
                {
                    _logger.LogError($"Expense {id} not found or has no ExpenseId");
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteAsJsonAsync(new { error = "Expense not found" });
                    return notFoundResponse;
                }
                
                // Parse multipart form data
                var contentType = req.Headers.GetValues("Content-Type").FirstOrDefault();
                _logger.LogInformation($"UploadReceipt: Content-Type: {contentType}");
                
                if (string.IsNullOrEmpty(contentType) || !contentType.Contains("boundary="))
                {
                    _logger.LogWarning("UploadReceipt: Invalid Content-Type header - no boundary found");
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteAsJsonAsync(new { error = "Invalid Content-Type header - no multipart boundary" });
                    return badResponse;
                }

                var rawBoundary = contentType.Split("boundary=")[1].Trim();
                // Strip any trailing params (e.g. "boundary=abc123; charset=utf-8") and strip quotes
                var boundary = rawBoundary.Split(';')[0].Trim().Trim('"');
                
                if (string.IsNullOrEmpty(boundary))
                {
                    _logger.LogWarning("UploadReceipt: Empty boundary value");
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteAsJsonAsync(new { error = "Empty boundary value" });
                    return badResponse;
                }

                using var memoryStream = new System.IO.MemoryStream();
                await req.Body.CopyToAsync(memoryStream);
                var body = memoryStream.ToArray();
                _logger.LogInformation($"UploadReceipt: Received {body.Length} bytes");
                
                var fileContent = ExtractFileFromMultipart(body, boundary, out string fileName);
                _logger.LogInformation($"UploadReceipt: Extracted file - name: {fileName}, size: {fileContent?.Length}");

                if (fileContent == null || string.IsNullOrEmpty(fileName))
                {
                    _logger.LogWarning("UploadReceipt: No file uploaded or extraction failed");
                    var badResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badResponse.WriteAsJsonAsync(new { error = "No file uploaded" });
                    return badResponse;
                }

                // Upload to blob storage
                _logger.LogInformation($"UploadReceipt: Uploading to blob storage...");
                var blobUrl = await _blobStorageService.UploadReceiptAsync(id, expense.ExpenseId, fileContent, fileName);
                _logger.LogInformation($"UploadReceipt: Upload successful - {blobUrl}");
                
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { success = true, fileName, url = blobUrl });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error uploading receipt for expense {id}: {ex.Message}");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("GetExpenseAttachments")]
        public async Task<HttpResponseData> GetExpenseAttachments(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "expenses/{id}/attachments")] HttpRequestData req,
            int id)
        {
            try
            {
                if (_blobStorageService == null)
                {
                    _logger.LogError("BlobStorageService not configured");
                    var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errorResponse.WriteAsJsonAsync(new { error = "Blob storage not configured" });
                    return errorResponse;
                }

                // Get expense to get the ExpenseId code
                Expense? expense = null;
                if (_expenseRepository != null)
                {
                    expense = await _expenseRepository.GetByIdAsync(id);
                }

                if (expense == null || string.IsNullOrEmpty(expense.ExpenseId))
                {
                    _logger.LogError($"Expense {id} not found or has no ExpenseId");
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteAsJsonAsync(new { error = "Expense not found" });
                    return notFoundResponse;
                }

                var receipts = await _blobStorageService.GetReceiptsAsync(id, expense.ExpenseId);
                
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(receipts);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting attachments");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("DeleteExpenseAttachment")]
        public async Task<HttpResponseData> DeleteExpenseAttachment(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "expenses/{id}/attachments/{fileName}")] HttpRequestData req,
            int id,
            string fileName)
        {
            try
            {
                if (_guard != null)
                {
                    var blocked = await _guard.GuardAsync(req, "expense attachment");
                    if (blocked != null) return blocked;
                }

                if (_blobStorageService == null)
                {
                    _logger.LogError("BlobStorageService not configured");
                    var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errorResponse.WriteAsJsonAsync(new { error = "Blob storage not configured" });
                    return errorResponse;
                }

                // Get expense to get the ExpenseId code
                Expense? expense = null;
                if (_expenseRepository != null)
                {
                    expense = await _expenseRepository.GetByIdAsync(id);
                }

                if (expense == null || string.IsNullOrEmpty(expense.ExpenseId))
                {
                    _logger.LogError($"Expense {id} not found or has no ExpenseId");
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteAsJsonAsync(new { error = "Expense not found" });
                    return notFoundResponse;
                }

                _logger.LogInformation($"DeleteExpenseAttachment: Deleting attachment '{fileName}' from expense {id}");
                
                var decodedFileName = Uri.UnescapeDataString(fileName);
                // Construct blob name: {ExpenseCode}/{fileName}
                var blobName = $"{expense.ExpenseId}/{decodedFileName}";
                await _blobStorageService.DeleteReceiptAsync(blobName);
                
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { success = true });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error deleting attachment: {ex.Message}");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("ViewReceipt")]
        public async Task<HttpResponseData> ViewReceipt(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "expenses/{id}/receipts/{fileName}")] HttpRequestData req,
            int id,
            string fileName)
        {
            try
            {
                if (_blobStorageService == null)
                {
                    _logger.LogError("BlobStorageService not configured");
                    var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errorResponse.WriteAsJsonAsync(new { error = "Blob storage not configured" });
                    return errorResponse;
                }

                // Get expense to get the ExpenseId code
                Expense? expense = null;
                if (_expenseRepository != null)
                {
                    expense = await _expenseRepository.GetByIdAsync(id);
                }

                if (expense == null || string.IsNullOrEmpty(expense.ExpenseId))
                {
                    _logger.LogError($"Expense {id} not found or has no ExpenseId");
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteAsJsonAsync(new { error = "Expense not found" });
                    return notFoundResponse;
                }

                var decodedFileName = Uri.UnescapeDataString(fileName);
                var blobName = $"{expense.ExpenseId}/{decodedFileName}";
                
                var (content, contentType, originalFileName) = await _blobStorageService.DownloadReceiptAsync(blobName);

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", contentType);
                response.Headers.Add("Content-Disposition", $"inline; filename=\"{originalFileName}\"");
                await response.Body.WriteAsync(content, 0, content.Length);
                
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error viewing receipt: {ex.Message}");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("GenerateExpenseClaimPdf")]
        public async Task<HttpResponseData> GenerateExpenseClaimPdf(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "expenses/{id}/claim-pdf")] HttpRequestData req,
            int id)
        {
            try
            {
                if (_blobStorageService == null)
                {
                    _logger.LogError("BlobStorageService not configured");
                    var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await errorResponse.WriteAsJsonAsync(new { error = "Blob storage not configured" });
                    return errorResponse;
                }

                // Get expense details
                Expense? expense = null;
                if (_expenseRepository != null)
                {
                    expense = await _expenseRepository.GetByIdAsync(id);
                }

                if (expense == null)
                {
                    _logger.LogError($"Expense {id} not found");
                    var notFoundResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFoundResponse.WriteAsJsonAsync(new { error = "Expense not found" });
                    return notFoundResponse;
                }

                // Get receipts
                var receipts = string.IsNullOrEmpty(expense.ExpenseId) 
                    ? new List<ExpenseReceiptInfo>() 
                    : await _blobStorageService.GetReceiptsAsync(id, expense.ExpenseId);

                // Pre-download receipt content for PDF embedding
                var receiptContents = new Dictionary<string, (byte[] content, string contentType)>();
                foreach (var receipt in receipts)
                {
                    try
                    {
                        var (content, contentType, fileName) = await _blobStorageService.DownloadReceiptAsync(receipt.BlobName);
                        receiptContents[receipt.BlobName] = (content, contentType);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning($"Could not download receipt {receipt.FileName}: {ex.Message}");
                    }
                }

                // Generate PDF using QuestPDF
                var document = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        page.Size(QuestPDF.Helpers.PageSizes.A4);
                        page.Margin(50);
                        page.DefaultTextStyle(x => x.FontSize(11));

                        page.Header().Element(ComposeHeader);
                        page.Content().Element(c => ComposeContent(c, expense));
                        page.Footer().Element(ComposeFooter);
                    });

                    // Add receipt pages
                    foreach (var receipt in receipts)
                    {
                        container.Page(page =>
                        {
                            page.Size(QuestPDF.Helpers.PageSizes.A4);
                            page.Margin(50);

                            page.Header().Element(h => ComposeReceiptHeader(h, receipt.FileName));
                            page.Content().Element(c => ComposeReceiptContent(c, receipt, receiptContents));
                        });
                    }
                });

                var pdfBytes = document.GeneratePdf();

                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/pdf");
                response.Headers.Add("Content-Disposition", $"attachment; filename=\"ExpenseClaim_{expense.ExpenseId}.pdf\"");
                await response.Body.WriteAsync(pdfBytes, 0, pdfBytes.Length);

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error generating expense claim PDF: {ex.Message}");
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        private void ComposeHeader(IContainer container)
        {
            container.Row(row =>
            {
                row.RelativeItem().Column(column =>
                {
                    column.Item().Text("EXPENSE CLAIM").FontSize(20).Bold();
                    column.Item().Text(text =>
                    {
                        text.Span("Generated: ").FontSize(9);
                        text.Span(DateTime.Now.ToString("dd/MM/yyyy HH:mm")).FontSize(9);
                    });
                });
            });
        }

        private void ComposeContent(IContainer container, Expense expense)
        {
            container.PaddingVertical(20).Column(column =>
            {
                column.Spacing(10);

                column.Item().Row(row =>
                {
                    row.RelativeItem().Text("Expense ID:").Bold();
                    row.RelativeItem().Text(expense.ExpenseId ?? "N/A");
                });

                column.Item().Row(row =>
                {
                    row.RelativeItem().Text("Date:").Bold();
                    row.RelativeItem().Text(expense.EntryDate?.ToString("dd/MM/yyyy") ?? "N/A");
                });

                column.Item().Row(row =>
                {
                    row.RelativeItem().Text("Supplier:").Bold();
                    row.RelativeItem().Text(expense.Supplier ?? expense.SupplierFreeText ?? "N/A");
                });

                column.Item().Row(row =>
                {
                    row.RelativeItem().Text("Reference:").Bold();
                    row.RelativeItem().Text(expense.Reference ?? "N/A");
                });

                column.Item().Row(row =>
                {
                    row.RelativeItem().Text("Net Amount:").Bold();
                    row.RelativeItem().Text($"£{expense.AmountNet:N2}");
                });

                column.Item().Row(row =>
                {
                    row.RelativeItem().Text("VAT Amount:").Bold();
                    row.RelativeItem().Text($"£{expense.VATAmount:N2}");
                });

                column.Item().Row(row =>
                {
                    row.RelativeItem().Text("Gross Amount:").Bold();
                    row.RelativeItem().Text($"£{expense.AmountGross:N2}");
                });

                if (!string.IsNullOrEmpty(expense.Notes))
                {
                    column.Item().PaddingTop(10).Text("Notes:").Bold();
                    column.Item().Text(expense.Notes);
                }
            });
        }

        private void ComposeFooter(IContainer container)
        {
            container.AlignCenter().Text(text =>
            {
                text.Span("Page ").FontSize(9);
                text.CurrentPageNumber().FontSize(9);
            });
        }

        private void ComposeReceiptHeader(IContainer container, string fileName)
        {
            container.Row(row =>
            {
                row.RelativeItem().Column(column =>
                {
                    column.Item().Text("RECEIPT").FontSize(16).Bold();
                    column.Item().Text(fileName).FontSize(9);
                });
            });
        }

        private void ComposeReceiptContent(IContainer container, ExpenseReceiptInfo receipt, Dictionary<string, (byte[] content, string contentType)> receiptContents)
        {
            container.PaddingVertical(20).Column(column =>
            {
                try
                {
                    if (receiptContents.TryGetValue(receipt.BlobName, out var receiptData))
                    {
                        var (content, contentType) = receiptData;

                        // If it's an image, embed it
                        if (contentType.StartsWith("image/"))
                        {
                            column.Item().Image(content).FitArea();
                        }
                        else
                        {
                            column.Item().Text($"Receipt: {receipt.FileName}");
                            column.Item().Text($"Size: {receipt.SizeInBytes / 1024}KB");
                            column.Item().Text($"Uploaded: {receipt.UploadDate:dd/MM/yyyy HH:mm}");
                            column.Item().PaddingTop(10).Text("(Non-image receipt - view separately)");
                        }
                    }
                    else
                    {
                        column.Item().Text($"Receipt: {receipt.FileName}");
                        column.Item().Text("(Unable to load receipt content)");
                    }
                }
                catch (Exception ex)
                {
                    column.Item().Text($"Error loading receipt: {ex.Message}");
                }
            });
        }

        private byte[] ExtractFileFromMultipart(byte[] body, string boundary, out string fileName)
        {
            fileName = "";
            try
            {
                var boundaryBytes = System.Text.Encoding.UTF8.GetBytes("--" + boundary);
                var newlineBytes = new byte[] { 13, 10 }; // \r\n
                var doubleNewlineBytes = new byte[] { 13, 10, 13, 10 }; // \r\n\r\n

                // Find the first boundary
                int searchPos = 0;
                while (searchPos < body.Length)
                {
                    // Look for Content-Disposition header
                    var headerStart = IndexOfBytes(body, System.Text.Encoding.UTF8.GetBytes("Content-Disposition: form-data"), searchPos);
                    if (headerStart == -1) break;

                    // Look for filename in the header
                    var filenameStart = IndexOfBytes(body, System.Text.Encoding.UTF8.GetBytes("filename=\""), headerStart);
                    if (filenameStart == -1)
                    {
                        searchPos = headerStart + 1;
                        continue;
                    }

                    // Extract filename
                    filenameStart += 10; // length of 'filename="'
                    var filenameEnd = Array.IndexOf(body, (byte)'"', filenameStart);
                    if (filenameEnd > filenameStart)
                    {
                        fileName = System.Text.Encoding.UTF8.GetString(body, filenameStart, filenameEnd - filenameStart);
                    }

                    // Find the start of file content (after \r\n\r\n)
                    var headerEnd = IndexOfBytes(body, doubleNewlineBytes, headerStart);
                    if (headerEnd == -1) break;

                    var contentStart = headerEnd + 4;

                    // Find the end boundary
                    var contentEnd = IndexOfBytes(body, boundaryBytes, contentStart);
                    if (contentEnd == -1) contentEnd = body.Length;

                    // Remove trailing \r\n before boundary
                    if (contentEnd >= 2 && body[contentEnd - 2] == 13 && body[contentEnd - 1] == 10)
                    {
                        contentEnd -= 2;
                    }

                    // Extract the file bytes
                    var fileLength = contentEnd - contentStart;
                    var fileBytes = new byte[fileLength];
                    Array.Copy(body, contentStart, fileBytes, 0, fileLength);
                    
                    return fileBytes;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error extracting file from multipart");
            }

            return null;
        }

        private int IndexOfBytes(byte[] array, byte[] pattern, int startIndex)
        {
            for (int i = startIndex; i <= array.Length - pattern.Length; i++)
            {
                bool found = true;
                for (int j = 0; j < pattern.Length; j++)
                {
                    if (array[i + j] != pattern[j])
                    {
                        found = false;
                        break;
                    }
                }
                if (found) return i;
            }
            return -1;
        }
    }
}
