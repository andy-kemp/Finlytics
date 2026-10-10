import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bankAttention } from './bankAttention.mjs';
import { buildMonthlyProposals, buildMonthlyApplyRequest, selectPaymentForReview } from './monthlyReconciliation.mjs';

const payments = [
    { id: 69, externalId: 'mm_pret', description: 'Pret St James Qtr', amount: 6.20 },
    { id: 70, externalId: 'mm_hotel', description: 'Shnl 101 Limited Ta Ho', amount: 31.95 },
    { id: 71, externalId: 'mm_taxi', description: 'Andrew Cunning', amount: 15 }
].map(payment => ({ ...payment, bankAccountId: 1, direction: 'Out', transactionDate: '2026-10-09', source: 'CSV', isReconciled: false }));

test('dashboard uses saved bank payments without requiring a new sync or CSV import', () => {
    const result = bankAttention(payments, {}, '2026-10-03');
    assert.equal(result.missing.length, 3);
    assert.equal(result.moneyOut, 53.15);
    const recorded = bankAttention(payments, { expenses: [{ id: 60, datePaid: '2026-10-09', amountGross: 6.20 }] }, '2026-10-03');
    assert.equal(recorded.missing.length, 2);
    assert.equal(recorded.moneyOut, 46.95);
});

test('dashboard review action selects only the clicked payment and preserves its existing feed ID', () => {
    const attention = bankAttention(payments, {}, '2026-10-03');
    const proposals = buildMonthlyProposals({ transactions: attention.transactions, comparisons: attention.comparisons,
        existing: payments, baselineDate: '2026-10-03', categories: ['Other'] });
    const original = structuredClone(proposals);
    const selected = selectPaymentForReview(proposals, 70);
    assert.deepEqual(selected.filter(proposal => proposal.selected).map(proposal => proposal.transaction.id), [70]);
    const request = buildMonthlyApplyRequest(1, selected);
    assert.equal(request.actions.length, 1);
    assert.equal(request.actions[0].externalId, 'mm_hotel');
    assert.equal(request.actions[0].action, 'createExpense');
    assert.equal(request.actions[0].vatAmount, 0);
    assert.deepEqual(proposals, original);
});

test('stale, already reconciled and baseline-blocked dashboard actions refuse selection', () => {
    const proposals = buildMonthlyProposals({ transactions: payments, baselineDate: '2026-10-03' });
    assert.throws(() => selectPaymentForReview(proposals, 999), /no longer awaiting review/);
    assert.throws(() => selectPaymentForReview([{ ...proposals[0], kind: 'done', reason: 'Already reconciled' }], 69), /Already reconciled/);
    assert.throws(() => selectPaymentForReview([{ ...proposals[0], kind: 'blocked', reason: 'Historical baseline' }], 69), /Historical baseline/);
});

test('dashboard navigation carries the saved bank ID into Banking review without a new import or write', () => {
    const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
    const dashboard = read('../components/Dashboard.jsx');
    const app = read('../App.jsx');
    const banking = read('../components/Banking.jsx');
    assert.ok(dashboard.includes('bankAttention(cashBaselineState.transactions, cashRecords, cashBaselineState.baseline?.asOfDate)'));
    assert.ok(dashboard.includes("onNavigate('banking', {"));
    assert.ok(dashboard.includes('reviewTransactionId: transaction?.id ?? null'));
    assert.ok(app.includes('reviewTransactionId={viewOptions.reviewTransactionId}'));
    assert.ok(banking.includes('selectPaymentForReview(proposals, bankTransactionId)'));
    assert.ok(banking.includes('handleReviewPayments(null, reviewTransactionId)'));
    const review = banking.slice(banking.indexOf('const handleReviewPayments'), banking.indexOf('const handleSelectAccount'));
    assert.ok(!review.includes('applyMonthlyReconciliation('));
    assert.ok(!review.includes('importBankTransactions('));
});