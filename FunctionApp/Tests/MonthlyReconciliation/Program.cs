using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;

void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}
MonthlyReconciliationAction Expense(string id, decimal? vat = null, string? receipt = null) =>
    new(id, "createExpense", null, null, "Pret A Manger", "Subsistence", "Revenue", vat, receipt);
MonthlyReconciliationAction Link(string id, string type = "Invoice", string relatedId = "4") =>
    new(id, "link", type, relatedId, null, null, null, null, null);

Check(ReceiptInboxPolicy.ValidateUpload("receipt.pdf", 1024) == null, "pdf receipt accepted");
Check(ReceiptInboxPolicy.ValidateUpload("photo.HEIC", 1024) == null, "phone photo accepted");
Check(ReceiptInboxPolicy.ValidateUpload("script.exe", 1024) != null, "executable refused");
Check(ReceiptInboxPolicy.ValidateUpload("big.pdf", ReceiptInboxPolicy.MaxBytes + 1) != null, "oversized receipt refused");
Check(ReceiptInboxPolicy.ValidateUpload("empty.pdf", 0) != null, "empty receipt refused");
Check(ReceiptInboxPolicy.SafeName("../../Café receipt (1).pdf") == "Caf--receipt--1-.pdf", "file name sanitised");
Check(ReceiptInboxPolicy.BlobName(new DateTime(2026, 10, 9), Guid.Empty, "a b.pdf") == "2026-10/00000000000000000000000000000000-a-b.pdf", "blob name partitioned by month");
Check(!ReceiptInboxPolicy.ValidBlobName("../expense-receipts/x.pdf") && !ReceiptInboxPolicy.ValidBlobName("/x") && ReceiptInboxPolicy.ValidBlobName("2026-10/x.pdf"), "blob traversal refused");

var analysed = ReceiptInboxPolicy.WithAnalysis(ReceiptInboxPolicy.UploadMetadata("Café.pdf"),
    new ReceiptAnalysis("Café Nero Ltd", new DateTime(2026, 10, 2), 12.3456m, 2.05m, "gbp", "INV/1"), null);
var item = ReceiptInboxPolicy.Read("2026-10/x.pdf", 10, null, analysed);
Check(analysed.Values.All(value => value.All(character => character < 128)), "metadata is ASCII-safe");
Check(item.FileName == "Café.pdf" && item.Vendor == "Café Nero Ltd" && item.Total == 12.35m && item.Tax == 2.05m
    && item.Currency == "GBP" && item.DocumentDate == "2026-10-02" && item.Reference == "INV/1" && item.Status == "analysed", "analysis round-trips");
var failed = ReceiptInboxPolicy.Read("x", 1, null, ReceiptInboxPolicy.WithAnalysis(analysed, null, "Unreadable"));
Check(failed.Status == "failed" && failed.Error == "Unreadable" && failed.Vendor == null && ReceiptInboxPolicy.IsOpen(failed), "failed analysis stays open without stale fields");
var matched = ReceiptInboxPolicy.Read("x", 1, null, ReceiptInboxPolicy.WithStatus(analysed, "matched", 42));
Check(matched.ExpenseId == 42 && !ReceiptInboxPolicy.IsOpen(matched), "matched receipt leaves inbox");
Check(ReceiptInboxPolicy.Read("2026-10/abc-photo.jpg", 1, null, null).FileName == "abc-photo.jpg"
    && ReceiptInboxPolicy.Read("y", 1, null, new Dictionary<string, string> { ["status"] = "bogus" }).Status == "new", "storage uploads without metadata are new");

Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Expense("mm_1"), Link("mm_2") })) == null, "valid mixed request");
Check(MonthlyReconciliationPolicy.Validate(new(null, new() { Expense("mm_1") })) != null, "account required");
Check(MonthlyReconciliationPolicy.Validate(new(1, new())) != null, "empty request refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Expense("mm_1"), Link("mm_1") })) != null, "duplicate statement row refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Expense("mm_1", receipt: "r"), Expense("mm_2", receipt: "r") })) != null, "receipt reuse refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Link("mm_1", "Bill") })) != null, "unsupported link type refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Link("mm_1", "Invoice", "x") })) != null, "non-numeric link refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Link("mm_1") with { Category = "Other" } })) != null, "link carrying expense fields refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Expense("mm_1") with { CtTag = "Whatever" } })) != null, "unknown CT tag refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Expense("mm_1", 1.005m) })) != null, "fractional-penny VAT refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Expense("mm_1", -1m) })) != null, "negative VAT refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { Expense("mm_1", receipt: "../x") })) != null, "receipt traversal refused");
Check(MonthlyReconciliationPolicy.Validate(new(1, new() { new("mm_1", "delete", null, null, null, null, null, null, null) })) != null, "unknown action refused");

