import React, { useEffect, useState } from 'react';
import { getSubscriptions, createSubscription, updateSubscription, deleteSubscription, getNextSubscriptionId, getCompanySettings } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';

const defaultForm = {
    subscriptionId: '',
    name: '',
    type: 'SaaS',
    vendor: '',
    billingCycle: 'Monthly',
    costPerCycle: '',
    renewalDate: '',
    autoRenew: true,
    seats: '',
    status: 'Active',
    adminContact: '',
    adminEmail: '',
    notes: ''
};

export default function Subscriptions() {
    const [subscriptions, setSubscriptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingSubscription, setEditingSubscription] = useState(null);
    const [formData, setFormData] = useState(defaultForm);
    const [companySettings, setCompanySettings] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', itemLabels: [], onConfirm: () => {} });
    const { toast, showToast, clearToast } = useToast();

    useEffect(() => {
        loadSubscriptions();
    }, []);

    async function loadSubscriptions() {
        try {
            setLoading(true);
            const [data, settings] = await Promise.all([getSubscriptions(), getCompanySettings()]);
            setSubscriptions(data);
            setCompanySettings(settings);
        } catch (error) {
            console.error('Error loading subscriptions:', error);
        } finally {
            setLoading(false);
        }
    }

    async function openNewForm() {
        setEditingSubscription(null);
        setFormData(defaultForm);
        try {
            const result = await getNextSubscriptionId();
            setFormData(prev => ({ ...prev, subscriptionId: result.nextId || '' }));
        } catch (error) {
            console.error('Error fetching next subscription ID:', error);
        }
        setShowForm(true);
    }

    function handleEdit(subscription) {
        setEditingSubscription(subscription);
        setFormData({
            subscriptionId: subscription.subscriptionId || '',
            name: subscription.name || '',
            type: subscription.type || 'SaaS',
            vendor: subscription.vendor || '',
            billingCycle: subscription.billingCycle || 'Monthly',
            costPerCycle: subscription.costPerCycle ?? '',
            renewalDate: subscription.renewalDate ? subscription.renewalDate.substring(0, 10) : '',
            autoRenew: subscription.autoRenew ?? true,
            seats: subscription.seats ?? '',
            status: subscription.status || 'Active',
            adminContact: subscription.adminContact || '',
            adminEmail: subscription.adminEmail || '',
            notes: subscription.notes || ''
        });
        setShowForm(true);
    }

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setProcessing(true);
        try {
            const payload = {
                ...formData,
                costPerCycle: formData.costPerCycle === '' ? null : Number(formData.costPerCycle),
                seats: formData.seats === '' ? null : Number(formData.seats),
                renewalDate: formData.renewalDate || null
            };

            if (editingSubscription) {
                await updateSubscription(editingSubscription.id, payload);
            } else {
                await createSubscription(payload);
            }

            await loadSubscriptions();
            setShowForm(false);
            setEditingSubscription(null);
            setFormData(defaultForm);
        } catch (error) {
            console.error('Error saving subscription:', error);
            alert('Failed to save subscription: ' + error.message);
        } finally {
            setProcessing(false);
        }
    }

    const allowDataDeletion = companySettings?.allowDataDeletion === true;

    function handleDelete(subscription) {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Subscription',
            message: 'Are you sure you want to permanently delete this subscription?',
            itemLabels: [`${subscription.name} (${subscription.subscriptionId})`],
            onConfirm: async () => {
                setConfirmModal(m => ({ ...m, isOpen: false }));
                setProcessing(true);
                try {
                    await deleteSubscription(subscription.id);
                    await loadSubscriptions();
                    showToast('Subscription deleted.', 'success');
                } catch (error) {
                    showToast('Failed to delete subscription: ' + error.message, 'error');
                } finally {
                    setProcessing(false);
                }
            }
        });
    }

    return (
        <div className="content-container">
            <div className="section-header">
                <h2>Subscriptions & Licenses</h2>
                <button className="btn-primary" onClick={openNewForm} disabled={processing}>
                    + Add Subscription
                </button>
            </div>

            {showForm && (
                <div className="form-card">
                    <h3>{editingSubscription ? 'Edit Subscription' : 'New Subscription'}</h3>
                    <form onSubmit={handleSubmit}>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Subscription ID</label>
                                <input
                                    type="text"
                                    name="subscriptionId"
                                    value={formData.subscriptionId}
                                    onChange={handleChange}
                                    disabled
                                />
                            </div>
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Type</label>
                                <select name="type" value={formData.type} onChange={handleChange}>
                                    <option>Software License</option>
                                    <option>SaaS</option>
                                    <option>Cloud Platform</option>
                                    <option>Domain/Hosting</option>
                                    <option>Support</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Vendor</label>
                                <input
                                    type="text"
                                    name="vendor"
                                    value={formData.vendor}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>Billing Cycle</label>
                                <select name="billingCycle" value={formData.billingCycle} onChange={handleChange}>
                                    <option>Monthly</option>
                                    <option>Annual</option>
                                    <option>Usage-based</option>
                                    <option>One-time</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Cost per Cycle</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    name="costPerCycle"
                                    value={formData.costPerCycle}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>Renewal Date</label>
                                <input
                                    type="date"
                                    name="renewalDate"
                                    value={formData.renewalDate}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>Auto-Renew</label>
                                <input
                                    type="checkbox"
                                    name="autoRenew"
                                    checked={formData.autoRenew}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>Seats</label>
                                <input
                                    type="number"
                                    name="seats"
                                    value={formData.seats}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>Status</label>
                                <select name="status" value={formData.status} onChange={handleChange}>
                                    <option>Active</option>
                                    <option>Expired</option>
                                    <option>Cancelled</option>
                                    <option>Pending</option>
                                    <option>Trial</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Admin Contact</label>
                                <input
                                    type="text"
                                    name="adminContact"
                                    value={formData.adminContact}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>Admin Email</label>
                                <input
                                    type="email"
                                    name="adminEmail"
                                    value={formData.adminEmail}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group full-width">
                                <label>Notes</label>
                                <textarea
                                    name="notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                        <div className="form-actions">
                            <button type="submit" className="btn-primary" disabled={processing}>
                                {editingSubscription ? 'Update' : 'Create'}
                            </button>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setShowForm(false)}
                                disabled={processing}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="loading">Loading...</div>
            ) : (
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Subscription ID</th>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Vendor</th>
                                <th>Billing</th>
                                <th>Cost</th>
                                <th>Renewal</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {subscriptions.map(subscription => (
                                <tr key={subscription.id}>
                                    <td>{subscription.subscriptionId}</td>
                                    <td>{subscription.name}</td>
                                    <td>{subscription.type}</td>
                                    <td>{subscription.vendor}</td>
                                    <td>{subscription.billingCycle}</td>
                                    <td>{subscription.costPerCycle ? `£${subscription.costPerCycle}` : ''}</td>
                                    <td>{subscription.renewalDate ? subscription.renewalDate.substring(0, 10) : ''}</td>
                                    <td>{subscription.status}</td>
                                    <td>
                                        <button className="btn-secondary" onClick={() => handleEdit(subscription)}>
                                            Edit
                                        </button>
                                        {allowDataDeletion && (
                                            <button className="btn-danger" onClick={() => handleDelete(subscription)}>
                                                Delete
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

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
