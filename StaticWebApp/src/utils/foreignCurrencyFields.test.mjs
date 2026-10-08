import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: new URL('../../', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
after(() => server.close());
const { default: ForeignCurrencyFields } = await server.ssrLoadModule('/src/components/ForeignCurrencyFields.jsx');
const value = { originalCurrency: 'EUR', originalAmountNet: '100', originalVatAmount: '20', originalAmountGross: '120', exchangeRateToGbp: '0.85', exchangeRateDate: '2026-10-07', exchangeRateSource: 'Verified', amountNet: '102', vatAmount: '0', amountGross: '102', actualGbpPaid: '103', settlementDate: '2026-10-08' };
const render = props => renderToStaticMarkup(React.createElement(ForeignCurrencyFields, { value, onChange: () => {}, invoiceDate: '2026-10-07', paymentDate: '2026-10-08', ...props }));
const input = (html, label) => html.match(new RegExp(`<span>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>(<input[^>]*>)`))?.[1];

test('confirmed original gross, currency and settlement fields are locked while metadata remains editable', () => {
    const html = render({ confirmed: true, preserveAccounting: true });
    assert.match(html, /<select[^>]*disabled=""/);
    for (const label of ['Original gross (EUR)', 'Actual GBP paid', 'Settlement date']) assert.match(input(html, label), /disabled=""/);
    for (const label of ['Original net (EUR)', 'GBP per 1 EUR', 'Rate source']) assert.doesNotMatch(input(html, label), /disabled/);
});
test('OCR busy state locks all shared inputs, selects and commands', () => {
    const html = render({ disabled: true });
    for (const control of html.matchAll(/<(?:input|select|button)\b[^>]*>/g)) assert.match(control[0], /disabled=""/);
});
test('pending conversions can be applied and GBP switches require explicit verified confirmation', () => {
    const html = render({ value: { ...value, conversionPending: true } });
    assert.match(html, /Conversion pending/);
    const apply = html.match(/<button[^>]*>Apply conversion to GBP amounts/)[0];
    assert.doesNotMatch(apply, /disabled/);
    assert.match(render({ value: { originalCurrency: 'GBP', conversionPending: true } }), /Confirm verified GBP amounts/);
    assert.doesNotMatch(render({ value: {} }), /Confirm verified GBP amounts|Conversion pending/);
});
test('unsupported scan currency is shown explicitly and never presented as a GBP invoice', () => {
    const html = render({ value: { originalCurrency: 'GBP', unsupportedScanCurrency: 'JPY' } });
    assert.match(html, /Unsupported: JPY/);
    assert.match(html, /Unsupported invoice currency JPY/);
    assert.match(html, /<option value="" disabled="" selected=""/);
});
test('capture callers pass scan locks, protect confirmed edits and save foreign invoice dates separately', () => {
    const read = file => readFileSync(new URL(`../components/${file}`, import.meta.url), 'utf8');
    const expense = read('Expenses.jsx');
    const dla = read('DLA.jsx');
    assert.match(expense, /disabled=\{captureScanning\} preserveAccounting=\{!!editingExpense\} confirmed=\{editingExpense\?\.actualGbpPaid != null\}/);
    assert.match(dla, /preserveAccounting=\{!!editingEntry\} confirmed=\{editingEntry\?\.actualGbpPaid != null\}/);
    for (const source of [expense, dla]) {
        assert.match(source, /detectCurrency \|\| unsupported/);
        assert.match(source, /if \(unsupported\) showToast/);
        assert.match(source, /sequence === captureSequence.current\) setCaptureScanning\(false\)/);
        assert.match(source, /changeInvoiceCurrency\(line, resolveInvoiceCurrency/);
    }
    assert.equal((expense.match(/entryDate: new Date\(formData.invoiceDate\).toISOString\(\)/g) || []).length, 2);
    assert.match(expense, /datePaid: normalizedDatePaid/);
    assert.match(expense, /datePaid:\s+normalizeDateForApi\(scan.invoiceDate\) \|\| prev.datePaid/);
});