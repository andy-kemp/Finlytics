import { compareBankToApp } from './bankReconciliation.mjs';

export function bankAttention(transactions, records, baselineDate) {
    if (!baselineDate) throw new Error('Cash baseline required to identify outstanding payments');
    const groups = new Map();
    for (const transaction of transactions) {
        const date = String(transaction.transactionDate || '').slice(0, 10);
        if (!date || date <= baselineDate || !(Number(transaction.amount) > 0)) continue;
        const internal = transaction.category === 'Internal Transfer' || /\bpot transfer\b/i.test(transaction.description || '');
        const key = `${transaction.bankAccountId}:${date}:${transaction.direction}:${Math.round(Number(transaction.amount) * 100)}:${internal}`;
        const group = groups.get(key) || [];
        group.push(transaction);
        groups.set(key, group);
    }
    const crossFeedGroups = [...groups.values()].filter(group => group.some(transaction => transaction.source === 'Monzo')
        && group.some(transaction => transaction.source === 'CSV'));
    const isInternal = transaction => transaction.category === 'Internal Transfer' || /\bpot transfer\b/i.test(transaction.description || '');
    const possibleDuplicatePots = crossFeedGroups.filter(group => isInternal(group[0]));
    const possibleDuplicatePayments = crossFeedGroups.filter(group => !isInternal(group[0]));
    const current = transactions.filter(transaction => !transaction.isReconciled
        && String(transaction.transactionDate || '').slice(0, 10) > baselineDate
        && transaction.category !== 'Internal Transfer'
        && !/\bpot transfer\b/i.test(transaction.description || ''));
    const { comparisons } = compareBankToApp(current, records);
    const missing = current.filter((transaction, index) => comparisons[index].status === 'Missing app payment');
    const total = direction => missing.filter(transaction => transaction.direction === direction)
        .reduce((sum, transaction) => sum + Math.round(Math.abs(Number(transaction.amount)) * 100), 0) / 100;
    return { transactions: current, comparisons, missing,
        moneyOut: possibleDuplicatePayments.length ? null : total('Out'),
        moneyIn: possibleDuplicatePayments.length ? null : total('In'), possibleDuplicatePots, possibleDuplicatePayments };
}