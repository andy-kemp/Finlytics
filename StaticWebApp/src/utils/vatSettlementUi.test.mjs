import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { todayDate } from './vatSettlement.mjs';

const server = await createServer({
    root: new URL('../../', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{ name: 'vat-test-api', enforce: 'pre', resolveId(source, importer) {
        if (source.endsWith('/services/apiService') && importer?.endsWith('VatSettlementModal.jsx')) return '\0vat-test-api';
    }, load(id) {
        if (id === '\0vat-test-api') return 'export const confirmVatSettlement = async () => ({}); export const getBankAccounts = async () => []; export const getBankTransactionsByAccount = async () => [];';
    } }]
});
after(() => server.close());
const { default: Modal, SettlementSummary } = await server.ssrLoadModule('/src/components/VatSettlementModal.jsx');
const record = { id: 9, vatOwed: -581.15, quarterLabel: 'Q1 2025/26', filedDate: '2025-04-01', quarterStartDate: '2025-01-01', quarterEndDate: '2025-03-31' };
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('modal defaults to positive filed GBP and today, never filing date or confirmed', () => {
    const html = renderToStaticMarkup(React.createElement(Modal, { record, onClose() {}, onSuccess() {} }));
    assert.match(html, /Actual Cash In/);
    assert.match(html, /id="vat-actual-amount"[^>]*value="581.15"/);
    assert.match(html, new RegExp(`id="vat-settlement-date"[^>]*value="${todayDate()}"`));
    assert.doesNotMatch(html, /checked=""/);
    assert.match(html, /type="submit"[^>]*disabled=""[^>]*>Record Refund/);
    assert.match(html, /I checked the actual bank statement/);
});

test('overlapping return warning requires an additional unchecked review acknowledgement', () => {
    const html = renderToStaticMarkup(React.createElement(Modal, { record, overlaps: [{ ...record, id: 10 }], onClose() {}, onSuccess() {} }));
    assert.match(html, /Warning: overlapping filed returns/);
    assert.match(html, /I reviewed the overlapping returns/);
    assert.equal((html.match(/type="checkbox"/g) || []).length, 3);
    assert.doesNotMatch(html, /checked=""/);
});

test('settlement summary shows actual dated receipt without a resubmit command', () => {
    const html = renderToStaticMarkup(React.createElement(SettlementSummary, { record: { ...record, settlementStatus: 'RefundReceived', settlementAmount: 581.33, settlementDate: '2026-10-07', settlementReference: 'HMRC RECEIPT' } }));
    assert.match(html, /Refund Received/);
    assert.match(html, /£581.33/);
    assert.match(html, /07\/10\/2026/);
    assert.match(html, /HMRC RECEIPT/);
    assert.doesNotMatch(html, /button/);
});

test('VAT POST uses dedicated settlement headers and exact camelCase payload; errors remain visible', async () => {
    const source = read('../services/apiService.js');
    const body = source.slice(source.indexOf('export async function confirmVatSettlement'), source.indexOf('export async function getVatReturns'));
    const executable = body.replace('export async function confirmVatSettlement', 'async function confirmVatSettlement').replace('import.meta.env.VITE_SETTLEMENT_API_SCOPE', 'scope');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let called = false;
    const headers = { Authorization: 'Bearer dedicated-api-token', 'Content-Type': 'application/json' };
    const run = new AsyncFunction('getSettlementHeaders', 'msalInstance', 'scope', 'API_BASE', 'fetch', `${executable}; return confirmVatSettlement(9, { amount: 581.33, settlementDate: '2026-10-07', reference: 'receipt', differenceReason: 'HMRC adjustment' });`);
    const auth = async (instance, scope, account) => { assert.equal(scope, 'dedicated-scope'); assert.equal(account, 'owner'); return headers; };
    const instance = { getAllAccounts: () => ['owner'] };
    await run(auth, instance, 'dedicated-scope', '/api', async (url, options) => {
        called = true;
        assert.equal(url, '/api/vat-returns/9/settlement');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers, headers);
        assert.deepEqual(JSON.parse(options.body), { amount: 581.33, settlementDate: '2026-10-07', bankTransactionId: null, reference: 'receipt', differenceReason: 'HMRC adjustment' });
        return { ok: true, json: async () => ({ settlementStatus: 'RefundReceived' }) };
    });
    assert.equal(called, true);
    await assert.rejects(() => run(auth, instance, 'dedicated-scope', '/api', async () => ({ ok: false, json: async () => ({ error: 'Already settled' }) })), /Already settled/);
    called = false;
    await assert.rejects(() => run(async () => { throw new Error('Missing scope'); }, instance, '', '/api', async () => { called = true; }), /Missing scope/);
    assert.equal(called, false);
});

test('settled guards precede unfile deletion and HMRC external submission; history includes every record', () => {
    const source = read('../components/VatReturns.jsx');
    const unfile = source.slice(source.indexOf('const handleUnfile'), source.indexOf('const handleHmrcConnect'));
    assert.ok(unfile.indexOf('if (isVatSettled(fr))') < unfile.indexOf('await deleteVatReturn'));
    const hmrc = source.slice(source.indexOf('const submitToHmrc'), source.indexOf('// ── Formatting'));
    assert.ok(hmrc.indexOf('isVatSettled(fr)') < hmrc.indexOf('await submitVatReturnToHmrc'));
    assert.ok(hmrc.indexOf('const latestFiled = await getVatReturns()') < hmrc.indexOf('await submitVatReturnToHmrc'));
    assert.match(hmrc, /latestFiled.some\(fr => isVatSettled\(fr\)/);
    assert.match(hmrc, /findFiledForQuarter\(hmrcQuarter, latestFiled\)/);
    assert.match(source, /\[\.\.\.filedReturns\]\.sort/);
    assert.match(source, /disabled=\{isVatSettled\(filed\)\}/);
    assert.match(source, /disabled=\{isVatSettled\(fr\)\}/);
    const modal = read('../components/VatSettlementModal.jsx');
    assert.match(modal, /if \(locked.current\) return/);
    assert.match(modal, /locked.current = true/);
    assert.match(modal, /setSaved\(true\)/);
    assert.match(modal, /Settlement saved, but returns could not be refreshed/);
});