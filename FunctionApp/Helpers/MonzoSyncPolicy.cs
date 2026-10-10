#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed class BankDuplicateReviewException : InvalidOperationException
    {
        public BankDuplicateReviewException() : base("CSV and Monzo rows may represent the same payment; review duplicates before importing. No rows from this batch were saved.") { }
    }

    public sealed record MonzoTransaction(string Id, DateTime CreatedUtc, long AmountPence, string? Description, string? MerchantName,
        string? Category, string? Notes, string? Reference, string? PotId, string? LocalCurrency, long? LocalAmountPence, bool Declined);

    public sealed record MonzoPot(string Id, string Name, decimal Balance, bool Deleted);

    public sealed record PotInterest(string PotId, string PotName, decimal Previous, decimal Current, decimal NetTransfersIn, decimal Residual)
    {
        public bool Recordable => Residual > 0 && Residual <= Math.Max(1m, Previous * 0.02m);
    }

    public static class MonzoSyncPolicy
    {
        public const string Source = "Monzo";
        public const string InterestEntryType = "Interest_Received";
        public static readonly TimeSpan FingerprintWindow = TimeSpan.FromMinutes(10);
        private static readonly TimeZoneInfo UkZone = ResolveUkZone();

        private static TimeZoneInfo ResolveUkZone()
        {
            foreach (var id in new[] { "Europe/London", "GMT Standard Time" })
                if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone)) return zone;
            return TimeZoneInfo.Utc;
        }

        // CSV imports store UK local wall-clock times, so API rows use the same convention.
        public static DateTime ToUkLocal(DateTime utc) =>
            DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), UkZone), DateTimeKind.Unspecified);

        public static DateTime FromUkLocal(DateTime local) =>
            TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), UkZone);

        public static MonzoTransaction Parse(JsonElement tx)
        {
            string? Text(JsonElement parent, string name) =>
                parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                    ? value.GetString() : null;
            var metadata = tx.TryGetProperty("metadata", out var meta) && meta.ValueKind == JsonValueKind.Object ? meta : default;
            var merchant = tx.TryGetProperty("merchant", out var m) && m.ValueKind == JsonValueKind.Object ? Text(m, "name") : null;
            var created = DateTime.Parse(Text(tx, "created") ?? throw new InvalidOperationException("Monzo transaction has no created time"),
                CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            var potId = metadata.ValueKind == JsonValueKind.Object ? Text(metadata, "pot_id") : null;
            if (potId == null && Text(tx, "scheme") == "uk_retail_pot") potId = Text(tx, "description");
            return new(
                Text(tx, "id") ?? throw new InvalidOperationException("Monzo transaction has no id"),
                created,
                tx.TryGetProperty("amount", out var amount) ? amount.GetInt64() : 0,
                Text(tx, "description"), merchant, Text(tx, "category"), Text(tx, "notes"),
                metadata.ValueKind == JsonValueKind.Object ? Text(metadata, "faster_payment") ?? Text(metadata, "reference") : null,
                potId, Text(tx, "local_currency"),
                tx.TryGetProperty("local_amount", out var local) && local.ValueKind == JsonValueKind.Number ? local.GetInt64() : null,
                !string.IsNullOrEmpty(Text(tx, "decline_reason")));
        }

        public static bool Importable(MonzoTransaction tx) => !tx.Declined && tx.AmountPence != 0;

        public static string MapCategory(string? category, long amountPence) => amountPence > 0 ? "Income" : category switch
        {
            "transport" => "Travel", "eating_out" => "Meals", "entertainment" => "Entertainment", "bills" => "Utilities",
            "groceries" => "Groceries", "shopping" => "Shopping", "expenses" => "Other Expenses", "general" => "General",
            "holidays" => "Travel", "transfers" => "Transfer - Review", "savings" => "Savings - Review",
            _ => string.IsNullOrWhiteSpace(category) ? "Other Expenses" : category
        };

        public static BankTransaction ToBank(MonzoTransaction tx, int accountId, IReadOnlyDictionary<string, string> potNames, DateTime nowUtc)
        {
            var pot = tx.PotId != null;
            var potName = pot && potNames.TryGetValue(tx.PotId!, out var name) ? name : "Pot";
            var currency = tx.LocalCurrency?.ToUpperInvariant();
            var foreignOk = currency is "GBP" or "EUR" or "USD" && tx.LocalAmountPence.HasValue;
            return new BankTransaction
            {
                BankAccountId = accountId,
                TransactionDate = ToUkLocal(tx.CreatedUtc),
                Amount = Math.Abs(tx.AmountPence) / 100m,
                Direction = tx.AmountPence > 0 ? "In" : "Out",
                Description = pot ? $"{potName} - Pot transfer" : tx.MerchantName ?? tx.Description,
                Reference = tx.Reference,
                Category = pot ? "Internal Transfer" : MapCategory(tx.Category, tx.AmountPence),
                Source = Source,
                ExternalId = tx.Id,
                MonzoTransactionId = tx.Id,
                MonzoMerchantName = pot ? potName : tx.MerchantName,
                MonzoCategory = tx.Category,
                MonzoNotes = tx.Notes,
                OriginalCurrency = foreignOk ? currency : null,
                OriginalAmount = foreignOk ? tx.LocalAmountPence!.Value / 100m : null,
                IsReconciled = false,
                CreatedDate = nowUtc
            };
        }

        // Rows imported from the CSV export carry different IDs, so the API row is matched by time, amount and direction.
        public static BankTransaction? FindExisting(MonzoTransaction tx, int accountId, IEnumerable<BankTransaction> existing) =>
            Match(tx, accountId, existing).Row;

        public static bool PossibleCrossFeedDuplicate(BankTransaction left, BankTransaction right) =>
            left.BankAccountId == right.BankAccountId && left.TransactionDate.HasValue && right.TransactionDate.HasValue
            && left.TransactionDate.Value.Date == right.TransactionDate.Value.Date && left.Amount is > 0 && right.Amount is > 0
            && Math.Abs(left.Amount.Value) == Math.Abs(right.Amount.Value) && left.Direction == right.Direction
            && CashBaselinePolicy.IsInternal(left) == CashBaselinePolicy.IsInternal(right)
            && ((left.Source == "CSV" && right.Source == Source) || (left.Source == Source && right.Source == "CSV"));

        public static (BankTransaction? Row, bool Ambiguous) Match(MonzoTransaction tx, int accountId, IEnumerable<BankTransaction> existing)
        {
            var rows = existing.Where(row => row.BankAccountId == accountId).ToList();
            var exact = rows.FirstOrDefault(row => row.ExternalId == tx.Id || row.MonzoTransactionId == tx.Id || row.TrueLayerTransactionId == tx.Id);
            if (exact != null) return (exact, false);
            var local = ToUkLocal(tx.CreatedUtc);
            var exported = DateTime.SpecifyKind(tx.CreatedUtc, DateTimeKind.Unspecified);
            var amount = Math.Abs(tx.AmountPence) / 100m;
            var direction = tx.AmountPence > 0 ? "In" : "Out";
            var eligible = rows.Where(row => row.TransactionDate.HasValue
                && Math.Abs(row.Amount ?? 0) == amount && row.Direction == direction && row.Source != Source
                && CashBaselinePolicy.IsInternal(row) == (tx.PotId != null)
                && (string.IsNullOrEmpty(row.MonzoTransactionId) || row.MonzoTransactionId == row.ExternalId)).ToList();
            var exactTime = eligible.Where(row => Math.Abs((row.TransactionDate!.Value - local).TotalSeconds) < 1
                || Math.Abs((row.TransactionDate!.Value - exported).TotalSeconds) < 1).ToList();
            if (exactTime.Count == 1) return (exactTime[0], false);
            if (exactTime.Count > 1) return (null, true);
            var candidates = eligible.Where(row => Math.Abs((row.TransactionDate!.Value - local).TotalMinutes) <= FingerprintWindow.TotalMinutes
                || Math.Abs((row.TransactionDate!.Value - exported).TotalMinutes) <= FingerprintWindow.TotalMinutes).ToList();
            if (candidates.Count == 1) return (candidates[0], false);
            if (candidates.Count > 1) return (null, true);
            var possibleCsvDuplicate = rows.Any(row => row.Source == "CSV"
                && row.TransactionDate?.Date == local.Date
                && CashBaselinePolicy.IsInternal(row) == (tx.PotId != null)
                && Math.Abs(row.Amount ?? 0) == amount && row.Direction == direction);
            return (null, possibleCsvDuplicate);
        }

        public static (MonzoPot? Vat, MonzoPot? Ct) MatchTaxPots(IEnumerable<MonzoPot> pots)
        {
            var active = pots.Where(pot => !pot.Deleted).ToList();
            var vat = active.Where(pot => Regex.IsMatch(pot.Name, @"\bVAT\b", RegexOptions.IgnoreCase)).ToList();
            var ct = active.Where(pot => Regex.IsMatch(pot.Name, @"\bCT\b|corporation", RegexOptions.IgnoreCase)).ToList();
            return (vat.Count == 1 ? vat[0] : null, ct.Count == 1 ? ct[0] : null);
        }

        public static decimal NetTransfersIn(string potName, IEnumerable<BankTransaction> transactions, DateTime fromUtc, DateTime toUtc) =>
            transactions.Where(row => row.TransactionDate.HasValue && CashBaselinePolicy.IsInternal(row)
                    && (row.Description ?? "").StartsWith(potName + " - ", StringComparison.OrdinalIgnoreCase))
                .Where(row => { var utc = FromUkLocal(row.TransactionDate!.Value); return utc > fromUtc && utc <= toUtc; })
                .Sum(row => Math.Abs(row.Amount ?? 0) * (row.Direction == "Out" ? 1 : -1));

        public static PotInterest Interest(MonzoPot pot, decimal previous, decimal netTransfersIn) =>
            new(pot.Id, pot.Name, previous, pot.Balance, netTransfersIn, pot.Balance - previous - netTransfersIn);

        public static string InterestMarker(string potId, string periodKey) => $"[POT-INTEREST:{potId}:{periodKey}]";

        public static string SignState(string secret, DateTime expiresUtc, string nonce)
        {
            var payload = $"{new DateTimeOffset(expiresUtc).ToUnixTimeSeconds()}.{nonce}";
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            return payload + "." + Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        public static bool VerifyState(string secret, string? state, DateTime nowUtc)
        {
            var parts = state?.Split('.');
            if (parts is not { Length: 3 } || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var expires)
                || DateTimeOffset.FromUnixTimeSeconds(expires).UtcDateTime < nowUtc || parts[1].Length < 16) return false;
            var expected = SignState(secret, DateTimeOffset.FromUnixTimeSeconds(expires).UtcDateTime, parts[1]);
            return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(state!));
        }
    }
}
