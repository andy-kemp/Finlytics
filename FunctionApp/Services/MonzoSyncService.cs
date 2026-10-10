#nullable enable
using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Services
{
    public sealed record MonzoSyncResult(int Imported, int Linked, int Unchanged, decimal? VatPot, decimal? CtPot,
        int? SnapshotLedgerId, List<PotInterest> InterestRecorded, List<string> Warnings, DateTime SyncedAtUtc,
        int Fetched, decimal MainAccountBalance, DateTime SinceUtc);

    public sealed class MonzoSyncService
    {
        private const int PageSize = 100;
        private readonly FinanceHubDbContext _db;
        private readonly MonzoClient _monzo;
        private readonly ILogger<MonzoSyncService> _logger;

        public MonzoSyncService(FinanceHubDbContext db, MonzoClient monzo, ILogger<MonzoSyncService> logger)
        {
            _db = db;
            _monzo = monzo;
            _logger = logger;
        }

        public async Task<MonzoSyncResult> Sync()
        {
            var nowUtc = DateTime.UtcNow;
            var monzoAccountId = await _monzo.ResolveAccountId();
            using var balanceDocument = await _monzo.Get($"/balance?account_id={Uri.EscapeDataString(monzoAccountId)}");
            var mainAccountBalance = balanceDocument.RootElement.GetProperty("balance").GetInt64() / 100m;
            using var potsDocument = await _monzo.Get($"/pots?current_account_id={Uri.EscapeDataString(monzoAccountId)}");
            var pots = potsDocument.RootElement.GetProperty("pots").EnumerateArray().Select(pot => new MonzoPot(
                pot.GetProperty("id").GetString()!, pot.GetProperty("name").GetString() ?? "Pot",
                pot.GetProperty("balance").GetInt64() / 100m,
                pot.TryGetProperty("deleted", out var deleted) && deleted.GetBoolean())).ToList();
            var potNames = pots.ToDictionary(pot => pot.Id, pot => pot.Name);

            var account = await MainAccount();
            var earliest = nowUtc.AddDays(-89);
            var latestRow = await _db.BankTransactions.AsNoTracking().Where(row => row.BankAccountId == account.Id && row.TransactionDate != null)
                .MaxAsync(row => (DateTime?)row.TransactionDate);
            var since = account.MonzoLastSyncedAt?.AddDays(-3)
                ?? (latestRow.HasValue ? MonzoSyncPolicy.FromUkLocal(latestRow.Value).AddDays(-3) : earliest);
            if (since < earliest) since = earliest;

            var transactions = new List<MonzoTransaction>();
            var cursor = since.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
            for (var page = 0; page < 50; page++)
            {
                using var document = await _monzo.Get($"/transactions?account_id={Uri.EscapeDataString(monzoAccountId)}&expand[]=merchant&limit={PageSize}&since={Uri.EscapeDataString(cursor)}");
                var batch = document.RootElement.GetProperty("transactions").EnumerateArray().Select(MonzoSyncPolicy.Parse).ToList();
                transactions.AddRange(batch);
                if (batch.Count < PageSize) break;
                cursor = batch[^1].Id;
            }

            return await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                await using var scope = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                var tracked = await _db.BankAccounts.SingleAsync(item => item.Id == account.Id);
                var existing = await _db.BankTransactions.Where(row => row.BankAccountId == account.Id).ToListAsync();
                int imported = 0, linked = 0, unchanged = 0;
                var warnings = new List<string>();
                foreach (var tx in transactions.Where(MonzoSyncPolicy.Importable).DistinctBy(tx => tx.Id))
                {
                    var (match, ambiguous) = MonzoSyncPolicy.Match(tx, account.Id, existing);
                    if (ambiguous)
                    {
                        warnings.Add($"{tx.MerchantName ?? tx.Description} {Math.Abs(tx.AmountPence) / 100m:0.00} on {MonzoSyncPolicy.ToUkLocal(tx.CreatedUtc):dd/MM HH:mm} could duplicate an existing CSV row; not imported. Check timestamps and transaction IDs.");
                        continue;
                    }
                    if (match == null)
                    {
                        var row = MonzoSyncPolicy.ToBank(tx, account.Id, potNames, nowUtc);
                        _db.BankTransactions.Add(row);
                        existing.Add(row);
                        imported++;
                    }
                    else if (match.MonzoTransactionId != tx.Id && match.ExternalId != tx.Id)
                    {
                        match.MonzoTransactionId = tx.Id;
                        match.ModifiedDate = nowUtc;
                        linked++;
                    }
                    else unchanged++;
                }
                await _db.SaveChangesAsync();

                var interest = new List<PotInterest>();
                int? snapshotId = null;
                var (vat, ct) = MonzoSyncPolicy.MatchTaxPots(pots);
                if (vat == null || ct == null)
                    warnings.Add("Could not identify exactly one VAT pot and one CT pot by name; pot balances were not updated");
                else
                {
                    var snapshots = (await _db.CompanyLedger.AsNoTracking().Where(entry => entry.EntryType == PotBalancePolicy.EntryType).ToListAsync())
                        .Select(entry => PotBalancePolicy.Read(entry, nowUtc)).Where(record => record.BankAccountId == account.Id).ToList();
                    var latest = PotBalancePolicy.Latest(snapshots);
                    if (latest == null || latest.VatPotBalance != vat.Balance || latest.CtPotBalance != ct.Balance)
                    {
                        if (latest != null)
                        {
                            foreach (var (pot, previous) in new[] { (vat, latest.VatPotBalance), (ct, latest.CtPotBalance) })
                            {
                                var result = MonzoSyncPolicy.Interest(pot,
                                    previous, MonzoSyncPolicy.NetTransfersIn(pot.Name, existing, latest.RecordedAtUtc, nowUtc));
                                if (result.Recordable)
                                {
                                    _db.CompanyLedger.Add(InterestEntry(result, latest.LedgerEntryId, nowUtc));
                                    interest.Add(result);
                                }
                                else if (Math.Abs(result.Residual) >= 0.01m)
                                    warnings.Add($"{pot.Name} changed by {result.Residual:0.00} more than recorded transfers explain; check for missing transfers before treating it as interest");
                            }
                        }
                        snapshotId = await RecordSnapshot(account.Id, vat.Balance, ct.Balance, nowUtc);
                    }
                }

                tracked.MonzoConnected = true;
                tracked.MonzoAccountId = monzoAccountId;
                tracked.MonzoLastSyncedAt = nowUtc;
                tracked.ModifiedDate = nowUtc;
                await _db.SaveChangesAsync();
                await scope.CommitAsync();
                foreach (var warning in warnings) _logger.LogWarning("Monzo sync: {Warning}", warning);
                return new MonzoSyncResult(imported, linked, unchanged, vat?.Balance, ct?.Balance, snapshotId, interest, warnings, nowUtc,
                    transactions.DistinctBy(transaction => transaction.Id).Count(), mainAccountBalance, since);
            });
        }

        private async Task<BankAccount> MainAccount()
        {
            var accounts = await _db.BankAccounts.AsNoTracking().ToListAsync();
            var active = accounts.Where(item => item.IsActive && item.Currency == "GBP").ToList();
            if (active.Count != 1) throw new InvalidOperationException("Monzo sync needs exactly one active GBP bank account");
            return active[0];
        }

        private static CompanyLedgerEntry InterestEntry(PotInterest interest, int previousSnapshotId, DateTime nowUtc) => new()
        {
            Title = $"Bank interest - {interest.PotName}",
            EntryType = MonzoSyncPolicy.InterestEntryType,
            Amount = interest.Residual,
            EffectiveDate = nowUtc.Date,
            PeriodKey = nowUtc.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            TaxYear = nowUtc.Month > 4 || (nowUtc.Month == 4 && nowUtc.Day >= 6) ? nowUtc.Year : nowUtc.Year - 1,
            FinancialYear = MonthlyReconciliationPolicy.TaxYear(nowUtc),
            Notes = $"{MonzoSyncPolicy.InterestMarker(interest.PotId, $"{previousSnapshotId}-{nowUtc:yyyyMMddHHmm}")} "
                + $"Derived from Monzo: {interest.PotName} balance {interest.Previous:0.00} -> {interest.Current:0.00}, "
                + $"net transfers in {interest.NetTransfersIn:0.00}. Interest is paid into the pot, not the main account; taxable for Corporation Tax."
        };

        private async Task<int> RecordSnapshot(int accountId, decimal vat, decimal ct, DateTime nowUtc)
        {
            var request = new PotBalanceRequest(vat, ct, nowUtc.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), "Monzo API daily sync");
            var validation = PotBalancePolicy.Validate(request, nowUtc);
            if (validation != null) throw new InvalidOperationException(validation);
            var snapshot = PotBalancePolicy.Create(accountId, request, nowUtc);
            var entry = new CompanyLedgerEntry
            {
                Title = "Monzo pot balances", EntryType = PotBalancePolicy.EntryType, Amount = 0,
                EffectiveDate = nowUtc.Date, PeriodKey = nowUtc.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                TaxYear = nowUtc.Month > 4 || (nowUtc.Month == 4 && nowUtc.Day >= 6) ? nowUtc.Year : nowUtc.Year - 1,
                Notes = PotBalancePolicy.Notes(snapshot)
            };
            _db.CompanyLedger.Add(entry);
            await _db.SaveChangesAsync();
            entry.Notes = PotBalancePolicy.Notes(snapshot with { LedgerEntryId = entry.Id });
            await _db.SaveChangesAsync();
            return entry.Id;
        }
    }
}
