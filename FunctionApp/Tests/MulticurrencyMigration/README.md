# Multicurrency Migration Validation

Standalone .NET 8 executable linking the actual FinanceHub context, models, snapshot
and migration sources. It does not reference or start the Functions host. No
application configuration is loaded. No database is created or deleted.

## Offline Checks

From the repository root:

```sh
/tmp/finlytics-dotnet/dotnet build FunctionApp/Tests/MulticurrencyMigration/MulticurrencyMigration.csproj --nologo
/tmp/finlytics-dotnet/dotnet run --no-build --project FunctionApp/Tests/MulticurrencyMigration/MulticurrencyMigration.csproj -- --offline
node --test FunctionApp/Tests/MulticurrencyMigration/offline.test.mjs
node FunctionApp/Tests/MulticurrencyMigration/generate-designer.mjs --check
```

Default invocation is also offline, even if the connection environment variable is
set. Offline checks discover the actual migration, inspect its actual `UpOperations`,
generate its SQL with EF `IMigrator`, compare the full target model to the snapshot,
and validate database guards, CLI callback configuration and lexical `GO` splitting.
They never acquire a token or open a connection. The subprocess tests exercise only
offline or pre-connection refusal paths.

**Column count:** the current migration adds **24**, not 26, nullable columns:
11 each on Expenses and DlaEntries, and two on BankTransactions. Every one is
checked, including type, precision/scale, absence of defaults and legacy NULLs.
Two additional fields would require an explicit model/migration change.

## User-Run SQL Validation

Use an **empty temporary test database**, never a clone containing application data.
The user must complete CLI login, arrange access for that identity, and configure
network access themselves. This harness does not provision resources, change firewall
rules, run login, invoke application endpoints, or inspect production databases.

The database name must start with the exact lowercase prefix `finlytics-fx-test-`,
followed by a nonempty lowercase alphanumeric/hyphen suffix. All other names,
including production catalogs, are refused. The connected `DB_NAME()` must match
the requested catalog exactly. Verified encrypted TLS is required; attached files,
failover partners and user instances are forbidden. The prefix is a safety boundary,
not permission to rename or point at production: use a genuinely dedicated test DB.

Set the connection locally, replacing these nonsecret placeholders:

```sh
export FINLYTICS_MIGRATION_TEST_CONNECTION='Server=tcp:YOUR_TEST_SERVER.database.windows.net,1433;Database=finlytics-fx-test-YOUR_LOWERCASE_SUFFIX;Authentication=Active Directory Azure CLI;Encrypt=true;TrustServerCertificate=false'
/tmp/finlytics-dotnet/dotnet run --no-build --project FunctionApp/Tests/MulticurrencyMigration/MulticurrencyMigration.csproj -- --execute --cleanup
unset FINLYTICS_MIGRATION_TEST_CONNECTION
```

`Authentication=Active Directory Azure CLI` is a **harness alias**, not a native
SqlClient 5.2.2 authentication value. Structured parsing removes that mode from
the driver string and sets `AccessTokenCallback` using Azure.Identity's
`AzureCliCredential` for `https://database.windows.net/.default`. There is no
default-credential-chain fallback and no CLI subprocess until the user explicitly
executes the database path. SQL credentials/integrated security cannot accompany
this alias. Other driver-native authentication modes are accepted.

Only the validated database name and a one-way server fingerprint are printed.
Connection strings, addresses, credentials, tokens and provider exception details
are suppressed. Exit code 0 means the requested mode passed; 1 means failure;
2 means `--execute` lacked its connection environment variable and SQL checks
were skipped. An offline pass is not evidence of database execution.

## Scenarios And Cleanup

An exclusive database-scoped application lock prevents concurrent harness runs.
Existing user objects cause refusal before fixture creation. Fixture setup uses a
transaction and creates only `dbo.Expenses`, `dbo.DlaEntries`,
`dbo.BankTransactions` and `dbo.__EFMigrationsHistory`. These are minimal legacy
tables, not a complete application schema. Legacy decimal amounts and leap-day /
year-end `datetime2(7)` values are seeded using the real legacy column names.

All discovered migration IDs preceding the target are recorded in history without
executing them. This fixture history is valid **only for this isolated test**.

1. Actual EF `IMigrator.MigrateAsync` applies only
   `20261008120000_AddMulticurrencyMetadata`. A second invocation has no pending
   migrations. History contains exactly one target entry. Metadata is nullable,
   legacy amounts/dates are unchanged, and EUR metadata (including `ActualGbpPaid`)
   round-trips through raw SQL on all three tables.
2. The run's fixture tables are removed and recreated. The actual
   Add-Multicurrency-Metadata.sql file executes twice, using a lexical `GO` splitter
   supporting case-insensitive standalone separators, repeat counts and `--`
   suffixes while preserving literals, quoted identifiers and nested comments.
   Both executions are checked. EF then applies the target over existing columns,
   reruns without changes, and verifies the same history and EUR contracts.

No full-entity EF queries run against the minimal schema. No `EnsureCreated`,
`EnsureDeleted`, migration `Down`, database drop, or earlier migration execution
is used. A later discovered migration makes the offline contract fail for review.

`--cleanup` removes only the four tables created by **this invocation**, on success
or failure. Cleanup rechecks the database identity and all four recorded SQL object
IDs before dropping anything, inside a transaction. Unknown/replaced objects cause
refusal. Without `--cleanup`, the final fixture is retained for inspection and a
subsequent invocation refuses that nonempty database. There is intentionally no
cross-run cleanup/adoption mode. A connection/process failure can leave fixture
objects behind; inspect them yourself rather than bypassing the empty-DB guard.

## Designer Generation

The missing multicurrency designer is a full frozen copy of the current snapshot's
model body, overriding `BuildTargetModel`; it does not delegate to a mutable snapshot.
The reproducible mechanical generator is scoped to this one migration:

```sh
node FunctionApp/Tests/MulticurrencyMigration/generate-designer.mjs
```

Use this only while finalizing this migration, not after future snapshot changes.
`--check` validates current parity without editing files.
