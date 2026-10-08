import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./vatCalculations.js', import.meta.url), 'utf8');
const { isVatReclaimBlocked, calculateVatForQuarter, getUnfiledVatBalance } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const quarter = { quarterStartDate: '2026-06-01T00:00:00Z', quarterEndDate: '2026-08-31T23:59:59Z' };

test('EUR/USD expense tax is blocked while legacy and GBP eligibility is unchanged', () => {
    assert.equal(isVatReclaimBlocked({ originalCurrency: 'EUR' }), true);
    assert.equal(isVatReclaimBlocked({ originalCurrency: ' usd ' }), true);
    assert.equal(isVatReclaimBlocked({ originalCurrency: 'GBP' }), false);
    assert.equal(isVatReclaimBlocked({}), false);
    assert.equal(isVatReclaimBlocked({ category: 'Client Entertainment' }), true);
});

test('foreign expense and DLA tax excluded from Box 4 without changing original costs', () => {
    const expenses = [
        { originalCurrency: 'EUR', entryDate: '2026-07-01', vatAmount: 20, amountGross: 120 },
        { originalCurrency: 'GBP', entryDate: '2026-07-01', vatAmount: 10, amountGross: 60 }
    ];
    const dlaEntries = [{ originalCurrency: 'USD', direction: 'OwedToDirector', entryDate: '2026-07-01', vatAmount: 15, amountGross: 90 }];
    const result = calculateVatForQuarter(quarter, { invoices: [], expenses, dlaEntries, settings: {}, displayQuarters: [quarter] });
    assert.equal(result.vatOut, 10);
    assert.equal(result.vatExcludedTotal, 35);
    assert.equal(expenses[0].amountGross, 120);
    assert.equal(dlaEntries[0].amountGross, 90);
});

test('next-return correction remains a Box 4 adjustment and never a second cash refund', () => {
    const record = { ...quarter, vatOwed: 3841.11, filedDate: '2026-09-02' };
    const before = JSON.stringify(record);
    const result = calculateVatForQuarter(quarter, { invoices: [], expenses: [], dlaEntries: [], settings: {}, displayQuarters: [quarter], adjustment: { box4: 64.19 } });
    assert.equal(result.vatOut, 64.19);
    assert.equal(getUnfiledVatBalance({ quarters: [quarter], invoices: [], expenses: [], dlaEntries: [], settings: {}, filedReturns: [record] }), 0);
    assert.equal(JSON.stringify(record), before);
});

test('eligible UK director-funded claims retain VAT relief while foreign claims do not', () => {
    const dlaEntries = [
        { direction: 'OwedToDirector', originalCurrency: 'GBP', entryDate: '2026-07-01', vatAmount: 20, amountGross: 120 },
        { direction: 'OwedToDirector', entryDate: '2026-07-01', vatAmount: 5, amountGross: 30 },
        { direction: 'OwedToDirector', originalCurrency: 'EUR', entryDate: '2026-07-01', vatAmount: 10, amountGross: 60 },
        { direction: 'OwedToCompany', originalCurrency: 'GBP', entryDate: '2026-07-01', vatAmount: 50, amountGross: 300 }
    ];
    const result = calculateVatForQuarter(quarter, { invoices: [], expenses: [], dlaEntries, settings: {}, displayQuarters: [quarter] });
    assert.equal(result.vatOutDla, 25);
    assert.equal(result.vatOut, 25);
    assert.equal(dlaEntries[0].amountGross, 120);
});