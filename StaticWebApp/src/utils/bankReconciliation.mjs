import { isRepresentedDlaLedgerEntry } from './dlaLedgerCash.mjs';
import { buildSettlementProposal } from './foreignCurrency.mjs';

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
        add('Expense', expense.id, expense.actualGbpPaid ?? expense.amountGross, 'Out', expense.settlementDate || expense.datePaid, expense.reference || expense.expenseId, `Expense ${expense.expenseId || expense.reference || expense.id}: ${expense.supplierFreeText || expense.supplier || ''}`));
    dlaEntries.filter(entry => entry.direction === 'OwedToCompany').forEach(entry =>
        add('DLA', entry.id, entry.amountGross, 'Out', entry.datePaid || entry.entryDate, entry.dlaId, `Loan to director ${entry.dlaId}`));
    dlaPayments.forEach(payment => add('DLA-Payment', payment.id, payment.amount,
        loans.get(payment.dlaId)?.direction === 'OwedToCompany' ? 'In' : 'Out', payment.paymentDate,
        payment.dlaId, `DLA payment ${payment.paymentId || payment.dlaId}`));
    const dlaBatches = new Map();
    const invalidBatchReferences = new Set();
    dlaPayments.forEach(payment => {
        const reference = String(payment.paymentReference || '').match(/^DLA-\d{6}-\d{3}(?=\s|$)/i)?.[0]?.toUpperCase();
        const loan = loans.get(payment.dlaId);
        if (!reference) return;
        if (!loan || !['OwedToCompany', 'OwedToDirector'].includes(loan.direction) || !payment.paymentDate || !(Number(payment.amount) > 0)) {
            invalidBatchReferences.add(reference);
            return;
        }
        const direction = loan.direction === 'OwedToCompany' ? 'In' : 'Out';
        const date = String(payment.paymentDate).slice(0, 10);
        const key = `${reference}:${date}:${direction}`;
        const batch = dlaBatches.get(key) || { reference, date, direction, amount: 0, payments: [] };
        batch.amount += pennies(payment.amount);
        batch.payments.push(payment.id);
        dlaBatches.set(key, batch);
    });
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
        const recordedBatches = [...dlaBatches.values()].filter(batch =>
            !invalidBatchReferences.has(batch.reference) && batch.direction === transaction.direction && batch.amount === pennies(transaction.amount)
            && batch.date === String(transaction.transactionDate).slice(0, 10)
            && new RegExp(`(?:^|[^A-Z0-9-])${batch.reference}(?![A-Z0-9-])`, 'i')
                .test(`${transaction.reference || ''} ${transaction.description || ''} ${transaction.monzoMerchantName || ''}`));
        const candidates = recordedBatches.length ? recordedBatches.map(batch => ({
            key: `DLA-Batch:${batch.reference}:${batch.date}:${batch.direction}`, type: 'DLA-Batch',
            id: batch.reference, label: `Recorded DLA batch ${batch.reference}`, paymentIds: batch.payments
        })) : movements.filter(movement => {
            if (movement.direction !== transaction.direction || movement.amount !== pennies(transaction.amount)) return false;
            const reference = normalized(movement.reference);
            const days = Math.abs(new Date(movement.date.substring(0, 10)) - new Date(transaction.transactionDate.substring(0, 10))) / 86400000;
            return (reference.length >= 4 && text.includes(reference)) || days <= 7;
        });
        const settlementCandidates = transaction.originalCurrency && transaction.originalAmount != null ? expenses
            .filter(expense => !expense.isDLA && expense.actualGbpPaid == null && expense.originalCurrency === transaction.originalCurrency)
            .flatMap(expense => {
                const days = Math.abs(new Date((expense.datePaid || expense.entryDate || '').substring(0, 10)) - new Date(transaction.transactionDate.substring(0, 10))) / 86400000;
                const merchant = normalized(expense.supplierFreeText || expense.supplier);
                const ref = normalized(expense.reference);
                const matchesIdentity = (ref.length >= 4 && text.includes(ref)) || (merchant.length >= 4 && text.includes(merchant));
                if (!matchesIdentity || !(days <= 30)) return [];
                const settlement = buildSettlementProposal(expense, transaction);
                return settlement ? [{ key: `Expense:${expense.id}`, expenseId: expense.id, label: expense.supplierFreeText || expense.supplier, ...settlement }] : [];
            }) : [];
        return { status: recordedBatches.length === 1 ? 'Recorded DLA payment' : settlementCandidates.length ? 'FX settlement - review' : candidates.length === 1 ? 'Suggested match' : candidates.length > 1 ? 'Multiple matches - review' : 'Missing app payment', candidates, settlementCandidates };
    });
    const uses = new Map();
    comparisons.forEach(comparison => comparison.candidates.forEach(candidate => uses.set(candidate.key, (uses.get(candidate.key) || 0) + 1)));
    comparisons.forEach(comparison => {
        if (comparison.candidates.some(candidate => uses.get(candidate.key) > 1)) comparison.status = 'Shared app payment - review';
    });
    const settlementUses = new Map();
    comparisons.forEach(comparison => (comparison.settlementCandidates || []).forEach(candidate => settlementUses.set(candidate.key, (settlementUses.get(candidate.key) || 0) + 1)));
    comparisons.forEach(comparison => {
        if ((comparison.settlementCandidates || []).some(candidate => settlementUses.get(candidate.key) > 1)) {
            comparison.status = 'Shared FX payment - review';
            comparison.settlementCandidates.forEach(candidate => { candidate.ambiguous = true; });
        }
    });
    const dates = transactions.map(transaction => transaction.transactionDate.substring(0, 10)).sort();
    const unmatchedPayments = movements.filter(movement => !uses.has(movement.key) && movement.date.substring(0, 10) >= dates[0] && movement.date.substring(0, 10) <= dates.at(-1));
    return { comparisons, unmatchedPayments };
}