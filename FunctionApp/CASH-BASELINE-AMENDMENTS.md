# Read-Only Historical Expense Amendments

No new HTTP writer, schema, migration, import or automatic persistence is provided.
Only an independently reviewed administrative utility may append an owner-approved
historical bank-expense amendment. This workspace change does not run that utility
or connect to production. Never rewrite the original baseline amount, notes,
snapshot timestamp, hash, pending expenses or recorded cash at creation.

## Storage Contract

Use `CompanyLedger.EntryType = "Cash_BaselineAmendment"`, `Amount = 563.95` for
the approved example, and `EffectiveDate = recordedAtUtc.Date`. Populate existing
period/tax-year fields normally. Notes begin with the exact account marker
`[CASH-BASELINE-AMENDMENT:{bankAccountId}]\n` followed by compact camelCase JSON:

```json
{
  "bankAccountId": 1,
  "baselineLedgerEntryId": 99,
  "amount": 563.95,
  "reason": "Owner approved ten historical bank expense additions; approval and bank evidence retained separately",
  "expenseIds": [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
  "externalIds": ["example-1", "example-2", "example-3", "example-4", "example-5", "example-6", "example-7", "example-8", "example-9", "example-10"],
  "recordedAtUtc": "2026-10-09T12:00:00Z",
  "ledgerEntryId": 0
}
```

These IDs and timestamp are illustrative, not approval or bank evidence. The
canonical typed record is `CashBaselineAmendmentRecord`; use
`CashBaselineAmendmentPolicy.Notes(record)` and the shared strict
`CashBaselinePolicy.Json` options. A standalone administrative project must link
both policy source files and their model dependencies, as the offline harness does.
`ledgerEntryId` is optional in stored JSON, defaults to zero before insertion,
and is always projected from the actual ledger primary key on GET. A nonzero
stored ID must match that key. The timestamp field is **recordedAtUtc**, never
`createdAt` or `createdAtUtc`. Notes must fit the existing 2,000-character limit;
never truncate or bypass it through a migration.

Before any separately approved write, the administrative utility must verify the
sole active GBP account, actual baseline ID, original historical outgoing bank
payments and their original penny sum, payment dates on/before the baseline date,
and that these expenses were additions absent from the original retained source
export. Retain explicit owner approval and provenance in `reason` and secure
evidence. Match each `expenseIds` item to the corresponding `externalIds` item.
No pending baseline expense may be compensated again. Validate the candidate
together with all existing amendment rows using `Compose`, and insert under a
serializable transaction to prevent simultaneous duplicate source IDs. This is a
requirement for that separate utility, not a writer implemented here.

## Read And Display Contract

The existing dedicated-authorisation baseline GET returns every original field,
plus `historicalExpenseAdjustment` (decimal sum, zero without amendments) and
`amendments` (array, empty without amendments). Original notes lacking these
trailing optional fields still deserialize. Derived fields must not be embedded
as non-default values in original baseline notes.

Each amendment response has exactly these fields: `bankAccountId`,
`baselineLedgerEntryId`, `amount`, `reason`, `expenseIds`, `externalIds`,
`recordedAtUtc`, `ledgerEntryId`. Rows are ordered by actual amendment ledger ID.
Reads require exact marker/type/account/baseline linkage, positive GBP pennies
equal to ledger Amount, a bounded reason, a UTC recording date between the
baseline snapshot and now, matching ledger date, unique existing expense IDs,
and equally sized unique external IDs. Reused expense/external IDs across
amendments, pending external IDs, missing expenses, malformed metadata and orphan
amendments fail closed with 409. Wrong-account or wrong-type candidate rows are
not silently discarded. Generic ledger creation/deletion protect the reserved
type and case-insensitive forged markers. No amendments endpoint exists.

The read checks prove record integrity, not original bank payment amounts or
owner consent. Current expense amounts are deliberately **not** summed to replace
the approved immutable amount. Subsequent amount/date/status edits continue
through raw cash changes; deleting a referenced expense makes the amendment
invalid rather than silently retaining an unsupported credit.

```text
main account book balance = original bookBalance
    + historicalExpenseAdjustment
    + currentRawCash - recordedCashAtCreation
    + eligible signed internal transfers

1029.15 + 563.95 + 3274.79 - 3871.03 = 996.86
```

The ten approved historical additions total 563.95; the two original pending
expenses total 32.29 and still reduce the display once when recorded. This is an
explicit display amendment, not reconciled historical books. The dashboard shows
the amendment total and each audit's reason, timestamp, expense/external IDs and
both ledger IDs separately from source changes and internal transfers.
`RecordedCashSources.Calculate`, recorded period cash flow, CT and VAT calculations
ignore the amendment ledger amount. No raw amount or tax calculation is rewritten.

## Offline Checks

```sh
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/CashBaseline/CashBaseline.Tests.csproj
DOTNET_PATH=/tmp/finlytics-dotnet/dotnet node --test FunctionApp/Tests/cash-baseline-contract.test.mjs FunctionApp/Tests/cash-baseline-amendment-contract.test.mjs
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/VatSettlementIntegration/VatSettlementIntegration.Tests.csproj -- --offline
/tmp/finlytics-dotnet/dotnet build FunctionApp/FinanceHubFunctions.csproj --no-restore -p:FunctionsEnableExecutorSourceGen=false
npm --prefix StaticWebApp test
npm --prefix StaticWebApp run build
```

Do not start the Functions host for these tests: startup can migrate its configured
database. SQL-backed reads and administrative insertion concurrency are not
exercised by the offline checks.