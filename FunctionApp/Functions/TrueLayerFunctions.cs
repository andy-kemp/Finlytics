using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    public class TrueLayerFunctions
    {
        private readonly ILogger<TrueLayerFunctions> _logger;
        private readonly IBankAccountRepository _bankAccountRepository;
        private readonly IBankTransactionRepository _bankTransactionRepository;
        private readonly ICategorizationRuleRepository _categorizationRuleRepository;
        private readonly IHttpClientFactory _httpClientFactory;

        // TrueLayer sandbox URLs
        private const string TrueLayerAuthUrl = "https://auth.truelayer-sandbox.com";
        private const string TrueLayerApiUrl = "https://api.truelayer-sandbox.com";
        private const string RedirectUri = "https://financehub-func-kemponline.azurewebsites.net/api/truelayer/callback";
        private const string FrontendBankingUrl = "https://finhub.andykemp.cloud/banking";

        public TrueLayerFunctions(
            ILogger<TrueLayerFunctions> logger,
            IBankAccountRepository bankAccountRepository,
            IBankTransactionRepository bankTransactionRepository,
            ICategorizationRuleRepository categorizationRuleRepository,
            IHttpClientFactory httpClientFactory)
        {
            _logger = logger;
            _bankAccountRepository = bankAccountRepository;
            _bankTransactionRepository = bankTransactionRepository;
            _categorizationRuleRepository = categorizationRuleRepository;
            _httpClientFactory = httpClientFactory;
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  GET /api/truelayer/auth — Start TrueLayer OAuth flow
        // ═══════════════════════════════════════════════════════════════════════
        [Function("TrueLayerStartAuth")]
        public async Task<HttpResponseData> StartAuth(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "truelayer/auth")] HttpRequestData req)
        {
            var clientId = Environment.GetEnvironmentVariable("TrueLayerClientId");
            if (string.IsNullOrEmpty(clientId))
            {
                var err = req.CreateResponse(HttpStatusCode.BadRequest);
                await err.WriteAsJsonAsync(new { error = "TrueLayer client not configured" });
                return err;
            }

            var clientSecret = Environment.GetEnvironmentVariable("TrueLayerClientSecret");
            if (string.IsNullOrEmpty(clientSecret))
            {
                var err = req.CreateResponse(HttpStatusCode.BadRequest);
                await err.WriteAsJsonAsync(new { error = "TrueLayer client not configured" });
                return err;
            }

            var state = Uri.EscapeDataString(OAuthState.Create(clientSecret, DateTime.UtcNow));
            var scopes = "info%20accounts%20balance%20transactions%20offline_access";
            var authUrl = $"{TrueLayerAuthUrl}/?response_type=code" +
                          $"&client_id={clientId}" +
                          $"&redirect_uri={Uri.EscapeDataString(RedirectUri)}" +
                          $"&scope={scopes}" +
                          $"&providers=uk-ob-all%20uk-oauth-all%20uk-cs-mock" +
                          $"&state={state}";

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { authUrl });
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  GET /api/truelayer/callback — OAuth callback (exchanges code for token)
        // ═══════════════════════════════════════════════════════════════════════
        [Function("TrueLayerCallback")]
        public async Task<HttpResponseData> HandleCallback(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "truelayer/callback")] HttpRequestData req)
        {
            try
            {
                var query = QueryHelpers.ParseQuery(req.Url.Query);
                var code = query.TryGetValue("code", out var c) ? c.ToString() : null;
                var error = query.TryGetValue("error", out var e) ? e.ToString() : null;

                if (!string.IsNullOrEmpty(error) || string.IsNullOrEmpty(code))
                {
                    var errResp = req.CreateResponse(HttpStatusCode.Redirect);
                    errResp.Headers.Add("Location", $"{FrontendBankingUrl}?truelayer_error={Uri.EscapeDataString(error ?? "cancelled")}");
                    return errResp;
                }

                var clientId = Environment.GetEnvironmentVariable("TrueLayerClientId");
                var clientSecret = Environment.GetEnvironmentVariable("TrueLayerClientSecret");
                var state = query.TryGetValue("state", out var s) ? s.ToString() : null;
                if (OAuthState.Verify(clientSecret ?? "", state, DateTime.UtcNow) == null)
                {
                    _logger.LogWarning("TrueLayer callback rejected: invalid or expired state");
                    var stateResp = req.CreateResponse(HttpStatusCode.Redirect);
                    stateResp.Headers.Add("Location", $"{FrontendBankingUrl}?truelayer_error=invalid_state");
                    return stateResp;
                }

                // Exchange code for access token
                var client = _httpClientFactory.CreateClient();
                var tokenResp = await client.PostAsync($"{TrueLayerAuthUrl}/connect/token",
                    new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        ["grant_type"] = "authorization_code",
                        ["client_id"] = clientId!,
                        ["client_secret"] = clientSecret!,
                        ["redirect_uri"] = RedirectUri,
                        ["code"] = code
                    }));

                if (!tokenResp.IsSuccessStatusCode)
                {
                    var detail = await tokenResp.Content.ReadAsStringAsync();
                    _logger.LogError("TrueLayer token exchange failed: {Status} {Detail}", tokenResp.StatusCode, detail);
                    var errResp = req.CreateResponse(HttpStatusCode.Redirect);
                    errResp.Headers.Add("Location", $"{FrontendBankingUrl}?truelayer_error={Uri.EscapeDataString("Token exchange failed")}");
                    return errResp;
                }

                var tokenJson = await tokenResp.Content.ReadAsStringAsync();
                using var tokenDoc = JsonDocument.Parse(tokenJson);
                var accessToken = tokenDoc.RootElement.GetProperty("access_token").GetString()!;
                var refreshToken = tokenDoc.RootElement.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null;

                // Persist tokens to Key Vault
                var keyVaultUri = Environment.GetEnvironmentVariable("KEY_VAULT_URL")
                    ?? Environment.GetEnvironmentVariable("KeyVaultUri");
                if (!string.IsNullOrEmpty(keyVaultUri))
                {
                    var credential = new DefaultAzureCredential();
                    var secretClient = new SecretClient(new Uri(keyVaultUri), credential);
                    await secretClient.SetSecretAsync("TrueLayerAccessToken", accessToken);
                    if (!string.IsNullOrEmpty(refreshToken))
                        await secretClient.SetSecretAsync("TrueLayerRefreshToken", refreshToken);
                }

                // Update in-process env vars immediately
                Environment.SetEnvironmentVariable("TrueLayerAccessToken", accessToken);
                if (!string.IsNullOrEmpty(refreshToken))
                    Environment.SetEnvironmentVariable("TrueLayerRefreshToken", refreshToken);

                // Fetch accounts from TrueLayer and create/update local bank accounts
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                var accountsResp = await client.GetAsync($"{TrueLayerApiUrl}/data/v1/accounts");
                if (accountsResp.IsSuccessStatusCode)
                {
                    var accountsJson = await accountsResp.Content.ReadAsStringAsync();
                    using var accountsDoc = JsonDocument.Parse(accountsJson);

                    if (accountsDoc.RootElement.TryGetProperty("results", out var results))
                    {
                        var existingAccounts = await _bankAccountRepository.GetAllAsync();
                        foreach (var acc in results.EnumerateArray())
                        {
                            var tlAccountId = acc.GetProperty("account_id").GetString();
                            var provider = acc.TryGetProperty("provider", out var prov)
                                ? (prov.TryGetProperty("display_name", out var dn) ? dn.GetString() : null)
                                : null;

                            var accNumber = acc.TryGetProperty("account_number", out var an)
                                ? (an.TryGetProperty("number", out var num) ? num.GetString() : null)
                                : null;
                            var sortCode = acc.TryGetProperty("account_number", out var sc)
                                ? (sc.TryGetProperty("sort_code", out var srt) ? srt.GetString() : null)
                                : null;

                            var existingAccount = existingAccounts.FirstOrDefault(a => a.TrueLayerAccountId == tlAccountId);
                            if (existingAccount != null)
                            {
                                existingAccount.TrueLayerConnected = true;
                                existingAccount.TrueLayerProvider = provider;
                                existingAccount.TrueLayerLastSyncedAt = DateTime.UtcNow;
                                existingAccount.ModifiedDate = DateTime.UtcNow;
                                await _bankAccountRepository.UpdateAsync(existingAccount);
                            }
                            else
                            {
                                var displayName = acc.TryGetProperty("display_name", out var dName)
                                    ? dName.GetString() : (provider ?? "Bank Account");
                                var currency = acc.TryGetProperty("currency", out var cur) ? cur.GetString() : "GBP";

                                await _bankAccountRepository.CreateAsync(new BankAccount
                                {
                                    AccountName = displayName,
                                    BankName = provider ?? "Unknown",
                                    SortCode = sortCode,
                                    AccountNumber = accNumber,
                                    Currency = currency,
                                    IsActive = true,
                                    TrueLayerAccountId = tlAccountId,
                                    TrueLayerConnected = true,
                                    TrueLayerProvider = provider,
                                    TrueLayerLastSyncedAt = DateTime.UtcNow,
                                    CreatedDate = DateTime.UtcNow,
                                    ModifiedDate = DateTime.UtcNow
                                });
                            }
                        }
                    }
                }

                var response = req.CreateResponse(HttpStatusCode.Redirect);
                response.Headers.Add("Location", $"{FrontendBankingUrl}?truelayer_connected=true");
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "TrueLayer OAuth callback error");
                var errResp = req.CreateResponse(HttpStatusCode.Redirect);
                errResp.Headers.Add("Location", $"{FrontendBankingUrl}?truelayer_error={Uri.EscapeDataString(ex.Message)}");
                return errResp;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  GET /api/truelayer/status — Check TrueLayer connection status
        // ═══════════════════════════════════════════════════════════════════════
        [Function("TrueLayerGetStatus")]
        public async Task<HttpResponseData> GetStatus(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "truelayer/status")] HttpRequestData req)
        {
            var accessToken = Environment.GetEnvironmentVariable("TrueLayerAccessToken");
            var connected = !string.IsNullOrEmpty(accessToken);
            var accounts = (await _bankAccountRepository.GetAllAsync())
                .Where(a => a.TrueLayerConnected)
                .ToList();

            decimal? totalBalance = null;
            bool tokenExpired = false;
            string? providerName = accounts.FirstOrDefault()?.TrueLayerProvider;

            if (connected)
            {
                try
                {
                    var client = _httpClientFactory.CreateClient();
                    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

                    // Fetch balance for first connected account
                    foreach (var account in accounts)
                    {
                        if (string.IsNullOrEmpty(account.TrueLayerAccountId)) continue;
                        var balResp = await client.GetAsync($"{TrueLayerApiUrl}/data/v1/accounts/{account.TrueLayerAccountId}/balance");
                        if (balResp.IsSuccessStatusCode)
                        {
                            var balJson = await balResp.Content.ReadAsStringAsync();
                            using var balDoc = JsonDocument.Parse(balJson);
                            if (balDoc.RootElement.TryGetProperty("results", out var results))
                            {
                                foreach (var bal in results.EnumerateArray())
                                {
                                    if (bal.TryGetProperty("current", out var cur))
                                    {
                                        totalBalance = (totalBalance ?? 0) + cur.GetDecimal();
                                    }
                                }
                            }
                        }
                        else if (balResp.StatusCode == HttpStatusCode.Unauthorized)
                        {
                            tokenExpired = true;
                            // Try refresh
                            var refreshed = await TryRefreshTokenAsync();
                            if (refreshed) tokenExpired = false;
                            break;
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Error checking TrueLayer status");
                }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                connected = connected && accounts.Count > 0,
                accountCount = accounts.Count,
                provider = providerName,
                balance = totalBalance,
                tokenExpired,
                lastSyncedAt = accounts.FirstOrDefault()?.TrueLayerLastSyncedAt
            });
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  POST /api/truelayer/sync — Sync transactions from TrueLayer
        // ═══════════════════════════════════════════════════════════════════════
        [Function("TrueLayerSync")]
        public async Task<HttpResponseData> SyncTransactions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "truelayer/sync")] HttpRequestData req)
        {
            var accessToken = Environment.GetEnvironmentVariable("TrueLayerAccessToken");
            if (string.IsNullOrEmpty(accessToken))
            {
                var err = req.CreateResponse(HttpStatusCode.BadRequest);
                await err.WriteAsJsonAsync(new { error = "TrueLayer not connected" });
                return err;
            }

            var accounts = (await _bankAccountRepository.GetAllAsync())
                .Where(a => a.TrueLayerConnected && !string.IsNullOrEmpty(a.TrueLayerAccountId))
                .ToList();

            if (accounts.Count == 0)
            {
                var err = req.CreateResponse(HttpStatusCode.BadRequest);
                await err.WriteAsJsonAsync(new { error = "No TrueLayer-connected bank accounts found" });
                return err;
            }

            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            int totalImported = 0;
            int totalSkipped = 0;

            foreach (var account in accounts)
            {
                try
                {
                    // Fetch transactions from the last 90 days
                    var from = DateTime.UtcNow.AddDays(-90).ToString("yyyy-MM-ddTHH:mm:ssZ");
                    var to = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
                    var url = $"{TrueLayerApiUrl}/data/v1/accounts/{account.TrueLayerAccountId}/transactions?from={from}&to={to}";

                    var txResp = await client.GetAsync(url);
                    if (txResp.StatusCode == HttpStatusCode.Unauthorized)
                    {
                        // Try refreshing the token
                        if (await TryRefreshTokenAsync())
                        {
                            accessToken = Environment.GetEnvironmentVariable("TrueLayerAccessToken");
                            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                            txResp = await client.GetAsync(url);
                        }
                    }

                    if (!txResp.IsSuccessStatusCode)
                    {
                        _logger.LogWarning("TrueLayer transactions fetch failed for account {AccountId}: {Status}",
                            account.TrueLayerAccountId, txResp.StatusCode);
                        continue;
                    }

                    var txJson = await txResp.Content.ReadAsStringAsync();
                    using var txDoc = JsonDocument.Parse(txJson);

                    if (!txDoc.RootElement.TryGetProperty("results", out var results)) continue;

                    // Get existing TrueLayer transaction IDs for this account to avoid duplicates
                    var existingTxns = await _bankTransactionRepository.GetByAccountIdAsync(account.Id);
                    var existingTlIds = new HashSet<string>(
                        existingTxns
                            .Where(t => !string.IsNullOrEmpty(t.TrueLayerTransactionId))
                            .Select(t => t.TrueLayerTransactionId!));

                    var newTransactions = new List<BankTransaction>();
                    foreach (var tx in results.EnumerateArray())
                    {
                        var tlTxId = tx.GetProperty("transaction_id").GetString()!;
                        if (existingTlIds.Contains(tlTxId))
                        {
                            totalSkipped++;
                            continue;
                        }

                        var amount = tx.GetProperty("amount").GetDecimal();
                        var description = tx.TryGetProperty("description", out var desc)
                            ? desc.GetString() : "";
                        var txDate = tx.TryGetProperty("timestamp", out var ts)
                            ? (DateTime?)DateTime.Parse(ts.GetString()!) : null;
                        var category = tx.TryGetProperty("transaction_category", out var cat)
                            ? cat.GetString() : null;
                        var merchant = tx.TryGetProperty("merchant_name", out var mn)
                            ? mn.GetString() : null;
                        var balance = tx.TryGetProperty("running_balance", out var rb)
                            ? (rb.TryGetProperty("amount", out var rba) ? (decimal?)rba.GetDecimal() : null)
                            : null;

                        newTransactions.Add(new BankTransaction
                        {
                            BankAccountId = account.Id,
                            TransactionDate = txDate,
                            Amount = Math.Abs(amount),
                            Description = description,
                            Reference = tlTxId,
                            Category = category,
                            Direction = amount >= 0 ? "In" : "Out",
                            Balance = balance,
                            ExternalId = tlTxId,
                            Source = "TrueLayer",
                            TrueLayerTransactionId = tlTxId,
                            TrueLayerMerchantName = merchant,
                            TrueLayerCategory = category,
                            CreatedDate = DateTime.UtcNow,
                            ModifiedDate = DateTime.UtcNow
                        });
                    }

                    if (newTransactions.Count > 0)
                    {
                        // Auto-categorise new transactions using categorization rules
                        var catRules = (await _categorizationRuleRepository.GetActiveAsync()).ToList();
                        if (catRules.Any())
                        {
                            foreach (var tx in newTransactions)
                            {
                                if (string.IsNullOrEmpty(tx.Category))
                                {
                                    var matched = CategorizationFunctions.ApplyRulesToTransaction(tx, catRules);
                                    if (matched != null)
                                    {
                                        tx.Category = matched;
                                    }
                                }
                            }
                        }

                        await _bankTransactionRepository.CreateManyAsync(newTransactions);
                        totalImported += newTransactions.Count;
                    }

                    // Update last synced
                    account.TrueLayerLastSyncedAt = DateTime.UtcNow;
                    account.ModifiedDate = DateTime.UtcNow;
                    await _bankAccountRepository.UpdateAsync(account);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error syncing TrueLayer account {AccountId}", account.TrueLayerAccountId);
                }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                success = true,
                imported = totalImported,
                skipped = totalSkipped,
                message = $"Synced {totalImported} new transactions ({totalSkipped} already existed)"
            });
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  POST /api/truelayer/disconnect — Disconnect TrueLayer
        // ═══════════════════════════════════════════════════════════════════════
        [Function("TrueLayerDisconnect")]
        public async Task<HttpResponseData> Disconnect(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "truelayer/disconnect")] HttpRequestData req)
        {
            // Clear tokens from environment
            Environment.SetEnvironmentVariable("TrueLayerAccessToken", null);
            Environment.SetEnvironmentVariable("TrueLayerRefreshToken", null);

            // Clear tokens from Key Vault
            var keyVaultUri = Environment.GetEnvironmentVariable("KEY_VAULT_URL")
                ?? Environment.GetEnvironmentVariable("KeyVaultUri");
            if (!string.IsNullOrEmpty(keyVaultUri))
            {
                try
                {
                    var credential = new DefaultAzureCredential();
                    var secretClient = new SecretClient(new Uri(keyVaultUri), credential);
                    await secretClient.StartDeleteSecretAsync("TrueLayerAccessToken");
                    await secretClient.StartDeleteSecretAsync("TrueLayerRefreshToken");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Error clearing TrueLayer secrets from Key Vault");
                }
            }

            // Update bank accounts to disconnected
            var accounts = (await _bankAccountRepository.GetAllAsync())
                .Where(a => a.TrueLayerConnected)
                .ToList();
            foreach (var account in accounts)
            {
                account.TrueLayerConnected = false;
                account.ModifiedDate = DateTime.UtcNow;
                await _bankAccountRepository.UpdateAsync(account);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { success = true, message = "TrueLayer disconnected" });
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════
        //  Helper: Refresh TrueLayer access token using refresh token
        // ═══════════════════════════════════════════════════════════════════════
        private async Task<bool> TryRefreshTokenAsync()
        {
            var refreshToken = Environment.GetEnvironmentVariable("TrueLayerRefreshToken");
            var clientId = Environment.GetEnvironmentVariable("TrueLayerClientId");
            var clientSecret = Environment.GetEnvironmentVariable("TrueLayerClientSecret");

            if (string.IsNullOrEmpty(refreshToken) || string.IsNullOrEmpty(clientId))
                return false;

            try
            {
                var client = _httpClientFactory.CreateClient();
                var tokenResp = await client.PostAsync($"{TrueLayerAuthUrl}/connect/token",
                    new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        ["grant_type"] = "refresh_token",
                        ["client_id"] = clientId!,
                        ["client_secret"] = clientSecret!,
                        ["refresh_token"] = refreshToken
                    }));

                if (!tokenResp.IsSuccessStatusCode)
                {
                    _logger.LogWarning("TrueLayer token refresh failed: {Status}", tokenResp.StatusCode);
                    return false;
                }

                var tokenJson = await tokenResp.Content.ReadAsStringAsync();
                using var tokenDoc = JsonDocument.Parse(tokenJson);
                var newAccessToken = tokenDoc.RootElement.GetProperty("access_token").GetString()!;
                var newRefreshToken = tokenDoc.RootElement.TryGetProperty("refresh_token", out var nrt) ? nrt.GetString() : null;

                Environment.SetEnvironmentVariable("TrueLayerAccessToken", newAccessToken);
                if (!string.IsNullOrEmpty(newRefreshToken))
                    Environment.SetEnvironmentVariable("TrueLayerRefreshToken", newRefreshToken);

                // Persist to Key Vault
                var keyVaultUri = Environment.GetEnvironmentVariable("KEY_VAULT_URL")
                    ?? Environment.GetEnvironmentVariable("KeyVaultUri");
                if (!string.IsNullOrEmpty(keyVaultUri))
                {
                    var credential = new DefaultAzureCredential();
                    var secretClient = new SecretClient(new Uri(keyVaultUri), credential);
                    await secretClient.SetSecretAsync("TrueLayerAccessToken", newAccessToken);
                    if (!string.IsNullOrEmpty(newRefreshToken))
                        await secretClient.SetSecretAsync("TrueLayerRefreshToken", newRefreshToken);
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing TrueLayer token");
                return false;
            }
        }
    }
}
