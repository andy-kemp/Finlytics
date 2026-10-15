#nullable enable
using System;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace FinanceHubFunctions.Helpers
{
    /// <summary>
    /// HMAC-signed, expiring OAuth state so public callbacks only accept flows the owner started.
    /// Format: {unixExpiry}.{base64url(data)}.{base64url(hmac)}
    /// </summary>
    public static class OAuthState
    {
        public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

        public static string Sign(string secret, DateTime expiresUtc, string data)
        {
            var payload = $"{new DateTimeOffset(expiresUtc).ToUnixTimeSeconds()}.{Encode(Encoding.UTF8.GetBytes(data))}";
            return payload + "." + Encode(Hmac(secret, payload));
        }

        /// <summary>Creates a state carrying optional data plus a random nonce.</summary>
        public static string Create(string secret, DateTime nowUtc, string data = "") =>
            Sign(secret, nowUtc.Add(Lifetime), Convert.ToHexString(RandomNumberGenerator.GetBytes(16)) + "|" + data);

        /// <summary>Returns the data passed to <see cref="Create"/>, or null if the state is missing, tampered or expired.</summary>
        public static string? Verify(string secret, string? state, DateTime nowUtc)
        {
            if (string.IsNullOrEmpty(secret)) return null;
            var parts = state?.Split('.');
            if (parts is not { Length: 3 } || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var expires)
                || DateTimeOffset.FromUnixTimeSeconds(expires).UtcDateTime < nowUtc) return null;
            var expected = Encode(Hmac(secret, parts[0] + "." + parts[1]));
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(parts[2]))) return null;
            try
            {
                var data = Encoding.UTF8.GetString(Decode(parts[1]));
                var separator = data.IndexOf('|');
                return separator >= 32 ? data[(separator + 1)..] : null;
            }
            catch (FormatException) { return null; }
        }

        /// <summary>Returns the origin of <paramref name="url"/> if it is in the allow-list, otherwise the first allowed origin.</summary>
        public static string SafeOrigin(string? url, string[] allowedOrigins)
        {
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
            {
                var origin = uri.GetLeftPart(UriPartial.Authority);
                var match = allowedOrigins.FirstOrDefault(allowed => string.Equals(allowed.TrimEnd('/'), origin, StringComparison.OrdinalIgnoreCase));
                if (match != null) return match.TrimEnd('/');
            }
            return allowedOrigins[0].TrimEnd('/');
        }

        private static byte[] Hmac(string secret, string payload)
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            return hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        }

        private static string Encode(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        private static byte[] Decode(string text)
        {
            var base64 = text.Replace('-', '+').Replace('_', '/');
            return Convert.FromBase64String(base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '='));
        }
    }
}
