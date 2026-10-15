using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Services
{
    /// <summary>
    /// Builds and submits HMRC PAYE RTI Full Payment Submission (FPS) via the
    /// Government Gateway GovTalk XML transaction engine.
    ///
    /// This is a SEPARATE system from the MTD OAuth2 REST APIs used for VAT.
    /// RTI uses Government Gateway user credentials (not OAuth) embedded in the XML.
    ///
    /// Credentials are sourced exclusively from:
    ///   - Gateway User ID  → CompanySettings.HmrcGatewayUserId  (database)
    ///   - Gateway Password → Azure Key Vault secret "HmrcGatewayPassword"
    /// Both are configured via Settings → HMRC in the UI. Nothing is hardcoded.
    /// </summary>
    public class FpsService
    {
        private readonly HttpClient _http;
        private readonly KeyVaultService _keyVault;
        private readonly FinanceHubDbContext _db;
        private readonly bool _testMode;

        private const string SOFTWARE_NAME    = "FinanceHub";
        private const string SOFTWARE_VERSION = "1.0";

        // Both sandbox and production now use the same endpoint.
        private const string PROD_URL = "https://transaction-engine.tax.service.gov.uk/submission";

        public FpsService(IHttpClientFactory httpClientFactory, KeyVaultService keyVault, FinanceHubDbContext db, IConfiguration config)
        {
            _http     = httpClientFactory.CreateClient("hmrc");
            _keyVault = keyVault;
            _db       = db;
            _testMode = string.Equals(config["HmrcUseSandbox"], "true", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Builds the GovTalk FPS XML and POSTs it to the HMRC transaction engine.
        /// Returns a result with success status, correlation ID and message.
        /// </summary>
        public async Task<FpsSubmissionResult> SubmitFpsAsync(
            PayrollRun run,
            List<Payslip> payslips,
            List<Employee> employees,
            PayrollSettings settings)
        {
            // Fetch credentials at submission time — User ID from DB, password from Key Vault.
            // Both are set via Settings → HMRC in the UI; nothing is hardcoded in App Settings.
            var companySettings = await _db.CompanySettings.FirstOrDefaultAsync();
            var gatewayUserId   = companySettings?.HmrcGatewayUserId ?? "";
            var gatewayPassword = await _keyVault.GetHmrcGatewayPasswordAsync() ?? "";

            if (string.IsNullOrWhiteSpace(gatewayUserId) || string.IsNullOrWhiteSpace(gatewayPassword))
                return new FpsSubmissionResult(false, null,
                    "Gateway credentials not configured. " +
                    "Enter your Government Gateway User ID and Password in Settings → HMRC.", null);

            string xml;
            try { xml = BuildGovTalkXml(run, payslips, employees, settings, gatewayUserId, gatewayPassword); }
            catch (Exception ex)
            {
                return new FpsSubmissionResult(false, null, $"XML build error: {ex.Message}", null);
            }

            try
            {
                using var content = new StringContent(xml, Encoding.UTF8, "text/xml");
                var response = await _http.PostAsync(PROD_URL, content);
                var body     = await response.Content.ReadAsStringAsync();
                return ParseGovTalkResponse(body, response.IsSuccessStatusCode);
            }
            catch (Exception ex)
            {
                return new FpsSubmissionResult(false, null, $"HTTP submission error: {ex.Message}", null);
            }
        }

        // ── XML Builder ───────────────────────────────────────────────────────

        private string BuildGovTalkXml(
            PayrollRun run,
            List<Payslip> payslips,
            List<Employee> employees,
            PayrollSettings settings,
            string gatewayUserId,
            string gatewayPassword)
        {
            var empLookup = employees.ToDictionary(e => e.Id);

            // Parse PAYE ref "123/AB12345" → officeNum + payeRef
            var refParts = (settings.EmployerPAYEReference ?? "").Split('/', 2);
            var officeNum = refParts.Length > 0 ? refParts[0].Trim() : "";
            var payeRef   = refParts.Length > 1 ? refParts[1].Trim() : "";
            var aoRef     = (settings.AccountsOfficeReference ?? "").Trim();

            // Tax year end (e.g. "25-26" → 2026)
            var tyParts     = run.TaxYear?.Split('-') ?? Array.Empty<string>();
            int taxYearEnd  = tyParts.Length > 1 && int.TryParse(tyParts[1], out int ty) ? 2000 + ty : DateTime.Now.Year;

            var transId = Guid.NewGuid().ToString("N")[..20].ToUpper();

            var gtkNs = XNamespace.Get("http://www.govtalk.gov.uk/CM/envelope");
            var fpsNs = XNamespace.Get("http://www.govtalk.gov.uk/taxation/PAYE/RTI/FullPaymentSubmission/2017-01-06");
            var xsiNs = XNamespace.Get("http://www.w3.org/2001/XMLSchema-instance");

            // ── FPS body ──────────────────────────────────────────────────────
            var employeeElements = new List<XElement>();
            int payId = 1;

            foreach (var slip in payslips)
            {
                var emp        = empLookup.TryGetValue(slip.EmployeeId, out var e) ? e : null;
                var niNo       = (slip.NiNumber ?? "").Replace(" ", "").ToUpper();
                var fullName   = emp?.Name ?? slip.EmployeeName ?? "Unknown";
                var (fore, sur) = SplitName(fullName);
                var grossPay   = slip.GrossPay ?? 0m;
                var taxM       = slip.TaxMonth ?? run.TaxMonth ?? 1;
                var ytdGross   = slip.YtdGross ?? grossPay;
                var ytdTax     = slip.YtdTax   ?? slip.Tax    ?? 0m;
                var ytdEmpeeNI = slip.YtdEmployeeNi ?? slip.NationalInsurance ?? 0m;
                var ytdErNI    = slip.YtdEmployerNi ?? slip.EmployerNi ?? 0m;
                var niCat      = (slip.NiCategory ?? settings.DefaultNiCategory ?? "A").ToUpper();
                var taxCode    = (slip.TaxCode    ?? settings.DefaultTaxCode    ?? "1257L").Replace(" ", "");

                // NI band calculations (approximate from YTD gross)
                var (atLEL, lelToPT, ptToUEL) = CalcNiBands(ytdGross, taxM, PayrollCalculations.RatesFor(run.TaxYear));

                var payment = new XElement(fpsNs + "Payment",
                    new XElement(fpsNs + "TaxWeekMonth",         taxM),
                    new XElement(fpsNs + "PmtDate",              run.PayDate.ToString("yyyy-MM-dd")),
                    new XElement(fpsNs + "PmtAfterLeaving",      "false"),
                    new XElement(fpsNs + "WeeklyPeriodNumber",   "0"),
                    new XElement(fpsNs + "MonthlyPeriodNumber",  taxM),
                    new XElement(fpsNs + "NumNIPeriods",         "1"),
                    new XElement(fpsNs + "TaxablePay",           Fmt(grossPay)),
                    new XElement(fpsNs + "TotalTaxDeducted",     Fmt(slip.Tax ?? 0m)),
                    new XElement(fpsNs + "EmpNICs",
                        new XElement(fpsNs + "NIcat",                    niCat),
                        new XElement(fpsNs + "GrossEarningsForNICsInPd", Fmt(grossPay)),
                        new XElement(fpsNs + "GrossEarningsForNICsYTD",  Fmt(ytdGross)),
                        new XElement(fpsNs + "AtLELYTD",                 Fmt(atLEL)),
                        new XElement(fpsNs + "LELtoPT",                  Fmt(lelToPT)),
                        new XElement(fpsNs + "PTtoUEL",                  Fmt(ptToUEL)),
                        new XElement(fpsNs + "EmpeeContribnInPd",        Fmt(slip.NationalInsurance ?? 0m)),
                        new XElement(fpsNs + "EmpeeContribnYTD",         Fmt(ytdEmpeeNI)),
                        new XElement(fpsNs + "EmprContribn",             Fmt(ytdErNI))
                    ),
                    new XElement(fpsNs + "TaxablePayYTD",  Fmt(ytdGross)),
                    new XElement(fpsNs + "TotalTaxYTD",    Fmt(ytdTax)),
                    new XElement(fpsNs + "TaxYearEnd",     taxYearEnd)
                );

                var employeeDetails = new XElement(fpsNs + "EmployeeDetails",
                    string.IsNullOrEmpty(niNo) ? null : new XElement(fpsNs + "NINO", niNo),
                    new XElement(fpsNs + "Name",
                        new XElement(fpsNs + "Fore", fore),
                        new XElement(fpsNs + "Sur",  sur)
                    )
                );

                var employment = new XElement(fpsNs + "Employment",
                    new XElement(fpsNs + "PayId",              payId++),
                    new XElement(fpsNs + "TaxCode",            taxCode),
                    new XElement(fpsNs + "TaxCodeBasedPeriod", "Cumulative"),
                    new XElement(fpsNs + "NICat",              niCat),
                    new XElement(fpsNs + "BacsHashCode"),
                    new XElement(fpsNs + "PayFreq",            "M1"),
                    new XElement(fpsNs + "EmpPayeRef",         (settings.EmployerPAYEReference ?? "").Replace(" ", "")),
                    new XElement(fpsNs + "OccPenInd",          "false"),
                    payment
                );

                employeeElements.Add(new XElement(fpsNs + "Employee",
                    employeeDetails,
                    employment
                ));
            }

            var fpsRoot = new XElement(fpsNs + "FullPaymentSubmission",
                new XAttribute("xmlns",                     fpsNs),
                new XAttribute(XNamespace.Xmlns + "xsi",   xsiNs),
                new XElement(fpsNs + "EmpRefs",
                    new XElement(fpsNs + "OfficeNum", officeNum),
                    new XElement(fpsNs + "PayeRef",   payeRef),
                    new XElement(fpsNs + "AORef",     aoRef)
                ),
                employeeElements
            );

            // ── GovTalk envelope ──────────────────────────────────────────────
            var govTalk = new XDocument(
                new XDeclaration("1.0", "UTF-8", "yes"),
                new XElement(gtkNs + "GovTalkMessage",
                    new XAttribute("xmlns",                     gtkNs),
                    new XAttribute(XNamespace.Xmlns + "xsi",   xsiNs),
                    new XElement(gtkNs + "EnvelopeVersion", "2.0"),
                    new XElement(gtkNs + "Header",
                        new XElement(gtkNs + "MessageDetails",
                            new XElement(gtkNs + "Class",         "HMRC-PAYE-RTI-FPS"),
                            new XElement(gtkNs + "Qualifier",     "request"),
                            new XElement(gtkNs + "Function",      "submit"),
                            new XElement(gtkNs + "TransactionID", transId),
                            new XElement(gtkNs + "CorrelationID"),
                            new XElement(gtkNs + "Transformation","XML")
                        ),
                        new XElement(gtkNs + "SenderDetails",
                            new XElement(gtkNs + "IDAuthentication",
                                new XElement(gtkNs + "SenderID", gatewayUserId),
                                new XElement(gtkNs + "Authentication",
                                    new XElement(gtkNs + "Method", "clear"),
                                    new XElement(gtkNs + "Role",   "principal"),
                                    new XElement(gtkNs + "Value",  gatewayPassword)
                                )
                            )
                        )
                    ),
                    new XElement(gtkNs + "GovTalkDetails",
                        new XElement(gtkNs + "Keys",
                            new XElement(gtkNs + "Key",
                                new XAttribute("Type", "TaxOfficeNumber"),
                                officeNum),
                            new XElement(gtkNs + "Key",
                                new XAttribute("Type", "TaxOfficeReference"),
                                payeRef)
                        ),
                        new XElement(gtkNs + "ChannelRouting",
                            new XElement(gtkNs + "Channel",
                                new XElement(gtkNs + "URI",     "974"),
                                new XElement(gtkNs + "Product", SOFTWARE_NAME),
                                new XElement(gtkNs + "Version", SOFTWARE_VERSION)
                            )
                        )
                    ),
                    new XElement(gtkNs + "Body", fpsRoot)
                )
            );

            return govTalk.Declaration + "\n" + govTalk.Root?.ToString(SaveOptions.None);
        }

        // ── NI band helper ────────────────────────────────────────────────────

        /// <summary>
        /// Approximate YTD NI band figures from cumulative gross and tax month.
        /// Returns (AtLEL, LELtoPT, PTtoUEL) rounded to 2 decimal places.
        /// </summary>
        private static (decimal atLEL, decimal lelToPT, decimal ptToUEL) CalcNiBands(decimal ytdGross, int taxMonth, PayrollTaxYearRates rates)
        {
            var maxLEL = taxMonth * rates.LowerEarningsLimitMonthly;
            var maxPT  = taxMonth * rates.PrimaryThresholdMonthly;
            var maxUEL = taxMonth * rates.UpperEarningsLimitMonthly;

            var atLEL   = Math.Round(Math.Min(ytdGross, maxLEL), 2);
            var lelToPT = Math.Round(Math.Max(0m, Math.Min(ytdGross, maxPT)  - atLEL),          2);
            var ptToUEL = Math.Round(Math.Max(0m, Math.Min(ytdGross, maxUEL) - atLEL - lelToPT), 2);

            return (atLEL, lelToPT, ptToUEL);
        }

        private static (string fore, string sur) SplitName(string fullName)
        {
            var parts = fullName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return parts.Length switch
            {
                0 => ("Unknown", "Unknown"),
                1 => (parts[0], parts[0]),
                _ => (string.Join(" ", parts[..^1]), parts[^1])
            };
        }

        private static string Fmt(decimal v) => v.ToString("0.00");

        // ── Response parser ───────────────────────────────────────────────────

        private static FpsSubmissionResult ParseGovTalkResponse(string rawXml, bool httpSuccess)
        {
            if (string.IsNullOrWhiteSpace(rawXml))
                return new FpsSubmissionResult(httpSuccess, null,
                    httpSuccess ? "Submitted (no response body)" : "Empty response from HMRC", rawXml);

            try
            {
                var doc    = XDocument.Parse(rawXml);
                var ns     = XNamespace.Get("http://www.govtalk.gov.uk/CM/envelope");
                var msgDet = doc.Descendants(ns + "MessageDetails").FirstOrDefault();
                var qual   = msgDet?.Element(ns + "Qualifier")?.Value;
                var corrId = msgDet?.Element(ns + "CorrelationID")?.Value;

                // Extract any error elements
                var errors = doc.Descendants(ns + "Error").ToList();
                if (errors.Count > 0)
                {
                    var msgs = string.Join("; ", errors.Select(err =>
                        err.Element(ns + "Text")?.Value ?? err.ToString()));
                    return new FpsSubmissionResult(false, corrId, $"HMRC error: {msgs}", rawXml);
                }

                bool success = qual is "acknowledgement" or "response" || httpSuccess;
                var message  = qual switch
                {
                    "acknowledgement" => "FPS accepted by HMRC ✓",
                    "response"        => "FPS response received from HMRC",
                    _                 => $"HMRC qualifier: {qual ?? "unknown"}"
                };
                return new FpsSubmissionResult(success, corrId, message, rawXml);
            }
            catch
            {
                var preview = rawXml.Length > 300 ? rawXml[..300] + "…" : rawXml;
                return new FpsSubmissionResult(httpSuccess, null, $"Raw response: {preview}", rawXml);
            }
        }
    }

    /// <summary>Result from an FPS GovTalk submission.</summary>
    public record FpsSubmissionResult(
        bool    Success,
        string? CorrelationId,
        string? Message,
        string? RawResponse
    );
}
