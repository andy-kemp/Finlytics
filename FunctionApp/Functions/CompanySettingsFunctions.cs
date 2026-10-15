using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Net;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using FinanceHubFunctions.Services;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Data;

namespace FinanceHubFunctions.Functions
{
    public class CompanySettingsFunctions
    {
        private readonly FinanceHubDbContext _dbContext;
        private readonly EmailService _emailService;
        private readonly KeyVaultService _keyVaultService;

        public CompanySettingsFunctions(FinanceHubDbContext dbContext, EmailService emailService, KeyVaultService keyVaultService)
        {
            _dbContext = dbContext;
            _emailService = emailService;
            _keyVaultService = keyVaultService;
        }

        [Function("GetCompanySettings")]
        public async Task<HttpResponseData> GetCompanySettings(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get")] HttpRequestData req)
        {
            try
            {
                // Get the first (and should be only) company settings record
                var settings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
                
                if (settings == null)
                {
                    // Create default settings if none exist
                    settings = new CompanySettings
                    {
                        CompanyName = "",
                        CompanyAddress = "",
                        CompanyPhone = "",
                        CompanyEmail = "",
                        DefaultCurrency = "GBP",
                        CurrencySymbol = "£"
                    };
                    _dbContext.CompanySettings.Add(settings);
                    await _dbContext.SaveChangesAsync();
                }
                
                // Never send stored credentials to the browser — only whether they are set
                settings.HasSmtpPassword = !string.IsNullOrEmpty(settings.SmtpUsername)
                    && await HasSecretAsync(_keyVaultService.GetSmtpPasswordAsync);
                settings.HasHmrcGatewayPassword = !string.IsNullOrEmpty(settings.HmrcGatewayUserId)
                    && await HasSecretAsync(_keyVaultService.GetHmrcGatewayPasswordAsync);
                _dbContext.Entry(settings).State = EntityState.Detached;
                settings.SmtpPassword = null;
                settings.HmrcGatewayPassword = null;

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(settings);
                return response;
            }
            catch (System.Exception ex)
            {
                Console.WriteLine($"GetCompanySettings ERROR: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteAsJsonAsync(new { error = $"Failed to get company settings: {ex.Message}" });
                return errorResponse;
            }
        }

        private static async Task<bool> HasSecretAsync(Func<Task<string?>> getSecret)
        {
            try
            {
                return !string.IsNullOrEmpty(await getSecret());
            }
            catch
            {
                // Secret might not exist in Key Vault yet
                return false;
            }
        }

        [Function("UpdateCompanySettings")]
        public async Task<HttpResponseData> UpdateCompanySettings(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req)
        {
            try
            {
                // CRITICAL: Frontend sends camelCase, C# model uses PascalCase
                // Make deserialization case-insensitive
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var settings = await JsonSerializer.DeserializeAsync<CompanySettings>(req.Body, options);
                
                Console.WriteLine($"UpdateCompanySettings: Received settings - CompanyName: '{settings?.CompanyName}', Phone: '{settings?.CompanyPhone}'");
                
                // Get existing settings from database
                var existingSettings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
                
                if (existingSettings == null)
                {
                    // Create new record
                    _dbContext.CompanySettings.Add(settings);
                    Console.WriteLine($"UpdateCompanySettings: Creating new company settings record");
                }
                else
                {
                    // Update existing record - ONLY update fields that are provided (not null/empty)
                    if (!string.IsNullOrEmpty(settings.CompanyName)) existingSettings.CompanyName = settings.CompanyName;
                    if (!string.IsNullOrEmpty(settings.CompanyAddress ?? settings.Address)) existingSettings.CompanyAddress = settings.CompanyAddress ?? settings.Address;
                    if (!string.IsNullOrEmpty(settings.CompanyPhone ?? settings.PhoneNumber)) existingSettings.CompanyPhone = settings.CompanyPhone ?? settings.PhoneNumber;
                    if (!string.IsNullOrEmpty(settings.CompanyEmail ?? settings.Email)) existingSettings.CompanyEmail = settings.CompanyEmail ?? settings.Email;
                    if (!string.IsNullOrEmpty(settings.CompanyRegistrationNumber)) existingSettings.CompanyRegistrationNumber = settings.CompanyRegistrationNumber;
                    if (!string.IsNullOrEmpty(settings.TaxRegistrationNumber)) existingSettings.TaxRegistrationNumber = settings.TaxRegistrationNumber;
                    if (!string.IsNullOrEmpty(settings.VatRegistrationNumber ?? settings.VATNumber)) existingSettings.VatRegistrationNumber = settings.VatRegistrationNumber ?? settings.VATNumber;
                    if (!string.IsNullOrEmpty(settings.BankName)) existingSettings.BankName = settings.BankName;
                    if (!string.IsNullOrEmpty(settings.BankAccountNumber ?? settings.AccountNumber)) existingSettings.BankAccountNumber = settings.BankAccountNumber ?? settings.AccountNumber;
                    if (!string.IsNullOrEmpty(settings.BankSortCode ?? settings.SortCode)) existingSettings.BankSortCode = settings.BankSortCode ?? settings.SortCode;
                    if (!string.IsNullOrEmpty(settings.BankIBAN)) existingSettings.BankIBAN = settings.BankIBAN;
                    if (!string.IsNullOrEmpty(settings.BankSwiftCode)) existingSettings.BankSwiftCode = settings.BankSwiftCode;
                    if (!string.IsNullOrEmpty(settings.DefaultCurrency)) existingSettings.DefaultCurrency = settings.DefaultCurrency;
                    if (!string.IsNullOrEmpty(settings.CurrencySymbol)) existingSettings.CurrencySymbol = settings.CurrencySymbol;
                    if (!string.IsNullOrEmpty(settings.DefaultVATRate)) existingSettings.DefaultVATRate = settings.DefaultVATRate;
                    if (!string.IsNullOrEmpty(settings.InvoicePrefix)) existingSettings.InvoicePrefix = settings.InvoicePrefix;
                    if (!string.IsNullOrEmpty(settings.QuotePrefix)) existingSettings.QuotePrefix = settings.QuotePrefix;
                    if (!string.IsNullOrEmpty(settings.InvoiceTermsDays)) existingSettings.InvoiceTermsDays = settings.InvoiceTermsDays;
                    if (!string.IsNullOrEmpty(settings.PaymentTerms)) existingSettings.PaymentTerms = settings.PaymentTerms;
                    if (!string.IsNullOrEmpty(settings.InvoiceFooterText ?? settings.FooterText)) existingSettings.InvoiceFooterText = settings.InvoiceFooterText ?? settings.FooterText;
                    if (!string.IsNullOrEmpty(settings.LogoUrl)) existingSettings.LogoUrl = settings.LogoUrl;
                    if (settings.DocumentLogoUrl != null) existingSettings.DocumentLogoUrl = settings.DocumentLogoUrl;
                    if (settings.EmailLogoUrl != null) existingSettings.EmailLogoUrl = settings.EmailLogoUrl;
                    if (!string.IsNullOrEmpty(settings.InvoicesEmail)) existingSettings.InvoicesEmail = settings.InvoicesEmail;
                    if (!string.IsNullOrEmpty(settings.QuotesEmail)) existingSettings.QuotesEmail = settings.QuotesEmail;
                    if (!string.IsNullOrEmpty(settings.PaymentsEmail)) existingSettings.PaymentsEmail = settings.PaymentsEmail;
                    if (settings.CompanyInceptionDate.HasValue) existingSettings.CompanyInceptionDate = settings.CompanyInceptionDate;
                    if (settings.FYStartMonth.HasValue) existingSettings.FYStartMonth = settings.FYStartMonth;
                    if (settings.FYStartDay.HasValue) existingSettings.FYStartDay = settings.FYStartDay;
                    if (settings.NextInvoiceNumber.HasValue) existingSettings.NextInvoiceNumber = settings.NextInvoiceNumber;
                    if (settings.NextQuoteNumber.HasValue) existingSettings.NextQuoteNumber = settings.NextQuoteNumber;
                    if (!string.IsNullOrEmpty(settings.SmtpServer)) existingSettings.SmtpServer = settings.SmtpServer;
                    if (settings.SmtpPort.HasValue) existingSettings.SmtpPort = settings.SmtpPort;
                    if (!string.IsNullOrEmpty(settings.SmtpFromAddress)) existingSettings.SmtpFromAddress = settings.SmtpFromAddress;
                    if (!string.IsNullOrEmpty(settings.SmtpUsername)) existingSettings.SmtpUsername = settings.SmtpUsername;
                    if (!string.IsNullOrEmpty(settings.DirectorName)) existingSettings.DirectorName = settings.DirectorName;
                    if (!string.IsNullOrEmpty(settings.DirectorSignature)) existingSettings.DirectorSignature = settings.DirectorSignature;
                    if (settings.HasAuthorizedOfficer.HasValue) existingSettings.HasAuthorizedOfficer = settings.HasAuthorizedOfficer;
                    if (!string.IsNullOrEmpty(settings.AuthorizedOfficerName)) existingSettings.AuthorizedOfficerName = settings.AuthorizedOfficerName;
                    if (!string.IsNullOrEmpty(settings.AuthorizedOfficerSignature)) existingSettings.AuthorizedOfficerSignature = settings.AuthorizedOfficerSignature;
                    if (!string.IsNullOrEmpty(settings.Directors)) existingSettings.Directors = settings.Directors;
                    if (settings.PsaApproved.HasValue) existingSettings.PsaApproved = settings.PsaApproved;
                    if (!string.IsNullOrEmpty(settings.PsaContactName)) existingSettings.PsaContactName = settings.PsaContactName;
                    if (settings.IncorporationDate.HasValue) existingSettings.IncorporationDate = settings.IncorporationDate;
                    if (settings.VatQuarterStartMonth.HasValue) existingSettings.VatQuarterStartMonth = settings.VatQuarterStartMonth;
                    if (!string.IsNullOrEmpty(settings.VatAccountingMethod)) existingSettings.VatAccountingMethod = settings.VatAccountingMethod;
                    if (!string.IsNullOrEmpty(settings.Utr)) existingSettings.Utr = settings.Utr;
                    if (settings.AllowDataDeletion.HasValue) existingSettings.AllowDataDeletion = settings.AllowDataDeletion;
                    if (settings.AllowDividendDeletion.HasValue) existingSettings.AllowDividendDeletion = settings.AllowDividendDeletion;
                    if (!string.IsNullOrEmpty(settings.HmrcGatewayUserId)) existingSettings.HmrcGatewayUserId = settings.HmrcGatewayUserId;
                    
                    Console.WriteLine($"UpdateCompanySettings: About to save Directors = '{settings.Directors}'");
                    Console.WriteLine($"UpdateCompanySettings: HasAuthorizedOfficer = '{settings.HasAuthorizedOfficer}'");
                    Console.WriteLine($"UpdateCompanySettings: AuthorizedOfficerName = '{settings.AuthorizedOfficerName}'");
                    
                    Console.WriteLine($"UpdateCompanySettings: Updating existing company settings record (Id: {existingSettings.Id})");
                }
                
                // Handle SMTP password separately - store in Key Vault
                if (!string.IsNullOrEmpty(settings?.SmtpPassword))
                {
                    Console.WriteLine($"UpdateCompanySettings: Storing SMTP password in Key Vault...");
                    await _keyVaultService.SetSmtpPasswordAsync(settings.SmtpPassword);
                    Console.WriteLine($"UpdateCompanySettings: SMTP password stored successfully");
                }
                
                // Handle HMRC Gateway password separately - store in Key Vault
                if (!string.IsNullOrEmpty(settings?.HmrcGatewayPassword))
                {
                    Console.WriteLine($"UpdateCompanySettings: Storing HMRC Gateway password in Key Vault...");
                    await _keyVaultService.SetHmrcGatewayPasswordAsync(settings.HmrcGatewayPassword);
                    Console.WriteLine($"UpdateCompanySettings: HMRC Gateway password stored successfully");
                }
                
                await _dbContext.SaveChangesAsync();
                Console.WriteLine($"UpdateCompanySettings: Database update completed");
                
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { 
                    success = true,
                    message = "Company settings updated successfully in database."
                });
                return response;
            }
            catch (System.Exception ex)
            {
                Console.WriteLine($"UpdateCompanySettings: ERROR - {ex.Message}");
                Console.WriteLine($"UpdateCompanySettings: Stack trace - {ex.StackTrace}");
                
                var errorResponse = req.CreateResponse(HttpStatusCode.OK); // Return 200 so frontend sees the error details
                await errorResponse.WriteAsJsonAsync(new { 
                    success = false,
                    error = ex.Message,
                    details = ex.InnerException?.Message,
                    stackTrace = ex.StackTrace
                });
                return errorResponse;
            }
        }

        [Function("TestSmtpConfiguration")]
        public async Task<HttpResponseData> TestSmtpConfiguration(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req)
        {
            try
            {
                var accessToken = AuthHelper.GetAccessToken(req);
                // Get settings from database instead of SharePoint
                var settings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
                
                if (settings == null)
                {
                    throw new Exception("Company settings not configured");
                }
                
                if (string.IsNullOrEmpty(settings.SmtpFromAddress))
                {
                    throw new Exception("SMTP From Address not configured");
                }

                string? requestedEmail = null;
                try
                {
                    var body = await new StreamReader(req.Body).ReadToEndAsync();
                    if (!string.IsNullOrWhiteSpace(body))
                    {
                        var payload = JsonSerializer.Deserialize<TestSmtpRequest>(body, new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                        requestedEmail = payload?.Email;
                    }
                }
                catch
                {
                    // Ignore body parse errors and fallback to default
                }

                var toEmail = !string.IsNullOrWhiteSpace(requestedEmail)
                    ? requestedEmail
                    : (settings.CompanyEmail ?? settings.SmtpFromAddress);

                // Send test email - EmailService will use smtpFromAddress from settings
                var result = await _emailService.SendEmailAsync(
                    toEmail: toEmail,
                    subject: "Finance Hub - SMTP Test Email",
                    htmlBody: $@"
                        <h2>SMTP Configuration Test</h2>
                        <p>This is a test email from your Finance Hub application.</p>
                        <p><strong>Company:</strong> {settings.CompanyName}</p>
                        <p><strong>SMTP From:</strong> {settings.SmtpFromAddress}</p>
                        <p><strong>SMTP To:</strong> {toEmail}</p>
                        <p><strong>Test Time:</strong> {DateTime.Now:yyyy-MM-dd HH:mm:ss}</p>
                        <hr>
                        <p>If you received this email, your SMTP configuration is working correctly!</p>
                    ",
                    accessToken: accessToken
                );

                if (!result)
                {
                    throw new Exception("SMTP test email could not be sent. Check SMTP settings and Key Vault password.");
                }

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { 
                    success = true,
                    message = "Test email sent successfully",
                    toEmail
                });
                return response;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"TestSmtpConfiguration ERROR: {ex.Message}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteAsJsonAsync(new { 
                    success = false,
                    error = ex.Message 
                });
                return errorResponse;
            }
        }

