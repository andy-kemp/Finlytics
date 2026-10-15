using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;

namespace FinanceHubFunctions.Functions
{
    public class HmrcFunctions
    {
        private readonly ILogger<HmrcFunctions> _logger;
        private readonly HmrcService _hmrcService;
        private readonly FinanceHubDbContext _dbContext;

        public HmrcFunctions(
            ILogger<HmrcFunctions> logger,
            HmrcService hmrcService,
            FinanceHubDbContext dbContext)
        {
            _logger = logger;
            _hmrcService = hmrcService;
            _dbContext = dbContext;
        }

        // ── OAuth ─────────────────────────────────────────────────────────────

        // Frontend origins HMRC may return to; override with comma-separated FrontendOrigins app setting
        private static string[] FrontendOrigins() =>
            (Environment.GetEnvironmentVariable("FrontendOrigins")
                ?? "https://finhub.andykemp.cloud,https://zealous-desert-06b17b603.2.azurestaticapps.net")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        /// <summary>
        /// Returns the HMRC OAuth authorization URL.
        /// The frontend opens this URL so the user can log in to Government Gateway.
        /// Query param: swaUrl – the SWA base URL to redirect back to after auth.
        /// </summary>
        [Function("HmrcAuthorize")]
        public async Task<HttpResponseData> HmrcAuthorize(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hmrc/authorize")] HttpRequestData req)
        {
            var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);

            // Signed state carries the (allow-listed) frontend origin so the callback knows where to return
            var state = _hmrcService.CreateOAuthState(OAuthState.SafeOrigin(query["swaUrl"], FrontendOrigins()));

            var authUrl = _hmrcService.GetAuthorizationUrl(state);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { url = authUrl });
            return response;
        }

        /// <summary>
        /// HMRC redirects here after user grants access.
        /// Exchanges the code for tokens and redirects the browser back to the SWA.
        /// Register this URI in HMRC Developer Hub:
        ///   https://financehub-func-kemponline.azurewebsites.net/api/hmrc/callback
        /// </summary>
        [Function("HmrcCallback")]
        public async Task<HttpResponseData> HmrcCallback(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hmrc/callback")] HttpRequestData req)
        {
            var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var code     = query["code"];
            var stateRaw = query["state"] ?? "";
            var error    = query["error"];

            // Only accept callbacks for flows started by the owner; never redirect off the allow-list
            var stateOrigin = _hmrcService.VerifyOAuthState(stateRaw);
            var swaUrl = OAuthState.SafeOrigin(stateOrigin, FrontendOrigins());
            if (stateOrigin == null)
            {
                _logger.LogWarning("HMRC callback rejected: invalid or expired state");
                var invalid = req.CreateResponse(HttpStatusCode.Found);
                invalid.Headers.Add("Location", $"{swaUrl}/#hmrc-error=invalid_state");
                return invalid;
            }

            if (!string.IsNullOrEmpty(error) || string.IsNullOrEmpty(code))
            {
                _logger.LogWarning("HMRC OAuth error: {Error}", error);
                var fail = req.CreateResponse(HttpStatusCode.Found);
                fail.Headers.Add("Location", $"{swaUrl.TrimEnd('/')}/#hmrc-error={Uri.EscapeDataString(error ?? "cancelled")}");
                return fail;
            }

            try
            {
                await _hmrcService.ExchangeCodeAsync(code);
                _logger.LogInformation("HMRC OAuth tokens stored successfully");
                var ok = req.CreateResponse(HttpStatusCode.Found);
                ok.Headers.Add("Location", $"{swaUrl.TrimEnd('/')}/#hmrc-connected");
                return ok;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "HMRC token exchange failed");
                var fail = req.CreateResponse(HttpStatusCode.Found);
                fail.Headers.Add("Location", $"{swaUrl.TrimEnd('/')}/#hmrc-error={Uri.EscapeDataString("token_exchange_failed")}");
                return fail;
            }
        }

        // ── Status & Disconnect ───────────────────────────────────────────────

        [Function("HmrcStatus")]
        public async Task<HttpResponseData> HmrcStatus(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hmrc/status")] HttpRequestData req)
        {
            var connected = await _hmrcService.IsConnectedAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { connected });
            return response;
        }

