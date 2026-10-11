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

## Daily Tax Pot Email

Monzo automatically syncs at 05:30, 13:30 and 19:30 UTC each day. In the UK these
are 06:30, 14:30 and 20:30 during BST, and the UTC times during GMT. Afternoon
and evening runs refresh bank data without sending the daily tax-pot digest.

After a successful scheduled Monzo sync (05:30 UTC), the app emails a comparison
of the freshly fetched VAT/CT pots against saved-record estimates. Each row shows
the actual balance, estimated amount due and either an estimated surplus to
withdraw, a top-up needed, or a matching balance. No bank transfers are made.

Recipient selection: `TaxPotNotificationEmail`, then `MonzoNotificationEmail`,
then the default company's `CompanyEmail` or `Email`. Set
`TaxPotDailyEmailEnabled=false` to disable the digest. Existing system SMTP
configuration sends the message; no new email provider is required.

The scheduled timer sends at most one successful digest per UK calendar day,
using `MonzoTaxPotDigestSentOn` in Key Vault. Manual transaction syncs do not send
digests. The sent date is saved only after SMTP reports success. An ambiguous
SMTP failure may still mean the recipient received the email; exactly-once
delivery cannot be guaranteed by SMTP. Notification failures do not roll back
successful bank syncs.

If Monzo cannot connect, existing reconnect notifications remain in effect.
Missing tax pots or unresolved bank-sync warnings suppress transfer suggestions
and the digest is skipped, with the reason recorded in application logs.

VAT covers unfiled quarters using the dashboard's saved-record rules. CT includes
allowable expenses, DLA-funded costs, taxable interest, applicable payroll and
recorded CT payments. Both are estimates, not final HMRC liabilities.
Browser-local manual VAT adjustments cannot be read by the scheduled backend and
are explicitly excluded in the email. Review the dashboard before withdrawing
funds, particularly when receipts or expenses are still unrecorded.

## Focused Checks

```sh
dotnet run --project FunctionApp/Tests/MonzoSync/MonzoSync.Tests.csproj
node --test FunctionApp/Tests/bank-duplicates-contract.test.mjs
node --test StaticWebApp/src/utils/bankAttention.test.mjs StaticWebApp/src/utils/cashBaseline.test.mjs
```