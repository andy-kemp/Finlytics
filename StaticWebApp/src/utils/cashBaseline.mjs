function pennies(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) {
        throw new Error('Cash baseline contains an invalid amount');
    }
    return Math.round(Number(value) * 100);
}

function utcDay(value) {
    if (!value) throw new Error('Cash baseline contains an invalid date');
    const timestamp = value instanceof Date ? value : new Date(
        /T/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value
    );
    if (!Number.isFinite(timestamp.getTime())) throw new Error('Cash baseline contains an invalid date');
    return timestamp.toISOString().slice(0, 10);
}

export function calculateMainAccountBookBalance(rawCash, baseline, bankTransactions, endDate = new Date()) {
    const recorded = pennies(rawCash?.balance);
    if (baseline === null) return recorded / 100;
    if (!baseline || baseline.bankAccountId == null) throw new Error('Invalid cash baseline account');
    if (!Array.isArray(bankTransactions)) throw new Error('Main-account bank transactions unavailable');
    const cutoff = utcDay(baseline.asOfDate);
    const end = utcDay(endDate);
    if (end < cutoff) throw new Error('Cash baseline cannot calculate a balance before its baseline date');
    let transfers = 0;
    for (const transaction of bankTransactions) {
        if (String(transaction.bankAccountId) !== String(baseline.bankAccountId)) continue;
        if (transaction.category !== 'Internal Transfer' && !/(?:^|\s-\s)pot transfer(?:\s-\s|$)/i.test((transaction.description || '').trim())) continue;
        const day = utcDay(transaction.valueDate || transaction.transactionDate);
        if (day <= cutoff || day > end) continue;
        if (!['In', 'Out'].includes(transaction.direction)) throw new Error('Internal transfer has an invalid direction');
        transfers += Math.abs(pennies(transaction.amount)) * (transaction.direction === 'In' ? 1 : -1);
    }
    return (pennies(baseline.bookBalance) + pennies(baseline.historicalExpenseAdjustment ?? 0)
        + recorded - pennies(baseline.recordedCashAtCreation) + transfers) / 100;
}

export async function loadMainAccountCashBaseline({ getBankAccounts, getCashBaseline, getBankTransactionsByAccount }) {
    let baseline = null;
    let account = null;
    try {
        const accounts = await getBankAccounts();
        if (!Array.isArray(accounts)) throw new Error('Bank accounts unavailable');
        const active = accounts.filter(item => item.isActive === true && item.currency === 'GBP');
        if (active.length !== 1) throw new Error('Main-account baseline requires exactly one active GBP account');
        account = active[0];
        baseline = await getCashBaseline(account.id);
        if (baseline === null) return { account, baseline: null, transactions: null, error: null };
        if (!baseline || String(baseline.bankAccountId) !== String(account.id)) throw new Error('Cash baseline account does not match the main account');
        const transactions = await getBankTransactionsByAccount(account.id);
        if (!Array.isArray(transactions)) throw new Error('Main-account bank transactions unavailable');
        return { account, baseline, transactions, error: null };
    } catch (error) {
        return { account, baseline, transactions: null, error: error.message || 'Main-account baseline unavailable' };
    }
}