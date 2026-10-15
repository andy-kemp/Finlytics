using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Services
{
    /// <summary>
    /// Handles all HMRC MTD OAuth 2.0 and API interactions.
    ///
    /// Required Azure App Settings:
    ///   HmrcClientId      – from HMRC Developer Hub application
    ///   HmrcClientSecret  – from HMRC Developer Hub application
    ///   HmrcRedirectUri   – must match HMRC Developer Hub registered URI
    ///                       e.g. https://financehub-func-kemponline.azurewebsites.net/api/hmrc/callback
    ///   HmrcUseSandbox    – "true" for test environment, "false" for production
    /// </summary>
    public class HmrcService
    {
        private readonly HttpClient _http;
        private readonly FinanceHubDbContext _db;
        private readonly string _clientId;
        private readonly string _clientSecret;
        private readonly string _redirectUri;
        private readonly string _baseUrl;
        private readonly bool _useSandbox;

        public HmrcService(IHttpClientFactory httpClientFactory, FinanceHubDbContext db, IConfiguration config)
        {
            _http = httpClientFactory.CreateClient("hmrc");
            _db = db;
            _clientId     = config["HmrcClientId"] ?? "";
            _clientSecret = config["HmrcClientSecret"] ?? "";
            _redirectUri  = config["HmrcRedirectUri"] ?? "";
            _useSandbox = string.Equals(config["HmrcUseSandbox"], "true", StringComparison.OrdinalIgnoreCase);
            _baseUrl = _useSandbox
                ? "https://test-api.service.hmrc.gov.uk"
                : "https://api.service.hmrc.gov.uk";
        }

        /// <summary>Returns the HMRC OAuth authorization URL. Open this in the user's browser.</summary>
        public string GetAuthorizationUrl(string state)
        {
            var scope = Uri.EscapeDataString("read:vat write:vat");
            return $"{_baseUrl}/oauth/authorize" +
                   $"?response_type=code" +
                   $"&client_id={Uri.EscapeDataString(_clientId)}" +
                   $"&scope={scope}" +
                   $"&redirect_uri={Uri.EscapeDataString(_redirectUri)}" +
                   $"&state={Uri.EscapeDataString(state)}";
        }

        /// <summary>Signed, expiring OAuth state carrying the frontend origin to return to.</summary>
        public string CreateOAuthState(string returnOrigin) => OAuthState.Create(_clientSecret, DateTime.UtcNow, returnOrigin);

        /// <summary>Returns the origin stored in a valid state, or null if the state is invalid or expired.</summary>
        public string? VerifyOAuthState(string? state) => OAuthState.Verify(_clientSecret, state, DateTime.UtcNow);

        /// <summary>Exchanges authorization code for tokens and persists them to the DB.</summary>
        public async Task<HmrcToken> ExchangeCodeAsync(string code)
        {
            var form = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("client_id",     _clientId),
                new KeyValuePair<string, string>("client_secret", _clientSecret),
                new KeyValuePair<string, string>("code",          code),
                new KeyValuePair<string, string>("grant_type",    "authorization_code"),
                new KeyValuePair<string, string>("redirect_uri",  _redirectUri)
            });

            var resp = await _http.PostAsync($"{_baseUrl}/oauth/token", form);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"HMRC token exchange failed ({resp.StatusCode}): {body}");

            return await SaveTokenFromResponse(body);
        }

        /// <summary>
        /// Returns a valid access token, refreshing if expired.
        /// Returns null if no token is stored or refresh fails.
        /// </summary>
        public async Task<string?> GetValidTokenAsync()
        {
            var token = await _db.HmrcTokens.FirstOrDefaultAsync();
            if (token == null) return null;

            // Token still valid (with 60-second buffer)?
            if (token.ExpiresAt > DateTime.UtcNow.AddSeconds(60))
                return token.AccessToken;

            // Attempt refresh
            if (string.IsNullOrEmpty(token.RefreshToken)) return null;

            var form = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("client_id",     _clientId),
                new KeyValuePair<string, string>("client_secret", _clientSecret),
                new KeyValuePair<string, string>("refresh_token", token.RefreshToken),
                new KeyValuePair<string, string>("grant_type",    "refresh_token")
            });

            var resp = await _http.PostAsync($"{_baseUrl}/oauth/token", form);
            if (!resp.IsSuccessStatusCode) return null;

            var body = await resp.Content.ReadAsStringAsync();
            var refreshed = await SaveTokenFromResponse(body, token);
            return refreshed.AccessToken;
        }

        public async Task<bool> IsConnectedAsync()
        {
            var token = await _db.HmrcTokens.FirstOrDefaultAsync();
            return token != null && !string.IsNullOrEmpty(token.AccessToken);
        }

        public async Task DisconnectAsync()
        {
            var tokens = await _db.HmrcTokens.ToListAsync();
            _db.HmrcTokens.RemoveRange(tokens);
            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// GET /organisations/vat/{vrn}/obligations
        /// status: "O" = open (not yet filed), "F" = fulfilled
        /// </summary>
        public async Task<JsonElement?> GetVatObligationsAsync(string vrn, DateTime from, DateTime to, string status = "O")
        {
            var accessToken = await GetValidTokenAsync()
                ?? throw new InvalidOperationException("Not connected to HMRC");

            var cleanVrn = vrn.TrimStart('G', 'g', 'B', 'b').Trim();
            var url = $"{_baseUrl}/organisations/vat/{cleanVrn}/obligations" +
                      $"?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}&status={status}";

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            req.Headers.Add("Accept", "application/vnd.hmrc.1.0+json");

            var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"HMRC obligations request failed ({resp.StatusCode}): {body}");

            var result = JsonSerializer.Deserialize<JsonElement>(body);

            // Sandbox fallback: if the stateful call returns zero obligations, retry with the
            // QUARTERLY_NONE_MET test scenario so the developer can test the full submission flow.
            if (_useSandbox &&
                result.TryGetProperty("obligations", out var obsEl) &&
                obsEl.ValueKind == JsonValueKind.Array &&
                obsEl.GetArrayLength() == 0)
            {
                using var fallbackReq = new HttpRequestMessage(HttpMethod.Get, url);
                fallbackReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                fallbackReq.Headers.Add("Accept", "application/vnd.hmrc.1.0+json");
                fallbackReq.Headers.Add("Gov-Test-Scenario", "QUARTERLY_NONE_MET");
                var fallbackResp = await _http.SendAsync(fallbackReq);
                if (fallbackResp.IsSuccessStatusCode)
                {
                    var fallbackBody = await fallbackResp.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<JsonElement>(fallbackBody);
                }
            }

            return result;
        }

        /// <summary>POST /organisations/vat/{vrn}/returns</summary>
        public async Task<JsonElement?> SubmitVatReturnAsync(string vrn, HmrcVatSubmission submission)
        {
            var accessToken = await GetValidTokenAsync()
                ?? throw new InvalidOperationException("Not connected to HMRC");

            var cleanVrn = vrn.TrimStart('G', 'g', 'B', 'b').Trim();
            var url = $"{_baseUrl}/organisations/vat/{cleanVrn}/returns";

            // HMRC requires camelCase JSON
            var json = JsonSerializer.Serialize(submission, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            req.Headers.Add("Accept", "application/vnd.hmrc.1.0+json");
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");

            var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"HMRC VAT submission failed ({resp.StatusCode}): {body}");

            return JsonSerializer.Deserialize<JsonElement>(body);
        }

        /// <summary>GET /organisations/vat/{vrn}/returns/{periodKey}</summary>
        public async Task<JsonElement?> ViewVatReturnAsync(string vrn, string periodKey)
        {
            var accessToken = await GetValidTokenAsync()
                ?? throw new InvalidOperationException("Not connected to HMRC");

            var cleanVrn = vrn.TrimStart('G', 'g', 'B', 'b').Trim();
            var encodedKey = Uri.EscapeDataString(periodKey);
            var url = $"{_baseUrl}/organisations/vat/{cleanVrn}/returns/{encodedKey}";

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            req.Headers.Add("Accept", "application/vnd.hmrc.1.0+json");

            var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"HMRC view return failed ({resp.StatusCode}): {body}");

            return JsonSerializer.Deserialize<JsonElement>(body);
        }

        // ── Private helpers ──────────────────────────────────────────────────

        private async Task<HmrcToken> SaveTokenFromResponse(string responseBody, HmrcToken? existing = null)
        {
            var tokenData = JsonSerializer.Deserialize<JsonElement>(responseBody);

            var accessToken = tokenData.GetProperty("access_token").GetString() ?? "";
            var refreshToken = tokenData.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null;
            var expiresIn = tokenData.TryGetProperty("expires_in", out var exp) ? exp.GetInt32() : 14400;
            var scope = tokenData.TryGetProperty("scope", out var sc) ? sc.GetString() : null;

            var token = existing ?? await _db.HmrcTokens.FirstOrDefaultAsync();
            var isNew = token == null;
            token ??= new HmrcToken { CreatedAt = DateTime.UtcNow };

            token.AccessToken  = accessToken;
            token.RefreshToken = refreshToken ?? token.RefreshToken;
            token.ExpiresAt    = DateTime.UtcNow.AddSeconds(expiresIn - 60);
            token.Scope        = scope ?? token.Scope;
            token.UpdatedAt    = isNew ? null : DateTime.UtcNow;

            if (isNew)
            {
                token.CreatedAt = DateTime.UtcNow;
                _db.HmrcTokens.Add(token);
            }

            await _db.SaveChangesAsync();
            return token;
        }
    }
}
