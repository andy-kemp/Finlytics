import React, { useState, useEffect } from 'react';
import {
    getCreditNotes, createCreditNote, sendCreditNoteEmail,
    applyCreditNote, voidCreditNote, deleteCreditNote, getCreditNotePdfUrl,
    getCustomers, getInvoices, getCompanySettings
} from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';

const REASON_CATEGORIES = ['Overpayment', 'Duplicate', 'Correction', 'Goodwill', 'ServiceIssue', 'Other'];

const STATUS_COLOURS = {
    Draft:   { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
    Issued:  { bg: '#fffbeb', text: '#b45309', border: '#fcd34d' },
    Applied: { bg: '#f0fdf4', text: '#15803d', border: '#86efac' },
    Voided:  { bg: '#fef2f2', text: '#b91c1c', border: '#fca5a5' },
};

function statusBadge(status) {
    const c = STATUS_COLOURS[status] || STATUS_COLOURS.Draft;
    return (
        <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '0.75rem',
            fontWeight: 600, background: c.bg, color: c.text, border: `1px solid ${c.border}`
        }}>{status}</span>
    );
}

function fmt(n) {
    return `£${(n ?? 0).toFixed(2)}`;
}

export default function CreditNotes() {
    const [creditNotes, setCreditNotes] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [companySettings, setCompanySettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [applyModal, setApplyModal] = useState(null);   // { creditNote }
    const [confirmModal, setConfirmModal] = useState(null);
    const { toast, showToast, clearToast } = useToast();

    const emptyForm = () => ({
        customerId: '',
        customerName: '',
        customerEmail: '',
        originalInvoiceId: '',
        originalInvoiceNumber: '',
        reason: '',
        reasonCategory: 'Correction',
        amountNet: '',
        vatRate: 20,
        vatAmount: '',
        amountGross: '',
        currency: 'GBP',
        dateIssued: new Date().toISOString().split('T')[0],
        expiryDate: '',
        notes: '',
    });

    const [form, setForm] = useState(emptyForm());

    useEffect(() => {
        load();
    }, []);

    const load = async () => {
        try {
            const [cn, cu, inv, cs] = await Promise.all([
                getCreditNotes(),
                getCustomers(),
                getInvoices(),
                getCompanySettings(),
            ]);
            setCreditNotes(cn);
            setCustomers(cu);
            setInvoices(inv);
            setCompanySettings(cs);
        } catch (e) {
            showToast('Failed to load credit notes', 'error');
        } finally {
            setLoading(false);
        }
    };

    // ── Form helpers ────────────────────────────────────────────────────────

    const handleCustomerChange = (e) => {
        const cId = e.target.value;
        const c = customers.find(x => String(x.id) === String(cId) || x.customerId === cId);
        setForm(f => ({
            ...f,
            customerId: cId,
            customerName: c ? (c.companyName || c.name || '') : '',
            customerEmail: c ? (c.email || c.billingEmail || '') : '',
            originalInvoiceId: '',
            originalInvoiceNumber: '',
        }));
    };

    const handleInvoiceChange = (e) => {
        const invId = e.target.value;
        const inv = invoices.find(x => String(x.id) === String(invId));
        if (inv) {
            setForm(f => ({
                ...f,
                originalInvoiceId: invId,
                originalInvoiceNumber: inv.invoiceNumber || '',
                amountGross: String(inv.amountGross ?? ''),
                amountNet: String(inv.amountNet ?? inv.amountGross ?? ''),
                vatAmount: String(inv.vatAmount ?? 0),
                vatRate: inv.vatRate ?? 20,
            }));
        } else {
            setForm(f => ({ ...f, originalInvoiceId: '', originalInvoiceNumber: '' }));
        }
    };

    const recalc = (field, value) => {
        setForm(f => {
            const next = { ...f, [field]: value };
            const net  = parseFloat(next.amountNet)   || 0;
            const rate = parseFloat(next.vatRate)      || 0;
            const vat  = parseFloat(next.vatAmount)    || 0;
            if (field === 'amountNet' || field === 'vatRate') {
                const calcVat   = parseFloat(((net * rate) / 100).toFixed(2));
                next.vatAmount  = String(calcVat);
                next.amountGross = String(parseFloat((net + calcVat).toFixed(2)));
            } else if (field === 'vatAmount') {
                next.amountGross = String(parseFloat((net + vat).toFixed(2)));
            } else if (field === 'amountGross') {
                const gross = parseFloat(value) || 0;
                const calcNet = parseFloat((gross / (1 + rate / 100)).toFixed(2));
                const calcVat = parseFloat((gross - calcNet).toFixed(2));
                next.amountNet  = String(calcNet);
                next.vatAmount  = String(calcVat);
            }
            return next;
        });
    };

    // ── Submit ───────────────────────────────────────────────────────────────

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.customerName.trim() || !form.reason.trim()) {
            showToast('Customer and Reason are required', 'error');
            return;
        }
        setProcessing(true);
        try {
            const payload = {
                customerId: form.customerId || null,
                customerName: form.customerName,
                customerEmail: form.customerEmail,
                originalInvoiceId: form.originalInvoiceId ? parseInt(form.originalInvoiceId) : null,
                originalInvoiceNumber: form.originalInvoiceNumber || null,
                reason: form.reason,
                reasonCategory: form.reasonCategory,
                amountNet: parseFloat(form.amountNet) || 0,
                vatRate: parseFloat(form.vatRate) || 0,
                vatAmount: parseFloat(form.vatAmount) || 0,
                amountGross: parseFloat(form.amountGross) || 0,
                currency: form.currency || 'GBP',
                dateIssued: form.dateIssued ? new Date(form.dateIssued).toISOString() : null,
                expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : null,
                notes: form.notes || null,
            };
            await createCreditNote(payload);
            showToast('Credit note created and issued', 'success');
            setShowForm(false);
            setForm(emptyForm());
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to create credit note', 'error');
        } finally {
            setProcessing(false);
        }
    };

    // ── Actions ──────────────────────────────────────────────────────────────

    const handleSend = async (cn) => {
        setProcessing(true);
        try {
            await sendCreditNoteEmail(cn.id);
            showToast(`Credit note emailed to ${cn.customerEmail}`, 'success');
        } catch (err) {
            showToast(err.message || 'Failed to send email', 'error');
        } finally {
            setProcessing(false);
        }
    };

    const handleApplyConfirm = async (invoiceId) => {
        const cn = applyModal;
        setApplyModal(null);
        setProcessing(true);
        try {
            await applyCreditNote(cn.id, invoiceId || null);
            showToast('Credit note applied', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to apply credit note', 'error');
        } finally {
            setProcessing(false);
        }
    };

    const handleVoid = async (cn) => {
        setConfirmModal({
            title: 'Void Credit Note',
            message: `Void credit note ${cn.creditNoteNumber}? This cannot be undone.`,
            onConfirm: async () => {
                setConfirmModal(null);
                setProcessing(true);
                try {
                    await voidCreditNote(cn.id);
                    showToast('Credit note voided', 'success');
                    await load();
                } catch (err) {
                    showToast(err.message || 'Failed to void', 'error');
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const handleDelete = async (cn) => {
        setConfirmModal({
            title: 'Delete Credit Note',
            message: `Permanently delete ${cn.creditNoteNumber}? This cannot be undone.`,
            onConfirm: async () => {
                setConfirmModal(null);
                setProcessing(true);
                try {
                    await deleteCreditNote(cn.id);
                    showToast('Deleted', 'success');
                    await load();
                } catch (err) {
                    showToast(err.message || 'Failed to delete', 'error');
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    // ── Customer's open invoices for Apply modal ─────────────────────────────

    const customerInvoices = (customerId) =>
        invoices.filter(inv =>
            String(inv.customerId) === String(customerId) &&
            inv.status !== 'Paid' && inv.status !== 'Cancelled'
        );

    // ── Render ───────────────────────────────────────────────────────────────

    if (loading) return <div style={{ padding: '2rem', opacity: 0.6 }}>Loading credit notes…</div>;

    return (
        <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
            <Toast toast={toast} onClose={clearToast} />

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>🔴 Credit Notes</h1>
                    <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                        {creditNotes.length} credit note{creditNotes.length !== 1 ? 's' : ''}
                        {' · '}
                        {creditNotes.filter(c => c.status === 'Issued').length} outstanding
                    </p>
                </div>
                <button
                    onClick={() => { setForm(emptyForm()); setShowForm(true); }}
                    style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem' }}
                >
                    + New Credit Note
                </button>
            </div>

            {/* New Credit Note Form */}
            {showForm && (
                <div style={{ background: '#fff', border: '1px solid #fca5a5', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 2px 8px rgba(220,38,38,0.08)' }}>
                    <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', fontWeight: 700, color: '#dc2626' }}>New Credit Note</h2>
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>

                            {/* Customer */}
                            <label style={labelStyle}>
                                Customer *
                                <select value={form.customerId} onChange={handleCustomerChange} style={inputStyle} required={!form.customerName}>
                                    <option value="">— select —</option>
                                    {customers.map(c => (
                                        <option key={c.id || c.customerId} value={c.id || c.customerId}>
                                            {c.companyName || c.name || c.customerName}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            {/* Customer name (editable fallback) */}
                            <label style={labelStyle}>
                                Customer Name *
                                <input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} style={inputStyle} required />
                            </label>

                            {/* Customer email */}
                            <label style={labelStyle}>
                                Customer Email
                                <input type="email" value={form.customerEmail} onChange={e => setForm(f => ({ ...f, customerEmail: e.target.value }))} style={inputStyle} />
                            </label>

                            {/* Original invoice */}
                            <label style={labelStyle}>
                                Original Invoice
                                <select value={form.originalInvoiceId} onChange={handleInvoiceChange} style={inputStyle}>
                                    <option value="">— none —</option>
                                    {(form.customerId
                                        ? invoices.filter(i => String(i.customerId) === String(form.customerId))
                                        : invoices
                                    ).map(inv => (
                                        <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {fmt(inv.amountGross)}</option>
                                    ))}
                                </select>
                            </label>

                            {/* Date issued */}
                            <label style={labelStyle}>
                                Date Issued
                                <input type="date" value={form.dateIssued} onChange={e => setForm(f => ({ ...f, dateIssued: e.target.value }))} style={inputStyle} />
                            </label>

                            {/* Expiry date */}
                            <label style={labelStyle}>
                                Expiry Date
                                <input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} style={inputStyle} />
                            </label>

                            {/* Reason category */}
                            <label style={labelStyle}>
                                Category
                                <select value={form.reasonCategory} onChange={e => setForm(f => ({ ...f, reasonCategory: e.target.value }))} style={inputStyle}>
                                    {REASON_CATEGORIES.map(rc => <option key={rc}>{rc}</option>)}
                                </select>
                            </label>
                        </div>

                        {/* Reason — full width */}
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '1rem' }}>
                            Reason *
                            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                                style={{ ...inputStyle, height: '70px', resize: 'vertical' }} required />
                        </label>

                        {/* Amounts */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                            <label style={labelStyle}>
                                Net Amount (£)
                                <input type="number" step="0.01" min="0" value={form.amountNet}
                                    onChange={e => recalc('amountNet', e.target.value)} style={inputStyle} />
                            </label>
                            <label style={labelStyle}>
                                VAT Rate (%)
                                <input type="number" step="1" min="0" max="100" value={form.vatRate}
                                    onChange={e => recalc('vatRate', e.target.value)} style={inputStyle} />
                            </label>
                            <label style={labelStyle}>
                                VAT Amount (£)
                                <input type="number" step="0.01" min="0" value={form.vatAmount}
                                    onChange={e => recalc('vatAmount', e.target.value)} style={inputStyle} />
                            </label>
                            <label style={labelStyle}>
                                Gross Total (£) *
                                <input type="number" step="0.01" min="0.01" value={form.amountGross}
                                    onChange={e => recalc('amountGross', e.target.value)} style={inputStyle} required />
                            </label>
                        </div>

                        {/* Notes */}
                        <label style={{ ...labelStyle, display: 'block', marginBottom: '1.25rem' }}>
                            Internal Notes
                            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                style={{ ...inputStyle, height: '60px', resize: 'vertical' }} />
                        </label>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button type="submit" disabled={processing}
                                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.6rem 1.5rem', fontWeight: 600, cursor: processing ? 'not-allowed' : 'pointer' }}>
                                {processing ? 'Saving…' : 'Issue Credit Note'}
                            </button>
                            <button type="button" onClick={() => setShowForm(false)}
                                style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '8px', padding: '0.6rem 1rem', cursor: 'pointer' }}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Table */}
            {creditNotes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔴</div>
                    <p style={{ margin: 0 }}>No credit notes yet</p>
                </div>
            ) : (
                <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ background: '#fef2f2', borderBottom: '2px solid #fca5a5' }}>
                                    {['Number', 'Customer', 'Original Invoice', 'Amount', 'Status', 'Date Issued', 'Applied To', 'Actions'].map(h => (
                                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#dc2626', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {creditNotes.map((cn, i) => (
                                    <tr key={cn.id} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                                        <td style={cellStyle}>
                                            <strong style={{ color: '#dc2626' }}>{cn.creditNoteNumber}</strong>
                                        </td>
                                        <td style={cellStyle}>
                                            <div style={{ fontWeight: 500 }}>{cn.customerName}</div>
                                            {cn.customerEmail && <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{cn.customerEmail}</div>}
                                        </td>
                                        <td style={cellStyle}>{cn.originalInvoiceNumber || '—'}</td>
                                        <td style={{ ...cellStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(cn.amountGross)}</td>
                                        <td style={cellStyle}>{statusBadge(cn.status)}</td>
                                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{cn.dateIssued ? new Date(cn.dateIssued).toLocaleDateString('en-GB') : '—'}</td>
                                        <td style={cellStyle}>{cn.appliedToInvoiceNumber || '—'}</td>
                                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                {/* View PDF */}
                                                <a href={getCreditNotePdfUrl(cn.id)} target="_blank" rel="noreferrer"
                                                    style={btnStyle('#f3f4f6', '#374151')}>
                                                    📄
                                                </a>

                                                {/* Send email */}
                                                {cn.status === 'Issued' && cn.customerEmail && (
                                                    <button onClick={() => handleSend(cn)} disabled={processing}
                                                        title="Email to customer"
                                                        style={btnStyle('#eff6ff', '#1d4ed8')}>
                                                        ✉️
                                                    </button>
                                                )}

                                                {/* Apply */}
                                                {cn.status === 'Issued' && (
                                                    <button onClick={() => setApplyModal(cn)} disabled={processing}
                                                        title="Apply to invoice"
                                                        style={btnStyle('#f0fdf4', '#15803d')}>
                                                        ✅
                                                    </button>
                                                )}

                                                {/* Void */}
                                                {(cn.status === 'Draft' || cn.status === 'Issued') && (
                                                    <button onClick={() => handleVoid(cn)} disabled={processing}
                                                        title="Void"
                                                        style={btnStyle('#fffbeb', '#b45309')}>
                                                        🚫
                                                    </button>
                                                )}

                                                {/* Delete */}
                                                {cn.status !== 'Applied' && (
                                                    <button onClick={() => handleDelete(cn)} disabled={processing}
                                                        title="Delete"
                                                        style={btnStyle('#fef2f2', '#b91c1c')}>
                                                        🗑
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Apply Modal */}
            {applyModal && (
                <ApplyModal
                    creditNote={applyModal}
                    invoices={customerInvoices(applyModal.customerId)}
                    onConfirm={handleApplyConfirm}
                    onClose={() => setApplyModal(null)}
                />
            )}

            {/* Confirm Modal */}
            {confirmModal && (
                <ConfirmDeleteModal
                    title={confirmModal.title}
                    message={confirmModal.message}
                    onConfirm={confirmModal.onConfirm}
                    onCancel={() => setConfirmModal(null)}
                />
            )}
        </div>
    );
}

// ── Apply Modal ──────────────────────────────────────────────────────────────

function ApplyModal({ creditNote, invoices, onConfirm, onClose }) {
    const [selectedInvoiceId, setSelectedInvoiceId] = useState('');

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '440px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                <h3 style={{ margin: '0 0 0.25rem', fontWeight: 700 }}>Apply Credit Note</h3>
                <p style={{ margin: '0 0 1.25rem', color: '#6b7280', fontSize: '0.875rem' }}>
                    Applying <strong>{creditNote.creditNoteNumber}</strong> ({`£${(creditNote.amountGross ?? 0).toFixed(2)}`})
                </p>

                {invoices.length > 0 ? (
                    <label style={labelStyle}>
                        Apply against invoice (optional)
                        <select value={selectedInvoiceId} onChange={e => setSelectedInvoiceId(e.target.value)} style={inputStyle}>
                            <option value="">— mark as applied (no specific invoice) —</option>
                            {invoices.map(inv => (
                                <option key={inv.id} value={inv.id}>
                                    {inv.invoiceNumber} — £{(inv.amountGross ?? 0).toFixed(2)} ({inv.status})
                                </option>
                            ))}
                        </select>
                    </label>
                ) : (
                    <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '1rem' }}>
                        No open invoices for this customer. The credit note will be marked as applied.
                    </p>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                    <button
                        onClick={() => onConfirm(selectedInvoiceId ? parseInt(selectedInvoiceId) : null)}
                        style={{ background: '#15803d', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.6rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}>
                        Apply
                    </button>
                    <button onClick={onClose}
                        style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '8px', padding: '0.6rem 1rem', cursor: 'pointer' }}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Shared styles ────────────────────────────────────────────────────────────

const labelStyle = {
    display: 'flex', flexDirection: 'column', gap: '0.25rem',
    fontSize: '0.8rem', fontWeight: 600, color: '#374151'
};

const inputStyle = {
    padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db',
    fontSize: '0.875rem', background: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box'
};

const cellStyle = { padding: '0.75rem 1rem', verticalAlign: 'middle' };

function btnStyle(bg, color) {
    return {
        background: bg, color, border: 'none', borderRadius: '6px',
        padding: '0.3rem 0.55rem', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1
    };
}
