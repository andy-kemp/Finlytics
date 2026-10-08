import assert from 'node:assert/strict';
import test from 'node:test';
import { compareBankToApp } from './bankReconciliation.mjs';

const receipt = { amount: 1200, direction: 'In', transactionDate: '2026-10-01', reference: 'INV-001' };
const invoice = { id: 1, status: 'Paid', amountGross: 1200, datePaid: '2026-10-01', invoiceNumber: 'INV-001' };

test('paid invoice is suggested but wrong amounts, directions and unpaid entries are not', () => {
    const records = { invoices: [invoice, { ...invoice, id: 2, status: 'Issued' }] };
    assert.equal(compareBankToApp([receipt], records).comparisons[0].status, 'Suggested match');
    assert.equal(compareBankToApp([{ ...receipt, amount: 1199 }], records).comparisons[0].status, 'Missing app payment');
    assert.equal(compareBankToApp([{ ...receipt, direction: 'Out' }], records).comparisons[0].status, 'Missing app payment');
});

test('one app payment cannot silently cover multiple bank rows', () => {
    const result = compareBankToApp([receipt, receipt], { invoices: [invoice] });
    assert.ok(result.comparisons.every(comparison => comparison.status === 'Shared app payment - review'));
});

test('internal pot transfers are never suggested as expenses', () => {
    const result = compareBankToApp([{ ...receipt, direction: 'Out', category: 'Internal Transfer' }], {
        expenses: [{ id: 1, amountGross: 1200, datePaid: '2026-10-01' }]
    });
    assert.equal(result.comparisons[0].candidates.length, 0);
    assert.equal(result.unmatchedPayments.length, 1);
});

test('VAT and dividends match recorded ledger cash and unrepresented payments are listed', () => {
    const result = compareBankToApp([{ ...receipt, direction: 'Out' }], { ledgerEntries: [
        { id: 1, entryType: 'VAT_Paid', amount: 1200, effectiveDate: '2026-10-01' },
        { id: 2, entryType: 'Dividend_Paid', amount: 100, effectiveDate: '2026-10-01' }
    ] });
    assert.equal(result.comparisons[0].candidates[0].key, 'CompanyLedger:1');
    assert.equal(result.unmatchedPayments[0].key, 'CompanyLedger:2');
});

test('DLA repayment receipts follow loan direction and linked ledger entries are ignored', () => {
    const result = compareBankToApp([receipt], {
        dlaEntries: [{ id: 1, dlaId: 'loan', direction: 'OwedToCompany', amountGross: 1300, entryDate: '2026-09-01' }],
        dlaPayments: [{ id: 2, dlaId: 'loan', amount: 1200, paymentDate: '2026-10-01' }],
        ledgerEntries: [{ id: 3, dlaReference: 'loan', entryType: 'DLA_Out', amount: 1200, effectiveDate: '2026-10-01' }]
    });
    assert.equal(result.comparisons[0].candidates.length, 1);
    assert.equal(result.comparisons[0].candidates[0].key, 'DLA-Payment:2');
});

test('startup liability ledger entries never become suggested bank-payment matches', () => {
    const result = compareBankToApp([{ ...receipt, direction: 'Out' }], {
        ledgerEntries: [{ id: 1, entryType: 'DLA_Out', title: 'DLA Startup: personal costs', amount: 1200, effectiveDate: '2026-10-01' }]
    });
    assert.equal(result.comparisons[0].status, 'Missing app payment');
    assert.equal(result.unmatchedPayments.length, 0);
});