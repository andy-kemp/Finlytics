import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fields = ['OriginalCurrency', 'OriginalAmountNet', 'OriginalVatAmount', 'OriginalAmountGross', 'ExchangeRateToGbp', 'ExchangeRateDate', 'ExchangeRateSource', 'EstimatedGbpGross', 'ActualGbpPaid', 'SettlementDate', 'SettlementBankTransactionId'];

test('Expense and DLA expose the same nullable metadata and explicit copy assignments', () => {
    for (const field of fields) {
        for (const model of ['Expense', 'DlaEntry']) assert.match(read(`Models/${model}.cs`), new RegExp(`\\? ${field} \\{ get; set; \\}`));
        assert.ok(read('Helpers/ForeignCurrencyHelper.cs').includes(`target.${field} = source.${field};`));
    }
});

test('SQL, EF migration and snapshot include every nullable field without GBP data updates', () => {
    for (const path of ['Migrations/Add-Multicurrency-Metadata.sql', 'Migrations/20261008120000_AddMulticurrencyMetadata.cs', 'Migrations/FinanceHubDbContextModelSnapshot.cs']) {
        for (const field of [...fields, 'OriginalAmount']) assert.ok(read(path).includes(field), `${path}: ${field}`);
        assert.ok(read(path).includes('decimal(18,8)'));
    }
    const migration = read('Migrations/20261008120000_AddMulticurrencyMetadata.cs');
    assert.match(migration, /\[Migration\("20261008120000_AddMulticurrencyMetadata"\)\]/);
    assert.match(migration, /COL_LENGTH/);
    assert.doesNotMatch(migration, /UPDATE |defaultValue:/);
    assert.doesNotMatch(read('Migrations/Add-Multicurrency-Metadata.sql'), /UPDATE |DEFAULT /);
});

test('OCR extracts SDK currency code, not symbol guesses, and keeps existing provider', () => {
    const source = read('Functions/AnalyzeInvoiceFunctions.cs');
    assert.match(source, /AsCurrency\(\)\.Code/);
    assert.match(source, /currency\s*= currency,/);
    assert.doesNotMatch(source, /AsCurrency\(\)\.Symbol/);
    assert.match(source, /DocumentAnalysisClient/);
});

test('All manual update paths preserve omitted values and copy currency metadata', () => {
    for (const path of ['Functions/ExpenseFunctions.cs', 'Functions/DlaFunctions.cs', 'Functions/EmployeePortalFunctions.cs']) {
        const source = read(path);
        assert.match(source, /ForeignCurrencyHelper\.PreserveOmitted/);
        assert.match(source, /ForeignCurrencyHelper\.Copy/);
        assert.match(source, /ForeignCurrencyHelper\.Validate/);
    }
    assert.match(read('Functions/BankingFunctions.cs'), /existing\.OriginalAmount = transaction\.OriginalAmount/);
});

test('Settlement PATCH is protected, narrowly scoped and serializes duplicate checks', () => {
    const source = read('Functions/GbpSettlementFunctions.cs');
    assert.match(source, /AuthorizationLevel\.Anonymous, "patch", Route = "expenses\/\{id:int\}\/gbp-settlement"/);
    assert.doesNotMatch(source, /AuthorizationLevel\.Function/);
    const guard = source.indexOf('await _auth.ValidateRequest(req');
    assert.ok(guard >= 0 && guard < source.indexOf('req.ReadAsStringAsync()'));
    assert.ok(guard < source.indexOf('_db.Database.CreateExecutionStrategy()'));
    assert.match(source, /if \(!authorization\.IsAuthorized\)\s+return await Error\(authorization\.StatusCode, authorization\.Error/);
    assert.match(read('Program.cs'), /AddSingleton<SettlementAuthService>\(\)/);
    assert.match(source, /CreateExecutionStrategy\(\)\.ExecuteAsync/);
    assert.match(source, /BeginTransactionAsync\(IsolationLevel\.Serializable\)/);
    assert.match(source, /GbpSettlementPolicy\.Conflicts/);
    assert.match(source, /GbpSettlementPolicy\.ValidateBank/);
    assert.match(source, /_db\.Expenses\.AnyAsync/);
    assert.match(source, /_db\.DlaEntries\.AnyAsync/);
    assert.match(source, /Distinct\(StringComparer\.OrdinalIgnoreCase\)/);
    const assignments = [...source.matchAll(/expense\.(\w+)\s*=(?!=)/g)].map(match => match[1]);
    assert.deepEqual(assignments.sort(), ['ActualGbpPaid', 'SettlementBankTransactionId', 'SettlementDate']);
    assert.match(source, /transaction\.CommitAsync/);
    assert.match(source, /WriteAsJsonAsync\(new \{ error = message \}, status\)/);
});

test('Ordinary writes cannot introduce bank links or overwrite confirmed settlements', () => {
    const helper = read('Helpers/ForeignCurrencyHelper.cs');
    assert.match(helper, /existing\.SettlementBankTransactionId != record\.SettlementBankTransactionId/);
    assert.match(helper, /GbpSettlementPolicy\.Conflicts/);
    assert.match(helper, /record is DlaStartupRequest/);
    for (const file of ['ExpenseFunctions', 'DlaFunctions', 'EmployeePortalFunctions']) {
        assert.match(read(`Functions/${file}.cs`), /BeginTransactionAsync\(System\.Data\.IsolationLevel\.Serializable\)/);
        assert.match(read(`Functions/${file}.cs`), /CreateExecutionStrategy\(\)\.ExecuteAsync/);
    }
});

test('Foreign metadata migration is discovered and applied by existing startup migration path', () => {
    assert.match(read('Program.cs'), /dbContext\.Database\.Migrate\(\)/);
    assert.match(read('Migrations/20261008120000_AddMulticurrencyMetadata.cs'), /DbContext\(typeof\(FinanceHubDbContext\)\)/);
});