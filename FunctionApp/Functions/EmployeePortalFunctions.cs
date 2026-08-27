using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;

namespace FinanceHubFunctions.Functions
{
    /// <summary>
    /// Employee Portal API — all endpoints require Clerk JWT authentication.
    /// Employees can submit expenses, log mileage, and view their submissions.
    /// </summary>
    public class EmployeePortalFunctions
    {
        private const decimal DefaultRate45p = 0.45m;
        private const decimal DefaultRate55p = 0.55m;
        private const decimal DefaultRate25p = 0.25m;
        private const decimal DefaultThresholdMiles = 10000m;

        private readonly ClerkAuthService _clerkAuth;
        private readonly ITeamMemberRepository _teamMemberRepo;
        private readonly IExpenseRepository _expenseRepo;
        private readonly IMileageTripRepository _mileageRepo;
        private readonly IEmployeeRepository _employeeRepo;
        private readonly ICompanySettingsRepository _companySettingsRepo;
        private readonly BlobStorageService? _blobService;

        public EmployeePortalFunctions(
            ClerkAuthService clerkAuth,
            ITeamMemberRepository teamMemberRepo,
            IExpenseRepository expenseRepo,
            IMileageTripRepository mileageRepo,
            IEmployeeRepository employeeRepo,
            ICompanySettingsRepository companySettingsRepo,
            BlobStorageService? blobService = null)
        {
            _clerkAuth = clerkAuth;
            _teamMemberRepo = teamMemberRepo;
            _expenseRepo = expenseRepo;
            _mileageRepo = mileageRepo;
            _employeeRepo = employeeRepo;
            _companySettingsRepo = companySettingsRepo;
            _blobService = blobService;
        }

        // ─────────────────────────────────────────────────
        // Auth helper — validates Clerk JWT and resolves TeamMember
        // ─────────────────────────────────────────────────
        private async Task<(TeamMember? member, HttpResponseData? errorResponse)> AuthenticateEmployee(HttpRequestData req)
        {
            var clerkUser = await _clerkAuth.ValidateRequestAsync(req);
            if (clerkUser == null)
            {
                var resp = req.CreateResponse(HttpStatusCode.Unauthorized);
                await resp.WriteAsJsonAsync(new { error = "Invalid or missing authentication token" });
                return (null, resp);
            }

            var member = await _teamMemberRepo.GetByClerkUserIdAsync(clerkUser.UserId);
            if (member == null || member.Status != "Active")
            {
                var resp = req.CreateResponse(HttpStatusCode.Forbidden);
                await resp.WriteAsJsonAsync(new { error = "You are not an active team member" });
                return (null, resp);
            }

            return (member, null);
        }

