import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAvailableAfterTax, calculateBookCashWithPots } from './potBalances.mjs';

const snapshot = { vatPotBalance: 650, ctPotBalance: 1071.82, asOfDate: '2026-10-08' };

test('pot surpluses over estimated VAT and CT liabilities are available cash', () => {
    const result = calculateAvailableAfterTax(calculateBookCashWithPots(996.86, snapshot), snapshot, 508.14, 958.53);
    assert.deepEqual(result, { available: 1252.01, vatSurplus: 141.86, ctSurplus: 113.29 });
});

test('pot shortfalls reduce available cash and VAT reclaims are not counted', () => {
    const result = calculateAvailableAfterTax(calculateBookCashWithPots(996.86, snapshot), snapshot, -200, 1200);
    assert.deepEqual(result, { available: 1518.68, vatSurplus: 650, ctSurplus: -128.18 });
    assert.equal(calculateAvailableAfterTax(null, snapshot, 0, 0), null);
    assert.equal(calculateAvailableAfterTax({ overall: null, excludingPots: 1 }, snapshot, 0, 0), null);
});

test('overall book cash includes actual pots; excluding pots is main-account book cash', () => {
    const result = calculateBookCashWithPots(1029.15, snapshot);
    assert.equal(result.overall, 2750.97);
    assert.equal(result.excludingPots, 1029.15);
    assert.equal(result.pots, 1721.82);
});

test('filing pending expenses reduces both book balances once without changing pots', () => {
    assert.equal(calculateBookCashWithPots(996.86, snapshot).overall, 2718.68);
    assert.equal(snapshot.vatPotBalance, 650);
});

test('missing actual pots are not replaced by estimated tax reserves or zero', () => {
    assert.equal(calculateBookCashWithPots(1029.15, null), null);
    assert.throws(() => calculateBookCashWithPots(1029.15, { ...snapshot, vatPotBalance: null }));
    assert.throws(() => calculateBookCashWithPots(1029.15, { ...snapshot, ctPotBalance: -1 }));
});

test('pot snapshot is retained as dated; interest already in it is not added again', () => {
    assert.equal(calculateBookCashWithPots(1029.15, snapshot).asOfDate, '2026-10-08');
    assert.equal(calculateBookCashWithPots(1029.15, { ...snapshot, interest: 1.48 }).overall, 2750.97);
});

test('later internal transfer cannot falsely reduce overall company cash against stale pots', () => {
    const result = calculateBookCashWithPots(829.15, { ...snapshot, bankAccountId: 1 }, [
        { bankAccountId: 1, category: 'Internal Transfer', amount: 200, direction: 'Out', transactionDate: '2026-10-09' }
    ]);
    assert.equal(result.stale, true);
    assert.equal(result.overall, null);
    assert.equal(result.excludingPots, 829.15);
});