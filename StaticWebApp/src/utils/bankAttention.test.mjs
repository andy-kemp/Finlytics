import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bankAttention } from './bankAttention.mjs';
import { buildMonthlyProposals, buildMonthlyApplyRequest } from './monthlyReconciliation.mjs';

const payments = [
    { id: 69, externalId: 'mm_pret', description: 'Pret', amount: 6.20 },
    { id: 70, externalId: 'mm_hotel', description: 'Hotel Indigo', amount: 31.95 },
    { id: 71, externalId: 'mm_taxi', description: 'Taxi', amount: 15 }
].map(transaction => ({ ...transaction, direction: 'Out', transactionDate: '2026-10-09', isReconciled: false }));

test('Banking balance diagnostics load the full ledger just like Dashboard', () => {
    const banking = readFileSync(new URL('../components/Banking.jsx', import.meta.url), 'utf8');
    const loader = banking.slice(banking.indexOf('async function loadTransactions'), banking.indexOf('const handleReviewPayments'));
    assert.ok(loader.includes("getCompanyLedger('all')"));
    assert.ok(!loader.includes('getCompanyLedger()'));
    assert.ok(loader.includes('mainAccountBookBreakdown(calculateRecordedTradingCash(records), baseline, data)'));
});

test('existing CSV payments remain outstanding even when sync imports zero new rows', () => {
    const result = bankAttention(payments, {}, '2026-10-03');
    assert.equal(result.missing.length, 3);
    assert.equal(result.moneyOut, 53.15);
    assert.equal(result.moneyIn, 0);
    const linked = bankAttention(payments.map(transaction => ({ ...transaction, monzoTransactionId: `tx_${transaction.id}` })), {}, '2026-10-03');
    assert.deepEqual(linked.missing.map(transaction => transaction.id), [69, 70, 71]);
    assert.equal(linked.moneyOut, 53.15);
});

test('recorded DLA batch repayment is not an unclaimed expense', () => {
    const bank = { id: 200, externalId: 'tx_dla_batch', transactionDate: '2026-10-11', direction: 'Out', amount: 163.96,
        description: 'DLA-202610-003', source: 'Monzo', isReconciled: false };
    const records = {
        dlaEntries: [{ dlaId: 'DLA-A', direction: 'OwedToDirector' }, { dlaId: 'DLA-B', direction: 'OwedToDirector' }],
        dlaPayments: [{ id: 301, dlaId: 'DLA-A', amount: 100, paymentDate: '2026-10-11', paymentReference: 'DLA-202610-003 (BATCH-20261011-090000)' },
            { id: 302, dlaId: 'DLA-B', amount: 63.96, paymentDate: '2026-10-11', paymentReference: 'DLA-202610-003 (BATCH-20261011-090000)' }]
    };
    const result = bankAttention([bank], records, '2026-10-03');
    assert.equal(result.missing.length, 0);
    assert.equal(result.moneyOut, 0);
    assert.equal(result.comparisons[0].status, 'Recorded DLA payment');
    const proposals = buildMonthlyProposals({ transactions: [bank], comparisons: result.comparisons, baselineDate: '2026-10-03' });
    assert.equal(proposals[0].kind, 'done');
    assert.equal(proposals[0].selected, false);
    assert.deepEqual(buildMonthlyApplyRequest(1, proposals).actions, []);
    const incomplete = { ...records, dlaPayments: [...records.dlaPayments, {
        id: 303, dlaId: 'missing-loan', amount: 10, paymentDate: '2026-10-11', paymentReference: 'DLA-202610-003 (BATCH-20261011-090000)'
    }] };
    assert.notEqual(bankAttention([bank], incomplete, '2026-10-03').comparisons[0].status, 'Recorded DLA payment');
    for (const change of [{ amount: 164 }, { direction: 'In' }, { transactionDate: '2026-10-12' },
        { description: 'DLA-202610-0034' }]) {
        assert.notEqual(bankAttention([{ ...bank, ...change }], records, '2026-10-03').comparisons[0].status, 'Recorded DLA payment');
    }
    const duplicate = bankAttention([bank, { ...bank, id: 201 }], records, '2026-10-03');
    assert.ok(duplicate.comparisons.every(comparison => comparison.status === 'Shared app payment - review'));
    const typoBank = { ...bank, amount: 167.84, description: 'DLA-20261-004' };
    const typoResult = bankAttention([typoBank], records, '2026-10-03');
    assert.equal(typoResult.comparisons[0].status, 'DLA reference needs review');
    assert.equal(typoResult.moneyOut, 0);
    assert.equal(typoResult.missing.length, 0);
    const typoProposals = buildMonthlyProposals({ transactions: [typoBank], comparisons: typoResult.comparisons, baselineDate: '2026-10-03' });
    assert.equal(typoProposals[0].kind, 'review');
    assert.deepEqual(buildMonthlyApplyRequest(1, typoProposals).actions, []);
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

test('six CSV/API rows for three card payments block reliable totals without hiding or deleting rows', () => {
    const rows = payments.flatMap(payment => [
        { ...payment, source: 'CSV', bankAccountId: 1 },
        { ...payment, id: payment.id + 100, source: 'Monzo', bankAccountId: 1, externalId: `tx_${payment.id}` }
    ]);
    const result = bankAttention(rows, {}, '2026-10-03');
    assert.equal(result.possibleDuplicatePayments.length, 3);
    assert.equal(result.possibleDuplicatePots.length, 0);
    assert.equal(result.moneyOut, null);
    assert.equal(result.moneyIn, null);
    assert.equal(result.missing.length, 6);
    assert.equal(rows.length, 6);
    const reconciled = bankAttention(rows.map(row => ({ ...row, isReconciled: row.source === 'CSV' })), {}, '2026-10-03');
    assert.equal(reconciled.possibleDuplicatePayments.length, 3);
});