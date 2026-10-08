import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInvoiceCurrency, estimateGbp, buildSettlementProposal, fetchDailyGbpRate } from './foreignCurrency.mjs';

test('GBP defaults and explicit invoice currency overrides supplier without guessing dollar symbols', () => {
    assert.equal(resolveInvoiceCurrency(), 'GBP');
    assert.equal(resolveInvoiceCurrency('EUR', 'USD'), 'EUR');
    assert.equal(resolveInvoiceCurrency('$'), 'GBP');
    assert.equal(resolveInvoiceCurrency(null, 'USD'), 'USD');
});

test('foreign amounts convert to GBP using GBP per original unit with penny rounding', () => {
    assert.equal(estimateGbp(100, 0.75), 75);
    assert.equal(estimateGbp(92.4, 80.25 / 92.4), 80.25);
    assert.throws(() => estimateGbp(100, 0));
});

test('bank amount creates a confirmation proposal without mutating expense estimates', () => {
    const expense = { originalCurrency: 'EUR', originalAmountGross: 92.4, estimatedGbpGross: 82 };
    const proposal = buildSettlementProposal(expense, { amount: 80.25, direction: 'Out', originalCurrency: 'EUR', originalAmount: -92.4, transactionDate: '2026-04-25', id: 4 });
    assert.equal(proposal.actualGbp, 80.25);
    assert.equal(proposal.variance, -1.75);
    assert.equal(proposal.requiresConfirmation, true);
    assert.equal(expense.estimatedGbpGross, 82);
    assert.equal(buildSettlementProposal(expense, { amount: 80.25, direction: 'Out', originalCurrency: 'USD' }), null);
});

test('daily rate preserves published date including previous business day', async () => {
    const result = await fetchDailyGbpRate('EUR', '2026-04-25', async () => ({ ok: true, json: async () => ({ date: '2026-04-24', rates: { GBP: 0.87 } }) }));
    assert.equal(result.date, '2026-04-24');
    assert.equal(result.rate, 0.87);
    await assert.rejects(() => fetchDailyGbpRate('USD', '2026-04-25', async () => ({ ok: false })));
});