# Audited Main-Account Cash Baseline

Backend only. No schema changes, opening-balance edits, accounting corrections,
bank imports, tax changes, or automatic production writes. Historical discrepancies
remain in the source records. This is a main-account display baseline, not
multi-account cash allocation or evidence that the historical books reconcile.

## API

`GET /api/bank/accounts/{id:int}/cash-baseline` returns a camelCase baseline object,
or JSON `null` when no baseline exists. `POST` on the same route creates it once.
Both require the existing `SettlementAuthService` delegated owner authorization,
including `Settlement.Write`. Authentication precedes JSON parsing and database
access. No Graph calls, keys, or additional authentication configuration are needed.

Creation requires exactly one active GBP bank account, and the requested ID must
be that account. The existing account model has no separate business-account flag;
this feature assumes the sole active GBP account is the company's business account.
Other currencies and multi-account routing are unsupported.

POST accepts only these fields (example only; not executed):

```json
{
  "bookBalance": 1029.15,
  "statementBalance": 996.86,
  "asOfDate": "2026-10-03",
  "reason": "Owner approved unchanged Oct 3 statement on Oct 8; historical discrepancy retained; no additional interest adjustment",
  "pendingExpenses": [
    { "externalId": "actual-bank-external-id-for-paddle", "amount": 19.99, "paymentDate": "2026-10-03", "description": "Paddle" },
    { "externalId": "actual-bank-external-id-for-kittys", "amount": 12.30, "paymentDate": "2026-10-02", "description": "Kittys" }
  ]
}
```

External IDs in this example are placeholders, not bank evidence. Supply actual
identifiers from the owner's statement/export. No server-side CSV fetch occurs.
Amounts are GBP pennies; dates must be explicit `yyyy-MM-dd`, not timestamps.
The reason records owner consent and statement provenance, not server verification
of those documents. The endpoint does not assert independent interest proof.

The pending sum must satisfy `bookBalance = statementBalance + pendingExpenses`:
1029.15 = 996.86 + 19.99 + 12.30. Unimported bank rows are permitted as explicit
owner attestations. Imported candidates must uniquely match external/provider ID,
account, outgoing amount and payment day, and must not be internal transfers,
reconciled, matched, or linked to an expense, DLA record or VAT bank ledger marker.
Missing pending expenses are not silently treated as recorded expenses, imported,
reconciled, or created by this endpoint.

Cash movements recorded after the cutoff through snapshot time, or any imported
target-account bank transaction dated after the cutoff, block historical creation.
Record creation/modification dates are not cash dates. Future unpaid invoices,
expenses and reserves do not themselves block creation. This conservatively
requires the approved last transaction to remain unchanged since October 3.

Identical retries return the original record, including the original ledger ID,
snapshot time and hash, without recomputing it. Changes to any submitted value,
including reason or pending-item order, return 409. Duplicate/ambiguous audit
records also return 409. Creation runs in a serializable EF transaction under the
existing execution strategy; uncertain persistence failures return 503 and instruct
the caller to retry the identical request.

## Storage And Response

One CompanyLedger entry uses `EntryType = 'Cash_Baseline'`, `Amount = bookBalance`,
the cutoff as `EffectiveDate`, and notes consisting of
`[CASH-BASELINE:{bankAccountId}]\n` followed by compact JSON metadata. There is no
new database column, index or migration. Metadata over the existing 2,000-character
notes limit is rejected, never truncated. Generic ledger creation refuses the
reserved type or any case-insensitive baseline marker; generic deletion refuses
either. There is no update or force-reset workflow.

The response fields are `bankAccountId`, `bookBalance`, `statementBalance`,
`asOfDate`, `recordedCashAtCreation`, `snapshotAtUtc`, `pendingExpenses`,
`sourceSnapshotHash`, `reason`, and `ledgerEntryId`. Audit fields additionally
include `internalTransferSnapshot` with `{id, externalId, signedAmount}` movements
for all existing target-account internal transfers, plus `recordCounts`.
The ledger ID is assigned on creation and projected from the ledger primary key
on reads; notes store zero for that field before the generated ID is available.

`sourceSnapshotHash` is lowercase SHA-256 of the full JSON-serialized records,
ordered by database ID within each collection: invoices, expenses, DLA entries,
DLA payments, non-baseline ledger, payroll settings/runs, bank accounts and bank
transactions. It also includes the payroll inclusion flag. No 2,000-row sampling
or financial-field-only projection occurs. The full source blobs are not stored
in notes, returned by the API, logged, or written locally. A separate securely
retained source export is needed to independently reproduce the hash; a hash
alone cannot reconstruct historical records.

## Cash And Future Display Contract

Authoritative C# raw cash preserves the existing recorded-cash helper:

- Paid invoice gross receipts on `datePaid ?? dateIssued`.
- Non-DLA expenses on `settlementDate ?? datePaid`, using `actualGbpPaid ?? amountGross`.
- DLA payment direction from its loan; OwedToCompany loans use gross and `datePaid ?? entryDate`.
- VAT refunds and unlinked DLA inflows, less paid dividends, corporation tax, VAT and DLA outflows.
- Linked DLA ledger copies, startup titles, explicit references and legacy note references are excluded.
- Payroll cash is included when employer PAYE settings are configured or payroll runs exist.
- Cash_Baseline has no raw cash contribution; profit, VAT and tax formulas are unchanged.

For a later main-account display, use:

```text
bookBalance + (currentRawCash - recordedCashAtCreation)
            + eligible signed internal transfers
```

Only target-account internal transfers dated strictly after `asOfDate` and no
later than the display date are eligible. Direction In is positive, Out negative.
The classification matches the existing helper: category `Internal Transfer` or
description containing `pot transfer`. All existing transfers must be on/before
the cutoff at creation, so their audited movement snapshot contributes zero to
the later-transfer adjustment. Newly imported historical pot transfers on/before
the cutoff also contribute zero. Transfers after the cutoff count even if imported
later; do not filter them by record creation time. No pot-interest adjustment is
invented. Never show a balance for a date before the baseline cutoff.

Raw cash deltas include **all** subsequently changed source cash, including new
backdated records, edits, deletions and status changes. Recording Paddle and Kittys
later reduces the book balance once, from 1029.15 to 996.86. A historical edit is
not neutralized by moving the snapshot or rewriting the baseline. A future UI
should explicitly annotate historical changes against the retained audit record;
this backend change does not implement that UI. No frontend models, helpers or
bank CSVs were modified as part of this implementation.

## Offline Verification

```sh
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/CashBaseline/CashBaseline.Tests.csproj
DOTNET_PATH=/tmp/finlytics-dotnet/dotnet node --test FunctionApp/Tests/cash-baseline-contract.test.mjs
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/VatSettlementIntegration/VatSettlementIntegration.Tests.csproj -- --offline
/tmp/finlytics-dotnet/dotnet build FunctionApp/FinanceHubFunctions.csproj --no-restore -p:FunctionsEnableExecutorSourceGen=false
```

The C# policy harness runs first to build the fixture emitter used by the Node
parity test. The handler harness uses locally signed RSA tokens and a connection
denial interceptor: it verifies auth-before-body/DB and reserved creation guards
without opening a database. SQL-backed insertion, simultaneous creation and
transaction retries are not exercised by these offline checks. Do not run the
Functions host against production for testing; startup may migrate the database.