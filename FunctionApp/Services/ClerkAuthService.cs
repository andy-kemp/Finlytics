using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.IdentityModel.Tokens;

namespace FinanceHubFunctions.Services
{
    /// <summary>
    /// Validates Clerk-issued JWTs for the Employee Portal.
    /// Uses the Clerk JWKS endpoint to verify token signatures.
    /// </summary>
    public class ClerkAuthService
    {
        private readonly string _jwksUrl;
        private readonly string _issuer;
        private JsonWebKeySet? _cachedKeySet;
        private DateTime _keySetCachedAt = DateTime.MinValue;
        private static readonly TimeSpan KeySetCacheDuration = TimeSpan.FromHours(1);

        public ClerkAuthService()
        {
            // Clerk Frontend API domain (from environment)
            var clerkDomain = Environment.GetEnvironmentVariable("CLERK_FRONTEND_API")
                ?? "https://charming-ram-93.clerk.accounts.dev";

            _jwksUrl = $"{clerkDomain.TrimEnd('/')}/.well-known/jwks.json";
            _issuer = clerkDomain.TrimEnd('/');
        }

        /// <summary>
        /// Validates the Bearer token from the request and returns the ClaimsPrincipal.
        /// Returns null if the token is invalid or missing.
        /// </summary>
        public async Task<ClerkUser?> ValidateRequestAsync(HttpRequestData req)
        {
            var authHeader = req.Headers.Contains("Authorization")
                ? req.Headers.GetValues("Authorization").FirstOrDefault()
                : null;

            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                return null;

            var token = authHeader["Bearer ".Length..].Trim();
            return await ValidateTokenAsync(token);
        }

        /// <summary>
        /// Validates a Clerk JWT and extracts user information.
        /// </summary>
        public async Task<ClerkUser?> ValidateTokenAsync(string token)
        {
            try
            {
                var keySet = await GetKeySetAsync();
                var signingKeys = keySet.GetSigningKeys();

                var validationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = _issuer,
                    ValidateAudience = false, // Clerk doesn't set an audience by default
                    ValidateLifetime = true,
                    IssuerSigningKeys = signingKeys,
                    ClockSkew = TimeSpan.FromMinutes(2)
                };

                var handler = new JwtSecurityTokenHandler();
                var principal = handler.ValidateToken(token, validationParameters, out var validatedToken);

                if (validatedToken is not JwtSecurityToken jwtToken)
                    return null;

                // Optional: only accept tokens issued to our own portal origins
                var authorizedParties = (Environment.GetEnvironmentVariable("CLERK_AUTHORIZED_PARTIES") ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var azp = principal.FindFirst("azp")?.Value;
                if (authorizedParties.Length > 0 && !authorizedParties.Contains(azp, StringComparer.OrdinalIgnoreCase))
                {
                    Console.WriteLine($"Clerk token rejected: unexpected azp '{azp}'");
                    return null;
                }

                return new ClerkUser
                {
                    UserId = principal.FindFirst("sub")?.Value ?? string.Empty,
                    Email = principal.FindFirst("email")?.Value
                        ?? principal.FindFirst(ClaimTypes.Email)?.Value
                        ?? string.Empty,
                    FullName = principal.FindFirst("name")?.Value
                        ?? principal.FindFirst(ClaimTypes.Name)?.Value
                        ?? string.Empty,
                    SessionId = principal.FindFirst("sid")?.Value ?? string.Empty,
                    ExpiresAt = jwtToken.ValidTo
                };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Clerk token validation failed: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Verified email addresses for the signed-in user: the token's email claim if present,
        /// otherwise looked up via the Clerk Backend API when CLERK_SECRET_KEY is set. Empty if unknown.
        /// </summary>
        public async Task<IReadOnlyCollection<string>> GetVerifiedEmailsAsync(ClerkUser user)
        {
            if (!string.IsNullOrWhiteSpace(user.Email)) return new[] { user.Email };
            var secretKey = Environment.GetEnvironmentVariable("CLERK_SECRET_KEY");
            if (string.IsNullOrEmpty(secretKey) || string.IsNullOrEmpty(user.UserId)) return Array.Empty<string>();
            try
            {
                using var httpClient = new HttpClient();
                using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.clerk.com/v1/users/{Uri.EscapeDataString(user.UserId)}");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secretKey);
                using var response = await httpClient.SendAsync(request);
                if (!response.IsSuccessStatusCode) return Array.Empty<string>();
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                if (!document.RootElement.TryGetProperty("email_addresses", out var addresses)) return Array.Empty<string>();
                return addresses.EnumerateArray()
                    .Where(address => address.TryGetProperty("verification", out var verification)
                        && verification.ValueKind == JsonValueKind.Object
                        && verification.TryGetProperty("status", out var status) && status.GetString() == "verified")
                    .Select(address => address.GetProperty("email_address").GetString() ?? "")
                    .Where(email => email.Length > 0)
                    .ToList();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Clerk user email lookup failed: {ex.Message}");
                return Array.Empty<string>();
            }
        }

        private async Task<JsonWebKeySet> GetKeySetAsync()
        {
            if (_cachedKeySet != null && DateTime.UtcNow - _keySetCachedAt < KeySetCacheDuration)
                return _cachedKeySet;

            using var httpClient = new HttpClient();
            var json = await httpClient.GetStringAsync(_jwksUrl);
            _cachedKeySet = new JsonWebKeySet(json);
            _keySetCachedAt = DateTime.UtcNow;
            return _cachedKeySet;
        }
    }

    /// <summary>
    /// Represents a validated Clerk user from a JWT.
    /// </summary>
    public class ClerkUser
    {
        public string UserId { get; set; } = string.Empty;  // Clerk user_xxx
        public string Email { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string SessionId { get; set; } = string.Empty;
        public DateTime ExpiresAt { get; set; }
    }
}
