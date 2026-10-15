import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./s455.js', import.meta.url), 'utf8');
const { calculateS455, s455RateFor } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const pennies = (value) => Math.round(value * 100) / 100;
const loan = (director, entryDate, remainingBalance) => ({ direction: 'OwedToCompany', director, entryDate, remainingBalance });
const credit = (director, entryDate, remainingBalance) => ({ direction: 'OwedToDirector', director, entryDate, remainingBalance });

test('rate is 33.75% before 6 April 2026 and 35.75% from then', () => {
    assert.equal(s455RateFor('2026-04-05'), 0.3375);
    assert.equal(s455RateFor('2026-04-06'), 0.3575);
});

test('director in overall credit pays no s455', () => {
    const result = calculateS455([loan('A', '2025-06-01', 3000), credit('A', '2025-05-01', 13000)]);
    assert.equal(result.base, 0);
    assert.equal(result.charge, 0);
});

test('credit offsets oldest loans first, leaving later loans at the higher rate', () => {
    const result = calculateS455([
        loan('A', '2025-06-01', 25000),
        loan('A', '2026-05-01', 15000),
        credit('A', '2025-01-01', 10000)
    ]);
    assert.equal(result.base, 30000);
    assert.equal(pennies(result.charge), pennies(15000 * 0.3375 + 15000 * 0.3575));
});

test('directors are netted separately', () => {
    const result = calculateS455([loan('A', '2025-06-01', 1000), credit('B', '2025-06-01', 5000)]);
    assert.equal(result.base, 1000);
    assert.equal(pennies(result.charge), 337.5);
    assert.equal(result.byDirector.length, 2);
});

test('entries after the as-at date and settled entries are ignored', () => {
    const result = calculateS455([loan('A', '2026-06-01', 1000), loan('A', '2025-06-01', 0)], '2026-03-31');
    assert.equal(result.base, 0);
});
