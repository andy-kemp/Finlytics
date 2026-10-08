# Backend Multicurrency Contract

Expense and DLA accounting fields `amountNet`, `vatAmount` and `amountGross` remain GBP. The backend never converts them from original invoice amounts, estimates or bank settlement metadata. Foreign invoice tax stored in `originalVatAmount` is not evidence of reclaimable UK VAT. Clients must supply UK VAT treatment explicitly; retain zero GBP VAT unless a valid UK reclaim is separately established.

## JSON Fields

Expense, DLA and startup capture metadata use this exact camelCase contract:

- `originalCurrency`: GBP, EUR or USD, normalized to uppercase. New records without a code default to GBP. Legacy null means GBP without backfilling amounts or metadata.
- `originalAmountNet`, `originalVatAmount`, `originalAmountGross`: nullable original invoice amounts, SQL decimal(18,2). Foreign records require all three, non-negative net/tax, positive gross and net plus tax matching gross within 0.01.
- `exchangeRateToGbp`: nullable GBP per unit of original currency, SQL decimal(18,8), positive and representable when supplied. Foreign records require it.
- `exchangeRateDate`: nullable date/time for the invoice-date daily estimate. Foreign records require it. Use the provider's actual rate date, including its previous working day if applicable.
- `exchangeRateSource`: nullable source label, at most 100 characters. Foreign records require it.
- `estimatedGbpGross`: nullable GBP estimate, SQL decimal(18,2).
- `actualGbpPaid`: nullable confirmed GBP settlement amount, SQL decimal(18,2), requiring `settlementDate`.
- `settlementDate`: nullable settlement date/time; requires `actualGbpPaid`.
- `settlementBankTransactionId`: nullable positive integer bank transaction ID; requires `actualGbpPaid`.

Omitted update properties retain existing values, including legacy null metadata. Explicit null clears a nullable property only if the resulting record remains valid and is not a confirmed settlement. Confirmed settlements and their original invoice gross/currency are immutable. Invalid JSON numbers, unsupported currencies, out-of-range amounts and non-positive/unrepresentable rates return HTTP 400 with an `error` message.

Daily rates and estimates are supplied by the client; this backend adds no external rate-provider requests. Invoice and payment dates remain separate for foreign expense edits. Foreign recurring templates are skipped until a fresh invoice-date rate can be confirmed, rather than silently cloning stale rates or settlement metadata. SharePoint fallback cannot persist foreign metadata and rejects foreign writes.

Startup aggregate requests support the same metadata at the top level; itemised startup requests support it per item. Existing startup `totalAmount` and item accounting amounts remain GBP.

## Bank And OCR

Bank transactions persist nullable `originalCurrency` (nvarchar(3)) and `originalAmount` (decimal(18,2)). CSV parsing is frontend-owned: map Monzo **Local currency** to `originalCurrency` and **signed Local amount** to `originalAmount`. Monzo Currency/Amount remain the account's GBP debit. Import accepts and validates these fields; later edits that omit them preserve them. Existing duplicate import behavior is unchanged: duplicate rows are skipped, not enriched.

OCR uses the existing Azure.AI.FormRecognizer 4.1.0 `DocumentField.Value.AsCurrency().Code` API and returns `currency` alongside existing invoice output. Unknown currency returns null; `$` alone is never guessed as USD. Original OCR amounts remain in the extracted currency, not converted GBP. Explicit foreign tax may be returned as document tax, but unknown/foreign currency never triggers the fallback 20% UK VAT assumption. No OCR provider or model calls were added or changed.

## Confirmed Reconciliation

Monthly reconciliation is a client-reviewed proposal, not an automatic backend adjustment. Confirm a foreign Expense using `PATCH /api/expenses/{id:int}/gbp-settlement` with only these fields:

```json
{
  "actualGbpPaid": 101.23,
  "settlementDate": "2026-10-07",
  "settlementBankTransactionId": 42
}
```

`actualGbpPaid` must be positive and in whole pennies; `settlementDate` is required. Omit `settlementBankTransactionId` or send null for a manual confirmation. Unknown or duplicate JSON properties are rejected. The route accepts EUR/USD expenses only and changes only these three fields: invoice/tax metadata, GBP accounting amounts, DatePaid, EntryDate, tax/financial year, supplier, approval and all other expense fields remain untouched.

The browser calls the PATCH directly with a dedicated Entra API access token requested
using `VITE_SETTLEMENT_API_SCOPE`. The HTTP trigger permits the request to reach
`SettlementAuthService`, which validates signature, tenant, issuer, audience, expiry,
delegated scope and authorized owner before reading JSON or accessing the database.
Graph/ID tokens and Function keys cannot authorize it. See SETTLEMENT-AUTH.md for the
configured app registration and settings. Existing Clerk auth and other routes are unchanged.
Missing scope configuration disables browser confirmation. Imported rows are retained if
confirmation fails; ordinary expense PUT cannot bypass the protected settlement path.

