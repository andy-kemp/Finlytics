import { compareBankToApp } from './bankReconciliation.mjs';

export function bankAttention(transactions, records, baselineDate) {
    if (!baselineDate) throw new Error('Cash baseline required to identify outstanding payments');
    const potGroups = new Map();
    for (const transaction of transactions) {
        const date = String(transaction.transactionDate || '').slice(0, 10);
        if (date <= baselineDate || (transaction.category !== 'Internal Transfer' && !/\bpot transfer\b/i.test(transaction.description || ''))) continue;
        const key = `${transaction.bankAccountId}:${date}:${transaction.direction}:${Math.round(Number(transaction.amount) * 100)}`;
        const group = potGroups.get(key) || [];
        group.push(transaction);
        potGroups.set(key, group);
    }
    const possibleDuplicatePots = [...potGroups.values()].filter(group => group.some(transaction => transaction.source === 'Monzo')
        && group.some(transaction => transaction.source === 'CSV'));
    const current = transactions.filter(transaction => !transaction.isReconciled
        && String(transaction.transactionDate || '').slice(0, 10) > baselineDate
        && transaction.category !== 'Internal Transfer'
        && !/\bpot transfer\b/i.test(transaction.description || ''));
    const { comparisons } = compareBankToApp(current, records);
    const missing = current.filter((transaction, index) => comparisons[index].status === 'Missing app payment');
    const total = direction => missing.filter(transaction => transaction.direction === direction)
        .reduce((sum, transaction) => sum + Math.round(Math.abs(Number(transaction.amount)) * 100), 0) / 100;
    return { transactions: current, comparisons, missing, moneyOut: total('Out'), moneyIn: total('In'), possibleDuplicatePots };
}