using System.Text.Json;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;

var checks = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    checks++;
}
var today = new DateTime(2026, 10, 8);
VatReturn Return(decimal owed = 581.15m) => new() { Id = 12, VatOwed = owed, FiledDate = today.AddDays(-20), Status = "Filed" };
VatSettlementRequest Request() => new() { Amount = 581.15m, SettlementDate = today, BankTransactionId = 34, Reference = "HMRC user reference" };
var vatReturn = Return();
var request = Request();
Check(VatSettlementPolicy.Validate(vatReturn, request, today) == null, "valid payment");
Check(VatSettlementPolicy.EntryType(vatReturn) == "VAT_Paid", "positive owed is payment");
Check(VatSettlementPolicy.EntryType(Return(-581.15m)) == "VAT_Reclaim", "negative owed is refund");
Check(VatSettlementPolicy.Validate(Return(0), request, today) != null, "zero rejected");
vatReturn.Status = "Draft";
Check(VatSettlementPolicy.Validate(vatReturn, request, today) != null, "unfiled rejected");
vatReturn = Return(); vatReturn.FiledDate = null;
Check(VatSettlementPolicy.Validate(vatReturn, request, today) != null, "missing filing date rejected");
vatReturn = Return(-581.15m);
request.Amount = 581.33m;
Check(VatSettlementPolicy.Validate(vatReturn, request, today) != null, "difference requires reason");
request.DifferenceReason = "HMRC rounding adjustment";
Check(VatSettlementPolicy.Validate(vatReturn, request, today) == null, "581.33 cash for 581.15 refund allowed");
Check(vatReturn.VatOwed == -581.15m, "filed figures unchanged");
foreach (var amount in new decimal?[] { null, 0, -1, 581.151m, 10000000000000000m })
{
    request.Amount = amount;
    Check(VatSettlementPolicy.Validate(vatReturn, request, today) != null, "invalid money rejected");
}
request = Request(); vatReturn = Return();
foreach (var date in new DateTime?[] { null, new(1999, 12, 31), today.AddDays(1), today.AddHours(1) })
{
    request.SettlementDate = date;
    Check(VatSettlementPolicy.Validate(vatReturn, request, today) != null, "invalid date rejected");
}
request = Request(); request.BankTransactionId = 0;
Check(VatSettlementPolicy.Validate(vatReturn, request, today) != null, "zero bank id rejected");
request.BankTransactionId = null;
Check(VatSettlementPolicy.Validate(vatReturn, request, today) == null, "manual settlement allowed");
request.Reference = "[VAT-RETURN:123]";
Check(VatSettlementPolicy.Validate(vatReturn, request, today) != null, "marker injection rejected");
request = Request();
var notes = VatSettlementPolicy.Notes(12, request);
Check(notes.StartsWith("[VAT-RETURN:12] [BANK-TX:34]\n"), "exact markers");
Check(VatSettlementPolicy.HasMarker(notes, 12) && !VatSettlementPolicy.HasMarker(notes, 1), "marker ids not prefixes");
Check(VatSettlementPolicy.LinkedReturnId(notes) == 12, "marker lookup");
var entry = new CompanyLedgerEntry { Id = 77, Amount = request.Amount!.Value, EffectiveDate = today, EntryType = "VAT_Paid", Notes = notes };
Check(VatSettlementPolicy.Identical(entry, request), "identical retry");
foreach (var field in new[] { "Amount", "SettlementDate", "BankTransactionId", "Reference", "DifferenceReason" })
{
    var changed = Request();
    switch (field)
    {
        case "Amount": changed.Amount++; break;
        case "SettlementDate": changed.SettlementDate = today.AddDays(-1); break;
        case "BankTransactionId": changed.BankTransactionId = null; break;
        case "Reference": changed.Reference = "other"; break;
        case "DifferenceReason": changed.DifferenceReason = "other"; break;
    }
    Check(!VatSettlementPolicy.Identical(entry, changed), "changed retry: " + field);
}
entry.Notes = "[VAT-RETURN:12]\ninvalid";
Check(!VatSettlementPolicy.Identical(entry, request), "malformed metadata requires review");
entry.Notes = notes;
var bank = new BankTransaction { Id = 34, Amount = -581.15m, Direction = "Out", TransactionDate = today, Description = "not a hardcoded merchant" };
var account = new BankAccount { IsActive = true, Currency = "GBP" };
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) == null, "valid bank without merchant hardcode");
bank.Category = "Internal Transfer";
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "pot transfer rejected");
bank.Category = null; bank.Description = "VAT Pot transfer";
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "pot description rejected");
bank.Description = "HMRC"; account.AccountName = "CT Pot";
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "pot account rejected");
account.AccountName = "Business";
bank.Category = null; bank.Direction = "In";
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "wrong direction");
Check(VatSettlementPolicy.ValidateBank(Return(-581.15m), request, bank, account) == null, "refund bank direction");
bank.Direction = "Out"; bank.Amount = 581.33m;
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "wrong amount");
bank.Amount = 581.15m; bank.TransactionDate = today.AddDays(-1);
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "wrong date");
bank.TransactionDate = today; account.Currency = "EUR";
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "wrong currency");
account.Currency = "GBP"; account.IsActive = false;
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, bank, account) != null, "inactive bank");
Check(VatSettlementPolicy.ValidateBank(vatReturn, request, null, account) != null, "missing bank");
foreach (var pair in new[] { (581.15m, "AwaitingPayment"), (-581.15m, "AwaitingRefund"), (0m, "NoSettlementRequired") })
{
    var projection = VatSettlementPolicy.Project(Return(pair.Item1), null);
    Check((string?)projection["settlementStatus"] == pair.Item2, "unsettled status");
    Check(projection["settlementAmount"] == null && projection["settlementLedgerEntryId"] == null, "unsettled nullable metadata");
}
var settled = VatSettlementPolicy.Project(vatReturn, entry);
Check((string?)settled["settlementStatus"] == "Paid" && (decimal?)settled["settlementAmount"] == 581.15m, "paid projection");
Check((int?)settled["settlementBankTransactionId"] == 34 && (string?)settled["settlementReference"] == request.Reference, "linked metadata");
Check(((JsonElement)settled["vatOwed"]!).GetDecimal() == 581.15m && settled.Count == typeof(VatReturn).GetProperties().Length + 6, "original fields plus six fields");
Check((string?)VatSettlementPolicy.Project(Return(-581.15m), entry)["settlementStatus"] == "RefundReceived", "refund projection");
var updated = Return(); updated.Reference = "metadata"; updated.Notes = "notes"; updated.ConfirmationPdfUrl = "pdf";
Check(!VatSettlementPolicy.ChangesFiledFigures(vatReturn, updated), "metadata updates allowed");
foreach (var field in new[] { "QuarterStartDate", "QuarterEndDate", "VatIn", "VatOut", "VatOwed", "FiledDate", "Status" })
{
    updated = Return();
    var property = typeof(VatReturn).GetProperty(field)!;
    property.SetValue(updated, field == "Status" ? "Draft" : property.PropertyType == typeof(decimal) ? 999m : today.AddDays(-1));
    Check(VatSettlementPolicy.ChangesFiledFigures(vatReturn, updated), "immutable filed field: " + field);
}
Console.WriteLine($"VAT settlement: {checks} offline policy checks passed");