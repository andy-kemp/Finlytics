# Bank Feed Reconciliation

CSV imports and Monzo API transactions can identify the same payment with
different IDs (`mm_...` and `tx_...`). Keep both IDs on one bank row rather than
creating a second accounting movement.

## Matching And Review

- Match existing IDs first, scoped to the bank account.
- Compare exact exported UTC and UK-local timestamps before using the wider
  fingerprint window. Legacy CSV rows may have date-only timestamps.
- Exact timestamps distinguish nearby payments with the same amount.
- A same-day CSV/API amount and direction conflict is a review candidate, not
  proof that the payments are identical. Do not silently merge or discard it.
- CSV batch imports refuse potential cross-feed conflicts before saving rows.
- Monthly reconciliation refuses selected payments with cross-feed conflicts,
  even when the other row was not selected or is already reconciled.
- Banking withholds unrecorded totals and blocks payment review while duplicate
  payment candidates remain. Pot transfers are not expenses.
- Banking and Dashboard both request the full company ledger for book cash.
  Failed bank reads must not substitute all-time company cash for bank balances.

## Audited Cleanup On 10 October 2026

The owner-approved cleanup merged 32 strongly evidenced duplicate pairs in a
single serializable SQL transaction. Original CSV rows were retained for 31
pairs, with the Monzo transaction ID added. For one older pair, the already
reconciled API row was retained and given the CSV external ID, preserving its
existing accounting link.

The utility checked timestamp/merchant evidence, one-to-one pairing, foreign-key
references and ledger markers. A full business-table before/after comparison
allowed only the approved bank-row removals and identifier/timestamp edits.
Invoices, expenses, reconciliation links, tax records, ledger entries, baselines
and amendments were unchanged. Private snapshots and the merge plan are retained
in the owner's local Finlytics audit directory, not in this repository.

| Check | Before | After |
| --- | ---: | ---: |
| Recorded company cash | GBP 3,209.79 | GBP 3,209.79 |
| Net pot transfers after baseline | GBP 510.64 | GBP 255.32 |
| Main-account book balance | GBP 1,507.50 | GBP 1,252.18 |

Three bank payments totalling GBP 53.15 remained unrecorded as expenses. Creating
those expenses once would reduce book cash to GBP 1,199.03, provided no other
cash movements occur. This cleanup did not create expenses or claim VAT.

The temporary single-IP SQL firewall rule was removed after the transaction.

## Focused Checks

```sh
dotnet run --project FunctionApp/Tests/MonzoSync/MonzoSync.Tests.csproj
node --test FunctionApp/Tests/bank-duplicates-contract.test.mjs
node --test StaticWebApp/src/utils/bankAttention.test.mjs StaticWebApp/src/utils/cashBaseline.test.mjs
```