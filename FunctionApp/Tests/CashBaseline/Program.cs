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
    sources.LedgerEntries.Add(new() { EntryType = CashBaselineAmendmentPolicy.EntryType, Amount = 563.95m, EffectiveDate = cutoff });
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
var potRequest = new PotBalanceRequest(650m, 1071.82m, "2026-10-08", "Owner actual balances including interest");
Check(PotBalancePolicy.Validate(potRequest, now) == null, "owner actual VAT 650 and CT 1071.82 accepted");
Check(PotBalancePolicy.Validate(potRequest with { VatPotBalance = 0, CtPotBalance = 0 }, now) == null, "zero pots accepted");
Check(PotBalancePolicy.Validate(potRequest with { VatPotBalance = null }, now) != null, "explicit VAT balance required");
Check(PotBalancePolicy.Validate(potRequest with { CtPotBalance = null }, now) != null, "explicit CT balance required");
Check(PotBalancePolicy.Validate(potRequest with { VatPotBalance = -0.01m }, now) != null, "negative pot rejected");
Check(PotBalancePolicy.Validate(potRequest with { CtPotBalance = 1.001m }, now) != null, "fractional penny rejected");
Check(PotBalancePolicy.Validate(potRequest with { VatPotBalance = decimal.MaxValue }, now) != null, "decimal max rejected without overflow");
Check(PotBalancePolicy.Validate(potRequest with { CtPotBalance = decimal.MinValue }, now) != null, "decimal min rejected without overflow");
Check(PotBalancePolicy.Validate(potRequest with { VatPotBalance = PotBalancePolicy.MaximumBalance, CtPotBalance = PotBalancePolicy.MaximumBalance }, now) == null, "storage maximum accepted independently");
Check(PotBalancePolicy.Validate(potRequest with { AsOfDate = "1999-12-31" }, now) != null, "pre-2000 date rejected");
Check(PotBalancePolicy.Validate(potRequest with { AsOfDate = "2000-01-01" }, now) == null, "lower date boundary accepted");
Check(PotBalancePolicy.Validate(potRequest with { AsOfDate = "2026-10-09" }, now) != null, "future pot date rejected");
Check(PotBalancePolicy.Validate(potRequest with { AsOfDate = "2026-10-08T00:00:00Z" }, now) != null, "timestamp is not explicit pot date");
Check(PotBalancePolicy.Validate(potRequest with { Reference = " " }, now) != null
    && PotBalancePolicy.Validate(potRequest with { Reference = new string('x', 251) }, now) != null, "reference bounded and required");
var potRecord = PotBalancePolicy.Create(1, potRequest, now) with { LedgerEntryId = 100 };
var potLedger = new CompanyLedgerEntry { Id = 100, EntryType = PotBalancePolicy.EntryType,
    EffectiveDate = now.Date, Notes = PotBalancePolicy.Notes(potRecord) };
Check(PotBalancePolicy.Read(potLedger, now) == potRecord
    && potLedger.Notes.StartsWith("[POT-BALANCES:1]\n") && potLedger.Notes.Length <= 2000, "compact audit round trip includes actual ledger ID");
Check(PotBalancePolicy.Identical(potRecord, potRequest)
    && !PotBalancePolicy.Identical(potRecord, potRequest with { CtPotBalance = 1072 })
    && !PotBalancePolicy.Identical(potRecord, potRequest with { Reference = "correction" }), "pot retry identity includes values date and reference");
var correction = potRecord with { LedgerEntryId = 101, CtPotBalance = 1072 };
var older = potRecord with { LedgerEntryId = 102, AsOfDate = "2026-10-07" };
Check(PotBalancePolicy.Latest(new[] { older, correction, potRecord }) == correction, "date wins then latest ID for same-day correction");
Check(PotBalancePolicy.Latest(Array.Empty<PotBalanceRecord>()) == null, "no pot snapshot returns null");
Check(PotBalancePolicy.IsReserved(new() { EntryType = "bank_potsnapshot" })
    && PotBalancePolicy.IsReserved(new() { EntryType = "DLA_In", Notes = "forged [pot-balances:1]" }), "reserved pot type and forged marker protected case-insensitively");
var beforePot = sources.Calculate(now);
sources.LedgerEntries.Add(potLedger);
Check(sources.Calculate(now) == beforePot, "actual pot snapshots do not alter backend calculated cash");
Check(CashBaselinePolicy.ValidateAccount(1, new[] { new BankAccount { Id = 1, Currency = "EUR", IsActive = true } }) != null
    && CashBaselinePolicy.ValidateAccount(1, new[] { new BankAccount { Id = 1, Currency = "GBP", IsActive = false } }) != null,
    "pot routing reuses sole active GBP policy");
