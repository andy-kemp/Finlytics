# Isolated VAT Settlement Integration Harness

Console tests link the actual VatSettlementFunctions method, SettlementAuthService,
FinanceHubDbContext, all models and required helpers. No application startup,
Functions host, migrations, production configuration or live identity metadata.
Fake Worker requests/responses use an InstanceServices WorkerOptions JSON serializer.
Tokens use random synthetic tenant/audience/owner GUIDs, ephemeral RSA signing and
fixed offline OpenID metadata, following the SettlementAuth harness pattern.

## Offline First

```sh
/tmp/finlytics-dotnet/dotnet build FunctionApp/Tests/VatSettlementIntegration/VatSettlementIntegration.Tests.csproj -v:q -clp:ErrorsOnly
/tmp/finlytics-dotnet/dotnet run --no-build --project FunctionApp/Tests/VatSettlementIntegration/VatSettlementIntegration.Tests.csproj -- --offline
```

No arguments also means offline. Checks exercise actual handler 401/400 responses,
zero database connection attempts, valid local signatures, database guard rejection
and full EF schema generation. Existing source model nullable warnings are unchanged.

## Explicit SQL Run

The operator must supply an **already-created, empty, dedicated Azure SQL database**.
Do not use an application database, restored data or shared test database. Required
catalog prefix is exactly `finlytics-vat-test-`, with a lowercase alphanumeric/hyphen
suffix (3-61 characters); names containing `financehub` are rejected. Azure SQL
`.database.windows.net` hosts only. No passwords, connection-string authentication
or integrated security. TLS is mandatory; certificate validation cannot be disabled.

```sh
export FINLYTICS_VAT_TEST_CONNECTION='Server=tcp:YOUR-TEST-SERVER.database.windows.net,1433;Database=finlytics-vat-test-YOUR-LOWERCASE-SUFFIX;Encrypt=True;TrustServerCertificate=False'
/tmp/finlytics-dotnet/dotnet run --no-build --project FunctionApp/Tests/VatSettlementIntegration/VatSettlementIntegration.Tests.csproj -- --database
```

Replace both placeholders before running. The existing Azure CLI login must have
SQL data-plane permissions to create tables and read/write this test database only.
The SqlClient AccessTokenCallback uses AzureCliCredential and the fixed Azure SQL
scope, not DefaultAzureCredential, application credentials or production auth.

The preflight opens only the guarded catalog, verifies DB_NAME and no user tables,
then EnsureCreated creates the full context schema. It never creates a database.
Initial seeds are synthetic VAT returns, one GBP account and bank transactions;
all other tables remain empty until synthetic ledger/reconciliation guard fixtures
are needed. Run sequentially, once per fresh database. No concurrency claim is made.

## SQL Coverage

- Actual handler: GBP 1,000 Out payment and GBP 1,500 In refund with a difference reason.
- One positive-amount VAT ledger entry and one correctly owned Manual reconciliation;
  bank amounts and all filed VAT figures/claims remain unchanged.
- Identical retries preserve ledger identity and write nothing; changed amounts,
  dates, references, reasons and bank relinks conflict.
- Wrong bank amount/date/direction, cross-return same cash amount/date (even with
  markers), duplicate bank reuse, legacy cash and ambiguous existing markers.
- Unrelated reconciliation and ledger bank markers prevent reuse.
- Second SaveChanges fault after actual ledger insertion verifies serializable
  transaction rollback of ledger/match/bank state; identical recovery creates one entry.
- Database-backed ordinary GET policy projection matches POST JSON. The full GET
  handler is not invoked; its source contract is tested separately.

SQL cases are compiled but are not proven by offline execution. The harness does
not verify concurrent races or inject transport/commit failures. Rejections compare
fresh database snapshots, not tracked objects. Final expected counts are seven
ledger entries (three settlements plus four guard fixtures) and three matches.

## Cleanup

The harness deliberately never drops tables, deletes fixtures or calls EnsureDeleted.
It retains the whole isolated database on success and failure for inspection.
The operator must delete **that entire dedicated test database externally**, checking
its full name/prefix first, and provision a new empty database for the next run.
No production financial writes, migrations, commits, pushes or deployment are involved.
