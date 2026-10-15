using System.IdentityModel.Tokens.Jwt;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using HttpRequestData = Microsoft.Azure.Functions.Worker.Http.HttpRequestData;

namespace FinlyticsV2.Api.Helpers;

public static class AuthHelper
{
    // Entra tenant and API audience (app ID URI or client ID) whose tokens this API accepts.
    private static readonly string? TenantId = Environment.GetEnvironmentVariable("AuthTenantId");
    private static readonly string? Audience = Environment.GetEnvironmentVariable("AuthAudience");
    private static readonly string? Issuer = string.IsNullOrWhiteSpace(TenantId) ? null : $"https://login.microsoftonline.com/{TenantId}/v2.0";
    private static readonly Lazy<ConfigurationManager<OpenIdConnectConfiguration>?> Metadata = new(() => Issuer == null ? null
        : new ConfigurationManager<OpenIdConnectConfiguration>($"{Issuer}/.well-known/openid-configuration",
            new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever { RequireHttps = true }));

    private static readonly string[] ClaimNames = { "oid", "sub", "tid", "preferred_username", "email", "name", "upn", "unique_name" };

    public static bool IsConfigured => !string.IsNullOrWhiteSpace(TenantId) && !string.IsNullOrWhiteSpace(Audience);

    public static string? GetAccessToken(HttpRequestData req)
    {
        if (!req.Headers.TryGetValues("Authorization", out var values))
        {
            return null;
        }

        var authHeader = values.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(authHeader) || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return authHeader["Bearer ".Length..].Trim();
    }

    /// <summary>
    /// Validates signature, issuer, audience and lifetime of an Entra v2 access token.
    /// Returns its claims, or null if the token is invalid or auth is not configured (fail closed).
    /// </summary>
    public static async Task<Dictionary<string, string?>?> ValidateTokenAsync(string jwt, CancellationToken cancellationToken)
    {
        var metadataManager = Metadata.Value;
        if (!IsConfigured || metadataManager == null)
        {
            return null;
        }

        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        if (!handler.CanReadToken(jwt))
        {
            return null;
        }

        try
        {
            var metadata = await metadataManager.GetConfigurationAsync(cancellationToken);
            var principal = handler.ValidateToken(jwt, new TokenValidationParameters
            {
                RequireSignedTokens = true,
                ValidateIssuerSigningKey = true,
                IssuerSigningKeys = metadata.SigningKeys,
                ValidAlgorithms = new[] { SecurityAlgorithms.RsaSha256 },
                ValidateIssuer = true,
                ValidIssuer = Issuer,
                ValidateAudience = true,
                ValidAudience = Audience,
                ValidateLifetime = true,
                RequireExpirationTime = true,
                ClockSkew = TimeSpan.FromMinutes(1)
            }, out _);

            if (principal.FindFirst("tid")?.Value != TenantId)
            {
                return null;
            }

            return ClaimNames.ToDictionary(name => name, name => principal.FindFirst(name)?.Value, StringComparer.OrdinalIgnoreCase);
        }
        catch (SecurityTokenSignatureKeyNotFoundException)
        {
            metadataManager.RequestRefresh();
            return null;
        }
        catch (Exception ex) when (ex is SecurityTokenException or ArgumentException or InvalidOperationException or IOException)
        {
            return null;
        }
    }

    public static string? ResolveImmutableUserId(Dictionary<string, string?> claims)
    {
        // Entra object id is stable for the user within the tenant.
        if (!string.IsNullOrWhiteSpace(claims.GetValueOrDefault("oid")))
        {
            return claims["oid"];
        }

        // Fallback for tokens that only include subject.
        if (!string.IsNullOrWhiteSpace(claims.GetValueOrDefault("sub")))
        {
            return claims["sub"];
        }

        return null;
    }

    public static string? ResolvePreferredLogin(Dictionary<string, string?> claims)
    {
        return claims.GetValueOrDefault("preferred_username")
            ?? claims.GetValueOrDefault("upn")
            ?? claims.GetValueOrDefault("email")
            ?? claims.GetValueOrDefault("unique_name");
    }

    /// <summary>Object IDs allowed to create user-to-company mappings (comma-separated MappingAdminObjectIds setting).</summary>
    public static bool IsMappingAdmin(string? objectId) =>
        !string.IsNullOrWhiteSpace(objectId)
        && (Environment.GetEnvironmentVariable("MappingAdminObjectIds") ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Contains(objectId, StringComparer.OrdinalIgnoreCase);
}
