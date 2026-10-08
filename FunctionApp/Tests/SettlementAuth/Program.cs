using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using FinanceHubFunctions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using HttpRequestData = Microsoft.Azure.Functions.Worker.Http.HttpRequestData;

const string tenant = "11016236-4dbc-43a6-8310-be803173fc43";
const string audience = "b11219bf-bd11-4d7a-9171-14f4eb8ce865";
const string owner = "928c5821-97a0-40f8-bef6-32b7b2f90115";
const string otherOwner = "74d1f0f3-b257-4d38-818f-5e2cb759bb48";
const string issuer = "https://login.microsoftonline.com/" + tenant + "/v2.0";
var settings = new Dictionary<string, string?>
{
    ["SettlementTenantId"] = tenant,
    ["SettlementAudience"] = audience,
    ["SettlementAllowedObjectIds"] = owner
};
using var rsa = RSA.Create(2048);
using var wrongRsa = RSA.Create(2048);
var key = new RsaSecurityKey(rsa) { KeyId = "offline-key" };
var wrongKey = new RsaSecurityKey(wrongRsa) { KeyId = key.KeyId };
var signing = new SigningCredentials(key, SecurityAlgorithms.RsaSha256);
var configuration = new OpenIdConnectConfiguration { Issuer = issuer };
configuration.SigningKeys.Add(key);
var metadata = new FixedMetadata(configuration);
var now = DateTime.UtcNow;
var count = 0;

SettlementAuthService Service(Dictionary<string, string?>? config = null, FixedMetadata? provider = null) =>
    new(new ConfigurationBuilder().AddInMemoryCollection(config ?? settings).Build(), provider ?? metadata);

string Token(Action<JwtPayload>? change = null, SigningCredentials? credentials = null)
{
    var payload = new JwtPayload(issuer, audience, new[]
    {
        new Claim("tid", tenant), new Claim("ver", "2.0"),
        new Claim("oid", owner), new Claim("scp", "openid Settlement.Write")
    }, now.AddMinutes(-10), now.AddMinutes(10), now.AddMinutes(-10));
    change?.Invoke(payload);
    return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(new JwtHeader(credentials ?? signing), payload));
}

async Task Expect(string name, HttpStatusCode expected, string? token = null,
    SettlementAuthService? service = null, string[]? headers = null)
{
    var request = new HeaderRequest(headers ?? (token == null ? Array.Empty<string>() : new[] { "Bearer " + token }));
    var result = await (service ?? Service()).ValidateRequest(request);
    if (result.StatusCode != expected || result.IsAuthorized != (expected == HttpStatusCode.OK)
        || (expected != HttpStatusCode.OK && string.IsNullOrWhiteSpace(result.Error)))
        throw new InvalidOperationException($"{name}: expected {expected}, received {result}");
    count++;
    Console.WriteLine($"PASS {name} ({(int)result.StatusCode})");
}

await Expect("Allowed owner with default delegated scope", HttpStatusCode.OK, Token());
await Expect("Bearer scheme is case insensitive", HttpStatusCode.OK, headers: new[] { "bearer " + Token() });
await Expect("Unauthorized owner", HttpStatusCode.Forbidden, Token(payload => payload["oid"] = otherOwner));
await Expect("Missing owner oid", HttpStatusCode.Forbidden, Token(payload => payload.Remove("oid")));
await Expect("Malformed oid", HttpStatusCode.Forbidden, Token(payload => payload["oid"] = "not-an-id"));
await Expect("Wrong API audience", HttpStatusCode.Unauthorized, Token(payload => payload["aud"] = otherOwner));
await Expect("Graph GUID audience", HttpStatusCode.Unauthorized, Token(payload => payload["aud"] = "00000003-0000-0000-c000-000000000000"));
await Expect("Graph URI audience", HttpStatusCode.Unauthorized, Token(payload => payload["aud"] = "https://graph.microsoft.com"));
await Expect("Mixed API and Graph audiences", HttpStatusCode.Unauthorized,
    Token(payload => payload["aud"] = new[] { audience, "https://graph.microsoft.com" }));
