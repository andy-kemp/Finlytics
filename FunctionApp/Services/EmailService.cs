using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Threading.Tasks;
using System.IO;
using Microsoft.Extensions.Logging;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Data;

namespace FinanceHubFunctions.Services
{
    public class EmailService
    {
        public record EmailSendResult(bool Success, string Error);

        private readonly KeyVaultService _keyVaultService;
        private readonly SharePointService? _sharePointService;
        private readonly ICompanySettingsRepository? _companySettingsRepository;
        private readonly BlobStorageService? _blobStorageService;
        private readonly ILogger<EmailService> _logger;

        public EmailService(
            KeyVaultService keyVaultService,
            ILogger<EmailService> logger,
            SharePointService? sharePointService = null,
            ICompanySettingsRepository? companySettingsRepository = null,
            BlobStorageService? blobStorageService = null)
        {
            _keyVaultService = keyVaultService;
            _sharePointService = sharePointService;
            _companySettingsRepository = companySettingsRepository;
            _blobStorageService = blobStorageService;
            _logger = logger;
        }

        private async Task<CompanySettings?> GetCompanySettingsAsync(string accessToken)
        {
            if (_companySettingsRepository != null)
            {
                var companySettings = await _companySettingsRepository.GetDefaultAsync();
                if (companySettings != null)
                {
                    return companySettings;
                }
            }

            if (_sharePointService != null && !string.IsNullOrWhiteSpace(accessToken))
            {
                _logger.LogWarning("Company settings not found in DB. Falling back to SharePoint settings.");
                return await _sharePointService.GetCompanySettings(accessToken);
            }

            _logger.LogWarning("Company settings not found in DB and no access token for SharePoint fallback.");
            return null;
        }

        private async Task<(byte[]? Bytes, string? ContentType, string? ContentId, string? LogoSrcOverride)> TryGetInlineLogoAsync(CompanySettings? companySettings)
        {
            if (companySettings == null || _blobStorageService == null)
            {
                return (null, null, null, null);
            }

            // Prefer EmailLogoUrl if set, then fall back to LogoUrl, then blob search
            var emailLogoUrl = companySettings.EmailLogoUrl;
            if (!string.IsNullOrWhiteSpace(emailLogoUrl))
            {
                try
                {
                    var (bytes, contentType) = await _blobStorageService.GetLogoBytesFromUrlAsync(emailLogoUrl);
                    if (bytes != null && bytes.Length > 0)
                    {
                        return (bytes, contentType, "company-logo", "cid:company-logo");
                    }
                }
                catch
                {
                    // Fall through to blob search
                }
            }

            try
            {
                var (bytes, contentType) = await _blobStorageService.GetLogoAsync(companySettings.Id);
                if (bytes != null && bytes.Length > 0)
                {
                    return (bytes, contentType, "company-logo", "cid:company-logo");
                }
            }
            catch
            {
                // Ignore logo load failures and continue without inline logo
            }

            return (null, null, null, null);
        }

        public async Task<bool> SendEmailAsync(
            string toEmail,
            string subject,
            string htmlBody,
            string accessToken,
            byte[] attachmentBytes = null,
            string attachmentFileName = null)
        {
            var result = await SendEmailWithResultAsync(
                toEmail,
                subject,
                htmlBody,
                accessToken,
                attachmentBytes,
                attachmentFileName,
                null,
                null,
                null);

            return result.Success;
        }

        /// <summary>
        /// Send an email without requiring an access token — uses DB company settings directly.
        /// Ideal for system-generated emails (invitations, notifications) where no user session exists.
        /// </summary>
        public async Task<(bool Success, string Error)> SendSystemEmailAsync(
            string toEmail,
            string subject,
            string htmlBody,
            string fromAddressOverride = null,
            byte[] attachmentBytes = null,
            string attachmentFileName = null)
        {
            var result = await SendEmailWithResultAsync(
                toEmail,
                subject,
                htmlBody,
                accessToken: "",           // DB settings don't need a token
                attachmentBytes: attachmentBytes,
                attachmentFileName: attachmentFileName,
                logoBytes: null,
                logoContentType: null,
                logoContentId: null,
                fromAddressOverride: fromAddressOverride);

            return (result.Success, result.Error);
        }

