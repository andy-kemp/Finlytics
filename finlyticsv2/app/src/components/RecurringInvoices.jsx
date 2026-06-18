import React, { useState, useEffect } from 'react';
import { getRecurringInvoiceTemplates, createRecurringInvoiceTemplate, updateRecurringInvoiceTemplate, deleteRecurringInvoiceTemplate, getCustomers, getLineItemDescriptions } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import AutocompleteInput from './AutocompleteInput';

export default function RecurringInvoices() {
  const [templates, setTemplates] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [descriptionSuggestions, setDescriptionSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const { toast, showToast, clearToast } = useToast();

  const emptyForm = {
    customerId: '',
    customerName: '',
    billingEmail: '',
    poReference: '',
    vatNumber: '',
    frequency: 'Monthly',
    dayOfMonth: 1,
    nextRunDate: '',
    isActive: true,
    notes: '',
    discountPercent: 0,
    discountAmount: 0,
    discountNote: '',
    defaultLineItems: [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }]
  };

  const [formData, setFormData] = useState(emptyForm);

  useEffect(() => {
    loadTemplates();
    loadCustomers();
    getLineItemDescriptions().then(setDescriptionSuggestions).catch(() => {});
  }, []);

  const loadTemplates = async () => {
    try {
      const data = await getRecurringInvoiceTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
      showToast('Failed to load recurring invoice templates', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  };

  const handleCustomerChange = (value) => {
    const customer = customers.find(c => c.id === value);
    if (customer) {
      setFormData(prev => ({
        ...prev,
        customerId: customer.id,
        customerName: customer.name || customer.customerName || '',
        billingEmail: customer.billingEmail || customer.email || ''
      }));
    } else {
      setFormData(prev => ({ ...prev, customerId: value }));
    }
  };

  const updateLineItem = (index, field, value) => {
    const updated = [...formData.defaultLineItems];
    updated[index] = { ...updated[index], [field]: value };
    // Auto-calc line total
    if (['quantity', 'rate'].includes(field)) {
      updated[index].lineTotal = (parseFloat(updated[index].quantity) || 0) * (parseFloat(updated[index].rate) || 0);
    }
    setFormData(prev => ({ ...prev, defaultLineItems: updated }));
  };

  const addLineItem = () => {
    setFormData(prev => ({
      ...prev,
      defaultLineItems: [
        ...prev.defaultLineItems,
        { lineNumber: prev.defaultLineItems.length + 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }
      ]
    }));
  };

  const removeLineItem = (index) => {
    if (formData.defaultLineItems.length <= 1) return;
    const updated = formData.defaultLineItems.filter((_, i) => i !== index).map((item, i) => ({ ...item, lineNumber: i + 1 }));
    setFormData(prev => ({ ...prev, defaultLineItems: updated }));
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      customerId: template.customerId || '',
      customerName: template.customerName || '',
      billingEmail: template.billingEmail || '',
      poReference: template.poReference || '',
      vatNumber: template.vatNumber || '',
      frequency: template.frequency || 'Monthly',
      dayOfMonth: template.dayOfMonth || 1,
      nextRunDate: template.nextRunDate ? template.nextRunDate.split('T')[0] : '',
      isActive: template.isActive !== false,
      notes: template.notes || '',
      discountPercent: template.discountPercent || 0,
      discountAmount: template.discountAmount || 0,
      discountNote: template.discountNote || '',
      defaultLineItems: template.defaultLineItems?.length > 0
        ? template.defaultLineItems
        : [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }]
    });
    setShowForm(true);
  };

  const handleNew = () => {
    setEditingTemplate(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.customerName) {
      showToast('Please select a customer', 'error');
      return;
    }

    try {
      const payload = { ...formData };
      if (editingTemplate) {
        await updateRecurringInvoiceTemplate(editingTemplate.id, payload);
        showToast('Recurring invoice template updated', 'success');
      } else {
        await createRecurringInvoiceTemplate(payload);
        showToast('Recurring invoice template created', 'success');
      }
      setShowForm(false);
      setEditingTemplate(null);
      await loadTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
      showToast('Failed to save template: ' + error.message, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteRecurringInvoiceTemplate(id);
      showToast('Template deleted', 'success');
      await loadTemplates();
    } catch (error) {
      showToast('Failed to delete template', 'error');
    }
    setConfirmModal(null);
  };

  const calcSubtotal = () => formData.defaultLineItems.reduce((sum, li) => sum + (parseFloat(li.lineTotal) || 0), 0);
  const calcVat = () => formData.defaultLineItems.reduce((sum, li) => sum + ((parseFloat(li.lineTotal) || 0) * (parseFloat(li.vatRate) || 0) / 100), 0);

  if (loading) return <div className="loading-spinner"><div className="spinner"></div><p>Loading recurring invoices...</p></div>;

  return (
    <div>
      <Toast toast={toast} onClose={clearToast} />
      {confirmModal && (
        <ConfirmDeleteModal
          title="Delete Recurring Template"
          message={`Delete recurring template for "${confirmModal.customerName}"?`}
          onConfirm={() => handleDelete(confirmModal.id)}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {!showForm ? (
        <>
          <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>🔁 Recurring Invoice Templates</h2>
            <button className="btn btn-primary" onClick={handleNew}>+ New Template</button>
          </div>

          {templates.length === 0 ? (
            <div className="empty-state" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
              <p>No recurring invoice templates yet.</p>
              <p style={{ fontSize: '0.9em' }}>Create a template to auto-generate draft invoices for retainer/contractor clients on a schedule.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Frequency</th>
                    <th>Next Run</th>
                    <th>Default Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => {
                    const subtotal = t.defaultLineItems?.reduce((s, li) => s + (li.lineTotal || 0), 0) || 0;
                    const vat = t.defaultLineItems?.reduce((s, li) => s + ((li.lineTotal || 0) * (li.vatRate || 0) / 100), 0) || 0;
                    return (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.customerName}</strong>
                          {t.billingEmail && <div style={{ fontSize: '0.85em', color: '#64748b' }}>{t.billingEmail}</div>}
                        </td>
                        <td>{t.frequency}</td>
                        <td>{t.nextRunDate ? new Date(t.nextRunDate).toLocaleDateString('en-GB') : '—'}</td>
                        <td>£{(subtotal + vat).toFixed(2)}</td>
                        <td>
                          <span className={`status-badge ${t.isActive ? 'status-issued' : 'status-overdue'}`}>
                            {t.isActive ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-sm" onClick={() => handleEdit(t)} title="Edit">✏️</button>
                          <button className="btn btn-sm btn-danger" onClick={() => setConfirmModal(t)} title="Delete" style={{ marginLeft: 4 }}>🗑️</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* ── Form ── */
        <div className="form-container">
          <h2>{editingTemplate ? 'Edit Recurring Template' : 'New Recurring Template'}</h2>

          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="form-group">
              <label>Customer</label>
              <select value={formData.customerId} onChange={e => handleCustomerChange(e.target.value)}>
                <option value="">Select customer…</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.code || c.customerCode} - {c.name || c.customerName}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Billing Email</label>
              <input type="email" value={formData.billingEmail} onChange={e => setFormData(prev => ({ ...prev, billingEmail: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>PO Reference</label>
              <input value={formData.poReference} onChange={e => setFormData(prev => ({ ...prev, poReference: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>VAT Number</label>
              <input value={formData.vatNumber} onChange={e => setFormData(prev => ({ ...prev, vatNumber: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select value={formData.frequency} onChange={e => setFormData(prev => ({ ...prev, frequency: e.target.value }))}>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Annual">Annual</option>
              </select>
            </div>
            <div className="form-group">
              <label>Day of Month</label>
              <input type="number" min="1" max="28" value={formData.dayOfMonth} onChange={e => setFormData(prev => ({ ...prev, dayOfMonth: parseInt(e.target.value) || 1 }))} />
            </div>
            <div className="form-group">
              <label>Next Run Date</label>
              <input type="date" value={formData.nextRunDate} onChange={e => setFormData(prev => ({ ...prev, nextRunDate: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Active</label>
              <select value={formData.isActive ? 'true' : 'false'} onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.value === 'true' }))}>
                <option value="true">Active</option>
                <option value="false">Paused</option>
              </select>
            </div>
          </div>

          {/* Line Items */}
          <h3 style={{ marginBottom: 8 }}>Default Line Items</h3>
          <p style={{ fontSize: '0.85em', color: '#64748b', marginBottom: 12 }}>
            These are the default line items for each generated invoice. You can adjust quantities before sending.
          </p>
          <table className="data-table" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Description</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Rate (£)</th>
                <th>VAT %</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {formData.defaultLineItems.map((li, idx) => (
                <tr key={idx}>
                  <td><AutocompleteInput value={li.description} onChange={val => updateLineItem(idx, 'description', val)} suggestions={descriptionSuggestions} placeholder="e.g. Consulting - January" /></td>
                  <td>
                    <select value={li.rateType} onChange={e => updateLineItem(idx, 'rateType', e.target.value)}>
                      <option value="Day Rate">Day Rate</option>
                      <option value="Hourly Rate">Hourly Rate</option>
                    </select>
                  </td>
                  <td><input type="number" min="0" step="0.5" value={li.quantity} onChange={e => updateLineItem(idx, 'quantity', parseFloat(e.target.value) || 0)} style={{ width: 70 }} /></td>
                  <td><input type="number" min="0" step="0.01" value={li.rate} onChange={e => updateLineItem(idx, 'rate', parseFloat(e.target.value) || 0)} style={{ width: 90 }} /></td>
                  <td><input type="number" min="0" max="100" value={li.vatRate} onChange={e => updateLineItem(idx, 'vatRate', parseFloat(e.target.value) || 0)} style={{ width: 60 }} /></td>
                  <td style={{ fontWeight: 600 }}>£{(li.lineTotal || 0).toFixed(2)}</td>
                  <td>
                    {formData.defaultLineItems.length > 1 && (
                      <button className="btn btn-sm btn-danger" onClick={() => removeLineItem(idx)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-sm" onClick={addLineItem} style={{ marginBottom: 16 }}>+ Add Line</button>

          <div style={{ textAlign: 'right', marginBottom: 16, fontSize: '0.95em' }}>
            <div>Subtotal: <strong>£{calcSubtotal().toFixed(2)}</strong></div>
            <div>VAT: <strong>£{calcVat().toFixed(2)}</strong></div>
            <div style={{ fontSize: '1.1em' }}>Total: <strong>£{(calcSubtotal() + calcVat()).toFixed(2)}</strong></div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Notes</label>
            <textarea rows={2} value={formData.notes} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} />
          </div>

          <div className="form-actions" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleSave}>
              {editingTemplate ? 'Update Template' : 'Create Template'}
            </button>
            <button className="btn" onClick={() => { setShowForm(false); setEditingTemplate(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
