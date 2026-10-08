export function calculateRecordedTradingCash({
    invoices = [], expenses = [], dlaPayments = [], dlaEntries = [], ledgerEntries = [],
    includePayroll = false, startDate = null, endDate = new Date()
}) {
    const inRange = date => {
        if (!date) return false;
        const value = new Date(date);
        return (!startDate || value >= startDate) && value <= endDate;
    };
    const sum = (items, field) => items.reduce((total, item) => total + Math.round(Number(item[field] || 0) * 100), 0) / 100;
    const loansById = new Map(dlaEntries.map(entry => [entry.dlaId, entry]));
    const income = invoices
        .filter(invoice => invoice.status === 'Paid' && inRange(invoice.datePaid || invoice.dateIssued));
    const expensePayments = sum(expenses.filter(expense => !expense.isDLA && inRange(expense.datePaid)), 'amountGross');
    const payments = dlaPayments.filter(payment => inRange(payment.paymentDate));
    const directorRepayments = sum(payments.filter(payment => loansById.get(payment.dlaId)?.direction !== 'OwedToCompany'), 'amount');
    const directorReceipts = sum(payments.filter(payment => loansById.get(payment.dlaId)?.direction === 'OwedToCompany'), 'amount');
    const directorLoans = sum(dlaEntries.filter(entry => entry.direction === 'OwedToCompany' && inRange(entry.datePaid || entry.entryDate)), 'amountGross');
    const cashLedger = ledgerEntries.filter(entry => inRange(entry.effectiveDate));
    const ledgerCashIn = sum(cashLedger.filter(entry =>
        entry.entryType === 'VAT_Reclaim' || (entry.entryType === 'DLA_In' && !loansById.has(entry.dlaReference))), 'amount');
    const outflowTypes = new Set(['Dividend_Paid', 'CorpTax_Paid', 'VAT_Paid', 'DLA_Payment']);
    if (includePayroll) {
        for (const entryType of ['Salary', 'EmployeeNI', 'EmployerNI', 'PAYE']) outflowTypes.add(entryType);
    }
    const ledgerCashOut = sum(cashLedger.filter(entry =>
        ((outflowTypes.has(entry.entryType) || entry.entryType === 'DLA_Out') &&
            !(entry.entryType.startsWith('DLA_') && loansById.has(entry.dlaReference)))), 'amount');
    const cashIn = Math.round((sum(income, 'amountGross') + directorReceipts + ledgerCashIn) * 100) / 100;
    const cashOut = Math.round((expensePayments + directorRepayments + directorLoans + ledgerCashOut) * 100) / 100;

    const balance = Math.round((cashIn - cashOut) * 100) / 100;
    return { income: sum(income, 'amountGross'), expensePayments, directorRepayments, cashIn, cashOut, balance };
}