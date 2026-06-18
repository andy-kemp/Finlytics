import React, { useEffect, useState } from 'react';
import { getShareholders, createShareholder, updateShareholder, deleteShareholder, getShareClasses, sendShareholderCertificateEmail, getShareCertificateHtml } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';

export default function Shareholders() {
    const [shareholders, setShareholders] = useState([]);
    const [shareClasses, setShareClasses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const { toast, showToast, clearToast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [editingShareholder, setEditingShareholder] = useState(null);
    const [viewingShareholder, setViewingShareholder] = useState(null);
    const [certificateHtml, setCertificateHtml] = useState(null);
    const [loadingCert, setLoadingCert] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        shareholderType: 'Individual',
        shareClassId: '',
        isActive: true,
        sharesOwned: '',
        shareCertificateNumber: '',
        dateOfIssue: new Date().toISOString().split('T')[0],
        email: '',
        address: '',
        notes: '',
        bankAccountName: '',
        bankSortCode: '',
        accountNumber: ''
    });

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const [shareholdersData, shareClassesData] = await Promise.all([
                getShareholders(),
                getShareClasses()
            ]);
            setShareholders(shareholdersData);
            setShareClasses(shareClassesData);
        } catch (error) {
            console.error('Error loading shareholders:', error);
        } finally {
            setLoading(false);
        }
    }

    function openEdit(shareholder) {
        setViewingShareholder(null);
        setEditingShareholder(shareholder);
        setFormData({
            name: shareholder.name || '',
            shareholderType: shareholder.shareholderType || 'Individual',
            shareClassId: shareholder.shareClassId || '',
            isActive: shareholder.isActive ?? true,
            sharesOwned: shareholder.sharesOwned || '',
            shareCertificateNumber: shareholder.shareCertificateNumber || '',
            dateOfIssue: shareholder.dateOfIssue ? shareholder.dateOfIssue.split('T')[0] : '',
            email: shareholder.email || '',
            address: shareholder.address || '',
            notes: shareholder.notes || '',
            bankAccountName: shareholder.bankAccountName || '',
            bankSortCode: shareholder.bankSortCode || '',
            accountNumber: shareholder.accountNumber || ''
        });
        setShowForm(true);
    }

    function handleCancelEdit() {
        setShowForm(false);
        setEditingShareholder(null);
        setFormData({
            name: '',
            shareholderType: 'Individual',
            shareClassId: '',
            isActive: true,
            sharesOwned: '',
            shareCertificateNumber: '',
            dateOfIssue: new Date().toISOString().split('T')[0],
            email: '',
            address: '',
            notes: '',
            bankAccountName: '',
            bankSortCode: '',
            accountNumber: ''
        });
    }

    function openNew() {
        setEditingShareholder(null);
        setFormData({
            name: '',
            shareholderType: 'Individual',
            shareClassId: '',
            isActive: true,
            sharesOwned: '',
            shareCertificateNumber: '',
            dateOfIssue: new Date().toISOString().split('T')[0],
            email: '',
            address: '',
            notes: '',
            bankAccountName: '',
            bankSortCode: '',
            accountNumber: ''
        });
        setShowForm(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setProcessingMessage(editingShareholder ? 'Updating shareholder...' : 'Creating shareholder...');
        setProcessing(true);
        try {
            const shareholderData = {
                name: formData.name,
                shareholderType: formData.shareholderType,
                shareClassId: formData.shareClassId ? parseInt(formData.shareClassId) : null,
                isActive: formData.isActive,
                sharesOwned: formData.sharesOwned ? parseInt(formData.sharesOwned) : 0,
                shareCertificateNumber: formData.shareCertificateNumber,
                dateOfIssue: formData.dateOfIssue ? new Date(formData.dateOfIssue).toISOString() : null,
                email: formData.email,
                address: formData.address,
                notes: formData.notes,
                bankAccountName: formData.bankAccountName || null,
                bankSortCode: formData.bankSortCode || null,
                accountNumber: formData.accountNumber || null
            };

            if (editingShareholder) {
                await updateShareholder(editingShareholder.id, shareholderData);
                showToast('Shareholder updated successfully!', 'success');
            } else {
                await createShareholder(shareholderData);
                showToast('Shareholder created successfully!', 'success');
            }
            await loadData();
            handleCancelEdit();
        } catch (error) {
            console.error('Error saving shareholder:', error);
            showToast('Failed to save shareholder', 'error');
        } finally {
            setProcessing(false);
        }
    }

    async function handleDelete(id, name) {
        if (id === null || id === undefined || (typeof id === 'string' && id.trim() === '')) {
            showToast('Cannot delete: Invalid shareholder ID', 'error');
            return;
        }
        if (window.confirm(`Delete shareholder "${name}"?`)) {
            setProcessingMessage('Deleting shareholder...');
            setProcessing(true);
            try {
                await deleteShareholder(id);
                showToast('Shareholder deleted successfully!', 'success');
                setViewingShareholder(null);
                await loadData();
            } catch (error) {
                console.error('Error deleting shareholder:', error);
                showToast('Failed to delete shareholder', 'error');
            } finally {
                setProcessing(false);
            }
        }
    }

    async function handleEmailCertificate(shareholder) {
        if (!shareholder?.id) {
            showToast('Cannot email: Invalid shareholder ID', 'error');
            return;
        }

        const defaultEmail = shareholder.email || '';
        const toEmail = window.prompt('Send share certificate to:', defaultEmail);
        if (toEmail === null) return;

        if (!toEmail.trim()) {
            showToast('Email address is required', 'warning');
            return;
        }

        setProcessingMessage('Sending share certificate...');
        setProcessing(true);
        try {
            await sendShareholderCertificateEmail(shareholder.id, toEmail.trim());
            showToast(`Share certificate emailed to ${toEmail.trim()}`, 'success');
        } catch (error) {
            console.error('Error emailing share certificate:', error);
            showToast('Failed to email share certificate: ' + error.message, 'error');
        } finally {
            setProcessing(false);
        }
    }

    async function handleViewCertificate(shareholder) {
        setLoadingCert(true);
        try {
            const html = await getShareCertificateHtml(shareholder.id);
            setCertificateHtml(html);
        } catch (error) {
            showToast('Failed to load certificate: ' + error.message, 'error');
        } finally {
            setLoadingCert(false);
        }
    }

    const getShareClassName = (sh) => {
        if (sh.shareClassName) return sh.shareClassName;
        const sc = shareClasses.find(c => c.id === sh.shareClassId);
        return sc?.displayName || sc?.name || '—';
    };

    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <div className="loading-text">Loading shareholders...</div>
            </div>
        );
    }

    if (processing) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <div className="loading-text">{processingMessage || 'Please wait...'}</div>
            </div>
        );
    }

    return (
        <div className="shareholders-container">
            <Toast toast={toast} onClose={clearToast} />
            <div className="page-header">
                <h1>Shareholders</h1>
                <button onClick={openNew} className="btn-primary">
                    + New Shareholder
                </button>
            </div>

            {showForm && (
                <div className="modal-overlay" onClick={() => !processing && handleCancelEdit()}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}
                         style={{ maxWidth: '560px', width: '95%' }}>
                        <div className="modal-header">
                            <h3 style={{ margin: 0 }}>
                                {editingShareholder ? `Edit — ${editingShareholder.name}` : 'New Shareholder'}
                            </h3>
                            <button className="btn-close" onClick={handleCancelEdit} disabled={processing}>✕</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body" style={{ padding: '1.25rem' }}>

                                <div className="form-group">
                                    <label>Shareholder Name <span style={{ color: '#dc2626' }}>*</span></label>
                                    <input type="text" value={formData.name} required autoFocus
                                        onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Type <span style={{ color: '#dc2626' }}>*</span></label>
                                        <select value={formData.shareholderType} required
                                            onChange={e => setFormData({ ...formData, shareholderType: e.target.value })}>
                                            <option value="Individual">Individual</option>
                                            <option value="Corporate">Corporate</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Share Class</label>
                                        <select value={formData.shareClassId}
                                            onChange={e => setFormData({ ...formData, shareClassId: e.target.value })}>
                                            <option value="">Select share class…</option>
                                            {shareClasses.map(sc => (
                                                <option key={sc.id} value={sc.id}>{sc.displayName || sc.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Shares Owned</label>
                                        <input type="text" inputMode="numeric" value={formData.sharesOwned}
                                            onChange={e => {
                                                const v = e.target.value;
                                                if (v === '' || /^\d+$/.test(v)) setFormData({ ...formData, sharesOwned: v });
                                            }} />
                                    </div>
                                    <div className="form-group">
                                        <label>Certificate No</label>
                                        <input type="text" value={formData.shareCertificateNumber} readOnly
                                            placeholder="Auto-generated"
                                            style={{ background: '#f3f4f6', cursor: 'not-allowed', color: '#6b7280' }} />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Date of Issue</label>
                                        <input type="date" value={formData.dateOfIssue}
                                            onChange={e => setFormData({ ...formData, dateOfIssue: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Email</label>
                                        <input type="email" value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={formData.isActive}
                                            onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                            style={{ width: 17, height: 17, margin: 0, cursor: 'pointer' }} />
                                        Active
                                    </label>
                                </div>

                                <div className="form-group">
                                    <label>Address</label>
                                    <textarea rows="3" value={formData.address}
                                        onChange={e => setFormData({ ...formData, address: e.target.value })} />
                                </div>

                                <div className="form-group">
                                    <label>Notes</label>
                                    <textarea rows="2" value={formData.notes}
                                        onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                                </div>

                                {/* Bank Details */}
                                <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '0.25rem' }}>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase',
                                                   letterSpacing: '0.05em', color: '#3b82f6', marginBottom: '0.75rem' }}>
                                        🏦 Bank Details (for BACS dividend payments)
                                    </div>
                                    <div className="form-group">
                                        <label>Account Name</label>
                                        <input type="text" value={formData.bankAccountName}
                                            placeholder="e.g. A J Smith"
                                            onChange={e => setFormData({ ...formData, bankAccountName: e.target.value })} />
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Sort Code</label>
                                            <input type="text" value={formData.bankSortCode}
                                                placeholder="e.g. 12-34-56"
                                                onChange={e => setFormData({ ...formData, bankSortCode: e.target.value })} />
                                        </div>
                                        <div className="form-group">
                                            <label>Account Number</label>
                                            <input type="text" value={formData.accountNumber}
                                                placeholder="e.g. 12345678"
                                                onChange={e => setFormData({ ...formData, accountNumber: e.target.value })} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer" style={{ borderTop: '1px solid #e5e7eb',
                                                                     display: 'flex', justifyContent: 'flex-end',
                                                                     gap: '0.5rem', padding: '0.875rem 1.25rem' }}>
                                <button type="button" className="btn-secondary" onClick={handleCancelEdit}
                                    disabled={processing}>Cancel</button>
                                <button type="submit" className="btn-primary" disabled={processing}>
                                    {editingShareholder ? 'Save Changes' : 'Create Shareholder'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── View Modal (row click) ────────────────────────────────── */}
            {viewingShareholder && !showForm && (
                <div className="modal-overlay" onClick={() => setViewingShareholder(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}
                         style={{ maxWidth: '580px', width: '95%', padding: 0, overflow: 'hidden' }}>

                        {/* Colour band header */}
                        <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a8e 100%)',
                                      padding: '1.25rem 1.5rem', color: '#fff', position: 'relative' }}>
                            <button className="btn-close" onClick={() => setViewingShareholder(null)}
                                    style={{ position: 'absolute', top: '0.75rem', right: '0.75rem',
                                             color: 'rgba(255,255,255,0.8)', background: 'rgba(255,255,255,0.15)',
                                             border: 'none', borderRadius: '0.375rem', width: 28, height: 28,
                                             cursor: 'pointer', fontSize: '1em', display: 'flex',
                                             alignItems: 'center', justifyContent: 'center' }}>✕</button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                                              background: 'rgba(255,255,255,0.2)',
                                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                                              fontSize: '1.4rem', fontWeight: 700, color: '#fff' }}>
                                    {(viewingShareholder.name || '?')[0].toUpperCase()}
                                </div>
                                <div>
                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.2 }}>
                                        {viewingShareholder.name}
                                    </div>
                                    <div style={{ fontSize: '0.82rem', opacity: 0.8, marginTop: '0.2rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <span>{viewingShareholder.shareholderType}</span>
                                        <span>·</span>
                                        <span style={{ background: viewingShareholder.isActive ? 'rgba(16,185,129,0.25)' : 'rgba(156,163,175,0.25)',
                                                        color: viewingShareholder.isActive ? '#6ee7b7' : '#d1d5db',
                                                        border: `1px solid ${viewingShareholder.isActive ? 'rgba(16,185,129,0.4)' : 'rgba(156,163,175,0.4)'}`,
                                                        borderRadius: '999px', padding: '0.1rem 0.6rem', fontSize: '0.78rem' }}>
                                            {viewingShareholder.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ padding: '1.25rem 1.5rem', maxHeight: '60vh', overflowY: 'auto' }}>

                            {/* Shareholding cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem',
                                          marginBottom: '1.25rem' }}>
                                {[
                                    { label: 'Share Class', value: getShareClassName(viewingShareholder), icon: '🏷️' },
                                    { label: 'Shares Owned', value: (viewingShareholder.sharesOwned || 0).toLocaleString(), icon: '📊' },
                                    { label: 'Certificate No', value: viewingShareholder.shareCertificateNumber || '—', mono: true, icon: '🔖' },
                                    { label: 'Date of Issue', value: fmtDate(viewingShareholder.dateOfIssue), icon: '📅' },
                                ].map(({ label, value, mono, icon }) => (
                                    <div key={label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0',
                                                               borderRadius: '0.5rem', padding: '0.75rem' }}>
                                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600,
                                                       textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem' }}>
                                            {icon} {label}
                                        </div>
                                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b',
                                                       fontFamily: mono ? 'monospace' : undefined }}>
                                            {value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Contact */}
                            {(viewingShareholder.email || viewingShareholder.address) && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                                                   letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '0.6rem' }}>
                                        Contact
                                    </div>
                                    {viewingShareholder.email && (
                                        <div style={{ fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                                            <span style={{ color: '#94a3b8', marginRight: '0.5rem' }}>✉️</span>
                                            <span style={{ color: '#1e293b' }}>{viewingShareholder.email}</span>
                                        </div>
                                    )}
                                    {viewingShareholder.address && (
                                        <div style={{ fontSize: '0.88rem' }}>
                                            <span style={{ color: '#94a3b8', marginRight: '0.5rem' }}>📍</span>
                                            <span style={{ color: '#1e293b', whiteSpace: 'pre-line' }}>{viewingShareholder.address}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Bank Details — always shown */}
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                                               letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '0.6rem' }}>
                                    🏦 Bank Details
                                </div>
                                {(viewingShareholder.bankAccountName || viewingShareholder.bankSortCode || viewingShareholder.accountNumber) ? (
                                    <>
                                        {viewingShareholder.bankAccountName && (
                                            <div style={{ fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                                                <span style={{ color: '#94a3b8', marginRight: '0.5rem' }}>👤</span>
                                                <span style={{ color: '#1e293b' }}>{viewingShareholder.bankAccountName}</span>
                                            </div>
                                        )}
                                        {(viewingShareholder.bankSortCode || viewingShareholder.accountNumber) && (
                                            <div style={{ fontSize: '0.88rem', fontFamily: 'monospace' }}>
                                                <span style={{ color: '#94a3b8', marginRight: '0.5rem' }}>🔢</span>
                                                <span style={{ color: '#1e293b' }}>
                                                    {viewingShareholder.bankSortCode || '—'} / {viewingShareholder.accountNumber || '—'}
                                                </span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                        No bank details saved — click <strong>Edit</strong> to add BACS details.
                                    </div>
                                )}
                            </div>

                            {/* Notes */}
                            {viewingShareholder.notes && (
                                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.5rem',
                                               padding: '0.75rem', marginBottom: '1rem', fontSize: '0.88rem', color: '#92400e' }}>
                                    <strong>Notes: </strong>{viewingShareholder.notes}
                                </div>
                            )}

                            {/* Certificate actions */}
                            <div style={{ background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem',
                                           padding: '1rem' }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase',
                                               letterSpacing: '0.05em', color: '#3b82f6', marginBottom: '0.75rem' }}>
                                    📄 Share Certificate
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button className="btn-primary" disabled={loadingCert}
                                        onClick={() => handleViewCertificate(viewingShareholder)}
                                        style={{ fontSize: '0.85em' }}>
                                        {loadingCert ? '⏳ Loading…' : '📄 View Certificate'}
                                    </button>
                                    <button className="btn-secondary"
                                        onClick={() => handleEmailCertificate(viewingShareholder)}
                                        style={{ fontSize: '0.85em' }}>
                                        ✉️ Email Certificate
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid #e5e7eb', padding: '0.875rem 1.5rem',
                                       display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                       background: '#f8fafc' }}>
                            <button onClick={() => handleDelete(viewingShareholder.id, viewingShareholder.name)}
                                style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626',
                                          borderRadius: '0.375rem', padding: '0.45rem 0.9rem',
                                          cursor: 'pointer', fontSize: '0.85em', fontWeight: 500 }}>
                                🗑️ Delete
                            </button>
                            <button className="btn-primary" onClick={() => openEdit(viewingShareholder)}>
                                ✏️ Edit Shareholder
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Certificate Modal ─────────────────────────────────────── */}
            {certificateHtml && (
                <div className="modal-overlay" onClick={() => setCertificateHtml(null)}
                     style={{ alignItems: 'flex-start', paddingTop: '2vh' }}>
                    <div onClick={e => e.stopPropagation()}
                         style={{ background: '#fff', borderRadius: '0.5rem', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                                  width: '92vw', maxWidth: '900px', height: '90vh', display: 'flex',
                                  flexDirection: 'column', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                      padding: '0.75rem 1.25rem', borderBottom: '1px solid #e5e7eb',
                                      background: '#f8f9fa', flexShrink: 0 }}>
                            <span style={{ fontWeight: 600, fontSize: '0.95em' }}>
                                📄 Share Certificate — {viewingShareholder?.name}
                            </span>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn-secondary" style={{ fontSize: '0.82em' }}
                                    onClick={() => {
                                        const w = window.open('', '_blank');
                                        w.document.write(certificateHtml);
                                        w.document.close();
                                    }}>🖨️ Print / Save PDF</button>
                                <button className="btn-close" onClick={() => setCertificateHtml(null)}>✕</button>
                            </div>
                        </div>
                        <iframe srcDoc={certificateHtml} title="Share Certificate"
                                style={{ flex: 1, border: 'none', width: '100%' }} />
                    </div>
                </div>
            )}

            <div className="shareholders-list">
                    {shareholders.length === 0 ? (
                        <p>No shareholders found. Create your first shareholder to get started.</p>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ minWidth: '150px' }}>Name</th>
                                    <th style={{ minWidth: '100px' }}>Type</th>
                                    <th style={{ minWidth: '120px' }}>Share Class</th>
                                    <th style={{ minWidth: '110px' }}>Shares Owned</th>
                                    <th style={{ minWidth: '130px' }}>Certificate No</th>
                                    <th style={{ minWidth: '100px' }}>Issue Date</th>
                                    <th style={{ minWidth: '80px' }}>Status</th>
                                    <th style={{ minWidth: '120px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shareholders.map(shareholder => (
                                    <tr key={shareholder.id} style={{ cursor: 'pointer' }}
                                        onClick={() => setViewingShareholder(shareholder)}>
                                        <td><strong>{shareholder.name}</strong></td>
                                        <td>{shareholder.shareholderType}</td>
                                        <td>{getShareClassName(shareholder)}</td>
                                        <td>{shareholder.sharesOwned?.toLocaleString() || 0}</td>
                                        <td style={{ fontFamily: 'monospace' }}>{shareholder.shareCertificateNumber || '—'}</td>
                                        <td style={{ fontSize: '0.85em', color: '#6b7280' }}>{fmtDate(shareholder.dateOfIssue)}</td>
                                        <td>
                                            <span className={`status-badge ${shareholder.isActive ? 'status-paid' : 'status-draft'}`}>
                                                {shareholder.isActive ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td onClick={e => e.stopPropagation()}>
                                            <button onClick={() => openEdit(shareholder)} className="btn-icon" title="Edit">✏️</button>
                                            <button onClick={() => handleViewCertificate(shareholder)} className="btn-icon"
                                                    title="View Certificate" style={{ marginLeft: '5px' }}
                                                    disabled={loadingCert}>📄</button>
                                            <button onClick={() => handleEmailCertificate(shareholder)} className="btn-icon"
                                                    title="Email Certificate" style={{ marginLeft: '5px' }}>✉️</button>
                                            <button onClick={() => handleDelete(shareholder.id, shareholder.name)} className="btn-icon"
                                                    title="Delete" style={{ marginLeft: '5px' }}>🗑️</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
        </div>
    );
}
