import React, { useEffect, useRef, useState } from 'react';
import { estimateGbp, fetchDailyGbpRate } from '../utils/foreignCurrency.mjs';
import { applyCurrencyConversion, currencyValidation, rateLookupIsCurrent, updateCurrencyFields } from '../utils/foreignCurrencyForm.mjs';
import './ForeignCurrencyFields.css';

export default function ForeignCurrencyFields({ value, onChange, invoiceDate, paymentDate, disabled = false, preserveAccounting = false, confirmed = false }) {
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [rateDay, setRateDay] = useState('');
    const [rateMode, setRateMode] = useState('invoice');
    const currency = value.originalCurrency || 'GBP';
    const foreign = currency !== 'GBP';
    const day = rateMode === 'manual' ? rateDay : rateMode === 'payment' ? paymentDate : invoiceDate || paymentDate;
    const context = JSON.stringify([currency, day, invoiceDate, paymentDate, disabled]);
    const latest = useRef({ id: 0, context });
    if (latest.current.context !== context) latest.current.id += 1;
    latest.current = { ...latest.current, context, currency, day, disabled };
    useEffect(() => () => { latest.current = { ...latest.current, id: latest.current.id + 1, disabled: true }; }, []);
    const patch = change => {
        latest.current.id += 1;
        onChange(updateCurrencyFields(value, change, { preserveAccounting }));
        setError('');
    };
    const estimate = amount => {
        if (amount !== '' && amount != null && Number(amount) === 0 && Number(value.exchangeRateToGbp) > 0) return '0.00';
        try { return estimateGbp(amount, value.exchangeRateToGbp).toFixed(2); }
        catch { return ''; }
    };
    const fetchRate = async () => {
        const request = { ...latest.current, id: ++latest.current.id };
        setLoading(true);
        setError('');
        try {
            const result = await fetchDailyGbpRate(request.currency, request.day);
            if (rateLookupIsCurrent(request, latest.current)) {
                patch({ exchangeRateToGbp: result.rate, exchangeRateDate: result.date, exchangeRateSource: result.source });
            }
        } catch (failure) { if (rateLookupIsCurrent(request, latest.current)) setError(failure.message); }
        finally { setLoading(false); }
    };
    const apply = () => {
        try { patch(applyCurrencyConversion(value)); setError(''); }
        catch (failure) { setError(failure.message); }
    };
    const field = (name, label, type = 'number', required = false) => (
        <label className="form-group">
            <span>{label}</span>
            <input type={type} min={type === 'number' ? '0' : undefined} step={type === 'number' ? (name === 'exchangeRateToGbp' ? 'any' : '0.01') : undefined}
                value={value[name] == null ? '' : type === 'date' ? String(value[name]).slice(0, 10) : value[name]}
                onChange={event => patch({ [name]: event.target.value, ...(name === 'exchangeRateToGbp' ? { exchangeRateSource: 'Manual verified rate' } : {}) })}
                required={required} disabled={disabled || loading || (confirmed && ['originalAmountGross', 'actualGbpPaid', 'settlementDate'].includes(name))} />
        </label>
    );
    return (
        <div className="foreign-currency-fields">
            <label className="form-group"><span>Invoice currency</span>
                <select value={value.unsupportedScanCurrency ? '' : currency} disabled={disabled || loading || confirmed} onChange={event => patch({ originalCurrency: event.target.value })}>
                    {value.unsupportedScanCurrency && <option value="" disabled>Unsupported: {value.unsupportedScanCurrency}</option>}
                    {['GBP', 'EUR', 'USD'].map(code => <option key={code}>{code}</option>)}
                </select>
            </label>
            {value.unsupportedScanCurrency && <div className="currency-error" role="alert">{currencyValidation(value)}</div>}
            {value.conversionPending && <div className="currency-status" role="status">Conversion pending</div>}
            {!foreign && value.conversionPending && <button type="button" className="btn-secondary" disabled={disabled || loading} onClick={apply}>Confirm verified GBP amounts</button>}
            {!foreign && error && <div className="currency-error" role="alert">{error}</div>}
            {foreign && <>
                {field('originalAmountNet', `Original net (${currency})`, 'number', true)}
                {field('originalVatAmount', `Original invoice tax (${currency})`, 'number', true)}
                {field('originalAmountGross', `Original gross (${currency})`, 'number', true)}
                <label className="form-group"><span>Rate lookup day</span><input type="date" value={day || ''} disabled={disabled || loading} onChange={event => { setRateDay(event.target.value); setRateMode('manual'); }} /></label>
                <div className="currency-actions">
                    <button type="button" className="btn-secondary" disabled={disabled || loading || !invoiceDate} onClick={() => setRateMode('invoice')}>Invoice date</button>
                    <button type="button" className="btn-secondary" disabled={disabled || loading || !paymentDate} onClick={() => setRateMode('payment')}>Payment date</button>
                    <button type="button" className="btn-secondary" disabled={disabled || loading} onClick={fetchRate}>{loading ? 'Fetching rate...' : 'Fetch published rate'}</button>
                </div>
                {field('exchangeRateToGbp', `GBP per 1 ${currency}`, 'number', true)}
                {field('exchangeRateDate', 'Published / verified rate date', 'date', true)}
                {field('exchangeRateSource', 'Rate source', 'text', true)}
                <label className="form-group"><span>Estimated original net (GBP)</span><output>{estimate(value.originalAmountNet) || 'Pending rate'}</output></label>
                <label className="form-group"><span>Estimated gross (GBP)</span><output>{estimate(value.originalAmountGross) || 'Pending rate'}</output></label>
                {field('vatAmount', 'UK VAT to record (GBP)', 'number', true)}
                <div className="currency-actions"><button type="button" className="btn-secondary" disabled={disabled || loading || !!currencyValidation(value, { allowPending: true })} onClick={apply}>Apply conversion to GBP amounts</button></div>
                {field('actualGbpPaid', 'Actual GBP paid')}
                {field('settlementDate', 'Settlement date', 'date')}
                <div className="currency-status" role="status">{value.actualGbpPaid != null && value.actualGbpPaid !== '' ? 'Actual payment recorded' : 'Estimate - pending month-end statement review'}</div>
                {value.settlementBankTransactionId != null && <div className="currency-status">Bank transaction: {value.settlementBankTransactionId}</div>}
                {error && <div className="currency-error" role="alert">{error}</div>}
            </>}
        </div>
    );
}

