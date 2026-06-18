import React, { useEffect, useState } from 'react';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, generateCode, getAuthHeaders, getCompanySettings } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://finlyticsdevfunc.azurewebsites.net/api';

export default function Customers() {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const { toast, showToast, clearToast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [viewingCustomer, setViewingCustomer] = useState(null);
    const [companySettings, setCompanySettings] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [confirmModal, setConfirmModal] = useState(null);
    const [isMobile, setIsMobile] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        contactName: '',
        ccEmail: '',
        billingEmail: '',
        billingAddress: '',
        defaultDayRate: '',
        defaultHourlyRate: '',
        isVATRegistered: true,
        defaultVATRate: 20
    });

    useEffect(() => {
        loadCustomers();
    }, []);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    async function loadCustomers() {
        try {
            const [data, settings] = await Promise.all([
                getCustomers(),
                getCompanySettings().catch(() => null)
            ]);
            setCustomers(data);
            setCompanySettings(settings);
        } catch (error) {
            console.error('Error loading customers:', error);
        } finally {
            setLoading(false);
        }
    }

    function handleEdit(customer) {
        setEditingCustomer(customer);
        setFormData({
            name: customer.name || '',
            email: customer.email || '',
            contactName: customer.contactName || '',
            ccEmail: customer.ccEmail || '',
            billingEmail: customer.billingEmail || '',
            billingAddress: customer.billingAddress || '',
            defaultDayRate: customer.defaultDayRate || '',
            defaultHourlyRate: customer.defaultHourlyRate || '',
            isVATRegistered: customer.isVATRegistered ?? true,
            defaultVATRate: customer.defaultVATRate ?? 20
        });
        setShowForm(true);
    }

    const allowDataDeletion = companySettings?.allowDataDeletion === true;

    const toggleSelectId = (id) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const selectAllCustomers = () => setSelectedIds(new Set(customers.map(c => c.id)));
    const clearSelection = () => setSelectedIds(new Set());

    async function handleDelete(customer) {
        if (customer.id === null || customer.id === undefined || (typeof customer.id === 'string' && customer.id.trim() === '')) {
            setConfirmModal({
                title: 'Remove Corrupted Records?',
                message: `Customer "${customer.name}" has no ID and is corrupted data. Delete ALL corrupted customers and suppliers (records without IDs)?`,
                itemLabels: [],
                onConfirm: async () => {
                    setConfirmModal(null);
                    setProcessingMessage('Cleaning up corrupted records...');
                    setProcessing(true);
                    try {
                        const headers = await getAuthHeaders();
                        const response = await fetch(`${API_BASE}/cleanup/corrupted-records`, { method: 'POST', headers });
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const result = await response.json().catch(() => ({}));
                        if (result.success) {
                            showToast(`Deleted ${result.customersDeleted} corrupted customers and ${result.suppliersDeleted} corrupted suppliers`, 'success');
                            await loadCustomers();
                        } else {
                            showToast('Cleanup completed with warnings', 'warning');
                        }
                    } catch (error) {
                        showToast('Failed to clean up corrupted records: ' + error.message, 'error');
                    } finally {
                        setProcessing(false);
                    }
                }
            });
            return;
        }

        setConfirmModal({
            title: 'Delete Customer?',
            message: `Are you sure you want to permanently delete customer "${customer.name}"?`,
            itemLabels: [`${customer.customerCode} — ${customer.name}`],
            onConfirm: async () => {
                setConfirmModal(null);
                setProcessingMessage('Deleting customer...');
                setProcessing(true);
                try {
                    await deleteCustomer(customer.id);
                    showToast('Customer deleted.', 'success');
                    await loadCustomers();
                } catch (error) {
                    console.error('Error deleting customer:', error);
                    showToast('Failed to delete customer: ' + error.message, 'error');
                } finally {
                    setProcessing(false);
                }
            }
        });
    }

    const handleBulkDeleteCustomers = () => {
        const toDelete = customers.filter(c => selectedIds.has(c.id));
        if (toDelete.length === 0) return;
        setConfirmModal({
            title: `Delete ${toDelete.length} Customer${toDelete.length > 1 ? 's' : ''}?`,
            message: `You are about to permanently delete ${toDelete.length} customer${toDelete.length > 1 ? 's' : ''}:`,
            itemLabels: toDelete.map(c => `${c.customerCode} — ${c.name}`),
            onConfirm: async () => {
                setConfirmModal(null);
                setProcessing(true);
                let failed = 0;
                for (const c of toDelete) {
                    try { await deleteCustomer(c.id); } catch { failed++; }
                }
                clearSelection();
                await loadCustomers();
                setProcessing(false);
                if (failed > 0) showToast(`${failed} deletion(s) failed.`, 'error');
                else showToast(`${toDelete.length} customer(s) deleted.`, 'success');
            }
        });
    };

    function handleCancelEdit() {
        setEditingCustomer(null);
        setShowForm(false);
        setFormData({
            name: '',
            email: '',
            contactName: '',
            ccEmail: '',
            billingEmail: '',
            billingAddress: '',
            defaultDayRate: '',
            defaultHourlyRate: '',
            isVATRegistered: true,
            defaultVATRate: 20
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setProcessingMessage(editingCustomer ? 'Updating customer...' : 'Creating customer...');
        setProcessing(true);
        try {
            if (editingCustomer) {
                const updateData = { 
                    ...formData, 
                    id: editingCustomer.id,
                    code: editingCustomer.code || editingCustomer.customerCode,
                    customerCode: editingCustomer.code || editingCustomer.customerCode
                };
                await updateCustomer(editingCustomer.id, updateData);
                showToast('Customer updated successfully!', 'success');
            } else {
                const codeResult = await generateCode(formData.name, 'Customer');
                const newCustomer = { ...formData, customerCode: codeResult.code };
                await createCustomer(newCustomer);
                showToast('Customer created successfully!', 'success');
            }
            handleCancelEdit();
            loadCustomers();
        } catch (error) {
            console.error('Error saving customer:', error);
            showToast(`Failed to ${editingCustomer ? 'update' : 'create'} customer: ${error.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    }

    if (loading) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading customers...</div>
        </div>
    );

    if (processing) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">{processingMessage || 'Please wait...'}</div>
        </div>
    );

    return (
        <div className="customers">
            <Toast toast={toast} onClose={clearToast} />
            <div className="page-header">
                <h1>Customers</h1>
                <button onClick={() => setShowForm(true)} className="btn-primary">
                    + Add Customer
                </button>
            </div>

            {showForm && (
                <div className="modal-overlay" onClick={() => !processing && handleCancelEdit()}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingCustomer ? 'Edit Customer' : 'New Customer'}</h3>
                            <button className="btn-close" onClick={handleCancelEdit} disabled={processing}>✖</button>
                        </div>
                        <form onSubmit={handleSubmit} className="entity-form">
                    <div className="form-row">
                        <div className="form-group">
                            <label>Customer Name *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({...formData, email: e.target.value})}
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Contact Name</label>
                            <input
                                type="text"
                                value={formData.contactName}
                                onChange={e => setFormData({...formData, contactName: e.target.value})}
                                placeholder="e.g. Jane Smith"
                            />
                        </div>
                        <div className="form-group">
                            <label>CC Email</label>
                            <input
                                type="email"
                                value={formData.ccEmail}
                                onChange={e => setFormData({...formData, ccEmail: e.target.value})}
                                placeholder="Copied on all emails"
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Billing Email</label>
                            <input
                                type="email"
                                value={formData.billingEmail}
                                onChange={e => setFormData({...formData, billingEmail: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label>Billing Address</label>
                            <textarea
                                value={formData.billingAddress}
                                onChange={e => setFormData({...formData, billingAddress: e.target.value})}
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Default Day Rate (GBP)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*\.?[0-9]*"
                                value={formData.defaultDayRate}
                                onChange={e => {
                                    const value = e.target.value;
                                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                        setFormData({...formData, defaultDayRate: value});
                                    }
                                }}
                            />
                        </div>
                        <div className="form-group">
                            <label>Default Hourly Rate (GBP)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*\.?[0-9]*"
                                value={formData.defaultHourlyRate}
                                onChange={e => {
                                    const value = e.target.value;
                                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                        setFormData({...formData, defaultHourlyRate: value});
                                    }
                                }}
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={formData.isVATRegistered}
                                    onChange={e => setFormData({...formData, isVATRegistered: e.target.checked})}
                                />
                                VAT Registered
                            </label>
                        </div>
                        <div className="form-group">
                            <label>Default VAT Rate (%)</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*\.?[0-9]*"
                                value={formData.defaultVATRate}
                                onChange={e => {
                                    const value = e.target.value;
                                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                        setFormData({...formData, defaultVATRate: value});
                                    }
                                }}
                            />
                        </div>
                    </div>
                        <div className="form-actions">
                            <button type="submit" className="btn-primary" disabled={processing}>
                                {processing ? 'Saving...' : (editingCustomer ? 'Update Customer' : 'Create Customer')}
                            </button>
                        </div>
                        </form>
                    </div>
                </div>
            )}

            {allowDataDeletion && selectedIds.size > 0 && (
                <div style={{ background: '#fdf2f2', border: '1px solid #f5c2c7', borderRadius: 6, padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: '#dc3545' }}>{selectedIds.size} customer{selectedIds.size > 1 ? 's' : ''} selected</span>
                    <button onClick={clearSelection} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.2rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>✕ Clear</button>
                    <button onClick={handleBulkDeleteCustomers} style={{ background: '#dc3545', color: '#fff', border: 'none', borderRadius: 4, padding: '0.25rem 0.9rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>🗑️ Delete Selected</button>
                </div>
            )}

            {isMobile ? (
                <div className="mobile-cards">
                    {allowDataDeletion && (
                        <div className="mobile-select-bar">
                            <span>{selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Tap ☑ to select'}</span>
                            {selectedIds.size < customers.length
                                ? <button onClick={selectAllCustomers}>Select All</button>
                                : <button onClick={clearSelection}>✕ Clear</button>
                            }
                        </div>
                    )}
                    {customers.length === 0 ? (
                        <div className="mobile-empty">No customers yet.<br />Tap <strong>+ Add Customer</strong> to get started.</div>
                    ) : customers.map(customer => (
                        <div key={customer.id} className="mobile-card" onClick={() => setViewingCustomer(customer)}>
                            <div className="card-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {allowDataDeletion && (
                                        <input type="checkbox" data-bwignore="true" autoComplete="off"
                                            checked={selectedIds.has(customer.id)}
                                            onChange={() => toggleSelectId(customer.id)}
                                            onClick={e => e.stopPropagation()}
                                            style={{ cursor: 'pointer', width: 16, height: 16 }}
                                        />
                                    )}
                                    <span className="card-id">{customer.customerCode}</span>
                                </div>
                                <strong className="card-amount" style={{ fontSize: '1rem' }}>{customer.name}</strong>
                            </div>
                            <div className="card-body">
                                <div className="card-main-row">
                                    <span>{customer.billingEmail || customer.email || '—'}</span>
                                    {customer.isVATRegistered && <span className="badge badge-green">VAT ✓</span>}
                                </div>
                                <div className="card-meta-row">
                                    {customer.defaultDayRate && <span className="badge">£{customer.defaultDayRate}/day</span>}
                                    {customer.defaultHourlyRate && <span className="badge">£{customer.defaultHourlyRate}/hr</span>}
                                    {customer.contactName && <span className="badge">{customer.contactName}</span>}
                                </div>
                            </div>
                            <div className="card-actions" onClick={e => e.stopPropagation()}>
                                <button onClick={() => handleEdit(customer)} className="card-action-btn" disabled={processing}>✏️ Edit</button>
                                {allowDataDeletion && (
                                    <button onClick={() => handleDelete(customer)} className="card-action-btn" disabled={processing}>🗑️ Delete</button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
            <table className="data-table">
                <thead>
                    <tr>
                        {allowDataDeletion && (
                            <th style={{ width: 40, textAlign: 'center' }}>
                                <input type="checkbox" data-bwignore="true" autoComplete="off" title="Select All"
                                    onChange={e => e.target.checked ? selectAllCustomers() : clearSelection()}
                                    checked={selectedIds.size > 0 && customers.every(c => selectedIds.has(c.id))}
                                />
                            </th>
                        )}
                        <th>Code</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Day Rate</th>
                        <th>Hourly Rate</th>
                        <th>VAT</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {customers.map(customer => (
                        <tr key={customer.id} onClick={() => setViewingCustomer(customer)} style={{ cursor: 'pointer', background: selectedIds.has(customer.id) ? 'rgba(220,53,69,0.05)' : undefined }}>
                            {allowDataDeletion && (
                                <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                                    <input type="checkbox" data-bwignore="true" autoComplete="off" checked={selectedIds.has(customer.id)} onChange={() => toggleSelectId(customer.id)} />
                                </td>
                            )}
                            <td>{customer.customerCode}</td>
                            <td>{customer.name}</td>
                            <td>{customer.billingEmail || customer.email}</td>
                            <td>GBP {customer.defaultDayRate || '-'}</td>
                            <td>GBP {customer.defaultHourlyRate || '-'}</td>
                            <td>{customer.isVATRegistered ? '✓' : '-'}</td>
                            <td>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleEdit(customer); }} 
                                    className="btn-icon"
                                    title="Edit customer"
                                    disabled={processing}
                                >
                                    ✏️
                                </button>
                                {allowDataDeletion && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleDelete(customer); }} 
                                        className="btn-icon"
                                        title="Delete customer"
                                        disabled={processing}
                                        style={{ marginLeft: '5px' }}
                                    >
                                        🗑️
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            )}

            {viewingCustomer && (
                <div className="modal-overlay" onClick={() => setViewingCustomer(null)}>
                    <div className="modal-content customer-view-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="customer-view-title">
                                <div className="customer-view-avatar">{(viewingCustomer.name || '?')[0].toUpperCase()}</div>
                                <div>
                                    <h3>{viewingCustomer.name}</h3>
                                    <span className="customer-view-code">{viewingCustomer.customerCode}</span>
                                </div>
                            </div>
                            <button className="btn-close" onClick={() => setViewingCustomer(null)}>✖</button>
                        </div>
                        <div className="modal-body">
                            <div className="customer-detail-grid">
                                <div className="customer-detail-section">
                                    <h4>Contact Details</h4>
                                    {viewingCustomer.contactName && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">Contact</span>
                                            <span className="customer-detail-value">{viewingCustomer.contactName}</span>
                                        </div>
                                    )}
                                    {viewingCustomer.email && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">Email</span>
                                            <a href={`mailto:${viewingCustomer.email}`} className="customer-detail-value customer-detail-link">{viewingCustomer.email}</a>
                                        </div>
                                    )}
                                    {viewingCustomer.billingEmail && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">Billing Email</span>
                                            <a href={`mailto:${viewingCustomer.billingEmail}`} className="customer-detail-value customer-detail-link">{viewingCustomer.billingEmail}</a>
                                        </div>
                                    )}
                                    {viewingCustomer.ccEmail && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">CC Email</span>
                                            <a href={`mailto:${viewingCustomer.ccEmail}`} className="customer-detail-value customer-detail-link">{viewingCustomer.ccEmail}</a>
                                        </div>
                                    )}
                                    {viewingCustomer.phone && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">Phone</span>
                                            <span className="customer-detail-value">{viewingCustomer.phone}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="customer-detail-section">
                                    <h4>Billing</h4>
                                    {viewingCustomer.billingAddress && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">Address</span>
                                            <span className="customer-detail-value" style={{ whiteSpace: 'pre-line' }}>{viewingCustomer.billingAddress}</span>
                                        </div>
                                    )}
                                    <div className="customer-detail-row">
                                        <span className="customer-detail-label">VAT Registered</span>
                                        <span className="customer-detail-value">
                                            {viewingCustomer.isVATRegistered
                                                ? <span className="customer-badge customer-badge-green">Yes — {viewingCustomer.defaultVATRate ?? 20}%</span>
                                                : <span className="customer-badge customer-badge-grey">No</span>}
                                        </span>
                                    </div>
                                </div>

                                <div className="customer-detail-section">
                                    <h4>Rates</h4>
                                    {viewingCustomer.defaultDayRate && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">Day Rate</span>
                                            <span className="customer-detail-value customer-detail-rate">£{viewingCustomer.defaultDayRate}</span>
                                        </div>
                                    )}
                                    {viewingCustomer.defaultHourlyRate && (
                                        <div className="customer-detail-row">
                                            <span className="customer-detail-label">Hourly Rate</span>
                                            <span className="customer-detail-value customer-detail-rate">£{viewingCustomer.defaultHourlyRate}</span>
                                        </div>
                                    )}
                                    {!viewingCustomer.defaultDayRate && !viewingCustomer.defaultHourlyRate && (
                                        <p className="customer-detail-empty">No default rates set</p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={() => setViewingCustomer(null)}>Close</button>
                            <button className="btn-primary" onClick={() => { setViewingCustomer(null); handleEdit(viewingCustomer); }}>Edit Customer</button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDeleteModal
                isOpen={!!confirmModal}
                title={confirmModal?.title}
                message={confirmModal?.message}
                itemLabels={confirmModal?.itemLabels || []}
                onConfirm={confirmModal?.onConfirm}
                onCancel={() => setConfirmModal(null)}
            />
        </div>
    );
}

