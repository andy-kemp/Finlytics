import React, { useEffect, useState } from 'react';
import { getAssets, createAsset, updateAsset, deleteAsset, getNextAssetId, uploadAssetInvoice, getCompanySettings } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';

const CATEGORIES = ['IT Equipment', 'Furniture', 'Vehicle', 'Office Equipment', 'Machinery', 'Fixtures & Fittings', 'Other'];
const STATUSES = ['In Use', 'In Storage', 'Under Repair', 'Disposed', 'Lost'];
const DEPRECIATION_METHODS = ['Straight-line', 'Reducing Balance', 'None'];
const DISPOSAL_METHODS = ['Sold', 'Scrapped', 'Donated', 'Lost'];

const STATUS_STYLES = {
    'In Use':       { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
    'In Storage':   { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' },
    'Under Repair': { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
    'Disposed':     { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    'Lost':         { bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
};

const defaultForm = {
    assetId: '', name: '', category: 'IT Equipment', description: '',
    serialNumber: '', manufacturer: '', model: '',
    purchaseDate: '', purchasePrice: '', supplierName: '', warrantyExpiry: '',
    assignedToEmployeeName: '', location: '',
    depreciationMethod: 'Straight-line', usefulLifeYears: '', residualValue: '',
    status: 'In Use',
    disposalDate: '', disposalValue: '', disposalMethod: '',
    notes: '',
};

function StatusBadge({ status }) {
    const s = STATUS_STYLES[status] || STATUS_STYLES['In Storage'];
    return (
        <span style={{
            display: 'inline-block', padding: '0.2rem 0.75rem', borderRadius: '999px',
            fontSize: '0.78rem', fontWeight: 600,
            backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}`,
        }}>
            {status}
        </span>
    );
}

function DetailSection({ title, children }) {
    return (
        <div style={{ marginBottom: '1.25rem' }}>
            <div style={{
                fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.06em', color: '#9ca3af',
                borderBottom: '1px solid #f3f4f6', paddingBottom: '0.3rem', marginBottom: '0.75rem'
            }}>{title}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1.5rem' }}>
                {children}
            </div>

            <ConfirmDeleteModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                itemLabels={confirmModal.itemLabels}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(m => ({ ...m, isOpen: false }))}
            />
        </div>
    );
}

function DetailRow({ label, value, full }) {
    if (value == null || value === '' || value === '—') return null;
    return (
        <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.15rem' }}>{label}</div>
            <div style={{ fontSize: '0.92rem', color: '#1f2937', fontWeight: 500 }}>{value}</div>
        </div>
    );
}

function fmt(val) {
    if (val == null || val === '') return '—';
    return `£${Number(val).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(val) {
    if (!val) return null;
    return new Date(val).toLocaleDateString('en-GB');
}

export default function Assets() {
    const [assets, setAssets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const { toast, showToast, clearToast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [viewingAsset, setViewingAsset] = useState(null);
    const [viewingInvoice, setViewingInvoice] = useState(null);
    const [editingAsset, setEditingAsset] = useState(null);
    const [formData, setFormData] = useState(defaultForm);
    const [invoiceFile, setInvoiceFile] = useState(null);
    const [companySettings, setCompanySettings] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', itemLabels: [], onConfirm: () => {} });

    useEffect(() => { loadAssets(); }, []);

    async function loadAssets() {
        try {
            setLoading(true);
            const [data, settings] = await Promise.all([getAssets(), getCompanySettings()]);
            setAssets(data);
            setCompanySettings(settings);
        } catch (error) {
            console.error('Error loading assets:', error);
        } finally {
            setLoading(false);
        }
    }

    async function openNewForm() {
        setEditingAsset(null);
        setInvoiceFile(null);
        setFormData(defaultForm);
        try {
            const result = await getNextAssetId();
            setFormData(prev => ({ ...prev, assetId: result.nextId || '' }));
        } catch { /* non-fatal */ }
        setShowForm(true);
    }

    function handleEdit(asset) {
        setEditingAsset(asset);
        setInvoiceFile(null);
        setFormData({
            assetId: asset.assetId || '',
            name: asset.name || '',
            category: asset.category || 'IT Equipment',
            description: asset.description || '',
            serialNumber: asset.serialNumber || '',
            manufacturer: asset.manufacturer || '',
            model: asset.model || '',
            purchaseDate: asset.purchaseDate ? asset.purchaseDate.substring(0, 10) : '',
            purchasePrice: asset.purchasePrice ?? '',
            supplierName: asset.supplierName || '',
            warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.substring(0, 10) : '',
            assignedToEmployeeName: asset.assignedToEmployeeName || '',
            location: asset.location || '',
            depreciationMethod: asset.depreciationMethod || 'Straight-line',
            usefulLifeYears: asset.usefulLifeYears ?? '',
            residualValue: asset.residualValue ?? '',
            status: asset.status || 'In Use',
            disposalDate: asset.disposalDate ? asset.disposalDate.substring(0, 10) : '',
            disposalValue: asset.disposalValue ?? '',
            disposalMethod: asset.disposalMethod || '',
            notes: asset.notes || '',
        });
        setShowForm(true);
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    function closeForm() {
        setShowForm(false);
        setEditingAsset(null);
        setInvoiceFile(null);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setProcessingMessage(editingAsset ? 'Updating asset...' : 'Creating asset...');
        setProcessing(true);
        try {
            const payload = {
                ...formData,
                purchasePrice: formData.purchasePrice === '' ? null : Number(formData.purchasePrice),
                residualValue: formData.residualValue === '' ? null : Number(formData.residualValue),
                usefulLifeYears: formData.usefulLifeYears === '' ? null : Number(formData.usefulLifeYears),
                disposalValue: formData.disposalValue === '' ? null : Number(formData.disposalValue),
                purchaseDate: formData.purchaseDate || null,
                warrantyExpiry: formData.warrantyExpiry || null,
                disposalDate: formData.disposalDate || null,
            };

            let savedAsset;
            if (editingAsset) {
                savedAsset = await updateAsset(editingAsset.id, payload);
            } else {
                savedAsset = await createAsset(payload);
            }

            if (invoiceFile) {
                setProcessingMessage('Uploading invoice...');
                const assetDbId = savedAsset?.id || editingAsset?.id;
                if (assetDbId) {
                    try {
                        await uploadAssetInvoice(assetDbId, invoiceFile);
                    } catch (uploadErr) {
                        showToast('Asset saved but invoice upload failed: ' + uploadErr.message, 'warning');
                    }
                }
            }

            await loadAssets();
            closeForm();
            showToast(editingAsset ? 'Asset updated successfully!' : 'Asset created successfully!', 'success');
        } catch (error) {
            console.error('Error saving asset:', error);
            showToast('Failed to save asset: ' + error.message, 'error');
        } finally {
            setProcessing(false);
        }
    }

    const allowDataDeletion = companySettings?.allowDataDeletion === true;

    function handleDelete(asset) {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Asset',
            message: 'Are you sure you want to permanently delete this asset?',
            itemLabels: [`${asset.assetId} — ${asset.name}`],
            onConfirm: async () => {
                setConfirmModal(m => ({ ...m, isOpen: false }));
                setProcessingMessage('Deleting asset...');
                setProcessing(true);
                try {
                    await deleteAsset(asset.id);
                    await loadAssets();
                    showToast('Asset deleted.', 'success');
                } catch (error) {
                    showToast('Failed to delete asset: ' + error.message, 'error');
                } finally {
                    setProcessing(false);
                }
            }
        });
    }

    // ── Processing spinner ───────────────────────────────────────────────────
    if (processing) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">{processingMessage || 'Please wait...'}</div>
        </div>
    );

    if (loading) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading assets...</div>
        </div>
    );

    return (
        <div className="assets-container">
            <Toast toast={toast} onClose={clearToast} />

            <div className="page-header">
                <h1>Assets Register</h1>
                <button className="btn-primary" onClick={openNewForm}>+ Add Asset</button>
            </div>

            {/* ── Add / Edit Modal ────────────────────────────────────────── */}
            {showForm && (
                <div className="modal-overlay" onClick={closeForm}>
                    <div className="modal-content" style={{ maxWidth: '860px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingAsset ? `Edit Asset — ${editingAsset.assetId}` : 'New Asset'}</h3>
                            <button className="btn-close" onClick={closeForm}>✖</button>
                        </div>
                        <form onSubmit={handleSubmit} className="entity-form">

                            <div className="form-section-title">📋 Asset Details</div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Asset ID</label>
                                    <input type="text" name="assetId" value={formData.assetId} disabled style={{ background: '#f9fafb', color: '#9ca3af' }} />
                                </div>
                                <div className="form-group">
                                    <label>Name *</label>
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Category *</label>
                                    <select name="category" value={formData.category} onChange={handleChange} required>
                                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Status *</label>
                                    <select name="status" value={formData.status} onChange={handleChange} required>
                                        {STATUSES.map(s => <option key={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Manufacturer</label>
                                    <input type="text" name="manufacturer" value={formData.manufacturer} onChange={handleChange} />
                                </div>
                                <div className="form-group">
                                    <label>Model</label>
                                    <input type="text" name="model" value={formData.model} onChange={handleChange} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Serial Number</label>
                                    <input type="text" name="serialNumber" value={formData.serialNumber} onChange={handleChange} />
                                </div>
                                <div className="form-group">
                                    <label>Location</label>
                                    <input type="text" name="location" value={formData.location} onChange={handleChange} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Assigned To (Employee Name)</label>
                                <input type="text" name="assignedToEmployeeName" value={formData.assignedToEmployeeName} onChange={handleChange} placeholder="e.g. Andrew Kemp" />
                            </div>
                            <div className="form-group">
                                <label>Description</label>
                                <textarea name="description" value={formData.description} onChange={handleChange} rows="2" />
                            </div>

                            <div className="form-section-title" style={{ marginTop: '1rem' }}>🛒 Purchase Information</div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Purchase Date</label>
                                    <input type="date" name="purchaseDate" value={formData.purchaseDate} onChange={handleChange} />
                                </div>
                                <div className="form-group">
                                    <label>Purchase Price (£)</label>
                                    <input type="number" step="0.01" min="0" name="purchasePrice" value={formData.purchasePrice} onChange={handleChange} placeholder="0.00" />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Supplier</label>
                                    <input type="text" name="supplierName" value={formData.supplierName} onChange={handleChange} />
                                </div>
                                <div className="form-group">
                                    <label>Warranty Expiry</label>
                                    <input type="date" name="warrantyExpiry" value={formData.warrantyExpiry} onChange={handleChange} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Purchase Invoice (PDF or image)</label>
                                <input type="file" accept="image/*,application/pdf" onChange={e => setInvoiceFile(e.target.files[0] || null)} style={{ padding: '0.4rem' }} />
                                {editingAsset?.invoiceUrl && !invoiceFile && (
                                    <small style={{ color: '#059669', marginTop: '0.25rem', display: 'block' }}>
                                        ✅ Invoice on file —{' '}
                                        <a href={editingAsset.invoiceUrl} target="_blank" rel="noopener noreferrer">view current</a>
                                        {' '}· upload a new file to replace it
                                    </small>
                                )}
                            </div>

                            <div className="form-section-title" style={{ marginTop: '1rem' }}>📉 Depreciation</div>
                            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                                <div className="form-group">
                                    <label>Method</label>
                                    <select name="depreciationMethod" value={formData.depreciationMethod} onChange={handleChange}>
                                        {DEPRECIATION_METHODS.map(m => <option key={m}>{m}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Useful Life (years)</label>
                                    <input type="number" step="1" min="0" name="usefulLifeYears" value={formData.usefulLifeYears} onChange={handleChange} />
                                </div>
                                <div className="form-group">
                                    <label>Residual Value (£)</label>
                                    <input type="number" step="0.01" min="0" name="residualValue" value={formData.residualValue} onChange={handleChange} placeholder="0.00" />
                                </div>
                            </div>

                            {(formData.status === 'Disposed' || formData.status === 'Lost') && (
                                <>
                                    <div className="form-section-title" style={{ marginTop: '1rem' }}>🗑️ Disposal</div>
                                    <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                                        <div className="form-group">
                                            <label>Disposal Date</label>
                                            <input type="date" name="disposalDate" value={formData.disposalDate} onChange={handleChange} />
                                        </div>
                                        <div className="form-group">
                                            <label>Disposal Value (£)</label>
                                            <input type="number" step="0.01" min="0" name="disposalValue" value={formData.disposalValue} onChange={handleChange} placeholder="0.00" />
                                        </div>
                                        <div className="form-group">
                                            <label>Disposal Method</label>
                                            <select name="disposalMethod" value={formData.disposalMethod} onChange={handleChange}>
                                                <option value="">Select…</option>
                                                {DISPOSAL_METHODS.map(m => <option key={m}>{m}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="form-group" style={{ marginTop: '0.5rem' }}>
                                <label>Notes</label>
                                <textarea name="notes" value={formData.notes} onChange={handleChange} rows="3" />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', marginTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
                                <button type="button" className="btn-secondary" onClick={closeForm}>Cancel</button>
                                <button type="submit" className="btn-primary">{editingAsset ? 'Update Asset' : 'Create Asset'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── View Modal ──────────────────────────────────────────────── */}
            {viewingAsset && (
                <div className="modal-overlay" onClick={() => setViewingAsset(null)}>
                    <div className="modal-content" style={{ maxWidth: '680px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Asset Details</h3>
                            <button className="btn-close" onClick={() => setViewingAsset(null)}>✖</button>
                        </div>
                        <div style={{ padding: '1.5rem' }}>
                            {/* Title row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                                <div>
                                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#1f2937' }}>{viewingAsset.name}</div>
                                    <div style={{ color: '#6b7280', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{viewingAsset.assetId}</span>
                                        {viewingAsset.category && <span> · {viewingAsset.category}</span>}
                                    </div>
                                </div>
                                <StatusBadge status={viewingAsset.status} />
                            </div>

                            <DetailSection title="📋 Details">
                                <DetailRow label="Manufacturer" value={viewingAsset.manufacturer} />
                                <DetailRow label="Model" value={viewingAsset.model} />
                                <DetailRow label="Serial Number" value={viewingAsset.serialNumber} />
                                <DetailRow label="Location" value={viewingAsset.location} />
                                <DetailRow label="Assigned To" value={viewingAsset.assignedToEmployeeName} />
                                <DetailRow label="Description" value={viewingAsset.description} full />
                            </DetailSection>

                            <DetailSection title="🛒 Purchase">
                                <DetailRow label="Purchase Date" value={fmtDate(viewingAsset.purchaseDate)} />
                                <DetailRow label="Purchase Price" value={fmt(viewingAsset.purchasePrice)} />
                                <DetailRow label="Supplier" value={viewingAsset.supplierName} />
                                <DetailRow label="Warranty Expiry" value={fmtDate(viewingAsset.warrantyExpiry)} />
                                {viewingAsset.invoiceUrl && (
                                    <div style={{ gridColumn: '1 / -1', marginTop: '0.25rem' }}>
                                        <button
                                            className="btn-secondary"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 1rem', fontSize: '0.88rem' }}
                                            onClick={() => setViewingInvoice(viewingAsset.invoiceUrl)}
                                        >
                                            📄 View Purchase Invoice
                                        </button>
                                    </div>
                                )}
                            </DetailSection>

                            <DetailSection title="📉 Depreciation">
                                <DetailRow label="Method" value={viewingAsset.depreciationMethod} />
                                <DetailRow label="Useful Life" value={viewingAsset.usefulLifeYears ? `${viewingAsset.usefulLifeYears} years` : null} />
                                <DetailRow label="Residual Value" value={viewingAsset.residualValue != null ? fmt(viewingAsset.residualValue) : null} />
                                <DetailRow label="Current Value" value={viewingAsset.currentValue != null ? fmt(viewingAsset.currentValue) : null} />
                            </DetailSection>

                            {(viewingAsset.disposalDate || viewingAsset.status === 'Disposed' || viewingAsset.status === 'Lost') && (
                                <DetailSection title="🗑️ Disposal">
                                    <DetailRow label="Disposal Date" value={fmtDate(viewingAsset.disposalDate)} />
                                    <DetailRow label="Disposal Value" value={viewingAsset.disposalValue != null ? fmt(viewingAsset.disposalValue) : null} />
                                    <DetailRow label="Disposal Method" value={viewingAsset.disposalMethod} />
                                </DetailSection>
                            )}

                            {viewingAsset.notes && (
                                <DetailSection title="📝 Notes">
                                    <div style={{ gridColumn: '1 / -1', color: '#374151', whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.6 }}>
                                        {viewingAsset.notes}
                                    </div>
                                </DetailSection>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb' }}>
                                <button className="btn-secondary" onClick={() => { setViewingAsset(null); handleEdit(viewingAsset); }}>✏ Edit</button>
                                <button className="btn-secondary" onClick={() => setViewingAsset(null)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Invoice Viewer Modal ─────────────────────────────────── */}
            {viewingInvoice && (
                <div className="modal-overlay" onClick={() => setViewingInvoice(null)}>
                    <div className="modal-content" style={{ maxWidth: '900px', width: '95vw', display: 'flex', flexDirection: 'column', height: '90vh', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📄 Purchase Invoice</h3>
                            <button className="btn-close" onClick={() => setViewingInvoice(null)}>✖</button>
                        </div>
                        <div style={{ flex: 1, overflow: 'hidden', background: '#f9fafb' }}>
                            {/\.(jpg|jpeg|png|gif|webp)/i.test(viewingInvoice)
                                ? <img src={viewingInvoice} alt="Invoice" style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto', padding: '1rem' }} />
                                : <iframe src={viewingInvoice} title="Purchase Invoice" style={{ width: '100%', height: '100%', border: 'none' }} />}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
                            <a href={viewingInvoice} download className="btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>⬇ Download</a>
                            <button className="btn-secondary" onClick={() => setViewingInvoice(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Asset Table ─────────────────────────────────────────────── */}
            {assets.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem 2rem', color: '#9ca3af' }}>
                    <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>📦</div>
                    <p style={{ fontSize: '1rem' }}>No assets registered yet.<br />Click <strong>+ Add Asset</strong> to get started.</p>
                </div>
            ) : (
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Asset ID</th>
                                <th>Name</th>
                                <th>Category</th>
                                <th>Status</th>
                                <th>Assigned To</th>
                                <th>Purchase Date</th>
                                <th>Purchase Price</th>
                                <th style={{ textAlign: 'center' }}>Invoice</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {assets.map(asset => (
                                <tr key={asset.id}>
                                    <td><span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.85rem', color: '#374151' }}>{asset.assetId}</span></td>
                                    <td style={{ fontWeight: 500 }}>{asset.name}
                                        {asset.manufacturer && <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{asset.manufacturer}{asset.model ? ` · ${asset.model}` : ''}</div>}
                                    </td>
                                    <td style={{ fontSize: '0.85rem', color: '#6b7280' }}>{asset.category}</td>
                                    <td><StatusBadge status={asset.status} /></td>
                                    <td style={{ fontSize: '0.9rem' }}>{asset.assignedToEmployeeName || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                                    <td style={{ fontSize: '0.88rem' }}>{fmtDate(asset.purchaseDate) || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{asset.purchasePrice != null ? fmt(asset.purchasePrice) : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        {asset.invoiceUrl
                                            ? <button className="btn-icon" title="View invoice" onClick={() => setViewingInvoice(asset.invoiceUrl)}>📄</button>
                                            : <span style={{ color: '#d1d5db' }}>—</span>}
                                    </td>
                                    <td>
                                        <button className="btn-icon" title="View details" onClick={() => setViewingAsset(asset)}>👁️</button>
                                        <button className="btn-icon" title="Edit" onClick={() => handleEdit(asset)} style={{marginLeft: '5px'}}>✏️</button>
                                        {allowDataDeletion && (
                                            <button className="btn-icon" title="Delete" onClick={() => handleDelete(asset)} style={{marginLeft: '5px'}}>🗑️</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
