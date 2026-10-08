import test from 'node:test';
import assert from 'node:assert/strict';
import { amountPennies, settlementStatus, settlementAction, isVatSettled, validSettlementDate, todayDate, settlementCashDelta, eligibleVatAccount, eligibleVatTransaction, overlappingVatReturns, validateVatSettlement, filingDateForEdit } from './vatSettlement.mjs';

const record = { id: 9, vatOwed: -581.15, filedDate: '2025-04-01', quarterStartDate: '2025-01-01', quarterEndDate: '2025-03-31' };
const account = { id: 1, currency: 'GBP', isActive: true, accountName: 'Current' };
const transaction = { id: 42, bankAccountId: 1, direction: 'In', amount: 581.33, transactionDate: '2026-10-07T00:00:00', description: 'HMRC VAT refund', isReconciled: false };
const values = { amount: '581.33', settlementDate: '2026-10-07', bankTransactionId: null, reference: '', differenceReason: 'HMRC adjustment', statementConfirmed: true, confirmed: true, overlapConfirmed: true };
const options = { today: '2026-10-08' };

test('adjacent BST quarters are not overlapping and unchanged filing edits preserve timestamps', () => {
    const previous = { id: 1, quarterStartDate: '2026-03-31T23:00:00Z', quarterEndDate: '2026-06-30T22:59:59.999Z' };
    const next = { id: 2, quarterStartDate: '2026-06-30T23:00:00Z', quarterEndDate: '2026-09-30T22:59:59.999Z' };
    assert.equal(overlappingVatReturns(previous, [next]).length, 0);
    const timestamp = '2026-10-07T14:23:45.123Z';
    assert.equal(filingDateForEdit(timestamp, '2026-10-07'), timestamp);
});

test('filing never confirms cash; sign determines action and zero has no action', () => {
    assert.equal(settlementStatus(record), 'AwaitingRefund');
    assert.equal(settlementStatus({ vatOwed: 100 }), 'AwaitingPayment');
    assert.equal(settlementStatus({ vatOwed: 0 }), 'NoSettlementRequired');
    assert.equal(settlementAction(record), 'Record Refund');
    assert.equal(settlementAction({ vatOwed: 100 }), 'Mark as Paid');
    assert.equal(settlementAction({ vatOwed: 0 }), null);
    for (const settlementStatus of ['Paid', 'RefundReceived']) {
        assert.equal(isVatSettled({ ...record, settlementStatus }), true);
        assert.equal(settlementAction({ ...record, settlementStatus }), null);
    }
});

test('amounts are positive whole pennies and cash uses actual amount with correct sign', () => {
    for (const amount of ['0', '-1', 'NaN', 'Infinity', '1.001', '', '1e3']) assert.equal(amountPennies(amount), null);
    assert.equal(amountPennies('581.33'), 58133);
    assert.equal(settlementCashDelta(record, 581.33), 581.33);
    assert.equal(settlementCashDelta({ vatOwed: 3841.11 }, 3841.11), -3841.11);
    assert.equal(settlementCashDelta({ vatOwed: 0 }, 1), 0);
});

test('actual calendar date requires year 2000 or later and no future date', () => {
    for (const date of ['1999-12-31', '2026-10-09', '2026-02-29', '2026-04-31', '2026-1-01']) assert.equal(validSettlementDate(date, options.today), false);
    assert.equal(validSettlementDate('2000-02-29', options.today), true);
    assert.equal(validSettlementDate(options.today, options.today), true);
    assert.equal(todayDate(new Date(2026, 9, 8)), options.today);
});

test('bank candidates require active GBP, HMRC, correct direction and no internal pots', () => {
    assert.equal(eligibleVatTransaction(transaction, account, record), true);
    for (const patch of [{ direction: 'Out' }, { description: 'Client invoice' }, { isInternalTransfer: true }, { category: 'Internal Transfer' }, { description: 'HMRC VAT Pot transfer' }, { isReconciled: true }, { bankAccountId: 2 }, { id: -1 }]) assert.equal(eligibleVatTransaction({ ...transaction, ...patch }, account, record), false);
    assert.equal(eligibleVatTransaction({ ...transaction, isReconciled: true }, account, { ...record, settlementBankTransactionId: 42 }), true);
    for (const patch of [{ isActive: false }, { currency: 'USD' }, { accountName: 'VAT Pot' }]) assert.equal(eligibleVatAccount({ ...account, ...patch }), false);
    assert.equal(eligibleVatTransaction({ ...transaction, direction: 'Out' }, account, { vatOwed: 1 }), true);
});

test('manual confirmation, difference reason, overlap review and explicit confirmation are required', () => {
    assert.equal(validateVatSettlement(record, values, options), null);
    for (const patch of [{ statementConfirmed: false }, { confirmed: false }, { differenceReason: '' }, { amount: '-581.33' }, { settlementDate: '2026-10-09' }]) assert.ok(validateVatSettlement(record, { ...values, ...patch }, options));
    const overlaps = overlappingVatReturns(record, [record, { ...record, id: 10 }, { ...record, id: 11, quarterStartDate: '2025-04-01' }]);
    assert.equal(overlaps.length, 1);
    assert.ok(validateVatSettlement(record, { ...values, overlapConfirmed: false }, { ...options, overlaps }));
});

test('selected bank must match ID, actual pennies and date exactly', () => {
    const linked = { ...values, bankTransactionId: 42, statementConfirmed: false };
    const context = { ...options, account, transaction };
    assert.equal(validateVatSettlement(record, linked, context), null);
    for (const patch of [{ bankTransactionId: -1 }, { bankTransactionId: 43 }, { amount: '581.32' }, { settlementDate: '2026-10-06' }]) assert.ok(validateVatSettlement(record, { ...linked, ...patch }, context));
});