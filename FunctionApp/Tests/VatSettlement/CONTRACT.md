# VAT Settlement Backend Contract

No schema or migration changes. Filing a VAT return is not a cash movement.

## POST /vat-returns/{id:int}/settlement

Authorization: Bearer API access token validated by the existing
`SettlementAuthService`, including delegated `Settlement.Write` scope and allowed
owner object ID. Validation runs before reading the body or accessing the database.
Existing auth configuration and 47-check offline auth harness are reused.

```json
{
  "amount": 581.33,
  "settlementDate": "2026-10-08",
  "bankTransactionId": null,
  "reference": "HMRC refund reference",
  "differenceReason": "HMRC rounding adjustment"
}
```

`amount` is positive GBP expressed in whole pennies (581.33 means GBP 581.33,
not 58133 pennies). `settlementDate` is strictly yyyy-MM-dd, year greater than
2000, no future date. `bankTransactionId` is omitted/null or a positive integer.
`reference` is a required string; an empty string is allowed. `differenceReason`
is optional/null, but must be non-whitespace when amount differs from absolute
filed `vatOwed`. Metadata must fit the existing 2,000-character ledger Notes
column after JSON serialization. Reserved settlement markers in user text are
rejected. Unknown or duplicate payload fields are rejected (case-insensitive).

Only a Filed return with a filing date and nonzero vatOwed can settle. Positive
vatOwed creates VAT_Paid (Out); negative creates VAT_Reclaim (In). Sign comes
only from the filed return. Actual cash may differ, including 581.33 against
581.15 with a reason; VAT figures remain unchanged.

The serializable transaction creates exactly one positive-amount CompanyLedger
entry. Notes contain exact `[VAT-RETURN:{id}]`, optional `[BANK-TX:{id}]`, then
JSON containing the submitted reference, difference reason, amount, date and
bank ID. PeriodKey and UK TaxYear use the settlement date. Existing cash
calculations already include VAT_Paid and VAT_Reclaim; no cash formula changes.

Optional bank linkage requires an active GBP account, matching direction,
absolute amount and calendar date. Internal Transfer category is rejected,
including VAT/CT pot transfers; merchant descriptions are not hardcoded.
No unrelated ReconciliationMatch, expense/DLA settlement, other ledger bank
marker, or already-reconciled bank is accepted. A same-existing-settlement
retry may use its reconciled bank and own CompanyLedger match only. On initial
linkage one Manual ReconciliationMatch points to CompanyLedger/new ledger ID,
and bank IsReconciled is set in the same transaction.

An identical amount/date/bank/reference/reason retry returns 200 with the
existing ledger ID and no writes. Different settlement metadata or multiple
existing marker entries returns 409. Null and empty optional reason are distinct.
An unmarked legacy VAT cash ledger entry with the same actual amount/date
returns 409 requiring review; it is never deleted, adopted or duplicated.

Responses: 200 projected VAT return, 400 invalid input, 404 missing return,
409 settlement/link/review conflict, 401/403 existing auth failures, 503 auth
configuration/metadata unavailable or settlement failure (retry identical body).
No partial ledger or reconciliation write is committed on failure.

## GET /vat-returns

Preserves every existing camelCase VAT return property and adds exactly:

| Property | Values |
| --- | --- |
| settlementStatus | AwaitingPayment, AwaitingRefund, NoSettlementRequired, Paid, RefundReceived |
| settlementAmount | actual GBP decimal or null |
| settlementDate | ledger effective date or null |
| settlementBankTransactionId | linked bank ID or null |
| settlementLedgerEntryId | linked ledger ID or null |
| settlementReference | submitted cash settlement reference or null |

GET reads returns once and marker-linked ledger metadata in one batched query,
not one query per return. Missing/invalid metadata is never inferred from an
unmarked cash entry. Multiple ledger markers for the same return fail closed
instead of selecting an arbitrary payment.

## Mutation Guards

Settled VAT returns cannot be deleted. Their quarter dates, VAT in/out/owed,
filed date and filing status cannot change. Existing reference, notes, PDF and
label updates remain available. Omitted update properties preserve existing
filed values, allowing metadata-only updates. Checks and VAT writes are serializable.
Create deserializes only VatReturn fields, ignoring client settlement metadata.
Generic CompanyLedger creation cannot forge a VAT marker; deletion of a
VAT-marked ledger entry returns 409. Generic manual/auto reconciliation cannot
reuse its bank or rematch a VAT-marked ledger target. GBP expense settlement
checks reconciliation ownership and ledger bank markers before confirmation.

## Offline Validation

```sh
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/VatSettlement/VatSettlement.Tests.csproj
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/SettlementAuth/SettlementAuth.Tests.csproj
node --test FunctionApp/Tests/vat-settlement-contract.test.mjs FunctionApp/Tests/multicurrency-contract.test.mjs
/tmp/finlytics-dotnet/dotnet build FunctionApp/FinanceHubFunctions.csproj --no-restore -v:q -clp:ErrorsOnly
```

Policy checks and source contracts run without the Functions host or application
database. They do not prove SQL Server race behavior, rollback or EF query
translation; those require an isolated SQL Server integration environment.
No production transactions, migration, frontend, commit, push or deployment.