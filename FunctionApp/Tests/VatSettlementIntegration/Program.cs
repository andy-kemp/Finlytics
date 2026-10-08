using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Functions;
using FinanceHubFunctions.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

using var rsa = RSA.Create(2048);
var tenant = Guid.NewGuid().ToString();
var audience = Guid.NewGuid().ToString();
var owner = Guid.NewGuid().ToString();
var issuer = $"https://login.microsoftonline.com/{tenant}/v2.0";
var key = new RsaSecurityKey(rsa) { KeyId = "offline-test-key" };
var metadata = new OpenIdConnectConfiguration { Issuer = issuer };
metadata.SigningKeys.Add(key);
var auth = new SettlementAuthService(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
{
    ["SettlementTenantId"] = tenant,
    ["SettlementAudience"] = audience,
    ["SettlementAllowedObjectIds"] = owner
}).Build(), new FixedMetadata(metadata));
var payload = new JwtPayload(issuer, audience, new[]
{
    new Claim("tid", tenant), new Claim("ver", "2.0"), new Claim("oid", owner), new Claim("scp", "Settlement.Write")
}, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddMinutes(10));
var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
    new JwtHeader(new SigningCredentials(key, SecurityAlgorithms.RsaSha256)), payload));
Check((await auth.ValidateAuthorizationHeader(new[] { "Bearer " + token })).IsAuthorized, "Local RSA token accepted");
var denyConnections = new DenyConnections();
await using (var db = new FinanceHubDbContext(new DbContextOptionsBuilder<FinanceHubDbContext>()
    .UseSqlServer("Server=127.0.0.1,1;Database=unreachable;Encrypt=True;Connect Timeout=1")
    .AddInterceptors(denyConnections).Options))
{
    var response = await new VatSettlementFunctions(db, auth, NullLogger<VatSettlementFunctions>.Instance)
        .SettleVatReturn(new TestRequest("", null, forbidBody: true), 1);
    Check(response.StatusCode == HttpStatusCode.Unauthorized && denyConnections.Attempts == 0,
        "Actual handler returns 401 without body read or database access");
    var invalid = await new VatSettlementFunctions(db, auth, NullLogger<VatSettlementFunctions>.Instance)
        .SettleVatReturn(new TestRequest("{}", token), 1);
    Check(invalid.StatusCode == HttpStatusCode.BadRequest && denyConnections.Attempts == 0,
        "Signed invalid request returns 400 without database access");
    var generic = await new CompanyLedgerFunctions(NullLoggerFactory.Instance,
        new TestCompanyLedgerRepository(db), new DeletionGuardService(db), db)
        .CreateCompanyLedgerEntry(new TestRequest("{\"entryType\":\"VAT_Paid\",\"notes\":\"[VAT-RETURN:1]\"}", null));
    Check(generic.StatusCode == HttpStatusCode.BadRequest && denyConnections.Attempts == 0,
        "Actual generic handler rejects reserved VAT marker without database access");
    var script = db.Database.GenerateCreateScript();
    Check(new[] { "[VatReturns]", "[BankAccounts]", "[BankTransactions]", "[CompanyLedger]", "[Expenses]", "[DlaEntries]", "[ReconciliationMatches]" }
        .All(table => script.Contains("CREATE TABLE " + table, StringComparison.Ordinal)),
        "Full real EF model generates required SQL tables offline");
}
foreach (var catalog in new[] { "financehub", "master", "finlytics-vat-test-", "finlytics-vat-test-financehub", "Finlytics-vat-test-abc" })
{
    try { Guard($"Server=tcp:synthetic.database.windows.net,1433;Database={catalog};Encrypt=True"); }
    catch (ArgumentException) { Console.WriteLine($"PASS database guard rejects {catalog}"); continue; }
    throw new InvalidOperationException("Database guard accepted " + catalog);
}
Guard("Server=tcp:synthetic.database.windows.net,1433;Database=finlytics-vat-test-offline;Encrypt=True");
foreach (var rejected in new[]
{
    "Server=localhost;Database=finlytics-vat-test-offline",
    "Server=tcp:synthetic.database.windows.net,1433;Database=finlytics-vat-test-offline;User ID=synthetic;Password=synthetic",
    "Server=tcp:synthetic.database.windows.net,1433;Database=finlytics-vat-test-offline;Authentication=Active Directory Default"
})
{
    try { Guard(rejected); }
    catch (ArgumentException) { Console.WriteLine("PASS database guard rejects non-Azure host or non-callback credentials"); continue; }
    throw new InvalidOperationException("Database guard accepted unsafe connection settings");
}
if (args.Length == 0 || args.SequenceEqual(new[] { "--offline" }))
{
    Console.WriteLine("Offline checks passed. No database connection opened. SQL tests require --database.");
    return;
}
if (!args.SequenceEqual(new[] { "--database" })) throw new ArgumentException("Use --offline or --database");
var connectionString = Environment.GetEnvironmentVariable("FINLYTICS_VAT_TEST_CONNECTION")
    ?? throw new ArgumentException("FINLYTICS_VAT_TEST_CONNECTION must name an existing empty isolated test database");
var guarded = Guard(connectionString);
await DatabaseTests.Run(guarded, auth, token);

static void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
    Console.WriteLine("PASS " + name);
}

static string Guard(string connectionString)
{
    var builder = new SqlConnectionStringBuilder(connectionString);
    if (!Regex.IsMatch(builder.InitialCatalog, @"\Afinlytics-vat-test-[a-z0-9][a-z0-9-]{2,60}\z")
        || builder.InitialCatalog.Contains("financehub", StringComparison.OrdinalIgnoreCase)
        || !Regex.IsMatch(builder.DataSource, @"\A(tcp:)?[a-z0-9-]+\.database\.windows\.net(,1433)?\z", RegexOptions.IgnoreCase)
        || builder.UserID.Length != 0 || builder.Password.Length != 0 || builder.IntegratedSecurity
        || builder.Authentication != SqlAuthenticationMethod.NotSpecified || builder.AttachDBFilename.Length != 0)
        throw new ArgumentException("Only a dedicated finlytics-vat-test-* Azure SQL database with Azure CLI callback authentication is allowed");
    builder.Encrypt = SqlConnectionEncryptOption.Mandatory;
    builder.TrustServerCertificate = false;
    builder.ConnectTimeout = 15;
    return builder.ConnectionString;
}

sealed class FixedMetadata(OpenIdConnectConfiguration configuration) : IConfigurationManager<OpenIdConnectConfiguration>
{
    public Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancellationToken) => Task.FromResult(configuration);
    public void RequestRefresh() { }
}

sealed class DenyConnections : DbConnectionInterceptor
{
    public int Attempts { get; private set; }
    public override InterceptionResult ConnectionOpening(System.Data.Common.DbConnection connection,
        ConnectionEventData eventData, InterceptionResult result)
    {
        Attempts++;
        throw new InvalidOperationException("Offline database access forbidden");
    }
    public override ValueTask<InterceptionResult> ConnectionOpeningAsync(System.Data.Common.DbConnection connection,
        ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
    {
        Attempts++;
        throw new InvalidOperationException("Offline database access forbidden");
    }
}