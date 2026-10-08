export const SUPPORTED_CURRENCIES = ['GBP', 'EUR', 'USD'];

export function resolveInvoiceCurrency(invoiceCurrency, supplierCurrency = 'GBP') {
    const explicit = String(invoiceCurrency || '').trim().toUpperCase();
    if (SUPPORTED_CURRENCIES.includes(explicit)) return explicit;
    const fallback = String(supplierCurrency || 'GBP').trim().toUpperCase();
    return SUPPORTED_CURRENCIES.includes(fallback) ? fallback : 'GBP';
}

export function estimateGbp(originalAmount, exchangeRate) {
    const amount = Number(originalAmount);
    const rate = Number(exchangeRate);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) {
        throw new Error('A positive original amount and GBP exchange rate are required.');
    }
    return Math.round(amount * rate * 100) / 100;
}

export function buildSettlementProposal({ originalCurrency, originalAmountGross, estimatedGbpGross }, transaction) {
    if (!SUPPORTED_CURRENCIES.includes(originalCurrency) || originalCurrency === 'GBP') return null;
    if (!(Number(originalAmountGross) > 0) || !Number.isFinite(Number(originalAmountGross)) || estimatedGbpGross == null || !Number.isFinite(Number(estimatedGbpGross))) return null;
    if (transaction.direction !== 'Out' || !(Number(transaction.amount) > 0)) return null;
    if (transaction.originalCurrency && transaction.originalCurrency !== originalCurrency) return null;
    if (transaction.originalAmount != null && Math.round(Math.abs(transaction.originalAmount) * 100) !== Math.round(Number(originalAmountGross) * 100)) return null;
    const actualGbp = Math.round(Number(transaction.amount) * 100) / 100;
    return {
        actualGbp, exchangeRate: actualGbp / Number(originalAmountGross),
        variance: Math.round((actualGbp - Number(estimatedGbpGross)) * 100) / 100,
        paymentDate: transaction.transactionDate, bankTransactionId: transaction.id ?? null,
        externalId: transaction.externalId ?? null, requiresConfirmation: true
    };
}

export async function fetchDailyGbpRate(currency, date, fetcher = fetch) {
    if (!SUPPORTED_CURRENCIES.includes(currency)) throw new Error('Unsupported invoice currency.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('An exchange-rate date is required.');
    if (currency === 'GBP') return { rate: 1, date, source: 'GBP' };
    const response = await fetcher(`https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=GBP`);
    if (!response.ok) throw new Error('Exchange rate unavailable. Enter a verified rate manually.');
    const result = await response.json();
    const rate = Number(result.rates?.GBP);
    if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(result.date || '') || result.date > date) {
        throw new Error('Invalid exchange-rate response.');
    }
    return { rate, date: result.date, source: 'Frankfurter / ECB' };
}