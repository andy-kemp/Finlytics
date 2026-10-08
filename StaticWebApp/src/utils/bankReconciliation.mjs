import { isRepresentedDlaLedgerEntry } from './dlaLedgerCash.mjs';

const pennies = value => Math.round(Number(value || 0) * 100);
const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function compareBankToApp(transactions, { invoices = [], expenses = [], dlaEntries = [], dlaPayments = [], ledgerEntries = [] }) {
    const movements = [];
    const add = (type, id, amount, direction, date, reference, label) => {
        if (amount == null || !date) return;
        movements.push({ key: `${type}:${id}`, type, id, amount: pennies(amount), direction, date, reference, label });
    };
    const loans = new Map(dlaEntries.map(entry => [entry.dlaId, entry]));
    invoices.filter(invoice => invoice.status === 'Paid').forEach(invoice =>
        add('Invoice', invoice.id, invoice.amountGross, 'In', invoice.datePaid || invoice.dateIssued, invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} (${invoice.customerName || ''})`));
    expenses.filter(expense => !expense.isDLA && expense.datePaid).forEach(expense =>
        add('Expense', expense.id, expense.amountGross, 'Out', expense.datePaid, expense.reference || expense.expenseId, `Expense ${expense.expenseId || expense.reference || expense.id}: ${expense.supplierFreeText || expense.supplier || ''}`));
    dlaEntries.filter(entry => entry.direction === 'OwedToCompany').forEach(entry =>
        add('DLA', entry.id, entry.amountGross, 'Out', entry.datePaid || entry.entryDate, entry.dlaId, `Loan to director ${entry.dlaId}`));
    dlaPayments.forEach(payment => add('DLA-Payment', payment.id, payment.amount,
        loans.get(payment.dlaId)?.direction === 'OwedToCompany' ? 'In' : 'Out', payment.paymentDate,
        payment.dlaId, `DLA payment ${payment.paymentId || payment.dlaId}`));
    const ledgerOut = new Set(['Dividend_Paid', 'CorpTax_Paid', 'VAT_Paid', 'Salary', 'PAYE', 'DLA_Out', 'DLA_Payment']);
    const ledgerIn = new Set(['VAT_Reclaim', 'DLA_In']);
    ledgerEntries.forEach(entry => {
        if (isRepresentedDlaLedgerEntry(entry, dlaEntries)) return;
        if (!ledgerOut.has(entry.entryType) && !ledgerIn.has(entry.entryType)) return;
        add('CompanyLedger', entry.id, entry.amount, ledgerIn.has(entry.entryType) ? 'In' : 'Out', entry.effectiveDate,
            entry.dlaReference, `${entry.entryType}: ${entry.title || entry.id}`);
    });
    const comparisons = transactions.map(transaction => {
        if (transaction.category === 'Internal Transfer') return { status: 'Internal pot transfer', candidates: [] };
        const text = normalized(`${transaction.reference || ''} ${transaction.description || ''}`);
        const candidates = movements.filter(movement => {
            if (movement.direction !== transaction.direction || movement.amount !== pennies(transaction.amount)) return false;
            const reference = normalized(movement.reference);
            const days = Math.abs(new Date(movement.date.substring(0, 10)) - new Date(transaction.transactionDate.substring(0, 10))) / 86400000;
            return (reference.length >= 4 && text.includes(reference)) || days <= 7;
        });
        return { status: candidates.length === 1 ? 'Suggested match' : candidates.length > 1 ? 'Multiple matches - review' : 'Missing app payment', candidates };
    });
    const uses = new Map();
    comparisons.forEach(comparison => comparison.candidates.forEach(candidate => uses.set(candidate.key, (uses.get(candidate.key) || 0) + 1)));
    comparisons.forEach(comparison => {
        if (comparison.candidates.some(candidate => uses.get(candidate.key) > 1)) comparison.status = 'Shared app payment - review';
    });
    const dates = transactions.map(transaction => transaction.transactionDate.substring(0, 10)).sort();
    const unmatchedPayments = movements.filter(movement => !uses.has(movement.key) && movement.date.substring(0, 10) >= dates[0] && movement.date.substring(0, 10) <= dates.at(-1));
    return { comparisons, unmatchedPayments };
}