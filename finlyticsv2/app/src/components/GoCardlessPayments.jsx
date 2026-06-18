import React, { useEffect, useState, useCallback } from 'react';
import {
    getGoCardlessMandates, createGoCardlessMandate, getGoCardlessMandateStatus,
    getGoCardlessPayments, collectGoCardlessPayment, createGoCardlessPaymentLink,
    getCustomers, getInvoices
} from '../services/apiService';

export default function GoCardlessPayments() {
    const [tab, setTab] = useState('mandates');
    const [mandates, setMandates] = useState([]);
    const [payments, setPayments] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [toast, setToast] = useState(null);

    // ── Mandate creation ──
    const [showMandateForm, setShowMandateForm] = useState(false);
    const [mandateCustomerId, setMandateCustomerId] = useState('');

    // ── Payment collection ──
    const [showCollectForm, setShowCollectForm] = useState(false);
    const [collectInvoiceId, setCollectInvoiceId] = useState('');

    const showToast = useCallback((msg, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 4000);
    }, []);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [m, p, c, inv] = await Promise.all([
                getGoCardlessMandates().catch(() => []),
                getGoCardlessPayments().catch(() => []),
                getCustomers().catch(() => []),
                getInvoices().catch(() => [])
            ]);
            setMandates(m);
            setPayments(p);
            setCustomers(c);
            setInvoices(inv);
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
    }

    // ── Mandate Handlers ──
    const handleCreateMandate = async (e) => {
        e.preventDefault();
        if (!mandateCustomerId) return;
        setProcessing(true);
        try {
            const result = await createGoCardlessMandate(mandateCustomerId);
            if (result.authorisationUrl) {
                window.open(result.authorisationUrl, '_blank');
                showToast('Mandate authorisation link opened — customer must approve');
            } else {
                showToast('Mandate created');
            }
            setShowMandateForm(false);
            setMandateCustomerId('');
            await loadData();
        } catch (err) {
            showToast(err.message, false);
        } finally {
            setProcessing(false);
        }
    };

    const handleCheckMandateStatus = async (customerId) => {
        try {
            const result = await getGoCardlessMandateStatus(customerId);
            showToast(`Mandate status: ${result.status || 'unknown'}`);
            await loadData();
        } catch (err) {
            showToast(err.message, false);
        }
    };

    // ── Payment Handlers ──
    const handleCollectPayment = async (e) => {
        e.preventDefault();
        if (!collectInvoiceId) return;
        setProcessing(true);
        try {
            await collectGoCardlessPayment(parseInt(collectInvoiceId));
            showToast('Direct Debit payment initiated');
            setShowCollectForm(false);
            setCollectInvoiceId('');
            await loadData();
        } catch (err) {
            showToast(err.message, false);
        } finally {
            setProcessing(false);
        }
    };

    const handleCreatePayLink = async (invoiceId) => {
        setProcessing(true);
        try {
            const result = await createGoCardlessPaymentLink(invoiceId);
            if (result.paymentLink) {
                navigator.clipboard?.writeText(result.paymentLink);
                showToast('Payment link created & copied to clipboard');
            } else {
                showToast('Payment link created');
            }
            await loadData();
        } catch (err) {
            showToast(err.message, false);
        } finally {
            setProcessing(false);
        }
    };

    const tabStyle = (t) => ({
        padding: '0.5rem 1.25rem', fontWeight: 600, fontSize: '0.875rem',
        border: 'none', borderBottom: tab === t ? '3px solid #2563eb' : '3px solid transparent',
        background: 'none', color: tab === t ? '#2563eb' : '#6b7280',
        cursor: 'pointer'
    });

    const statusBadge = (status) => {
        const colors = {
            active: '#15803d', pending_customer_approval: '#d97706', pending_submission: '#d97706',
            submitted: '#2563eb', confirmed: '#15803d', paid_out: '#15803d',
            failed: '#dc2626', cancelled: '#6b7280'
        };
        const bg = {
            active: '#f0fdf4', pending_customer_approval: '#fffbeb', pending_submission: '#fffbeb',
            submitted: '#eff6ff', confirmed: '#f0fdf4', paid_out: '#f0fdf4',
            failed: '#fef2f2', cancelled: '#f9fafb'
        };
        const s = (status || 'unknown').toLowerCase();
        return (
            <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                fontSize: '0.75rem', fontWeight: 600,
                color: colors[s] || '#374151', background: bg[s] || '#f3f4f6'
            }}>
                {status || 'Unknown'}
            </span>
        );
    };

    // Filter invoices that are unpaid and eligible for payment collection
    const unpaidInvoices = invoices.filter(i =>
        i.status !== 'Paid' && i.status !== 'Cancelled' && i.status !== 'Draft'
    );

    return (
        <div className="content-container">
            <div className="section-header">
                <h2>GoCardless Payments</h2>
            </div>

            {toast && (
                <div style={{
                    background: toast.ok ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${toast.ok ? '#bbf7d0' : '#fca5a5'}`,
                    borderRadius: 8, padding: '0.6rem 1rem', marginBottom: '1rem',
                    color: toast.ok ? '#15803d' : '#dc2626',
                    fontWeight: 500, fontSize: '0.875rem'
                }}>
                    {toast.ok ? '✓' : '✗'} {toast.msg}
                </div>
            )}

            {/* ── Tabs ── */}
            <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem', display: 'flex', gap: '0.25rem' }}>
                <button style={tabStyle('mandates')} onClick={() => setTab('mandates')}>Direct Debit Mandates</button>
                <button style={tabStyle('payments')} onClick={() => setTab('payments')}>Payments</button>
                <button style={tabStyle('collect')} onClick={() => setTab('collect')}>Collect / Pay Links</button>
            </div>

            {loading ? <div className="loading">Loading...</div> : (
                <>
                    {/* ── Mandates Tab ── */}
                    {tab === 'mandates' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h3 style={{ margin: 0 }}>Customer DD Mandates</h3>
                                <button className="btn-primary" onClick={() => setShowMandateForm(true)} disabled={processing}>
                                    + New Mandate
                                </button>
                            </div>

                            {showMandateForm && (
                                <div className="form-card" style={{ marginBottom: '1rem' }}>
                                    <h4>Create Direct Debit Mandate</h4>
                                    <form onSubmit={handleCreateMandate}>
                                        <div className="form-group">
                                            <label>Customer</label>
                                            <select value={mandateCustomerId} onChange={e => setMandateCustomerId(e.target.value)} required>
                                                <option value="">Select customer...</option>
                                                {customers.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name || c.customerName}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="form-actions">
                                            <button type="submit" className="btn-primary" disabled={processing}>
                                                {processing ? 'Creating...' : 'Create Mandate'}
                                            </button>
                                            <button type="button" className="btn-secondary" onClick={() => setShowMandateForm(false)}>Cancel</button>
                                        </div>
                                    </form>
                                </div>
                            )}

                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Customer</th>
                                            <th>Scheme</th>
                                            <th>Reference</th>
                                            <th>Status</th>
                                            <th>Bank Account</th>
                                            <th>Created</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mandates.length === 0 ? (
                                            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af' }}>No mandates yet</td></tr>
                                        ) : mandates.map(m => (
                                            <tr key={m.id}>
                                                <td>{m.customerName}</td>
                                                <td>{m.scheme || 'BACS'}</td>
                                                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{m.reference || '—'}</td>
                                                <td>{statusBadge(m.status)}</td>
                                                <td>
                                                    {m.bankAccountHolder ? `${m.bankAccountHolder} (****${m.bankAccountEndDigits || ''})` : '—'}
                                                </td>
                                                <td>{m.createdDate ? new Date(m.createdDate).toLocaleDateString('en-GB') : '—'}</td>
                                                <td>
                                                    <button className="btn-secondary" style={{ fontSize: '0.75rem' }}
                                                        onClick={() => handleCheckMandateStatus(m.customerId)}>
                                                        Check Status
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ── Payments Tab ── */}
                    {tab === 'payments' && (
                        <div>
                            <h3>GoCardless Payments</h3>
                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Invoice</th>
                                            <th>Amount</th>
                                            <th>Status</th>
                                            <th>Charge Date</th>
                                            <th>Paid Out</th>
                                            <th>Description</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payments.length === 0 ? (
                                            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af' }}>No payments yet</td></tr>
                                        ) : payments.map(p => (
                                            <tr key={p.id}>
                                                <td>{p.invoiceNumber || `#${p.invoiceId}`}</td>
                                                <td style={{ fontWeight: 600 }}>£{parseFloat(p.amount || 0).toFixed(2)}</td>
                                                <td>{statusBadge(p.status)}</td>
                                                <td>{p.chargeDate ? new Date(p.chargeDate).toLocaleDateString('en-GB') : '—'}</td>
                                                <td>{p.paidOutDate ? new Date(p.paidOutDate).toLocaleDateString('en-GB') : '—'}</td>
                                                <td style={{ fontSize: '0.8rem', color: '#6b7280' }}>{p.description || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ── Collect / Pay Links Tab ── */}
                    {tab === 'collect' && (
                        <div>
                            <h3>Collect Payment or Create Pay Link</h3>
                            <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
                                <strong>Collect via DD</strong>: Charge an unpaid invoice against the customer's active mandate (1% + 20p, capped at £2).<br/>
                                <strong>Instant Bank Pay</strong>: Generate a one-time payment link for the customer to pay via their bank app.
                            </p>

                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Invoice #</th>
                                            <th>Customer</th>
                                            <th>Amount</th>
                                            <th>Status</th>
                                            <th>Payment Link</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {unpaidInvoices.length === 0 ? (
                                            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af' }}>No unpaid invoices</td></tr>
                                        ) : unpaidInvoices.map(inv => (
                                            <tr key={inv.id}>
                                                <td>{inv.invoiceNumber}</td>
                                                <td>{inv.customerName}</td>
                                                <td style={{ fontWeight: 600 }}>£{parseFloat(inv.total || inv.totalGross || 0).toFixed(2)}</td>
                                                <td>{statusBadge(inv.status)}</td>
                                                <td>
                                                    {inv.paymentLink ? (
                                                        <a href={inv.paymentLink} target="_blank" rel="noopener noreferrer"
                                                            style={{ fontSize: '0.8rem', color: '#2563eb' }}>
                                                            Open Link
                                                        </a>
                                                    ) : '—'}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                        <button
                                                            className="btn-primary"
                                                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                                                            disabled={processing}
                                                            onClick={async () => {
                                                                setProcessing(true);
                                                                try {
                                                                    await collectGoCardlessPayment(inv.id);
                                                                    showToast('DD payment initiated');
                                                                    await loadData();
                                                                } catch (e) { showToast(e.message, false); }
                                                                finally { setProcessing(false); }
                                                            }}
                                                        >
                                                            💳 Collect DD
                                                        </button>
                                                        <button
                                                            className="btn-secondary"
                                                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                                                            disabled={processing}
                                                            onClick={() => handleCreatePayLink(inv.id)}
                                                        >
                                                            🔗 Pay Link
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
