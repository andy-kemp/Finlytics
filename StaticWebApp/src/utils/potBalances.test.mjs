import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAvailableAfterTax, calculateBookCashWithPots } from './potBalances.mjs';

const snapshot = { vatPotBalance: 650, ctPotBalance: 1071.82, asOfDate: '2026-10-08' };

test('available after tax includes pot surpluses without duplicating pot withdrawals', () => {
    assert.deepEqual(calculateAvailableAfterTax(calculateBookCashWithPots(996.86, snapshot), snapshot, 508.14, 958.53),
        { available: 1252.01, vatSurplus: 141.86, ctSurplus: 113.29 });
    const cleaned = { vatPotBalance: 508.14, ctPotBalance: 958.53, asOfDate: '2026-10-09' };
    assert.equal(calculateAvailableAfterTax(calculateBookCashWithPots(1252.18, cleaned), cleaned, 508.14, 958.53).available, 1252.18);
    assert.equal(calculateAvailableAfterTax(null, cleaned, 508.14, 958.53), null);
});

test('pot shortfalls reduce available cash and VAT refunds are not counted before receipt', () => {
    assert.equal(calculateAvailableAfterTax(calculateBookCashWithPots(100, snapshot), snapshot, 700, 1100).available, 21.82);
    assert.equal(calculateAvailableAfterTax(calculateBookCashWithPots(100, snapshot), snapshot, -100, 0).available, 1821.82);
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