await Expect("Browser ID-token audience", HttpStatusCode.Unauthorized,
    Token(payload => { payload["aud"] = "c5c042d4-48e3-4e28-ba5f-b9b01e82aa41"; payload.Remove("scp"); }));
await Expect("ID token lacks delegated scope even with API audience", HttpStatusCode.Forbidden, Token(payload => payload.Remove("scp")));
await Expect("Wrong issuer", HttpStatusCode.Unauthorized, Token(payload => payload["iss"] = "https://login.microsoftonline.com/" + otherOwner + "/v2.0"));
await Expect("v1 issuer", HttpStatusCode.Unauthorized, Token(payload => payload["iss"] = "https://sts.windows.net/" + tenant + "/"));
await Expect("Wrong tenant claim", HttpStatusCode.Unauthorized, Token(payload => payload["tid"] = otherOwner));
await Expect("Missing tenant claim", HttpStatusCode.Unauthorized, Token(payload => payload.Remove("tid")));
await Expect("Wrong token version", HttpStatusCode.Unauthorized, Token(payload => payload["ver"] = "1.0"));
await Expect("Expired token without grace period", HttpStatusCode.Unauthorized, Token(payload => payload["exp"] = EpochTime.GetIntDate(now.AddSeconds(-1))));
await Expect("Missing expiration", HttpStatusCode.Unauthorized, Token(payload => payload.Remove("exp")));
await Expect("Future not-before", HttpStatusCode.Unauthorized, Token(payload => payload["nbf"] = EpochTime.GetIntDate(now.AddMinutes(5))));
await Expect("Invalid RSA signature", HttpStatusCode.Unauthorized, Token(credentials: new SigningCredentials(wrongKey, SecurityAlgorithms.RsaSha256)));
await Expect("Non-RS256 RSA signature", HttpStatusCode.Unauthorized, Token(credentials: new SigningCredentials(key, SecurityAlgorithms.RsaSha512)));
await Expect("Unsigned JWT", HttpStatusCode.Unauthorized, new JwtSecurityTokenHandler().WriteToken(
    new JwtSecurityToken(issuer, audience, new[] { new Claim("scp", "Settlement.Write") }, now.AddMinutes(-1), now.AddMinutes(10))));
await Expect("Missing scope", HttpStatusCode.Forbidden, Token(payload => payload["scp"] = "openid profile"));
await Expect("Scope comparison is exact", HttpStatusCode.Forbidden, Token(payload => payload["scp"] = "Settlement.Write.Extra settlement.write"));
await Expect("Application roles do not replace delegated scope", HttpStatusCode.Forbidden,
    Token(payload => { payload.Remove("scp"); payload["roles"] = new[] { "Settlement.Write" }; }));
await Expect("Missing header", HttpStatusCode.Unauthorized);
await Expect("Function key does not authorize", HttpStatusCode.Unauthorized, headers: new[] { "ApiKey test-function-key" });
await Expect("Multiple Authorization headers", HttpStatusCode.Unauthorized, headers: new[] { "Bearer " + Token(), "Bearer " + Token() });
await Expect("Empty bearer token", HttpStatusCode.Unauthorized, headers: new[] { "Bearer " });
await Expect("Malformed token", HttpStatusCode.Unauthorized, "not-a-jwt");

