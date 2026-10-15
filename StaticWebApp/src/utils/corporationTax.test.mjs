import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./corporationTax.js', import.meta.url), 'utf8');
const { calculateCorporationTax, ctPaymentDeadline, ct600FilingDeadline, companiesHouseDeadline } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const pennies = (value) => Math.round(value * 100) / 100;

test('no tax on losses or zero profit', () => {
    assert.equal(calculateCorporationTax(0), 0);
    assert.equal(calculateCorporationTax(-5000), 0);
    assert.equal(calculateCorporationTax(undefined), 0);
});

test('small profits and main rates', () => {
    assert.equal(pennies(calculateCorporationTax(40000)), 7600);
    assert.equal(pennies(calculateCorporationTax(50000)), 9500);
    assert.equal(pennies(calculateCorporationTax(250000)), 62500);
    assert.equal(pennies(calculateCorporationTax(300000)), 75000);
});

test('marginal relief uses the HMRC 3/200 standard fraction', () => {
    assert.equal(pennies(calculateCorporationTax(60000)), 12150);
    assert.equal(pennies(calculateCorporationTax(100000)), 22750);
    assert.equal(pennies(calculateCorporationTax(150000)), 36000);
});

const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

test('CT payment is due 9 months and 1 day after the period end', () => {
    assert.equal(ymd(ctPaymentDeadline(new Date(2026, 2, 31, 23, 59, 59))), '2027-01-01');
    assert.equal(ymd(ctPaymentDeadline(new Date(2026, 4, 31))), '2027-03-01');
    assert.equal(ymd(ctPaymentDeadline(new Date(2027, 4, 31))), '2028-03-01');
    assert.equal(ymd(ctPaymentDeadline(new Date(2026, 3, 5))), '2027-01-06');
});

test('CT600 filing is 12 months and Companies House 9 months after the period end', () => {
    assert.equal(ymd(ct600FilingDeadline(new Date(2026, 2, 31))), '2027-03-31');
    assert.equal(ymd(ct600FilingDeadline(new Date(2028, 1, 29))), '2029-02-28');
    assert.equal(ymd(companiesHouseDeadline(new Date(2026, 4, 31))), '2027-02-28');
    assert.equal(ymd(companiesHouseDeadline(new Date(2026, 2, 31))), '2026-12-31');
});

test('deadlines keep their calendar date when serialised under UK summer time', () => {
    const oldTimezone = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
        assert.equal(ct600FilingDeadline(new Date(2026, 2, 31)).toISOString().slice(0, 10), '2027-03-31');
        assert.equal(ctPaymentDeadline(new Date(2025, 11, 31)).toISOString().slice(0, 10), '2026-10-01');
    } finally {
        if (oldTimezone == null) delete process.env.TZ; else process.env.TZ = oldTimezone;
    }
});