        [Function("HmrcDisconnect")]
        public async Task<HttpResponseData> HmrcDisconnect(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "hmrc/token")] HttpRequestData req)
        {
            await _hmrcService.DisconnectAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { success = true });
            return response;
        }

        // ── VAT API ───────────────────────────────────────────────────────────

        /// <summary>
        /// Fetches open VAT obligations from HMRC for your VRN.
        /// Returns the obligations array from HMRC (status=O means open/unfiled).
        /// </summary>
        [Function("HmrcVatObligations")]
        public async Task<HttpResponseData> HmrcVatObligations(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hmrc/vat/obligations")] HttpRequestData req)
        {
            var settings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
            var vrn = settings?.VATNumber ?? settings?.VatRegistrationNumber;

            if (string.IsNullOrWhiteSpace(vrn))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "VAT registration number not configured in Company Settings" });
                return bad;
            }

            try
            {
                var from = DateTime.UtcNow.AddYears(-6);
                var to   = DateTime.UtcNow.AddDays(90);
                var result = await _hmrcService.GetVatObligationsAsync(vrn, from, to);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "HMRC obligations request failed");
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }

        /// <summary>
        /// Submits a VAT return directly to HMRC MTD.
        /// The frontend calculates the figures; this function sends them to HMRC.
        /// </summary>
        [Function("HmrcSubmitVatReturn")]
        public async Task<HttpResponseData> HmrcSubmitVatReturn(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "hmrc/vat/submit")] HttpRequestData req)
        {
            var settings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
            var vrn = settings?.VATNumber ?? settings?.VatRegistrationNumber;

            if (string.IsNullOrWhiteSpace(vrn))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "VAT registration number not configured" });
                return bad;
            }

            HmrcVatSubmission? submission;
            try
            {
                submission = await req.ReadFromJsonAsync<HmrcVatSubmission>();
            }
            catch
            {
                submission = null;
            }

            if (submission == null || string.IsNullOrEmpty(submission.PeriodKey))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid submission — periodKey is required" });
                return bad;
            }

            try
            {
                _logger.LogInformation("Submitting VAT return to HMRC for VRN {Vrn}, period {Period}",
                    vrn, submission.PeriodKey);
                var result = await _hmrcService.SubmitVatReturnAsync(vrn, submission);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "HMRC VAT submission failed");

                // Try to extract a clean HMRC error code from the exception message
                // HMRC errors look like: "HMRC VAT submission failed (422): {\"code\":\"DUPLICATE_SUBMISSION\",...}"
                var msg = ex.Message;
                try
                {
                    var jsonStart = msg.IndexOf('{');
                    if (jsonStart >= 0)
                    {
                        var jsonPart = msg[jsonStart..];
                        var hmrcError = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(jsonPart);
                        var code = hmrcError.TryGetProperty("code", out var c) ? c.GetString() : null;
                        var errors = hmrcError.TryGetProperty("errors", out var e)
                            ? string.Join("; ", e.EnumerateArray()
                                .Select(x => x.TryGetProperty("message", out var m) ? m.GetString() : null)
                                .Where(x => x != null))
                            : null;
                        msg = code != null
                            ? $"{code}{(errors != null ? ": " + errors : "")}"
                            : msg;
                    }
                }
                catch { /* use original message */ }

                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = msg });
                return error;
            }
        }

        /// <summary>
        /// Retrieves a previously submitted VAT return from HMRC.
        /// Useful for verifying sandbox submissions.
        /// GET /api/hmrc/vat/return/{periodKey}
        /// </summary>
        [Function("HmrcViewVatReturn")]
        public async Task<HttpResponseData> HmrcViewVatReturn(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "hmrc/vat/return/{periodKey}")] HttpRequestData req,
            string periodKey)
        {
            var settings = await _dbContext.CompanySettings.FirstOrDefaultAsync();
            var vrn = settings?.VATNumber ?? settings?.VatRegistrationNumber;

            if (string.IsNullOrWhiteSpace(vrn))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "VAT registration number not configured" });
                return bad;
            }

            try
            {
                var result = await _hmrcService.ViewVatReturnAsync(vrn, periodKey);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "HMRC view VAT return failed");
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message });
                return error;
            }
        }
    }
}
