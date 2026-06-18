import React, { useState, useEffect, useCallback } from 'react';
import { getAuthHeaders, emailP11D, downloadP11DPDF, getCompanySettings } from '../services/apiService';
import ConfirmDeleteModal from './ConfirmDeleteModal';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://finlyticsdevfunc.azurewebsites.net/api';

const CLASS_1A_RATE  = 0.138;
const BASIC_RATE     = 0.20;
const HIGHER_RATE    = 0.40;          // England/Wales/NI
const HIGHER_RATE_SC = 0.42;          // Scotland
const ANNUAL_PARTY_LIMIT = 150; // £150 per head per year — s.264 ITEPA 2003

// Scottish taxpayers have an 'S' prefix on their tax code (e.g. S1257L)
// Tax still goes to HMRC who passes the Scottish portion to the Scottish Government
function getTaxRegion(taxCode) {
    if (typeof taxCode === 'string' && taxCode.trim().toUpperCase().startsWith('S') && taxCode.trim().length > 1)
        return { region: 'Scotland', higherRate: HIGHER_RATE_SC, label: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland' };
    return { region: 'England/Wales/NI', higherRate: HIGHER_RATE, label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 England / Wales / NI' };
}

const BENEFIT_CATEGORIES = [
    { value: 'PMI',                       label: 'Private Medical Insurance (PMI)', section: 'M' },
    { value: 'Annual Party',              label: 'Annual Party / Staff Event',      section: 'N' },
    { value: 'Gym Membership',            label: 'Gym Membership',                  section: 'N' },
    { value: 'Professional Subscription',label: 'Professional Subscription',        section: 'N' },
    { value: 'Company Car',               label: 'Company Car',                     section: 'F' },
    { value: 'Assets Transferred',        label: 'Assets Transferred',              section: 'C' },
    { value: 'Other',                     label: 'Other',                           section: 'N' },
];

const SECTION_LABELS = { M: 'Section M — Medical', F: 'Section F — Cars', C: 'Section C — Assets', N: 'Section N — Other' };

// ── Tax year helpers ──────────────────────────────────────────────────────────
function getCurrentTaxYear() {
    const now = new Date();
    const year = now.getFullYear();
    // Tax year runs April 6 – April 5
    const taxStart = new Date(year, 3, 6); // April 6
    if (now >= taxStart) return `${year}/${String(year + 1).slice(-2)}`;
    return `${year - 1}/${String(year).slice(-2)}`;
}

function getTaxYearOptions() {
    const current = getCurrentTaxYear();
    const [startY] = current.split('/').map(Number);
    return Array.from({ length: 5 }, (_, i) => {
        const y = startY - i;
        return `${y}/${String(y + 1).slice(-2)}`;
    });
}

function getP11DDeadline(taxYear) {
    // Filing: 6 July following the tax year
    const [, endYY] = taxYear.split('/');
    const endYear = endYY.length === 2 ? 2000 + parseInt(endYY, 10) : parseInt(endYY, 10);
    return new Date(endYear, 6, 6); // July 6
}

function getClass1ADeadline(taxYear) {
    // Class 1A NI payment: 22 July (electronic) following the tax year
    const [, endYY] = taxYear.split('/');
    const endYear = endYY.length === 2 ? 2000 + parseInt(endYY, 10) : parseInt(endYY, 10);
    return new Date(endYear, 6, 22); // July 22
}

function getTaxYearDates(taxYear) {
    // Returns { dateFrom, dateTo } as YYYY-MM-DD strings
    // Tax year: 6 April (start year) → 5 April (end year)
    const [startY] = taxYear.split('/');
    const startYear = parseInt(startY, 10);
    const endYear = startYear + 1;
    const pad = n => String(n).padStart(2, '0');
    return {
        dateFrom: `${startYear}-04-06`,
        dateTo:   `${endYear}-04-05`,
    };
}

function formatDate(d) {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatCurrency(n) {
    return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysUntil(date) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
}

const defaultForm = {
    recipientName: '',
    recipientType: 'Director',
    benefitCategory: '',
    description: '',
    cashEquivalent: '',
    dateFrom: '',
    dateTo: '',
    isExempt: false,
    exemptionReason: '',
    headcount: '',
    totalEventCost: '',
    notes: '',
};

// ── Main component ────────────────────────────────────────────────────────────
export default function P11D() {
    const [taxYear, setTaxYear]         = useState(getCurrentTaxYear);
    const [entries, setEntries]         = useState([]);
    const [employees, setEmployees]     = useState([]);
    const [loading, setLoading]         = useState(true);
    const [showModal, setShowModal]     = useState(false);
    const [editEntry, setEditEntry]     = useState(null);
    const [form, setForm]               = useState(defaultForm);
    const [saving, setSaving]           = useState(false);
    const [deleting, setDeleting]       = useState(null);
    const [error, setError]             = useState('');
    const [toast, setToast]             = useState(null);
    const [emailModal, setEmailModal]   = useState({ open: false, recipientName: '', toEmail: '', sending: false });
    const [downloadingP11D, setDownloadingP11D] = useState(null);
    const [companySettings, setCompanySettings] = useState(null);
    const [confirmModal, setConfirmModal]         = useState({ isOpen: false, title: '', message: '', itemLabels: [], onConfirm: () => {} });

    const allowDataDeletion = companySettings?.allowDataDeletion === true;

    const showToast = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    };

    const openEmailModal = (recipientName) => {
        const emp = employees.find(e =>
            (e.name || '').toLowerCase() === recipientName.toLowerCase() ||
            (`${e.firstName || ''} ${e.lastName || ''}`).trim().toLowerCase() === recipientName.toLowerCase()
        );
        setEmailModal({ open: true, recipientName, toEmail: emp?.email || '', sending: false });
    };

    const handleSendP11DEmail = async () => {
        if (!emailModal.toEmail) { showToast('Please enter an email address', 'error'); return; }
        setEmailModal(m => ({ ...m, sending: true }));
        try {
            await emailP11D({ recipientName: emailModal.recipientName, taxYear, toEmail: emailModal.toEmail });
            showToast(`P11D emailed to ${emailModal.toEmail}`);
            setEmailModal({ open: false, recipientName: '', toEmail: '', sending: false });
        } catch (err) {
            showToast(err.message || 'Failed to send P11D email', 'error');
            setEmailModal(m => ({ ...m, sending: false }));
        }
    };

    const handleDownloadP11D = async (recipientName) => {
        setDownloadingP11D(recipientName);
        try {
            const blob = await downloadP11DPDF(recipientName, taxYear);
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `P11D-${recipientName.replace(/ /g, '-')}-${taxYear.replace('/', '-')}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            showToast(err.message || 'Failed to download P11D PDF', 'error');
        } finally {
            setDownloadingP11D(null);
        }
    };

    // ── Load data ────────────────────────────────────────────────────────────
    const loadEntries = useCallback(async () => {
        setLoading(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_BASE}/bik?taxYear=${encodeURIComponent(taxYear)}`, { headers });
            if (res.ok) setEntries(await res.json());
            else setEntries([]);
        } catch {
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [taxYear]);

    useEffect(() => { loadEntries(); }, [loadEntries]);

    useEffect(() => {
        (async () => {
            try {
                const [empRes, settings] = await Promise.all([
                    fetch(`${API_BASE}/employees`, { headers: await getAuthHeaders() }),
                    getCompanySettings().catch(() => null),
                ]);
                if (empRes.ok) setEmployees(await empRes.json());
                if (settings) setCompanySettings(settings);
            } catch { /* non-fatal */ }
        })();
    }, []);

    // ── Derived calculations ─────────────────────────────────────────────────
    const taxableEntries = entries.filter(e => !e.isExempt);
    const totalBik       = taxableEntries.reduce((s, e) => s + (e.cashEquivalent || 0), 0);
    const totalClass1A   = totalBik * CLASS_1A_RATE;
    const estTaxBasic    = totalBik * BASIC_RATE;
    const estTaxHigher   = totalBik * HIGHER_RATE;
    const uniqueRecipients = [...new Set(taxableEntries.map(e => e.recipientName))];

    // Annual party aggregate tracking
    const partyEntries    = entries.filter(e => e.benefitCategory === 'Annual Party');
    const totalPartyPerHead = partyEntries.reduce((s, e) => {
        if (e.headcount && e.totalEventCost) return s + (e.totalEventCost / e.headcount);
        return s + (e.cashEquivalent || 0);
    }, 0);
    const partyOverLimit  = totalPartyPerHead > ANNUAL_PARTY_LIMIT;

    // Per-recipient grouping
    const byRecipient = taxableEntries.reduce((acc, e) => {
        if (!acc[e.recipientName]) acc[e.recipientName] = [];
        acc[e.recipientName].push(e);
        return acc;
    }, {});

    const p11dDeadline  = getP11DDeadline(taxYear);
    const ni1aDeadline  = getClass1ADeadline(taxYear);
    const daysToP11D    = daysUntil(p11dDeadline);
    const deadlineColor = daysToP11D <= 30 ? '#dc2626' : daysToP11D <= 90 ? '#d97706' : '#16a34a';

    // ── Modal helpers ────────────────────────────────────────────────────────
    // One-off events: user picks the specific date. Duration benefits: default to full tax year.
    const ONE_OFF_CATEGORIES = ['Annual Party'];

    const openAdd = () => {
        setEditEntry(null);
        setForm({ ...defaultForm, taxYear });
        setError('');
        setShowModal(true);
    };

    const openEdit = (entry) => {
        setEditEntry(entry);
        setForm({
            recipientName:   entry.recipientName   || '',
            recipientType:   entry.recipientType   || 'Director',
            benefitCategory: entry.benefitCategory || '',
            description:     entry.description     || '',
            cashEquivalent:  entry.cashEquivalent != null ? String(entry.cashEquivalent) : '',
            dateFrom:        entry.dateFrom ? entry.dateFrom.split('T')[0] : '',
            dateTo:          entry.dateTo   ? entry.dateTo.split('T')[0]   : '',
            isExempt:        entry.isExempt || false,
            exemptionReason: entry.exemptionReason || '',
            headcount:       entry.headcount != null ? String(entry.headcount) : '',
            totalEventCost:  entry.totalEventCost != null ? String(entry.totalEventCost) : '',
            notes:           entry.notes || '',
        });
        setError('');
        setShowModal(true);
    };

    const handleChange = e => {
        const { name, value, type, checked } = e.target;
        setForm(p => {
            const next = { ...p, [name]: type === 'checkbox' ? checked : value };

            // When category is first selected, auto-set sensible date defaults
            if (name === 'benefitCategory' && value && !p.benefitCategory) {
                if (ONE_OFF_CATEGORIES.includes(value)) {
                    // One-off event — leave dates blank for user to enter the specific date
                    next.dateFrom = '';
                    next.dateTo = '';
                } else {
                    // Duration benefit — default to full tax year
                    const { dateFrom, dateTo } = getTaxYearDates(taxYear);
                    next.dateFrom = dateFrom;
                    next.dateTo = dateTo;
                }
            }

            // Auto-calculate cashEquivalent for Annual Party
            if (next.benefitCategory === 'Annual Party') {
                const total = parseFloat(next.totalEventCost) || 0;
                const heads = parseInt(next.headcount, 10) || 0;
                if (total > 0 && heads > 0)
                    next.cashEquivalent = (total / heads).toFixed(2);
                // Auto-suggest exemption if within £150/head
                if ((total / heads) <= ANNUAL_PARTY_LIMIT && !next.isExempt) {
                    next.isExempt = true;
                    next.exemptionReason = 'Annual party exemption s.264 ITEPA 2003 — within £150/head';
                } else if ((total / heads) > ANNUAL_PARTY_LIMIT && next.isExempt &&
                           next.exemptionReason?.includes('s.264')) {
                    next.isExempt = false;
                    next.exemptionReason = '';
                }
            }
            return next;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.recipientName || !form.benefitCategory) {
            setError('Recipient and category are required.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const headers = await getAuthHeaders();
            const payload = {
                taxYear,
                recipientName:   form.recipientName,
                recipientType:   form.recipientType,
                benefitCategory: form.benefitCategory,
                description:     form.description || null,
                cashEquivalent:  parseFloat(form.cashEquivalent) || 0,
                dateFrom:        form.dateFrom || null,
                dateTo:          form.dateTo   || null,
                isExempt:        form.isExempt,
                exemptionReason: form.isExempt ? (form.exemptionReason || null) : null,
                headcount:       form.headcount ? parseInt(form.headcount, 10) : null,
                totalEventCost:  form.totalEventCost ? parseFloat(form.totalEventCost) : null,
                notes:           form.notes || null,
            };

            const url    = editEntry ? `${API_BASE}/bik/${editEntry.id}` : `${API_BASE}/bik`;
            const method = editEntry ? 'PUT' : 'POST';
            const res    = await fetch(url, { method, headers, body: JSON.stringify(payload) });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(txt || `HTTP ${res.status}`);
            }
            showToast(editEntry ? 'Benefit updated.' : 'Benefit added.');
            setShowModal(false);
            await loadEntries();
        } catch (ex) {
            setError(ex.message || 'Save failed.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (entry) => {
        const label = `${entry.description || entry.benefitCategory} — ${entry.recipientName} (${formatCurrency(entry.cashEquivalent)})`;
        setConfirmModal({
            isOpen: true,
            title: 'Delete Benefit in Kind',
            message: 'Are you sure you want to permanently delete this benefit entry? This cannot be undone.',
            itemLabels: [label],
            onConfirm: async () => {
                setConfirmModal(m => ({ ...m, isOpen: false }));
                setDeleting(entry.id);
                try {
                    const headers = await getAuthHeaders();
                    await fetch(`${API_BASE}/bik/${entry.id}`, { method: 'DELETE', headers });
                    showToast('Benefit deleted.');
                    await loadEntries();
                } catch {
                    showToast('Delete failed.', 'error');
                } finally {
                    setDeleting(null);
                }
            },
        });
    };

    const isAnnualParty = form.benefitCategory === 'Annual Party';

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>

            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', top: 16, right: 16, zIndex: 9999,
                    padding: '0.75rem 1.25rem', borderRadius: 8, fontWeight: 600,
                    background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`,
                    color: toast.type === 'error' ? '#dc2626' : '#16a34a',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                }}>
                    {toast.type === 'error' ? '❌ ' : '✅ '}{toast.msg}
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem', padding: '0.75rem 0' }}>
                <div>
                    <h1 style={{ margin: '0.6rem 0 0.4rem', fontSize: '1.5rem' }}>P11D — Benefits in Kind</h1>
                    <p style={{ margin: '0 0 0.6rem', color: '#6b7280', fontSize: '0.9rem' }}>
                        Track taxable benefits provided to directors and employees. Employer pays Class 1A NI at 13.8%; employee pays income tax on the cash equivalent via PAYE coding.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <select value={taxYear} onChange={e => setTaxYear(e.target.value)}
                        style={{ padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.9rem' }}>
                        {getTaxYearOptions().map(y => <option key={y} value={y}>Tax Year {y}</option>)}
                    </select>
                    <button className="btn-primary" onClick={openAdd}>+ Add Benefit</button>
                </div>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <SummaryCard icon="💰" label="Total Reportable BIK" value={formatCurrency(totalBik)} color="#1e40af" />
                <SummaryCard icon="🏛️" label="Class 1A NI — Employer"
                    value={formatCurrency(totalClass1A)}
                    subtitle="13.8% · paid by employer" color="#7c3aed" />
                <SummaryCard icon="💷" label="Est. Employee Income Tax"
                    value={formatCurrency(estTaxBasic)}
                    subtitle="20% basic shown · higher rate 40% (42% Scotland)"
                    color="#d97706" />
                <SummaryCard icon="👤" label="Recipients" value={uniqueRecipients.length}
                    subtitle={uniqueRecipients.length > 0 ? uniqueRecipients.join(', ') : 'None'} color="#0891b2" />
                <SummaryCard icon="📅" label="P11D Filing Deadline"
                    value={formatDate(p11dDeadline)}
                    subtitle={daysToP11D > 0 ? `${daysToP11D} days` : daysToP11D === 0 ? 'Today!' : 'Overdue'}
                    color={deadlineColor} />
            </div>

            {/* Class 1A NI deadline note */}
            {totalClass1A > 0 && (
                <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: '0.875rem' }}>
                    ⚠️ <strong>Class 1A NI payment of {formatCurrency(totalClass1A)}</strong> due by{' '}
                    <strong>{formatDate(ni1aDeadline)}</strong> (electronic). P11D(b) form also required.
                </div>
            )}

            {/* Annual Party tracker */}
            {partyEntries.length > 0 && (
                <div style={{
                    marginBottom: '1.5rem', padding: '1rem 1.25rem',
                    background: partyOverLimit ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${partyOverLimit ? '#fca5a5' : '#86efac'}`,
                    borderRadius: 8,
                }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1rem' }}>
                        🎉 Annual Party Exemption Tracker (s.264 ITEPA 2003)
                    </div>
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
                        <span>Events this year: <strong>{partyEntries.length}</strong></span>
                        <span>Cumulative cost per head: <strong>{formatCurrency(totalPartyPerHead)}</strong></span>
                        <span>Limit: <strong>£{ANNUAL_PARTY_LIMIT}.00/head</strong></span>
                        {partyOverLimit
                            ? <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠️ Over limit — event(s) are taxable P11D</span>
                            : <span style={{ color: '#16a34a', fontWeight: 700 }}>✅ Within exemption limit</span>
                        }
                    </div>
                    {partyEntries.map(pe => {
                        const perHead = pe.headcount && pe.totalEventCost
                            ? (pe.totalEventCost / pe.headcount).toFixed(2)
                            : pe.cashEquivalent;
                        return (
                            <div key={pe.id} style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#4b5563' }}>
                                • {pe.description || 'Event'}: {pe.headcount ? `${pe.headcount} people × ` : ''}{formatCurrency(perHead)}/head
                                {pe.isExempt ? ' ✅ Exempt' : ' ⚠️ Taxable'}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Benefits Register table */}
            <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: '1.5rem', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Benefits Register — {taxYear}</h2>
                    <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
                </div>

                {loading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
                ) : entries.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗂️</div>
                        No benefits recorded for {taxYear}.<br />
                        <span style={{ fontSize: '0.875rem' }}>Click <strong>+ Add Benefit</strong> to record PMI, staff events, gym memberships etc.</span>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                                    {['Recipient', 'Category', 'Description', 'Period', 'P11D Value', 'Status', 'Class 1A NI', ''].map(h => (
                                        <th key={h} style={{ padding: '0.6rem 0.75rem', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(e => {
                                    const ni = e.isExempt ? 0 : (e.cashEquivalent || 0) * CLASS_1A_RATE;
                                    return (
                                        <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                            <td style={{ padding: '0.6rem 0.75rem' }}>
                                                <div style={{ fontWeight: 600 }}>{e.recipientName}</div>
                                                <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{e.recipientType}</div>
                                            </td>
                                            <td style={{ padding: '0.6rem 0.75rem' }}>
                                                <span style={{
                                                    padding: '0.2rem 0.5rem', borderRadius: 4, fontSize: '0.78rem',
                                                    background: '#eff6ff', color: '#1d4ed8'
                                                }}>
                                                    {e.benefitCategory}
                                                </span>
                                                {e.p11DSection && (
                                                    <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
                                                        {SECTION_LABELS[e.p11DSection] || `Section ${e.p11DSection}`}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.6rem 0.75rem', maxWidth: 200 }}>
                                                <div>{e.description || '—'}</div>
                                                {e.headcount && <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{e.headcount} attendees</div>}
                                            </td>
                                            <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap', color: '#6b7280' }}>
                                                {e.dateFrom ? formatDate(e.dateFrom) : ''}
                                                {e.dateFrom && e.dateTo ? ' – ' : ''}
                                                {e.dateTo ? formatDate(e.dateTo) : ''}
                                                {!e.dateFrom && !e.dateTo ? '—' : ''}
                                            </td>
                                            <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>
                                                {formatCurrency(e.cashEquivalent)}
                                            </td>
                                            <td style={{ padding: '0.6rem 0.75rem' }}>
                                                {e.isExempt ? (
                                                    <span style={{ color: '#16a34a', fontSize: '0.8rem' }} title={e.exemptionReason || 'Exempt'}>
                                                        ✅ Exempt
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#dc2626', fontSize: '0.8rem' }}>
                                                        ⚠️ P11D Reportable
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.6rem 0.75rem', fontWeight: e.isExempt ? 400 : 600, color: e.isExempt ? '#9ca3af' : '#7c3aed' }}>
                                                {e.isExempt ? '—' : formatCurrency(ni)}
                                            </td>
                                            <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                                                <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem', marginRight: 4 }}
                                                    onClick={() => openEdit(e)}>✏️</button>
                                                {allowDataDeletion && (
                                                    <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem', color: '#dc2626' }}
                                                        onClick={() => handleDelete(e)} disabled={deleting === e.id}>🗑️</button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {taxableEntries.length > 0 && (
                                <tfoot>
                                    <tr style={{ background: '#f9fafb', fontWeight: 700 }}>
                                        <td colSpan={4} style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Totals (taxable only):</td>
                                        <td style={{ padding: '0.6rem 0.75rem' }}>{formatCurrency(totalBik)}</td>
                                        <td />
                                        <td style={{ padding: '0.6rem 0.75rem', color: '#7c3aed' }}>{formatCurrency(totalClass1A)}</td>
                                        <td />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}
            </div>

            {/* P11D Preview — per recipient */}
            {Object.keys(byRecipient).length > 0 && (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: '1.5rem' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
                        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>📋 P11D Summary per Recipient</h2>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                            File a separate P11D form for each recipient by {formatDate(p11dDeadline)}.
                        </p>
                    </div>
                    <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {Object.entries(byRecipient).map(([name, items]) => {
                            const personTotal   = items.reduce((s, e) => s + (e.cashEquivalent || 0), 0);
                            const personNI      = personTotal * CLASS_1A_RATE;
                            // Look up employee tax code to apply correct tax region
                            const emp = employees.find(e =>
                                (e.name || '').toLowerCase() === name.toLowerCase() ||
                                (`${e.firstName || ''} ${e.lastName || ''}`).trim().toLowerCase() === name.toLowerCase()
                            );
                            const { higherRate, label: regionLabel } = getTaxRegion(emp?.taxCode);
                            const personTaxBasic  = personTotal * BASIC_RATE;
                            const personTaxHigher = personTotal * higherRate;
                            const bySect      = items.reduce((acc, e) => {
                                const s = e.p11DSection || 'N';
                                if (!acc[s]) acc[s] = [];
                                acc[s].push(e);
                                return acc;
                            }, {});
                            return (
                                <div key={name} style={{ padding: '1rem', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>👤 {name}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '0.8rem', color: '#7c3aed', fontWeight: 600 }}
                                                title="Paid by employer to HMRC">🏛️ Class 1A NI: {formatCurrency(personNI)}</span>
                                            <span style={{ fontSize: '0.8rem', color: '#d97706', fontWeight: 600 }}
                                                title={`Employee income tax: 20% basic = ${formatCurrency(personTaxBasic)}, 40% higher = ${formatCurrency(personTaxHigher)}. Collected via PAYE coding adjustment.`}>💷 Est. tax: {formatCurrency(personTaxBasic)} – {formatCurrency(personTaxHigher)}</span>
                                            <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                                onClick={() => handleDownloadP11D(name)}
                                                disabled={downloadingP11D === name}>
                                                {downloadingP11D === name ? '⏳' : '📥'} PDF
                                            </button>
                                            <button className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                                onClick={() => openEmailModal(name)}>
                                                📧 Email
                                            </button>
                                        </div>
                                    </div>
                                    {Object.entries(bySect).map(([sect, sectItems]) => (
                                        <div key={sect} style={{ marginBottom: '0.25rem', fontSize: '0.875rem' }}>
                                            <span style={{ color: '#6b7280' }}>{SECTION_LABELS[sect] || `Section ${sect}`}:</span>
                                            {sectItems.map(si => (
                                                <span key={si.id} style={{ marginLeft: '0.5rem' }}>
                                                    {si.description || si.benefitCategory} — <strong>{formatCurrency(si.cashEquivalent)}</strong>
                                                </span>
                                            ))}
                                        </div>
                                    ))}
                                    <div style={{ marginTop: '0.5rem', fontWeight: 700, borderTop: '1px solid #e5e7eb', paddingTop: '0.5rem' }}>
                                        Total cash equivalent: {formatCurrency(personTotal)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ padding: '0.75rem 1.25rem', background: '#eff6ff', borderTop: '1px solid #bfdbfe', fontSize: '0.85rem' }}>
                        📌 Employer: file <strong>P11D(b)</strong> and pay Class 1A NI of{' '}
                        <strong>{formatCurrency(totalClass1A)}</strong> by <strong>{formatDate(ni1aDeadline)}</strong>.{' '}
                        Employee income tax on benefits ({formatCurrency(estTaxBasic)} at 20% / {formatCurrency(estTaxHigher)} at 40%) is collected via PAYE coding adjustment after HMRC processes the P11D.
                    </div>
                </div>
            )}

            {/* HMRC guidance note */}
            <div style={{ padding: '0.75rem 1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: '0.8rem', color: '#6b7280' }}>
                <strong>HMRC guidance:</strong> PMI premiums paid by the company are taxable BIK (Section M). Annual staff parties are exempt up to £150/head/year (s.264 ITEPA 2003) — if exceeded, the whole amount is taxable.
                Gym memberships and non-work subscriptions are taxable (Section N). File P11D by 6 July, pay Class 1A NI by 22 July.{' '}
                See <a href="https://www.gov.uk/guidance/complete-p11d-and-p11db-forms-expenses-and-benefits" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>HMRC P11D guidance</a>.{' '}
                <a href="https://www.tax.service.gov.uk/gg/sign-in?continue=/paye-online-employer" target="_blank" rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem',
                             background: '#16a34a', color: '#fff', padding: '0.2rem 0.65rem', borderRadius: 4,
                             fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>
                    🏛️ File with HMRC PAYE Online
                </a>
            </div>

            {/* ── P11D Email Modal ─────────────────────────────────────────────── */}
            {emailModal.open && (
                <div className="modal-overlay" onClick={() => setEmailModal(m => ({ ...m, open: false }))}>
                    <div className="modal-content" style={{ maxWidth: 420, width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 style={{ margin: 0 }}>Email P11D Form</h3>
                                <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', opacity: 0.7 }}>Tax year {taxYear} — {emailModal.recipientName}</p>
                            </div>
                            <button className="btn-close" onClick={() => setEmailModal(m => ({ ...m, open: false }))}>✖</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Recipient Email *</label>
                                <input
                                    type="email"
                                    value={emailModal.toEmail}
                                    onChange={e => setEmailModal(m => ({ ...m, toEmail: e.target.value }))}
                                    placeholder="recipient@example.com"
                                    autoFocus
                                />
                                <small>The P11D PDF will be sent as an attachment. The from address is the Payroll Email set in PAYE Settings.</small>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-primary" onClick={handleSendP11DEmail} disabled={emailModal.sending}>
                                {emailModal.sending ? '⏳ Sending…' : '📧 Send P11D Email'}
                            </button>
                            <button className="btn-secondary" onClick={() => setEmailModal(m => ({ ...m, open: false }))}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Confirm Delete Modal ──────────────────────────────────────── */}
            <ConfirmDeleteModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                itemLabels={confirmModal.itemLabels}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(m => ({ ...m, isOpen: false }))}
            />

            {/* ── Add/Edit Modal ─────────────────────────────────────────────── */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content" style={{ maxWidth: 560, width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 style={{ margin: 0 }}>{editEntry ? 'Edit Benefit' : 'Add Benefit in Kind'}</h3>
                                <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', opacity: 0.7 }}>Tax year {taxYear}</p>
                            </div>
                            <button className="btn-close" onClick={() => setShowModal(false)}>✖</button>
                        </div>

                        <form onSubmit={handleSubmit} style={{ padding: '0 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

                            {/* Recipient */}
                            <div className="form-row" style={{ gap: '0.75rem' }}>
                                <div className="form-group" style={{ flex: 2 }}>
                                    <label>Recipient *</label>
                                    {employees.length > 0 ? (
                                        <select name="recipientName" value={form.recipientName} onChange={handleChange} required>
                                            <option value="">Select…</option>
                                            {employees.map(emp => (
                                                <option key={emp.id} value={emp.name}>{emp.name}{emp.isDirector ? ' (Director)' : ''}</option>
                                            ))}
                                            <option value="__other__">Other…</option>
                                        </select>
                                    ) : (
                                        <input type="text" name="recipientName" value={form.recipientName}
                                            onChange={handleChange} placeholder="Director / employee name" required />
                                    )}
                                    {form.recipientName === '__other__' && (
                                        <input type="text" name="recipientName" value='' onChange={handleChange}
                                            placeholder="Enter name" style={{ marginTop: 4 }} required />
                                    )}
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Type</label>
                                    <select name="recipientType" value={form.recipientType} onChange={handleChange}>
                                        <option value="Director">Director</option>
                                        <option value="Employee">Employee</option>
                                    </select>
                                </div>
                            </div>

                            {/* Category */}
                            <div className="form-group">
                                <label>Benefit Category *</label>
                                <select name="benefitCategory" value={form.benefitCategory} onChange={handleChange} required>
                                    <option value="">Select category…</option>
                                    {BENEFIT_CATEGORIES.map(c => (
                                        <option key={c.value} value={c.value}>{c.label} (P11D Section {c.section})</option>
                                    ))}
                                </select>
                            </div>

                            {/* Description */}
                            <div className="form-group">
                                <label>Description</label>
                                <input type="text" name="description" value={form.description} onChange={handleChange}
                                    placeholder={
                                        form.benefitCategory === 'PMI' ? 'e.g. BUPA Private Medical Insurance 2025/26' :
                                        form.benefitCategory === 'Annual Party' ? 'e.g. Christmas Party 2025' :
                                        form.benefitCategory === 'Gym Membership' ? 'e.g. PureGym annual membership' : 'Description'
                                    } />
                            </div>

                            {/* Annual Party specific fields */}
                            {isAnnualParty && (
                                <div className="form-row" style={{ gap: '0.75rem' }}>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label>Total Event Cost (£) *</label>
                                        <input type="number" name="totalEventCost" value={form.totalEventCost}
                                            onChange={handleChange} step="0.01" min="0" placeholder="0.00"
                                            onWheel={e => e.currentTarget.blur()} />
                                        <small>Total spend including VAT</small>
                                    </div>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label>Number of Attendees *</label>
                                        <input type="number" name="headcount" value={form.headcount}
                                            onChange={handleChange} step="1" min="1" placeholder="e.g. 4"
                                            onWheel={e => e.currentTarget.blur()} />
                                        <small>Including non-employees (e.g. partners)</small>
                                    </div>
                                </div>
                            )}

                            {/* Cash equivalent */}
                            <div className="form-group">
                                <label>
                                    {isAnnualParty ? 'Cost Per Head (auto-calculated)' : 'Cash Equivalent Value (£) *'}
                                </label>
                                <input type="number" name="cashEquivalent" value={form.cashEquivalent}
                                    onChange={handleChange} step="0.01" min="0" placeholder="0.00"
                                    onWheel={e => e.currentTarget.blur()}
                                    readOnly={isAnnualParty && form.headcount && form.totalEventCost} required />
                                {!isAnnualParty && (
                                    <small>
                                        {form.benefitCategory === 'PMI' ? 'Annual premium paid by the company (P11D value)' :
                                         form.benefitCategory === 'Gym Membership' ? 'Cost of membership paid by company' :
                                         'Amount to report on P11D'}
                                    </small>
                                )}
                                {isAnnualParty && form.cashEquivalent && (
                                    <small style={{ color: parseFloat(form.cashEquivalent) > ANNUAL_PARTY_LIMIT ? '#dc2626' : '#16a34a' }}>
                                        {parseFloat(form.cashEquivalent) > ANNUAL_PARTY_LIMIT
                                            ? `⚠️ ${formatCurrency(form.cashEquivalent)}/head exceeds £150 — full amount is taxable BIK`
                                            : `✅ ${formatCurrency(form.cashEquivalent)}/head — within £150 exemption`
                                        }
                                    </small>
                                )}
                            </div>

                            {/* Class 1A NI preview */}
                            {!form.isExempt && parseFloat(form.cashEquivalent) > 0 && (
                                <div style={{ padding: '0.5rem 0.75rem', background: '#eff6ff', borderRadius: 6, fontSize: '0.85rem' }}>
                                    Class 1A NI on this benefit: <strong>{formatCurrency(parseFloat(form.cashEquivalent) * CLASS_1A_RATE)}</strong>
                                </div>
                            )}

                            {/* Date range */}
                            <div className="form-row" style={{ gap: '0.75rem' }}>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>{isAnnualParty ? 'Event Date' : 'Date From'}</label>
                                    <input type="date" name="dateFrom" value={form.dateFrom} onChange={handleChange} />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>{isAnnualParty ? 'Event End Date (optional)' : 'Date To'}</label>
                                    <input type="date" name="dateTo" value={form.dateTo} onChange={handleChange} />
                                </div>
                            </div>
                            {form.benefitCategory && (
                                <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '-0.25rem' }}>
                                    {isAnnualParty
                                        ? 'Enter the date(s) of the event.'
                                        : 'Period the benefit was provided — defaults to the full tax year, adjust if benefit started or ended mid-year.'}
                                </div>
                            )}

                            {/* Exempt toggle */}
                            <div style={{ padding: '0.75rem', background: form.isExempt ? '#f0fdf4' : '#fafafa', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                                <label style={{ display: 'flex', gap: '0.6rem', cursor: 'pointer', alignItems: 'flex-start' }}>
                                    <input type="checkbox" name="isExempt" checked={form.isExempt}
                                        onChange={handleChange} style={{ marginTop: 3 }} />
                                    <span style={{ fontSize: '0.875rem' }}>
                                        <strong>This benefit is exempt from P11D</strong> (e.g. within annual party £150 limit, or trivial benefit)
                                    </span>
                                </label>
                                {form.isExempt && (
                                    <input type="text" name="exemptionReason" value={form.exemptionReason}
                                        onChange={handleChange} placeholder="Exemption reason (optional)"
                                        style={{ marginTop: '0.5rem', width: '100%' }} />
                                )}
                            </div>

                            {/* Notes */}
                            <div className="form-group">
                                <label>Notes</label>
                                <textarea name="notes" value={form.notes} onChange={handleChange}
                                    rows={2} placeholder="Optional notes" style={{ resize: 'vertical' }} />
                            </div>

                            {error && (
                                <div style={{ padding: '0.5rem', background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: '0.875rem' }}>
                                    {error}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                                <button type="submit" className="btn-primary" disabled={saving}>
                                    {saving ? 'Saving…' : editEntry ? 'Update Benefit' : 'Add Benefit'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Small helper components ───────────────────────────────────────────────────
function SummaryCard({ icon, label, value, subtitle, color }) {
    return (
        <div style={{
            background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb',
            padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem',
        }}>
            <div style={{ fontSize: '0.78rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {icon} {label}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
            {subtitle && <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{subtitle}</div>}
        </div>
    );
}

