import React, { useState, useEffect } from 'react';
import { getAuthHeaders, getEmployees } from '../services/apiService';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://finlyticsdevfunc.azurewebsites.net/api';
const TRIVIAL_BENEFIT_LIMIT = 6;
const AMOUNT_LIMIT = 50.00;

const BENEFIT_TYPES = [
    'Gift Card (Amazon)',
    'Gift Card (Shopping)',
    'Gift Card (Whisky)',
    'Gift Card (Restaurant)',
    'Gift Card (Other)',
    'Other',
];

function calculateTaxYear(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1-based
    if (month < 4 || (month === 4 && d.getDate() < 6)) {
        return `${year - 1}/${String(year).slice(2)}`;
    }
    return `${year}/${String(year + 1).slice(2)}`;
}

function calculateFinancialYear(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    if (month < 4 || (month === 4 && d.getDate() < 6)) {
        return `${year - 1}-${year}`;
    }
    return `${year}-${year + 1}`;
}

export default function TrivialBenefitModal({ directors = [], onClose, onSaved }) {
    const today = new Date().toISOString().split('T')[0];

    // Build recipients list: directors + employees (deduplicated)
    const [recipients, setRecipients] = useState([]);
    useEffect(() => {
        (async () => {
            let people = [...directors.map(d => ({ name: d, type: 'Director' }))];
            try {
                const employees = await getEmployees();
                for (const emp of (employees || [])) {
                    if (!emp.name || !emp.isActive) continue;
                    // Don't duplicate directors already in the list
                    if (!people.some(p => p.name.toLowerCase() === emp.name.toLowerCase())) {
                        people.push({ name: emp.name, type: emp.isDirector ? 'Director' : 'Employee' });
                    }
                }
            } catch { /* employees not available — directors-only fallback */ }
            setRecipients(people);
        })();
    }, [directors]);

    const [form, setForm] = useState({
        recipient: directors.length === 1 ? directors[0] : '',
        date: today,
        benefitType: '',
        description: '',
        amount: '',
        paymentMethod: 'Company Card', // Company Card → Expense | Personally Paid → DLA
        nonExchangeable: false,
        notes: '',
    });

    const [summary, setSummary] = useState(null);
    const [loadingSummary, setLoadingSummary] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const taxYear = calculateTaxYear(form.date);

    // Load trivial benefit summary for current tax year + selected recipient
    useEffect(() => {
        if (!taxYear) return;
        let cancelled = false;
        setLoadingSummary(true);
        (async () => {
            try {
                const headers = await getAuthHeaders();
                const qs = new URLSearchParams({ taxYear });
                if (form.recipient) qs.set('recipient', form.recipient);
                const res = await fetch(`${API_BASE}/trivialbenefits/summary?${qs}`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled) setSummary(data);
                }
            } catch { /* non-fatal */ }
            if (!cancelled) setLoadingSummary(false);
        })();
        return () => { cancelled = true; };
    }, [taxYear, form.recipient]);

    const amountVal = parseFloat(form.amount) || 0;
    const amountOverLimit = amountVal > AMOUNT_LIMIT;
    const atLimit = summary?.isAtLimit;
    const usedCount = summary?.count ?? '…';
    const selectedRecipientType = recipients.find(r => r.name === form.recipient)?.type;
    const isDirectorRecipient = selectedRecipientType === 'Director';
    const canSubmit = !amountOverLimit && !atLimit && form.nonExchangeable
        && form.recipient && form.benefitType && amountVal > 0 && form.description;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;

        setSaving(true);
        setError('');
        try {
            const headers = await getAuthHeaders();
            const currentTaxYear = calculateTaxYear(form.date);
            const currentFinancialYear = calculateFinancialYear(form.date);
            const grossAmount = parseFloat(form.amount);

            if (form.paymentMethod === 'Personally Paid' && isDirectorRecipient) {
                // → DLA entry (director paid personally, will reclaim from company)
                const payload = {
                    director: form.recipient,
                    direction: 'OwedToDirector',
                    description: form.description,
                    category: 'Trivial Benefit',
                    ctTag: 'Revenue',
                    amountNet: grossAmount,
                    vatAmount: 0,
                    amountGross: grossAmount,
                    entryDate: new Date(form.date).toISOString(),
                    datePaid: null,
                    paymentMethod: form.paymentMethod,
                    notes: form.notes || null,
                    taxYear: currentTaxYear,
                    financialYear: currentFinancialYear,
                    isStartupCost: false,
                    classificationSource: 'manual',
                    isTrivialBenefit: true,
                    trivialBenefitType: form.benefitType,
                    trivialBenefitRecipient: form.recipient,
                };
                const res = await fetch(`${API_BASE}/dla`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    const msg = await res.text();
                    throw new Error(msg || 'Failed to create DLA entry');
                }
            } else {
                // → Expense entry (company card, or employee personally paid)
                const payload = {
                    supplier: form.description,
                    category: 'Trivial Benefit',
                    ctTag: 'Revenue',
                    vatApplicability: 'Exempt',
                    vatIncluded: false,
                    amountNet: grossAmount,
                    vatAmount: 0,
                    amountGross: grossAmount,
                    datePaid: form.date,
                    paymentMethod: form.paymentMethod,
                    notes: `For: ${form.recipient} — ${form.benefitType}${form.notes ? ' — ' + form.notes : ''}`,
                    taxYear: currentTaxYear,
                    financialYear: currentFinancialYear,
                    isDLA: false,
                    isTrivialBenefit: true,
                    trivialBenefitType: form.benefitType,
                    trivialBenefitRecipient: form.recipient,
                };
                const res = await fetch(`${API_BASE}/expenses`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    const msg = await res.text();
                    throw new Error(msg || 'Failed to create expense');
                }
            }

            onSaved?.();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const usedColor = atLimit ? '#dc2626' : (usedCount >= 4 ? '#d97706' : '#16a34a');

    return (
        <div className="modal-overlay" onClick={() => !saving && onClose()}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                {/* Header */}
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ margin: 0 }}>🎁 Trivial Benefit</h2>
                        <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', opacity: 0.7 }}>
                            HMRC s.323 — max £{AMOUNT_LIMIT.toFixed(0)} per benefit, max {TRIVIAL_BENEFIT_LIMIT} per person per tax year
                        </p>
                    </div>
                    <button className="btn-close" onClick={onClose} disabled={saving}>✖</button>
                </div>

                {/* Per-recipient usage counter */}
                {form.recipient && (
                    <div style={{
                        margin: '0.75rem 1.25rem',
                        padding: '0.6rem 1rem',
                        borderRadius: 8,
                        background: atLimit ? '#fef2f2' : '#f0fdf4',
                        border: `1px solid ${usedColor}30`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                    }}>
                        <span style={{ fontSize: '1.5rem' }}>
                            {atLimit ? '🚫' : '🎁'}
                        </span>
                        <div>
                            <div style={{ fontWeight: 600, color: usedColor }}>
                                {loadingSummary ? '… / 6' : `${usedCount} / ${TRIVIAL_BENEFIT_LIMIT}`} used for {form.recipient} in {taxYear || '—'}
                            </div>
                            {atLimit
                                ? <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>Limit reached — no more trivial benefits for {form.recipient} this tax year.</div>
                                : <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{summary ? `${summary.remaining} remaining` : ''}</div>
                            }
                        </div>
                    </div>
                )}

                {/* Per-recipient breakdown if multiple people have benefits */}
                {summary?.byRecipient?.length > 0 && !form.recipient && (
                    <div style={{ margin: '0.5rem 1.25rem', fontSize: '0.85rem' }}>
                        <strong>Benefits by person ({taxYear}):</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.3rem' }}>
                            {summary.byRecipient.map(r => (
                                <span key={r.recipient} style={{
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: 4,
                                    background: r.isAtLimit ? '#fef2f2' : '#f0fdf4',
                                    border: `1px solid ${r.isAtLimit ? '#fecaca' : '#bbf7d0'}`,
                                    fontSize: '0.8rem',
                                }}>
                                    {r.recipient}: {r.count}/{TRIVIAL_BENEFIT_LIMIT}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ padding: '0 1.25rem 1.25rem' }}>
                    {/* Recipient (Director or Employee) */}
                    <div className="form-group">
                        <label>Recipient (Employee / Director) *</label>
                        {recipients.length > 0 ? (
                            <select value={form.recipient} onChange={e => setForm(p => ({ ...p, recipient: e.target.value }))} required>
                                <option value="">Select person…</option>
                                {recipients.map(r => (
                                    <option key={r.name} value={r.name}>
                                        {r.name} ({r.type})
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input type="text" value={form.recipient}
                                onChange={e => setForm(p => ({ ...p, recipient: e.target.value }))}
                                placeholder="Employee or director name" required />
                        )}
                    </div>

                    {/* Date */}
                    <div className="form-group">
                        <label>Date *</label>
                        <input type="date" value={form.date}
                            onChange={e => setForm(p => ({ ...p, date: e.target.value }))} required />
                    </div>

                    {/* Benefit type */}
                    <div className="form-group">
                        <label>Benefit Type *</label>
                        <select value={form.benefitType} onChange={e => setForm(p => ({ ...p, benefitType: e.target.value }))} required>
                            <option value="">Select type…</option>
                            {BENEFIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    {/* Description */}
                    <div className="form-group">
                        <label>Description *</label>
                        <input type="text" value={form.description}
                            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                            placeholder="e.g. Amazon Gift Card for birthday" required />
                    </div>

                    {/* Amount */}
                    <div className="form-group">
                        <label>Amount (£) *</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={form.amount}
                            onChange={e => {
                                const raw = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                                setForm(p => ({ ...p, amount: raw }));
                            }}
                            placeholder="0.00"
                            required
                        />
                        {amountOverLimit && (
                            <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                ⚠️ Amount cannot exceed £50.00 — the trivial benefit exemption would be void.
                            </div>
                        )}
                        {!amountOverLimit && amountVal >= 45 && amountVal > 0 && (
                            <div style={{ color: '#d97706', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                ⚠️ Approaching £50.00 limit — ensure this does not exceed £50.00 including any related costs.
                            </div>
                        )}
                    </div>

                    {/* How paid */}
                    <div className="form-group">
                        <label>How was this paid? *</label>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            {['Company Card', 'Personally Paid'].map(opt => (
                                <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontWeight: form.paymentMethod === opt ? 600 : 400 }}>
                                    <input type="radio" name="paymentMethod" value={opt}
                                        checked={form.paymentMethod === opt}
                                        onChange={() => setForm(p => ({ ...p, paymentMethod: opt }))} />
                                    {opt === 'Company Card'
                                        ? '💳 Company Card → saved as Expense'
                                        : isDirectorRecipient
                                            ? '👤 Personally Paid → saved as DLA'
                                            : '👤 Personally Paid → saved as Expense'}
                                </label>
                            ))}
                        </div>
                        {form.paymentMethod === 'Personally Paid' && !isDirectorRecipient && (
                            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                                Note: Employee-paid trivial benefits are recorded as expenses (DLA only applies to directors).
                            </div>
                        )}
                    </div>

                    {/* Notes */}
                    <div className="form-group">
                        <label>Notes</label>
                        <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                            rows={2} placeholder="Optional notes…" />
                    </div>

                    {/* Non-exchangeable declaration */}
                    <div className="form-group" style={{
                        background: form.nonExchangeable ? '#f0fdf4' : '#fef9ec',
                        border: `1px solid ${form.nonExchangeable ? '#bbf7d0' : '#fde68a'}`,
                        borderRadius: 8, padding: '0.75rem 1rem',
                    }}>
                        <label style={{ display: 'flex', gap: '0.6rem', cursor: 'pointer', alignItems: 'flex-start' }}>
                            <input type="checkbox" checked={form.nonExchangeable}
                                onChange={e => setForm(p => ({ ...p, nonExchangeable: e.target.checked }))}
                                style={{ marginTop: 2 }} />
                            <span style={{ fontSize: '0.88rem' }}>
                                <strong>I confirm this benefit cannot be exchanged for cash</strong> and is not a reward
                                for services or performance. (HMRC requirement for trivial benefit exemption.)
                            </span>
                        </label>
                    </div>

                    {error && (
                        <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '0.6rem 0.8rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn-primary" disabled={!canSubmit || saving || atLimit}>
                            {saving ? 'Saving…' : atLimit ? '🚫 Limit reached' : `🎁 Save Trivial Benefit`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

