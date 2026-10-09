import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const endpoint = read('../Functions/CashBaselineFunctions.cs');
const generic = read('../Functions/CompanyLedgerFunctions.cs');
const policy = read('../Helpers/CashBaselineAmendmentPolicy.cs');
const get = endpoint.slice(endpoint.indexOf('public async Task<HttpResponseData> GetBankCashBaseline('),
    endpoint.indexOf('[Function("CreateBankCashBaseline")]'));

test('amendments compose only on the dedicated authorised baseline read with no new writer or migration', () => {
    assert.ok(get.indexOf('!authorization.IsAuthorized') < get.indexOf('_db.'));
    assert.match(get, /CashBaselinePolicy.ValidateAccount\(id, accounts\)/);
    assert.match(get, /CashBaselinePolicy.Read\(entries\[0\], id\)/);
    assert.match(get, /CashBaselineAmendmentPolicy.Compose\(baseline, amendments, expenses, DateTime.UtcNow\)/);
    assert.match(get, /_db.Expenses.AsNoTracking\(\)/);
    assert.match(get, /entries.Count == 0 && amendments.Count == 0/);
    assert.doesNotMatch(get, /SaveChanges|\.Add\(|ExecuteUpdate|ExecuteDelete/);
    assert.doesNotMatch(endpoint, /Route = "[^"\n]*amendment/);
    assert.doesNotMatch(policy, /DbContext|SaveChanges|HttpTrigger/);
});

test('reserved amendment type and forged markers are guarded on generic creation and deletion', () => {
    assert.equal((generic.match(/CashBaselineAmendmentPolicy.IsReserved\(entry\)/g) || []).length, 2);
    assert.match(generic, /An audited cash baseline amendment cannot be deleted/);
    assert.match(policy, /EntryType = "Cash_BaselineAmendment"/);
    assert.match(policy, /Contains\("\[CASH-BASELINE-AMENDMENT:", StringComparison.OrdinalIgnoreCase\)/);
    assert.match(policy, /StartsWith\(prefix, StringComparison.Ordinal\)/);
});

test('audit display separates amendments from raw source delta and internal transfers', () => {
    const dashboard = read('../../StaticWebApp/src/components/Dashboard.jsx');
    assert.match(dashboard, /\['Historical baseline amendments', metrics.cashBaseline.historicalExpenseAdjustment \?\? 0\]/);
    assert.match(dashboard, /- Number\(metrics.cashBaseline.historicalExpenseAdjustment \?\? 0\) - metrics.sourceDifference/);
    for (const field of ['recordedAtUtc', 'reason', 'expenseIds', 'externalIds', 'ledgerEntryId', 'baselineLedgerEntryId'])
        assert.ok(dashboard.includes(`amendment.${field}`));
});

test('raw cash and corporation-tax/VAT aggregations have no amendment branch', () => {
    const cash = read('../Helpers/CashBaselinePolicy.cs');
    const movements = cash.slice(cash.indexOf('CashMovements()'), cash.indexOf('public decimal Calculate'));
    assert.doesNotMatch(movements, /Cash_BaselineAmendment|CashBaselineAmendmentPolicy/);
    const repository = read('../Data/Repositories.cs');
    const aggregates = repository.slice(repository.indexOf('private static CompanyAggregates BuildAggregates'),
        repository.indexOf('public class ShareholderRepository'));
    assert.doesNotMatch(aggregates, /Cash_BaselineAmendment|CashBaselineAmendmentPolicy|default:/);
});