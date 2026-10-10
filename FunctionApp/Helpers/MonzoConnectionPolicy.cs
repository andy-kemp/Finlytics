#nullable enable
using System;
using System.Text.Json;

namespace FinanceHubFunctions.Helpers
{
    public static class MonzoConnectionPolicy
    {
        public static DateTime? AccessExpiry(JsonElement response, DateTime nowUtc) =>
            response.TryGetProperty("expires_in", out var expiry) && expiry.ValueKind == JsonValueKind.Number && expiry.TryGetInt64(out var seconds)
                && seconds > 0 && seconds <= TimeSpan.FromDays(365).TotalSeconds
                ? nowUtc.AddSeconds(seconds) : null;

        public static bool Warn(bool canRefresh, DateTime? expiresAtUtc, DateTime nowUtc) =>
            !canRefresh && expiresAtUtc.HasValue && expiresAtUtc.Value <= nowUtc.AddDays(15);

        public static bool EmailDue(bool canRefresh, DateTime? expiresAtUtc, bool needsReconnect, DateTime nowUtc) =>
            needsReconnect || (!canRefresh && expiresAtUtc.HasValue && expiresAtUtc.Value <= nowUtc.AddDays(5));
    }
}