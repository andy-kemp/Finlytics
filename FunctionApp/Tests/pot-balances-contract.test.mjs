import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const endpoint = read('../Functions/CashBaselineFunctions.cs');
const policy = read('../Helpers/PotBalancePolicy.cs');
const generic = read('../Functions/CompanyLedgerFunctions.cs');
const cash = read('../Helpers/CashBaselinePolicy.cs');
const repository = read('../Data/Repositories.cs');
const get = endpoint.slice(endpoint.indexOf('public async Task<HttpResponseData> GetBankPotBalances('),
    endpoint.indexOf('[Function("CreateBankPotBalances")]'));
const post = endpoint.slice(endpoint.indexOf('public async Task<HttpResponseData> CreateBankPotBalances('),
    endpoint.indexOf('[Function("GetBankCashBaseline")]'));

test('GET and POST expose only the dated account pot route and authenticate before body or database access', () => {
    assert.equal((endpoint.match(/Route = "bank\/accounts\/\{id:int\}\/pot-balances"/g) || []).length, 2);
    for (const method of [get, post]) {
        assert.ok(method.indexOf('_auth.ValidateRequest(req)') >= 0);
        assert.ok(method.indexOf('!authorization.IsAuthorized') < method.indexOf('_db.'));
        assert.match(method, /CashBaselinePolicy\.ValidateAccount\(id, accounts\)/);
    }
    assert.ok(post.indexOf('!authorization.IsAuthorized') < post.indexOf('req.ReadAsStringAsync()'));
    assert.match(get, /PotBalancePolicy\.Latest\(await PotSnapshots\(id, DateTime.UtcNow\)\)/);
});

test('strict bounded request parsing and four-field owner assertion contract', () => {
    assert.match(post, /body.Length > 16000/);
    assert.match(post, /HasDuplicateProperties\(document.RootElement\)/);
    assert.match(post, /Deserialize<PotBalanceRequest>\(body, CashBaselinePolicy.Json\)/);
    assert.match(cash, /UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow/);
    assert.match(policy, /PotBalanceRequest\(decimal\? VatPotBalance, decimal\? CtPotBalance, string\? AsOfDate, string\? Reference\)/);
    assert.doesNotMatch(policy, /InterestAmount|TaxEstimate|StatementBalance|BookBalance/);
});

test('serializable retries append audits without deleting or updating prior snapshots', () => {
    assert.match(post, /IsolationLevel.Serializable/);
    assert.match(post, /records.Where\(record => PotBalancePolicy.Identical\(record, request\)\)/);
    assert.match(post, /if \(identical != null\) return await Result\(req, identical\)/);
    assert.match(post, /_db.CompanyLedger.Add\(entry\)/);
    assert.match(post, /snapshot = snapshot with \{ LedgerEntryId = entry.Id \}/);
    assert.match(post, /entry.Notes = PotBalancePolicy.Notes\(snapshot\)/);
    assert.match(post, /transaction.CommitAsync\(\)/);
    assert.match(post, /entry.Notes.Length > 2000/);
    assert.doesNotMatch(post, /\.Remove|\.Update|ExecuteDelete|ExecuteUpdate|ValidateSources|CashBaselinePolicy.Create/);
    assert.match(policy, /OrderByDescending\(record => record.AsOfDate, StringComparer.Ordinal\)/);
    assert.match(policy, /ThenByDescending\(record => record.LedgerEntryId\)/);
});

test('reserved ledger type and case-insensitive forged markers are protected on generic create and delete', () => {
    assert.match(policy, /EntryType = "Bank_PotSnapshot"/);
    assert.match(policy, /\[POT-BALANCES:\{accountId\}\]/);
    assert.match(policy, /Contains\("\[POT-BALANCES:", StringComparison.OrdinalIgnoreCase\)/);
    assert.equal((generic.match(/PotBalancePolicy.IsReserved\(entry\)/g) || []).length, 2);
    assert.match(generic, /Pot snapshots are reserved for the bank pot-balances endpoint/);
    assert.match(generic, /An audited pot snapshot cannot be deleted/);
});

test('snapshot is zero-amount metadata and is not a cash movement or profit aggregate', () => {
    assert.match(post, /EntryType = PotBalancePolicy.EntryType,\s+Amount = 0/);
    const movements = cash.slice(cash.indexOf('CashMovements()'), cash.indexOf('public decimal Calculate'));
    assert.doesNotMatch(movements, /Bank_PotSnapshot|PotBalancePolicy/);
    assert.match(movements, /else if \(outgoing.Contains\(entry.EntryType\)\)/);
    const aggregates = repository.slice(repository.indexOf('private static CompanyAggregates BuildAggregates'),
        repository.indexOf('public class ShareholderRepository'));
    assert.match(aggregates, /switch \(entry.EntryType\)/);
    assert.doesNotMatch(aggregates, /Bank_PotSnapshot|PotBalancePolicy|default:/);
});