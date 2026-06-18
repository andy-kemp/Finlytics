import { useState, useEffect } from 'react';
import { getCustomers, quickInvoice } from '../services/apiService';

export default function QuickInvoice({ onClose, onCreated }) {
    const [customers, setCustomers] = useState([]);
    const [customerId, setCustomerId] = useState('');
    const [days, setDays] = useState('');
    const [description, setDescription] = useState('');
    const [rate, setRate] = useState('');
    const [vatRate, setVatRate] = useState(20);
    const [sendEmail, setSendEmail] = useState(true);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        getCustomers().then(c => setCustomers(c || [])).catch(() => {});
    }, []);

    const selectedCustomer = customers.find(c => c.id === customerId);

    // Auto-fill rate when customer changes
    useEffect(() => {
        if (selectedCustomer?.defaultDayRate) {
            setRate(selectedCustomer.defaultDayRate);
        }
    }, [customerId]);

    const effectiveRate = parseFloat(rate) || 0;
    const effectiveDays = parseFloat(days) || 0;
    const amountNet = effectiveDays * effectiveRate;
    const vatAmount = Math.round(amountNet * vatRate / 100 * 100) / 100;
    const amountGross = amountNet + vatAmount;

    const canSubmit = customerId && effectiveDays > 0 && effectiveRate > 0 && !loading;

    const handleSubmit = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await quickInvoice({
                customerId,
                days: effectiveDays,
                description: description || undefined,
                rate: effectiveRate,
                vatRate,
                sendEmail
            });
            setResult(res);
            onCreated && onCreated(res);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const fmt = (v) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0);

    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={onClose}
        >
            <div
                style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', maxWidth: 520, width: '95%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h3 style={{ margin: 0, fontSize: '1.15rem' }}>⚡ Quick Invoice</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6c757d' }}>×</button>
                </div>

                {result ? (
                    <div>
                        <div style={{ background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
                            <div style={{ fontWeight: 600, color: '#155724', fontSize: '1rem', marginBottom: 4 }}>
                                ✅ Invoice {result.invoice?.invoiceNumber} created!
                            </div>
                            <div style={{ fontSize: '0.9rem', color: '#155724' }}>
                                {fmt(result.invoice?.amountGross)} for {result.invoice?.customerName}
                            </div>
                            {result.emailSent && (
                                <div style={{ fontSize: '0.85rem', color: '#155724', marginTop: 4 }}>
                                    📧 Email sent to {result.invoice?.billingEmail}
                                </div>
                            )}
                            {result.emailError && (
                                <div style={{ fontSize: '0.85rem', color: '#856404', marginTop: 4 }}>
                                    ⚠️ Email failed: {result.emailError}
                                </div>
                            )}
                            {result.pdfUrl && (
                                <div style={{ marginTop: 8 }}>
                                    <a href={result.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem' }}>
                                        📄 View PDF
                                    </a>
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" onClick={() => { setResult(null); setDays(''); setDescription(''); }}>
                                Create Another
                            </button>
                            <button className="btn-primary" onClick={onClose}>Done</button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Customer */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4, color: '#374151' }}>Customer</label>
                            <select
                                value={customerId}
                                onChange={e => setCustomerId(e.target.value)}
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem' }}
                            >
                                <option value="">Select customer…</option>
                                {customers.map(c => (
                                    <option key={c.id} value={c.id}>{c.name || c.customerName} {c.code ? `(${c.code})` : ''}</option>
                                ))}
                            </select>
                        </div>

                        {/* Days & Rate side by side */}
                        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4, color: '#374151' }}>Days</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    value={days}
                                    onChange={e => setDays(e.target.value)}
                                    placeholder="e.g. 20"
                                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem' }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4, color: '#374151' }}>
                                    Day Rate (£)
                                    {selectedCustomer?.defaultDayRate && <span style={{ fontWeight: 400, color: '#6c757d', fontSize: '0.78rem' }}> — default</span>}
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={rate}
                                    onChange={e => setRate(e.target.value)}
                                    placeholder="e.g. 500"
                                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem' }}
                                />
                            </div>
                        </div>

                        {/* VAT Rate */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4, color: '#374151' }}>VAT Rate (%)</label>
                            <select
                                value={vatRate}
                                onChange={e => setVatRate(parseInt(e.target.value))}
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem' }}
                            >
                                <option value={20}>20% (Standard)</option>
                                <option value={5}>5% (Reduced)</option>
                                <option value={0}>0% (Zero-rated / Exempt)</option>
                            </select>
                        </div>

                        {/* Description (optional) */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4, color: '#374151' }}>
                                Description <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '0.78rem' }}>— optional</span>
                            </label>
                            <input
                                type="text"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder={`Consultancy services — ${effectiveDays || '…'} days`}
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem' }}
                            />
                        </div>

                        {/* Send email toggle */}
                        <div style={{ marginBottom: 18 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
                                <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} />
                                <span>Send invoice email to customer</span>
                                {selectedCustomer && (
                                    <span style={{ color: '#6c757d', fontSize: '0.8rem' }}>
                                        ({selectedCustomer.billingEmail || selectedCustomer.email || 'no email'})
                                    </span>
                                )}
                            </label>
                        </div>

                        {/* Preview */}
                        {canSubmit && (
                            <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '12px 16px', marginBottom: 18, fontSize: '0.9rem' }}>
                                <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151' }}>Invoice Preview</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                    <span>{effectiveDays} day{effectiveDays !== 1 ? 's' : ''} × {fmt(effectiveRate)}</span>
                                    <span>{fmt(amountNet)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, color: '#6c757d' }}>
                                    <span>VAT ({vatRate}%)</span>
                                    <span>{fmt(vatAmount)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #dee2e6', paddingTop: 6, marginTop: 4 }}>
                                    <span>Total</span>
                                    <span>{fmt(amountGross)}</span>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div style={{ background: '#f8d7da', color: '#721c24', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>
                                {error}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
                            <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
                                {loading ? 'Creating…' : sendEmail ? '⚡ Generate & Send' : '⚡ Generate Invoice'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