        private class TestSmtpRequest
        {
            public string? Email { get; set; }
        }

        [Function("SyncDirectorsFromEmployees")]
        public async Task<HttpResponseData> SyncDirectorsFromEmployees(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req)
        {
            try
            {
                // Get all employees marked as directors
                var directorEmployees = await _dbContext.Employees
                    .Where(e => e.IsDirector && e.IsActive)
                    .Select(e => e.Name)
                    .ToListAsync();
                
                // Create comma-separated string of director names
                var directorsString = string.Join(", ", directorEmployees.Where(name => !string.IsNullOrWhiteSpace(name)));
                
                Console.WriteLine($"SyncDirectorsFromEmployees: Found {directorEmployees.Count} directors: {directorsString}");
                
                // Update company settings with directors list
                var settings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
                if (settings != null)
                {
                    settings.Directors = directorsString;
                    await _dbContext.SaveChangesAsync();
                    
                    Console.WriteLine($"SyncDirectorsFromEmployees: Updated CompanySettings Directors to: '{directorsString}'");
                }
                else
                {
                    Console.WriteLine("SyncDirectorsFromEmployees: No CompanySettings record found");
                }
                
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { 
                    success = true,
                    directors = directorsString,
                    count = directorEmployees.Count,
                    message = $"Directors list updated with {directorEmployees.Count} directors"
                });
                return response;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"SyncDirectorsFromEmployees ERROR: {ex.Message}");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteAsJsonAsync(new { 
                    success = false,
                    error = ex.Message 
                });
                return errorResponse;
            }
        }
    }
}