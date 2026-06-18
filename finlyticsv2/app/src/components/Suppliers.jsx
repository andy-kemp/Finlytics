import React, { useEffect, useState } from 'react';
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, generateCode, getAuthHeaders } from '../services/apiService';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://finlyticsdevfunc.azurewebsites.net/api';

export default function Suppliers() {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        remittanceEmail: '',
        category: '',
        payeeType: 'Supplier',
        isActive: true,
        onHold: false,
        primaryContact: '',
        phone: '',
        paymentMethod: 'Bank Transfer',
        paymentTerms: '30 Days',
        currency: 'GBP',
        defaultVATRate: 20,
        vatRegistration: '',
        accountNumber: '',
        sortCode: '',
        iban: ''
    });

    useEffect(() => {
        loadSuppliers();
    }, []);

    async function loadSuppliers() {
        try {
            const data = await getSuppliers();
            setSuppliers(data);
        } catch (error) {
            console.error('Error loading suppliers:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(supplier) {
        if (supplier.id === null || supplier.id === undefined || (typeof supplier.id === 'string' && supplier.id.trim() === '')) {
            if (confirm(`This payee (${supplier.name}) has no ID and is corrupted data. Would you like to delete ALL corrupted customers and suppliers (records without IDs)?`)) {
                setProcessing(true);
                try {
                    const headers = await getAuthHeaders();
                    const response = await fetch(`${API_BASE}/cleanup/corrupted-records`, {
                        method: 'POST',
                        headers
                    });
                    const result = await response.json();
                    if (result.success) {
                        alert(`Successfully deleted ${result.customersDeleted} corrupted customers and ${result.suppliersDeleted} corrupted suppliers`);
                        await loadSuppliers();
                    } else {
                        alert('Failed to delete corrupted records: ' + result.error);
                    }
                } catch (error) {
                    console.error('Error deleting corrupted records:', error);
                    alert('Failed to delete corrupted records: ' + error.message);
                } finally {
                    setProcessing(false);
                }
            }
            return;
        }

        if (!confirm(`Are you sure you want to delete payee "${supplier.name}" (${supplier.supplierCode})?`)) {
            return;
        }

        setProcessing(true);
        try {
            await deleteSupplier(supplier.id);
            await loadSuppliers();
        } catch (error) {
            console.error('Error deleting supplier:', error);
            alert('Failed to delete payee: ' + error.message);
        } finally {
            setProcessing(false);
        }
    }

    function handleEdit(supplier) {
        setEditingSupplier(supplier);
        setFormData({
            name: supplier.name || '',
            email: supplier.email || '',
            remittanceEmail: supplier.remittanceEmail || '',
            category: supplier.category || '',
            payeeType: supplier.payeeType || 'Supplier',
            isActive: supplier.isActive ?? true,
            onHold: supplier.onHold ?? false,
            primaryContact: supplier.primaryContact || '',
            phone: supplier.phone || '',
            paymentMethod: supplier.paymentMethod || 'Bank Transfer',
            paymentTerms: supplier.paymentTerms || '30 Days',
            currency: supplier.currency || 'GBP',
            defaultVATRate: supplier.defaultVATRate ?? 20,
            vatRegistration: supplier.vatRegistration || '',
            accountNumber: supplier.accountNumber || '',
            sortCode: supplier.sortCode || '',
            iban: supplier.iban || ''
        });
        setShowForm(true);
    }

    function handleCancelEdit() {
        setEditingSupplier(null);
        setShowForm(false);
        setFormData({
            name: '',
            email: '',
            remittanceEmail: '',
            category: '',
            payeeType: 'Supplier',
            isActive: true,
            onHold: false,
            primaryContact: '',
            phone: '',
            paymentMethod: 'Bank Transfer',
            paymentTerms: '30 Days',
            currency: 'GBP',
            defaultVATRate: 20,
            vatRegistration: '',
            accountNumber: '',
            sortCode: '',
            iban: ''
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setProcessing(true);
        try {
            if (editingSupplier) {
                // Update existing supplier - include ID, code, and supplierCode in the data
                const updateData = { 
                    ...formData, 
                    id: editingSupplier.id,
                    code: editingSupplier.code || editingSupplier.supplierCode,
                    supplierCode: editingSupplier.code || editingSupplier.supplierCode
                };
                await updateSupplier(editingSupplier.id, updateData);
                alert('Payee updated successfully!');
            } else {
                const codeResult = await generateCode(formData.name, 'Supplier');
                const newSupplier = { ...formData, supplierCode: codeResult.code };
                await createSupplier(newSupplier);
                alert('Payee created successfully!');
            }
            handleCancelEdit();
            loadSuppliers();
        } catch (error) {
            console.error('Error saving payee:', error);
            alert(`Failed to ${editingSupplier ? 'update' : 'create'} payee: ${error.message}`);
        } finally {
            setProcessing(false);
        }
    }

    if (loading) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading payees...</div>
        </div>
    );

    if (processing) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <div className="loading-text">{editingSupplier ? 'Updating payee...' : 'Creating payee...'}</div>
            </div>
        );
    }

    return (
        <div className="suppliers">
            <div className="page-header">
                <h1>Payees</h1>
                <button onClick={() => {
                    if (showForm) {
                        handleCancelEdit();
                    } else {
                        setShowForm(true);
                    }
                }} className="btn-primary">
                    {showForm ? 'Cancel' : '+ Add Payee'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} className="entity-form">
                    <h2>{editingSupplier ? 'Edit Payee' : 'New Payee'}</h2>
                    
                    <h3>Basic Information</h3>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Payee Name *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Payee Type *</label>
                            <select
                                value={formData.payeeType}
                                onChange={e => setFormData({...formData, payeeType: e.target.value})}
                                required
                            >
                                <option value="Supplier">Supplier</option>
                                <option value="HMRC">HMRC</option>
                                <option value="Director">Director</option>
                                <option value="Payroll">Payroll</option>
                                <option value="Pension Provider">Pension Provider</option>
                                <option value="Utility">Utility</option>
                                <option value="Landlord">Landlord</option>
                                <option value="Internal Ledger Account">Internal Ledger Account</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Category</label>
                            <select
                                value={formData.category}
                                onChange={e => setFormData({...formData, category: e.target.value})}
                            >
                                <option value="">Select Category</option>
                                <option value="Equipment">Equipment</option>
                                <option value="Software">Software</option>
                                <option value="Cloud Services">Cloud Services</option>
                                <option value="Fuel">Fuel</option>
                                <option value="Travel">Travel</option>
                                <option value="Insurance">Insurance</option>
                                <option value="Professional Fees">Professional Fees</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({...formData, isActive: e.target.checked})}
                                />
                                Is Active
                            </label>
                            <label style={{ marginLeft: '20px' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.onHold}
                                    onChange={e => setFormData({...formData, onHold: e.target.checked})}
                                />
                                On Hold
                            </label>
                        </div>
                    </div>

                    <h3>Contact Information</h3>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Primary Contact</label>
                            <input
                                type="text"
                                value={formData.primaryContact}
                                onChange={e => setFormData({...formData, primaryContact: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label>Phone</label>
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={e => setFormData({...formData, phone: e.target.value})}
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>General Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({...formData, email: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label>Remittance Email</label>
                            <input
                                type="email"
                                value={formData.remittanceEmail}
                                onChange={e => setFormData({...formData, remittanceEmail: e.target.value})}
                            />
                        </div>
                    </div>

                    <h3>Payment Settings</h3>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Payment Method</label>
                            <select
                                value={formData.paymentMethod}
                                onChange={e => setFormData({...formData, paymentMethod: e.target.value})}
                            >
                                <option value="Bank Transfer">Bank Transfer</option>
                                <option value="Direct Debit">Direct Debit</option>
                                <option value="Card">Card</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Payment Terms</label>
                            <select
                                value={formData.paymentTerms}
                                onChange={e => setFormData({...formData, paymentTerms: e.target.value})}
                            >
                                <option value="Immediate">Immediate</option>
                                <option value="7 Days">7 Days</option>
                                <option value="14 Days">14 Days</option>
                                <option value="30 Days">30 Days</option>
                                <option value="60 Days">60 Days</option>
                                <option value="EOM+30">EOM+30</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Currency</label>
                            <select
                                value={formData.currency}
                                onChange={e => setFormData({...formData, currency: e.target.value})}
                            >
                                <option value="GBP">GBP</option>
                                <option value="EUR">EUR</option>
                                <option value="USD">USD</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Default VAT Rate (%)</label>
                            <input
                                type="text"
                                inputMode="decimal"
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

                    <h3>Bank Details</h3>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Sort Code</label>
                            <input
                                type="text"
                                value={formData.sortCode}
                                placeholder="00-00-00"
                                onChange={e => setFormData({...formData, sortCode: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label>Account Number</label>
                            <input
                                type="text"
                                value={formData.accountNumber}
                                placeholder="00000000"
                                onChange={e => setFormData({...formData, accountNumber: e.target.value})}
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>IBAN</label>
                            <input
                                type="text"
                                value={formData.iban}
                                onChange={e => setFormData({...formData, iban: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label>VAT Registration</label>
                            <input
                                type="text"
                                value={formData.vatRegistration}
                                onChange={e => setFormData({...formData, vatRegistration: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className="form-actions">
                        <button type="submit" className="btn-primary">
                            {editingSupplier ? 'Update Payee' : 'Create Payee'}
                        </button>
                    </div>
                </form>
            )}

            <table className="data-table">
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Payment Terms</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {suppliers.map(supplier => (
                        <tr key={supplier.id} style={{ backgroundColor: supplier.onHold ? '#ffebee' : 'transparent' }}>
                            <td>{supplier.supplierCode}</td>
                            <td>{supplier.name}</td>
                            <td>{supplier.payeeType || 'Supplier'}</td>
                            <td>{supplier.remittanceEmail || supplier.email || '-'}</td>
                            <td>{supplier.phone || '-'}</td>
                            <td>{supplier.paymentTerms || '-'}</td>
                            <td>
                                {supplier.onHold ? '⚠️ On Hold' : supplier.isActive !== false ? '✓ Active' : '✗ Inactive'}
                            </td>
                            <td>
                                <button 
                                    onClick={() => handleEdit(supplier)} 
                                    className="btn-icon"
                                    title="Edit payee"
                                    disabled={processing}
                                >
                                    ✏️
                                </button>
                                <button 
                                    onClick={() => handleDelete(supplier)} 
                                    className="btn-icon"
                                    title="Delete payee"
                                    disabled={processing}
                                    style={{ marginLeft: '5px' }}
                                >
                                    🗑️
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

