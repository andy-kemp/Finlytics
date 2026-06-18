import React, { useState, useEffect, useCallback } from 'react';
import {
    getDividends, getDividendById, createDividend, updateDividend,
    deleteDividend, finaliseDividend,
    getDividendMinutesPdfUrl, getDividendVoucherPdfUrl, emailDividendVoucher,
    getShareholders, getEmployees, getAuthHeaders
} from '../services/apiService';

const API_BASE = 'https://finlyticsdevfunc.azurewebsites.net/api';

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n ?? 0);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);

const STEPS = [
    { id: 1, label: 'Declare',        emoji: '📋' },
    { id: 2, label: 'Allocate',       emoji: '👥' },
    { id: 3, label: 'Board Minutes',  emoji: '📄' },
    { id: 4, label: 'Vouchers',       emoji: '🧾' },
    { id: 5, label: 'Finalise',       emoji: '✅' },
];

const BLANK_DECLARATION = {
    dividendType: 'Interim',
    shareClass: 'Ordinary',
    meetingDate: today(),
    meetingLocation: '',
    recordDate: today(),
    paymentDate: today(),
    amountPerShare: '',
    directorName: '',
    notes: '',
    allocations: [],
};

export default function Dividends() {
    const [declarations, setDeclarations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [currentDeclaration, setCurrentDeclaration] = useState(null); // saved declaration from backend
    const [formData, setFormData] = useState({ ...BLANK_DECLARATION });
    const [allocations, setAllocations] = useState([]);
    const [shareholders, setShareholders] = useState([]);
    const [directors, setDirectors] = useState([]);
    const [saving, setSaving] = useState(false);
    const [finalising, setFinalising] = useState(false);
    const [finaliseResult, setFinaliseResult] = useState(null);
    const [error, setError] = useState('');
    const [pdfLoading, setPdfLoading] = useState({});
    const [emailSending, setEmailSending] = useState({});
    const [emailModal, setEmailModal] = useState(null);   // { alloc, i } | null
    const [emailModalAddress, setEmailModalAddress] = useState('');
    const [emailModalSending, setEmailModalSending] = useState(false);
    const [quickViewModal, setQuickViewModal] = useState(null); // { declaration, allocations } | null
    const [quickViewLoading, setQuickViewLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [deleteModal, setDeleteModal] = useState(null);   // { items: [{id,ref,status,type}] } | null
    const [deleteModalDeleting, setDeleteModalDeleting] = useState(false);
    const [deleteModalError, setDeleteModalError] = useState('');

    const loadDeclarations = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getDividends();
            setDeclarations(data);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadDeclarations(); }, [loadDeclarations]);

    // ── Open wizard for a new dividend ───────────────────────────────────────
    async function openNew() {
        setError('');
        setFormData({ ...BLANK_DECLARATION });
        setAllocations([]);
        setCurrentDeclaration(null);
        setWizardStep(1);
        setFinaliseResult(null);
        // pre-load shareholders and directors
        try {
            const [sh, emps] = await Promise.all([getShareholders(), getEmployees()]);
            setShareholders(sh.filter(s => s.isActive));
            const dirs = emps.filter(e => e.isDirector && e.isActive !== false);
            setDirectors(dirs);
            if (dirs.length > 0) {
                setFormData(f => ({ ...f, directorName: dirs[0].name }));
            }
        } catch { setShareholders([]); setDirectors([]); }
        setWizardOpen(true);
    }

    // ── Open wizard to resume a draft ────────────────────────────────────────
    async function openDraft(declaration) {
        setError('');
        setFinaliseResult(null);
        try {
            const full = await getDividendById(declaration.id);
            setCurrentDeclaration(full);
            setFormData({
                dividendType: full.dividendType,
                shareClass: full.shareClass,
                meetingDate: full.meetingDate?.slice(0, 10) ?? today(),
                meetingLocation: full.meetingLocation ?? '',
                recordDate: full.recordDate?.slice(0, 10) ?? today(),
                paymentDate: full.paymentDate?.slice(0, 10) ?? today(),
                amountPerShare: String(full.amountPerShare ?? ''),
                directorName: full.directorName ?? '',
                notes: full.notes ?? '',
                allocations: full.allocations ?? [],
            });
            setAllocations(full.allocations ?? []);
            const [sh, emps] = await Promise.all([getShareholders(), getEmployees()]);
            setShareholders(sh.filter(s => s.isActive));
            const dirs = emps.filter(e => e.isDirector && e.isActive !== false);
            setDirectors(dirs);
            if (!full.directorName && dirs.length > 0) {
                setFormData(f => ({ ...f, directorName: dirs[0].name }));
            }
            setWizardStep(1);
            setWizardOpen(true);
        } catch (e) {
            setError(e.message);
        }
    }

    function closeWizard() {
        setWizardOpen(false);
        loadDeclarations();
    }

    // ── Step navigation ───────────────────────────────────────────────────────
    async function goToStep(next) {
        setError('');
        // View-only mode for finalised dividends — just navigate, no saves
        if (currentDeclaration?.status === 'Finalised') {
            setWizardStep(next);
            return;
        }
        if (next === 2) await saveStep1();
        else if (next === 3) await saveAllocations();
        else setWizardStep(next);
    }

    // ── Step 1: Save declaration header ──────────────────────────────────────
    async function saveStep1() {
        if (!formData.meetingDate || !formData.recordDate || !formData.paymentDate) {
            setError('Please fill in all date fields.');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                ...currentDeclaration,
                dividendType: formData.dividendType,
                shareClass: formData.shareClass,
                meetingDate: formData.meetingDate,
                meetingLocation: formData.meetingLocation,
                recordDate: formData.recordDate,
                paymentDate: formData.paymentDate,
                amountPerShare: 0,
                directorName: formData.directorName,
                notes: formData.notes,
                allocations: [],
            };

            let saved;
            if (currentDeclaration?.id) {
                saved = await updateDividend(currentDeclaration.id, payload);
            } else {
                saved = await createDividend(payload);
            }
            setCurrentDeclaration(saved);

            // Auto-generate allocations from shareholders (rates default to existing or 0 — user sets them in Step 2)
            const filtered = shareholders.filter(sh =>
                !formData.shareClass || sh.shareClassName === formData.shareClass
            );
            const auto = filtered.length > 0 ? filtered : shareholders;
            const generated = auto.map((sh, i) => {
                // Preserve existing rates if already set; otherwise default to 0
                const existing = allocations.find(a => a.shareholderId === sh.id);
                const existingRate = existing?.amountPerShare > 0 ? existing.amountPerShare : 0;

                // Auto-populate bank details: prefer existing allocation value, then shareholder record,
                // then fallback to director employee record if the shareholder is a director
                const director = directors.find(d => d.name?.trim().toLowerCase() === sh.name?.trim().toLowerCase());
                const bankAccountName = existing?.bankAccountName
                    || sh.bankAccountName
                    || director?.bankAccountName
                    || '';
                const sortCode = existing?.sortCode
                    || sh.bankSortCode
                    || director?.bankSortCode
                    || '';
                const accountNumber = existing?.accountNumber
                    || sh.accountNumber
                    || director?.bankAccountNumber
                    || '';

                return {
                    id: existing?.id ?? 0,
                    dividendDeclarationId: saved.id,
                    shareholderId: sh.id,
                    shareholderName: sh.name,
                    shareClass: sh.shareClassName ?? formData.shareClass,
                    numberOfShares: sh.sharesOwned ?? 0,
                    amountPerShare: existingRate,
                    totalAmount: Math.round((sh.sharesOwned ?? 0) * existingRate * 100) / 100,
                    bankAccountName,
                    sortCode,
                    accountNumber,
                    voucherRef: existing?.voucherRef ?? '',
                    ledgerEntryId: existing?.ledgerEntryId ?? null,
                };
            });
            setAllocations(generated.length > 0 ? generated : allocations);
            setWizardStep(2);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    // ── Step 2: Save allocations ──────────────────────────────────────────────
    async function saveAllocations() {
        if (!currentDeclaration?.id) { setError('No declaration saved.'); return; }
        if (allocations.some(a => !(parseFloat(a.amountPerShare) > 0))) {
            setError('Please enter a rate per share for every shareholder.');
            return;
        }
        setSaving(true);
        try {
            const withTotals = allocations.map(a => ({
                ...a,
                amountPerShare: parseFloat(a.amountPerShare) || 0,
                totalAmount: Math.round((a.numberOfShares ?? 0) * (parseFloat(a.amountPerShare) || 0) * 100) / 100,
            }));
            const saved = await updateDividend(currentDeclaration.id, {
                ...currentDeclaration,
                amountPerShare: withTotals[0]?.amountPerShare || 0,
                allocations: withTotals,
            });
            setCurrentDeclaration(saved);
            setAllocations(saved.allocations ?? []);
            setWizardStep(3);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    // ── Finalise ──────────────────────────────────────────────────────────────
    async function handleFinalise() {
        if (!currentDeclaration?.id) return;
        setFinalising(true);
        setError('');
        try {
            const result = await finaliseDividend(currentDeclaration.id);
            setFinaliseResult(result);
            setCurrentDeclaration(prev => ({ ...prev, status: 'Finalised' }));
            setWizardStep(5);
        } catch (e) {
            setError(e.message);
        } finally {
            setFinalising(false);
        }
    }

    // ── Download PDF via token-authenticated fetch ────────────────────────────
    async function downloadPdf(url, filename) {
        setPdfLoading(p => ({ ...p, [filename]: true }));
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error('Failed to download PDF');
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            setError(e.message);
        } finally {
            setPdfLoading(p => ({ ...p, [filename]: false }));
        }
    }

    // ── Email voucher — open modal ────────────────────────────────────────────
    function handleEmailVoucher(alloc, i) {
        if (!alloc.id) { setError('Voucher must be saved before emailing.'); return; }
        // Resolve email: allocation record → shareholders state array → empty
        const sh = shareholders.find(s => s.id === alloc.shareholderId);
        const defaultEmail = alloc.shareholderEmail || sh?.email || '';
        setEmailModalAddress(defaultEmail);
        setEmailModal({ alloc, i });
    }

    async function submitEmailVoucher() {
        if (!emailModal) return;
        const { alloc, i } = emailModal;
        const toEmail = emailModalAddress.trim();
        if (!toEmail) { return; }
        const key = `voucher-${alloc.id || i}`;
        setEmailModalSending(true);
        setEmailSending(s => ({ ...s, [key]: true }));
        try {
            await emailDividendVoucher(currentDeclaration?.id, alloc.id, toEmail);
            setError('');
            setEmailModal(null);
        } catch (e) {
            setError(e.message);
        } finally {
            setEmailModalSending(false);
            setEmailSending(s => ({ ...s, [key]: false }));
        }
    }

    // ── Delete draft ──────────────────────────────────────────────────────────
    function askDelete(d) {
        setDeleteModalError('');
        setDeleteModal({ items: [{ id: d.id, ref: d.dividendRef, status: d.status, type: d.dividendType }] });
    }

    function askDeleteSelected() {
        setDeleteModalError('');
        const items = declarations
            .filter(d => selectedIds.has(d.id))
            .map(d => ({ id: d.id, ref: d.dividendRef, status: d.status, type: d.dividendType }));
        if (items.length === 0) return;
        setDeleteModal({ items });
    }

    async function confirmDelete() {
        if (!deleteModal) return;
        setDeleteModalDeleting(true);
        setDeleteModalError('');
        const failed = [];
        let anySucceeded = false;
        for (const item of deleteModal.items) {
            try {
                await deleteDividend(item.id);
                anySucceeded = true;
            } catch (e) {
                if (e.status === 403) {
                    failed.push(`${item.ref}: Deletion is disabled — enable "Allow Dividend Deletion" in Settings → Compliance.`);
                } else {
                    failed.push(`${item.ref}: ${e.message}`);
                }
            }
        }
        setDeleteModalDeleting(false);
        // Always reload if at least one succeeded so the list reflects the change
        if (anySucceeded) await loadDeclarations();
        if (failed.length > 0) {
            setDeleteModalError(failed.join('\n'));
        } else {
            setDeleteModal(null);
            setSelectedIds(new Set());
        }
    }

    function toggleSelect(id) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function toggleSelectAll() {
        if (selectedIds.size === declarations.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(declarations.map(d => d.id)));
        }
    }

    // ── Quick vouchers / minutes ──────────────────────────────────────────────
    async function openQuickVouchers(declaration) {
        setQuickViewLoading(true);
        setError('');
        try {
            const full = await getDividendById(declaration.id);
            if (shareholders.length === 0) {
                const sh = await getShareholders();
                setShareholders(sh.filter(s => s.isActive));
            }
            setQuickViewModal({ declaration: full, allocations: full.allocations ?? [], mode: 'vouchers' });
        } catch (e) {
            setError(e.message);
        } finally {
            setQuickViewLoading(false);
        }
    }

    function openQuickMinutes(declaration) {
        downloadPdf(
            getDividendMinutesPdfUrl(declaration.id),
            `${declaration.dividendRef}-Board-Minutes.pdf`
        );
    }

    // ── Allocation row helpers ────────────────────────────────────────────────
    function updateAlloc(idx, field, value) {
        setAllocations(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
    }

    const grandTotal = allocations.reduce((sum, a) => {
        const rate = parseFloat(a.amountPerShare) || 0;
        return sum + (a.numberOfShares ?? 0) * rate;
    }, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="dividends-page">
            <div className="page-header">
                <div>
                    <h1>💰 Dividends</h1>
                    <p className="page-subtitle">Declare, document and pay shareholder dividends</p>
                </div>
                <button className="btn-primary" onClick={openNew}>+ Declare Dividend</button>
            </div>

            {error && !wizardOpen && (
                <div className="alert alert-error" onClick={() => setError('')}>{error} ✕</div>
            )}

            {/* ── Declarations list ────────────────────────────────────────── */}
            {loading ? (
                <div className="loading-spinner">Loading…</div>
            ) : declarations.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">💰</div>
                    <h3>No dividends declared yet</h3>
                    <p>Use the button above to start the dividend declaration process.</p>
                </div>
            ) : (
                <>
                {selectedIds.size > 0 && (
                    <div className="select-bar">
                        <span>{selectedIds.size} selected</span>
                        <button className="btn-danger" onClick={askDeleteSelected}>🗑 Delete Selected ({selectedIds.size})</button>
                        <button className="btn-secondary" style={{ fontSize: '0.82rem', padding: '6px 14px' }} onClick={() => setSelectedIds(new Set())}>✕ Clear</button>
                    </div>
                )}
                <div className="table-card">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: 36, textAlign: 'center' }}>
                                    <input type="checkbox"
                                        className="row-checkbox"
                                        checked={declarations.length > 0 && selectedIds.size === declarations.length}
                                        onChange={toggleSelectAll}
                                        title="Select all"
                                    />
                                </th>
                                <th>Reference</th>
                                <th>Type</th>
                                <th>Share Class</th>
                                <th>Meeting Date</th>
                                <th>Payment Date</th>
                                <th style={{textAlign:'right'}}>Per Share</th>
                                <th style={{textAlign:'right'}}>Total</th>
                                <th style={{textAlign:'center'}}>Shareholders</th>
                                <th style={{textAlign:'center'}}>Status</th>
                                <th style={{textAlign:'right'}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {declarations.map(d => (
                                <tr key={d.id} className={selectedIds.has(d.id) ? 'row-selected' : ''}>
                                    <td style={{ textAlign: 'center' }}>
                                        <input type="checkbox"
                                            className="row-checkbox"
                                            checked={selectedIds.has(d.id)}
                                            onChange={() => toggleSelect(d.id)}
                                        />
                                    </td>
                                    <td><strong className="mono-ref">{d.dividendRef}</strong></td>
                                    <td><span className="type-badge">{d.dividendType}</span></td>
                                    <td>{d.shareClass}</td>
                                    <td className="date-cell">{fmtDate(d.meetingDate)}</td>
                                    <td className="date-cell">{fmtDate(d.paymentDate)}</td>
                                    <td style={{textAlign:'right', fontFamily:'monospace', fontSize:'0.85rem'}}>£{parseFloat(d.amountPerShare).toFixed(4)}</td>
                                    <td style={{textAlign:'right'}}><strong>{fmt(d.totalAmount)}</strong></td>
                                    <td style={{textAlign:'center'}}><span className="count-pill">{d.allocationCount}</span></td>
                                    <td style={{textAlign:'center'}}>
                                        <span className={`status-badge ${d.status === 'Finalised' ? 'status-paid' : 'status-draft'}`}>
                                            {d.status === 'Finalised' ? '✅ Finalised' : '📝 Draft'}
                                        </span>
                                    </td>
                                    <td className="actions-cell">
                                        {d.status === 'Draft' ? (
                                            <button className="btn-sm btn-secondary" onClick={() => openDraft(d)}>✏️ Resume</button>
                                        ) : (
                                            <button className="btn-sm btn-secondary" onClick={() => openDraft(d)}>👁 View</button>
                                        )}
                                        {d.status === 'Finalised' && (
                                            <button className="btn-sm btn-secondary" onClick={() => openQuickVouchers(d)}>🧾 Vouchers</button>
                                        )}
                                        <button className="btn-sm btn-secondary" onClick={() => openQuickMinutes(d)}>📋 Minutes</button>
                                        <button className="btn-sm btn-danger" onClick={() => askDelete(d)}>🗑 Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
            )}

            {/* ── Wizard modal ─────────────────────────────────────────────── */}
            {wizardOpen && (
                <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeWizard()}>
                    <div className="wizard-modal">
                        {/* Progress bar */}
                        <div className="wizard-header">
                            <h2>
                                {currentDeclaration?.dividendRef
                                    ? `${currentDeclaration.dividendRef} — `
                                    : ''}
                                Dividend Declaration
                            </h2>
                            <button className="modal-close" onClick={closeWizard}>✕</button>
                        </div>

                        <div className="wizard-steps">
                            {STEPS.map(s => (
                                <div
                                    key={s.id}
                                    className={`wizard-step ${wizardStep === s.id ? 'active' : ''} ${wizardStep > s.id ? 'done' : ''}`}
                                    onClick={() => wizardStep > s.id && currentDeclaration?.status !== 'Finalised' && setWizardStep(s.id)}
                                >
                                    <div className="step-circle">
                                        {wizardStep > s.id ? '✓' : s.emoji}
                                    </div>
                                    <div className="step-label">{s.label}</div>
                                </div>
                            ))}
                        </div>

                        {error && (
                            <div className="alert alert-error wizard-error" onClick={() => setError('')}>{error} ✕</div>
                        )}

                        <div className="wizard-body">
                            {/* ──── STEP 1: Declare ──────────────────────────── */}
                            {wizardStep === 1 && (
                                <div className="wizard-pane">
                                    <h3>Step 1 — Declare the Dividend</h3>
                                    <p className="step-hint">Enter the details of the dividend declaration as they will appear in the board minutes.</p>

                                    <div className="form-grid-2">
                                        <div className="form-group">
                                            <label>Dividend Type *</label>
                                            <select
                                                value={formData.dividendType}
                                                onChange={e => setFormData(f => ({ ...f, dividendType: e.target.value }))}
                                            >
                                                <option value="Interim">Interim</option>
                                                <option value="Final">Final</option>
                                                <option value="Special">Special</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Share Class *</label>
                                            <input
                                                type="text"
                                                value={formData.shareClass}
                                                onChange={e => setFormData(f => ({ ...f, shareClass: e.target.value }))}
                                                placeholder="e.g. A Ordinary, Ordinary"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Meeting Date *</label>
                                            <input
                                                type="date"
                                                value={formData.meetingDate}
                                                onChange={e => setFormData(f => ({ ...f, meetingDate: e.target.value }))}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Meeting Location</label>
                                            <input
                                                type="text"
                                                value={formData.meetingLocation}
                                                onChange={e => setFormData(f => ({ ...f, meetingLocation: e.target.value }))}
                                                placeholder="e.g. Registered Office"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Record Date *</label>
                                            <input
                                                type="date"
                                                value={formData.recordDate}
                                                onChange={e => setFormData(f => ({ ...f, recordDate: e.target.value }))}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Payment Date *</label>
                                            <input
                                                type="date"
                                                value={formData.paymentDate}
                                                onChange={e => setFormData(f => ({ ...f, paymentDate: e.target.value }))}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Director Name</label>
                                            {directors.length > 0 ? (
                                                <select
                                                    value={formData.directorName}
                                                    onChange={e => setFormData(f => ({ ...f, directorName: e.target.value }))}
                                                >
                                                    {directors.map(d => (
                                                        <option key={d.id} value={d.name}>{d.name}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={formData.directorName}
                                                    onChange={e => setFormData(f => ({ ...f, directorName: e.target.value }))}
                                                    placeholder="e.g. John Smith"
                                                />
                                            )}
                                        </div>
                                        <div className="form-group form-group-full">
                                            <label>Notes</label>
                                            <textarea
                                                rows={2}
                                                value={formData.notes}
                                                onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                                                placeholder="Optional notes for this dividend"
                                            />
                                        </div>
                                    </div>

                                    <div className="info-box">
                                        💡 <strong>Rates are set in Step 2</strong> — you can set different rates per share class (e.g. A Ordinary at £1,500 and B Ordinary at £10). The board minutes will show a breakdown per class.
                                    </div>
                                </div>
                            )}

                            {/* ──── STEP 2: Allocate ─────────────────────────── */}
                            {wizardStep === 2 && (
                                <div className="wizard-pane">
                                    <h3>Step 2 — Review Shareholder Allocations</h3>
                                    <p className="step-hint">
                                        Verify each shareholder's allocation and enter their bank details for the BAC payment file.
                                    </p>

                                    {allocations.length === 0 ? (
                                        <div className="alert alert-warning">
                                            No active shareholders found for share class "{formData.shareClass}".
                                            Please add shareholders in the Shareholders section first.
                                        </div>
                                    ) : (
                                        <>
                                            <div className="alloc-table-wrapper">
                                                <table className="data-table alloc-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Shareholder</th>
                                                            <th>Share Class</th>
                                                            <th>Shares</th>
                                                            <th>Rate/Share (£)</th>
                                                            <th>Total</th>
                                                            <th>Bank Account Name</th>
                                                            <th>Sort Code</th>
                                                            <th>Account No.</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {allocations.map((alloc, i) => {
                                                            const rate = parseFloat(alloc.amountPerShare) || 0;
                                                            const total = (alloc.numberOfShares ?? 0) * rate;
                                                            return (
                                                                <tr key={i}>
                                                                    <td><strong>{alloc.shareholderName}</strong></td>
                                                                    <td>{alloc.shareClass}</td>
                                                                    <td>
                                                                        <input
                                                                            type="number"
                                                                            className="inline-input inline-input-sm"
                                                                            value={alloc.numberOfShares ?? 0}
                                                                            onChange={e => updateAlloc(i, 'numberOfShares', parseInt(e.target.value) || 0)}
                                                                        />
                                                                    </td>
                                                                    <td>
                                                                        <input
                                                                            type="number"
                                                                            step="0.0001"
                                                                            min="0"
                                                                            className="inline-input inline-input-rate"
                                                                            value={alloc.amountPerShare ?? ''}
                                                                            onChange={e => updateAlloc(i, 'amountPerShare', e.target.value)}
                                                                            placeholder="0.0000"
                                                                        />
                                                                    </td>
                                                                    <td><strong>{fmt(total)}</strong></td>
                                                                    <td>
                                                                        <input
                                                                            type="text"
                                                                            className="inline-input"
                                                                            value={alloc.bankAccountName ?? ''}
                                                                            onChange={e => updateAlloc(i, 'bankAccountName', e.target.value)}
                                                                            placeholder="Account name"
                                                                        />
                                                                    </td>
                                                                    <td>
                                                                        <input
                                                                            type="text"
                                                                            className="inline-input inline-input-sc"
                                                                            value={alloc.sortCode ?? ''}
                                                                            onChange={e => updateAlloc(i, 'sortCode', e.target.value)}
                                                                            placeholder="00-00-00"
                                                                            maxLength={8}
                                                                        />
                                                                    </td>
                                                                    <td>
                                                                        <input
                                                                            type="text"
                                                                            className="inline-input inline-input-ac"
                                                                            value={alloc.accountNumber ?? ''}
                                                                            onChange={e => updateAlloc(i, 'accountNumber', e.target.value)}
                                                                            placeholder="12345678"
                                                                            maxLength={8}
                                                                        />
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr>
                                                            <td colSpan={4}><strong>Grand Total</strong></td>
                                                            <td><strong style={{ color: '#166534', fontSize: '1.1em' }}>{fmt(grandTotal)}</strong></td>
                                                            <td colSpan={3}></td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                            <div className="info-box">
                                                💡 Bank details are used to generate the BAC CSV payment file emailed to your payroll address at finalisation.
                                                If a shareholder has no bank details, leave blank — you can still proceed.
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* ──── STEP 3: Board Minutes ────────────────────── */}
                            {wizardStep === 3 && (
                                <div className="wizard-pane">
                                    <h3>Step 3 — Board Minutes</h3>
                                    <p className="step-hint">
                                        Your board minutes have been prepared based on the declaration details.
                                        Download and sign before proceeding.
                                    </p>

                                    <div className="minutes-preview">
                                        <div className="minutes-field-grid">
                                            <div><span className="field-label">Reference:</span> {currentDeclaration?.dividendRef}</div>
                                            <div><span className="field-label">Dividend Type:</span> {formData.dividendType}</div>
                                            <div><span className="field-label">Share Class:</span> {formData.shareClass}</div>
                                            <div><span className="field-label">Meeting Date:</span> {fmtDate(formData.meetingDate)}</div>
                                            <div><span className="field-label">Meeting Location:</span> {formData.meetingLocation || 'Registered Office'}</div>
                                            <div><span className="field-label">Record Date:</span> {fmtDate(formData.recordDate)}</div>
                                            <div><span className="field-label">Payment Date:</span> {fmtDate(formData.paymentDate)}</div>
                                            <div style={{gridColumn:'1/-1'}}>
                                                <span className="field-label">Dividend Rates:</span>
                                                {Object.values(
                                                    allocations.reduce((acc, a) => {
                                                        const k = `${a.shareClass}||${a.amountPerShare}`;
                                                        if (!acc[k]) acc[k] = { shareClass: a.shareClass, rate: parseFloat(a.amountPerShare) || 0, total: 0 };
                                                        acc[k].total += parseFloat(a.totalAmount) || (a.numberOfShares ?? 0) * acc[k].rate;
                                                        return acc;
                                                    }, {})
                                                ).map((g, i) => (
                                                    <span key={i} style={{marginLeft: 8, display:'inline-block', marginTop: 4}}>
                                                        <strong>{g.shareClass}</strong> @ £{g.rate.toFixed(4)}/share
                                                        {' '}= <strong style={{color:'#166534'}}>{fmt(g.total)}</strong>
                                                        {' '}
                                                    </span>
                                                ))}
                                            </div>
                                            <div><span className="field-label">Total Amount:</span> <strong>{fmt(grandTotal)}</strong></div>
                                            <div><span className="field-label">Director:</span> {formData.directorName || '—'}</div>
                                        </div>
                                    </div>

                                    <div className="download-actions">
                                        <button
                                            className="btn-primary btn-download"
                                            disabled={pdfLoading[`minutes-${currentDeclaration?.id}`]}
                                            onClick={() => downloadPdf(
                                                getDividendMinutesPdfUrl(currentDeclaration?.id),
                                                `${currentDeclaration?.dividendRef}-Board-Minutes.pdf`
                                            )}
                                        >
                                            {pdfLoading[`minutes-${currentDeclaration?.id}`] ? '⏳ Generating…' : '📄 Download Board Minutes PDF'}
                                        </button>
                                    </div>

                                    <div className="info-box info-box-blue">
                                        📌 Keep a signed copy of the board minutes with your company records. This is a legal requirement for declaring a dividend.
                                    </div>
                                </div>
                            )}

                            {/* ──── STEP 4: Vouchers ────────────────────────── */}
                            {wizardStep === 4 && (
                                <div className="wizard-pane">
                                    <h3>Step 4 — Dividend Vouchers</h3>
                                    <p className="step-hint">
                                        Download an individual dividend voucher for each shareholder. Send these to each recipient.
                                    </p>

                    <div className="voucher-list">
                        {allocations.map((alloc, i) => {
                            const rate = parseFloat(alloc.amountPerShare) || 0;
                            const total = parseFloat(alloc.totalAmount) || (alloc.numberOfShares ?? 0) * rate;
                            const key = `voucher-${alloc.id || i}`;
                            return (
                                <div key={i} className="voucher-row">
                                    <div className="voucher-info">
                                        <div className="voucher-name">{alloc.shareholderName}</div>
                                        <div className="voucher-meta">
                                            <span className="voucher-ref">{alloc.voucherRef || '—'}</span>
                                            <span className="voucher-sep">·</span>
                                            <span className="voucher-detail">{alloc.numberOfShares?.toLocaleString()} shares × £{rate.toFixed(4)}</span>
                                        </div>
                                    </div>
                                    <div className="voucher-amount-block">
                                        <span className="voucher-amount">{fmt(total)}</span>
                                    </div>
                                    <div className="voucher-actions">
                                        <button
                                            className="btn-secondary btn-sm"
                                            disabled={!alloc.id || pdfLoading[key]}
                                            onClick={() => downloadPdf(
                                                getDividendVoucherPdfUrl(currentDeclaration?.id, alloc.id),
                                                `${alloc.voucherRef || currentDeclaration?.dividendRef}-Voucher-${alloc.shareholderName.replace(/\s+/g, '-')}.pdf`
                                            )}
                                        >
                                            {pdfLoading[key] ? '⏳' : '🧾 Download'}
                                        </button>
                                        <button
                                            className="btn-secondary btn-sm"
                                            disabled={!alloc.id || emailSending[key]}
                                            onClick={() => handleEmailVoucher(alloc, i)}
                                        >
                                            {emailSending[key] ? '⏳' : '✉️ Email'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                                    <div className="info-box info-box-green">
                                        ✉️ Send each shareholder their voucher by email or post. Keep a copy in your company records alongside the board minutes.
                                    </div>
                                </div>
                            )}

                            {/* ──── STEP 5: Finalise ───────────────────────── */}
                            {wizardStep === 5 && (
                                <div className="wizard-pane">
                                    {finaliseResult ? (
                                        // Success state
                                        <div className="finalise-success">
                                            <div className="success-icon">✅</div>
                                            <h3>Dividend Finalised!</h3>
                                            <p>{finaliseResult.message}</p>
                                            <div className="finalise-summary">
                                                <div><span>Reference:</span> <strong>{finaliseResult.dividendRef}</strong></div>
                                                <div><span>Total Amount:</span> <strong>{fmt(finaliseResult.totalAmount)}</strong></div>
                                                <div><span>Shareholders:</span> <strong>{finaliseResult.allocationCount}</strong></div>
                                                <div><span>Ledger Entries Created:</span> <strong>{finaliseResult.ledgerEntriesCreated}</strong></div>
                                                <div><span>BAC File Emailed to:</span> <strong>{finaliseResult.bacEmailSentTo}</strong></div>
                                            </div>
                                            <div style={{marginTop: '20px'}}>
                                                <button className="btn-primary" onClick={closeWizard}>Done</button>
                                            </div>
                                        </div>
                                    ) : currentDeclaration?.status === 'Finalised' ? (
                                        // Already finalised — view only
                                        <div className="finalise-success">
                                            <div className="success-icon">✅</div>
                                            <h3>This dividend is finalised</h3>
                                            <p>Reference: <strong>{currentDeclaration?.dividendRef}</strong></p>
                                            <p>Total: <strong>{fmt(currentDeclaration?.totalAmount)}</strong></p>
                                            <p>Finalised: <strong>{fmtDate(currentDeclaration?.finalisedDate)}</strong></p>
                                            <button className="btn-secondary" onClick={closeWizard}>Close</button>
                                        </div>
                                    ) : (
                                        // Pre-finalise confirmation
                                        <>
                                            <h3>Step 5 — Finalise &amp; Pay</h3>
                                            <p className="step-hint">
                                                Review the summary below. When you click <strong>Finalise</strong>, this will:
                                            </p>
                                            <ul className="finalise-actions-list">
                                                <li>✅ Create a <strong>Dividend Declared</strong> ledger entry for {fmt(grandTotal)}</li>
                                                <li>✅ Create <strong>{allocations.length} Dividend Paid</strong> ledger entries (one per shareholder)</li>
                                                <li>✅ Email the <strong>BAC payment CSV</strong> to your payroll email address</li>
                                                <li>✅ Lock this declaration as <strong>Finalised</strong> (cannot be edited)</li>
                                            </ul>

                                            <div className="finalise-summary-preview">
                                                <div className="summary-row">
                                                    <span>Dividend Reference</span>
                                                    <strong>{currentDeclaration?.dividendRef}</strong>
                                                </div>
                                                <div className="summary-row">
                                                    <span>Type</span>
                                                    <strong>{formData.dividendType}</strong>
                                                </div>
                                                <div className="summary-row">
                                                    <span>Payment Date</span>
                                                    <strong>{fmtDate(formData.paymentDate)}</strong>
                                                </div>
                                                <div className="summary-row">
                                                    <span>Shareholders</span>
                                                    <strong>{allocations.length}</strong>
                                                </div>
                                                <div className="summary-row summary-total">
                                                    <span>Total Payment</span>
                                                    <strong>{fmt(grandTotal)}</strong>
                                                </div>
                                            </div>

                                            <div className="info-box info-box-amber">
                                                ⚠️ Once finalised this dividend cannot be edited or deleted. Make sure you have downloaded and signed the board minutes and distributed the vouchers before proceeding.
                                            </div>

                                            <div className="finalise-btn-row">
                                                <button className="btn-secondary" onClick={() => setWizardStep(4)}>← Back</button>
                                                <button
                                                    className="btn-success btn-large"
                                                    onClick={handleFinalise}
                                                    disabled={finalising}
                                                >
                                                    {finalising ? '⏳ Finalising…' : '✅ Finalise Dividend'}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── Wizard footer nav ──────────────────────────────── */}
                        {wizardStep < 5 && (
                            <div className="wizard-footer">
                                <button
                                    className="btn-secondary"
                                    onClick={() => wizardStep > 1 ? setWizardStep(s => s - 1) : closeWizard()}
                                >
                                    {wizardStep === 1 ? 'Cancel' : '← Back'}
                                </button>
                                <div className="step-counter">{wizardStep} of {STEPS.length}</div>
                                <button
                                    className="btn-primary"
                                    onClick={() => goToStep(wizardStep + 1)}
                                    disabled={saving}
                                >
                                    {saving ? '⏳ Saving…'
                                        : wizardStep === 4 ? 'Finalise →'
                                        : 'Next →'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Delete Confirm Modal ─────────────────────────────────── */}
            {deleteModal && (
                <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={e => e.target === e.currentTarget && !deleteModalDeleting && setDeleteModal(null)}>
                    <div className="delete-confirm-modal">
                        <div className="dcm-header">
                            <div className="dcm-icon">🗑️</div>
                            <div>
                                <h3>Delete {deleteModal.items.length === 1 ? 'Dividend' : `${deleteModal.items.length} Dividends`}</h3>
                                <p>This will permanently remove the selected declaration{deleteModal.items.length !== 1 ? 's' : ''} and all associated ledger entries. This cannot be undone.</p>
                            </div>
                        </div>

                        <div className="dcm-list">
                            {deleteModal.items.map(item => (
                                <div key={item.id} className="dcm-item">
                                    <span className="mono-ref" style={{ flex: 1 }}>{item.ref}</span>
                                    <span className="type-badge">{item.type}</span>
                                    <span className={`status-badge ${item.status === 'Finalised' ? 'status-paid' : 'status-draft'}`}>
                                        {item.status === 'Finalised' ? '✅ Finalised' : '📝 Draft'}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {deleteModalError && (
                            <div className="dcm-error">{deleteModalError}</div>
                        )}

                        <div className="dcm-footer">
                            <button className="btn-secondary" onClick={() => setDeleteModal(null)} disabled={deleteModalDeleting}>Cancel</button>
                            <button className="btn-danger" style={{ padding: '8px 20px' }} onClick={confirmDelete} disabled={deleteModalDeleting}>
                                {deleteModalDeleting ? '⏳ Deleting…' : `🗑 Delete${deleteModal.items.length > 1 ? ` All ${deleteModal.items.length}` : ''}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Email Voucher Modal ──────────────────────────────────── */}
            {emailModal && (
                <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => e.target === e.currentTarget && setEmailModal(null)}>
                    <div className="email-voucher-modal">
                        <div className="evm-header">
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#1e293b' }}>✉️ Email Dividend Voucher</h3>
                                <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: '#64748b' }}>
                                    {emailModal.alloc.shareholderName} &mdash; {emailModal.alloc.voucherRef || currentDeclaration?.dividendRef}
                                </p>
                            </div>
                            <button className="modal-close" onClick={() => setEmailModal(null)}>✕</button>
                        </div>

                        <div className="evm-body">
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: '0.85rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ color: '#64748b' }}>Shareholder</span>
                                    <strong>{emailModal.alloc.shareholderName}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ color: '#64748b' }}>Amount</span>
                                    <strong style={{ color: '#166534' }}>{fmt(emailModal.alloc.totalAmount || (emailModal.alloc.numberOfShares ?? 0) * (parseFloat(emailModal.alloc.amountPerShare) || 0))}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#64748b' }}>Voucher Ref</span>
                                    <span>{emailModal.alloc.voucherRef || '—'}</span>
                                </div>
                            </div>

                            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', color: '#475569', marginBottom: 6 }}>
                                Send to email address
                            </label>
                            <input
                                type="email"
                                autoFocus
                                style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: '0.95rem', boxSizing: 'border-box' }}
                                value={emailModalAddress}
                                onChange={e => setEmailModalAddress(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && submitEmailVoucher()}
                                placeholder="recipient@example.com"
                            />
                            {!emailModalAddress.trim() && (
                                <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>No email address on file — please enter one above.</p>
                            )}
                        </div>

                        <div className="evm-footer">
                            <button className="btn-secondary" onClick={() => setEmailModal(null)}>Cancel</button>
                            <button
                                className="btn-primary"
                                disabled={!emailModalAddress.trim() || emailModalSending}
                                onClick={submitEmailVoucher}
                            >
                                {emailModalSending ? '⏳ Sending…' : '✉️ Send Voucher'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Quick Vouchers Modal ─────────────────────────────────── */}
            {quickViewModal && (
                <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => e.target === e.currentTarget && setQuickViewModal(null)}>
                    <div className="quick-view-modal">
                        <div className="qvm-header">
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>
                                    🧾 Dividend Vouchers — {quickViewModal.declaration.dividendRef}
                                </h3>
                                <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: '#64748b' }}>
                                    {quickViewModal.declaration.dividendType} · {quickViewModal.declaration.shareClass} · {fmtDate(quickViewModal.declaration.paymentDate)}
                                </p>
                            </div>
                            <button className="modal-close" onClick={() => setQuickViewModal(null)}>✕</button>
                        </div>

                        <div className="qvm-body">
                            {quickViewModal.allocations.length === 0 ? (
                                <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>No allocations found.</p>
                            ) : quickViewModal.allocations.map((alloc, i) => {
                                const rate  = parseFloat(alloc.amountPerShare) || 0;
                                const total = parseFloat(alloc.totalAmount) || ((alloc.numberOfShares ?? 0) * rate);
                                const key   = `qv-${alloc.id || i}`;
                                return (
                                    <div key={key} className="qvm-row">
                                        <div className="qvm-info">
                                            <div className="qvm-name">{alloc.shareholderName}</div>
                                            <div className="qvm-meta">
                                                <span className="mono-ref">{alloc.voucherRef || '—'}</span>
                                                <span style={{ margin: '0 6px', color: '#cbd5e1' }}>·</span>
                                                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                                                    {(alloc.numberOfShares ?? 0).toLocaleString()} shares × £{rate.toFixed(4)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="qvm-amount">{fmt(total)}</div>
                                        <div className="qvm-actions">
                                            <button
                                                className="btn-secondary btn-sm"
                                                disabled={!alloc.id || !!pdfLoading[key]}
                                                onClick={() => downloadPdf(
                                                    getDividendVoucherPdfUrl(quickViewModal.declaration.id, alloc.id),
                                                    `${alloc.voucherRef || quickViewModal.declaration.dividendRef}-${alloc.shareholderName.replace(/\s+/g, '-')}.pdf`
                                                )}
                                            >
                                                {pdfLoading[key] ? '⏳' : '🧾 Download'}
                                            </button>
                                            <button
                                                className="btn-secondary btn-sm"
                                                disabled={!alloc.id || !!emailSending[key]}
                                                onClick={() => {
                                                    setCurrentDeclaration(quickViewModal.declaration);
                                                    handleEmailVoucher(alloc, i);
                                                }}
                                            >
                                                {emailSending[key] ? '⏳' : '✉️ Email'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="qvm-footer">
                            <button className="btn-secondary" onClick={() => setQuickViewModal(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .dividends-page { max-width: 1300px; margin: 0 auto; padding: 24px; }
                .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
                .page-header h1 { margin: 0; font-size: 1.75rem; color: #1e293b; }
                .page-subtitle { margin: 4px 0 0; color: #64748b; font-size: 0.9rem; }

                .status-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.78rem; font-weight: 600; white-space: nowrap; }
                .status-paid { background: #dcfce7; color: #166534; }
                .status-draft { background: #fef9c3; color: #854d0e; }
                .type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.78rem; font-weight: 600; background: #eff6ff; color: #1d4ed8; }
                .count-pill { display: inline-block; background: #f1f5f9; color: #475569; border-radius: 10px; padding: 2px 8px; font-size: 0.8rem; font-weight: 600; }
                .mono-ref { font-family: 'Courier New', monospace; font-size: 0.82rem; letter-spacing: 0.02em; }
                .date-cell { white-space: nowrap; font-size: 0.85rem; color: #475569; }

                /* ── Wizard modal ── */
                .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
                .wizard-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 920px; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0,0,0,0.22); }
                .wizard-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 28px 0; }
                .wizard-header h2 { margin: 0; font-size: 1.2rem; color: #1e293b; }
                .modal-close { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #94a3b8; padding: 4px 8px; border-radius: 6px; }
                .modal-close:hover { color: #ef4444; background: #fef2f2; }

                /* ── Step indicators ── */
                .wizard-steps { display: flex; align-items: flex-start; padding: 20px 28px 16px; border-bottom: 1px solid #e2e8f0; gap: 0; }
                .wizard-step { display: flex; flex-direction: column; align-items: center; flex: 1; cursor: default; position: relative; }
                .wizard-step:not(:last-child)::after { content: ''; position: absolute; top: 18px; left: 60%; right: -40%; height: 2px; background: #e2e8f0; z-index: 0; }
                .wizard-step.done:not(:last-child)::after { background: #22c55e; }
                .step-circle { width: 36px; height: 36px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; font-size: 1rem; font-weight: 700; color: #64748b; border: 2px solid #e2e8f0; transition: all 0.2s; z-index: 1; position: relative; }
                .wizard-step.active .step-circle { background: #2563EB; border-color: #2563EB; color: #fff; box-shadow: 0 0 0 4px rgba(37,99,235,0.15); }
                .wizard-step.done .step-circle { background: #dcfce7; border-color: #22c55e; color: #166534; }
                .step-label { font-size: 0.72rem; color: #94a3b8; margin-top: 6px; text-align: center; font-weight: 500; }
                .wizard-step.active .step-label { color: #2563EB; font-weight: 700; }
                .wizard-step.done { cursor: pointer; }
                .wizard-step.done .step-label { color: #16a34a; }

                /* ── Wizard body ── */
                .wizard-body { flex: 1; overflow-y: auto; padding: 24px 28px; }
                .wizard-pane h3 { margin: 0 0 4px; font-size: 1.05rem; color: #1e293b; }
                .step-hint { color: #64748b; font-size: 0.85rem; margin: 0 0 18px; }
                .wizard-error { margin: 0 24px 0; }

                /* ── Form grid ── */
                .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
                .form-group-full { grid-column: 1 / -1; }
                .form-group label { display: block; font-size: 0.78rem; font-weight: 600; color: #475569; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
                .form-group input, .form-group select, .form-group textarea {
                    width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
                    font-size: 0.9rem; color: #1e293b; background: #fff; box-sizing: border-box;
                }
                .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
                    outline: none; border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
                }

                /* ── Inline table inputs ── */
                .alloc-table-wrapper { overflow-x: auto; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 8px; }
                .alloc-table td { padding: 7px 8px; vertical-align: middle; }
                .inline-input { padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 5px; font-size: 0.83rem; width: 100%; min-width: 70px; }
                .inline-input:focus { outline: none; border-color: #2563EB; }
                .inline-input-sm { max-width: 72px; }
                .inline-input-rate { max-width: 90px; }
                .inline-input-sc { max-width: 88px; }
                .inline-input-ac { max-width: 100px; }

                /* ── Board minutes preview ── */
                .minutes-preview { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
                .minutes-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
                .field-label { font-weight: 600; color: #475569; font-size: 0.82rem; margin-right: 6px; }
                .download-actions { margin-bottom: 16px; }
                .btn-download { font-size: 0.95rem; padding: 12px 24px; }

                /* ── Voucher list ── */
                .voucher-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
                .voucher-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
                .voucher-info { min-width: 0; }
                .voucher-name { font-weight: 600; font-size: 0.95rem; color: #1e293b; margin-bottom: 3px; }
                .voucher-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
                .voucher-ref { background: #eff6ff; color: #2563EB; border-radius: 8px; padding: 1px 7px; font-size: 0.75rem; font-weight: 600; font-family: monospace; }
                .voucher-sep { color: #cbd5e1; }
                .voucher-detail { color: #94a3b8; font-size: 0.78rem; }
                .voucher-amount-block { text-align: right; }
                .voucher-amount { font-weight: 700; color: #166534; font-size: 1.05rem; }
                .voucher-actions { display: flex; gap: 6px; }

                /* ── Finalise ── */
                .finalise-actions-list { list-style: none; padding: 0; margin: 0 0 20px; }
                .finalise-actions-list li { padding: 6px 0; font-size: 0.9rem; color: #1e293b; }
                .finalise-summary-preview { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
                .summary-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 0.9rem; border-bottom: 1px solid #f1f5f9; }
                .summary-row:last-child { border: none; }
                .summary-total { font-size: 1.05rem; color: #166534; padding-top: 10px !important; }
                .finalise-btn-row { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
                .btn-success { background: #16a34a; color: #fff; border: none; border-radius: 7px; cursor: pointer; font-weight: 600; transition: background 0.2s; }
                .btn-success:hover { background: #15803d; }
                .btn-success:disabled { opacity: 0.6; cursor: not-allowed; }
                .btn-large { padding: 12px 28px; font-size: 1rem; }
                .finalise-success { text-align: center; padding: 24px; }
                .success-icon { font-size: 3rem; margin-bottom: 12px; }
                .finalise-summary { display: inline-block; text-align: left; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px 24px; margin: 16px 0; }
                .finalise-summary div { padding: 5px 0; font-size: 0.9rem; }
                .finalise-summary span { color: #64748b; margin-right: 8px; }

                /* ── Info boxes ── */
                .info-box { background: #f1f5f9; border-left: 4px solid #2563EB; padding: 12px 14px; border-radius: 4px; font-size: 0.85rem; color: #334155; margin-top: 12px; }
                .info-box-blue { background: #eff6ff; border-left-color: #2563EB; color: #1e40af; }
                .info-box-green { background: #f0fdf4; border-left-color: #16a34a; color: #166534; }
                .info-box-amber { background: #fffbeb; border-left-color: #f59e0b; color: #92400e; }

                /* ── Alerts ── */
                .alert { padding: 10px 14px; border-radius: 6px; font-size: 0.88rem; cursor: pointer; margin-bottom: 12px; }
                .alert-error { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
                .alert-warning { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }

                /* ── Wizard footer ── */
                .wizard-footer { display: flex; align-items: center; justify-content: space-between; padding: 16px 28px; border-top: 1px solid #e2e8f0; background: #f8fafc; border-radius: 0 0 14px 14px; }
                .step-counter { font-size: 0.82rem; color: #94a3b8; background: #e2e8f0; padding: 3px 10px; border-radius: 10px; }

                /* ── Misc ── */
                .btn-primary { background: #2563EB; color: #fff; border: none; padding: 9px 18px; border-radius: 7px; cursor: pointer; font-weight: 600; font-size: 0.9rem; }
                .btn-primary:hover { background: #1d4ed8; }
                .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
                .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 9px 18px; border-radius: 7px; cursor: pointer; font-weight: 500; font-size: 0.9rem; }
                .btn-secondary:hover { background: #e2e8f0; }
                .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
                .btn-sm { padding: 5px 12px; font-size: 0.8rem; }
                .btn-danger { background: #dc2626; color: #fff; border: 1px solid #b91c1c; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 500; }
                .btn-danger:hover { background: #b91c1c; border-color: #991b1b; }
                .actions-cell { display: flex; gap: 5px; justify-content: flex-end; align-items: center; flex-wrap: nowrap; white-space: nowrap; }
                .table-card { background: #fff; border-radius: 10px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
                .data-table { width: 100%; border-collapse: collapse; }
                .data-table th { background: #f8fafc; padding: 10px 12px; text-align: left; font-size: 0.73rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 2px solid #e2e8f0; }
                .data-table td { padding: 11px 12px; border-bottom: 1px solid #f1f5f9; font-size: 0.88rem; color: #1e293b; }
                .data-table tbody tr:hover { background: #fafbff; }
                .data-table tfoot td { background: #f8fafc; border-top: 2px solid #e2e8f0; }
                .empty-state { text-align: center; padding: 60px 24px; color: #64748b; }
                .empty-icon { font-size: 3rem; margin-bottom: 12px; }
                .loading-spinner { text-align: center; padding: 40px; color: #94a3b8; }

                /* ── Email voucher modal ── */
                .email-voucher-modal { background: #fff; border-radius: 12px; width: 100%; max-width: 440px; box-shadow: 0 24px 48px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden; }
                .evm-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 20px 20px 16px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
                .evm-body { padding: 20px; }
                .evm-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; }

                /* ── Select bar & checkboxes ── */
                .select-bar { display: flex; align-items: center; gap: 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 16px; margin-bottom: 12px; font-size: 0.88rem; font-weight: 600; color: #1d4ed8; }
                .select-bar span { flex: 1; }
                .row-checkbox { width: 16px; height: 16px; cursor: pointer; accent-color: #3b82f6; }
                .row-selected { background: #eff6ff !important; }
                .row-selected:hover { background: #dbeafe !important; }

                /* ── Delete confirm modal ── */
                .delete-confirm-modal { background: #fff; border-radius: 12px; width: 100%; max-width: 480px; box-shadow: 0 24px 48px rgba(0,0,0,0.3); overflow: hidden; }
                .dcm-header { display: flex; gap: 14px; align-items: flex-start; padding: 20px 24px 16px; border-bottom: 1px solid #fecaca; background: #fff5f5; }
                .dcm-icon { font-size: 2rem; line-height: 1; flex-shrink: 0; margin-top: 2px; }
                .dcm-header h3 { margin: 0; font-size: 1.05rem; color: #991b1b; }
                .dcm-header p { margin: 5px 0 0; font-size: 0.83rem; color: #7f1d1d; opacity: 0.85; }
                .dcm-list { padding: 10px 24px 4px; max-height: 220px; overflow-y: auto; }
                .dcm-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
                .dcm-item:last-child { border-bottom: none; }
                .dcm-error { margin: 8px 24px 0; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 0.82rem; color: #991b1b; white-space: pre-line; }
                .dcm-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid #e2e8f0; background: #f8fafc; margin-top: 12px; }

                /* ── Quick view (vouchers) modal ── */
                .quick-view-modal { background: #fff; border-radius: 12px; width: 100%; max-width: 700px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 24px 48px rgba(0,0,0,0.25); overflow: hidden; }
                .qvm-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 20px 24px 16px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; flex-shrink: 0; }
                .qvm-body { overflow-y: auto; padding: 16px 24px; flex: 1; }
                .qvm-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
                .qvm-row:last-child { border-bottom: none; }
                .qvm-info { flex: 1; min-width: 0; }
                .qvm-name { font-weight: 600; color: #1e293b; font-size: 0.95rem; }
                .qvm-meta { display: flex; align-items: center; margin-top: 2px; }
                .qvm-amount { font-weight: 700; color: #166534; font-size: 1rem; white-space: nowrap; min-width: 90px; text-align: right; }
                .qvm-actions { display: flex; gap: 6px; flex-shrink: 0; }
                .qvm-footer { display: flex; justify-content: flex-end; padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #f8fafc; flex-shrink: 0; }

                @media (max-width: 768px) {
                    .form-grid-2 { grid-template-columns: 1fr; }
                    .minutes-field-grid { grid-template-columns: 1fr; }
                    .wizard-steps { padding: 16px 16px 12px; }
                    .step-label { display: none; }
                    .voucher-row { grid-template-columns: 1fr; gap: 10px; }
                    .voucher-actions { flex-direction: row; }
                    .data-table th, .data-table td { padding: 8px; font-size: 0.8rem; }
                }
            `}</style>
        </div>
    );
}

