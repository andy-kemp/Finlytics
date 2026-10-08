import React, { useEffect, useRef, useState } from 'react';
import { confirmVatSettlement, getBankAccounts, getBankTransactionsByAccount } from '../services/apiService';
import { amountPennies, eligibleVatAccount, eligibleVatTransaction, formatGbp, isVatSettled, settlementAction, settlementCashDelta, settlementStatus, todayDate, validateVatSettlement } from '../utils/vatSettlement.mjs';

export function SettlementSummary({ record }) {
    const labels = { AwaitingPayment: 'Awaiting Payment', AwaitingRefund: 'Awaiting Refund', NoSettlementRequired: 'No Settlement Required', Paid: 'Paid', RefundReceived: 'Refund Received' };
    return <div style={{ fontSize: '0.82rem', marginTop: 6, overflowWrap: 'anywhere' }}>
        <strong>{labels[settlementStatus(record)] || settlementStatus(record)}</strong>
        {isVatSettled(record) && <>
            {record.settlementAmount != null && <div>{formatGbp(record.settlementAmount)}</div>}
            {record.settlementDate && <div>{new Date(`${record.settlementDate.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB')}</div>}
            {record.settlementReference && <div>{record.settlementReference}</div>}
        </>}
    </div>;
}

export default function VatSettlementModal({ record, overlaps = [], onClose, onSuccess }) {
    const [values, setValues] = useState({ amount: Math.abs(Number(record.vatOwed)).toFixed(2), settlementDate: todayDate(), bankTransactionId: null, reference: '', differenceReason: '', statementConfirmed: false, overlapConfirmed: false, confirmed: false });
    const [accounts, setAccounts] = useState([]);
    const [accountId, setAccountId] = useState('');
    const [transactions, setTransactions] = useState([]);
    const [bankLoading, setBankLoading] = useState(true);
    const [bankError, setBankError] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const locked = useRef(false);
    const dialogRef = useRef(null);
    const action = settlementAction(record);
    const account = accounts.find(item => String(item.id) === accountId);
    const transaction = transactions.find(item => Number(item.id) === values.bankTransactionId);
    const candidates = account ? transactions.filter(item => eligibleVatTransaction(item, account, record)) : [];
    const difference = ((amountPennies(values.amount) || 0) - Math.round(Math.abs(Number(record.vatOwed)) * 100)) / 100;
    const validation = validateVatSettlement(record, values, { account, transaction, overlaps });

    useEffect(() => {
        let active = true;
        getBankAccounts().then(data => { if (active) setAccounts(data.filter(eligibleVatAccount)); })
            .catch(err => { if (active) setBankError(err.message); })
            .finally(() => { if (active) setBankLoading(false); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!accountId) return;
        let active = true;
        setBankLoading(true);
        setBankError('');
        getBankTransactionsByAccount(Number(accountId)).then(data => { if (active) setTransactions(data); })
            .catch(err => { if (active) setBankError(err.message); })
            .finally(() => { if (active) setBankLoading(false); });
        return () => { active = false; };
    }, [accountId]);

    useEffect(() => {
        const previousFocus = document.activeElement;
        dialogRef.current?.focus();
        return () => previousFocus?.focus();
    }, []);

    const change = patch => setValues(current => ({ ...current, ...patch, confirmed: false, statementConfirmed: false, overlapConfirmed: false }));
    const close = () => { if (!locked.current) onClose(); };
    const submit = async event => {
        event.preventDefault();
        if (locked.current) return;
        if (validation) { setError(validation); return; }
        locked.current = true;
        setBusy(true);
        setError('');
        try {
            await confirmVatSettlement(record.id, {
                amount: amountPennies(values.amount) / 100,
                settlementDate: values.settlementDate,
                bankTransactionId: values.bankTransactionId,
                reference: values.reference.trim(),
                differenceReason: values.differenceReason.trim()
            });
            setSaved(true);
        } catch (err) {
            setError(err.message || 'Settlement could not be confirmed.');
            locked.current = false;
            setBusy(false);
            return;
        }
        try {
            await onSuccess();
        } catch (err) {
            setError(`Settlement saved, but returns could not be refreshed: ${err.message}`);
            setBusy(false);
        }
    };
    const refresh = async () => {
        setBusy(true);
        try { await onSuccess(); } catch (err) { setError(`Settlement saved, but returns could not be refreshed: ${err.message}`); setBusy(false); }
    };
    const keyboard = event => {
        if (event.key === 'Escape') close();
        if (event.key !== 'Tab') return;
        const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
    };

    return <div className="modal-overlay" onClick={close} style={{ padding: 12, zIndex: 1000 }}>
        <div className="modal-content" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="vat-settlement-title" onKeyDown={keyboard} onClick={event => event.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', borderRadius: 8 }}>
            <div className="modal-header" style={{ gap: 12 }}>
                <h2 id="vat-settlement-title" style={{ fontSize: '1.15rem', margin: 0, overflowWrap: 'anywhere' }}>{Number(record.vatOwed) > 0 ? 'Actual Cash Out' : 'Actual Cash In'} - {record.quarterLabel}</h2>
                <button type="button" className="modal-close" aria-label="Close settlement" disabled={busy || saved} onClick={close}>X</button>
            </div>
            <form onSubmit={submit}>
                <fieldset disabled={busy || saved} style={{ border: 0, padding: '16px 20px', margin: 0, minWidth: 0 }}>
                    <div style={{ display: 'grid', gap: 6, marginBottom: 16, fontSize: '0.9rem' }}>
                        <div>Filed amount: <strong>{formatGbp(Math.abs(Number(record.vatOwed)))}</strong></div>
                        <div>Actual cash {Number(record.vatOwed) > 0 ? 'out' : 'in'}: <strong>{formatGbp((amountPennies(values.amount) || 0) / 100)}</strong></div>
                        <div>Cash balance change: <strong>{formatGbp(settlementCashDelta(record, (amountPennies(values.amount) || 0) / 100))}</strong></div>
                        <div>Difference: <strong>{formatGbp(difference)}</strong></div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="vat-bank-account">Bank account (optional)</label>
                        <select id="vat-bank-account" className="form-control" value={accountId} onChange={event => { setAccountId(event.target.value); setTransactions([]); change({ bankTransactionId: null }); }}>
                            <option value="">Manual statement confirmation</option>
                            {accounts.map(item => <option key={item.id} value={item.id}>{item.accountName || item.name || `Account ${item.id}`}</option>)}
                        </select>
                    </div>
                    {bankLoading && <p role="status">Loading bank records...</p>}
                    {bankError && <p role="alert" style={{ color: '#b02a37', overflowWrap: 'anywhere' }}>{bankError}</p>}
                    {account && <div className="form-group">
                        <label htmlFor="vat-bank-transaction">HMRC transaction (optional)</label>
                        <select id="vat-bank-transaction" className="form-control" disabled={bankLoading} value={values.bankTransactionId ?? ''} onChange={event => {
                            const selected = candidates.find(item => String(item.id) === event.target.value);
                            change(selected ? { bankTransactionId: Number(selected.id), amount: Math.abs(Number(selected.amount)).toFixed(2), settlementDate: selected.transactionDate?.slice(0, 10) || '' } : { bankTransactionId: null });
                        }}>
                            <option value="">Manual statement confirmation</option>
                            {candidates.map(item => <option key={item.id} value={item.id}>{item.transactionDate?.slice(0, 10)} | {item.description || item.reference} | {formatGbp(Math.abs(Number(item.amount)))}</option>)}
                        </select>
                        {!bankLoading && candidates.length === 0 && <p>No eligible HMRC transactions.</p>}
                    </div>}
                    <div className="form-group">
                        <label htmlFor="vat-actual-amount">Actual amount (GBP)</label>
                        <input id="vat-actual-amount" className="form-control" type="number" min="0.01" step="0.01" required readOnly={values.bankTransactionId != null} value={values.amount} onChange={event => change({ amount: event.target.value })} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="vat-settlement-date">Actual settlement date</label>
                        <input id="vat-settlement-date" className="form-control" type="date" min="2000-01-01" max={todayDate()} required readOnly={values.bankTransactionId != null} value={values.settlementDate} onChange={event => change({ settlementDate: event.target.value })} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="vat-settlement-reference">Reference (optional)</label>
                        <input id="vat-settlement-reference" className="form-control" value={values.reference} onChange={event => change({ reference: event.target.value })} />
                    </div>
                    {difference !== 0 && <div className="form-group">
                        <label htmlFor="vat-difference-reason">Reason for difference</label>
                        <textarea id="vat-difference-reason" className="form-control" rows={2} required value={values.differenceReason} onChange={event => change({ differenceReason: event.target.value })} />
                    </div>}
                    {overlaps.length > 0 && <div role="alert" style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: 12, marginBottom: 14, color: '#664d03', overflowWrap: 'anywhere' }}>
                        <strong>Warning: overlapping filed returns</strong>
                        {overlaps.map(item => <div key={item.id}>{item.quarterLabel} (#{item.id}) | {item.quarterStartDate?.slice(0, 10)} to {item.quarterEndDate?.slice(0, 10)} | {formatGbp(item.vatOwed)}</div>)}
                        <label style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={values.overlapConfirmed} onChange={event => setValues(current => ({ ...current, overlapConfirmed: event.target.checked }))} />I reviewed the overlapping returns and verified this cash movement belongs to return #{record.id}, not another return.</label>
                    </div>}
                    {values.bankTransactionId == null && <label style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-start' }}><input type="checkbox" checked={values.statementConfirmed} onChange={event => setValues(current => ({ ...current, statementConfirmed: event.target.checked }))} />I checked the actual bank statement and verified this amount and date.</label>}
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={values.confirmed} onChange={event => setValues(current => ({ ...current, confirmed: event.target.checked }))} />I confirm this HMRC {Number(record.vatOwed) > 0 ? 'payment was made' : 'refund was received'} for return #{record.id}.</label>
                </fieldset>
                {error && <p role="alert" style={{ margin: '0 20px 16px', color: '#b02a37', overflowWrap: 'anywhere' }}>{error}</p>}
                <div className="modal-footer" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" className="btn-secondary" disabled={busy || saved} onClick={close}>Cancel</button>
                    {saved ? <button type="button" className="btn-primary" disabled={busy} onClick={refresh}>{busy ? 'Refreshing...' : 'Refresh Returns'}</button> : <button type="submit" className="btn-primary" disabled={busy || !!validation}>{busy ? 'Confirming...' : action || 'No Settlement Required'}</button>}
                </div>
            </form>
        </div>
    </div>;
}