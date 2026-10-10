using System.Text.Json;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;

void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}
MonzoTransaction Parse(string json) => MonzoSyncPolicy.Parse(JsonDocument.Parse(json).RootElement);

var card = Parse("""{"id":"tx_1","created":"2026-10-09T06:37:52.123Z","amount":-620,"description":"PRET ST JAMES","merchant":{"name":"Pret A Manger"},"category":"eating_out","local_currency":"GBP","local_amount":-620,"metadata":{}}""");
var potOut = Parse("""{"id":"tx_2","created":"2026-10-09T19:30:39Z","amount":14203,"description":"pot_vat","scheme":"uk_retail_pot","category":"savings","metadata":{"pot_id":"pot_vat"}}""");
var usd = Parse("""{"id":"tx_3","created":"2026-10-22T06:24:20Z","amount":-7500,"description":"GITHUB","merchant":{"name":"GitHub"},"category":"bills","local_currency":"USD","local_amount":-10023}""");
var declined = Parse("""{"id":"tx_4","created":"2026-10-09T10:00:00Z","amount":-100,"decline_reason":"INSUFFICIENT_FUNDS"}""");
var savingsNoPot = Parse("""{"id":"tx_5","created":"2026-10-09T10:00:00Z","amount":-100,"description":"Some savings app","category":"savings"}""");

Check(card.CreatedUtc.Kind == DateTimeKind.Utc && card.MerchantName == "Pret A Manger" && card.PotId == null, "card transaction parsed");
Check(potOut.PotId == "pot_vat", "pot transfer detected from metadata");
Check(!MonzoSyncPolicy.Importable(declined) && MonzoSyncPolicy.Importable(card), "declined transactions skipped");
Check(MonzoSyncPolicy.ToUkLocal(new DateTime(2026, 10, 9, 19, 30, 39, DateTimeKind.Utc)) == new DateTime(2026, 10, 9, 20, 30, 39), "BST converted to UK wall-clock time like the CSV");
Check(MonzoSyncPolicy.ToUkLocal(new DateTime(2026, 12, 1, 9, 0, 0, DateTimeKind.Utc)) == new DateTime(2026, 12, 1, 9, 0, 0), "GMT unchanged in winter");

var names = new Dictionary<string, string> { ["pot_vat"] = "VAT Pot" };
var now = new DateTime(2026, 10, 10, 6, 0, 0, DateTimeKind.Utc);
var potRow = MonzoSyncPolicy.ToBank(potOut, 1, names, now);
Check(potRow.Description == "VAT Pot - Pot transfer" && potRow.Category == "Internal Transfer" && potRow.Direction == "In"
    && potRow.Amount == 142.03m && CashBaselinePolicy.IsInternal(potRow), "pot transfer stored as internal transfer in CSV format");
var cardRow = MonzoSyncPolicy.ToBank(card, 1, names, now);
Check(cardRow.Description == "Pret A Manger" && cardRow.Category == "Meals" && cardRow.Direction == "Out" && cardRow.Amount == 6.20m
    && cardRow.ExternalId == "tx_1" && cardRow.Source == "Monzo" && !CashBaselinePolicy.IsInternal(cardRow), "card payment mapped");
var usdRow = MonzoSyncPolicy.ToBank(usd, 1, names, now);
Check(usdRow.OriginalCurrency == "USD" && usdRow.OriginalAmount == -100.23m && usdRow.Amount == 75m, "foreign amount kept");
Check(!CashBaselinePolicy.IsInternal(MonzoSyncPolicy.ToBank(savingsNoPot, 1, names, now)), "savings category without a pot is not an internal transfer");

var csvRow = new BankTransaction { Id = 69, BankAccountId = 1, Source = "CSV", ExternalId = "mm_a", MonzoTransactionId = "mm_a",
    TransactionDate = new DateTime(2026, 10, 9, 7, 37, 52), Amount = 6.20m, Direction = "Out" };
Check(MonzoSyncPolicy.FindExisting(card, 1, new[] { csvRow }) == csvRow, "CSV row matched by UK time, amount and direction");
Check(MonzoSyncPolicy.FindExisting(card, 2, new[] { csvRow }) == null, "other account never matched");
var twin = new BankTransaction { Id = 70, BankAccountId = 1, Source = "CSV", TransactionDate = new DateTime(2026, 10, 9, 7, 40, 0), Amount = 6.20m, Direction = "Out" };
Check(MonzoSyncPolicy.Match(card, 1, new[] { csvRow, twin }) is (null, true), "ambiguous fingerprint reported, never imported over the top");
Check(MonzoSyncPolicy.FindExisting(card, 1, new[] { new BankTransaction { BankAccountId = 1, Source = "CSV", ExternalId = "mm_b", MonzoTransactionId = "tx_9",
    TransactionDate = csvRow.TransactionDate, Amount = 6.20m, Direction = "Out" } }) == null, "row already claimed by another API id is not reused");
