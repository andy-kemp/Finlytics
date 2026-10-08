export const formatGbp = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);

export function todayDate(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function settlementStatus(record) {
    return record.settlementStatus || (Number(record.vatOwed) > 0 ? 'AwaitingPayment' : Number(record.vatOwed) < 0 ? 'AwaitingRefund' : 'NoSettlementRequired');
}

export function isVatSettled(record) {
    return ['Paid', 'RefundReceived'].includes(settlementStatus(record)) || record.settlementLedgerEntryId != null;
}

export function settlementAction(record) {
    if (isVatSettled(record) || !Number(record.vatOwed)) return null;
    return Number(record.vatOwed) > 0 ? 'Mark as Paid' : 'Record Refund';
}

export function validSettlementDate(value, today = todayDate()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > today) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function amountPennies(value) {
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
    const pennies = Math.round(Number(value) * 100);
    return Number.isSafeInteger(pennies) && pennies > 0 ? pennies : null;
}

export function settlementCashDelta(record, amount) {
    return Number(record.vatOwed) > 0 ? -Number(amount) : Number(record.vatOwed) < 0 ? Number(amount) : 0;
}

export function eligibleVatAccount(account) {
    return account.isActive === true && (account.currency || 'GBP').toUpperCase() === 'GBP'
        && !account.isPot && !/\bpot\b/i.test(`${account.accountName || ''} ${account.name || ''} ${account.accountType || ''}`);
}

export function eligibleVatTransaction(transaction, account, record) {
    return eligibleVatAccount(account) && Number.isSafeInteger(Number(transaction.id)) && Number(transaction.id) > 0
        && Number(transaction.bankAccountId) === Number(account.id)
        && transaction.direction === (Number(record.vatOwed) > 0 ? 'Out' : 'In')
        && !transaction.isInternalTransfer && !/internal transfer|pot transfer|\bpot\b/i.test(`${transaction.category || ''} ${transaction.description || ''} ${transaction.transactionType || ''}`)
        && /\bhmrc\b|HM REVENUE|HMRCVAT/i.test(`${transaction.description || ''} ${transaction.reference || ''} ${transaction.counterparty || ''}`)
        && amountPennies(Math.abs(Number(transaction.amount))) !== null
        && (!transaction.isReconciled || Number(transaction.id) === Number(record.settlementBankTransactionId));
}

export function overlappingVatReturns(record, records) {
    return records.filter(other => other.id !== record.id
        && new Date(other.quarterStartDate).getTime() <= new Date(record.quarterEndDate).getTime()
        && new Date(other.quarterEndDate).getTime() >= new Date(record.quarterStartDate).getTime());
}

export function filingDateForEdit(original, input) {
    return !input || input === original?.slice(0, 10) ? original : new Date(`${input}T00:00:00Z`).toISOString();
}

export function validateVatSettlement(record, values, { account, transaction, overlaps = [], today = todayDate() } = {}) {
    if (!settlementAction(record)) return 'This return does not require a new settlement.';
    const pennies = amountPennies(values.amount);
    if (pennies === null) return 'Enter a positive GBP amount in whole pennies.';
    if (!validSettlementDate(values.settlementDate, today)) return 'Enter a valid settlement date from 2000 up to today.';
    if (pennies !== Math.round(Math.abs(Number(record.vatOwed)) * 100) && !values.differenceReason?.trim()) return 'Enter a reason for the difference from the filed amount.';
    if (values.bankTransactionId != null) {
        if (!transaction || Number(transaction.id) !== Number(values.bankTransactionId) || !account || !eligibleVatTransaction(transaction, account, record)) return 'Select an eligible HMRC bank transaction.';
        if (amountPennies(Math.abs(Number(transaction.amount))) !== pennies || transaction.transactionDate?.slice(0, 10) !== values.settlementDate) return 'Amount and date must match the selected bank transaction.';
    } else if (!values.statementConfirmed) return 'Confirm that you checked the actual bank statement.';
    if (overlaps.length && !values.overlapConfirmed) return 'Review the overlapping returns and confirm this cash movement belongs to this return.';
    if (!values.confirmed) return 'Confirm the actual cash settlement.';
    return null;
}