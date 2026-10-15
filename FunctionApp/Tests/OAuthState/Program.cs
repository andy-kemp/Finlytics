using FinanceHubFunctions.Helpers;

var now = new DateTime(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);
const string secret = "client-secret-for-tests";
void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}

var state = OAuthState.Create(secret, now, "https://finhub.andykemp.cloud");
Check(OAuthState.Verify(secret, state, now) == "https://finhub.andykemp.cloud", "signed state round-trips its data");
Check(OAuthState.Verify(secret, OAuthState.Create(secret, now), now) == "", "state without data verifies");
Check(OAuthState.Verify(secret, state, now.AddMinutes(16)) == null, "expired state refused");
Check(OAuthState.Verify("other-secret", state, now) == null, "state signed with another secret refused");
Check(OAuthState.Verify("", state, now) == null, "missing secret refuses everything");
var parts = state.Split('.');
var forgedData = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(new string('A', 32) + "|https://evil.example"))
    .TrimEnd('=').Replace('+', '-').Replace('/', '_');
Check(OAuthState.Verify(secret, $"{parts[0]}.{forgedData}.{parts[2]}", now) == null, "tampered data refused");
Check(OAuthState.Verify(secret, null, now) == null && OAuthState.Verify(secret, "abc", now) == null
    && OAuthState.Verify(secret, Guid.NewGuid().ToString("N"), now) == null, "missing, malformed or unsigned state refused");

var allowed = new[] { "https://finhub.andykemp.cloud", "https://zealous-desert-06b17b603.2.azurestaticapps.net" };
Check(OAuthState.SafeOrigin("https://finhub.andykemp.cloud/settings", allowed) == "https://finhub.andykemp.cloud", "allowed origin kept");
Check(OAuthState.SafeOrigin("https://ZEALOUS-desert-06b17b603.2.azurestaticapps.net", allowed) == allowed[1], "origin match ignores case");
Check(OAuthState.SafeOrigin("https://evil.example", allowed) == allowed[0], "unknown origin falls back to default");
Check(OAuthState.SafeOrigin("https://finhub.andykemp.cloud.evil.example", allowed) == allowed[0], "lookalike host refused");
Check(OAuthState.SafeOrigin("//evil.example", allowed) == allowed[0] && OAuthState.SafeOrigin(null, allowed) == allowed[0], "relative or missing url falls back");