potLedger.Amount = 1;
try { PotBalancePolicy.Read(potLedger, now); throw new Exception("Corrupt pot ledger accepted"); }
catch (InvalidOperationException) { Check(true, "nonzero pot ledger amount rejected"); }
var originalNotes = JsonNodeWithoutProjection(notes);
string JsonNodeWithoutProjection(string value)
{
    var prefixLength = value.IndexOf('\n') + 1;
    var metadata = System.Text.Json.Nodes.JsonNode.Parse(value.Substring(prefixLength))!.AsObject();
    metadata.Remove("historicalExpenseAdjustment");
    metadata.Remove("amendments");
    return value.Substring(0, prefixLength) + metadata.ToJsonString();
}
ledger.Notes = originalNotes;
var legacy = CashBaselinePolicy.Read(ledger, 1) with { RecordedCashAtCreation = 3871.03m };
Check(legacy.HistoricalExpenseAdjustment == 0 && legacy.Amendments == null, "old baseline notes deserialize with optional defaults");
var historicalExpenses = Enumerable.Range(10, 10).Select(expenseId => new Expense
    { Id = expenseId, AmountGross = expenseId == 19 ? 59.95m : 56m, DatePaid = cutoff }).ToList();
var amendment = new CashBaselineAmendmentRecord(1, 99, 563.95m, "Owner approved ten historical bank expense additions",
    historicalExpenses.Select(expense => expense.Id).ToList(),
    historicalExpenses.Select(expense => "historical-" + expense.Id).ToList(), now);
var amendmentEntry = new CompanyLedgerEntry { Id = 1000, EntryType = CashBaselineAmendmentPolicy.EntryType,
    Amount = amendment.Amount, EffectiveDate = now.Date, Notes = CashBaselineAmendmentPolicy.Notes(amendment) };
var amended = CashBaselineAmendmentPolicy.Compose(legacy, new[] { amendmentEntry }, historicalExpenses, now);
var historicalCash = new RecordedCashSources
{
    Invoices = new() { new() { Status = "Paid", DatePaid = cutoff, AmountGross = 3871.03m } },
    Expenses = historicalExpenses.Concat(new[] { new Expense { Id = 20, DatePaid = cutoff, AmountGross = 19.99m },
        new Expense { Id = 21, DatePaid = cutoff, AmountGross = 12.30m } }).ToList(),
    LedgerEntries = new() { amendmentEntry }
};
Check(historicalCash.Calculate(now) == 3274.79m, "ten historical additions and two pending expenses produce unchanged raw cash 3274.79");
Check(amended.BookBalance + 3274.79m - amended.RecordedCashAtCreation + amended.HistoricalExpenseAdjustment == 996.86m,
    "1029.15 baseline plus 563.95 amendment and raw delta 3274.79 - 3871.03 = 996.86");
Check(amended.Amendments![0].LedgerEntryId == 1000 && ledger.Notes == originalNotes
    && legacy.HistoricalExpenseAdjustment == 0, "composition exposes audit ID without rewriting original baseline");
historicalExpenses[0].AmountGross += 10;
Check(CashBaselineAmendmentPolicy.Compose(legacy, new[] { amendmentEntry }, historicalExpenses, now).HistoricalExpenseAdjustment == 563.95m,
    "later expense amount edits retain original amendment amount and raw delta");
void RefuseAmendment(CompanyLedgerEntry candidate, string name, IEnumerable<Expense>? expenses = null,
    IEnumerable<CompanyLedgerEntry>? entries = null)
{
    try { CashBaselineAmendmentPolicy.Compose(legacy, entries ?? new[] { candidate }, expenses ?? historicalExpenses, now); }
    catch (Exception exception) when (exception is InvalidOperationException || exception is JsonException)
    { Check(true, name); return; }
    throw new Exception(name + " accepted");
}
CompanyLedgerEntry AmendmentWith(CashBaselineAmendmentRecord record) => new()
    { Id = 1001, EntryType = CashBaselineAmendmentPolicy.EntryType, Amount = record.Amount,
        EffectiveDate = now.Date, Notes = CashBaselineAmendmentPolicy.Notes(record) };
