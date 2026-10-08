import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCurrencyConversion, changeInvoiceCurrency, currencyMetadata, currencyPayload, currencyValidation, rateLookupIsCurrent, scannedCurrencyAmounts, updateCurrencyFields } from './foreignCurrencyForm.mjs';

const foreign = { originalCurrency: 'EUR', originalAmountNet: '100', originalVatAmount: '20', originalAmountGross: '120', exchangeRateToGbp: '0.85', exchangeRateDate: '2026-10-07', exchangeRateSource: 'Manual verified rate', amountNet: '99', vatAmount: '0', amountGross: '99' };

test('legacy rows default GBP and metadata keeps zero and settlement links', () => {
    assert.equal(currencyMetadata({}).originalCurrency, 'GBP');
    assert.equal(currencyMetadata({ OriginalVatAmount: 0 }).originalVatAmount, 0);
    assert.equal(currencyPayload({ ...foreign, actualGbpPaid: '103', settlementBankTransactionId: 12 }).settlementBankTransactionId, 12);
});
test('explicit conversion does not infer UK VAT from foreign invoice tax', () => {
    assert.deepEqual(applyCurrencyConversion(foreign), { amountNet: '102.00', vatAmount: '0.00', amountGross: '102.00', estimatedGbpGross: 102, conversionPending: false });
    assert.equal(foreign.amountGross, '99');
    assert.equal(applyCurrencyConversion({ ...foreign, vatAmount: '2' }).amountNet, '100.00');
    assert.throws(() => applyCurrencyConversion({ ...foreign, vatAmount: '' }), /explicitly/);
});
test('foreign validation blocks missing originals or rate but accepts valid edits', () => {
    assert.equal(currencyValidation(foreign), '');
    assert.ok(currencyValidation({ ...foreign, originalVatAmount: '' }));
    assert.ok(currencyValidation({ ...foreign, exchangeRateToGbp: 0 }));
    assert.ok(currencyValidation({ ...foreign, originalAmountGross: 119 }));
    assert.equal(currencyValidation({}), '');
});
test('OCR foreign amounts never populate GBP, explicit currency overrides supplier', () => {
    const amounts = { amountNet: '100', vatAmount: '20', amountGross: '120' };
    const row = scannedCurrencyAmounts({ currency: 'EUR' }, amounts, 'USD');
    assert.equal(row.originalCurrency, 'EUR');
    assert.equal(row.originalAmountGross, '120');
    assert.equal(row.amountGross, '');
    assert.ok(currencyValidation(scannedCurrencyAmounts({ currency: '$' }, amounts)));
    assert.equal(scannedCurrencyAmounts({}, amounts, 'USD').originalCurrency, 'USD');
    assert.equal(scannedCurrencyAmounts({ currency: 'GBP' }, amounts, 'EUR').amountGross, '120');
    assert.equal(scannedCurrencyAmounts({ currency: 'GBP' }, amounts).originalAmountGross, '120');
    assert.equal(scannedCurrencyAmounts({ currency: 'EUR' }, { ...amounts, originalAmountGross: 130 }).originalAmountGross, 130);
});
test('missing OCR currency uses supplier but explicit unsupported currency blocks every amount', () => {
    const amounts = { amountNet: '100', vatAmount: '20', amountGross: '120' };
    for (const currency of [undefined, null, '', ' ']) {
        assert.equal(scannedCurrencyAmounts({ currency }, amounts, 'USD').originalCurrency, 'USD');
    }
    for (const currency of ['JPY', 'jpy', '$']) {
        const row = scannedCurrencyAmounts({ currency }, amounts, 'USD');
        assert.equal(row.originalCurrency, 'GBP');
        for (const field of ['amountNet', 'vatAmount', 'amountGross', 'originalAmountNet', 'originalVatAmount', 'originalAmountGross']) assert.equal(row[field], '');
        assert.match(currencyValidation(row), /Unsupported invoice currency/);
    }
});
test('actual GBP payment requires settlement date including GBP records', () => {
    assert.match(currencyValidation({ ...foreign, actualGbpPaid: '103' }), /settlement date/);
    assert.equal(currencyValidation({ ...foreign, actualGbpPaid: '103', settlementDate: '2026-10-08' }), '');
    assert.match(currencyValidation({ actualGbpPaid: '0' }), /settlement date/);
    assert.match(currencyValidation({ ...foreign, settlementDate: '2026-10-08' }), /actual GBP payment/);
});
test('currency switches clear originals, stale rates and derived GBP amounts until explicit confirmation', () => {
    for (const currency of ['USD', 'GBP']) {
        const next = { ...foreign, ...changeInvoiceCurrency(foreign, currency) };
        for (const field of ['exchangeRateToGbp', 'exchangeRateDate', 'exchangeRateSource', 'estimatedGbpGross']) assert.equal(next[field], null);
        for (const field of ['originalAmountNet', 'originalVatAmount', 'originalAmountGross', 'amountNet', 'vatAmount', 'amountGross']) assert.equal(next[field], '');
        assert.match(currencyValidation(next), /before saving/);
    }
    const stored = { ...foreign, ...changeInvoiceCurrency(foreign, 'USD', { preserveAccounting: true }) };
    assert.equal(stored.amountGross, '99');
    assert.match(currencyValidation(stored), /before saving/);
    assert.deepEqual(changeInvoiceCurrency({}, 'GBP'), {});
    const gbp = { ...stored, ...changeInvoiceCurrency(stored, 'GBP'), amountNet: '100', vatAmount: '20', amountGross: '120' };
    assert.equal(currencyValidation({ ...gbp, ...applyCurrencyConversion(gbp) }), '');
    assert.throws(() => applyCurrencyConversion({ ...gbp, amountGross: '' }), /verified GBP/);
});
test('unsupported OCR cannot be cleared by applying or relabeling extracted amounts', () => {
    const row = scannedCurrencyAmounts({ currency: 'JPY' }, { amountGross: 100 }, 'USD');
    assert.throws(() => applyCurrencyConversion(row), /Unsupported/);
    const next = { ...row, ...changeInvoiceCurrency(row, 'USD') };
    assert.equal(next.originalAmountGross, '');
    assert.ok(currencyValidation(next));
    assert.ok(currencyValidation({ ...next, ...foreign }));
    assert.equal(currencyValidation({ ...next, ...foreign, ...applyCurrencyConversion({ ...next, ...foreign }) }), '');
});
test('editing originals or rates invalidates conversion without erasing historic accounting', () => {
    const change = { exchangeRateToGbp: '0.9' };
    assert.equal(updateCurrencyFields(foreign, change).amountGross, '');
    const stored = { ...foreign, ...updateCurrencyFields(foreign, change, { preserveAccounting: true }) };
    assert.equal(stored.amountGross, '99');
    assert.equal(stored.estimatedGbpGross, null);
    assert.ok(currencyValidation(stored));
    assert.equal(currencyValidation({ ...stored, ...applyCurrencyConversion(stored) }), '');
});
test('GBP overrides and VAT exemption cannot bypass pending foreign conversion', () => {
    for (const change of [{ amountNet: '100' }, { vatAmount: '2' }, { amountGross: '103' }, { vatExempt: true }]) {
        const row = { ...foreign, ...updateCurrencyFields(foreign, change, { preserveAccounting: true }) };
        assert.match(currencyValidation(row), /before saving/);
    }
    assert.deepEqual(updateCurrencyFields({}, { vatExempt: true }), { vatExempt: true });
});
test('rate responses must match request version, currency, effective day and enabled state', () => {
    const request = { id: 1, currency: 'EUR', day: '2026-10-07' };
    assert.equal(rateLookupIsCurrent(request, request), true);
    for (const change of [{ id: 2 }, { currency: 'USD' }, { day: '2026-10-08' }, { disabled: true }]) assert.equal(rateLookupIsCurrent(request, { ...request, ...change }), false);
    assert.equal(rateLookupIsCurrent(request, { ...request, id: 3 }), false);
});