foreach (var field in new[] { "SettlementTenantId", "SettlementAudience", "SettlementAllowedObjectIds" })
{
    var missing = new Dictionary<string, string?>(settings);
    missing.Remove(field);
    var unreachable = new FixedMetadata(configuration) { Fail = true };
    await Expect("Missing configuration " + field, HttpStatusCode.ServiceUnavailable, Token(), Service(missing, unreachable));
    if (unreachable.Requests != 0) throw new InvalidOperationException("Missing configuration reached metadata");
}
foreach (var (field, value) in new[]
{
    ("SettlementTenantId", "common"), ("SettlementAudience", "https://graph.microsoft.com"),
    ("SettlementAudience", "00000003-0000-0000-c000-000000000000"),
    ("SettlementAudience", "c5c042d4-48e3-4e28-ba5f-b9b01e82aa41"),
    ("SettlementAllowedObjectIds", owner + ","), ("SettlementAllowedObjectIds", owner + ",invalid"),
    ("SettlementRequiredScope", ""), ("SettlementRequiredScope", "Settlement.Write Other")
})
{
    var invalid = new Dictionary<string, string?>(settings) { [field] = value };
    await Expect("Invalid configuration " + field + "=" + value, HttpStatusCode.ServiceUnavailable, Token(), Service(invalid));
}
var multipleOwners = new Dictionary<string, string?>(settings) { ["SettlementAllowedObjectIds"] = owner + ", " + otherOwner };
await Expect("Comma-separated owner allow-list", HttpStatusCode.OK, Token(payload => payload["oid"] = otherOwner), Service(multipleOwners));
var customScope = new Dictionary<string, string?>(settings) { ["SettlementRequiredScope"] = "Settlement.Confirm" };
await Expect("Configured scope accepted", HttpStatusCode.OK, Token(payload => payload["scp"] = "Settlement.Confirm"), Service(customScope));
await Expect("Default scope cannot replace configured scope", HttpStatusCode.Forbidden, Token(), Service(customScope));
await Expect("Metadata retrieval failure", HttpStatusCode.ServiceUnavailable, Token(), Service(provider: new FixedMetadata(configuration) { Fail = true }));
await Expect("Metadata issuer must match pinned tenant", HttpStatusCode.ServiceUnavailable, Token(),
    Service(provider: new FixedMetadata(new OpenIdConnectConfiguration { Issuer = "https://attacker.example/v2.0" })));
await Expect("Metadata signing keys missing", HttpStatusCode.ServiceUnavailable, Token(),
    Service(provider: new FixedMetadata(new OpenIdConnectConfiguration { Issuer = issuer })));
Console.WriteLine($"{count} offline settlement authorization checks passed.");

sealed class FixedMetadata(OpenIdConnectConfiguration configuration) : IConfigurationManager<OpenIdConnectConfiguration>
{
    public bool Fail { get; init; }
    public int Requests { get; private set; }
    public Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancellationToken)
    {
        Requests++;
        return Fail ? Task.FromException<OpenIdConnectConfiguration>(new IOException("Offline metadata failure"))
            : Task.FromResult(configuration);
    }
    public void RequestRefresh() { }
}

sealed class HeaderRequest : HttpRequestData
{
    public HeaderRequest(string[] authorization) : base(new OfflineContext())
    {
        Headers.TryAddWithoutValidation("Authorization", authorization);
        Headers.Add("x-functions-key", "test-function-key");
    }
    public override Stream Body => throw new InvalidOperationException("Authentication must not read JSON");
    public override HttpHeadersCollection Headers { get; } = new();
    public override IReadOnlyCollection<IHttpCookie> Cookies => Array.Empty<IHttpCookie>();
    public override Uri Url => new("https://localhost/api/expenses/1/gbp-settlement?code=test-function-key");
    public override IEnumerable<ClaimsIdentity> Identities => Array.Empty<ClaimsIdentity>();
    public override string Method => "PATCH";
    public override HttpResponseData CreateResponse() => throw new NotSupportedException();
}

sealed class OfflineContext : FunctionContext
{
    public override string InvocationId => "offline-invocation";
    public override string FunctionId => "offline-settlement";
    public override TraceContext TraceContext => throw new NotSupportedException();
    public override BindingContext BindingContext => throw new NotSupportedException();
    public override RetryContext RetryContext => throw new NotSupportedException();
    public override IServiceProvider InstanceServices { get; set; } = null!;
    public override FunctionDefinition FunctionDefinition => throw new NotSupportedException();
    public override IDictionary<object, object> Items { get; set; } = new Dictionary<object, object>();
    public override IInvocationFeatures Features => throw new NotSupportedException();
}