# Bank CSV Reconciliation

Banking > Import CSV opens a read-only preview before saving new bank transactions.
The preview preserves bank IDs separately from payment references, compares recorded
paid invoices, expenses, DLA payments and company-ledger cash movements, and flags
ambiguous matches, missing app payments and app payments absent from the statement.
These are suggestions only: importing a statement does not create expenses or invoices,
mark invoices paid, or apply reconciliation links. Use Reconciliation to confirm links.

Invalid rows and inconsistent running balances block import. Known bank IDs are skipped
per account, including repeats within a file. Existing reconciled rows are retained.
Different IDs are retained even when other transaction fields are identical. Identical
rows without stable bank IDs use a conservative fallback. Concurrent uploads are not
protected by a database uniqueness constraint; do not import simultaneously.

## Monzo Statement Check

The supplied 8 October 2026 export contains 75 transactions from 15 March to 3 October:

| Measure | GBP |
| --- | ---: |
| Opening main account balance | 0.00 |
| Total credited to main account | 58,625.52 |
| Total debited from main account | 57,628.66 |
| Closing main account balance | 996.86 |
| Net movement from main account into pots | 1,719.79 |
| Net external cash movement, excluding pot transfers | 2,716.65 |

All 75 running balances agree with the signed transaction amounts. Pot transfers
move money between company accounts; they are not income, expenses or tax payments.
The net pot movement does not establish total pot balances unless opening pot balances
were zero and the export includes all pot movements. Main-account cash must be reconciled
separately from total company cash and estimated tax reserves.

App records have not yet been compared against production: the available browser session
was signed out. In particular, check small non-invoice receipts, merchant refunds, VAT
refunds/payments, dividend payment dates, and unreferred director transfers rather than
forcing every credit into invoice income or every director transfer into DLA.

## Validation

Run `npm test` and `npm run build` from StaticWebApp. Set `BANK_CSV_PATH` to a local
bank export to include the optional full-export regression test. Private bank data is
not stored in the repository. Backend and frontend changes must be deployed together
because the comparison uses `companyledger/all`. Backend compilation requires .NET 8.