        private async Task<EmailSendResult> SendEmailWithResultAsync(
            string toEmail,
            string subject,
            string htmlBody,
            string accessToken,
            byte[] attachmentBytes = null,
            string attachmentFileName = null,
            byte[] logoBytes = null,
            string logoContentType = null,
            string logoContentId = null,
            string fromAddressOverride = null,
            string[] ccAddresses = null,
            string[] bccAddresses = null,
            string[] replyToAddresses = null)
        {
            try
            {
                // Get company settings for SMTP configuration (prefer DB, fallback to SharePoint)
                CompanySettings companySettings = await GetCompanySettingsAsync(accessToken);

                if (companySettings == null)
                {
                    _logger.LogError("Company settings not found");
                    return new EmailSendResult(false, "Company settings not found");
                }
                
                // Validate required SMTP settings
                if (string.IsNullOrEmpty(companySettings.SmtpServer))
                {
                    _logger.LogError("SMTP server not configured in company settings");
                    return new EmailSendResult(false, "SMTP server not configured");
                }
                
                if (!companySettings.SmtpPort.HasValue)
                {
                    _logger.LogError("SMTP port not configured in company settings");
                    return new EmailSendResult(false, "SMTP port not configured");
                }
                
                if (string.IsNullOrEmpty(companySettings.SmtpFromAddress) || 
                    string.IsNullOrEmpty(companySettings.SmtpUsername))
                {
                    _logger.LogError("SMTP from address or username not configured in company settings");
                    return new EmailSendResult(false, "SMTP from address or username not configured");
                }

                // Get SMTP password from Key Vault first.
                // If this is a migrated environment and the secret was not copied yet,
                // fall back to any DB value and rehydrate Key Vault automatically.
                var smtpPassword = await _keyVaultService.GetSmtpPasswordAsync();

                if (string.IsNullOrEmpty(smtpPassword) && !string.IsNullOrWhiteSpace(companySettings.SmtpPassword))
                {
                    smtpPassword = companySettings.SmtpPassword;
                    _logger.LogWarning("SMTP password missing in Key Vault; using CompanySettings fallback and attempting Key Vault rehydrate");
                    try
                    {
                        await _keyVaultService.SetSmtpPasswordAsync(smtpPassword);
                        _logger.LogInformation("SMTP password rehydrated into Key Vault from CompanySettings fallback");
                    }
                    catch (Exception kvEx)
                    {
                        _logger.LogWarning(kvEx, "Failed to rehydrate SMTP password into Key Vault from CompanySettings fallback");
                    }
                }

                if (string.IsNullOrEmpty(smtpPassword))
                {
                    _logger.LogError("SMTP password not found in Key Vault");
                    return new EmailSendResult(false, "SMTP password not found in Key Vault");
                }

                var initialEnableSsl = companySettings.SmtpPort.Value != 25;
                var firstAttempt = await TrySendSmtpAsync(
                    companySettings,
                    smtpPassword,
                    toEmail,
                    subject,
                    htmlBody,
                    attachmentBytes,
                    attachmentFileName,
                    initialEnableSsl,
                    logoBytes,
                    logoContentType,
                    logoContentId,
                    fromAddressOverride,
                    ccAddresses,
                    bccAddresses,
                    replyToAddresses);

                if (firstAttempt.Success)
                {
                    return firstAttempt;
                }

                // Retry once with opposite SSL setting to handle servers requiring/denying TLS
                var retryAttempt = await TrySendSmtpAsync(
                    companySettings,
                    smtpPassword,
                    toEmail,
                    subject,
                    htmlBody,
                    attachmentBytes,
                    attachmentFileName,
                    !initialEnableSsl,
                    logoBytes,
                    logoContentType,
                    logoContentId,
                    fromAddressOverride,
                    ccAddresses,
                    bccAddresses,
                    replyToAddresses);

                return retryAttempt.Success
                    ? retryAttempt
                    : firstAttempt;
            }
            catch (SmtpException ex)
            {
                var innerMessage = ex.InnerException?.Message;
                var statusCode = ex.StatusCode.ToString();
                var detail = string.IsNullOrWhiteSpace(innerMessage) ? "" : $" ({innerMessage})";
                _logger.LogError(ex, $"SMTP error sending email to {toEmail}: {ex.Message} ({statusCode}) {innerMessage}");
                return new EmailSendResult(false, $"SMTP error ({statusCode}): {ex.Message}{detail}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error sending email to {toEmail}: {ex.Message}");
                return new EmailSendResult(false, $"Error sending email: {ex.Message}");
            }
        }

