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

test('director-funded startup liabilities without DlaReference are not bank outflows', () => {
    const result = calculateRecordedTradingCash({
        dlaEntries: [{ dlaId: 'DLA-2026-0001', direction: 'OwedToDirector', entryDate: '2026-03-01', amountGross: 25000 }],
        ledgerEntries: [{ entryType: 'DLA_Out', title: 'DLA Startup: director-funded costs', notes: 'DLA ID: DLA-2026-0001. CT Tag: Revenue', amount: 25000, effectiveDate: '2026-03-01' }]
    });
    assert.equal(result.cashOut, 0);
    assert.equal(result.balance, 0);
});

test('legacy linked ledger notes do not count a recorded DLA repayment twice', () => {
    const result = calculateRecordedTradingCash({
        dlaEntries: [{ dlaId: 'DLA-2026-0001', direction: 'OwedToDirector', entryDate: '2026-03-01', amountGross: 100 }],
        dlaPayments: [{ dlaId: 'DLA-2026-0001', paymentDate: '2026-04-01', amount: 100 }],
        ledgerEntries: [{ entryType: 'DLA_Payment', notes: 'Payment for DLA DLA-2026-0001. Remaining balance: 0', amount: 100, effectiveDate: '2026-04-01' }]
    });
    assert.equal(result.cashOut, 100);
});

test('explicit DLA references are case-insensitive and unlinked manual cash remains included', () => {
    const result = calculateRecordedTradingCash({
        dlaEntries: [{ dlaId: 'DLA-2026-0001', direction: 'OwedToDirector', amountGross: 100 }],
        ledgerEntries: [
            { entryType: 'DLA_Out', dlaReference: ' dla-2026-0001 ', amount: 100, effectiveDate: '2026-04-01' },
            { entryType: 'DLA_In', amount: 50, effectiveDate: '2026-04-01' }
        ]
    });
    assert.equal(result.cashOut, 0);
    assert.equal(result.cashIn, 50);
});

test('excess payment records are flagged rather than silently dropped from cash', () => {
    const result = calculateRecordedTradingCash({
        dlaEntries: [{ dlaId: 'DLA-2026-0001', direction: 'OwedToDirector', amountGross: 106.8, amountPaid: 106.8 }],
        dlaPayments: [
            { id: 1, dlaId: 'DLA-2026-0001', amount: 4000, paymentDate: '2026-02-10' },
            { id: 2, dlaId: 'DLA-2026-0001', amount: 3000, paymentDate: '2026-02-10' },
            { id: 3, dlaId: 'DLA-2026-0001', amount: 106.8, paymentDate: '2026-04-21' }
        ]
    });
    assert.equal(result.paymentWarnings[0].excess, 7000);
    assert.equal(result.cashOut, 7106.8);
    assert.deepEqual(result.paymentWarnings[0].paymentIds, [1, 2, 3]);
});

test('legacy DLA ID liability notes are excluded and remaining manual DLA cash is auditable', () => {
    const result = calculateRecordedTradingCash({
        dlaEntries: [{ dlaId: 'DLA-2023-0006', direction: 'OwedToDirector', amountGross: 44 }],
        ledgerEntries: [
            { id: 1, entryType: 'DLA_Out', title: 'DLA: personal purchase', notes: 'DLA ID: DLA-2023-0006. Invoice', amount: 44, effectiveDate: '2023-01-04' },
            { id: 2, entryType: 'DLA_Out', title: 'Manual cash', amount: 89.97, effectiveDate: '2025-05-14' }
        ]
    });
    assert.equal(result.excludedDlaLedgerTotal, 44);
    assert.equal(result.unlinkedDlaLedger.length, 1);
    assert.equal(result.breakdown.ledgerCashOut, 89.97);
    assert.equal(result.balance, -89.97);
});