export function ForeignCurrencySummary({ value }) {
    if (!value.originalCurrency || value.originalCurrency === 'GBP') return null;
    const money = amount => amount == null || amount === '' ? 'Pending' : Number(amount).toFixed(2);
    return <dl className="currency-summary">
        <div><dt>Original net ({value.originalCurrency})</dt><dd>{money(value.originalAmountNet)}</dd></div>
        <div><dt>Original invoice tax ({value.originalCurrency})</dt><dd>{money(value.originalVatAmount)}</dd></div>
        <div><dt>Original gross ({value.originalCurrency})</dt><dd>{money(value.originalAmountGross)}</dd></div>
        <div><dt>Estimated gross (GBP)</dt><dd>{money(value.estimatedGbpGross)}</dd></div>
        <div><dt>Actual GBP paid</dt><dd>{money(value.actualGbpPaid)}</dd></div>
        <div><dt>GBP rate / date</dt><dd>{value.exchangeRateToGbp || 'Pending'} / {String(value.exchangeRateDate || '').slice(0, 10) || 'Pending'}</dd></div>
        <div><dt>Rate source</dt><dd>{value.exchangeRateSource || 'Pending'}</dd></div>
        <div><dt>Settlement date</dt><dd>{String(value.settlementDate || '').slice(0, 10) || 'Pending'}</dd></div>
        <div><dt>Statement review</dt><dd>{value.actualGbpPaid != null ? 'Actual payment recorded' : 'Estimate - pending month-end statement review'}</dd></div>
    </dl>;
}