        private async Task<EmailSendResult> TrySendSmtpAsync(
            CompanySettings companySettings,
            string smtpPassword,
            string toEmail,
            string subject,
            string htmlBody,
            byte[] attachmentBytes,
            string attachmentFileName,
            bool enableSsl,
            byte[] logoBytes,
            string logoContentType,
            string logoContentId,
            string fromAddressOverride = null,
            string[] ccAddresses = null,
            string[] bccAddresses = null,
            string[] replyToAddresses = null)
        {
            string tempFilePath = null;
            try
            {
                var fromAddress = !string.IsNullOrWhiteSpace(fromAddressOverride)
                    ? fromAddressOverride
                    : companySettings.SmtpFromAddress;

                _logger.LogInformation($"Using SMTP server: {companySettings.SmtpServer}:{companySettings.SmtpPort} - SSL: {enableSsl} - From: {fromAddress} - To: {toEmail}");

                using var smtpClient = new SmtpClient(companySettings.SmtpServer)
                {
                    Port = companySettings.SmtpPort.Value,
                    EnableSsl = enableSsl,
                    UseDefaultCredentials = false,
                    Credentials = new NetworkCredential(companySettings.SmtpUsername, smtpPassword),
                    Timeout = 30000
                };

                using var mailMessage = new MailMessage
                {
                    From = new MailAddress(fromAddress, companySettings.CompanyName ?? ""),
                    Subject = subject,
                    IsBodyHtml = true
                };

                mailMessage.To.Add(toEmail);

                if (ccAddresses != null)
                    foreach (var cc in ccAddresses)
                        if (!string.IsNullOrWhiteSpace(cc)) mailMessage.CC.Add(cc);

                if (bccAddresses != null)
                    foreach (var bcc in bccAddresses)
                        if (!string.IsNullOrWhiteSpace(bcc)) mailMessage.Bcc.Add(bcc);

                if (replyToAddresses != null)
                    foreach (var replyTo in replyToAddresses)
                        if (!string.IsNullOrWhiteSpace(replyTo)) mailMessage.ReplyToList.Add(new MailAddress(replyTo));

                if (logoBytes != null && logoBytes.Length > 0 && !string.IsNullOrWhiteSpace(logoContentId))
                {
                    var htmlView = AlternateView.CreateAlternateViewFromString(htmlBody, null, MediaTypeNames.Text.Html);
                    var logoStream = new MemoryStream(logoBytes);
                    var linkedLogo = new LinkedResource(logoStream, string.IsNullOrWhiteSpace(logoContentType) ? "image/png" : logoContentType)
                    {
                        ContentId = logoContentId,
                        TransferEncoding = TransferEncoding.Base64
                    };
                    htmlView.LinkedResources.Add(linkedLogo);
                    mailMessage.AlternateViews.Add(htmlView);
                }
                else
                {
                    mailMessage.Body = htmlBody;
                }

                if (attachmentBytes != null && !string.IsNullOrEmpty(attachmentFileName))
                {
                    tempFilePath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}-{attachmentFileName}");
                    File.WriteAllBytes(tempFilePath, attachmentBytes);
                    var attachment = new Attachment(tempFilePath);
                    mailMessage.Attachments.Add(attachment);
                }

                await smtpClient.SendMailAsync(mailMessage);

                _logger.LogInformation($"Email sent successfully to {toEmail} (SSL: {enableSsl})");
                return new EmailSendResult(true, null);
            }
            catch (SmtpException ex)
            {
                var innerMessage = ex.InnerException?.Message;
                var statusCode = ex.StatusCode.ToString();
                var detail = string.IsNullOrWhiteSpace(innerMessage) ? "" : $" ({innerMessage})";
                _logger.LogWarning(ex, $"SMTP attempt failed (SSL: {enableSsl}) to {toEmail}: {ex.Message} ({statusCode}) {innerMessage}");
                return new EmailSendResult(false, $"SMTP error ({statusCode}): {ex.Message}{detail}");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"SMTP attempt failed (SSL: {enableSsl}) to {toEmail}: {ex.Message}");
                return new EmailSendResult(false, $"Error sending email: {ex.Message}");
            }
            finally
            {
                if (!string.IsNullOrWhiteSpace(tempFilePath))
                {
                    try
                    {
                        if (File.Exists(tempFilePath))
                        {
                            File.Delete(tempFilePath);
                        }
                    }
                    catch
                    {
                        // Ignore temp file cleanup failures
                    }
                }
            }
        }

        public async Task<EmailSendResult> SendInvoiceReminderEmailAsync(string toEmail, Invoice invoice, byte[] pdfBytes, string accessToken, string ccEmail = null)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending invoice reminder email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var currencySymbol = !string.IsNullOrWhiteSpace(companySettings.CurrencySymbol)
                ? companySettings.CurrencySymbol
                : "£";

            var daysOverdue = invoice.DueDate.HasValue
                ? (int)(DateTime.UtcNow.Date - invoice.DueDate.Value.Date).TotalDays
                : 0;

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"] = $"Payment Reminder: Invoice {invoice.InvoiceNumber}",
                ["CUSTOMER_NAME"] = invoice.CustomerName ?? "Customer",
                ["INVOICE_NUMBER"] = invoice.InvoiceNumber ?? "",
                ["INVOICE_DATE"] = invoice.DateIssued.ToString("dd MMM yyyy"),
                ["INVOICE_NET"] = invoice.AmountNet.ToString("N2"),
                ["INVOICE_VAT"] = invoice.VATAmount.ToString("N2"),
                ["INVOICE_GROSS"] = invoice.AmountGross.ToString("N2"),
                ["INVOICE_TOTAL"] = invoice.AmountGross.ToString("N2"),
                ["CURRENCY_SYMBOL"] = currencySymbol,
                ["DUE_DATE"] = invoice.DueDate?.ToString("dd MMM yyyy") ?? "",
                ["DAYS_OVERDUE"] = daysOverdue.ToString(),
                ["PO_REFERENCE"] = invoice.POReference ?? ""
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("invoice_reminder", companySettings, placeholders, logoSrcOverride);

            var reminderCount = invoice.ReminderCount > 0 ? $" (Reminder #{invoice.ReminderCount + 1})" : "";

            // Use invoices mailbox as From; BCC it so sender gets a copy
            var fromAddress = !string.IsNullOrWhiteSpace(companySettings.InvoicesEmail)
                ? companySettings.InvoicesEmail
                : companySettings.SmtpFromAddress;
            var bccAddresses = !string.IsNullOrWhiteSpace(fromAddress) ? new[] { fromAddress } : null;
            var ccAddresses  = !string.IsNullOrWhiteSpace(ccEmail) ? new[] { ccEmail } : null;

            return await SendEmailWithResultAsync(
                toEmail,
                $"Payment Reminder: Invoice {invoice.InvoiceNumber}{reminderCount}",
                htmlBody,
                accessToken,
                pdfBytes,
                pdfBytes != null ? $"Invoice-{invoice.InvoiceNumber}.pdf" : null,
                logoBytes,
                logoContentType,
                logoContentId,
                fromAddress,
                ccAddresses,
                bccAddresses
            );
        }

        public async Task<EmailSendResult> SendInvoiceEmailAsync(string toEmail, Invoice invoice, byte[] pdfBytes, string accessToken, string ccEmail = null)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending invoice email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var currencySymbol = !string.IsNullOrWhiteSpace(companySettings.CurrencySymbol)
                ? companySettings.CurrencySymbol
                : "£";

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"] = $"Invoice {invoice.InvoiceNumber}",
                ["CUSTOMER_NAME"] = invoice.CustomerName ?? "Customer",
                ["INVOICE_NUMBER"] = invoice.InvoiceNumber ?? "",
                ["INVOICE_DATE"] = invoice.DateIssued.ToString("dd MMM yyyy"),
                ["INVOICE_NET"] = invoice.AmountNet.ToString("N2"),
                ["INVOICE_VAT"] = invoice.VATAmount.ToString("N2"),
                ["INVOICE_GROSS"] = invoice.AmountGross.ToString("N2"),
                ["INVOICE_TOTAL"] = invoice.AmountGross.ToString("N2"),
                ["CURRENCY_SYMBOL"] = currencySymbol,
                ["DUE_DATE"] = invoice.DueDate?.ToString("dd MMM yyyy") ?? "",
                ["PO_REFERENCE"] = invoice.POReference ?? ""
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("invoice", companySettings, placeholders, logoSrcOverride);

            // Use invoices mailbox as From; BCC it so sender gets a copy
            var fromAddress = !string.IsNullOrWhiteSpace(companySettings.InvoicesEmail)
                ? companySettings.InvoicesEmail
                : companySettings.SmtpFromAddress;
            var bccAddresses = !string.IsNullOrWhiteSpace(fromAddress) ? new[] { fromAddress } : null;
            var ccAddresses  = !string.IsNullOrWhiteSpace(ccEmail) ? new[] { ccEmail } : null;

            return await SendEmailWithResultAsync(
                toEmail,
                $"Invoice {invoice.InvoiceNumber}",
                htmlBody,
                accessToken,
                pdfBytes,
                $"Invoice-{invoice.InvoiceNumber}.pdf",
                logoBytes,
                logoContentType,
                logoContentId,
                fromAddress,
                ccAddresses,
                bccAddresses
            );
        }

        public async Task<EmailSendResult> SendPaymentReceivedEmailAsync(string toEmail, Invoice invoice, string accessToken, string ccEmail = null)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending payment received email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var currencySymbol = !string.IsNullOrWhiteSpace(companySettings.CurrencySymbol)
                ? companySettings.CurrencySymbol
                : "£";

            var paymentDate = invoice.DatePaid.HasValue
                ? invoice.DatePaid.Value.ToString("dd MMM yyyy")
                : DateTime.UtcNow.ToString("dd MMM yyyy");

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"] = $"Payment Received — Invoice {invoice.InvoiceNumber}",
                ["CUSTOMER_NAME"] = invoice.CustomerName ?? "Customer",
                ["INVOICE_NUMBER"] = invoice.InvoiceNumber ?? "",
                ["INVOICE_DATE"] = invoice.DateIssued.ToString("dd MMM yyyy"),
                ["INVOICE_TOTAL"] = invoice.AmountGross.ToString("N2"),
                ["CURRENCY_SYMBOL"] = currencySymbol,
                ["PAYMENT_DATE"] = paymentDate,
                ["PO_REFERENCE"] = invoice.POReference ?? ""
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("payment_received", companySettings, placeholders, logoSrcOverride);

            var fromAddress = !string.IsNullOrWhiteSpace(companySettings.InvoicesEmail)
                ? companySettings.InvoicesEmail
                : companySettings.SmtpFromAddress;
            var bccAddresses = !string.IsNullOrWhiteSpace(fromAddress) ? new[] { fromAddress } : null;
            var ccAddresses  = !string.IsNullOrWhiteSpace(ccEmail) ? new[] { ccEmail } : null;

            return await SendEmailWithResultAsync(
                toEmail,
                $"Payment Received — Invoice {invoice.InvoiceNumber}",
                htmlBody,
                accessToken,
                null,  // no PDF attachment needed for payment confirmation
                null,
                logoBytes,
                logoContentType,
                logoContentId,
                fromAddress,
                ccAddresses,
                bccAddresses
            );
        }

        public async Task<EmailSendResult> SendQuoteEmailAsync(string toEmail, Quote quote, byte[] pdfBytes, string accessToken, string ccEmail = null)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending quote email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var currencySymbol = !string.IsNullOrWhiteSpace(companySettings.CurrencySymbol)
                ? companySettings.CurrencySymbol
                : "£";

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"] = $"Quotation {quote.QuoteNumber}",
                ["CUSTOMER_NAME"] = quote.CustomerName ?? "Customer",
                ["QUOTE_NUMBER"] = quote.QuoteNumber ?? "",
                ["QUOTE_DATE"] = quote.DateIssued.ToString("dd MMM yyyy"),
                ["QUOTE_TOTAL"] = quote.AmountGross.ToString("N2"),
                ["CURRENCY_SYMBOL"] = currencySymbol,
                ["VALID_UNTIL"] = quote.ValidUntil?.ToString("dd MMM yyyy") ?? "",
                ["PO_REFERENCE"] = "" // Quotes don't have PO references — pass empty to remove conditional block
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("quote", companySettings, placeholders, logoSrcOverride);

            // Use quotes mailbox as From; BCC it so sender gets a copy
            var fromAddress = !string.IsNullOrWhiteSpace(companySettings.QuotesEmail)
                ? companySettings.QuotesEmail
                : companySettings.SmtpFromAddress;
            var bccAddresses = !string.IsNullOrWhiteSpace(fromAddress) ? new[] { fromAddress } : null;
            var ccAddresses  = !string.IsNullOrWhiteSpace(ccEmail) ? new[] { ccEmail } : null;

            return await SendEmailWithResultAsync(
                toEmail,
                $"Quotation {quote.QuoteNumber}",
                htmlBody,
                accessToken,
                pdfBytes,
                $"Quote-{quote.QuoteNumber}.pdf",
                logoBytes,
                logoContentType,
                logoContentId,
                fromAddress,
                ccAddresses,
                bccAddresses
            );
        }

        public async Task<EmailSendResult> SendShareCertificateEmailAsync(
            string toEmail,
            Shareholder shareholder,
            string certificateNumber,
            string shareClassName,
            DateTime issueDate,
            byte[] pdfBytes,
            string accessToken)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending share certificate email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var placeholders = new Dictionary<string, string>
            {
                ["SHAREHOLDER_NAME"] = shareholder.Name ?? "",
                ["CERTIFICATE_NUMBER"] = certificateNumber,
                ["NUMBER_OF_SHARES"] = shareholder.SharesOwned.ToString(),
                ["SHARE_CLASS"] = shareClassName,
                ["ISSUE_DATE"] = issueDate.ToString("dd MMM yyyy")
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("share_certificate", companySettings, placeholders, logoSrcOverride);

            var attachmentName = $"{(shareholder.Name ?? "shareholder").Replace(" ", "_")}-Share-Certificate-{certificateNumber}.pdf";

            return await SendEmailWithResultAsync(
                toEmail,
                $"Share Certificate {certificateNumber}",
                htmlBody,
                accessToken,
                pdfBytes,
                attachmentName,
                logoBytes,
                logoContentType,
                logoContentId
            );
        }

        // ─── Dividend Voucher email ───────────────────────────────────────────
        public async Task<EmailSendResult> SendDividendVoucherEmailAsync(
            string toEmail,
            string shareholderName,
            string voucherRef,
            string shareClass,
            int numberOfShares,
            decimal amountPerShare,
            decimal totalAmount,
            DateTime paymentDate,
            byte[] pdfBytes,
            string accessToken)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending dividend voucher email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var currencySymbol = !string.IsNullOrWhiteSpace(companySettings.CurrencySymbol)
                ? companySettings.CurrencySymbol
                : "£";

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"]    = $"Dividend Voucher — {voucherRef}",
                ["SHAREHOLDER_NAME"] = shareholderName,
                ["VOUCHER_REF"]      = voucherRef,
                ["SHARE_CLASS"]      = shareClass,
                ["NUMBER_OF_SHARES"] = numberOfShares.ToString("N0"),
                ["RATE_PER_SHARE"]   = amountPerShare.ToString("F4"),
                ["DIVIDEND_AMOUNT"]  = totalAmount.ToString("N2"),
                ["PAYMENT_DATE"]     = paymentDate.ToString("dd MMM yyyy"),
                ["CURRENCY_SYMBOL"]  = currencySymbol,
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("dividend_voucher", companySettings, placeholders, logoSrcOverride);

            var attachmentName = $"{voucherRef}-Voucher-{(shareholderName ?? "shareholder").Replace(" ", "_")}.pdf";

            return await SendEmailWithResultAsync(
                toEmail,
                $"Dividend Voucher — {voucherRef}",
                htmlBody,
                accessToken,
                pdfBytes,
                attachmentName,
                logoBytes,
                logoContentType,
                logoContentId
            );
        }

        public async Task<EmailSendResult> SendBacPaymentEmailAsync(
            string toEmail,
            string dividendRef,
            string dividendType,
            string shareClass,
            DateTime paymentDate,
            decimal totalAmount,
            int shareholderCount,
            byte[] csvBytes,
            string accessToken)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending BAC payment email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"]       = $"BAC Payment File — {dividendRef}",
                ["DIVIDEND_REF"]        = dividendRef,
                ["DIVIDEND_TYPE"]       = dividendType,
                ["SHARE_CLASS"]         = shareClass,
                ["PAYMENT_DATE"]        = paymentDate.ToString("dd MMMM yyyy"),
                ["TOTAL_AMOUNT"]        = totalAmount.ToString("N2"),
                ["SHAREHOLDER_COUNT"]   = shareholderCount.ToString(),
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("bac_payment", companySettings, placeholders, logoSrcOverride);

            return await SendEmailWithResultAsync(
                toEmail,
                $"BAC Payment File — {dividendRef} ({dividendType} Dividend)",
                htmlBody,
                accessToken,
                csvBytes,
                $"{dividendRef}-BAC.csv",
                logoBytes,
                logoContentType,
                logoContentId
            );
        }

        public async Task<EmailSendResult> SendTestEmailAsync(string toEmail, string accessToken)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending test email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"] = "Test Email from FinanceHub",
                ["TIMESTAMP"] = DateTime.Now.ToString("dd MMM yyyy HH:mm:ss")
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("test", companySettings, placeholders, logoSrcOverride);

            return await SendEmailWithResultAsync(
                toEmail,
                "Test Email from FinanceHub",
                htmlBody,
                accessToken,
                null,
                null,
                logoBytes,
                logoContentType,
                logoContentId
            );
        }

        public async Task<EmailSendResult> SendPayslipEmailAsync(
            string toEmail,
            Payslip slip,
            PayrollRun run,
            CompanySettings? company,
            byte[] pdfBytes,
            string accessToken)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = company ?? await GetCompanySettingsAsync(accessToken);
            if (companySettings == null)
                return new EmailSendResult(false, "Company settings not found");

            var period = run.PayDate.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture);

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"]  = $"Payslip — {period}",
                ["EMPLOYEE_NAME"]  = slip.EmployeeName ?? "Employee",
                ["PERIOD"]         = period,
                ["GROSS_PAY"]      = (slip.GrossPay ?? 0m).ToString("N2"),
                ["INCOME_TAX"]     = (slip.Tax ?? 0m).ToString("N2"),
                ["EMPLOYEE_NI"]    = (slip.NationalInsurance ?? 0m).ToString("N2"),
                ["NET_PAY"]        = (slip.NetPay ?? 0m).ToString("N2"),
                ["PAYMENT_DATE"]   = run.PayDate.ToString("dd MMM yyyy", System.Globalization.CultureInfo.InvariantCulture)
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("payslip", companySettings, placeholders, logoSrcOverride);
            var empName  = (slip.EmployeeName ?? "employee").Replace(" ", "_");
            var fileName = $"Payslip-{empName}-{run.PayDate:yyyy-MM}.pdf";

            return await SendEmailWithResultAsync(
                toEmail,
                $"Payslip — {period}",
                htmlBody,
                accessToken,
                pdfBytes,
                fileName,
                logoBytes,
                logoContentType,
                logoContentId
            );
        }

        public async Task<EmailSendResult> SendPayrollSummaryEmailAsync(
            string toEmail,
            PayrollRun run,
            List<Payslip> payslips,
            List<Employee> employees,
            CompanySettings? company,
            PayrollSettings? settings,
            string accessToken,
            byte[]? bacsCsvBytes = null,
            string? bacsFileName = null)
        {
            var emailTemplate   = new EmailTemplateService(_blobStorageService);
            var companySettings = company ?? await GetCompanySettingsAsync(accessToken);
            if (companySettings == null)
                return new EmailSendResult(false, "Company settings not found");

            var period    = run.PayDate.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture);
            var nextMonth = run.PayDate.AddMonths(1).ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture);

            // Build payments table
            var sb = new System.Text.StringBuilder();
            sb.Append("<table style='width:100%;border-collapse:collapse;font-size:13px;'>");
            sb.Append("<thead><tr style='background:#f3f4f6;'>");
            sb.Append("<th style='padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;'>Employee</th>");
            sb.Append("<th style='padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;'>Gross Pay</th>");
            sb.Append("<th style='padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;'>Income Tax</th>");
            sb.Append("<th style='padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;'>Employee NI</th>");
            sb.Append("<th style='padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;color:#856404;'>Employer NI ⚠</th>");
            sb.Append("<th style='padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;color:#166534;font-weight:700;'>Net Pay (Bank Transfer)</th>");
            sb.Append("</tr></thead><tbody>");

            foreach (var slip in payslips)
            {
                var emp    = employees.FirstOrDefault(e => e.Id == slip.EmployeeId);
                var name   = emp?.Name ?? slip.EmployeeName ?? $"Employee #{slip.EmployeeId}";
                var bank   = string.IsNullOrWhiteSpace(emp?.BankAccountNumber)
                             ? "<em style='color:#9ca3af;'>no bank details</em>"
                             : $"****{emp.BankAccountNumber[^Math.Min(4, emp.BankAccountNumber.Length)..]} ({emp.BankSortCode})";
                sb.Append("<tr style='border-bottom:1px solid #f0f0f0;'>");
                sb.Append($"<td style='padding:8px;'><strong>{name}</strong><br/><span style='font-size:11px;color:#6b7280;'>{bank}</span></td>");
                sb.Append($"<td style='padding:8px;text-align:right;'>£{(slip.GrossPay ?? 0m):N2}</td>");
                sb.Append($"<td style='padding:8px;text-align:right;'>£{(slip.Tax ?? 0m):N2}</td>");
                sb.Append($"<td style='padding:8px;text-align:right;'>£{(slip.NationalInsurance ?? 0m):N2}</td>");
                sb.Append($"<td style='padding:8px;text-align:right;color:#856404;font-weight:600;'>£{(slip.EmployerNi ?? 0m):N2}</td>");
                sb.Append($"<td style='padding:8px;text-align:right;color:#166534;font-weight:700;font-size:14px;'>£{(slip.NetPay ?? 0m):N2}</td>");
                sb.Append("</tr>");
            }

            // Totals row
            sb.Append("<tr style='background:#f8f9fa;font-weight:700;border-top:2px solid #e5e7eb;'>");
            sb.Append($"<td style='padding:8px;'>TOTALS ({payslips.Count} employee{(payslips.Count == 1 ? "" : "s")})</td>");
            sb.Append($"<td style='padding:8px;text-align:right;'>£{(run.TotalGross ?? 0m):N2}</td>");
            sb.Append($"<td style='padding:8px;text-align:right;'>£{(run.TotalTax ?? 0m):N2}</td>");
            sb.Append($"<td style='padding:8px;text-align:right;'>£{(run.TotalEmployeeNi ?? 0m):N2}</td>");
            sb.Append($"<td style='padding:8px;text-align:right;color:#856404;'>£{(run.TotalEmployerNi ?? 0m):N2}</td>");
            sb.Append($"<td style='padding:8px;text-align:right;color:#166534;'>£{(run.TotalNetPay ?? 0m):N2}</td>");
            sb.Append("</tr>");
            sb.Append("</tbody></table>");

            var aor = settings?.AccountsOfficeReference ?? "not set";

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"]       = $"Payroll Summary — {period}",
                ["PERIOD"]              = period,
                ["TAX_YEAR"]            = run.TaxYear ?? "",
                ["TAX_MONTH"]           = run.TaxMonth?.ToString() ?? "",
                ["NEXT_MONTH"]          = nextMonth,
                ["PAYMENTS_TABLE"]      = sb.ToString(),
                ["TOTAL_EMPLOYER_NI"]   = (run.TotalEmployerNi ?? 0m).ToString("N2"),
                ["TOTAL_EMPLOYEE_NI"]   = (run.TotalEmployeeNi ?? 0m).ToString("N2"),
                ["TOTAL_TAX"]           = (run.TotalTax ?? 0m).ToString("N2"),
                ["AOR"]                 = aor
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("payroll_summary", companySettings, placeholders, logoSrcOverride);

            return await SendEmailWithResultAsync(
                toEmail,
                $"Payroll Summary — {period}",
                htmlBody,
                accessToken,
                bacsCsvBytes,
                bacsFileName,
                logoBytes,
                logoContentType,
                logoContentId
            );
        }

        // ─── P11D email ──────────────────────────────────────────────────────────
        public async Task<EmailSendResult> SendP11DEmailAsync(
            string toEmail,
            string recipientName,
            string taxYear,
            List<BikEntry> entries,
            string companyName,
            string payeRef,
            string accessToken,
            byte[] pdfBytes,
            string? fromAddressOverride = null)
        {
            var emailTemplate   = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);
            if (companySettings == null)
                return new EmailSendResult(false, "Company settings not found");

            var taxableEntries = entries.Where(e => !e.IsExempt).ToList();
            var totalCashEquiv = taxableEntries.Sum(e => e.CashEquivalent);
            var totalClass1A   = totalCashEquiv * 0.138m;
            var parts          = taxYear.Split('/');
            var deadlineYear   = parts.Length > 1 ? "20" + parts[1].Trim() : "";

            // Build benefits table HTML (used as a placeholder inside the template)
            var tbl = new System.Text.StringBuilder();
            tbl.Append("<div class='highlight'>");
            tbl.Append("<table style='width:100%;border-collapse:collapse;font-size:13px;'>");
            tbl.Append("<thead><tr style='background:#1e3a5f;color:#fff;'>");
            tbl.Append("<th style='padding:8px 10px;text-align:left;'>Category</th>");
            tbl.Append("<th style='padding:8px 10px;text-align:left;'>Description</th>");
            tbl.Append("<th style='padding:8px 10px;text-align:right;'>Cash Equivalent</th>");
            tbl.Append("<th style='padding:8px 10px;text-align:center;'>Status</th>");
            tbl.Append("</tr></thead><tbody>");
            bool alt = false;
            foreach (var e in entries)
            {
                var bg = alt ? "#f9fafb" : "#ffffff";
                tbl.Append($"<tr style='background:{bg};'>");
                tbl.Append($"<td style='padding:8px 10px;border-bottom:1px solid #e2e8f0;'>{System.Net.WebUtility.HtmlEncode(e.BenefitCategory)}</td>");
                tbl.Append($"<td style='padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#6b7280;'>{System.Net.WebUtility.HtmlEncode(e.Description ?? "")}</td>");
                tbl.Append($"<td style='padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;'>£{e.CashEquivalent:N2}</td>");
                tbl.Append(e.IsExempt
                    ? "<td style='padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;color:#16a34a;font-weight:600;'>✓ Exempt</td>"
                    : "<td style='padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;color:#dc2626;'>Taxable</td>");
                tbl.Append("</tr>");
                alt = !alt;
            }
            tbl.Append($"<tr style='background:#f1f5f9;font-weight:700;border-top:2px solid #e2e8f0;'>");
            tbl.Append($"<td colspan='2' style='padding:9px 10px;'>Total Taxable Cash Equivalent</td>");
            tbl.Append($"<td style='padding:9px 10px;text-align:right;'>£{totalCashEquiv:N2}</td><td></td></tr>");
            tbl.Append($"<tr style='background:#f1f5f9;font-weight:700;'>");
            tbl.Append($"<td colspan='2' style='padding:9px 10px;color:#7c3aed;'>Class 1A NI (13.8%)</td>");
            tbl.Append($"<td style='padding:9px 10px;text-align:right;color:#7c3aed;'>£{totalClass1A:N2}</td><td></td></tr>");
            tbl.Append("</tbody></table></div>");

            // Deadlines box
            var deadlinesHtml = "";
            if (!string.IsNullOrEmpty(deadlineYear))
            {
                deadlinesHtml = $"<div style='background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px 16px;font-size:13px;margin-bottom:20px;'>" +
                                $"📌 <strong>Filing deadlines:</strong> P11D must be filed with HMRC by <strong>6 July {deadlineYear}</strong>. " +
                                $"Class 1A NI is due by <strong>22 July {deadlineYear}</strong>." +
                                $"</div>";
            }

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"]   = $"P11D — Benefits in Kind — {taxYear}",
                ["RECIPIENT_NAME"]  = System.Net.WebUtility.HtmlEncode(recipientName),
                ["TAX_YEAR"]        = System.Net.WebUtility.HtmlEncode(taxYear),
                ["BENEFITS_TABLE"]  = tbl.ToString(),
                ["DEADLINES_BOX"]   = deadlinesHtml,
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("p11d", companySettings, placeholders, logoSrcOverride);

            var pdfFileName = $"P11D-{recipientName.Replace(" ", "-")}-{taxYear.Replace("/", "-")}.pdf";

            return await SendEmailWithResultAsync(
                toEmail,
                $"P11D — Benefits in Kind — {taxYear}",
                htmlBody,
                accessToken,
                pdfBytes,
                pdfFileName,
                logoBytes,
                logoContentType,
                logoContentId,
                fromAddressOverride
            );
        }

        public async Task<EmailSendResult> SendCreditNoteEmailAsync(string toEmail, CreditNote creditNote, byte[] pdfBytes, string accessToken, string ccEmail = null)
        {
            var emailTemplate = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync(accessToken);

            if (companySettings == null)
            {
                _logger.LogError("Company settings not found when sending credit note email");
                return new EmailSendResult(false, "Company settings not found");
            }

            var currencySymbol = !string.IsNullOrWhiteSpace(companySettings.CurrencySymbol)
                ? companySettings.CurrencySymbol
                : "£";

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"] = $"Credit Note {creditNote.CreditNoteNumber}",
                ["CUSTOMER_NAME"] = creditNote.CustomerName ?? "Customer",
                ["CREDIT_NOTE_NUMBER"] = creditNote.CreditNoteNumber ?? "",
                ["AMOUNT"] = creditNote.AmountGross.ToString("N2"),
                ["CURRENCY_SYMBOL"] = currencySymbol,
                ["ORIGINAL_INVOICE"] = creditNote.OriginalInvoiceNumber ?? "N/A",
                ["DATE"] = creditNote.DateIssued.ToString("dd MMM yyyy"),
                ["REASON"] = creditNote.Reason ?? ""
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("creditnote", companySettings, placeholders, logoSrcOverride);

            var fromAddress = !string.IsNullOrWhiteSpace(companySettings.InvoicesEmail)
                ? companySettings.InvoicesEmail
                : companySettings.SmtpFromAddress;
            var bccAddresses = !string.IsNullOrWhiteSpace(fromAddress) ? new[] { fromAddress } : null;
            var ccAddresses  = !string.IsNullOrWhiteSpace(ccEmail) ? new[] { ccEmail } : null;

            return await SendEmailWithResultAsync(
                toEmail,
                $"Credit Note {creditNote.CreditNoteNumber}",
                htmlBody,
                accessToken,
                pdfBytes,
                $"CreditNote-{creditNote.CreditNoteNumber}.pdf",
                logoBytes,
                logoContentType,
                logoContentId,
                fromAddress,
                ccAddresses,
                bccAddresses
            );
        }

        private async Task<EmailSendResult> SendPaymentsMailboxEmailAsync(
            string toEmail,
            string subject,
            string htmlBody,
            CompanySettings companySettings,
            byte[]? attachmentBytes = null,
            string? attachmentFileName = null,
            byte[]? logoBytes = null,
            string? logoContentType = null,
            string? logoContentId = null)
        {
            var preferredFromAddress = !string.IsNullOrWhiteSpace(companySettings.PaymentsEmail)
                ? companySettings.PaymentsEmail
                : companySettings.SmtpFromAddress;
            var primaryBccAddresses = !string.IsNullOrWhiteSpace(preferredFromAddress)
                ? new[] { preferredFromAddress }
                : null;

            var primaryAttempt = await SendEmailWithResultAsync(
                toEmail,
                subject,
                htmlBody,
                accessToken: "",
                attachmentBytes,
                attachmentFileName,
                logoBytes,
                logoContentType,
                logoContentId,
                preferredFromAddress,
                null,
                primaryBccAddresses);

            if (primaryAttempt.Success ||
                string.IsNullOrWhiteSpace(companySettings.PaymentsEmail) ||
                string.Equals(preferredFromAddress, companySettings.SmtpFromAddress, StringComparison.OrdinalIgnoreCase))
            {
                return primaryAttempt;
            }

            _logger.LogWarning(
                "Primary DLA email send using PaymentsEmail '{PaymentsEmail}' failed. Retrying via SMTP from-address '{SmtpFromAddress}' with Reply-To set to PaymentsEmail. Error: {Error}",
                companySettings.PaymentsEmail,
                companySettings.SmtpFromAddress,
                primaryAttempt.Error);

            var fallbackBccAddresses = !string.IsNullOrWhiteSpace(companySettings.PaymentsEmail)
                ? new[] { companySettings.PaymentsEmail }
                : primaryBccAddresses;

            return await SendEmailWithResultAsync(
                toEmail,
                subject,
                htmlBody,
                accessToken: "",
                attachmentBytes,
                attachmentFileName,
                logoBytes,
                logoContentType,
                logoContentId,
                companySettings.SmtpFromAddress,
                null,
                fallbackBccAddresses,
                new[] { companySettings.PaymentsEmail! });
        }

        // ─── DLA Payment email ───────────────────────────────────────────────────
        public async Task<EmailSendResult> SendDlaPaymentEmailAsync(
            string toEmail,
            string dlaId,
            string director,
            string description,
            decimal paymentAmount,
            DateTime paymentDate,
            string paymentMethod,
            string paymentId,
            decimal totalPaid,
            decimal remainingBalance,
            bool isFullPayment,
            byte[] csvBytes,
            string csvFileName)
        {
            var emailTemplate   = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync("");
            if (companySettings == null)
                return new EmailSendResult(false, "Company settings not found");

            var statusLabel = isFullPayment ? "Fully Paid" : "Partial Payment";
            var statusColor = isFullPayment ? "#16a34a" : "#b45309";

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"]     = $"DLA Payment — {dlaId} — £{paymentAmount:N2} — {statusLabel}",
                ["STATUS_LABEL"]      = statusLabel,
                ["STATUS_COLOR"]      = statusColor,
                ["DLA_ID"]            = dlaId,
                ["DIRECTOR"]          = director ?? "",
                ["DESCRIPTION"]       = description ?? "",
                ["PAYMENT_AMOUNT"]    = paymentAmount.ToString("N2"),
                ["PAYMENT_DATE"]      = paymentDate.ToString("dd MMM yyyy"),
                ["PAYMENT_METHOD"]    = paymentMethod ?? "Not specified",
                ["PAYMENT_ID"]        = paymentId ?? "",
                ["TOTAL_PAID"]        = totalPaid.ToString("N2"),
                ["REMAINING_BALANCE"] = remainingBalance.ToString("N2"),
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("dla_payment", companySettings, placeholders, logoSrcOverride);

            return await SendPaymentsMailboxEmailAsync(
                toEmail,
                $"DLA Payment — {dlaId} — £{paymentAmount:N2} — {statusLabel}",
                htmlBody,
                companySettings,
                csvBytes,
                csvFileName,
                logoBytes,
                logoContentType,
                logoContentId);
        }

        // ─── DLA Batch Payment email ─────────────────────────────────────────────
        public async Task<EmailSendResult> SendDlaBatchPaymentEmailAsync(
            string toEmail,
            string batchRef,
            DateTime paymentDate,
            string paymentMethod,
            string bankRef,
            decimal totalAmount,
            List<(string DlaId, string Director, string Description, decimal Amount)> entries,
            int skippedCount,
            byte[] csvBytes,
            string csvFileName)
        {
            var emailTemplate   = new EmailTemplateService(_blobStorageService);
            var companySettings = await GetCompanySettingsAsync("");
            if (companySettings == null)
                return new EmailSendResult(false, "Company settings not found");

            var tbl = new System.Text.StringBuilder();
            tbl.Append("<table border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;font-size:13px;width:100%;margin-top:10px;'>");
            tbl.Append("<thead><tr style='background:#0f2a4a;color:#fff;'><th>DLA ID</th><th>Director</th><th>Description</th><th style='text-align:right'>Amount</th></tr></thead><tbody>");
            foreach (var (dlaId, director, desc, amount) in entries)
                tbl.Append($"<tr><td>{System.Net.WebUtility.HtmlEncode(dlaId)}</td><td>{System.Net.WebUtility.HtmlEncode(director)}</td><td>{System.Net.WebUtility.HtmlEncode(desc)}</td><td style='text-align:right'>£{amount:N2}</td></tr>");
            tbl.Append($"<tr style='font-weight:bold;background:#f1f5f9;'><td colspan='3'>TOTAL</td><td style='text-align:right'>£{totalAmount:N2}</td></tr>");
            tbl.Append("</tbody></table>");

            var placeholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"]  = $"DLA Batch Payment — {entries.Count} entries — £{totalAmount:N2} — {batchRef}",
                ["BATCH_REF"]      = batchRef,
                ["PAYMENT_DATE"]   = paymentDate.ToString("dd MMM yyyy"),
                ["PAYMENT_METHOD"] = paymentMethod ?? "Not specified",
                ["BANK_REF"]       = bankRef ?? "",
                ["TOTAL_AMOUNT"]   = totalAmount.ToString("N2"),
                ["ENTRY_COUNT"]    = entries.Count.ToString(),
                ["ENTRIES_TABLE"]  = tbl.ToString(),
                ["SKIP_WARNING"]   = skippedCount > 0
                    ? $"{skippedCount} entry/entries were skipped (already paid or not found)."
                    : "",
            };

            var (logoBytes, logoContentType, logoContentId, logoSrcOverride) = await TryGetInlineLogoAsync(companySettings);
            var htmlBody = await emailTemplate.GenerateEmailHtmlAsync("dla_batch_payment", companySettings, placeholders, logoSrcOverride);

            return await SendPaymentsMailboxEmailAsync(
                toEmail,
                $"DLA Batch Payment — {entries.Count} entries — £{totalAmount:N2} — {batchRef}",
                htmlBody,
                companySettings,
                csvBytes,
                csvFileName,
                logoBytes,
                logoContentType,
                logoContentId);
        }
    }
}