        // ─────────────────────────────────────────────────
        // GET /api/employee/me — Get current employee profile
        // ─────────────────────────────────────────────────
        [Function("EmployeeGetProfile")]
        public async Task<HttpResponseData> GetProfile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "employee/me")] HttpRequestData req)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                member!.Id,
                member.Email,
                member.DisplayName,
                member.Role,
                member.EmployeeId,
                member.CompanyId
            });
            return response;
        }

        // ─────────────────────────────────────────────────
        // GET /api/employee/expenses — List employee's expenses
        // ─────────────────────────────────────────────────
        [Function("EmployeeListExpenses")]
        public async Task<HttpResponseData> ListExpenses(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "employee/expenses")] HttpRequestData req)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            var allExpenses = await _expenseRepo.GetAllAsync();
            var myExpenses = allExpenses
                .Where(e => e.SubmittedByTeamMemberId == member!.Id)
                .OrderByDescending(e => e.EntryDate)
                .Select(e => new
                {
                    e.Id,
                    e.ExpenseId,
                    e.Supplier,
                    e.Category,
                    e.AmountGross,
                    e.AmountNet,
                    e.VATAmount,
                    e.EntryDate,
                    e.ApprovalStatus,
                    e.RejectionReason,
                    e.SubmittedAt,
                    e.ApprovedAt,
                    e.Notes,
                    HasReceipt = e.Attachments != null && e.Attachments.Count > 0
                });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(myExpenses);
            return response;
        }

        // ─────────────────────────────────────────────────
        // POST /api/employee/expenses — Submit a new expense
        // ─────────────────────────────────────────────────
        [Function("EmployeeCreateExpense")]
        public async Task<HttpResponseData> CreateExpense(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "employee/expenses")] HttpRequestData req)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            try
            {
                var body = await req.ReadAsStringAsync();
                if (string.IsNullOrEmpty(body))
                {
                    var badReq = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badReq.WriteAsJsonAsync(new { error = "Request body is required" });
                    return badReq;
                }

                var expense = JsonSerializer.Deserialize<Expense>(body, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (expense == null)
                {
                    var badReq = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badReq.WriteAsJsonAsync(new { error = "Invalid expense data" });
                    return badReq;
                }

                // Set employee-specific fields
                expense.SubmittedByTeamMemberId = member!.Id;
                expense.ApprovalStatus = "Submitted";
                expense.SubmittedAt = DateTime.UtcNow;

                // Generate expense ID
                var allExpenses = await _expenseRepo.GetAllAsync();
                var today = DateTime.UtcNow.ToString("yyyyMMdd");
                var todayExpenses = allExpenses.Count(e => e.ExpenseId != null && e.ExpenseId.Contains(today));
                expense.ExpenseId = $"EXP-{today}-{(todayExpenses + 1):D3}";

                // Calculate financial/tax year
                var entryDate = expense.EntryDate ?? DateTime.UtcNow;
                var fyStartMonth = 1; // Default to calendar year for employees; admin can adjust
                expense.FinancialYear = CalculateFinancialYear(entryDate);
                expense.TaxYear = CalculateTaxYear(entryDate);

                var created = await _expenseRepo.CreateAsync(expense);

                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(created);
                return response;
            }
            catch (Exception ex)
            {
                var errResp = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errResp.WriteAsJsonAsync(new { error = ex.Message });
                return errResp;
            }
        }

        // ─────────────────────────────────────────────────
        // PUT /api/employee/expenses/{id} — Update a draft/rejected expense
        // ─────────────────────────────────────────────────
        [Function("EmployeeUpdateExpense")]
        public async Task<HttpResponseData> UpdateExpense(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "employee/expenses/{id:int}")] HttpRequestData req,
            int id)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            var existing = await _expenseRepo.GetByIdAsync(id);
            if (existing == null || existing.SubmittedByTeamMemberId != member!.Id)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteAsJsonAsync(new { error = "Expense not found" });
                return notFound;
            }

            // Can only edit Draft or Rejected expenses
            if (existing.ApprovalStatus != "Draft" && existing.ApprovalStatus != "Rejected")
            {
                var forbidden = req.CreateResponse(HttpStatusCode.BadRequest);
                await forbidden.WriteAsJsonAsync(new { error = "Can only edit Draft or Rejected expenses" });
                return forbidden;
            }

            var body = await req.ReadAsStringAsync();
            var updates = JsonSerializer.Deserialize<Expense>(body ?? "", new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (updates == null)
            {
                var badReq = req.CreateResponse(HttpStatusCode.BadRequest);
                await badReq.WriteAsJsonAsync(new { error = "Invalid data" });
                return badReq;
            }

            // Update allowed fields
            existing.Supplier = updates.Supplier;
            existing.Category = updates.Category;
            existing.AmountNet = updates.AmountNet;
            existing.VATAmount = updates.VATAmount;
            existing.AmountGross = updates.AmountGross;
            existing.VATApplicability = updates.VATApplicability;
            existing.VATRate = updates.VATRate;
            existing.VATIncluded = updates.VATIncluded;
            existing.EntryDate = updates.EntryDate;
            existing.Reference = updates.Reference;
            existing.Notes = updates.Notes;
            existing.PaymentMethod = updates.PaymentMethod;
            existing.ApprovalStatus = "Submitted";  // Re-submit after edit
            existing.SubmittedAt = DateTime.UtcNow;
            existing.RejectionReason = null;  // Clear previous rejection

            var updated = await _expenseRepo.UpdateAsync(existing);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(updated);
            return response;
        }

        // ─────────────────────────────────────────────────
        // DELETE /api/employee/expenses/{id} — Delete a draft expense
        // ─────────────────────────────────────────────────
        [Function("EmployeeDeleteExpense")]
        public async Task<HttpResponseData> DeleteExpense(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "employee/expenses/{id:int}")] HttpRequestData req,
            int id)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            var existing = await _expenseRepo.GetByIdAsync(id);
            if (existing == null || existing.SubmittedByTeamMemberId != member!.Id)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteAsJsonAsync(new { error = "Expense not found" });
                return notFound;
            }

            if (existing.ApprovalStatus != "Draft")
            {
                var forbidden = req.CreateResponse(HttpStatusCode.BadRequest);
                await forbidden.WriteAsJsonAsync(new { error = "Can only delete Draft expenses" });
                return forbidden;
            }

            await _expenseRepo.DeleteAsync(id);
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        // ─────────────────────────────────────────────────
        // POST /api/employee/expenses/{id}/upload — Upload receipt
        // ─────────────────────────────────────────────────
        [Function("EmployeeUploadReceipt")]
        public async Task<HttpResponseData> UploadReceipt(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "employee/expenses/{id:int}/upload")] HttpRequestData req,
            int id)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            var existing = await _expenseRepo.GetByIdAsync(id);
            if (existing == null || existing.SubmittedByTeamMemberId != member!.Id)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteAsJsonAsync(new { error = "Expense not found" });
                return notFound;
            }

            if (_blobService == null)
            {
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = "Storage not configured" });
                return err;
            }

            try
            {
                var boundary = GetBoundary(req.Headers);
                if (boundary == null)
                {
                    var badReq = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badReq.WriteAsJsonAsync(new { error = "Multipart content required" });
                    return badReq;
                }

                var reader = new Microsoft.AspNetCore.WebUtilities.MultipartReader(boundary, req.Body);
                var section = await reader.ReadNextSectionAsync();
                string? uploadedBlobName = null;

                while (section != null)
                {
                    if (section.ContentType != null)
                    {
                        var fileName = GetFileName(section.ContentDisposition);
                        if (!string.IsNullOrEmpty(fileName))
                        {
                            using var ms = new MemoryStream();
                            await section.Body.CopyToAsync(ms);
                            var fileBytes = ms.ToArray();

                            uploadedBlobName = await _blobService.UploadReceiptAsync(
                                existing.Id,
                                existing.ExpenseId ?? $"EXP-{existing.Id}",
                                fileBytes,
                                fileName);
                        }
                    }
                    section = await reader.ReadNextSectionAsync();
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { blobName = uploadedBlobName, message = "Receipt uploaded" });
                return response;
            }
            catch (Exception ex)
            {
                var errResp = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errResp.WriteAsJsonAsync(new { error = ex.Message });
                return errResp;
            }
        }

        // ─────────────────────────────────────────────────
        // GET /api/employee/mileage — List employee's mileage trips
        // ─────────────────────────────────────────────────
        [Function("EmployeeListMileage")]
        public async Task<HttpResponseData> ListMileage(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "employee/mileage")] HttpRequestData req)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            var allTrips = await _mileageRepo.GetAllAsync();
            var myTrips = allTrips
                .Where(t => t.SubmittedByTeamMemberId == member!.Id)
                .OrderByDescending(t => t.TripDate)
                .Select(t => new
                {
                    t.Id,
                    t.TripId,
                    t.TripDate,
                    t.StartLocation,
                    t.EndLocation,
                    t.Miles,
                    t.IsReturn,
                    t.Purpose,
                    t.Category,
                    t.TaxYear,
                    t.ApprovalStatus,
                    t.RejectionReason,
                    t.SubmittedAt,
                    t.ApprovedAt,
                    t.TotalAmount,
                    t.Notes
                });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(myTrips);
            return response;
        }

        // ─────────────────────────────────────────────────
        // POST /api/employee/mileage — Submit a mileage trip
        // ─────────────────────────────────────────────────
        [Function("EmployeeCreateMileage")]
        public async Task<HttpResponseData> CreateMileage(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "employee/mileage")] HttpRequestData req)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            try
            {
                var body = await req.ReadAsStringAsync();
                var trip = JsonSerializer.Deserialize<MileageTrip>(body ?? "", new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (trip == null)
                {
                    var badReq = req.CreateResponse(HttpStatusCode.BadRequest);
                    await badReq.WriteAsJsonAsync(new { error = "Invalid mileage data" });
                    return badReq;
                }

                // Set employee fields
                trip.SubmittedByTeamMemberId = member!.Id;
                trip.ApprovalStatus = "Submitted";
                trip.SubmittedAt = DateTime.UtcNow;
                trip.Status = "Draft";
                trip.CreatedAt = DateTime.UtcNow;

                // Auto-detect employee name from linked employee record or display name
                if (string.IsNullOrEmpty(trip.Director))
                    trip.Director = member.DisplayName ?? member.Email;

                // Calculate tax year
                trip.TaxYear = CalculateTaxYear(trip.TripDate);

                // Generate trip ID
                trip.TripId = await _mileageRepo.GenerateNextTripIdAsync();

                // Calculate AMAP rates
                var cumulativeMiles = await _mileageRepo.GetCumulativeMilesByTaxYearAsync(trip.Director, trip.TaxYear);
                var totalMiles = trip.IsReturn ? trip.Miles * 2 : trip.Miles;
                trip.Miles = totalMiles;
                var companySettings = await _companySettingsRepo.GetDefaultAsync();
                var (rateBelow, rateAbove, threshold) = ResolveAmapSettings(companySettings, trip.TaxYear);
                CalculateAmapRates(trip, totalMiles, cumulativeMiles, threshold, rateBelow, rateAbove);

                var created = await _mileageRepo.CreateAsync(trip);

                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(created);
                return response;
            }
            catch (Exception ex)
            {
                var errResp = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errResp.WriteAsJsonAsync(new { error = ex.Message });
                return errResp;
            }
        }

        // ─────────────────────────────────────────────────
        // GET /api/employee/mileage-tracker — HMRC mileage allowance tracker
        // ─────────────────────────────────────────────────
        [Function("EmployeeMileageTracker")]
        public async Task<HttpResponseData> MileageTracker(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "employee/mileage-tracker")] HttpRequestData req)
        {
            var (member, error) = await AuthenticateEmployee(req);
            if (error != null) return error;

            // Determine current tax year
            var now = DateTime.UtcNow;
            var currentTaxYear = CalculateTaxYear(now);

            var allTrips = await _mileageRepo.GetAllAsync();
            var myTrips = allTrips
                .Where(t => t.SubmittedByTeamMemberId == member!.Id && t.TaxYear == currentTaxYear)
                .ToList();

            var totalMiles = myTrips.Sum(t => t.Miles);
            var approvedMiles = myTrips.Where(t => t.ApprovalStatus == "Approved").Sum(t => t.Miles);
            var pendingMiles = myTrips.Where(t => t.ApprovalStatus == "Submitted").Sum(t => t.Miles);

            var companySettings = await _companySettingsRepo.GetDefaultAsync();
            var (rateBelow, rateAbove, threshold) = ResolveAmapSettings(companySettings, currentTaxYear);

            var milesAt45p = Math.Min(approvedMiles, threshold);
            var milesAt25p = Math.Max(approvedMiles - threshold, 0m);
            var amountClaimed = (milesAt45p * rateBelow) + (milesAt25p * rateAbove);

            var remainingAt45p = Math.Max(threshold - approvedMiles, 0m);
            var remainingValue = remainingAt45p * rateBelow;

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                taxYear = currentTaxYear,
                totalMilesLogged = totalMiles,
                approvedMiles,
                pendingMiles,
                threshold,
                rateBelow,
                rateAbove,
                milesAt45p,
                milesAt25p,
                amountClaimed = Math.Round(amountClaimed, 2),
                remainingMilesAt45p = remainingAt45p,
                remainingValueAt45p = Math.Round(remainingValue, 2),
                isOver10k = approvedMiles > threshold,
                percentUsed = threshold > 0 ? Math.Round(approvedMiles / threshold * 100, 1) : 0,
                trips = myTrips.Select(t => new
                {
                    t.TripDate,
                    t.StartLocation,
                    t.EndLocation,
                    t.Miles,
                    t.Purpose,
                    t.ApprovalStatus,
                    t.TotalAmount
                })
            });
            return response;
        }

        // ─────────────────────────────────────────────────
        // Invite acceptance — POST /api/employee/accept-invite
        // ─────────────────────────────────────────────────
        [Function("EmployeeAcceptInvite")]
        public async Task<HttpResponseData> AcceptInvite(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "employee/accept-invite")] HttpRequestData req)
        {
            var clerkUser = await _clerkAuth.ValidateRequestAsync(req);
            if (clerkUser == null)
            {
                var unauth = req.CreateResponse(HttpStatusCode.Unauthorized);
                await unauth.WriteAsJsonAsync(new { error = "Invalid authentication" });
                return unauth;
            }

            var body = await req.ReadAsStringAsync();
            var payload = JsonSerializer.Deserialize<Dictionary<string, string>>(body ?? "{}");
            var inviteToken = payload?.GetValueOrDefault("inviteToken");

            if (string.IsNullOrEmpty(inviteToken))
            {
                var badReq = req.CreateResponse(HttpStatusCode.BadRequest);
                await badReq.WriteAsJsonAsync(new { error = "Invite token is required" });
                return badReq;
            }

            var member = await _teamMemberRepo.GetByInviteTokenAsync(inviteToken);
            if (member == null || member.Status != "Invited")
            {
                var notFound = req.CreateResponse(HttpStatusCode.BadRequest);
                await notFound.WriteAsJsonAsync(new { error = "Invalid or expired invite" });
                return notFound;
            }

            // Link Clerk user to team member
            member.ClerkUserId = clerkUser.UserId;
            // Only overwrite DisplayName if Clerk provides a real name
            if (!string.IsNullOrWhiteSpace(clerkUser.FullName))
                member.DisplayName = clerkUser.FullName;
            member.Status = "Active";
            member.AcceptedAt = DateTime.UtcNow;
            member.InviteToken = null; // Consume the token

            await _teamMemberRepo.UpdateAsync(member);

            // Get company name for the welcome message
            var companySettings = await _companySettingsRepo.GetDefaultAsync();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                message = "Welcome! Your account is now active.",
                member.Id,
                member.Email,
                member.DisplayName,
                member.Role,
                member.CompanyId,
                companyName = companySettings?.CompanyName ?? "your company"
            });
            return response;
        }

        // ─────────────────────────────────────────────────
        // Helpers
        // ─────────────────────────────────────────────────
        private static string CalculateTaxYear(DateTime date)
        {
            // UK tax year: 6 April → 5 April
            var startYear = date.Month > 4 || (date.Month == 4 && date.Day >= 6) ? date.Year : date.Year - 1;
            var endYear = startYear + 1;
            return $"{startYear}/{endYear.ToString()[2..]}";
        }

        private static string CalculateFinancialYear(DateTime date)
        {
            // Same as tax year for now — admin can configure per company later
            return CalculateTaxYear(date);
        }

        private static decimal DefaultPrimaryRateForTaxYear(string taxYear)
        {
            var startYearText = taxYear.Split('/').FirstOrDefault();
            if (int.TryParse(startYearText, out var startYear) && startYear >= 2026)
                return DefaultRate55p;

            return DefaultRate45p;
        }

        private static (decimal rateBelow, decimal rateAbove, decimal threshold) ResolveAmapSettings(CompanySettings settings, string taxYear)
        {
            var defaultRateBelow = DefaultPrimaryRateForTaxYear(taxYear);
            return (
                settings?.AmapRate45p ?? defaultRateBelow,
                settings?.AmapRate25p ?? DefaultRate25p,
                settings?.AmapThresholdMiles ?? DefaultThresholdMiles
            );
        }

        private static void CalculateAmapRates(
            MileageTrip trip,
            decimal miles,
            decimal cumulativeBefore,
            decimal threshold,
            decimal rate45,
            decimal rate25)
        {
            if (cumulativeBefore >= threshold)
            {
                trip.MilesAt45p = 0;
                trip.MilesAt25p = miles;
            }
            else if (cumulativeBefore + miles <= threshold)
            {
                trip.MilesAt45p = miles;
                trip.MilesAt25p = 0;
            }
            else
            {
                trip.MilesAt45p = threshold - cumulativeBefore;
                trip.MilesAt25p = miles - trip.MilesAt45p;
            }

            trip.AmountAt45p = Math.Round(trip.MilesAt45p * rate45, 2);
            trip.AmountAt25p = Math.Round(trip.MilesAt25p * rate25, 2);
            trip.TotalAmount = trip.AmountAt45p + trip.AmountAt25p;
        }

        private static string? GetBoundary(HttpHeadersCollection headers)
        {
            if (!headers.Contains("Content-Type")) return null;
            var contentType = headers.GetValues("Content-Type").FirstOrDefault() ?? "";
            var idx = contentType.IndexOf("boundary=", StringComparison.OrdinalIgnoreCase);
            if (idx < 0) return null;
            var boundary = contentType[(idx + 9)..].Trim().Trim('"');
            return boundary;
        }

        private static string? GetFileName(string? contentDisposition)
        {
            if (string.IsNullOrEmpty(contentDisposition)) return null;
            var idx = contentDisposition.IndexOf("filename=", StringComparison.OrdinalIgnoreCase);
            if (idx < 0) return null;
            return contentDisposition[(idx + 9)..].Trim().Trim('"').Trim();
        }
    }
}
