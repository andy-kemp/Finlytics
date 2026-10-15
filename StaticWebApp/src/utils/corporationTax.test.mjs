import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./corporationTax.js', import.meta.url), 'utf8');
const { calculateCorporationTax } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
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
