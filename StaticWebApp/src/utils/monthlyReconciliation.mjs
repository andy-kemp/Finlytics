const pennies = value => Math.round(Number(value || 0) * 100);
const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const day = value => String(value || '').substring(0, 10);
const daysBetween = (left, right) => Math.abs(new Date(day(left)) - new Date(day(right))) / 86400000;

export const LINK_TYPES = ['Invoice', 'Expense', 'DLA-Payment', 'CompanyLedger'];
const MANUAL_CATEGORIES = new Set(['Internal Transfer', 'Dividends', 'VAT Payment', 'VAT Refund', 'DLA Payment', 'Tax / HMRC', 'Transfer - Review']);
const CATEGORY_MAP = {
    equipment: 'Equipment', supplies: 'Equipment', shopping: 'Equipment', software: 'Software', bills: 'Software',
    travel: 'Travel', transport: 'Travel', meals: 'Subsistence', eatingout: 'Subsistence', groceries: 'Subsistence'
};

export function defaultCtTag(category) {
    return category === 'Client Entertainment' || category === 'Client Gifts' ? 'NonCT' : 'Revenue';
}

function merchantWords(transaction) {
    return [transaction.monzoMerchantName, String(transaction.description || '').split(' - ')[0]]
        .map(normalized).filter(word => word.length >= 3);
}

function merchantMatches(transaction, receipt) {
    const vendor = normalized(receipt.vendor);
    if (vendor.length < 3) return false;
    return merchantWords(transaction).some(word => vendor.includes(word) || word.includes(vendor)
        || (word.length >= 5 && vendor.length >= 5 && word.substring(0, 5) === vendor.substring(0, 5)));
}

export function receiptAmountMatches(transaction, receipt) {
    if (receipt.total == null) return false;
    const currency = String(receipt.currency || 'GBP').toUpperCase();
    if (currency === 'GBP') return !transaction.originalCurrency || transaction.originalCurrency === 'GBP'
        ? pennies(receipt.total) === pennies(transaction.amount) : false;
    return transaction.originalCurrency === currency && transaction.originalAmount != null
        && pennies(receipt.total) === pennies(Math.abs(transaction.originalAmount));
}

export function scoreReceipt(transaction, receipt) {
    if (!receiptAmountMatches(transaction, receipt)) return 0;
    const days = receipt.documentDate ? daysBetween(receipt.documentDate, transaction.transactionDate) : null;
    if (days != null && !(days <= 10)) return 0;
    const merchant = merchantMatches(transaction, receipt);
    if (days == null && !merchant) return 0;
    return 100 - (days ?? 5) * 3 + (merchant ? 30 : 0);
}

function defaultCategory(transaction, categories) {
    const mapped = CATEGORY_MAP[normalized(transaction.category)];
    if (mapped && (!categories.length || categories.includes(mapped))) return mapped;
    return categories.includes('Other') || !categories.length ? 'Other' : categories[0];
}

export function suggestedVat(transaction, receipt) {
    if (!receipt || transaction.originalCurrency && transaction.originalCurrency !== 'GBP') return 0;
    if (String(receipt.currency || 'GBP').toUpperCase() !== 'GBP' || !(Number(receipt.tax) > 0)) return 0;
    return pennies(receipt.tax) <= Math.round(pennies(transaction.amount) / 6) ? pennies(receipt.tax) / 100 : 0;
}

export function buildMonthlyProposals({ transactions, comparisons = [], existing = [], inbox = [], baselineDate = null, categories = [] }) {
    const reconciled = new Set(existing.filter(row => row.isReconciled)
        .flatMap(row => [row.externalId, row.monzoTransactionId]).filter(Boolean));
    const proposals = transactions.map((transaction, index) => {
        const base = { index, externalId: transaction.externalId || null, transaction };
        if (!transaction.externalId) return { ...base, kind: 'review', reason: 'No statement transaction ID' };
        if (reconciled.has(transaction.externalId)) return { ...base, kind: 'done', reason: 'Already reconciled' };
        if (transaction.category === 'Internal Transfer') return { ...base, kind: 'internal', reason: 'Pot transfer' };
        const comparison = comparisons[index];
        const candidates = (comparison?.candidates || []).filter(candidate => LINK_TYPES.includes(candidate.type));
        if (comparison?.status === 'Suggested match' && candidates.length === 1) {
            const [candidate] = candidates;
            return { ...base, kind: 'link', relatedType: candidate.type, relatedId: String(candidate.id), label: candidate.label };
        }
        if (transaction.direction !== 'Out' || MANUAL_CATEGORIES.has(transaction.category)
            || (comparison && comparison.status !== 'Missing app payment')) {
            return { ...base, kind: 'review', reason: comparison?.status || 'Needs manual review' };
        }
        if (baselineDate && day(transaction.transactionDate) <= baselineDate) {
            return { ...base, kind: 'blocked', reason: `On or before the ${baselineDate} cash baseline` };
        }
        const category = defaultCategory(transaction, categories);
        return {
            ...base, kind: 'expense', receipt: null,
            supplier: transaction.monzoMerchantName || String(transaction.description || '').split(' - ')[0] || 'Unknown supplier',
            category, ctTag: defaultCtTag(category), vatAmount: 0
        };
    });

    const pairs = [];
    proposals.filter(proposal => proposal.kind === 'expense').forEach(proposal => inbox.forEach(receipt => {
        const score = scoreReceipt(proposal.transaction, receipt);
        if (score > 0) pairs.push({ proposal, receipt, score });
    }));
    pairs.sort((left, right) => right.score - left.score);
    const usedReceipts = new Set();
    for (const { proposal, receipt } of pairs) {
        if (proposal.receipt || usedReceipts.has(receipt.name)) continue;
        usedReceipts.add(receipt.name);
        proposal.receipt = receipt;
        if (receipt.vendor) proposal.supplier = receipt.vendor;
        proposal.vatAmount = suggestedVat(proposal.transaction, receipt);
    }
    return proposals.map(proposal => ({ ...proposal, selected: proposal.kind === 'link' || proposal.kind === 'expense' }));
}

export function selectPaymentForReview(proposals, bankTransactionId) {
    const requested = proposals.find(proposal => String(proposal.transaction.id) === String(bankTransactionId));
    if (!requested) throw new Error('This bank payment is no longer awaiting review.');
    if (requested.kind === 'done' || requested.kind === 'internal' || requested.kind === 'blocked')
        throw new Error(requested.reason || 'This bank payment cannot be recorded again.');
    return proposals.map(proposal => ({ ...proposal,
        selected: proposal === requested && (proposal.kind === 'expense' || proposal.kind === 'link') }));
}

export function buildMonthlyApplyRequest(bankAccountId, proposals) {
    const actions = proposals.filter(proposal => proposal.selected && (proposal.kind === 'link' || proposal.kind === 'expense'))
        .map(proposal => proposal.kind === 'link'
            ? { externalId: proposal.externalId, action: 'link', relatedType: proposal.relatedType, relatedId: proposal.relatedId }
            : {
                externalId: proposal.externalId, action: 'createExpense', supplier: String(proposal.supplier || '').trim(),
                category: proposal.category, ctTag: proposal.ctTag, vatAmount: Math.round(Number(proposal.vatAmount || 0) * 100) / 100,
                receiptBlob: proposal.receipt?.name ?? null
            });
    return { bankAccountId, actions };
}
