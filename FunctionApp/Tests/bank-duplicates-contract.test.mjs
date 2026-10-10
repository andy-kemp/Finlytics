import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('CSV batch duplicate review happens before any rows are persisted', () => {
    const source = read('Data/Repositories.cs');
    const start = source.indexOf('public class BankTransactionRepository');
    const batch = source.slice(source.indexOf('public async Task<IEnumerable<BankTransaction>> CreateManyAsync', start), source.indexOf('public async Task<BankTransaction> UpdateAsync', start));
    assert.ok(batch.includes('existing.Concat(created)'));
    assert.ok(batch.includes('PossibleCrossFeedDuplicate(transaction, other)'));
    assert.ok(batch.indexOf('throw new FinanceHubFunctions.Helpers.BankDuplicateReviewException()') < batch.indexOf('_context.BankTransactions.AddRange(created)'));
});

test('import returns an explicit 409 only for duplicate review conflicts', () => {
    const source = read('Functions/BankingFunctions.cs');
    const batch = source.slice(source.indexOf('[Function("ImportBankTransactions")]'), source.indexOf('[Function("UpdateBankTransaction")]'));
    assert.ok(batch.includes('catch (BankDuplicateReviewException exception)'));
    assert.ok(batch.includes('WriteAsJsonAsync(new { error = exception.Message }, HttpStatusCode.Conflict)'));
});

test('monthly reconciliation checks duplicates across all account rows before creating expense or link records', () => {
    const source = read('Functions/MonthlyReconciliationFunctions.cs');
    assert.ok(source.includes('accountBanks.Any(other => MonzoSyncPolicy.PossibleCrossFeedDuplicate(bank, other))'));
    assert.ok(source.indexOf('PossibleCrossFeedDuplicate(bank, other)') < source.indexOf('_db.Expenses.Add(expense)'));
    assert.ok(source.indexOf('PossibleCrossFeedDuplicate(bank, other)') < source.indexOf('_db.ReconciliationMatches.Add'));
    assert.ok(source.includes('BeginTransactionAsync(IsolationLevel.Serializable)'));
});