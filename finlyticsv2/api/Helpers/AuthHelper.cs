using System.Text;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker.Http;

namespace FinlyticsV2.Api.Helpers;

public static class AuthHelper
{
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

    public static Dictionary<string, string?> ExtractJwtClaims(string jwt)
    {
        var claims = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["oid"] = null,
            ["sub"] = null,
            ["tid"] = null,
            ["preferred_username"] = null,
            ["email"] = null,
            ["name"] = null,
            ["upn"] = null,
            ["unique_name"] = null,
        };

        var parts = jwt.Split('.');
        if (parts.Length < 2)
        {
            return claims;
        }

        var payload = parts[1].Replace('-', '+').Replace('_', '/');
        while (payload.Length % 4 != 0)
        {
            payload += "=";
        }

        try
        {
            var bytes = Convert.FromBase64String(payload);
            using var doc = JsonDocument.Parse(Encoding.UTF8.GetString(bytes));
            foreach (var key in claims.Keys.ToArray())
            {
                if (doc.RootElement.TryGetProperty(key, out var value))
                {
                    claims[key] = value.GetString();
                }
            }
        }
        catch
        {
            // Keep null claims when token cannot be parsed.
        }

        return claims;
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
}
