using System.Globalization;
using System.Net;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Functions;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

static class DatabaseTests
{
    private static readonly AzureCliCredential credential = new();
    private static readonly Func<SqlAuthenticationParameters, CancellationToken, Task<SqlAuthenticationToken>> tokenCallback =
        async (_, cancellationToken) =>
        {
            var access = await credential.GetTokenAsync(new TokenRequestContext(new[] { "https://database.windows.net/.default" }), cancellationToken);
            return new SqlAuthenticationToken(access.Token, access.ExpiresOn);
        };

    public static async Task Run(string guardedConnectionString, SettlementAuthService auth, string token)
    {
        SqlConnection Connection() => new(guardedConnectionString) { AccessTokenCallback = tokenCallback };
        FinanceHubDbContext Context(params IInterceptor[] interceptors) => new(new DbContextOptionsBuilder<FinanceHubDbContext>()
            .UseSqlServer(Connection(), contextOwnsConnection: true, sqlServerOptionsAction: options => options.CommandTimeout(30))
            .AddInterceptors(interceptors).Options);
        var database = new SqlConnectionStringBuilder(guardedConnectionString).InitialCatalog;
        Console.WriteLine($"SQL target: {database}; synthetic fixtures only; database is retained on success/failure.");
        await using (var connection = Connection())
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT CASE WHEN DB_NAME() = @database THEN (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0) ELSE -1 END";
            command.Parameters.AddWithValue("@database", database);
            Require(Convert.ToInt32(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture) == 0,
                "Existing dedicated database is empty (no user tables)");
        }
        await using (var db = Context())
        {
            Require(await db.Database.EnsureCreatedAsync(), "Full context schema created without migrations or host");
        }

