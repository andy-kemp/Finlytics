import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./directorLoanBik.js', import.meta.url), 'utf8');
const { peakOverdrawnByTaxYear, bikRiskFor } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const loan = (entryDate, amountGross, datePaid = null, director = 'A') => ({ direction: 'OwedToCompany', director, entryDate, amountGross, datePaid });
const owed = (entryDate, amountGross, datePaid = null, director = 'A') => ({ direction: 'OwedToDirector', director, entryDate, amountGross, datePaid });
const risk = (entries) => { const peaks = peakOverdrawnByTaxYear(entries); return entries.map(entry => bikRiskFor(entry, peaks)); };

test('two loans that together exceed £10,000 are flagged', () => {
    assert.deepEqual(risk([loan('2026-05-01', 6000), loan('2026-06-01', 6000)]), [true, true]);
});

test('a loan repaid before the next one is drawn does not combine', () => {
    assert.deepEqual(risk([loan('2026-05-01', 6000, '2026-05-20'), loan('2026-06-01', 6000)]), [false, false]);
});

test('amounts owed to the director reduce the overdrawn balance', () => {
    assert.deepEqual(risk([owed('2026-04-10', 5000), loan('2026-05-01', 12000)]), [false, false]);
});

test('directors and tax years are assessed separately', () => {
    assert.deepEqual(risk([loan('2026-05-01', 6000, null, 'A'), loan('2026-05-01', 6000, null, 'B')]), [false, false]);
    const entries = [loan('2025-05-01', 9000, '2026-03-01'), loan('2026-05-01', 9000)];
    assert.deepEqual(risk(entries), [false, false]);
});

test('a single loan over £10,000 is flagged; exactly £10,000 is not', () => {
    assert.deepEqual(risk([loan('2026-05-01', 10001)]), [true]);
    assert.deepEqual(risk([loan('2026-05-01', 10000)]), [false]);
});
