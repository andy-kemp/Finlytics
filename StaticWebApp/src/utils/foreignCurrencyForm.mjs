import { estimateGbp, resolveInvoiceCurrency } from './foreignCurrency.mjs';

export const currencyFields = ['originalCurrency', 'originalAmountNet', 'originalVatAmount', 'originalAmountGross', 'exchangeRateToGbp', 'exchangeRateDate', 'exchangeRateSource', 'estimatedGbpGross', 'actualGbpPaid', 'settlementDate', 'settlementBankTransactionId'];
const numericFields = ['originalAmountNet', 'originalVatAmount', 'originalAmountGross', 'exchangeRateToGbp', 'estimatedGbpGross', 'actualGbpPaid'];

export function currencyMetadata(row = {}) {
    return Object.fromEntries(currencyFields.map(field => {
        const value = row[field] ?? row[field[0].toUpperCase() + field.slice(1)];
        return [field, field === 'originalCurrency' ? (value || 'GBP') : (value ?? null)];
    }));
}

export function currencyPayload(row) {
    const metadata = currencyMetadata(row);
    for (const field of numericFields) {
        metadata[field] = metadata[field] === '' || metadata[field] == null ? null : Number(metadata[field]);
    }
    for (const field of ['exchangeRateDate', 'settlementDate']) {
        metadata[field] = metadata[field] ? String(metadata[field]).slice(0, 10) : null;
    }
    return metadata;
}

const isAmount = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0;

export function changeInvoiceCurrency(row, currency, { preserveAccounting = false } = {}) {
    if (currency === (row.originalCurrency || 'GBP') && !row.unsupportedScanCurrency) return {};
    return {
        ...currencyMetadata(), originalCurrency: currency, currencyExplicit: true,
        unsupportedScanCurrency: null, conversionPending: true,
        originalAmountNet: '', originalVatAmount: '', originalAmountGross: '',
        ...(preserveAccounting ? {} : { amountNet: '', vatAmount: '', amountGross: '' })
    };
}

export function updateCurrencyFields(row, change, { preserveAccounting = false } = {}) {
    if ('originalCurrency' in change) return changeInvoiceCurrency(row, change.originalCurrency, { preserveAccounting });
    const conversionFields = ['originalAmountNet', 'originalVatAmount', 'originalAmountGross', 'exchangeRateToGbp', 'exchangeRateDate', 'exchangeRateSource', 'amountNet', 'vatAmount', 'amountGross', 'vatExempt'];
    if ((row.originalCurrency || 'GBP') !== 'GBP' && conversionFields.some(field => field in change)) {
        return {
            ...(preserveAccounting ? {} : { amountNet: '', amountGross: '' }),
            estimatedGbpGross: null, conversionPending: true, ...change
        };
    }
    return change;
}

export function rateLookupIsCurrent(request, current) {
    return !current.disabled && request.id === current.id && request.currency === current.currency && request.day === current.day;
}

export function currencyValidation(row, { allowPending = false } = {}) {
    if (row.unsupportedScanCurrency) return `Unsupported invoice currency ${row.unsupportedScanCurrency}. Enter a supported conversion manually.`;
    if (row.conversionPending && !allowPending) return 'Apply conversion or confirm verified GBP amounts before saving.';
    const currency = row.originalCurrency || 'GBP';
    if (!['GBP', 'EUR', 'USD'].includes(currency)) return 'Select GBP, EUR or USD.';
    const actual = row.actualGbpPaid != null && row.actualGbpPaid !== '';
    if (actual && !isAmount(row.actualGbpPaid)) return 'Actual GBP paid must be a non-negative amount.';
    if (actual && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.settlementDate || '').slice(0, 10))) return 'Enter a settlement date for the actual GBP payment.';
    if (!actual && row.settlementDate) return 'Enter the actual GBP payment for the settlement date.';
    if (currency === 'GBP') return '';
    if (!['originalAmountNet', 'originalVatAmount', 'originalAmountGross'].every(field => isAmount(row[field])) || !(Number(row.originalAmountGross) > 0)) {
        return 'Enter the original invoice net, tax and gross amounts.';
    }
    if (Math.abs(Number(row.originalAmountNet) + Number(row.originalVatAmount) - Number(row.originalAmountGross)) > 0.011) return 'Original net plus invoice tax must equal original gross.';
    if (!(Number(row.exchangeRateToGbp) > 0) || !Number.isFinite(Number(row.exchangeRateToGbp)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.exchangeRateDate || '').slice(0, 10)) || !row.exchangeRateSource?.trim()) return 'Enter a positive verified GBP rate, rate date and source.';
    if (row.actualGbpPaid != null && row.actualGbpPaid !== '' && !isAmount(row.actualGbpPaid)) return 'Actual GBP paid must be a non-negative amount.';
    return '';
}

export function applyCurrencyConversion(row, ukVat = row.vatAmount) {
    const error = currencyValidation(row, { allowPending: true });
    if (error) throw new Error(error);
    if ((row.originalCurrency || 'GBP') === 'GBP') {
        if (!['amountNet', 'vatAmount', 'amountGross'].every(field => isAmount(row[field])) || !(Number(row.amountGross) > 0) || Math.abs(Number(row.amountNet) + Number(row.vatAmount) - Number(row.amountGross)) > 0.011) {
            throw new Error('Enter verified GBP net, VAT and gross amounts that balance.');
        }
        return { conversionPending: false };
    }
    if (!isAmount(ukVat)) throw new Error('Enter the UK VAT amount explicitly, including zero where appropriate.');
    const gross = estimateGbp(row.originalAmountGross, row.exchangeRateToGbp);
    const vat = Number(ukVat);
    if (vat > gross) throw new Error('UK VAT cannot exceed converted gross.');
    return { amountNet: (gross - vat).toFixed(2), vatAmount: vat.toFixed(2), amountGross: gross.toFixed(2), estimatedGbpGross: gross, conversionPending: false };
}

export function scannedCurrencyAmounts(scan, amounts, supplierCurrency = 'GBP') {
    const explicit = String(scan.currency ?? '').trim().toUpperCase();
    if (explicit && !['GBP', 'EUR', 'USD'].includes(explicit)) {
        return {
            ...currencyMetadata(), originalCurrency: 'GBP', unsupportedScanCurrency: explicit,
            amountNet: '', vatAmount: '', amountGross: '',
            originalAmountNet: '', originalVatAmount: '', originalAmountGross: ''
        };
    }
    const originalCurrency = resolveInvoiceCurrency(scan.currency, supplierCurrency);
    const originals = {
        originalCurrency,
        originalAmountNet: amounts.originalAmountNet ?? amounts.amountNet ?? '',
        originalVatAmount: amounts.originalVatAmount ?? amounts.vatAmount ?? '',
        originalAmountGross: amounts.originalAmountGross ?? amounts.amountGross ?? ''
    };
    if (originalCurrency === 'GBP') return { ...amounts, ...originals };
    return {
        ...originals,
        conversionPending: true,
        amountNet: '', vatAmount: '', amountGross: ''
    };
}