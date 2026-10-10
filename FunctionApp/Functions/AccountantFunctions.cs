using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;

namespace FinanceHubFunctions.Functions
{
    public class AccountantFunctions
    {
        private readonly IAccountantRepository _accountantRepo;
        private readonly ICompanyAccountantRepository _companyAccountantRepo;
        private readonly ICompanySettingsRepository _settingsRepo;
        private readonly ICompanyLedgerRepository _ledgerRepo;
        private readonly IExpenseRepository _expenseRepo;
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly IPayrollRunRepository _payrollRepo;
        private readonly IPayslipRepository _payslipRepo;
        private readonly IDlaRepository _dlaRepo;
        private readonly IDlaPaymentRepository _dlaPaymentRepo;
        private readonly IVatReturnRepository _vatRepo;
        private readonly IEmployeeRepository _employeeRepo;
        private readonly FinanceHubDbContext _db;
        private readonly ClerkAuthService _clerkAuth;
        private readonly EmailService? _emailService;

        public AccountantFunctions(
            IAccountantRepository accountantRepo,
            ICompanyAccountantRepository companyAccountantRepo,
            ICompanySettingsRepository settingsRepo,
            ICompanyLedgerRepository ledgerRepo,
            IExpenseRepository expenseRepo,
            IInvoiceRepository invoiceRepo,
            IPayrollRunRepository payrollRepo,
            IPayslipRepository payslipRepo,
            IDlaRepository dlaRepo,
            IDlaPaymentRepository dlaPaymentRepo,
            IVatReturnRepository vatRepo,
            IEmployeeRepository employeeRepo,
            FinanceHubDbContext db,
            ClerkAuthService clerkAuth,
            EmailService? emailService = null)
        {
            _accountantRepo = accountantRepo;
            _companyAccountantRepo = companyAccountantRepo;
            _settingsRepo = settingsRepo;
            _ledgerRepo = ledgerRepo;
            _expenseRepo = expenseRepo;
            _invoiceRepo = invoiceRepo;
            _payrollRepo = payrollRepo;
            _payslipRepo = payslipRepo;
            _dlaRepo = dlaRepo;
            _dlaPaymentRepo = dlaPaymentRepo;
            _vatRepo = vatRepo;
            _employeeRepo = employeeRepo;
            _db = db;
            _clerkAuth = clerkAuth;
            _emailService = emailService;
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  HELPER: Validate Clerk JWT → Accountant → CompanyAccountant access
        // ═══════════════════════════════════════════════════════════════════════

        private async Task<(Accountant accountant, CompanyAccountant? link)?>
            ValidateAccountantAsync(HttpRequestData req, int? companyId = null)
        {
            var clerkUser = await _clerkAuth.ValidateRequestAsync(req);
            if (clerkUser == null) return null;

            var accountant = await _accountantRepo.GetByClerkUserIdAsync(clerkUser.UserId);
            if (accountant == null || accountant.Status != "Active") return null;

            if (companyId.HasValue)
            {
                var link = await _companyAccountantRepo.GetByCompanyAndAccountantAsync(companyId.Value, accountant.Id);
                if (link == null || link.Status != "Active") return null;
                return (accountant, link);
            }

            return (accountant, null);
        }

        private static async Task<HttpResponseData> Unauthorized(HttpRequestData req, string msg = "Unauthorized")
        {
            var res = req.CreateResponse(HttpStatusCode.Unauthorized);
            await res.WriteAsJsonAsync(new { error = msg }, HttpStatusCode.Unauthorized);
            return res;
        }

        private static async Task<HttpResponseData> Forbidden(HttpRequestData req, string msg = "Access denied")
        {
            var res = req.CreateResponse(HttpStatusCode.Forbidden);
            await res.WriteAsJsonAsync(new { error = msg }, HttpStatusCode.Forbidden);
            return res;
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  ADMIN ENDPOINTS (called from admin SWA with MSAL auth)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// POST /api/accountant/invite  — invite an external accountant
        /// Body: { email, name, firmName? }
        /// </summary>
        [Function("AccountantInvite")]
        public async Task<HttpResponseData> InviteAccountant(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "accountant/invite")] HttpRequestData req)
        {
            try
            {
                var body = await req.ReadAsStringAsync();
                var json = JsonDocument.Parse(body!);
                var root = json.RootElement;

                var email = root.GetProperty("email").GetString()?.Trim().ToLowerInvariant();
                var name = root.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                var firmName = root.TryGetProperty("firmName", out var f) ? f.GetString() : null;

                if (string.IsNullOrWhiteSpace(email))
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Email is required" });
                    return bad;
                }

                // Get the company
                var company = await _settingsRepo.GetDefaultAsync();
                if (company == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Company not configured" });
                    return bad;
                }

                // Find or create Accountant record
                var accountant = await _accountantRepo.GetByEmailAsync(email);
                if (accountant == null)
                {
                    accountant = await _accountantRepo.CreateAsync(new Accountant
                    {
                        Email = email,
                        Name = name,
                        FirmName = firmName,
                        Status = "Invited",
                        CreatedAt = DateTime.UtcNow
                    });
                }

                // Check if already linked
                var existing = await _companyAccountantRepo.GetByCompanyAndAccountantAsync(company.Id, accountant.Id);
                if (existing != null && existing.Status == "Active")
                {
                    var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                    await conflict.WriteAsJsonAsync(new { error = "Accountant already has access to this company" });
                    return conflict;
                }

                // Generate invite token
                var inviteToken = Guid.NewGuid().ToString("N");

                if (existing != null)
                {
                    // Re-invite (was revoked or expired)
                    existing.InviteToken = inviteToken;
                    existing.Status = "Invited";
                    existing.InvitedAt = DateTime.UtcNow;
                    existing.AcceptedAt = null;
                    await _companyAccountantRepo.UpdateAsync(existing);
                }
                else
                {
                    await _companyAccountantRepo.CreateAsync(new CompanyAccountant
                    {
                        CompanyId = company.Id,
                        AccountantId = accountant.Id,
                        AccessLevel = "ReadOnly",
                        InviteToken = inviteToken,
                        InvitedAt = DateTime.UtcNow,
                        Status = "Invited"
                    });
                }

                // Send invite email
                var accountantPortalUrl = Environment.GetEnvironmentVariable("ACCOUNTANT_PORTAL_URL")
                    ?? "https://accountantdev.finlytics.co.uk";
                var inviteLink = $"{accountantPortalUrl}?token={inviteToken}";

                var emailSent = false;
                string emailError = null;
                if (_emailService != null)
                {
                    try
                    {
                        var (success, error) = await _emailService.SendSystemEmailAsync(
                            toEmail: email,
                            subject: $"You've been invited to view {company.CompanyName ?? "a company"} on Finlytics",
                            htmlBody: $@"
                                <h2>Accountant Access Invitation</h2>
                                <p>Hello {(string.IsNullOrWhiteSpace(name) ? "" : name)},</p>
                                <p><strong>{company.CompanyName}</strong> has invited you to view their financial data on Finlytics.</p>
                                <p>Click the link below to accept the invitation and access the accountant portal:</p>
                                <p><a href=""{inviteLink}"" style=""display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;"">Accept Invitation</a></p>
                                <p>Or copy this link: {inviteLink}</p>
                                <p>This gives you read-only access to {company.CompanyName}'s financial records.</p>
                                <p>Best regards,<br/>Finlytics</p>"
                        );
                        emailSent = success;
                        if (!success) emailError = error;
                    }
                    catch (Exception emailEx)
                    {
                        emailError = emailEx.Message;
                    }
                }
                else
                {
                    emailError = "Email service not configured";
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    success = true,
                    accountantId = accountant.Id,
                    email,
                    inviteLink,
                    emailSent,
                    message = emailSent
                        ? "Invitation sent by email"
                        : "Invitation created — email could not be sent. Share the invite link manually.",
                    emailError
                });
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/linked  — list accountants linked to this company (admin view)
        /// </summary>
        [Function("AccountantListLinked")]
        public async Task<HttpResponseData> ListLinkedAccountants(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/linked")] HttpRequestData req)
        {
            try
            {
                var company = await _settingsRepo.GetDefaultAsync();
                if (company == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Company not configured" });
                    return bad;
                }

                var links = await _companyAccountantRepo.GetByCompanyIdAsync(company.Id);
                var accountants = await _accountantRepo.GetAllAsync();
                var accountantLookup = accountants.ToDictionary(a => a.Id, a => a);

                var result = links.Select(link =>
                {
                    accountantLookup.TryGetValue(link.AccountantId, out var acct);
                    return new
                    {
                        id = link.Id,
                        accountantId = link.AccountantId,
                        email = acct?.Email ?? "",
                        name = acct?.Name ?? "",
                        firmName = acct?.FirmName,
                        accessLevel = link.AccessLevel,
                        status = link.Status,
                        invitedAt = link.InvitedAt,
                        acceptedAt = link.AcceptedAt
                    };
                }).ToList();

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// DELETE /api/accountant/{id}/revoke  — revoke accountant access
        /// </summary>
        [Function("AccountantRevoke")]
        public async Task<HttpResponseData> RevokeAccountant(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "accountant/{id}/revoke")] HttpRequestData req,
            int id)
        {
            try
            {
                var link = await _companyAccountantRepo.GetByIdAsync(id);
                if (link == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "Not found" });
                    return notFound;
                }

                link.Status = "Revoked";
                await _companyAccountantRepo.UpdateAsync(link);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { success = true, message = "Access revoked" });
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  ACCOUNTANT ENDPOINTS (called from accountant SWA with Clerk auth)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// POST /api/accountant/accept-invite  — accept invitation, link Clerk user
        /// Body: { inviteToken }
        /// </summary>
        [Function("AccountantAcceptInvite")]
        public async Task<HttpResponseData> AcceptInvite(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "accountant/accept-invite")] HttpRequestData req)
        {
            try
            {
                var clerkUser = await _clerkAuth.ValidateRequestAsync(req);
                if (clerkUser == null) return await Unauthorized(req);

                var body = await req.ReadAsStringAsync();
                var json = JsonDocument.Parse(body!);
                var inviteToken = json.RootElement.GetProperty("inviteToken").GetString();

                if (string.IsNullOrWhiteSpace(inviteToken))
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "inviteToken is required" });
                    return bad;
                }

                // Find the CompanyAccountant by invite token
                var link = await _companyAccountantRepo.GetByInviteTokenAsync(inviteToken);
                if (link == null || link.Status != "Invited")
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Invalid or expired invitation" });
                    return bad;
                }

                // Find the accountant
                var accountant = await _accountantRepo.GetByIdAsync(link.AccountantId);
                if (accountant == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = "Accountant record not found" });
                    return bad;
                }

                // Link Clerk user to Accountant
                accountant.ClerkUserId = clerkUser.UserId;
                accountant.Status = "Active";
                accountant.AcceptedAt = DateTime.UtcNow;
                if (string.IsNullOrWhiteSpace(accountant.Name) && !string.IsNullOrWhiteSpace(clerkUser.FullName))
                    accountant.Name = clerkUser.FullName;
                await _accountantRepo.UpdateAsync(accountant);

                // Activate the link
                link.Status = "Active";
                link.AcceptedAt = DateTime.UtcNow;
                link.InviteToken = null; // consume the token
                await _companyAccountantRepo.UpdateAsync(link);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    success = true,
                    accountantId = accountant.Id,
                    name = accountant.Name,
                    email = accountant.Email,
                    companyId = link.CompanyId
                });
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/me  — accountant profile + linked companies
        /// </summary>
        [Function("AccountantGetProfile")]
        public async Task<HttpResponseData> GetProfile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/me")] HttpRequestData req)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req);
                if (auth == null) return await Unauthorized(req);

                var accountant = auth.Value.accountant;
                var links = await _companyAccountantRepo.GetByAccountantIdAsync(accountant.Id);
                var activeLinks = links.Where(l => l.Status == "Active").ToList();

                // Fetch company name
                var defaultSettings = await _settingsRepo.GetDefaultAsync();
                var settingsLookup = defaultSettings != null
                    ? new Dictionary<int, CompanySettings> { { defaultSettings.Id, defaultSettings } }
                    : new Dictionary<int, CompanySettings>();

                var companies = activeLinks.Select(l =>
                {
                    settingsLookup.TryGetValue(l.CompanyId, out var cs);
                    return new
                    {
                        companyId = l.CompanyId,
                        companyName = cs?.CompanyName ?? "Unknown",
                        accessLevel = l.AccessLevel,
                        linkedAt = l.AcceptedAt
                    };
                }).ToList();

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    id = accountant.Id,
                    email = accountant.Email,
                    name = accountant.Name,
                    firmName = accountant.FirmName,
                    companies
                });
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/companies  — list linked companies
        /// </summary>
        [Function("AccountantListCompanies")]
        public async Task<HttpResponseData> ListCompanies(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/companies")] HttpRequestData req)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req);
                if (auth == null) return await Unauthorized(req);

                var links = await _companyAccountantRepo.GetByAccountantIdAsync(auth.Value.accountant.Id);
                var activeLinks = links.Where(l => l.Status == "Active").ToList();

                var defaultSettings2 = await _settingsRepo.GetDefaultAsync();
                var settingsLookup2 = defaultSettings2 != null
                    ? new Dictionary<int, CompanySettings> { { defaultSettings2.Id, defaultSettings2 } }
                    : new Dictionary<int, CompanySettings>();

                var companies = activeLinks.Select(l =>
                {
                    settingsLookup2.TryGetValue(l.CompanyId, out var cs);
                    return new
                    {
                        companyId = l.CompanyId,
                        companyName = cs?.CompanyName ?? "Unknown",
                        registrationNumber = cs?.CompanyRegistrationNumber,
                        vatNumber = cs?.VATNumber ?? cs?.VatRegistrationNumber,
                        accessLevel = l.AccessLevel,
                        linkedAt = l.AcceptedAt
                    };
                }).ToList();

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(companies);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  COMPANY DATA ENDPOINTS (read-only, Clerk auth + company access check)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// GET /api/accountant/company/{companyId}/summary  — dashboard metrics
        /// </summary>
        [Function("AccountantCompanySummary")]
        public async Task<HttpResponseData> GetCompanySummary(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/summary")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var settings = await _settingsRepo.GetByIdAsync(companyId);
                var ledger = (await _ledgerRepo.GetAllAsync()).ToList();
                var expenses = (await _expenseRepo.GetAllAsync()).ToList();
                var invoices = (await _invoiceRepo.GetAllAsync()).ToList();

                // Calculate key metrics
                var totalIncome = ledger.Where(e => e.EntryType.Contains("Income") || e.Amount > 0).Sum(e => e.Amount);
                var totalExpenseAmount = ledger.Where(e => e.Amount < 0).Sum(e => Math.Abs(e.Amount));
                var unpaidInvoices = invoices.Where(i => i.Status != "Paid" && i.Status != "Cancelled").ToList();
                var outstandingAmount = unpaidInvoices.Sum(i => i.AmountGross);
                var pendingExpenses = expenses.Count(e => e.ApprovalStatus == "Pending");

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    companyName = settings?.CompanyName,
                    registrationNumber = settings?.CompanyRegistrationNumber,
                    vatNumber = settings?.VATNumber ?? settings?.VatRegistrationNumber,
                    metrics = new
                    {
                        totalIncome,
                        totalExpenses = totalExpenseAmount,
                        netProfit = totalIncome - totalExpenseAmount,
                        outstandingInvoices = unpaidInvoices.Count,
                        outstandingAmount,
                        totalLedgerEntries = ledger.Count,
                        pendingExpenses,
                        totalExpenseCount = expenses.Count
                    }
                });
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/ledger  — company ledger entries
        /// </summary>
        [Function("AccountantCompanyLedger")]
        public async Task<HttpResponseData> GetCompanyLedger(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/ledger")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var entries = await _ledgerRepo.GetAllAsync();
                var result = entries
                    .OrderByDescending(e => e.EffectiveDate)
                    .Select(e => new
                    {
                        e.Id,
                        date = e.EffectiveDate,
                        type = e.EntryType,
                        description = e.Title,
                        e.Amount,
                        e.PeriodKey,
                        e.TaxYear,
                        e.FinancialYear,
                        e.Notes,
                        e.DlaReference
                    });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/expenses  — all expenses
        /// </summary>
        [Function("AccountantCompanyExpenses")]
        public async Task<HttpResponseData> GetCompanyExpenses(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/expenses")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var expenses = await _expenseRepo.GetAllAsync();
                var result = expenses
                    .OrderByDescending(e => e.EntryDate)
                    .Select(e => new
                    {
                        e.Id,
                        date = e.EntryDate,
                        e.Category,
                        e.Reference,
                        description = e.Notes,
                        netAmount = e.AmountNet,
                        vatAmount = e.VATAmount,
                        grossAmount = e.AmountGross,
                        vatRate = e.VATRate,
                        e.PaymentMethod,
                        e.ApprovalStatus,
                        e.Supplier,
                        e.CtTag,
                        e.DatePaid
                    });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/invoices  — all invoices
        /// </summary>
        [Function("AccountantCompanyInvoices")]
        public async Task<HttpResponseData> GetCompanyInvoices(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/invoices")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var invoices = await _invoiceRepo.GetAllAsync();
                var result = invoices
                    .OrderByDescending(i => i.DateIssued)
                    .Select(i => new
                    {
                        i.Id, i.InvoiceNumber,
                        date = i.DateIssued,
                        i.DueDate,
                        i.CustomerId, i.CustomerName,
                        totalNet = i.AmountNet,
                        totalVat = i.VATAmount,
                        totalGross = i.AmountGross,
                        i.Status,
                        paidDate = i.DatePaid
                    });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/dividends  — dividend declarations + allocations
        /// </summary>
        [Function("AccountantCompanyDividends")]
        public async Task<HttpResponseData> GetCompanyDividends(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/dividends")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var declarations = await _db.DividendDeclarations
                    .OrderByDescending(d => d.MeetingDate)
                    .ToListAsync();

                var allocations = await _db.DividendAllocations.ToListAsync();

                var result = declarations.Select(d =>
                {
                    var allocs = allocations
                        .Where(a => a.DividendDeclarationId == d.Id)
                        .Select(a => new
                        {
                            a.Id,
                            a.ShareholderId,
                            a.ShareholderName,
                            a.ShareClass,
                            a.NumberOfShares,
                            a.AmountPerShare,
                            a.TotalAmount
                        });
                    return new
                    {
                        d.Id,
                        d.DividendRef,
                        d.DividendType,
                        d.ShareClass,
                        d.MeetingDate,
                        d.PaymentDate,
                        d.AmountPerShare,
                        d.TotalAmount,
                        d.Status,
                        allocations = allocs
                    };
                });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/payroll  — payroll runs with payslip summaries
        /// </summary>
        [Function("AccountantCompanyPayroll")]
        public async Task<HttpResponseData> GetCompanyPayroll(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/payroll")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var runs = (await _payrollRepo.GetAllAsync())
                    .OrderByDescending(r => r.PayDate)
                    .ToList();

                var allPayslips = new List<Payslip>();
                foreach (var r in runs)
                {
                    var slips = await _payslipRepo.GetByPayrollRunIdAsync(r.Id);
                    allPayslips.AddRange(slips);
                }
                var payslips = allPayslips;
                var employees = (await _employeeRepo.GetAllAsync()).ToDictionary(e => e.Id, e => e);

                var result = runs.Select(r =>
                {
                    var runSlips = payslips.Where(p => p.PayrollRunId == r.Id).Select(p =>
                    {
                        employees.TryGetValue(p.EmployeeId, out var emp);
                        return new
                        {
                            p.Id, p.EmployeeId,
                            employeeName = p.EmployeeName ?? emp?.Name ?? "",
                            p.GrossPay, tax = p.Tax, ni = p.NationalInsurance, employerNi = p.EmployerNi,
                            p.NetPay
                        };
                    });
                    return new
                    {
                        r.Id, r.TaxMonth, r.TaxYear, r.PayDate, r.Status,
                        r.TotalGross, r.TotalTax, totalEmployeeNi = r.TotalEmployeeNi, totalEmployerNi = r.TotalEmployerNi, r.TotalNetPay,
                        payslips = runSlips
                    };
                });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/dla  — director's loan account entries + payments
        /// </summary>
        [Function("AccountantCompanyDla")]
        public async Task<HttpResponseData> GetCompanyDla(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/dla")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var entries = (await _dlaRepo.GetAllAsync())
                    .OrderByDescending(e => e.EntryDate)
                    .Select(e => new
                    {
                        e.Id, e.DlaId, date = e.EntryDate, e.Direction, e.Description,
                        e.AmountNet, e.VatAmount, e.AmountGross,
                        e.Director, e.Category, e.CtTag,
                        e.AmountPaid, e.RemainingBalance, e.DatePaid
                    });

                var payments = (await _dlaPaymentRepo.GetAllAsync())
                    .OrderByDescending(p => p.PaymentDate)
                    .Select(p => new
                    {
                        p.Id, p.PaymentId, p.DlaId, date = p.PaymentDate, p.Amount,
                        p.Director, p.PaymentMethod, p.PaymentReference, p.Notes
                    });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { entries, payments });
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/vat-returns  — VAT return history
        /// </summary>
        [Function("AccountantCompanyVatReturns")]
        public async Task<HttpResponseData> GetCompanyVatReturns(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/vat-returns")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var returns = (await _vatRepo.GetAllAsync())
                    .OrderByDescending(v => v.QuarterEndDate)
                    .Select(v => new
                    {
                        v.Id,
                        v.QuarterLabel, v.MonthsLabel,
                        periodStart = v.QuarterStartDate,
                        periodEnd = v.QuarterEndDate,
                        v.VatIn, v.VatOut, v.VatOwed,
                        v.Status, v.FiledDate, v.Reference, v.Notes
                    });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(returns);
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// GET /api/accountant/company/{companyId}/settings  — company settings (read-only, filtered)
        /// </summary>
        [Function("AccountantCompanySettings")]
        public async Task<HttpResponseData> GetCompanySettings(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "accountant/company/{companyId}/settings")] HttpRequestData req,
            int companyId)
        {
            try
            {
                var auth = await ValidateAccountantAsync(req, companyId);
                if (auth == null) return await Forbidden(req);

                var settings = await _settingsRepo.GetDefaultAsync();
                if (settings == null || settings.Id != companyId)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "Company not found" });
                    return notFound;
                }

                // Return only safe fields — no passwords, SMTP creds, or HMRC gateway info
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    settings.CompanyName,
                    companyAddress = settings.CompanyAddress ?? settings.Address,
                    companyPhone = settings.CompanyPhone ?? settings.PhoneNumber,
                    companyEmail = settings.CompanyEmail ?? settings.Email,
                    settings.CompanyRegistrationNumber,
                    settings.TaxRegistrationNumber,
                    vatNumber = settings.VATNumber ?? settings.VatRegistrationNumber,
                    settings.Utr,
                    settings.BankName,
                    accountNumber = settings.AccountNumber ?? settings.BankAccountNumber,
                    sortCode = settings.SortCode ?? settings.BankSortCode,
                    settings.DefaultCurrency,
                    settings.CurrencySymbol,
                    settings.DefaultVATRate,
                    settings.IncorporationDate,
                    settings.CompanyInceptionDate,
                    settings.FYStartMonth,
                    settings.FYStartDay,
                    settings.Directors,
                    settings.InvoicePrefix,
                    settings.QuotePrefix,
                    settings.PaymentTerms,
                    settings.LogoUrl
                });
                return response;
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }
    }
}