        var date = DateTime.UtcNow.Date.AddDays(-10);
        VatReturn Return(decimal owed, string label) => new()
        {
            QuarterLabel = "Synthetic " + label, MonthsLabel = "Synthetic period",
            QuarterStartDate = date.AddMonths(-4), QuarterEndDate = date.AddMonths(-1),
            VatIn = owed > 0 ? owed + 200 : 200, VatOut = owed > 0 ? 200 : 200 - owed, VatOwed = owed,
            FiledDate = date.AddDays(-2), Status = "Filed", Reference = "SYNTHETIC-FILING",
            Notes = "Synthetic integration fixture", CreatedDate = date.AddDays(-2), ModifiedDate = date.AddDays(-2)
        };
        var payment = Return(1000, "payment");
        var refund = Return(-1499.82m, "refund adjustment");
        var other = Return(1000, "cross-return");
        var rollback = Return(777, "rollback");
        var legacyReturn = Return(333, "legacy");
        var blockedReturn = Return(444, "reserved bank");
        var ambiguousReturn = Return(222, "ambiguous markers");
        var account = new BankAccount { AccountName = "Synthetic current account", Currency = "GBP", IsActive = true };
        BankTransaction Bank(decimal amount, string direction, DateTime on) => new()
        {
            Amount = amount, Direction = direction, TransactionDate = on, Description = "SYNTHETIC VAT CASH",
            Source = "Manual", CreatedDate = date, ModifiedDate = date
        };
        var paidBank = Bank(-1000, "Out", date);
        var refundBank = Bank(1500, "In", date.AddDays(1));
        var rollbackBank = Bank(-777, "Out", date.AddDays(2));
        var reservedBank = Bank(-444, "Out", date.AddDays(4));
        var alternateBank = Bank(-1000, "Out", date);
        var banks = new[] { paidBank, refundBank, rollbackBank, reservedBank, alternateBank };
        await using (var db = Context())
        {
            db.VatReturns.AddRange(payment, refund, other, rollback, legacyReturn, blockedReturn, ambiguousReturn);
            db.BankAccounts.Add(account);
            await db.SaveChangesAsync();
            foreach (var bank in banks) bank.BankAccountId = account.Id;
            db.BankTransactions.AddRange(banks);
            await db.SaveChangesAsync();
        }
        string originalReturns;
        await using (var db = Context()) originalReturns = JsonSerializer.Serialize(await db.VatReturns.AsNoTracking().OrderBy(record => record.Id).ToListAsync());
        string Body(decimal amount, DateTime on, int? bankId = null, string reference = "SYNTHETIC CASH", string? reason = null) =>
            JsonSerializer.Serialize(new { amount, settlementDate = on.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                bankTransactionId = bankId, reference, differenceReason = reason });
        async Task<JsonElement> Call(string name, int id, string body, HttpStatusCode expected, params IInterceptor[] interceptors)
        {
            await using var db = Context(interceptors);
            var response = await new VatSettlementFunctions(db, auth, NullLogger<VatSettlementFunctions>.Instance)
                .SettleVatReturn(new TestRequest(body, token), id);
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            Require(response.StatusCode == expected, $"{name}: expected {(int)expected}, got {(int)response.StatusCode}; {json.RootElement}");
            return json.RootElement.Clone();
        }
        async Task<string> Snapshot()
        {
            await using var db = Context();
            return JsonSerializer.Serialize(new
            {
                returns = await db.VatReturns.AsNoTracking().OrderBy(record => record.Id).ToListAsync(),
                ledger = await db.CompanyLedger.AsNoTracking().OrderBy(entry => entry.Id).ToListAsync(),
                matches = await db.ReconciliationMatches.AsNoTracking().OrderBy(match => match.Id).ToListAsync(),
                transactions = await db.BankTransactions.AsNoTracking().OrderBy(bank => bank.Id).ToListAsync()
            });
        }
        async Task NoWrite(string name, int id, string body, HttpStatusCode expected, params IInterceptor[] interceptors)
        {
            var before = await Snapshot();
            await Call(name, id, body, expected, interceptors);
            Require(await Snapshot() == before, name + ": all VAT figures, ledger, matches and bank state unchanged");
        }
        async Task GenericDuplicate(string type, decimal amount, DateTime on)
        {
            var before = await Snapshot();
            await using var db = Context();
            var body = JsonSerializer.Serialize(new CompanyLedgerEntry
            {
                EntryType = type, Amount = amount, EffectiveDate = on, Title = "Synthetic generic VAT cash",
                PeriodKey = on.ToString("yyyy-MM", CultureInfo.InvariantCulture), TaxYear = on.Year,
                Notes = "Synthetic unmarked generic cash"
            });
            var response = await new CompanyLedgerFunctions(NullLoggerFactory.Instance,
                new TestCompanyLedgerRepository(db), new DeletionGuardService(db), db)
                .CreateCompanyLedgerEntry(new TestRequest(body, null));
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            Require(response.StatusCode == HttpStatusCode.Conflict
                && json.RootElement.GetProperty("error").GetString()!.Contains("review required", StringComparison.Ordinal),
                $"Generic {type} duplicate: explicit 409 review response; {json.RootElement}");
            Require(await Snapshot() == before,
                $"Generic {type} duplicate: VAT figures, ledger, matches and bank state unchanged");
        }
        async Task VerifySettlement(VatReturn record, BankTransaction bank, JsonElement response, decimal amount, string type, string status)
        {
            await using var db = Context();
            var marker = VatSettlementPolicy.Marker(record.Id);
            var entries = await db.CompanyLedger.AsNoTracking().Where(entry => entry.Notes != null && entry.Notes.Contains(marker)).ToListAsync();
            Require(entries.Count == 1 && entries[0].Amount == amount && entries[0].EntryType == type,
                $"{status}: amount={amount}, linked ledger count=1, type={type}");
            var entry = entries.Single();
            var matches = await db.ReconciliationMatches.AsNoTracking().Where(match => match.BankTransactionId == bank.Id).ToListAsync();
            var savedBank = await db.BankTransactions.AsNoTracking().SingleAsync(item => item.Id == bank.Id);
            Require(matches.Count == 1 && matches[0].RelatedType == "CompanyLedger"
                && matches[0].RelatedId == entry.Id.ToString(CultureInfo.InvariantCulture) && matches[0].MatchType == "Manual"
                && savedBank.IsReconciled && savedBank.ReconciledOn.HasValue && savedBank.Amount == bank.Amount,
                status + ": exactly one reconciliation points to the new ledger; bank amount unchanged");
            Require(response.GetProperty("settlementLedgerEntryId").GetInt32() == entry.Id
                && response.GetProperty("settlementAmount").GetDecimal() == amount
                && response.GetProperty("settlementStatus").GetString() == status
                && response.GetProperty("settlementBankTransactionId").GetInt32() == bank.Id,
                status + ": actual HTTP JSON projection correct");
            var savedReturn = await db.VatReturns.AsNoTracking().SingleAsync(item => item.Id == record.Id);
            var projection = JsonSerializer.SerializeToElement(VatSettlementPolicy.Project(savedReturn, entry));
            Require(projection.EnumerateObject().All(property => response.TryGetProperty(property.Name, out var actual)
                && (property.Value.ValueKind == JsonValueKind.Number && actual.ValueKind == JsonValueKind.Number
                    ? property.Value.GetDecimal() == actual.GetDecimal()
                    : property.Value.GetRawText() == actual.GetRawText())),
                status + ": database-backed ordinary GET policy projection matches POST");
        }

