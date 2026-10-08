using System.Text.Json;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;

static void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
    Console.WriteLine($"PASS {name}");
}

static Expense ForeignExpense() => new()
{
    OriginalCurrency = "EUR",
    OriginalAmountNet = 100m,
    OriginalVatAmount = 20m,
    OriginalAmountGross = 120m,
    ExchangeRateToGbp = 0.85m,
    ExchangeRateDate = new DateTime(2026, 10, 1),
    ExchangeRateSource = "invoice-date daily estimate",
    EstimatedGbpGross = 102m,
    AmountNet = 102m,
    VATAmount = 0m,
    AmountGross = 102m,
    EntryDate = new DateTime(2026, 10, 1),
    Supplier = "Supplier"
};

var gbp = new Expense { AmountGross = 17m };
Check(ForeignCurrencyHelper.Validate(gbp, isNew: true) == null && gbp.OriginalCurrency == "GBP" && gbp.AmountGross == 17m, "New records default to GBP without changing amounts");
var legacy = new DlaEntry { AmountGross = 23m };
Check(ForeignCurrencyHelper.Validate(legacy) == null && legacy.OriginalCurrency == null && legacy.AmountGross == 23m, "Legacy nullable metadata remains unchanged");
var expense = ForeignExpense();
Check(ForeignCurrencyHelper.Validate(expense) == null && expense.VATAmount == 0m && expense.AmountGross == 102m, "Foreign tax never becomes reclaimable UK VAT or overwrites GBP");
expense.OriginalCurrency = " usd ";
Check(ForeignCurrencyHelper.Validate(expense) == null && expense.OriginalCurrency == "USD", "Supported currency normalized");
expense.OriginalCurrency = "CAD";
Check(ForeignCurrencyHelper.Validate(expense) != null, "Unsupported currency rejected");
foreach (var rate in new[] { 0m, -1m, 0.000000001m, 10000000000m })
{
    expense = ForeignExpense();
    expense.ExchangeRateToGbp = rate;
    Check(ForeignCurrencyHelper.Validate(expense) != null, $"Invalid or unrepresentable rate rejected: {rate}");
}
expense = ForeignExpense();
expense.OriginalAmountGross = null;
Check(ForeignCurrencyHelper.Validate(expense) != null, "Foreign gross required");
expense = ForeignExpense();
expense.OriginalVatAmount = -1m;
Check(ForeignCurrencyHelper.Validate(expense) != null, "Negative original tax rejected");
expense = ForeignExpense();
expense.OriginalAmountGross = 121m;
Check(ForeignCurrencyHelper.Validate(expense) != null, "Inconsistent original totals rejected");
expense = ForeignExpense();
expense.ExchangeRateDate = null;
Check(ForeignCurrencyHelper.Validate(expense) != null, "Rate date required for foreign currency");
foreach (var body in new[] { "{\"exchangeRateToGbp\":1e999}", "{\"exchangeRateToGbp\":\"NaN\"}", "{\"exchangeRateToGbp\":Infinity}", "[]" })
    Check(!ForeignCurrencyHelper.TryRead<Expense>(body, out _, out _), "Invalid/nonfinite JSON rejected");