var apiRow = new BankTransaction { BankAccountId = 1, Source = "Monzo", ExternalId = "tx_1", MonzoTransactionId = "tx_1" };
Check(MonzoSyncPolicy.FindExisting(card, 1, new[] { apiRow }) == apiRow, "exact API id deduplicated");
Check(MonzoSyncPolicy.FindExisting(card, 1, new[] { with_amount() }) == null, "different amount not matched");

var pots = new[] { new MonzoPot("pot_vat", "VAT Pot", 508.31m, false), new MonzoPot("pot_ct", "CT Pot", 958.53m, false), new MonzoPot("pot_x", "Holiday", 10m, false) };
var (vat, ct) = MonzoSyncPolicy.MatchTaxPots(pots);
Check(vat?.Id == "pot_vat" && ct?.Id == "pot_ct", "tax pots identified by name");
Check(MonzoSyncPolicy.MatchTaxPots(pots.Append(new MonzoPot("pot_v2", "VAT reserve", 1m, false))).Vat == null, "ambiguous VAT pot refused");
Check(MonzoSyncPolicy.MatchTaxPots(pots.Append(new MonzoPot("pot_v2", "VAT reserve", 1m, true))).Vat?.Id == "pot_vat", "deleted pots ignored");

var interest = MonzoSyncPolicy.Interest(vat!, 508.14m, 0m);
Check(interest.Residual == 0.17m && interest.Recordable, "17p increase with no transfers recorded as interest");
var from = new DateTime(2026, 10, 9, 20, 38, 0, DateTimeKind.Utc);
var transfers = new[]
{
    new BankTransaction { TransactionDate = new DateTime(2026, 10, 9, 20, 30, 39), Amount = 142.03m, Direction = "In", Description = "VAT Pot - Pot transfer", Category = "Internal Transfer" },
    new BankTransaction { TransactionDate = new DateTime(2026, 10, 30, 15, 55, 29), Amount = 650m, Direction = "Out", Description = "VAT Pot - Pot transfer", Category = "Internal Transfer" },
    new BankTransaction { TransactionDate = new DateTime(2026, 10, 30, 15, 55, 39), Amount = 813m, Direction = "Out", Description = "CT Pot - Pot transfer", Category = "Internal Transfer" }
};
var net = MonzoSyncPolicy.NetTransfersIn("VAT Pot", transfers, from, new DateTime(2026, 10, 31, 6, 0, 0, DateTimeKind.Utc));
Check(net == 650m, "only VAT pot transfers after the previous snapshot counted");
var monthEnd = MonzoSyncPolicy.Interest(new MonzoPot("pot_vat", "VAT Pot", 1159.02m, false), 508.14m, net);
Check(monthEnd.Residual == 0.88m && monthEnd.Recordable, "interest separated from deposits");
Check(!MonzoSyncPolicy.Interest(vat!, 508.14m, -100m).Recordable, "unexplained large increase not booked as interest");
Check(!MonzoSyncPolicy.Interest(vat!, 600m, 0m).Recordable, "decrease never booked as interest");

const string secret = "client-secret-for-tests";
var state = MonzoSyncPolicy.SignState(secret, now.AddMinutes(15), "0123456789ABCDEF0123456789ABCDEF");
Check(MonzoSyncPolicy.VerifyState(secret, state, now), "signed state accepted");
Check(!MonzoSyncPolicy.VerifyState(secret, state, now.AddMinutes(16)), "expired state refused");
Check(!MonzoSyncPolicy.VerifyState("other", state, now), "state signed with another secret refused");
Check(!MonzoSyncPolicy.VerifyState(secret, state.Replace("0123", "9123"), now) && !MonzoSyncPolicy.VerifyState(secret, null, now)
    && !MonzoSyncPolicy.VerifyState(secret, "1.2", now), "tampered or missing state refused");
Console.WriteLine("All offline Monzo sync checks passed.");

BankTransaction with_amount() => new() { BankAccountId = 1, Source = "CSV", TransactionDate = csvRow.TransactionDate, Amount = 6.21m, Direction = "Out" };
