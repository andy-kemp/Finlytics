import React, { useState } from 'react';
import { getBankAccounts, getPotBalances, recordPotBalances } from '../services/apiService';
import { todayDate, validSettlementDate } from '../utils/vatSettlement.mjs';

export default function PotBalancePanel({ accountId, snapshot, onSaved }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [account, setAccount] = useState(accountId);
    const [values, setValues] = useState({ vatPotBalance: '', ctPotBalance: '', asOfDate: todayDate(), reference: '' });
    const begin = async () => {
        setOpen(true);
        setBusy(true);
        setError('');
        try {
            let id = accountId;
            if (!id) {
                const accounts = (await getBankAccounts()).filter(item => item.isActive && item.currency === 'GBP');
                if (accounts.length !== 1) throw new Error('Select a single active GBP main account before recording pots.');
                id = accounts[0].id;
            }
            setAccount(id);
            const latest = snapshot || await getPotBalances(id);
            setValues({ vatPotBalance: latest?.vatPotBalance ?? '', ctPotBalance: latest?.ctPotBalance ?? '', asOfDate: todayDate(), reference: '' });
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    const save = async event => {
        event.preventDefault();
        if (busy) return;
        const validAmount = value => /^\d+(\.\d{1,2})?$/.test(String(value)) && Number.isSafeInteger(Math.round(Number(value) * 100));
        if (!account || !validAmount(values.vatPotBalance) || !validAmount(values.ctPotBalance) || !validSettlementDate(values.asOfDate) || !values.reference.trim()) {
            setError('Enter actual GBP balances, a valid date and a statement reference.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await recordPotBalances(account, { ...values, vatPotBalance: Number(values.vatPotBalance), ctPotBalance: Number(values.ctPotBalance) });
            setOpen(false);
            await onSaved?.(result);
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    return <section style={{ padding: '0.75rem 0', borderTop: '1px solid #cbd5e1' }} aria-label="Actual pot balances">
        <button type="button" className="btn-secondary" onClick={begin} disabled={busy}>Record Actual Pot Balances</button>
        {open && <form onSubmit={save} style={{ marginTop: '0.75rem' }}>
            <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0, display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <label className="form-group">VAT pot (GBP)<input type="number" min="0" step="0.01" required value={values.vatPotBalance} onChange={event => setValues({ ...values, vatPotBalance: event.target.value })} /></label>
                <label className="form-group">CT pot (GBP)<input type="number" min="0" step="0.01" required value={values.ctPotBalance} onChange={event => setValues({ ...values, ctPotBalance: event.target.value })} /></label>
                <label className="form-group">Balance date<input type="date" min="2000-01-01" max={todayDate()} required value={values.asOfDate} onChange={event => setValues({ ...values, asOfDate: event.target.value })} /></label>
                <label className="form-group">Statement / interest reference<input required maxLength={250} value={values.reference} onChange={event => setValues({ ...values, reference: event.target.value })} /></label>
            </fieldset>
            <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem', flexWrap: 'wrap' }}><button className="btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save Pot Snapshot'}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
        </form>}
        {error && <div role="alert" style={{ marginTop: 8, color: '#b91c1c', overflowWrap: 'anywhere' }}>{error}</div>}
    </section>;
}