var gbp = new BankTransaction { Id = 7, ExternalId = "mm_0000BB2dgTwRQAX37EY2z6", Amount = 12.30m, Direction = "Out",
    TransactionDate = new DateTime(2026, 10, 12, 13, 1, 0), Description = "Pret - Card payment" };
Check(MonthlyReconciliationPolicy.ValidateVat(gbp, 2.05m) == null && MonthlyReconciliationPolicy.ValidateVat(gbp, 2.06m) != null, "VAT capped at one sixth");
var built = MonthlyReconciliationPolicy.BuildExpense(gbp, Expense(gbp.ExternalId, 2.05m, "2026-10/x.pdf"), null,
    new CompanySettings { FYStartMonth = 3, FYStartDay = 1 });
Check(built.ExpenseId == "BANK-" + "mm0000BB2dgTwRQAX37EY2z6"[^15..] && built.ExpenseId!.Length <= 50, "deterministic expense code");
Check(built.AmountGross == 12.30m && built.VATAmount == 2.05m && built.AmountNet == 10.25m && built.ActualGbpPaid == 12.30m
    && built.SettlementBankTransactionId == 7 && built.DatePaid == new DateTime(2026, 10, 12) && built.PaymentMethod == "Card"
    && built.NoReceiptReason == null && built.SupplierFreeText == "Pret A Manger" && !built.IsDLA, "GBP expense from bank and receipt");
Check(built.TaxYear == "2026/27" && built.FinancialYear == "2026/27", "app tax-year format");
var pending = MonthlyReconciliationPolicy.BuildExpense(gbp, Expense(gbp.ExternalId), new Supplier { Name = "PRET A MANGER" }, null);
Check(pending.NoReceiptReason == MonthlyReconciliationPolicy.ReceiptPending && pending.VATAmount == 0 && pending.Supplier == "PRET A MANGER"
    && pending.SupplierFreeText == null, "receipt-pending expense reuses supplier");
var usd = new BankTransaction { Id = 8, ExternalId = "mm_x", Amount = 75m, Direction = "Out", OriginalCurrency = "USD", OriginalAmount = -100.23m,
    TransactionDate = new DateTime(2026, 10, 22), Description = "GitHub" };
Check(MonthlyReconciliationPolicy.ValidateVat(usd, 1m) != null, "no VAT from foreign card payment");
var foreign = MonthlyReconciliationPolicy.BuildExpense(usd, Expense("mm_x"), null, null);
Check(foreign.OriginalCurrency == "USD" && foreign.OriginalAmountGross == 100.23m && foreign.ExchangeRateToGbp == decimal.Round(75m / 100.23m, 8)
    && foreign.ActualGbpPaid == 75m && foreign.VATAmount == 0 && foreign.PaymentMethod == "Bank Transfer", "foreign settlement metadata");
Check(MonthlyReconciliationPolicy.TaxYear(new DateTime(2027, 4, 5)) == "2026/27" && MonthlyReconciliationPolicy.TaxYear(new DateTime(2027, 4, 6)) == "2027/28", "tax year boundary");
Check(MonthlyReconciliationPolicy.FinancialYear(new DateTime(2026, 2, 28), new CompanySettings { FYStartMonth = 3, FYStartDay = 1 }) == "2025/26", "financial year boundary");
Check(MonthlyReconciliationPolicy.RelatedAmount("Invoice", new Invoice { AmountGross = 10 }) == 10
    && MonthlyReconciliationPolicy.RelatedAmount("Expense", new Expense { AmountGross = 12, ActualGbpPaid = 11 }) == 11
    && MonthlyReconciliationPolicy.RelatedAmount("Invoice", new Expense()) == null, "related amounts by type");
Console.WriteLine("All offline receipt inbox and monthly reconciliation checks passed.");
