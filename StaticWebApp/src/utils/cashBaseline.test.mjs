import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateMainAccountBookBalance, loadMainAccountCashBaseline } from './cashBaseline.mjs';
import { calculateRecordedTradingCash } from './cashCalculations.mjs';

const baseline = {
    bankAccountId: 7, bookBalance: 1029.15, statementBalance: 996.86,
    asOfDate: '2026-10-01', recordedCashAtCreation: 2500,
    pendingExpenses: [{ externalId: 'first', amount: 19.99 }, { externalId: 'second', amount: 12.30 }]
};
const endDate = '2026-10-08';
const calculate = (balance = 2500, transactions = [], snapshot = baseline) =>
    calculateMainAccountBookBalance({ balance }, snapshot, transactions, endDate);
const transfer = overrides => ({ bankAccountId: 7, amount: 200, direction: 'Out',
    category: 'Internal Transfer', transactionDate: '2026-10-02', ...overrides });

test('generic audited baseline, not the statement balance or hardcoded amount', () => {
    assert.equal(calculate(), 1029.15);
    assert.equal(calculate(2500, [], { ...baseline, bookBalance: 88.75 }), 88.75);
    assert.equal(calculate(2500, undefined, null), 2500);
});

test('pending expenses are deducted once when recorded, including historical payment dates', () => {
    const invoice = { status: 'Paid', amountGross: 2500, datePaid: '2026-09-01' };
    const first = { id: 'first', amountGross: 19.99, datePaid: '2026-10-02' };
    const second = { id: 'second', amountGross: 12.30, datePaid: '2026-09-30' };
    const raw = expenses => calculateRecordedTradingCash({ invoices: [invoice], expenses, endDate: new Date(endDate) });
    assert.equal(calculate(raw([first]).balance), 1009.16);
    assert.equal(calculate(raw([first, second]).balance), 996.86);
    assert.equal(calculate(raw([first, second]).balance, [transfer({ category: 'Expenses', amount: 19.99 })]), 996.86);
});

test('snapshot-captured historical expenses are not deducted again and same-id edits change the delta once', () => {
    const records = { invoices: [{ status: 'Paid', amountGross: 2500, datePaid: '2026-09-01' }],
        expenses: [{ id: 'first', amountGross: 19.99, datePaid: '2026-09-30' }], endDate: new Date(endDate) };
    const original = calculateRecordedTradingCash(records);
    const snapshot = { ...baseline, recordedCashAtCreation: original.balance };
    assert.equal(calculate(original.balance, [], snapshot), 1029.15);
    records.expenses[0].amountGross = 29.99;
    assert.equal(calculate(calculateRecordedTradingCash(records).balance, [], snapshot), 1019.15);
});

test('new income and DLA payment use recorded cash only, never duplicate bank payments', () => {
    assert.equal(calculate(2700, [transfer({ category: 'Income', direction: 'In' })]), 1229.15);
    assert.equal(calculate(2600, [transfer({ category: 'DLA Payment', amount: 100 })]), 1129.15);
    assert.equal(calculate(2600, [transfer()]), 929.15);
});

test('only main-account internal transfers count with In positive and Out negative', () => {
    assert.equal(calculate(2500, [transfer()]), 829.15);
    assert.equal(calculate(2500, [transfer({ direction: 'In' })]), 1229.15);
    assert.equal(calculate(2500, [transfer(), transfer({ direction: 'In', amount: 50 })]), 879.15);
    assert.equal(calculate(2500, [transfer({ category: '', description: 'Tax pot - Pot transfer' })]), 829.15);
    assert.equal(calculate(2500, [transfer({ bankAccountId: 8 }), transfer({ bankAccountId: null }),
        transfer({ category: 'Interest', description: 'Interest in tax pot', direction: 'In' }),
        transfer({ category: 'Expenses', description: 'Payment for pot transfer service' }),
        transfer({ category: 'Income', direction: 'In' })]), 1029.15);
});

test('cutoff excludes the whole baseline day; end date includes the whole UTC day; valueDate wins', () => {
    assert.equal(calculate(2500, [transfer({ transactionDate: '2026-10-01T23:59:59Z' }),
        transfer({ transactionDate: '2026-09-30' }), transfer({ transactionDate: '2026-10-09' })]), 1029.15);
    assert.equal(calculate(2500, [transfer({ transactionDate: '2026-10-08T23:59:59' })]), 829.15);
    assert.equal(calculate(2500, [transfer({ transactionDate: '2026-09-30', valueDate: '2026-10-02' })]), 829.15);
    assert.equal(calculate(2500, [transfer({ transactionDate: '2026-10-02T00:30:00+01:00' })]), 1029.15);
    assert.equal(calculate(2500, [transfer({ transactionDate: '2026-10-09T00:30:00+01:00' })]), 829.15);
});