        await NoWrite("Wrong bank amount", payment.Id, Body(999, date, paidBank.Id, reason: "synthetic difference"), HttpStatusCode.BadRequest);
        await NoWrite("Wrong bank date", payment.Id, Body(1000, date.AddDays(-1), paidBank.Id), HttpStatusCode.BadRequest);
        await NoWrite("Wrong bank direction", payment.Id, Body(1500, date.AddDays(1), refundBank.Id, reason: "synthetic difference"), HttpStatusCode.BadRequest);
        var paymentBody = Body(1000, date, paidBank.Id);
        var paidResponse = await Call("Out bank payment", payment.Id, paymentBody, HttpStatusCode.OK);
        await VerifySettlement(payment, paidBank, paidResponse, 1000, "VAT_Paid", "Paid");
        await GenericDuplicate("VAT_Paid", 1000, date.AddHours(12));
        await NoWrite("Identical payment retry", payment.Id, paymentBody, HttpStatusCode.OK);
        var retry = await Call("Retry returns same ledger ID", payment.Id, paymentBody, HttpStatusCode.OK);
        Require(retry.GetProperty("settlementLedgerEntryId").GetInt32() == paidResponse.GetProperty("settlementLedgerEntryId").GetInt32(), "Retry preserves ledger identity");
        await NoWrite("Changed amount retry", payment.Id, Body(1001, date, paidBank.Id, reason: "synthetic difference"), HttpStatusCode.Conflict);
        await NoWrite("Changed date retry", payment.Id, Body(1000, date.AddDays(-1), paidBank.Id), HttpStatusCode.Conflict);
        await NoWrite("Changed reference retry", payment.Id, Body(1000, date, paidBank.Id, "different"), HttpStatusCode.Conflict);
        await NoWrite("Protected bank relink", payment.Id, Body(1000, date, alternateBank.Id), HttpStatusCode.Conflict);
        await NoWrite("Duplicate bank reuse by another return", other.Id, Body(1000, date, paidBank.Id), HttpStatusCode.Conflict);
        await NoWrite("Cross-return same cash amount/date without bank", other.Id, Body(1000, date), HttpStatusCode.Conflict);
        var refundBody = Body(1500, date.AddDays(1), refundBank.Id, reason: "Synthetic HMRC adjustment");
        var refundResponse = await Call("In bank refund", refund.Id, refundBody, HttpStatusCode.OK);
        await VerifySettlement(refund, refundBank, refundResponse, 1500, "VAT_Reclaim", "RefundReceived");
        await GenericDuplicate("VAT_Reclaim", 1500, date.AddDays(1));
        await NoWrite("Identical refund retry", refund.Id, refundBody, HttpStatusCode.OK);
        await NoWrite("Changed refund reason", refund.Id, Body(1500, date.AddDays(1), refundBank.Id, reason: "different"), HttpStatusCode.Conflict);

