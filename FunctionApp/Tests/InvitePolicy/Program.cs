using FinanceHubFunctions.Helpers;

var now = new DateTime(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);
void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}

var invited = "Accountant@Example.co.uk";
Check(InvitePolicy.Check(now.AddDays(-1), invited, new[] { "accountant@example.co.uk" }, now) == InviteCheck.Ok, "matching email accepted, case-insensitive");
Check(InvitePolicy.Check(now.AddDays(-1), invited, new[] { "other@example.com", " accountant@example.co.uk " }, now) == InviteCheck.Ok, "any verified email may match");
Check(InvitePolicy.Check(now.AddDays(-1), invited, new[] { "attacker@example.com" }, now) == InviteCheck.EmailMismatch, "different email refused");
Check(InvitePolicy.Check(now.AddDays(-1), invited, Array.Empty<string>(), now) == InviteCheck.EmailUnverified, "unknown signed-in email reported");
Check(InvitePolicy.Check(now.AddDays(-14), invited, new[] { invited }, now) == InviteCheck.Ok, "invite valid for 14 days");
Check(InvitePolicy.Check(now.AddDays(-14).AddMinutes(-1), invited, new[] { invited }, now) == InviteCheck.Expired, "invite expires after 14 days");
Check(InvitePolicy.Check(now.AddDays(-1), null, Array.Empty<string>(), now) == InviteCheck.Ok, "invite without an email only checks expiry");
