#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Services;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    public class MonzoFunctions
    {
        private const string RedirectUri = "https://financehub-func-kemponline.azurewebsites.net/api/monzo/callback";
        private const string FrontendBankingUrl = "https://finhub.andykemp.cloud/banking";
        private readonly ILogger<MonzoFunctions> _logger;
        private readonly MonzoClient _monzo;
        private readonly MonzoSyncService _sync;
        private readonly FinanceHubDbContext _db;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly EmailService _email;

        public MonzoFunctions(ILogger<MonzoFunctions> logger, MonzoClient monzo, MonzoSyncService sync,
            FinanceHubDbContext db, IHttpClientFactory httpClientFactory, EmailService email)
        {
            _logger = logger;
            _monzo = monzo;
            _sync = sync;
            _db = db;
            _httpClientFactory = httpClientFactory;
            _email = email;
        }

        private static async Task<HttpResponseData> Json(HttpRequestData req, HttpStatusCode status, object value)
        {
            var response = req.CreateResponse(status);
            await response.WriteAsJsonAsync(value, status);
            return response;
        }

        private static HttpResponseData Redirect(HttpRequestData req, string query)
        {
            var response = req.CreateResponse(HttpStatusCode.Redirect);
            response.Headers.Add("Location", $"{FrontendBankingUrl}?{query}");
            return response;
        }

        [Function("MonzoStartAuth")]
        public async Task<HttpResponseData> StartAuth(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "monzo/auth")] HttpRequestData req)
        {
            if (string.IsNullOrEmpty(MonzoClient.ClientId) || string.IsNullOrEmpty(MonzoClient.ClientSecret))
                return await Json(req, HttpStatusCode.BadRequest, new { error = "Monzo OAuth client not configured" });
            var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            var state = MonzoSyncPolicy.SignState(MonzoClient.ClientSecret!, DateTime.UtcNow.AddMinutes(15), nonce);
            var authUrl = $"https://auth.monzo.com/?client_id={Uri.EscapeDataString(MonzoClient.ClientId!)}&redirect_uri={Uri.EscapeDataString(RedirectUri)}&response_type=code&state={Uri.EscapeDataString(state)}";
            return await Json(req, HttpStatusCode.OK, new { authUrl });
        }

        [Function("MonzoCallback")]
        public async Task<HttpResponseData> HandleCallback(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "monzo/callback")] HttpRequestData req)
        {
            var query = QueryHelpers.ParseQuery(req.Url.Query);
            var code = query.TryGetValue("code", out var c) ? c.ToString() : null;
            var state = query.TryGetValue("state", out var s) ? s.ToString() : null;
            if (query.ContainsKey("error") || string.IsNullOrEmpty(code))
                return Redirect(req, "monzo_error=cancelled");
            if (string.IsNullOrEmpty(MonzoClient.ClientSecret) || !MonzoSyncPolicy.VerifyState(MonzoClient.ClientSecret!, state, DateTime.UtcNow))
            {
                _logger.LogWarning("Monzo callback rejected: invalid or expired state");
                return Redirect(req, "monzo_error=invalid_state");
            }
            try
            {
                var response = await _httpClientFactory.CreateClient().PostAsync($"{MonzoClient.ApiBase}/oauth2/token",
                    new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        ["grant_type"] = "authorization_code", ["client_id"] = MonzoClient.ClientId!,
                        ["client_secret"] = MonzoClient.ClientSecret!, ["redirect_uri"] = RedirectUri, ["code"] = code
                    }));
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("Monzo token exchange failed with {Status}", (int)response.StatusCode);
                    return Redirect(req, "monzo_error=token_exchange_failed");
                }
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                var refresh = document.RootElement.TryGetProperty("refresh_token", out var r) ? r.GetString() : null;
                await _monzo.StoreTokens(document.RootElement, newConnection: true);
                return Redirect(req, $"monzo_connected=true&refresh={(string.IsNullOrEmpty(refresh) ? "missing" : "ok")}");
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Monzo OAuth callback error");
                return Redirect(req, "monzo_error=callback_failed");
            }
        }

        [Function("MonzoGetStatus")]
        public async Task<HttpResponseData> GetStatus(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "monzo/status")] HttpRequestData req)
        {
            var account = (await _db.BankAccounts.AsNoTracking().ToListAsync()).FirstOrDefault(item => item.IsActive && item.Currency == "GBP");
            var configured = !string.IsNullOrEmpty(MonzoClient.ClientId) && !string.IsNullOrEmpty(MonzoClient.ClientSecret);
            try
            {
                using var whoami = await _monzo.Get("/ping/whoami");
                var authenticated = whoami.RootElement.TryGetProperty("authenticated", out var flag) && flag.GetBoolean();
                var canRefresh = await _monzo.HasRefreshToken();
                var accessExpiresAtUtc = await _monzo.AccessExpiresAtUtc();
                return await Json(req, HttpStatusCode.OK, new
                {
                    configured, connected = authenticated, needsReconnect = !authenticated,
                    canRefresh, accessExpiresAtUtc, expiryWarning = MonzoConnectionPolicy.Warn(canRefresh, accessExpiresAtUtc, DateTime.UtcNow),
                    lastSyncedAt = account?.MonzoLastSyncedAt
                });
            }
            catch (MonzoReconnectRequiredException exception)
            {
                return await Json(req, HttpStatusCode.OK, new
                {
                    configured, connected = false, needsReconnect = true, message = exception.Message,
                    canRefresh = await _monzo.HasRefreshToken(), accessExpiresAtUtc = await _monzo.AccessExpiresAtUtc(),
                    lastSyncedAt = account?.MonzoLastSyncedAt
                });
            }
        }

        [Function("MonzoSync")]
        public async Task<HttpResponseData> SyncTransactions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "monzo/sync")] HttpRequestData req)
        {
            try
            {
                return await Json(req, HttpStatusCode.OK, await _sync.Sync());
            }
            catch (MonzoReconnectRequiredException exception)
            {
                return await Json(req, HttpStatusCode.Conflict, new { error = exception.Message, needsReconnect = true });
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Monzo sync failed");
                return await Json(req, HttpStatusCode.ServiceUnavailable, new { error = "Monzo sync failed; nothing was partially saved. Try again later." });
            }
        }

        [Function("MonzoDailySync")]
        public async Task DailySync([TimerTrigger("0 30 5 * * *")] TimerInfo timer)
        {
            try
            {
                var result = await _sync.Sync();
                _logger.LogInformation("Monzo daily sync: {Imported} imported, {Linked} linked, {Interest} interest entries",
                    result.Imported, result.Linked, result.InterestRecorded.Count);
                await NotifyReconnect(false);
            }
            catch (MonzoReconnectRequiredException exception)
            {
                _logger.LogWarning("Monzo daily sync skipped: {Message}", exception.Message);
                await NotifyReconnect(true);
            }
        }

        private async Task NotifyReconnect(bool needsReconnect)
        {
            try
            {
                if (!await _db.BankAccounts.AnyAsync(account => account.MonzoLastSyncedAt != null)) return;
                var expiresAt = await _monzo.AccessExpiresAtUtc();
                if (!MonzoConnectionPolicy.EmailDue(await _monzo.HasRefreshToken(), expiresAt, needsReconnect, DateTime.UtcNow)
                    || await _monzo.ReconnectNotified()) return;
                var company = await _db.CompanySettings.AsNoTracking().OrderBy(settings => settings.Id).FirstOrDefaultAsync();
                var recipient = Environment.GetEnvironmentVariable("MonzoNotificationEmail") ?? company?.CompanyEmail ?? company?.Email;
                if (string.IsNullOrWhiteSpace(recipient))
                {
                    _logger.LogWarning("Monzo reconnect notification has no configured recipient");
                    return;
                }
                var subject = needsReconnect ? "Finlytics: Monzo needs reconnecting" : "Finlytics: Monzo access is expiring";
                var detail = needsReconnect ? "The daily bank sync cannot renew Monzo access."
                    : $"Monzo access expires at {expiresAt:dd MMM yyyy HH:mm} UTC and no refresh token is available.";
                var (success, error) = await _email.SendSystemEmailAsync(recipient, subject,
                    $"<p>{detail}</p><p><a href=\"{FrontendBankingUrl}\">Open Banking in Finlytics</a>, reconnect Monzo and approve access in the Monzo app. Existing transactions are kept.</p>");
                if (success) await _monzo.SaveSecret("MonzoReconnectNotifiedAtUtc", DateTime.UtcNow.ToString("O"));
                else _logger.LogWarning("Monzo reconnect email failed: {Error}", error);
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Monzo reconnect notification failed; it will be retried on the next daily sync");
            }
        }
    }
}
