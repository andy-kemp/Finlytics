#nullable enable
using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using HttpRequestData = Microsoft.Azure.Functions.Worker.Http.HttpRequestData;

namespace FinanceHubFunctions.Services
{
    public sealed record SettlementAuthorization(HttpStatusCode StatusCode, string? Error)
    {
        public bool IsAuthorized => StatusCode == HttpStatusCode.OK;
    }

    public sealed class SettlementAuthService
    {
        private readonly string? _tenantId;
        private readonly string? _audience;
        private readonly string _scope;
        private readonly HashSet<Guid> _owners = new();
        private readonly string? _issuer;
        private readonly IConfigurationManager<OpenIdConnectConfiguration>? _metadata;
        private readonly bool _configured;

        public SettlementAuthService(IConfiguration configuration)
            : this(configuration, null) { }

        public SettlementAuthService(IConfiguration configuration,
            IConfigurationManager<OpenIdConnectConfiguration>? metadata)
        {
            _scope = configuration["SettlementRequiredScope"] ?? "Settlement.Write";
            var ownerIds = configuration["SettlementAllowedObjectIds"]?.Split(',');
            if (!Guid.TryParse(configuration["SettlementTenantId"], out var tenantId) || tenantId == Guid.Empty
                || !Guid.TryParse(configuration["SettlementAudience"], out var audience) || audience == Guid.Empty
                || audience == Guid.Parse("00000003-0000-0000-c000-000000000000")
                || audience == Guid.Parse("c5c042d4-48e3-4e28-ba5f-b9b01e82aa41")
                || string.IsNullOrWhiteSpace(_scope) || _scope.Any(char.IsWhiteSpace) || _scope.Contains('/')
                || ownerIds == null || ownerIds.Length == 0)
                return;

            foreach (var ownerId in ownerIds)
            {
                if (!Guid.TryParse(ownerId.Trim(), out var parsed) || parsed == Guid.Empty)
                    return;
                _owners.Add(parsed);
            }

            _tenantId = tenantId.ToString();
            _audience = audience.ToString();
            _issuer = $"https://login.microsoftonline.com/{_tenantId}/v2.0";
            _metadata = metadata ?? new ConfigurationManager<OpenIdConnectConfiguration>(
                $"https://login.microsoftonline.com/{_tenantId}/v2.0/.well-known/openid-configuration",
                new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever { RequireHttps = true });
            _configured = true;
        }

        public Task<SettlementAuthorization> ValidateRequest(HttpRequestData request,
            CancellationToken cancellationToken = default) => ValidateAuthorizationHeader(
                request.Headers.TryGetValues("Authorization", out var values) ? values : null, cancellationToken);

        public async Task<SettlementAuthorization> ValidateAuthorizationHeader(IEnumerable<string>? values,
            CancellationToken cancellationToken = default)
        {
            if (!_configured)
                return new(HttpStatusCode.ServiceUnavailable, "Settlement authorization is not configured");

            var headers = values?.ToArray();
            if (headers == null || headers.Length != 1
                || !AuthenticationHeaderValue.TryParse(headers[0], out var header)
                || !string.Equals(header.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase)
                || string.IsNullOrWhiteSpace(header.Parameter))
                return new(HttpStatusCode.Unauthorized, "A Bearer access token is required");

            var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
            if (!handler.CanReadToken(header.Parameter))
                return new(HttpStatusCode.Unauthorized, "Invalid settlement access token");

            OpenIdConnectConfiguration metadata;
            try
            {
                metadata = await _metadata!.GetConfigurationAsync(cancellationToken);
                if (metadata.Issuer != _issuer || metadata.SigningKeys.Count == 0)
                    return new(HttpStatusCode.ServiceUnavailable, "Settlement identity metadata is unavailable");
            }
            catch (Exception)
            {
                return new(HttpStatusCode.ServiceUnavailable, "Settlement identity metadata is unavailable");
            }

            try
            {
                var principal = handler.ValidateToken(header.Parameter, new TokenValidationParameters
                {
                    RequireSignedTokens = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKeys = metadata.SigningKeys,
                    ValidAlgorithms = new[] { SecurityAlgorithms.RsaSha256 },
                    ValidateIssuer = true,
                    ValidIssuer = _issuer,
                    ValidateAudience = true,
                    ValidAudience = _audience,
                    IgnoreTrailingSlashWhenValidatingAudience = false,
                    ValidateLifetime = true,
                    RequireExpirationTime = true,
                    ClockSkew = TimeSpan.Zero
                }, out var validatedToken);

                if (validatedToken is not JwtSecurityToken jwt || jwt.Audiences.Count() != 1
                    || principal.FindAll("tid").Count() != 1
                    || principal.FindFirst("tid")?.Value != _tenantId
                    || principal.FindAll("ver").Count() != 1 || principal.FindFirst("ver")?.Value != "2.0")
                    return new(HttpStatusCode.Unauthorized, "Invalid settlement access token");

                var scopes = principal.FindAll("scp").ToArray();
                if (scopes.Length != 1 || !scopes[0].Value.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Contains(_scope, StringComparer.Ordinal))
                    return new(HttpStatusCode.Forbidden, "Required delegated settlement scope is missing");

                var objectIds = principal.FindAll("oid").ToArray();
                if (objectIds.Length != 1 || !Guid.TryParse(objectIds[0].Value, out var objectId)
                    || !_owners.Contains(objectId))
                    return new(HttpStatusCode.Forbidden, "User is not an authorized settlement owner");

                return new(HttpStatusCode.OK, null);
            }
            catch (SecurityTokenSignatureKeyNotFoundException)
            {
                _metadata!.RequestRefresh();
                return new(HttpStatusCode.Unauthorized, "Invalid settlement access token");
            }
            catch (SecurityTokenException)
            {
                return new(HttpStatusCode.Unauthorized, "Invalid settlement access token");
            }
            catch (ArgumentException)
            {
                return new(HttpStatusCode.Unauthorized, "Invalid settlement access token");
            }
        }
    }
}