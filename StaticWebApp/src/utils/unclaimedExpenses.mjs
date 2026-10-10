export function unclaimedExpenses(attention, error = null) {
    if (error || !attention || attention.moneyOut == null) return null;
    return {
        count: attention.missing.filter(transaction => transaction.direction === 'Out').length,
        amount: attention.moneyOut
    };
}