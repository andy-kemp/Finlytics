import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseBankCsv, previewBankImport, summarizeBankStatement } from './bankCsv.mjs';

const header = 'Transaction ID,Date,Time,Type,Name,Category,Amount,Currency,Notes and #tags,Description,Balance';
const sample = `${header}\nmm_a,01/10/2026,09:00:00,Faster payment,Client,Income,1200,GBP,INV-001,,1200\nmm_b,01/10/2026,10:00:00,Pot transfer,VAT Pot,Savings,-200,GBP,,,1000\nmm_c,02/10/2026,09:00:00,Monzo-to-Monzo,Andrew Kemp,Transfers,-100,GBP,DVA-2026-001-AK,,900`;

test('preserves bank IDs separately from references and recognises pots and dividends', () => {
    const { transactions, rejected } = parseBankCsv(sample, 1);
    assert.equal(rejected.length, 0);
    assert.equal(transactions[0].externalId, 'mm_a');
    assert.equal(transactions[0].reference, 'INV-001');
    assert.equal(transactions[1].category, 'Internal Transfer');
    assert.equal(transactions[2].category, 'Dividends');
    assert.equal(transactions[2].direction, 'Out');
});

test('statement reconciles in pennies and separates pot movements from external cash', () => {
    const summary = summarizeBankStatement(parseBankCsv(sample, 1).transactions);
    assert.equal(summary.opening, 0);
    assert.equal(summary.closing, 900);
    assert.equal(summary.calculatedClosing, 900);
    assert.equal(summary.externalNet, 1100);
    assert.equal(summary.potMovement, -200);
    assert.deepEqual(summary.balanceErrors, []);
});

test('repeated upload and repeated IDs within file are duplicates, account identity is retained', () => {
    const { transactions } = parseBankCsv(sample, 1);
    assert.equal(previewBankImport(transactions, transactions).newTransactions.length, 0);
    assert.equal(previewBankImport([...transactions, transactions[0]]).duplicates.length, 1);
    assert.equal(previewBankImport(transactions, transactions.map(transaction => ({ ...transaction, bankAccountId: 2 }))).newTransactions.length, 3);
});

test('quoted multiline descriptions and signed debit columns parse without losing rows', () => {
    const result = parseBankCsv('Date,Description,Money Out,Money In\n01/10/2026,"Merchant, Inc.\nPurchase",-10,\n02/10/2026,Refund,,5', 1);
    assert.equal(result.transactions.length, 2);
    assert.equal(result.transactions[0].amount, 10);
    assert.equal(result.transactions[0].direction, 'Out');
    assert.equal(result.transactions[1].direction, 'In');
});

test('distinct bank IDs are retained even when other fields are identical', () => {
    const transaction = parseBankCsv(sample, 1).transactions[0];
    const second = { ...transaction, externalId: 'mm_distinct', monzoTransactionId: 'mm_distinct' };
    assert.equal(previewBankImport([second], [transaction]).newTransactions.length, 1);
});

test('invalid dates and currencies are reported rather than silently skipped', () => {
    const result = parseBankCsv(`${header}\nmm_a,31/02/2026,,Card payment,Shop,General,-10,GBP,,,0\nmm_b,01/10/2026,,Card payment,Shop,General,-10,EUR,,,0`, 1);
    assert.equal(result.transactions.length, 0);
    assert.equal(result.rejected.length, 2);
});

test('unknown director transfers require review and positive merchant refunds are not DLA', () => {
    const result = parseBankCsv(`${header}\nmm_a,01/10/2026,,Monzo-to-Monzo,Andrew Kemp,Transfers,-20,GBP,,,0\nmm_b,01/10/2026,,Card payment,Hotel,Travel,100,GBP,,,100`, 1);
    assert.equal(result.transactions[0].category, 'Transfer - Review');
    assert.equal(result.transactions[1].category, 'Travel');
});

test('running balance discrepancies are reported', () => {
    const { transactions } = parseBankCsv(sample, 1);
    transactions[1].balance = 950;
    assert.equal(summarizeBankStatement(transactions).balanceErrors[0].difference, -50);
});

test('supplied Monzo export reconstructs its closing balance', { skip: !process.env.BANK_CSV_PATH }, () => {
    const { transactions, rejected } = parseBankCsv(readFileSync(process.env.BANK_CSV_PATH, 'utf8'), 1);
    const statement = summarizeBankStatement(transactions);
    assert.equal(transactions.length, 75);
    assert.equal(rejected.length, 0);
    assert.equal(statement.closing, 996.86);
    assert.equal(statement.calculatedClosing, statement.closing);
    assert.deepEqual(statement.balanceErrors, []);
    console.log(JSON.stringify(statement));
});