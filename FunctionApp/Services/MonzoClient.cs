#nullable enable
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Services
{
    public sealed class MonzoReconnectRequiredException : Exception
    {
        public MonzoReconnectRequiredException(string message) : base(message) { }
    }

    public sealed class MonzoClient
    {
        public const string ApiBase = "https://api.monzo.com";
        private static readonly SemaphoreSlim RefreshLock = new(1, 1);
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<MonzoClient> _logger;
        private SecretClient? _secrets;

        public MonzoClient(IHttpClientFactory httpClientFactory, ILogger<MonzoClient> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        public static string? ClientId => Environment.GetEnvironmentVariable("MonzoClientId");
        public static string? ClientSecret => Environment.GetEnvironmentVariable("MonzoClientSecret");

        private SecretClient? Secrets()
        {
            if (_secrets != null) return _secrets;
            var vault = Environment.GetEnvironmentVariable("KEY_VAULT_URL") ?? Environment.GetEnvironmentVariable("KeyVaultUri");
            return string.IsNullOrEmpty(vault) ? null : _secrets = new SecretClient(new Uri(vault), new DefaultAzureCredential());
        }

        private async Task<string?> Secret(string name, bool fresh = false)
        {
            var cached = Environment.GetEnvironmentVariable(name);
            if (!fresh && !string.IsNullOrEmpty(cached)) return cached;
            var secrets = Secrets();
            if (secrets == null) return cached;
            try
            {
                var value = (await secrets.GetSecretAsync(name)).Value.Value;
                Environment.SetEnvironmentVariable(name, value);
                return value;
            }
            catch (Azure.RequestFailedException exception) when (exception.Status == 404) { return null; }
        }

        public async Task SaveSecret(string name, string value)
        {
            Environment.SetEnvironmentVariable(name, value);
            var secrets = Secrets();
            if (secrets != null) await secrets.SetSecretAsync(name, value);
        }

        public async Task StoreTokens(string accessToken, string? refreshToken)
        {
            await SaveSecret("MonzoAccessToken", accessToken);
            if (!string.IsNullOrEmpty(refreshToken)) await SaveSecret("MonzoRefreshToken", refreshToken);
        }

        public async Task<bool> HasRefreshToken() => !string.IsNullOrEmpty(await Secret("MonzoRefreshToken"));

        public async Task<string?> AccountId() => await Secret("MonzoAccountId");

        public async Task Refresh(string? rejectedAccessToken = null)
        {
            await RefreshLock.WaitAsync();
            try
            {
                // Another instance may already have renewed the single-use refresh token.
                var current = await Secret("MonzoAccessToken", fresh: true);
                if (rejectedAccessToken != null && !string.IsNullOrEmpty(current) && current != rejectedAccessToken) return;
                var refresh = await Secret("MonzoRefreshToken", fresh: true);
                if (string.IsNullOrEmpty(refresh) || string.IsNullOrEmpty(ClientId) || string.IsNullOrEmpty(ClientSecret))
                    throw new MonzoReconnectRequiredException("Monzo access has expired and no refresh token is available; reconnect Monzo");
                var response = await _httpClientFactory.CreateClient().PostAsync($"{ApiBase}/oauth2/token", new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "refresh_token", ["client_id"] = ClientId!, ["client_secret"] = ClientSecret!, ["refresh_token"] = refresh
                }));
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Monzo token refresh failed with {Status}", (int)response.StatusCode);
                    throw new MonzoReconnectRequiredException("Monzo refused to renew access; reconnect Monzo");
                }
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                await StoreTokens(document.RootElement.GetProperty("access_token").GetString()!,
                    document.RootElement.TryGetProperty("refresh_token", out var next) ? next.GetString() : null);
            }
            finally { RefreshLock.Release(); }
        }

        public async Task<JsonDocument> Get(string pathAndQuery)
        {
            for (var attempt = 0; attempt < 2; attempt++)
            {
                var token = await Secret("MonzoAccessToken");
                if (string.IsNullOrEmpty(token)) throw new MonzoReconnectRequiredException("Monzo is not connected");
                using var request = new HttpRequestMessage(HttpMethod.Get, ApiBase + pathAndQuery);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var response = await _httpClientFactory.CreateClient().SendAsync(request);
                if (response.StatusCode == HttpStatusCode.Unauthorized && attempt == 0)
                {
                    await Refresh(token);
                    continue;
                }
                if (response.StatusCode == HttpStatusCode.Forbidden)
                    throw new MonzoReconnectRequiredException("Approve Finlytics in the Monzo app, then sync again");
                if (response.StatusCode == HttpStatusCode.Unauthorized)
                    throw new MonzoReconnectRequiredException("Monzo access has expired; reconnect Monzo");
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Monzo API returned {(int)response.StatusCode}");
                return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            }
            throw new MonzoReconnectRequiredException("Monzo access has expired; reconnect Monzo");
        }

        public async Task<string> ResolveAccountId()
        {
            var stored = await AccountId();
            if (!string.IsNullOrEmpty(stored)) return stored;
            using var accounts = await Get("/accounts?account_type=uk_business");
            foreach (var account in accounts.RootElement.GetProperty("accounts").EnumerateArray())
            {
                var closed = account.TryGetProperty("closed", out var flag) && flag.GetBoolean();
                if (!closed && account.TryGetProperty("id", out var id) && id.GetString() is { } value)
                {
                    await SaveSecret("MonzoAccountId", value);
                    return value;
                }
            }
            throw new InvalidOperationException("No open Monzo business account was found");
        }
    }
}