var existing = ForeignExpense();
const string notesBody = "{\"notes\":\"Edited\"}";
Check(ForeignCurrencyHelper.TryRead<Expense>(notesBody, out var notesUpdate, out _), "Read unrelated edit");
ForeignCurrencyHelper.PreserveOmitted(notesUpdate!, existing, notesBody);
Check(ForeignCurrencyHelper.Validate(notesUpdate!) == null && notesUpdate!.AmountGross == 102m && notesUpdate.OriginalAmountGross == 120m && notesUpdate.VATAmount == 0m && notesUpdate.Supplier == "Supplier", "Unrelated edit retains GBP, originals and supplier");
const string settlementBody = "{\"actualGbpPaid\":101.23,\"settlementDate\":\"2026-10-07\",\"settlementBankTransactionId\":42}";
Check(ForeignCurrencyHelper.TryRead<Expense>(settlementBody, out var settlement, out _), "Read confirmed settlement");
ForeignCurrencyHelper.PreserveOmitted(settlement!, existing, settlementBody);
Check(ForeignCurrencyHelper.Validate(settlement!) != null && settlement!.ActualGbpPaid == 101.23m && settlement.AmountGross == 102m && settlement.ExchangeRateToGbp == 0.85m, "Unverified bank link rejected without modifying accounting values");
settlement!.SettlementDate = null;
Check(ForeignCurrencyHelper.Validate(settlement) != null, "Settlement date required");
var dla = new DlaEntry { AmountGross = 102m };
ForeignCurrencyHelper.Copy(existing, dla);
Check(ForeignCurrencyHelper.Validate(dla) == null && dla.OriginalAmountGross == 120m && dla.AmountGross == 102m && dla.VatAmount == 0m, "DLA metadata copy preserves GBP and VAT");
var bank = new BankTransaction { Amount = -101.23m, OriginalCurrency = "EUR", OriginalAmount = -120m };
Check(ForeignCurrencyHelper.ValidateBank(bank) == null && bank.OriginalAmount == -120m && bank.Amount == -101.23m, "Bank Local amount remains signed and separate from GBP");
bank.OriginalAmount = decimal.MinValue;
Check(ForeignCurrencyHelper.ValidateBank(bank) != null, "Extreme bank amount rejected without overflow");
var json = JsonSerializer.Serialize(existing, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
using var document = JsonDocument.Parse(json);
Check(document.RootElement.GetProperty("originalVatAmount").GetDecimal() == 20m && document.RootElement.GetProperty("vatAmount").GetDecimal() == 0m, "Exact camelCase originalVatAmount and vatAmount contract");

var request = new GbpSettlementRequest { ActualGbpPaid = 101.23m, SettlementDate = new DateTime(2026, 10, 7), SettlementBankTransactionId = 42 };
existing = ForeignExpense();
bank = new BankTransaction { Id = 42, BankAccountId = 1, Direction = "Out", Amount = -101.23m, TransactionDate = request.SettlementDate, OriginalCurrency = "EUR", OriginalAmount = -120m };
var account = new BankAccount { Id = 1, IsActive = true };
Check(GbpSettlementPolicy.Validate(existing, request, false) == null, "Foreign expense settlement accepted");
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) == null, "Signed outgoing GBP bank amount and legacy null account currency accepted");
Check(GbpSettlementPolicy.ValidateBank(existing, request, null, account) != null, "Missing bank rejected");
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, null) != null, "Missing bank account rejected");
account.IsActive = false;
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "Inactive account rejected");
account.IsActive = true;
account.Currency = "EUR";
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "Non-GBP account rejected");
account.Currency = "GBP";
bank.Direction = "In";
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "Incoming bank payment rejected");
bank.Direction = "Out";
bank.Amount = -101.24m;
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "One penny bank mismatch rejected");
bank.Amount = -101.23m;
bank.Amount = null;
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "Missing bank amount rejected");
bank.Amount = -101.23m;
bank.TransactionDate = request.SettlementDate.Value.AddDays(1);
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "Different bank date rejected");
bank.TransactionDate = request.SettlementDate.Value.AddHours(12);
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) == null, "Same calendar date accepted");
bank.OriginalCurrency = "USD";
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "Original bank currency mismatch rejected");
bank.OriginalCurrency = "EUR";
bank.OriginalAmount = -120.01m;
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) != null, "Original bank amount mismatch rejected");
bank.OriginalAmount = null;
bank.OriginalCurrency = null;
Check(GbpSettlementPolicy.ValidateBank(existing, request, bank, account) == null, "Missing optional original bank metadata accepted");
Check(GbpSettlementPolicy.Validate(existing, request, true) != null, "Personal DLA cannot link company bank reimbursement");
request.SettlementBankTransactionId = null;
Check(GbpSettlementPolicy.Validate(existing, request, true) == null, "Manual personal DLA actual allowed");
request.ActualGbpPaid = 101.231m;
Check(GbpSettlementPolicy.Validate(existing, request, false) != null, "Fractional penny rejected");
request.ActualGbpPaid = 101.23m;
request.SettlementDate = null;
Check(GbpSettlementPolicy.Validate(existing, request, false) != null, "Missing settlement date rejected by PATCH policy");
request.SettlementDate = new DateTime(2026, 10, 7);
request.SettlementBankTransactionId = 0;
Check(GbpSettlementPolicy.Validate(existing, request, false) != null, "Nonpositive bank ID rejected");
request.SettlementBankTransactionId = null;
Check(GbpSettlementPolicy.Validate(new Expense { OriginalCurrency = "GBP" }, request, false) != null, "GBP expense cannot settle as foreign");
existing.ActualGbpPaid = request.ActualGbpPaid;
existing.SettlementDate = request.SettlementDate;
Check(!GbpSettlementPolicy.Conflicts(existing, request), "Identical retry is idempotent");
request.ActualGbpPaid = 101.24m;
Check(GbpSettlementPolicy.Conflicts(existing, request), "Changed confirmed amount conflicts");
request.ActualGbpPaid = 101.23m;
request.SettlementDate = request.SettlementDate.Value.AddDays(1);
Check(GbpSettlementPolicy.Conflicts(existing, request), "Changed confirmed date conflicts");
request.SettlementDate = existing.SettlementDate;
request.SettlementBankTransactionId = 42;
Check(GbpSettlementPolicy.Conflicts(existing, request), "Changed confirmed bank link conflicts");
var personal = new DlaEntry();
ForeignCurrencyHelper.Copy(ForeignExpense(), personal);
personal.ActualGbpPaid = 101.23m;
personal.SettlementDate = request.SettlementDate;
Check(ForeignCurrencyHelper.Validate(personal) == null, "DLA manual actual is valid on ordinary create/update");
personal.SettlementBankTransactionId = 42;
Check(ForeignCurrencyHelper.Validate(personal) != null, "DLA ordinary write rejects company bank ID");