RefuseAmendment(AmendmentWith(amendment with { BankAccountId = 2 }), "wrong account marker refused");
RefuseAmendment(AmendmentWith(amendment with { BaselineLedgerEntryId = 98 }), "wrong baseline ID refused");
RefuseAmendment(AmendmentWith(amendment with { LedgerEntryId = 999 }), "wrong amendment ID refused");
RefuseAmendment(AmendmentWith(amendment with { Amount = -1 }), "negative adjustment refused");
RefuseAmendment(AmendmentWith(amendment with { Amount = 1.001m }), "fractional penny refused");
RefuseAmendment(AmendmentWith(amendment with { ExpenseIds = new() { 10, 10 } }), "duplicate expense IDs refused");
RefuseAmendment(amendmentEntry, "missing current expense refused", historicalExpenses.Skip(1));
RefuseAmendment(amendmentEntry, "sources cannot repeat across amendments", entries: new[] { amendmentEntry, AmendmentWith(amendment) });
RefuseAmendment(amendmentEntry, "external IDs cannot repeat with different expense IDs", entries: new[] { amendmentEntry,
    AmendmentWith(amendment with { ExpenseIds = Enumerable.Range(30, 10).ToList() }) },
    expenses: historicalExpenses.Concat(Enumerable.Range(30, 10).Select(expenseId => new Expense { Id = expenseId })));
RefuseAmendment(amendmentEntry, "same audit entry cannot be counted twice", entries: new[] { amendmentEntry, amendmentEntry });
var secondAmendment = amendment with { Amount = 1.25m, ExpenseIds = new() { 30 }, ExternalIds = new() { "independent-history" } };
Check(CashBaselineAmendmentPolicy.Compose(legacy, new[] { AmendmentWith(secondAmendment), amendmentEntry },
    historicalExpenses.Append(new Expense { Id = 30 }), now).HistoricalExpenseAdjustment == 565.20m,
    "independent amendments sum once in audit ID order");
RefuseAmendment(AmendmentWith(amendment with { Amount = 0 }), "zero amendment refused");
RefuseAmendment(AmendmentWith(amendment with { Amount = decimal.MaxValue }), "oversized amount refused without overflow");
RefuseAmendment(AmendmentWith(amendment with { RecordedAtUtc = now.AddDays(-1) }), "amendment cannot predate original snapshot");
RefuseAmendment(new() { Id = 1001, EntryType = "DLA_In", Amount = amendment.Amount, EffectiveDate = now.Date,
    Notes = amendmentEntry.Notes }, "forged amendment marker with cash type refused");
RefuseAmendment(new() { Id = 1001, EntryType = CashBaselineAmendmentPolicy.EntryType, Amount = 1, EffectiveDate = now.Date,
    Notes = amendmentEntry.Notes }, "ledger amount mismatch refused");
RefuseAmendment(new() { Id = 1001, EntryType = CashBaselineAmendmentPolicy.EntryType, Amount = amendment.Amount, EffectiveDate = now.Date,
    Notes = amendmentEntry.Notes!.Replace("\"bankAccountId\":1", "\"bankAccountId\":1,\"BankAccountId\":1") }, "duplicate JSON fields refused");
var amendmentJson = JsonSerializer.Serialize(amended.Amendments![0], CashBaselinePolicy.Json);
using (var contract = JsonDocument.Parse(amendmentJson))
    Check(contract.RootElement.EnumerateObject().Select(property => property.Name).SequenceEqual(new[] {
        "bankAccountId", "baselineLedgerEntryId", "amount", "reason", "expenseIds", "externalIds", "recordedAtUtc", "ledgerEntryId" }),
        "exact amendment response fields use recordedAtUtc not createdAt");
RefuseAmendment(AmendmentWith(amendment with { ExternalIds = amendment.ExternalIds.Select(_ => "same").ToList() }), "duplicate external IDs refused");
RefuseAmendment(AmendmentWith(amendment with { ExternalIds = new List<string> { "paddle" }.Concat(amendment.ExternalIds.Skip(1)).ToList() }), "pending baseline expense cannot be neutralized");
RefuseAmendment(AmendmentWith(amendment with { RecordedAtUtc = now.AddDays(1) }), "future recorded timestamp refused");
Check(CashBaselineAmendmentPolicy.IsReserved(new() { EntryType = "cash_baselineamendment" })
    && CashBaselineAmendmentPolicy.IsReserved(new() { EntryType = "DLA_In", Notes = "forged [cash-baseline-amendment:1]" }),
    "reserved amendment types and forged markers protected");
var rawBeforeAmendment = sources.Calculate(now);
sources.LedgerEntries.Add(amendmentEntry);
Check(sources.Calculate(now) == rawBeforeAmendment, "monetary amendment ledger does not alter raw cash");
Console.WriteLine("All offline cash baseline, amendment and pot snapshot checks passed.");