test('known empty feed is valid; missing feeds, invalid values and pre-baseline dates fail visibly', () => {
    assert.equal(calculate(), 1029.15);
    for (const feed of [null, undefined, {}]) {
        assert.throws(() => calculateMainAccountBookBalance({ balance: 2500 }, baseline, feed, endDate), /transactions unavailable/);
    }
    assert.throws(() => calculate(2500, [transfer({ direction: 'Unknown' })]), /invalid direction/);
    assert.throws(() => calculate(2500, [transfer({ transactionDate: 'invalid' })]), /invalid date/);
    assert.throws(() => calculate(2500, [], { ...baseline, bookBalance: null }), /invalid amount/);
    assert.throws(() => calculateMainAccountBookBalance({ balance: 2500 }, baseline, [], '2026-09-30'), /before its baseline/);
});

test('baseline does not enter period cash flow or change raw tax-reserve basis', () => {
    const records = { invoices: [{ status: 'Paid', amountGross: 2500, datePaid: '2026-09-01' },
        { status: 'Paid', amountGross: 200, datePaid: '2026-10-03' }], endDate: new Date(endDate) };
    const raw = calculateRecordedTradingCash(records);
    assert.equal(calculateMainAccountBookBalance(raw, baseline, [], endDate), 1229.15);
    assert.equal(calculateRecordedTradingCash({ ...records, startDate: new Date('2026-10-01') }).balance, 200);
    assert.equal(raw.balance - 200, 2500);
});

const readers = overrides => ({
    getBankAccounts: async () => [{ id: 7, isActive: true, currency: 'GBP' }],
    getCashBaseline: async () => baseline,
    getBankTransactionsByAccount: async () => [], ...overrides
});

test('read-only loader selects exactly one active GBP account and retains feed errors and audit data', async () => {
    const result = await loadMainAccountCashBaseline(readers());
    assert.equal(result.error, null);
    assert.equal(result.baseline, baseline);
    for (const accounts of [[], [{ id: 7, isActive: false, currency: 'GBP' }],
        [{ id: 7, isActive: true, currency: 'USD' }],
        [{ id: 7, isActive: true, currency: 'GBP' }, { id: 8, isActive: true, currency: 'GBP' }]]) {
        const state = await loadMainAccountCashBaseline(readers({ getBankAccounts: async () => accounts }));
        assert.match(state.error, /exactly one/);
    }
    const failed = await loadMainAccountCashBaseline(readers({ getBankTransactionsByAccount: async () => { throw new Error('Feed failed'); } }));
    assert.equal(failed.baseline, baseline);
    assert.equal(failed.error, 'Feed failed');
    const mismatch = await loadMainAccountCashBaseline(readers({ getCashBaseline: async () => ({ ...baseline, bankAccountId: 8 }) }));
    assert.match(mismatch.error, /does not match/);
    const malformed = await loadMainAccountCashBaseline(readers({ getBankTransactionsByAccount: async () => null }));
    assert.match(malformed.error, /transactions unavailable/);
});

test('only explicit null is no baseline; request failures retain error status', async () => {
    const none = await loadMainAccountCashBaseline(readers({ getCashBaseline: async () => null,
        getBankTransactionsByAccount: async () => { throw new Error('Should not fetch'); } }));
    assert.equal(none.error, null);
    assert.equal(none.baseline, null);
    const failed = await loadMainAccountCashBaseline(readers({ getCashBaseline: async () => { throw new Error('Baseline failed'); } }));
    assert.equal(failed.error, 'Baseline failed');
    const missing = await loadMainAccountCashBaseline(readers({ getCashBaseline: async () => undefined }));
    assert.match(missing.error, /does not match/);
});

test('API contract uses dedicated settlement authorization and only JSON null means no baseline', async () => {
    const source = readFileSync(new URL('../services/apiService.js', import.meta.url), 'utf8');
    const getter = source.slice(source.indexOf('export async function getCashBaseline'), source.indexOf('export async function createBankAccount'));
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction('getSettlementHeaders', 'API_BASE', 'fetch', 'msalInstance', 'scope',
        `${getter.replace('export async function', 'async function').replace('import.meta.env.VITE_SETTLEMENT_API_SCOPE', 'scope')}; return getCashBaseline(7);`);
    const headers = { Authorization: 'Bearer existing-auth-token' };
    const auth = async () => headers;
    for (const payload of [baseline, null]) {
        const result = await run(auth, '/api', async (url, options) => {
            assert.equal(url, '/api/bank/accounts/7/cash-baseline');
            assert.deepEqual(options, { headers });
            return { ok: true, json: async () => payload };
        }, { getAllAccounts: () => [{}] }, 'api://test/Settlement.Write');
        assert.equal(result, payload);
    }
    for (const status of [401, 404, 500]) {
        await assert.rejects(run(auth, '/api', async () => ({ ok: false, status }), { getAllAccounts: () => [{}] }, 'api://test/Settlement.Write'), new RegExp(`cash baseline \\(${status}\\)`));
    }
    await assert.rejects(run(async () => { throw new Error('Auth failed'); }, '/api', async () => {
        assert.fail('Unauthenticated request must not run');
    }, { getAllAccounts: () => [{}] }, 'api://test/Settlement.Write'), /Auth failed/);
});