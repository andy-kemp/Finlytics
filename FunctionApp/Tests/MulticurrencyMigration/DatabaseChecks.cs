using System.Data;
using FinanceHubFunctions.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

internal sealed class DatabaseChecks
{
    private readonly SqlConnection connection;
    private readonly string database;
    private readonly Dictionary<string, int> ownedTables = new();
    private static readonly string[] Tables = ["Expenses", "DlaEntries", "BankTransactions", "__EFMigrationsHistory"];

    private DatabaseChecks(SqlConnection connection, string database)
    {
        this.connection = connection;
        this.database = database;
    }

    internal static async Task RunAsync(TestConnection settings, bool cleanup)
    {
        var builder = settings.Builder;
        await using var connection = Safety.CreateConnection(settings);
        await connection.OpenAsync();
        var checks = new DatabaseChecks(connection, builder.InitialCatalog);
        await checks.VerifyDatabaseAsync();
        Console.WriteLine($"Connected to guarded test database {builder.InitialCatalog}; server fingerprint {Safety.ServerFingerprint(builder.DataSource)}. No credentials or server address logged.");
        await checks.ExecuteAsync("DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource=N'FinlyticsMulticurrencyHarness', @LockMode='Exclusive', @LockOwner='Session', @LockTimeout=0; IF @result < 0 THROW 51000, 'Test harness lock unavailable', 1;");
        Contract.Require(Convert.ToInt32(await checks.ScalarAsync("SELECT COUNT(*) FROM sys.objects WHERE is_ms_shipped=0")) == 0,
            "Refusing a nonempty database. This harness never adopts existing objects.");
        try
        {
            await checks.PrepareAsync();
            await checks.MigrateTwiceAsync();
            await checks.VerifyAsync();
            await checks.RoundTripAsync();
            Console.WriteLine("PASS: EF migration and rerun, migration history, metadata schema, untouched legacy GBP, EUR round trips.");
            await checks.CleanupAsync();
            await checks.PrepareAsync();
            var script = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Add-Multicurrency-Metadata.sql"));
            for (var repeat = 0; repeat < 2; repeat++)
            {
                foreach (var batch in SqlBatches.Split(script)) await checks.ExecuteAsync(batch);
                await checks.VerifyAsync();
            }
            await checks.MigrateTwiceAsync();
            await checks.VerifyAsync();
            await checks.RoundTripAsync();
            Console.WriteLine("PASS: manual SQL twice, followed by EF migration and rerun, unchanged GBP and EUR metadata.");
        }
        finally
        {
            if (cleanup) await checks.CleanupAsync();
            else if (checks.ownedTables.Count > 0)
                Console.WriteLine("Fixture objects retained in the dedicated database. A new run requires a fresh empty test database. Use --execute --cleanup on the initial run to remove only its fixture tables.");
        }
    }

    private FinanceHubDbContext Context() => new(new DbContextOptionsBuilder<FinanceHubDbContext>().UseSqlServer(connection).Options);

    private async Task VerifyDatabaseAsync()
    {
        var actual = Convert.ToString(await ScalarAsync("SELECT DB_NAME()"))!;
        Safety.ValidateDatabase(actual);
        Contract.Require(string.Equals(actual, database, StringComparison.Ordinal), "Connected database differs from explicit test catalog.");
    }

    private async Task PrepareAsync()
    {
        await VerifyDatabaseAsync();
        using var context = Context();
        var migrations = context.GetService<IMigrationsAssembly>().Migrations.Keys.ToArray();
        Contract.Require(migrations.Last() == Contract.Target, "Newer migrations require harness review.");
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
        await ExecuteAsync("""
            CREATE TABLE dbo.Expenses (Id int NOT NULL PRIMARY KEY, AmountNet decimal(18,2) NULL, VATAmount decimal(18,2) NULL, AmountGross decimal(18,2) NULL, EntryDate datetime2 NULL);
            CREATE TABLE dbo.DlaEntries (Id int NOT NULL PRIMARY KEY, AmountNet decimal(18,2) NOT NULL, VatAmount decimal(18,2) NOT NULL, AmountGross decimal(18,2) NOT NULL, EntryDate datetime2 NOT NULL);
            CREATE TABLE dbo.BankTransactions (Id int NOT NULL PRIMARY KEY, Amount decimal(18,2) NULL, TransactionDate datetime2 NULL);
            CREATE TABLE dbo.__EFMigrationsHistory (MigrationId nvarchar(150) NOT NULL PRIMARY KEY, ProductVersion nvarchar(32) NOT NULL);
            INSERT dbo.Expenses VALUES (1,100.25,20.05,120.30,'2024-02-29T12:34:56.1234567'),(2,50.00,0.00,50.00,'2025-12-31T23:59:59.7654321');
            INSERT dbo.DlaEntries VALUES (1,80.25,16.05,96.30,'2024-02-29T12:34:56.1234567'),(2,-30.00,0.00,-30.00,'2025-12-31T23:59:59.7654321');
            INSERT dbo.BankTransactions VALUES (1,-120.30,'2024-02-29T12:34:56.1234567'),(2,50.00,'2025-12-31T23:59:59.7654321');
            """, transaction);
        foreach (var migration in migrations.Where(id => string.CompareOrdinal(id, Contract.Target) < 0))
        {
            using var command = new SqlCommand("INSERT dbo.__EFMigrationsHistory (MigrationId, ProductVersion) VALUES (@id,N'8.0.11')", connection, transaction);
            command.Parameters.Add("@id", SqlDbType.NVarChar, 150).Value = migration;
            await command.ExecuteNonQueryAsync();
        }
        foreach (var table in Tables)
            ownedTables[table] = Convert.ToInt32(await ScalarAsync($"SELECT OBJECT_ID(N'dbo.{table}',N'U')", transaction));
        await transaction.CommitAsync();
        Console.WriteLine($"Prepared minimal legacy fixture; seeded {migrations.Length - 1} preceding history entries without executing their migrations.");
    }

