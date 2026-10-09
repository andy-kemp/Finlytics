import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyProposals, buildMonthlyApplyRequest, scoreReceipt, suggestedVat } from './monthlyReconciliation.mjs';

const tx = (externalId, amount, date, extra = {}) => ({
    externalId, amount, direction: 'Out', transactionDate: `${date}T12:00:00`, description: `${extra.monzoMerchantName || 'Shop'} - Card payment`,
    category: 'Meals', ...extra
});
const categories = ['Equipment', 'Software', 'Travel', 'Subsistence', 'Other'];

test('card debit pairs with an inbox receipt by amount, date and merchant', () => {
    const transactions = [tx('mm_a', 12.30, '2026-10-12', { monzoMerchantName: "Kitty's Edinburgh" })];
    const inbox = [
        { name: 'r1', vendor: 'Kittys Edinburgh Ltd', documentDate: '2026-10-11', total: 12.30, tax: 2.05, currency: 'GBP' },
        { name: 'r2', vendor: 'Other', documentDate: '2026-10-12', total: 12.31, currency: 'GBP' }
    ];
    const [proposal] = buildMonthlyProposals({ transactions, comparisons: [{ status: 'Missing app payment', candidates: [] }], inbox, categories });
    assert.equal(proposal.kind, 'expense');
    assert.equal(proposal.receipt.name, 'r1');
    assert.equal(proposal.supplier, 'Kittys Edinburgh Ltd');
    assert.equal(proposal.category, 'Subsistence');
    assert.equal(proposal.vatAmount, 2.05);
    assert.equal(proposal.selected, true);
});

test('foreign card debit matches receipt in original currency and claims no VAT', () => {
    const debit = tx('mm_b', 75, '2026-10-22', { monzoMerchantName: 'GitHub', originalCurrency: 'USD', originalAmount: -100.23, category: 'Bills' });
    const receipt = { name: 'gh', vendor: 'GitHub, Inc.', documentDate: '2026-10-22', total: 100.23, tax: 0, currency: 'USD' };
    assert.ok(scoreReceipt(debit, receipt) > 0);
    assert.equal(scoreReceipt(debit, { ...receipt, currency: 'GBP', total: 75 }), 0);
    const [proposal] = buildMonthlyProposals({ transactions: [debit], inbox: [receipt], categories });
    assert.equal(proposal.receipt.name, 'gh');
    assert.equal(proposal.category, 'Software');
    assert.equal(suggestedVat(debit, { ...receipt, tax: 10 }), 0);
});

test('receipts are used once and far-dated or anonymous receipts are not paired', () => {
    const transactions = [tx('mm_1', 20, '2026-10-01', { monzoMerchantName: 'Pret' }), tx('mm_2', 20, '2026-10-02', { monzoMerchantName: 'Pret' })];
    const inbox = [{ name: 'only', vendor: 'Pret A Manger', documentDate: '2026-10-02', total: 20, currency: 'GBP' }];
    const proposals = buildMonthlyProposals({ transactions, inbox, categories });
    assert.deepEqual(proposals.map(proposal => proposal.receipt?.name ?? null), [null, 'only']);
    assert.equal(scoreReceipt(transactions[0], { ...inbox[0], documentDate: '2026-09-01' }), 0);
    assert.equal(scoreReceipt(transactions[0], { name: 'x', total: 20, currency: 'GBP' }), 0);
});

test('VAT above one sixth of the payment is not suggested', () => {
    assert.equal(suggestedVat(tx('a', 12, '2026-10-01'), { tax: 2.01, currency: 'GBP' }), 0);
    assert.equal(suggestedVat(tx('a', 12, '2026-10-01'), { tax: 2, currency: 'GBP' }), 2);
});

test('statement rows are classified for review', () => {
    const transactions = [
        tx('pot', 650, '2026-10-30', { category: 'Internal Transfer' }),
        tx('inv', 3900, '2026-10-30', { direction: 'In', category: 'Income' }),
        tx('dla', 512.15, '2026-10-06', { category: 'Transfer - Review' }),
        tx('old', 19.99, '2026-10-03'),
        tx('done', 5, '2026-10-20'),
        tx(null, 5, '2026-10-20'),
        tx('multi', 10, '2026-10-20')
    ];
    const comparisons = [
        { status: 'Internal pot transfer', candidates: [] },
        { status: 'Suggested match', candidates: [{ type: 'Invoice', id: 4, label: 'Invoice INV-1' }] },
        { status: 'Missing app payment', candidates: [] },
        { status: 'Missing app payment', candidates: [] },
        { status: 'Missing app payment', candidates: [] },
        { status: 'Missing app payment', candidates: [] },
        { status: 'Multiple matches - review', candidates: [{ type: 'Expense', id: 1 }, { type: 'Expense', id: 2 }] }
    ];
    const kinds = buildMonthlyProposals({ transactions, comparisons, existing: [{ externalId: 'done', isReconciled: true }], baselineDate: '2026-10-03', categories })
        .map(proposal => proposal.kind);
    assert.deepEqual(kinds, ['internal', 'link', 'review', 'blocked', 'done', 'review', 'review']);
});

test('apply request carries only selected actionable rows in the backend contract', () => {
    const proposals = [
        { kind: 'link', selected: true, externalId: 'a', relatedType: 'Invoice', relatedId: '4' },
        { kind: 'expense', selected: true, externalId: 'b', supplier: ' Pret ', category: 'Subsistence', ctTag: 'Revenue', vatAmount: '1.5', receipt: { name: '2026-10/r.pdf' } },
        { kind: 'expense', selected: false, externalId: 'c', supplier: 'X', category: 'Other', ctTag: 'Revenue', vatAmount: 0 },
        { kind: 'review', selected: true, externalId: 'd' }
    ];
    assert.deepEqual(buildMonthlyApplyRequest(1, proposals), {
        bankAccountId: 1,
        actions: [
            { externalId: 'a', action: 'link', relatedType: 'Invoice', relatedId: '4' },
            { externalId: 'b', action: 'createExpense', supplier: 'Pret', category: 'Subsistence', ctTag: 'Revenue', vatAmount: 1.5, receiptBlob: '2026-10/r.pdf' }
        ]
    });
});
