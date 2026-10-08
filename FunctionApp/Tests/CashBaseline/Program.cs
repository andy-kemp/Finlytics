using System.Text.Json;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;

var now = new DateTime(2026, 10, 8, 12, 0, 0, DateTimeKind.Utc);
var cutoff = new DateTime(2026, 10, 3);
void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}
var request = new CashBaselineRequest(1029.15m, 996.86m, "2026-10-03", "Owner approved unchanged statement; historical discrepancy retained",
    new() { new("paddle", 19.99m, "2026-10-03", "Paddle"), new("kittys", 12.30m, "2026-10-02", "Kittys") });
var sources = new RecordedCashSources
{
    Invoices = new() { new() { Id = 1, Status = "Paid", DateIssued = cutoff, AmountGross = 4800 } },
    Expenses = new() { new() { Id = 1, DatePaid = cutoff, SettlementDate = cutoff, ActualGbpPaid = 75, AmountGross = 78 },
        new() { Id = 2, IsDLA = true, DatePaid = cutoff, AmountGross = 200 }, new() { Id = 3, AmountGross = 500 } },
    DlaEntries = new() { new() { DlaId = "loan", Direction = "OwedToCompany", EntryDate = cutoff, AmountGross = 500 },
        new() { DlaId = "DLA-2026-0001", AmountGross = 100 } },
    DlaPayments = new() { new() { DlaId = "loan", PaymentDate = cutoff, Amount = 300 },
        new() { DlaId = "DLA-2026-0001", PaymentDate = cutoff, Amount = 100 } },
    LedgerEntries = new()
    {
        new() { EntryType = "VAT_Reclaim", Amount = 100, EffectiveDate = cutoff },
        new() { EntryType = "VAT_Paid", Amount = 200, EffectiveDate = cutoff },
        new() { EntryType = "Dividend_Paid", Amount = 50, EffectiveDate = cutoff },
        new() { EntryType = "CorpTax_Paid", Amount = 25, EffectiveDate = cutoff },
        new() { EntryType = "DLA_In", Amount = 30, EffectiveDate = cutoff },
        new() { EntryType = "DLA_Out", Amount = 20, EffectiveDate = cutoff },
        new() { EntryType = "DLA_Payment", Notes = "Payment for DLA DLA-2026-0001. Remaining balance: 0", Amount = 100, EffectiveDate = cutoff },
        new() { EntryType = "DLA_Out", Notes = "DLA ID: DLA-2026-0001. CT Tag: Revenue", Amount = 100, EffectiveDate = cutoff },
        new() { EntryType = "DLA_Out", Title = "DLA Startup: director-funded costs", Amount = 25000, EffectiveDate = cutoff },
        new() { EntryType = "DLA_Out", DlaReference = " loan ", Amount = 500, EffectiveDate = cutoff },
        new() { EntryType = "CorpTax_Reserve", Amount = 1000, EffectiveDate = cutoff },
        new() { EntryType = "Salary", Amount = 500, EffectiveDate = cutoff }
    },
    BankAccounts = new() { new() { Id = 1, IsActive = true, Currency = "GBP" } },
    BankTransactions = new() { new() { Id = 9, BankAccountId = 1, Category = "Internal Transfer", TransactionDate = cutoff, Direction = "Out", Amount = 200 } }
};
if (args.SequenceEqual(new[] { "--parity" }))
{
    var cases = new List<object>();
    void CaptureFrozen()
    {
        var copy = JsonSerializer.Deserialize<RecordedCashSources>(JsonSerializer.Serialize(sources, CashBaselinePolicy.Json), CashBaselinePolicy.Json)!;
        cases.Add(new { sources = copy, balance = copy.Calculate(now) });
    }
    CaptureFrozen();
    sources.PayrollSettings.Add(new() { EmployerPAYEReference = "123/AB" });
    CaptureFrozen();
    sources.PayrollSettings.Clear();
    sources.PayrollRuns.Add(new());
    CaptureFrozen();
    sources.LedgerEntries.Add(new() { EntryType = "Cash_Baseline", Amount = 1029.15m, EffectiveDate = cutoff });
    sources.Invoices.Add(new() { Status = "Paid", DatePaid = now.AddDays(1), AmountGross = 1000 });
    sources.DlaPayments.Add(new() { DlaId = "orphan", PaymentDate = cutoff, Amount = 106.8m });
    CaptureFrozen();
    Console.WriteLine(JsonSerializer.Serialize(cases, CashBaselinePolicy.Json));
    return;
}
Check(sources.Calculate(now) == 4260, "cash parity: actual expense settlement, DLA direction and legacy references, VAT and paid ledger only");
Check(CashBaselinePolicy.Validate(request, now) == null, "approved 1029.15 = 996.86 + 32.29");
Check(CashBaselinePolicy.ValidateAccount(1, sources.BankAccounts) == null, "sole active GBP account");
Check(CashBaselinePolicy.ValidateSources(1, request, sources, now) == null, "unimported pending expenses accepted as attested metadata");
var baseline = CashBaselinePolicy.Create(1, request, sources, now);
var notes = CashBaselinePolicy.Notes(baseline);
Check(notes.Length <= 2000 && notes.StartsWith("[CASH-BASELINE:1]\n"), "notes fit existing column");
var nineTransfers = new RecordedCashSources
{
    BankTransactions = Enumerable.Range(1, 9).Select(id => new BankTransaction
    {
        Id = id, BankAccountId = 1, ExternalId = "tx_000000000000000000000000000000" + id,
        TransactionDate = cutoff, Category = "Internal Transfer", Direction = "Out", Amount = 123.45m
    }).ToList()
};
var nineSnapshot = CashBaselinePolicy.Create(1, request, nineTransfers, now);
Check(nineSnapshot.InternalTransferSnapshot.Count == 9 && CashBaselinePolicy.Notes(nineSnapshot).Length <= 2000,
    "nine pot-transfer movement snapshots fit notes without truncation");
