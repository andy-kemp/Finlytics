using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Services
{
    public class EmailTemplateService
    {
        private readonly BlobStorageService? _blobStorageService;

        public EmailTemplateService(BlobStorageService? blobStorageService = null)
        {
            _blobStorageService = blobStorageService;
        }

        // Base email template with company branding
        private const string BASE_TEMPLATE = @"
<!DOCTYPE html>
<html lang='en'>
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>{{EMAIL_SUBJECT}}</title>
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f6f8; }
        .email-container { max-width: 640px; margin: 20px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
        .email-logo { background: #0b1f35; }
        .email-logo img { width: 100%; max-width: 100%; height: auto; display: block; }
        .email-header { background: #0f2a4a; color: #ffffff; padding: 16px 24px; text-align: center; }
        .email-header h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.2px; }
        .email-body { padding: 28px 24px; color: #1f2937; line-height: 1.6; }
        .email-body h2 { color: #0f2a4a; font-size: 20px; margin-top: 0; }
        .email-body p { margin: 10px 0; }
        .email-body .highlight { background: #f1f5f9; padding: 16px; border-radius: 6px; margin: 18px 0; border: 1px solid #e2e8f0; }
        .email-body .summary-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .email-body .summary-table td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
        .email-body .summary-table td.label { color: #6b7280; width: 45%; }
        .email-body .summary-table td.value { font-weight: 600; text-align: right; }
        .email-body .button { display: inline-block; padding: 12px 22px; background: #0f2a4a; color: #ffffff; text-decoration: none; border-radius: 6px; margin: 18px 0; }
        .email-footer { background: #f8fafc; padding: 18px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e2e8f0; }
        .email-footer p { margin: 5px 0; }
        @media only screen and (max-width: 600px) {
            .email-container { margin: 10px; }
            .email-body { padding: 20px 15px; }
        }
    </style>
</head>
<body>
        <div class='email-container'>
        {{#COMPANY_LOGO}}
        <div class='email-logo'>
            <img src='{{COMPANY_LOGO}}' alt='{{COMPANY_NAME}}' />
        </div>
        {{/COMPANY_LOGO}}
        <div class='email-header'>
            <h1>{{COMPANY_NAME}}</h1>
        </div>
        
        <div class='email-body'>
            {{CONTENT_BLOCK}}
        </div>
        
        <div class='email-footer'>
            <p><strong>{{COMPANY_NAME}}</strong></p>
            {{#COMPANY_ADDRESS}}<p>{{COMPANY_ADDRESS}}</p>{{/COMPANY_ADDRESS}}
            {{#COMPANY_PHONE}}<p>Phone: {{COMPANY_PHONE}}</p>{{/COMPANY_PHONE}}
            {{#COMPANY_EMAIL}}<p>Email: {{COMPANY_EMAIL}}</p>{{/COMPANY_EMAIL}}
            {{#COMPANY_VAT}}<p>VAT: {{COMPANY_VAT}}</p>{{/COMPANY_VAT}}
            <hr style='border: none; border-top: 1px solid #e2e8f0; margin: 12px 0;' />
            {{#COMPANY_REGISTRATION_FOOTER}}
            <p style='font-size: 11px; color: #9ca3af; line-height: 1.5;'>{{COMPANY_REGISTRATION_FOOTER}}</p>
            {{/COMPANY_REGISTRATION_FOOTER}}
        </div>
    </div>
</body>
</html>";

        // Content blocks for different document types
        private static readonly Dictionary<string, string> CONTENT_BLOCKS = new Dictionary<string, string>
        {
            ["invoice"] = @"
                <h2>Invoice {{INVOICE_NUMBER}}</h2>
                <p>Dear {{CUSTOMER_NAME}},</p>
                <p>Please find attached your invoice <strong>{{INVOICE_NUMBER}}</strong> dated <strong>{{INVOICE_DATE}}</strong>.</p>
                <div class='highlight'>
                    <table class='summary-table'>
                        <tr>
                            <td class='label'>Net Amount</td>
                            <td class='value'>{{CURRENCY_SYMBOL}}{{INVOICE_NET}}</td>
                        </tr>
                        <tr>
                            <td class='label'>VAT</td>
                            <td class='value'>{{CURRENCY_SYMBOL}}{{INVOICE_VAT}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Gross Amount</td>
                            <td class='value'><strong>{{CURRENCY_SYMBOL}}{{INVOICE_GROSS}}</strong></td>
                        </tr>
                        <tr>
                            <td class='label'>Due Date</td>
                            <td class='value'>{{DUE_DATE}}</td>
                        </tr>
                        {{#PO_REFERENCE}}<tr>
                            <td class='label'>PO Reference</td>
                            <td class='value'>{{PO_REFERENCE}}</td>
                        </tr>{{/PO_REFERENCE}}
                    </table>
                </div>
                <p>Payment can be made to the bank details shown on the invoice. Please quote the invoice number as a reference.</p>
                <p>If you have any questions regarding this invoice, please don't hesitate to contact us.</p>
                <p>Thank you for your business.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["invoice_reminder"] = @"
                <h2 style='color:#b91c1c;'>Payment Reminder — Invoice {{INVOICE_NUMBER}}</h2>
                <p>Dear {{CUSTOMER_NAME}},</p>
                <p>This is a friendly reminder that invoice <strong>{{INVOICE_NUMBER}}</strong> remains outstanding and is now <strong>{{DAYS_OVERDUE}} day(s) overdue</strong>.</p>
                <div class='highlight' style='border-left:4px solid #b91c1c;'>
                    <table class='summary-table'>
                        <tr>
                            <td class='label'>Invoice Number</td>
                            <td class='value'>{{INVOICE_NUMBER}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Invoice Date</td>
                            <td class='value'>{{INVOICE_DATE}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Net Amount</td>
                            <td class='value'>{{CURRENCY_SYMBOL}}{{INVOICE_NET}}</td>
                        </tr>
                        <tr>
                            <td class='label'>VAT</td>
                            <td class='value'>{{CURRENCY_SYMBOL}}{{INVOICE_VAT}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Amount Due</td>
                            <td class='value' style='color:#b91c1c;font-size:16px;'>{{CURRENCY_SYMBOL}}{{INVOICE_GROSS}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Due Date</td>
                            <td class='value' style='color:#b91c1c;'>{{DUE_DATE}}</td>
                        </tr>
                        {{#PO_REFERENCE}}<tr>
                            <td class='label'>PO Reference</td>
                            <td class='value'>{{PO_REFERENCE}}</td>
                        </tr>{{/PO_REFERENCE}}
                    </table>
                </div>
                <p>If payment has already been made, please disregard this reminder and accept our thanks.</p>
                <p>If you have any queries regarding this invoice, please do not hesitate to contact us and we will be happy to assist.</p>
                <p>To settle this invoice, please use the bank details shown on the invoice and quote the invoice number as a reference.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["quote"] = @"
                <h2>Quotation {{QUOTE_NUMBER}}</h2>
                <p>Dear {{CUSTOMER_NAME}},</p>
                <p>Thank you for your enquiry. Please find attached our quotation <strong>{{QUOTE_NUMBER}}</strong> dated <strong>{{QUOTE_DATE}}</strong>.</p>
                <div class='highlight'>
                    <table class='summary-table'>
                        <tr>
                            <td class='label'>Quote Amount</td>
                            <td class='value'>{{CURRENCY_SYMBOL}}{{QUOTE_TOTAL}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Valid Until</td>
                            <td class='value'>{{VALID_UNTIL}}</td>
                        </tr>
                        {{#PO_REFERENCE}}<tr>
                            <td class='label'>Your Reference</td>
                            <td class='value'>{{PO_REFERENCE}}</td>
                        </tr>{{/PO_REFERENCE}}
                    </table>
                </div>
                <p>This quotation is valid for 30 days from the date shown. If you would like to accept this quote, please reply to this email or contact us directly.</p>
                <p>We look forward to working with you.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["share_certificate"] = @"
                <h2>Share Certificate {{CERTIFICATE_NUMBER}}</h2>
                <p>Dear {{SHAREHOLDER_NAME}},</p>
                <p>Please find attached your share certificate <strong>{{CERTIFICATE_NUMBER}}</strong> for <strong>{{NUMBER_OF_SHARES}}</strong> {{SHARE_CLASS}}.</p>
                <div class='highlight'>
                    <p><strong>Certificate Number:</strong> {{CERTIFICATE_NUMBER}}</p>
                    <p><strong>Share Class:</strong> {{SHARE_CLASS}}</p>
                    <p><strong>Number of Shares:</strong> {{NUMBER_OF_SHARES}}</p>
                    <p><strong>Issue Date:</strong> {{ISSUE_DATE}}</p>
                </div>
                <p>This certificate confirms your shareholding in {{COMPANY_NAME}}. Please keep this document safe as it represents your ownership interest in the company.</p>
                <p>If you have any questions, please don't hesitate to contact us.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["dividend_voucher"] = @"
                <h2>Dividend Payment Notification</h2>
                <p>Dear {{SHAREHOLDER_NAME}},</p>
                <p>We are pleased to notify you of a dividend payment from {{COMPANY_NAME}}.</p>
                <div class='highlight'>
                    <p><strong>Dividend Amount:</strong> {{CURRENCY_SYMBOL}}{{DIVIDEND_AMOUNT}}</p>
                    <p><strong>Payment Date:</strong> {{PAYMENT_DATE}}</p>
                    <p><strong>Share Class:</strong> {{SHARE_CLASS}}</p>
                    <p><strong>Number of Shares:</strong> {{NUMBER_OF_SHARES}}</p>
                    <p><strong>Rate per Share:</strong> {{CURRENCY_SYMBOL}}{{RATE_PER_SHARE}}</p>
                </div>
                <p>The dividend voucher is attached for your records. Payment will be made to your registered bank account.</p>
                <p>Thank you for your continued investment in {{COMPANY_NAME}}.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["meeting_minutes"] = @"
                <h2>Board Meeting Minutes - {{MEETING_DATE}}</h2>
                <p>Dear {{RECIPIENT_NAME}},</p>
                <p>Please find attached the minutes from the board meeting held on <strong>{{MEETING_DATE}}</strong>.</p>
                <div class='highlight'>
                    <p><strong>Meeting Date:</strong> {{MEETING_DATE}}</p>
                    <p><strong>Meeting Type:</strong> {{MEETING_TYPE}}</p>
                </div>
                <p>Please review the attached minutes at your earliest convenience. If you have any comments or corrections, please respond within 7 days.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["test"] = @"
                <h2>Test Email</h2>
                <p>This is a test email from your FinanceHub system.</p>
                <p>If you receive this email, your SMTP configuration is working correctly!</p>
                <div class='highlight'>
                    <p><strong>✓ SMTP Server:</strong> Connected</p>
                    <p><strong>✓ Authentication:</strong> Successful</p>
                    <p><strong>✓ Email Delivery:</strong> Working</p>
                </div>
                <p>Sent at: {{TIMESTAMP}}</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["payslip"] = @"
                <h2>Payslip for {{PERIOD}}</h2>
                <p>Dear {{EMPLOYEE_NAME}},</p>
                <p>Please find your payslip for <strong>{{PERIOD}}</strong> attached to this email.</p>
                <div class='highlight'>
                    <table class='summary-table'>
                        <tr><td class='label'>Pay Date</td><td class='value'>{{PAYMENT_DATE}}</td></tr>
                        <tr><td class='label'>Gross Pay</td><td class='value'>£{{GROSS_PAY}}</td></tr>
                        <tr><td class='label'>Income Tax</td><td class='value'>−£{{INCOME_TAX}}</td></tr>
                        <tr><td class='label'>Employee NI</td><td class='value'>−£{{EMPLOYEE_NI}}</td></tr>
                        <tr><td class='label'>Net Pay</td><td class='value'><strong>£{{NET_PAY}}</strong></td></tr>
                    </table>
                </div>
                <p>Please keep this payslip for your records. If you have any questions about your pay, please contact the finance team.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["payroll_summary"] = @"
                <h2>Payroll Summary — {{PERIOD}}</h2>
                <p>Hello,</p>
                <p>The payroll for <strong>{{PERIOD}}</strong> (Tax Year {{TAX_YEAR}}, Month {{TAX_MONTH}}) has been posted. Below is a summary of payments to process.</p>
                <div class='highlight'>
                    {{PAYMENTS_TABLE}}
                </div>
                <h3 style='margin-top:20px;color:#0f2a4a;'>HMRC Payment Reminder</h3>
                <p>The following amounts are due to HMRC by <strong>22nd {{NEXT_MONTH}}</strong>:</p>
                <ul>
                    <li>Employer NI: <strong>£{{TOTAL_EMPLOYER_NI}}</strong></li>
                    <li>Employee NI: <strong>£{{TOTAL_EMPLOYEE_NI}}</strong></li>
                    <li>Income Tax (PAYE): <strong>£{{TOTAL_TAX}}</strong></li>
                </ul>
                <p style='font-size:12px;color:#6b7280;'>Pay to HMRC using your Accounts Office Reference: <strong>{{AOR}}</strong><br/>
                HMRC PAYE bank: Sort code 08-32-10, Account 12001020 · Reference: {{AOR}}</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["p11d"] = @"
                <h2>P11D — Benefits in Kind — {{TAX_YEAR}}</h2>
                <p>Dear <strong>{{RECIPIENT_NAME}}</strong>,</p>
                <p>Please find attached your P11D form for the above tax year, showing the benefits provided by your employer that are reportable to HMRC.</p>
                {{BENEFITS_TABLE}}
                {{DEADLINES_BOX}}
                <p style='color:#6b7280;font-size:13px;margin-bottom:4px;'>The full P11D form is attached as a PDF. Please keep this for your records.</p>
                <p style='color:#6b7280;font-size:13px;margin-bottom:20px;'>If you have any questions, please contact the payroll team.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["bac_payment"] = @"
                <h2>BAC Payment File — {{DIVIDEND_REF}}</h2>
                <p>Hello,</p>
                <p>Please find attached the BAC payment file for the dividend declaration below. Please process this file at your earliest convenience.</p>
                <div class='highlight'>
                    <table class='summary-table'>
                        <tr><td class='label'>Dividend Reference</td><td class='value'>{{DIVIDEND_REF}}</td></tr>
                        <tr><td class='label'>Dividend Type</td><td class='value'>{{DIVIDEND_TYPE}}</td></tr>
                        <tr><td class='label'>Share Class</td><td class='value'>{{SHARE_CLASS}}</td></tr>
                        <tr><td class='label'>Payment Date</td><td class='value'>{{PAYMENT_DATE}}</td></tr>
                        <tr><td class='label'>Total Amount</td><td class='value'><strong>£{{TOTAL_AMOUNT}}</strong></td></tr>
                        <tr><td class='label'>Shareholders</td><td class='value'>{{SHAREHOLDER_COUNT}}</td></tr>
                    </table>
                </div>
                <p>Voucher references have been assigned. Please email individual dividend vouchers to each shareholder separately via the Dividends module.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["payment_received"] = @"
                <h2 style='color:#16a34a;'>✓ Payment Received — Thank You</h2>
                <p>Dear {{CUSTOMER_NAME}},</p>
                <p>Thank you for your payment. We are pleased to confirm that we have received your payment in full for the invoice below.</p>
                <div class='highlight' style='border-left:4px solid #16a34a;'>
                    <table class='summary-table'>
                        <tr>
                            <td class='label'>Invoice Number</td>
                            <td class='value'><strong>{{INVOICE_NUMBER}}</strong></td>
                        </tr>
                        <tr>
                            <td class='label'>Invoice Date</td>
                            <td class='value'>{{INVOICE_DATE}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Amount Received</td>
                            <td class='value' style='color:#16a34a;font-size:16px;font-weight:bold;'>{{CURRENCY_SYMBOL}}{{INVOICE_TOTAL}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Payment Received</td>
                            <td class='value'>{{PAYMENT_DATE}}</td>
                        </tr>
                        {{#PO_REFERENCE}}<tr>
                            <td class='label'>Your Reference</td>
                            <td class='value'>{{PO_REFERENCE}}</td>
                        </tr>{{/PO_REFERENCE}}
                    </table>
                </div>
                <p>Your account is now clear with respect to this invoice. Please retain this email as your payment confirmation.</p>
                <p>We appreciate your prompt payment and look forward to working with you again.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["creditnote"] = @"
                <h2 style='color:#dc2626;'>Credit Note {{CREDIT_NOTE_NUMBER}}</h2>
                <p>Dear {{CUSTOMER_NAME}},</p>
                <p>Please find attached credit note <strong>{{CREDIT_NOTE_NUMBER}}</strong> dated <strong>{{DATE}}</strong>.</p>
                <div class='highlight' style='border-left:4px solid #dc2626;'>
                    <table class='summary-table'>
                        <tr>
                            <td class='label'>Credit Note Number</td>
                            <td class='value'><strong>{{CREDIT_NOTE_NUMBER}}</strong></td>
                        </tr>
                        <tr>
                            <td class='label'>Date Issued</td>
                            <td class='value'>{{DATE}}</td>
                        </tr>
                        <tr>
                            <td class='label'>Credit Amount</td>
                            <td class='value' style='color:#dc2626;font-size:16px;font-weight:bold;'>{{CURRENCY_SYMBOL}}{{AMOUNT}}</td>
                        </tr>
                        {{#ORIGINAL_INVOICE}}<tr>
                            <td class='label'>Original Invoice</td>
                            <td class='value'>{{ORIGINAL_INVOICE}}</td>
                        </tr>{{/ORIGINAL_INVOICE}}
                    </table>
                </div>
                <p><strong>Reason:</strong> {{REASON}}</p>
                <p>This credit note may be applied against a future invoice or refunded at your request. Please contact us if you have any questions.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["dla_payment"] = @"
                <h2>DLA Payment Confirmation</h2>
                <p>Hello,</p>
                <p>A DLA repayment has been recorded for <strong>{{DIRECTOR}}</strong>.</p>
                <div class='highlight'>
                    <table class='summary-table'>
                        <tr>
                            <td class='label'>Status</td>
                            <td class='value' style='color:{{STATUS_COLOR}};font-weight:bold;'>{{STATUS_LABEL}}</td>
                        </tr>
                        <tr><td class='label'>DLA ID</td><td class='value'>{{DLA_ID}}</td></tr>
                        <tr><td class='label'>Director</td><td class='value'>{{DIRECTOR}}</td></tr>
                        <tr><td class='label'>Description</td><td class='value'>{{DESCRIPTION}}</td></tr>
                        <tr><td class='label'>Payment Amount</td><td class='value' style='font-size:16px;font-weight:bold;'>£{{PAYMENT_AMOUNT}}</td></tr>
                        <tr><td class='label'>Payment Date</td><td class='value'>{{PAYMENT_DATE}}</td></tr>
                        <tr><td class='label'>Payment Method</td><td class='value'>{{PAYMENT_METHOD}}</td></tr>
                        <tr><td class='label'>Payment ID</td><td class='value'>{{PAYMENT_ID}}</td></tr>
                        <tr><td class='label'>Total Paid to Date</td><td class='value'>£{{TOTAL_PAID}}</td></tr>
                        <tr><td class='label'>Remaining Balance</td><td class='value'>£{{REMAINING_BALANCE}}</td></tr>
                    </table>
                </div>
                <p>A CSV file is attached for your records.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>",

            ["dla_batch_payment"] = @"
                <h2>DLA Batch Payment Confirmation</h2>
                <p>Hello,</p>
                <p>A batch DLA repayment has been processed. Please find the details below.</p>
                <div class='highlight'>
                    <table class='summary-table'>
                        <tr><td class='label'>Batch Reference</td><td class='value'><strong>{{BATCH_REF}}</strong></td></tr>
                        <tr><td class='label'>Payment Date</td><td class='value'>{{PAYMENT_DATE}}</td></tr>
                        <tr><td class='label'>Payment Method</td><td class='value'>{{PAYMENT_METHOD}}</td></tr>
                        <tr><td class='label'>Bank Reference</td><td class='value'>{{BANK_REF}}</td></tr>
                        <tr><td class='label'>Total Amount</td><td class='value' style='font-size:16px;font-weight:bold;'>£{{TOTAL_AMOUNT}}</td></tr>
                        <tr><td class='label'>Entries Paid</td><td class='value'>{{ENTRY_COUNT}}</td></tr>
                    </table>
                </div>
                {{ENTRIES_TABLE}}
                {{#SKIP_WARNING}}<p style='color:#b91c1c;margin-top:12px;'>⚠️ {{SKIP_WARNING}}</p>{{/SKIP_WARNING}}
                <p style='margin-top:16px;'>A CSV file is attached for your records.</p>
                <p>Best regards,<br/>{{COMPANY_NAME}}</p>"
        };

        public async Task<string> GenerateEmailHtmlAsync(string contentType, CompanySettings company, Dictionary<string, string> placeholders, string? logoSrcOverride = null)
        {
            if (!CONTENT_BLOCKS.ContainsKey(contentType))
            {
                throw new ArgumentException($"Unknown content type: {contentType}");
            }

            // Get content block
            var contentBlock = CONTENT_BLOCKS[contentType];

            // Apply placeholders to content block
            foreach (var placeholder in placeholders)
            {
                contentBlock = contentBlock.Replace($"{{{{{placeholder.Key}}}}}", placeholder.Value ?? "");
                
                // Handle conditional blocks {{#KEY}}...{{/KEY}}
                var conditionalPattern = $"{{{{#{placeholder.Key}}}}}";
                var conditionalEndPattern = $"{{{{/{placeholder.Key}}}}}";
                
                if (string.IsNullOrEmpty(placeholder.Value))
                {
                    // Remove conditional block if value is empty
                    var startIndex = contentBlock.IndexOf(conditionalPattern);
                    if (startIndex >= 0)
                    {
                        var endIndex = contentBlock.IndexOf(conditionalEndPattern, startIndex);
                        if (endIndex >= 0)
                        {
                            contentBlock = contentBlock.Remove(startIndex, (endIndex - startIndex) + conditionalEndPattern.Length);
                        }
                    }
                }
                else
                {
                    // Remove conditional markers but keep content
                    contentBlock = contentBlock.Replace(conditionalPattern, "");
                    contentBlock = contentBlock.Replace(conditionalEndPattern, "");
                }
            }

            // Apply content block to base template
            var emailHtml = BASE_TEMPLATE.Replace("{{CONTENT_BLOCK}}", contentBlock);

            // Build company registration footer (similar to PDF footer)
            var registrationFooter = BuildCompanyRegistrationFooter(company);

            // Get logo as base64 data URL for email embedding
            string logoDataUrl = "";
            if (!string.IsNullOrWhiteSpace(logoSrcOverride))
            {
                logoDataUrl = logoSrcOverride;
            }
            else
            {
                // Prefer EmailLogoUrl, then blob search, then LogoUrl fallback
                if (!string.IsNullOrWhiteSpace(company.EmailLogoUrl))
                {
                    try
                    {
                        if (_blobStorageService != null)
                        {
                            var (bytes, logoContentType) = await _blobStorageService.GetLogoBytesFromUrlAsync(company.EmailLogoUrl);
                            if (bytes != null && bytes.Length > 0)
                            {
                                var mimeType = logoContentType ?? "image/png";
                                logoDataUrl = $"data:{mimeType};base64,{Convert.ToBase64String(bytes)}";
                            }
                        }
                    }
                    catch
                    {
                        // Fall through to blob search
                    }
                }

                if (string.IsNullOrWhiteSpace(logoDataUrl))
                {
                    try
                    {
                        if (_blobStorageService != null)
                        {
                            logoDataUrl = await _blobStorageService.GetLogoBase64Async(company.Id) ?? "";
                        }
                    }
                    catch
                    {
                        // Logo failed to load - continue without it
                    }
                }

                if (string.IsNullOrWhiteSpace(logoDataUrl) && !string.IsNullOrWhiteSpace(company.LogoUrl))
                {
                    logoDataUrl = company.LogoUrl;
                }
            }

            // Apply company settings to base template
            var companyPlaceholders = new Dictionary<string, string>
            {
                ["EMAIL_SUBJECT"] = placeholders.ContainsKey("EMAIL_SUBJECT") ? placeholders["EMAIL_SUBJECT"] : "Message from " + (company.CompanyName ?? ""),
                ["COMPANY_NAME"] = company.CompanyName ?? "",
                ["COMPANY_LOGO"] = logoDataUrl,
                ["COMPANY_ADDRESS"] = company.CompanyAddress ?? company.Address ?? "",
                ["COMPANY_PHONE"] = company.CompanyPhone ?? company.PhoneNumber ?? "",
                ["COMPANY_EMAIL"] = company.CompanyEmail ?? company.Email ?? "",
                ["COMPANY_VAT"] = company.VatRegistrationNumber ?? company.VATNumber ?? "",
                ["COMPANY_REGISTRATION_FOOTER"] = registrationFooter
            };

            foreach (var placeholder in companyPlaceholders)
            {
                emailHtml = emailHtml.Replace($"{{{{{placeholder.Key}}}}}", placeholder.Value);
                
                // Handle conditional blocks for company fields
                var conditionalPattern = $"{{{{#{placeholder.Key}}}}}";
                var conditionalEndPattern = $"{{{{/{placeholder.Key}}}}}";
                
                if (string.IsNullOrEmpty(placeholder.Value))
                {
                    var startIndex = emailHtml.IndexOf(conditionalPattern);
                    if (startIndex >= 0)
                    {
                        var endIndex = emailHtml.IndexOf(conditionalEndPattern, startIndex);
                        if (endIndex >= 0)
                        {
                            emailHtml = emailHtml.Remove(startIndex, (endIndex - startIndex) + conditionalEndPattern.Length);
                        }
                    }
                }
                else
                {
                    emailHtml = emailHtml.Replace(conditionalPattern, "");
                    emailHtml = emailHtml.Replace(conditionalEndPattern, "");
                }
            }

            return emailHtml;
        }

        private string BuildCompanyRegistrationFooter(CompanySettings company)
        {
            var parts = new List<string>();

            // Determine company location based on registration number
            string companyLocation = "England and Wales";
            if (!string.IsNullOrEmpty(company.CompanyRegistrationNumber) && 
                company.CompanyRegistrationNumber.TrimStart().StartsWith("SC", StringComparison.OrdinalIgnoreCase))
            {
                companyLocation = "Scotland";
            }

            // Build footer text
            if (!string.IsNullOrEmpty(company.CompanyName))
            {
                parts.Add($"{company.CompanyName} is a company registered in {companyLocation}");
                
                if (!string.IsNullOrEmpty(company.CompanyRegistrationNumber))
                {
                    parts.Add($"under company number {company.CompanyRegistrationNumber}");
                }
            }

            // Check both VAT fields with fallback
            var vatNumber = company.VatRegistrationNumber ?? company.VATNumber;
            if (!string.IsNullOrEmpty(vatNumber))
            {
                parts.Add($"VAT registration number: {vatNumber}");
            }

            var address = company.CompanyAddress ?? company.Address;
            if (!string.IsNullOrEmpty(address))
            {
                // Convert multi-line address to comma-separated
                address = address
                    .Replace("\r\n", ", ")
                    .Replace("\n", ", ")
                    .Replace("\r", ", ");
                
                // Remove double commas and trim
                while (address.Contains(", ,"))
                    address = address.Replace(", ,", ",");
                
                parts.Add($"Registered office: {address.Trim()}");
            }

            if (parts.Count > 0)
            {
                var footer = string.Join(". ", parts).TrimEnd('.') + ".";
                footer += $"<br/><br/>© {DateTime.Now.Year} {company.CompanyName ?? "Company"}. All rights reserved.";
                return footer;
            }

            return string.Empty;
        }
    }
}
