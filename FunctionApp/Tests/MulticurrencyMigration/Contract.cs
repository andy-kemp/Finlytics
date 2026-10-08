using FinanceHubFunctions.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;

internal static class Contract
{
    internal const string Target = "20261008120000_AddMulticurrencyMetadata";
    internal static readonly IReadOnlyDictionary<string, string> RecordColumns = new Dictionary<string, string>
    {
        ["OriginalCurrency"] = "nvarchar(3)",
        ["OriginalAmountNet"] = "decimal(18,2)",
        ["OriginalVatAmount"] = "decimal(18,2)",
        ["OriginalAmountGross"] = "decimal(18,2)",
        ["ExchangeRateToGbp"] = "decimal(18,8)",
        ["ExchangeRateDate"] = "datetime2",
        ["ExchangeRateSource"] = "nvarchar(100)",
        ["EstimatedGbpGross"] = "decimal(18,2)",
        ["ActualGbpPaid"] = "decimal(18,2)",
        ["SettlementDate"] = "datetime2",
        ["SettlementBankTransactionId"] = "int"
    };
    internal static readonly IReadOnlyDictionary<string, string> BankColumns = new Dictionary<string, string>
    {
        ["OriginalCurrency"] = "nvarchar(3)", ["OriginalAmount"] = "decimal(18,2)"
    };
    internal static IEnumerable<(string Table, string Column, string Type)> Columns =>
        new[] { "Expenses", "DlaEntries" }.SelectMany(table => RecordColumns.Select(column => (table, column.Key, column.Value)))
            .Concat(BankColumns.Select(column => ("BankTransactions", column.Key, column.Value)));

    internal static FinanceHubDbContext CreateContext(string connectionString) =>
        new(new DbContextOptionsBuilder<FinanceHubDbContext>().UseSqlServer(connectionString).Options);

    internal static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    internal static void RunOffline()
    {
        using var context = CreateContext("Server=offline.invalid;Database=finlytics-fx-test-offline;Integrated Security=true;Encrypt=true");
        var assembly = context.GetService<IMigrationsAssembly>();
        Require(assembly.Migrations.ContainsKey(Target), "Actual migration not discovered.");
        Require(assembly.Migrations.Keys.Last() == Target, "Harness must be reviewed when later migrations are added.");
        var migration = assembly.CreateMigration(assembly.Migrations[Target], context.Database.ProviderName!);
        var expected = Columns.ToArray();
        Require(expected.Length == 24 && migration.UpOperations.Count == expected.Length, "Metadata operation count mismatch.");
        var operations = migration.UpOperations.Cast<SqlOperation>().Select(operation => operation.Sql).ToArray();
        foreach (var column in expected)
        {
            var sql = $"IF COL_LENGTH(N'dbo.{column.Table}', N'{column.Column}') IS NULL ALTER TABLE [dbo].[{column.Table}] ADD [{column.Column}] {column.Type} NULL;";
            Require(operations.Count(operation => operation == sql) == 1, "Actual Up contract mismatch.");
            var entity = migration.TargetModel.GetEntityTypes().Single(entity => entity.GetTableName() == column.Table);
            var property = entity.FindProperty(column.Column);
            Require(property is not null && property.IsNullable && property.GetColumnType() == column.Type, "Target model metadata mismatch.");
        }
        var snapshot = assembly.ModelSnapshot!.Model;
        Require(migration.TargetModel.GetEntityTypes().Count() == snapshot.GetEntityTypes().Count() &&
            migration.TargetModel.GetEntityTypes().Count() > 3, "Incomplete target model.");
        foreach (var entity in snapshot.GetEntityTypes())
        {
            var targetEntity = migration.TargetModel.FindEntityType(entity.Name)!;
            Require(targetEntity is not null, "Missing target entity.");
            Require(entity.GetProperties().Select(property => (property.Name, property.ClrType, property.IsNullable, property.GetColumnType()))
                .SequenceEqual(targetEntity!.GetProperties().Select(property => (property.Name, property.ClrType, property.IsNullable, property.GetColumnType()))), "Snapshot property mismatch.");
        }
        var previous = assembly.Migrations.Keys.Where(id => string.CompareOrdinal(id, Target) < 0).Last();
        var script = context.GetService<IMigrator>().GenerateScript(previous, Target);
        Require(script.Contains(Target) && expected.All(column => script.Contains($"ADD [{column.Column}]")), "EF SQL generation failed.");
        Require(!script.Contains("CREATE TABLE [Expenses]") && !script.Contains("UPDATE ["), "EF script unexpectedly touches legacy data.");
        foreach (var database in new[] { "", "master", "Finlytics", "finlytics-fx-test-", "FINLYTICS-fx-test-safe", "other-finlytics-fx-test-safe", "finlytics-fx-test-safe;DROP", "finlytics-fx-test-safe\n" })
            ExpectFailure(() => Safety.ValidateDatabase(database));
        var builder = Safety.Parse("Server=offline.invalid;Database=finlytics-fx-test-safe;Authentication=Active Directory Azure CLI;Encrypt=true");
        using var cliConnection = Safety.CreateConnection(builder);
        Require(builder.AzureCli && cliConnection.AccessTokenCallback is not null &&
            builder.Builder.Authentication == Microsoft.Data.SqlClient.SqlAuthenticationMethod.NotSpecified, "Azure CLI alias did not select explicit token callback.");
        ExpectFailure(() => Safety.Parse("Server=offline.invalid;Database=finlytics-fx-test-safe;Authentication=Active Directory Azure CLI;Password=not-a-secret"));
        ExpectFailure(() => Safety.Parse("Server=offline.invalid;Database=Finlytics;Encrypt=true"));
        ExpectFailure(() => Safety.Parse("Server=offline.invalid;Database=finlytics-fx-test-safe;TrustServerCertificate=true"));
        ExpectFailure(() => Safety.Parse("Server=offline.invalid;Database=finlytics-fx-test-safe;Encrypt=false"));
        Require(SqlBatches.Split("SELECT 1;\r\nGO\r\nSELECT 2;\n go 2 -- repeat").Count == 3, "GO count handling failed.");
        Require(SqlBatches.Split("SELECT 'start\nGO\nend';\n/* outer\n/* nested */\nGO\n*/\nSELECT [start\nGO\nend], \"start\nGO\nend\";\nGO\nSELECT 'it''s GO'; -- GO").Count == 2, "GO lexical handling failed.");
        ExpectFailure(() => SqlBatches.Split("SELECT 1\nGO 0"));
        ExpectFailure(() => SqlBatches.Split("SELECT 'unterminated"));
        Require(SqlBatches.Split(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Add-Multicurrency-Metadata.sql"))).Count > 0, "Manual SQL missing.");
        Console.WriteLine($"Offline contracts passed: {expected.Length} nullable columns, full {snapshot.GetEntityTypes().Count()}-entity target model, real EF SQL generation, database guards, CLI auth parsing, GO splitting.");
    }

    private static void ExpectFailure(Action action)
    {
        try { action(); }
        catch (InvalidOperationException) { return; }
        throw new InvalidOperationException("Expected rejection did not occur.");
    }
}