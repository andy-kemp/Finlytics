function pennies(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) throw new Error('Balance unavailable');
    const result = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(result)) throw new Error('Balance exceeds supported range');
    return result;
}

export function calculateBookCashWithPots(mainAccountBookBalance, snapshot, bankTransactions = []) {
    if (!snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOfDate || '')) return null;
    const main = pennies(mainAccountBookBalance);
    const vat = pennies(snapshot.vatPotBalance);
    const ct = pennies(snapshot.ctPotBalance);
    if (vat < 0 || ct < 0) throw new Error('Actual pot balances cannot be negative');
    const stale = bankTransactions.some(transaction => String(transaction.bankAccountId) === String(snapshot.bankAccountId)
        && (transaction.category === 'Internal Transfer' || /pot transfer/i.test(transaction.description || ''))
        && String(transaction.valueDate || transaction.transactionDate || '').slice(0, 10) > snapshot.asOfDate);
    return { overall: stale ? null : (main + vat + ct) / 100, excludingPots: main / 100, pots: (vat + ct) / 100, asOfDate: snapshot.asOfDate, stale };
}

export function calculateAvailableAfterTax(bookCash, snapshot, vatOwed, corpTaxDue) {
    if (!bookCash || bookCash.overall == null) return null;
    const vatSurplus = pennies(snapshot.vatPotBalance) - pennies(Math.max(0, Number(vatOwed) || 0));
    const ctSurplus = pennies(snapshot.ctPotBalance) - pennies(Math.max(0, Number(corpTaxDue) || 0));
    return {
        available: (pennies(bookCash.excludingPots) + vatSurplus + ctSurplus) / 100,
        vatSurplus: vatSurplus / 100,
        ctSurplus: ctSurplus / 100
    };
}