var ledger = new CompanyLedgerEntry { Id = 99, EntryType = "Cash_Baseline", Amount = request.BookBalance.Value, EffectiveDate = cutoff, Notes = notes };
var stored = CashBaselinePolicy.Read(ledger, 1);
Check(stored.LedgerEntryId == 99 && stored.SourceSnapshotHash.Length == 64, "camelCase audit contract round trip with ledger ID");
Check(CashBaselinePolicy.IsReserved(ledger)
    && CashBaselinePolicy.IsReserved(new() { EntryType = "DLA_In", Notes = "[cash-baseline:1] forged" }), "reserved type and case-insensitive forged markers protected");
var reversedSources = new RecordedCashSources { BankTransactions = nineTransfers.BankTransactions.AsEnumerable().Reverse().ToList() };
Check(reversedSources.Hash() == nineTransfers.Hash(), "full-record hash is deterministic in source ID order");
reversedSources.BankTransactions[0].Description = "changed historical description";
Check(reversedSources.Hash() != nineSnapshot.SourceSnapshotHash, "full-record hash captures nonfinancial historical edits");
Check(JsonSerializer.Serialize(stored, CashBaselinePolicy.Json).Contains("\"recordedCashAtCreation\":4260"), "raw snapshot in contract");
Check(CashBaselinePolicy.Identical(stored, request) && !CashBaselinePolicy.Identical(stored, request with { Reason = "changed" }), "identical retry only, changes conflict");
sources.LedgerEntries.Add(ledger);
Check(sources.Calculate(now) == 4260 && sources.Hash() == baseline.SourceSnapshotHash, "baseline is not cash or a new source record");
sources.Expenses.Add(new() { Id = 4, DatePaid = cutoff, AmountGross = 19.99m });
Check(baseline.BookBalance + sources.Calculate(now) - baseline.RecordedCashAtCreation == 1009.16m, "late backdated pending expense reduces book once");
sources.Expenses.Add(new() { Id = 5, DatePaid = cutoff.AddDays(-1), AmountGross = 12.30m });
Check(baseline.BookBalance + sources.Calculate(now) - baseline.RecordedCashAtCreation == 996.86m, "both pending expenses reduce book to statement");
sources.Invoices[0].AmountGross += 10;
Check(baseline.BookBalance + sources.Calculate(now) - baseline.RecordedCashAtCreation == 1006.86m
    && baseline.RecordedCashAtCreation == 4260 && sources.Hash() != baseline.SourceSnapshotHash, "historical edit alters delta, immutable audit survives");
sources.PayrollSettings.Add(new() { EmployerPAYEReference = "123/AB" });
Check(sources.Calculate(now) == 3737.71m, "payroll configured gate");
sources.PayrollSettings.Clear();
sources.PayrollRuns.Add(new());
Check(sources.IncludePayroll, "any payroll run enables payroll");
sources.BankAccounts.Add(new() { Id = 2, Currency = "GBP", IsActive = true });
Check(CashBaselinePolicy.ValidateAccount(1, sources.BankAccounts) != null, "multiple GBP accounts refused");
Check(CashBaselinePolicy.Validate(request with { BookBalance = 1029.14m }, now) != null, "reconciliation mismatch refused");
Check(CashBaselinePolicy.Validate(request with { BookBalance = decimal.MaxValue }, now) != null, "oversized cash input rejected without overflow");
Check(CashBaselinePolicy.Validate(request with { AsOfDate = "2026-10-09" }, now) != null, "future cutoff refused");
Check(CashBaselinePolicy.Validate(request with { AsOfDate = "2026-10-03T00:00:00Z" }, now) != null, "date must be explicit ISO day");
Check(CashBaselinePolicy.Validate(request with { PendingExpenses = new() { request.PendingExpenses![0], request.PendingExpenses[0] } }, now) != null, "duplicate pending IDs refused");
sources.BankTransactions.Add(new() { BankAccountId = 1, ExternalId = "paddle", Direction = "In", Amount = 19.99m, TransactionDate = cutoff });
Check(CashBaselinePolicy.ValidateSources(1, request, sources, now) != null, "wrong-direction imported pending refused");
sources.BankTransactions.RemoveAt(1);
sources.BankTransactions.Add(new() { BankAccountId = 1, ExternalId = "paddle", Direction = "Out", Amount = 19.99m, TransactionDate = cutoff });
sources.BankTransactions.Add(new() { BankAccountId = 1, ExternalId = "paddle", Direction = "Out", Amount = 19.99m, TransactionDate = cutoff });
Check(CashBaselinePolicy.ValidateSources(1, request, sources, now) != null, "ambiguous imported pending IDs refused without throwing");
sources.BankTransactions.RemoveRange(1, 2);
sources.BankTransactions.Add(new() { BankAccountId = 1, Direction = "Out", Amount = 1, TransactionDate = cutoff.AddDays(1) });
Check(CashBaselinePolicy.ValidateSources(1, request, sources, now) != null, "later imported bank transaction refuses historical snapshot");
sources.BankTransactions.RemoveAt(1);
sources.Invoices.Add(new() { Status = "Paid", DatePaid = cutoff.AddDays(1), AmountGross = 1 });
Check(CashBaselinePolicy.ValidateSources(1, request, sources, now) != null, "later cash movement refuses historical snapshot");
Check(CashBaselinePolicy.Pennies(-1.005m) == -1m, "JavaScript negative half-penny rounding parity");
Console.WriteLine("All offline cash baseline checks passed.");