import assert from 'node:assert/strict';
import test from 'node:test';
import { bankAttention } from './bankAttention.mjs';

const payments = [
    { id: 69, externalId: 'mm_pret', description: 'Pret', amount: 6.20 },
    { id: 70, externalId: 'mm_hotel', description: 'Hotel Indigo', amount: 31.95 },
    { id: 71, externalId: 'mm_taxi', description: 'Taxi', amount: 15 }
].map(transaction => ({ ...transaction, direction: 'Out', transactionDate: '2026-10-09', isReconciled: false }));

test('existing CSV payments remain outstanding even when sync imports zero new rows', () => {
    const result = bankAttention(payments, {}, '2026-10-03');
    assert.equal(result.missing.length, 3);
    assert.equal(result.moneyOut, 53.15);
    assert.equal(result.moneyIn, 0);
    const linked = bankAttention(payments.map(transaction => ({ ...transaction, monzoTransactionId: `tx_${transaction.id}` })), {}, '2026-10-03');
    assert.deepEqual(linked.missing.map(transaction => transaction.id), [69, 70, 71]);
    assert.equal(linked.moneyOut, 53.15);
});

test('baseline history, pot transfers and reconciled payments are excluded', () => {
    const result = bankAttention([
        ...payments,
        { ...payments[0], transactionDate: '2026-10-03' },
        { ...payments[0], category: 'Internal Transfer' },
        { ...payments[0], description: 'VAT Pot - Pot transfer' },
        { ...payments[0], isReconciled: true }
    ], {}, '2026-10-03');
    assert.equal(result.missing.length, 3);
    assert.throws(() => bankAttention(payments, {}, null), /baseline required/);
});

test('possible duplicate CSV/API pot withdrawals are flagged without changing accounting balances', () => {
    const rows = [142.03, 113.29].flatMap((amount, index) => ['CSV', 'Monzo'].map(source => ({
        id: `${source}-${index}`, source, amount, bankAccountId: 1, category: 'Internal Transfer',
        direction: 'In', transactionDate: '2026-10-09', description: 'Tax Pot - Pot transfer'
    })));
    const result = bankAttention(rows, {}, '2026-10-03');
    assert.equal(result.missing.length, 0);
    assert.equal(result.possibleDuplicatePots.length, 2);
    assert.equal(result.moneyIn, 0);
    assert.equal(bankAttention(rows.filter(row => row.source === 'CSV'), {}, '2026-10-03').possibleDuplicatePots.length, 0);
    assert.equal(rows.length, 4);
});

test('recorded expenses become review matches, not missing expenses; money in is separate', () => {
    const result = bankAttention([...payments, { ...payments[0], id: 72, amount: 100, direction: 'In' }], {
        expenses: [{ id: 60, amountGross: 6.20, datePaid: '2026-10-09', supplier: 'Pret' }]
    }, '2026-10-03');
    assert.equal(result.missing.length, 3);
    assert.equal(result.moneyOut, 46.95);
    assert.equal(result.moneyIn, 100);
    assert.equal(result.comparisons[0].status, 'Suggested match');
});