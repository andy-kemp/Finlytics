# Dated Actual Pot Balances

Backend-only API, with no schema changes. Both routes use the existing
`SettlementAuthService` owner/delegated-scope authorization before accessing
the database; POST authorizes before reading the body. See [SETTLEMENT-AUTH.md](SETTLEMENT-AUTH.md).
The account must exist and be the sole active GBP account, as enforced by
`CashBaselinePolicy.ValidateAccount`. No automatic production write or seed is included.

## Routes

- `GET /api/bank/accounts/{id}/pot-balances`: HTTP 200 with the latest snapshot,
  or JSON `null` when no snapshot exists. Latest means greatest `asOfDate`, then
  greatest `ledgerEntryId` for same-day corrections, not latest recording time.
- `POST /api/bank/accounts/{id}/pot-balances`: HTTP 200 with the created snapshot
  or the matching existing audit snapshot for an identical retry.

Request example using the owner's actual balances, including any interest
already reflected in those balances:

```json
{
  "vatPotBalance": 650.00,
  "ctPotBalance": 1071.82,
  "asOfDate": "2026-10-08",
  "reference": "Owner-confirmed actual pot balances including interest"
}
```

Only those four fields are accepted. Both amounts are required JSON numbers,
nonnegative GBP whole pennies, at most `9999999999999999.99` each. Zero is valid.
`asOfDate` is required in exact `yyyy-MM-dd` format from `2000-01-01` through
today in UTC. `reference` is required, nonblank, and at most 250 characters.
Malformed JSON, duplicate field names (including case variants), unknown
fields, oversized bodies or invalid values return HTTP 400. Missing accounts
return 404; unsupported account routing or invalid stored audits return 409.
Authorization failures retain the service's 401/403/503 status; database failures
return 503. Do not run the Functions host against production for local testing.

Response fields are `bankAccountId`, `vatPotBalance`, `ctPotBalance`, `asOfDate`,
`recordedAtUtc`, `reference`, and `ledgerEntryId`. The recording timestamp is
server-generated UTC and the ledger ID identifies the persisted audit record.

## Audit Semantics

Snapshots use existing `CompanyLedger` rows with reserved `EntryType`
`Bank_PotSnapshot`, zero `Amount`, and `EffectiveDate` equal to `asOfDate`.
`Notes` contains `[POT-BALANCES:{accountId}]`, a newline, then compact camelCase
JSON of the complete response, within the existing 2000-character limit.
The newly allocated ledger ID is filled into that new row within the same
serializable transaction before commit. Existing audit rows are never overwritten.
Generic ledger creation rejects the reserved type or forged marker, and generic
deletion rejects such records even when the general deletion guard permits deletion.

An identical account/date/balances/reference retry returns the existing matching
record and creates no additional row. Changed values or reference on the same
date append a correction; GET subsequently selects its higher ledger ID.
Older dated records may also be appended without displacing a newer dated record.
Later cash movements and bank imports do not block recording a dated assertion.
A retry of an older or superseded assertion returns its original ID; GET remains
the authoritative latest snapshot lookup.

## Accounting Boundary

These are actual owner-asserted pot balances, not tax estimates, tax liabilities,
bank feeds, settlement entries, or changes to the accepted book-cash baseline.
The reserved type is ignored by existing type-based cash movements and profit
aggregates. Recording a snapshot does not move money or recognize income.

There is no interest-amount field or automatic interest computation. Balances can
include interest already credited, but cannot establish how much interest income
was earned; that needs separately evidenced accounting records.

The frontend owns pair totals and presentation alongside the accepted book view.
Any future pot-transfer UI should keep showing these dated balances as stale until
another snapshot is recorded. Do not automatically project later incoming transfers
into pots: their attribution is not established by this snapshot API.

## Offline Checks

```sh
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/CashBaseline/CashBaseline.Tests.csproj
node --test FunctionApp/Tests/pot-balances-contract.test.mjs FunctionApp/Tests/cash-baseline-contract.test.mjs
/tmp/finlytics-dotnet/dotnet build FunctionApp/FinanceHubFunctions.csproj --no-restore
```