## Frontend Workflow

GBP is the default for existing/new forms. Payee currency supplies a default; explicit
supported OCR invoice codes take precedence. Explicit unsupported codes block capture
rather than silently relabel amounts. Changing currencies invalidates the old rate and
requires renewed conversion/confirmation. Existing records are not bulk converted.

The user selects the invoice-day published rate (payment day can also be chosen), with
manual verified rates available if the provider is unavailable. Frankfurter's ECB daily
rates are estimates, not real-time bank quotes; weekends/holidays retain the provider's
previous published business date. Fetching a rate does not apply it until confirmed.
Foreign invoice tax is retained separately and not automatically treated as UK VAT.

Monthly GBP bank CSV uploads preserve original currency amounts and propose settlements
using original currency/gross plus merchant/reference and date evidence. Ambiguous or
shared matches cannot be auto-confirmed. Actual GBP changes cash calculations only;
invoice accounting and VAT fields remain untouched. FX gain/loss postings and statutory
report presentation of those differences remain out of scope. Director reimbursements
are not original invoice settlements: personal invoices require personal-bank evidence,
not a company reimbursement transfer.

Success is HTTP 200 with camelCase `{ id, actualGbpPaid, settlementDate, settlementBankTransactionId }`. The date is normalized to its calendar date. HTTP 400 returns `{ error }` for malformed or invalid settlement/bank metadata; 404 means the expense is absent; 409 means a different settlement already exists or the bank transaction is linked to another expense/DLA; 503 means confirmation failed and the exact request can be retried. Missing/invalid function credentials are rejected by the Functions host before invocation. Identical retries succeed without changing accounting values.

When a bank ID is supplied, SQL loads the actual transaction and account, requires an active GBP account (legacy null currency means GBP), `Out` direction, the absolute recorded GBP amount equal to actualGbpPaid exactly, and the same calendar transaction date. Available bank original currency and absolute original amount must match the invoice currency/gross. Clients cannot supply bank/account data in the request. A serializable transaction protects the existing confirmation and cross-table duplicate-link checks; SQL execution strategies retry transaction conflicts from a fresh tracked state. Expense, DLA and employee expense update paths also serialize and use execution strategies so ordinary writes cannot overwrite concurrent confirmations. Ordinary expense writes reject new bank links and direct settlement edits; use this PATCH instead.

DLA records, startup captures, and expenses marked IsDLA reject any company bank ID: the original invoice was paid personally, not by the company reimbursement. Manual foreign actualGbpPaid/settlementDate without a bank ID remains available via existing DLA create/update routes, with confirmed values protected from replacement. No automatic FX gain/loss posting or UK VAT recalculation occurs.

## Schema And Verification

The discoverable EF migration is `20261008120000_AddMulticurrencyMetadata`. Its designer
contains the complete frozen 31-entity target model and the snapshot includes the new columns.
`Program.cs` already calls `dbContext.Database.Migrate()` on application startup and logs
migration failures without preventing startup. Deployment can therefore apply the migration.
No new migration HTTP endpoint was added.

`Migrations/Add-Multicurrency-Metadata.sql` is an alternative authorized manual schema step. Both paths guard each column with COL_LENGTH and add nullable columns only, with no backfill or GBP data changes. The SQL script does not write EF migration history; a later EF run skips existing columns and records the migration. Existing schema/prior migrations must already be present. Rollback drops metadata columns and loses their values.

Live isolated SQL validation passed on 8 October 2026 using the empty Basic database
`finlytics-fx-test-20261008`. The actual EF migration/rerun, SQL script twice followed by
EF/rerun, migration history, 24 nullable columns, unchanged legacy GBP amounts/dates,
and EUR metadata round trips all passed. The harness removed its fixture tables and
the temporary database was deleted; only synthetic test rows were used. Production
schema/data was not modified. Identity settings were configured separately, without code
deployment. After release, verify production migration history and protected endpoint access.

A temporary .NET 8 SDK at `/tmp/finlytics-dotnet/dotnet` was used for the focused C# harness and full backend build without starting the function host. The NuGet 4.1.0 XML definition confirms CurrencyValue.Code. The pinned Worker SDK's oversized executor generator caused CS8078; `FunctionsEnableExecutorSourceGen=false` retains metadata generation and uses the standard invocation path. The build succeeds with existing warnings. These checks do not establish SQL isolation behavior, EF migration execution or HTTP authorization behavior. Run:

```sh
dotnet run --project FunctionApp/Tests/Multicurrency/Multicurrency.Tests.csproj
dotnet build FunctionApp/FinanceHubFunctions.csproj
node --test FunctionApp/Tests/multicurrency-contract.test.mjs
```

Then verify SQL rerun idempotence and EF application against an isolated SQL Server database, and exercise valid/invalid endpoint payloads. Do not use production for these checks.
