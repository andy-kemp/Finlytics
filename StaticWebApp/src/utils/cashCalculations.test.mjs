import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRecordedTradingCash } from './cashCalculations.mjs';

test('cash balance carries earlier paid receipts forward instead of using quarter income', () => {
    const result = calculateRecordedTradingCash({
        invoices: [
            { status: 'Paid', dateIssued: '2026-09-01', amountGross: 4800 },
            { status: 'Issued', amountGross: 1200 }
        ],
        expenses: [{ datePaid: '2026-10-01', amountGross: 180.32 }],
        dlaPayments: [{ paymentDate: '2026-10-02', amount: 1379 }]
    });
    assert.equal(result.balance, 3240.68);
    assert.equal(result.income, 4800);
});

test('unpaid expenses and director-funded expenses are not company bank payments', () => {
    const result = calculateRecordedTradingCash({
        expenses: [
            { entryDate: '2026-10-01', amountGross: 500 },
            { isDLA: true, datePaid: '2026-10-01', amountGross: 200 },
            { datePaid: '2026-10-01', amountGross: 100 }
        ],
        dlaPayments: [{ paymentDate: '2026-10-02', amount: 50 }]
    });
    assert.equal(result.balance, -150);
});

test('empty records give zero and numeric strings are summed as amounts', () => {
    assert.equal(calculateRecordedTradingCash({}).balance, 0);
    assert.equal(calculateRecordedTradingCash({
        invoices: [{ status: 'Paid', datePaid: '2026-10-01', amountGross: '950.25' }],
        expenses: [{ datePaid: '2026-10-01', amountGross: '20.25' }]
    }).balance, 930);
});

test('ledger cash includes older payments and VAT but not unpaid reserves or declarations', () => {
    const result = calculateRecordedTradingCash({
        invoices: [{ status: 'Paid', datePaid: '2026-09-01', amountGross: 4800 }],
        ledgerEntries: [
            { entryType: 'Dividend_Paid', effectiveDate: '2025-12-01', amount: 2121.45 },
            { entryType: 'VAT_Paid', effectiveDate: '2026-09-01', amount: 200 },
            { entryType: 'VAT_Reclaim', effectiveDate: '2026-09-02', amount: 100 },
            { entryType: 'CorpTax_Reserve', effectiveDate: '2026-09-01', amount: 1000 },
            { entryType: 'Dividend_Declared', effectiveDate: '2026-09-01', amount: 500 }
        ]
    });
    assert.equal(result.balance, 2578.55);
});

test('period cashflow uses payment dates while cumulative cash retains earlier receipts', () => {
    const records = {
        invoices: [{ status: 'Paid', dateIssued: '2026-09-01', datePaid: '2026-10-01', amountGross: 1200 }],
        ledgerEntries: [{ entryType: 'Dividend_Paid', effectiveDate: '2026-09-15', amount: 200 }],
        endDate: new Date('2026-10-08T23:59:59Z')
    };
    assert.equal(calculateRecordedTradingCash(records).balance, 1000);
    assert.equal(calculateRecordedTradingCash({ ...records, startDate: new Date('2026-10-01') }).balance, 1200);
});

test('DLA loans and repayments follow direction and linked ledger entries are not counted twice', () => {
    const result = calculateRecordedTradingCash({
        dlaEntries: [
            { dlaId: 'loan', direction: 'OwedToCompany', entryDate: '2026-09-01', amountGross: 500 },
            { dlaId: 'expense', direction: 'OwedToDirector', entryDate: '2026-09-01', amountGross: 200 }
        ],
        dlaPayments: [
            { dlaId: 'loan', paymentDate: '2026-10-01', amount: 300 },
            { dlaId: 'expense', paymentDate: '2026-10-01', amount: 100 }
        ],
        ledgerEntries: [
            { entryType: 'DLA_Out', dlaReference: 'loan', effectiveDate: '2026-09-01', amount: 500 },
            { entryType: 'DLA_Out', dlaReference: 'loan', effectiveDate: '2026-10-01', amount: 300 },
            { entryType: 'DLA_In', dlaReference: 'expense', effectiveDate: '2026-10-01', amount: 100 }
        ]
    });
    assert.equal(result.cashIn, 300);
    assert.equal(result.cashOut, 600);
    assert.equal(result.balance, -300);
});

test('future payments do not affect current cash', () => {
    assert.equal(calculateRecordedTradingCash({
        invoices: [{ status: 'Paid', datePaid: '2027-01-01', amountGross: 1000 }],
        endDate: new Date('2026-10-08')
    }).balance, 0);
});