        var failure = new FailSecondSave();
        await NoWrite("Rollback after ledger insert before reconciliation save", rollback.Id,
            Body(777, date.AddDays(2), rollbackBank.Id), HttpStatusCode.ServiceUnavailable, failure);
        Require(failure.SaveAttempts == 2, "Rollback probe reached second SaveChanges after ledger insert");
        var recovered = await Call("Identical request succeeds after rollback", rollback.Id,
            Body(777, date.AddDays(2), rollbackBank.Id), HttpStatusCode.OK);
        await VerifySettlement(rollback, rollbackBank, recovered, 777, "VAT_Paid", "Paid");

        CompanyLedgerEntry Legacy(decimal amount, DateTime on, string? notes) => new()
        {
            EntryType = "VAT_Paid", Title = "Synthetic guard fixture", Amount = amount, EffectiveDate = on,
            PeriodKey = on.ToString("yyyy-MM", CultureInfo.InvariantCulture), TaxYear = on.Year, Notes = notes
        };
        await using (var db = Context())
        {
            db.CompanyLedger.Add(Legacy(333, date.AddDays(3), "Synthetic unmarked legacy cash"));
            var ambiguousRequest = new VatSettlementRequest { Amount = 222, SettlementDate = date.AddDays(5), Reference = "SYNTHETIC CASH" };
            db.CompanyLedger.AddRange(Legacy(222, date.AddDays(5), VatSettlementPolicy.Notes(ambiguousReturn.Id, ambiguousRequest)),
                Legacy(222, date.AddDays(5), VatSettlementPolicy.Notes(ambiguousReturn.Id, ambiguousRequest)));
            db.ReconciliationMatches.Add(new ReconciliationMatch
            {
                BankTransactionId = reservedBank.Id, RelatedType = "Other", RelatedId = "synthetic-owner", MatchType = "Manual", CreatedDate = date
            });
            await db.SaveChangesAsync();
        }
        await NoWrite("Unmarked legacy cash requires review", legacyReturn.Id, Body(333, date.AddDays(3)), HttpStatusCode.Conflict);
        await GenericDuplicate("VAT_Paid", 333, date.AddDays(3));
        await NoWrite("Ambiguous existing settlement markers", ambiguousReturn.Id, Body(222, date.AddDays(5)), HttpStatusCode.Conflict);
        await NoWrite("Unrelated reconciliation protects bank", blockedReturn.Id, Body(444, date.AddDays(4), reservedBank.Id), HttpStatusCode.Conflict);
        await using (var db = Context())
        {
            db.CompanyLedger.Add(Legacy(444, date.AddDays(4), VatSettlementPolicy.BankMarker(reservedBank.Id)));
            db.ReconciliationMatches.RemoveRange(await db.ReconciliationMatches.Where(match => match.BankTransactionId == reservedBank.Id).ToListAsync());
            await db.SaveChangesAsync();
        }
        await NoWrite("Ledger bank marker protects bank", blockedReturn.Id, Body(444, date.AddDays(4), reservedBank.Id), HttpStatusCode.Conflict);
        await using (var db = Context())
        {
            Require(originalReturns == JsonSerializer.Serialize(await db.VatReturns.AsNoTracking().OrderBy(record => record.Id).ToListAsync()),
                "Every seeded VAT filing figure, date, reference and claim remains unchanged");
            Require(await db.Expenses.CountAsync() == 0 && await db.DlaEntries.CountAsync() == 0, "No expense or DLA fixtures or financial writes");
            Require(await db.CompanyLedger.CountAsync() == 7 && await db.ReconciliationMatches.CountAsync() == 3,
                "Final ledger count=7 (3 settlements, 4 guard fixtures); reconciliation count=3");
        }
        Console.WriteLine($"SQL integration checks passed. Retained isolated database {database}; delete the entire test database externally.");
    }

    private static void Require(bool condition, string name)
    {
        if (!condition) throw new InvalidOperationException(name);
        Console.WriteLine("PASS " + name);
    }
}

sealed class FailSecondSave : SaveChangesInterceptor
{
    public int SaveAttempts { get; private set; }
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
        InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        if (++SaveAttempts == 2) throw new InvalidOperationException("Synthetic failure after ledger insert");
        return ValueTask.FromResult(result);
    }
}