    private async Task MigrateTwiceAsync()
    {
        await VerifyDatabaseAsync();
        for (var repeat = 0; repeat < 2; repeat++)
        {
            using var context = Context();
            var pending = (await context.Database.GetPendingMigrationsAsync()).ToArray();
            Contract.Require(repeat == 0 ? pending.SequenceEqual(new[] { Contract.Target }) : pending.Length == 0, "Unexpected pending migrations.");
            await context.GetService<IMigrator>().MigrateAsync(Contract.Target);
            Contract.Require(!(await context.Database.GetPendingMigrationsAsync()).Any(), "Pending migration after migrate.");
            Contract.Require(Convert.ToInt32(await ScalarAsync($"SELECT COUNT(*) FROM dbo.__EFMigrationsHistory WHERE MigrationId=N'{Contract.Target}' AND ProductVersion=N'8.0.11'")) == 1, "Target history missing or duplicated.");
            Contract.Require(Convert.ToInt32(await ScalarAsync("SELECT COUNT(*) FROM dbo.__EFMigrationsHistory")) == context.GetService<IMigrationsAssembly>().Migrations.Count, "Unexpected history entries.");
            await VerifyAsync();
        }
    }

    private async Task VerifyAsync()
    {
        var schema = new Dictionary<(string, string), (string Type, bool Nullable)>();
        using (var command = new SqlCommand("""
            SELECT t.name,c.name,ty.name,c.max_length,c.precision,c.scale,c.is_nullable,c.default_object_id,c.is_computed
            FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
            JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
            WHERE s.name=N'dbo' AND t.name IN (N'Expenses',N'DlaEntries',N'BankTransactions')
            """, connection))
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                var type = reader.GetString(2);
                type = type switch
                {
                    "nvarchar" => $"nvarchar({reader.GetInt16(3) / 2})",
                    "decimal" => $"decimal({reader.GetByte(4)},{reader.GetByte(5)})",
                    "datetime2" when reader.GetByte(5) != 7 => $"datetime2({reader.GetByte(5)})",
                    _ => type
                };
                schema.Add((reader.GetString(0), reader.GetString(1)), (type, reader.GetBoolean(6)));
                if (Contract.Columns.Any(column => column.Table == reader.GetString(0) && column.Column == reader.GetString(1)))
                    Contract.Require(reader.GetInt32(7) == 0 && !reader.GetBoolean(8), "Metadata must not have defaults or computed expressions.");
            }
        }
        Contract.Require(schema.Count == 37, "Unexpected total fixture column count.");
        foreach (var column in Contract.Columns)
            Contract.Require(schema.TryGetValue((column.Table, column.Column), out var actual) && actual == (column.Type, true), "Metadata type or nullability mismatch.");
        foreach (var table in new[] { "Expenses", "DlaEntries" })
        {
            var vatColumn = table == "Expenses" ? "VATAmount" : "VatAmount";
            var original = table == "Expenses"
                ? "(1,100.25,20.05,120.30,CONVERT(datetime2,'2024-02-29T12:34:56.1234567')),(2,50.00,0.00,50.00,CONVERT(datetime2,'2025-12-31T23:59:59.7654321'))"
                : "(1,80.25,16.05,96.30,CONVERT(datetime2,'2024-02-29T12:34:56.1234567')),(2,-30.00,0.00,-30.00,CONVERT(datetime2,'2025-12-31T23:59:59.7654321'))";
            Contract.Require(Convert.ToInt32(await ScalarAsync($"SELECT COUNT(*) FROM (SELECT Id,AmountNet,[{vatColumn}],AmountGross,EntryDate FROM dbo.[{table}] WHERE Id IN (1,2) INTERSECT SELECT * FROM (VALUES {original}) expected(Id,AmountNet,VatAmount,AmountGross,EntryDate)) unchanged")) == 2, "Legacy GBP values changed.");
            var nonNull = string.Join(" OR ", Contract.RecordColumns.Keys.Select(column => $"[{column}] IS NOT NULL"));
            Contract.Require(Convert.ToInt32(await ScalarAsync($"SELECT COUNT(*) FROM dbo.[{table}] WHERE Id IN (1,2) AND ({nonNull})")) == 0, "Legacy metadata no longer NULL.");
        }
        Contract.Require(Convert.ToInt32(await ScalarAsync("""
            SELECT COUNT(*) FROM (SELECT Id,Amount,TransactionDate FROM dbo.BankTransactions WHERE Id IN (1,2)
            INTERSECT SELECT * FROM (VALUES (1,-120.30,CONVERT(datetime2,'2024-02-29T12:34:56.1234567')),(2,50.00,CONVERT(datetime2,'2025-12-31T23:59:59.7654321'))) expected(Id,Amount,TransactionDate)) unchanged
            """)) == 2, "Legacy bank values changed.");
        Contract.Require(Convert.ToInt32(await ScalarAsync("SELECT COUNT(*) FROM dbo.BankTransactions WHERE Id IN (1,2) AND (OriginalCurrency IS NOT NULL OR OriginalAmount IS NOT NULL)")) == 0, "Legacy bank metadata changed.");
    }

    private async Task RoundTripAsync()
    {
        foreach (var table in new[] { "Expenses", "DlaEntries" })
        {
            var vatColumn = table == "Expenses" ? "VATAmount" : "VatAmount";
            await ExecuteAsync($"""
                INSERT dbo.[{table}] (Id,AmountNet,[{vatColumn}],AmountGross,EntryDate,OriginalCurrency,OriginalAmountNet,OriginalVatAmount,OriginalAmountGross,ExchangeRateToGbp,ExchangeRateDate,ExchangeRateSource,EstimatedGbpGross,ActualGbpPaid,SettlementDate,SettlementBankTransactionId)
                VALUES (3,85.00,17.00,102.00,'2026-10-08',N'EUR',100.00,20.00,120.00,0.85012345,'2026-10-07',N'harness',102.01,103.45,'2026-10-08',3);
                """);
            Contract.Require(Convert.ToInt32(await ScalarAsync($"""
                SELECT COUNT(*) FROM dbo.[{table}] WHERE Id=3 AND AmountNet=85.00 AND [{vatColumn}]=17.00 AND AmountGross=102.00 AND EntryDate='2026-10-08'
                AND OriginalCurrency=N'EUR' AND OriginalAmountNet=100.00 AND OriginalVatAmount=20.00 AND OriginalAmountGross=120.00
                AND ExchangeRateToGbp=0.85012345 AND ExchangeRateDate='2026-10-07' AND ExchangeRateSource=N'harness'
                AND EstimatedGbpGross=102.01 AND ActualGbpPaid=103.45 AND SettlementDate='2026-10-08' AND SettlementBankTransactionId=3
                """)) == 1, "EUR metadata round trip failed.");
        }
        await ExecuteAsync("INSERT dbo.BankTransactions (Id,Amount,TransactionDate,OriginalCurrency,OriginalAmount) VALUES (3,-103.45,'2026-10-08',N'EUR',-120.00)");
        Contract.Require(Convert.ToInt32(await ScalarAsync("SELECT COUNT(*) FROM dbo.BankTransactions WHERE Id=3 AND Amount=-103.45 AND TransactionDate='2026-10-08' AND OriginalCurrency=N'EUR' AND OriginalAmount=-120.00")) == 1, "EUR bank round trip failed.");
        await VerifyAsync();
    }

    private async Task CleanupAsync()
    {
        if (ownedTables.Count == 0) return;
        await VerifyDatabaseAsync();
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
        foreach (var table in Tables)
        {
            Contract.Require(ownedTables.TryGetValue(table, out var expectedId) &&
                Convert.ToInt32(await ScalarAsync($"SELECT OBJECT_ID(N'dbo.{table}',N'U')", transaction)) == expectedId,
                "Cleanup refused: object ownership changed.");
        }
        foreach (var table in Tables) await ExecuteAsync($"DROP TABLE dbo.[{table}]", transaction);
        await transaction.CommitAsync();
        ownedTables.Clear();
        Console.WriteLine("Removed only the four fixture tables owned by this run. Database itself was not deleted.");
    }

    private async Task ExecuteAsync(string sql, SqlTransaction? transaction = null)
    {
        using var command = new SqlCommand(sql, connection, transaction) { CommandTimeout = 60 };
        await command.ExecuteNonQueryAsync();
    }

    private async Task<object?> ScalarAsync(string sql, SqlTransaction? transaction = null)
    {
        using var command = new SqlCommand(sql, connection, transaction) { CommandTimeout = 60 };
        return await command.ExecuteScalarAsync();
    }
}