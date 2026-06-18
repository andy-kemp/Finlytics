import React, { useState, useEffect } from 'react';
import { getCategorizationRules, createCategorizationRule, updateCategorizationRule, deleteCategorizationRule, applyCategorizationRules } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';

export default function CategorizationRules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [applying, setApplying] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const { toast, showToast, clearToast } = useToast();

  const emptyForm = {
    name: '',
    matchPattern: '',
    matchField: 'Description',
    direction: '',
    amountMin: '',
    amountMax: '',
    targetCategory: '',
    priority: 100,
    isActive: true
  };

  const [formData, setFormData] = useState(emptyForm);

  useEffect(() => { loadRules(); }, []);

  const loadRules = async () => {
    try {
      const data = await getCategorizationRules();
      setRules(data);
    } catch (error) {
      console.error('Error loading rules:', error);
      showToast('Failed to load categorisation rules', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name || '',
      matchPattern: rule.matchPattern || '',
      matchField: rule.matchField || 'Description',
      direction: rule.direction || '',
      amountMin: rule.amountMin ?? '',
      amountMax: rule.amountMax ?? '',
      targetCategory: rule.targetCategory || '',
      priority: rule.priority ?? 100,
      isActive: rule.isActive !== false
    });
    setShowForm(true);
  };

  const handleNew = () => {
    setEditingRule(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.matchPattern || !formData.targetCategory) {
      showToast('Please fill in Name, Match Pattern, and Target Category', 'error');
      return;
    }

    try {
      const payload = {
        ...formData,
        amountMin: formData.amountMin !== '' ? parseFloat(formData.amountMin) : null,
        amountMax: formData.amountMax !== '' ? parseFloat(formData.amountMax) : null,
        direction: formData.direction || null
      };

      if (editingRule) {
        await updateCategorizationRule(editingRule.id, payload);
        showToast('Rule updated', 'success');
      } else {
        await createCategorizationRule(payload);
        showToast('Rule created', 'success');
      }
      setShowForm(false);
      setEditingRule(null);
      await loadRules();
    } catch (error) {
      showToast('Failed to save rule: ' + error.message, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteCategorizationRule(id);
      showToast('Rule deleted', 'success');
      await loadRules();
    } catch (error) {
      showToast('Failed to delete rule', 'error');
    }
    setConfirmModal(null);
  };

  const handleApplyAll = async () => {
    setApplying(true);
    try {
      const result = await applyCategorizationRules();
      const count = result.categorizedCount ?? result.categorised ?? 0;
      showToast(`Applied rules — ${count} transaction(s) categorised`, 'success');
    } catch (error) {
      showToast('Failed to apply rules: ' + error.message, 'error');
    } finally {
      setApplying(false);
    }
  };

  const commonCategories = [
    'Advertising', 'Bank Charges', 'Computer Equipment', 'Consulting Income',
    'Entertainment', 'Insurance', 'Legal & Professional', 'Motor Expenses',
    'Office Costs', 'Postage & Delivery', 'Printing & Stationery', 'Rent',
    'Repairs & Maintenance', 'Sales', 'Software & IT', 'Staff Costs',
    'Subscriptions', 'Telephone & Internet', 'Training', 'Travel',
    'Utilities', 'Other Income', 'Other Expenses'
  ];

  if (loading) return <div className="loading-spinner"><div className="spinner"></div><p>Loading categorisation rules...</p></div>;

  return (
    <div>
      <Toast toast={toast} onClose={clearToast} />
      {confirmModal && (
        <ConfirmDeleteModal
          title="Delete Rule"
          message={`Delete rule "${confirmModal.name}"?`}
          onConfirm={() => handleDelete(confirmModal.id)}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {!showForm ? (
        <>
          <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>🏷️ Auto-Categorisation Rules</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={handleApplyAll} disabled={applying || rules.length === 0}>
                {applying ? '⏳ Applying…' : '▶️ Apply Rules to Uncategorised'}
              </button>
              <button className="btn btn-primary" onClick={handleNew}>+ New Rule</button>
            </div>
          </div>

          <p style={{ fontSize: '0.9em', color: '#64748b', marginBottom: 16 }}>
            Rules automatically categorise bank transactions when imported via TrueLayer sync or CSV upload. 
            Lower priority numbers run first. The first matching rule wins.
          </p>

          {rules.length === 0 ? (
            <div className="empty-state" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
              <p>No categorisation rules yet.</p>
              <p style={{ fontSize: '0.9em' }}>Create rules to auto-categorise your bank transactions based on description, merchant name, or amount.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Name</th>
                    <th>Match</th>
                    <th>Field</th>
                    <th>Direction</th>
                    <th>Amount Range</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rules].sort((a, b) => (a.priority || 100) - (b.priority || 100)).map(r => (
                    <tr key={r.id}>
                      <td>{r.priority}</td>
                      <td><strong>{r.name}</strong></td>
                      <td><code style={{ fontSize: '0.85em' }}>{r.matchPattern}</code></td>
                      <td>{r.matchField}</td>
                      <td>{r.direction || 'Any'}</td>
                      <td>
                        {r.amountMin != null || r.amountMax != null
                          ? `${r.amountMin != null ? '£' + r.amountMin : '—'} – ${r.amountMax != null ? '£' + r.amountMax : '—'}`
                          : 'Any'}
                      </td>
                      <td>{r.targetCategory}</td>
                      <td>
                        <span className={`status-badge ${r.isActive ? 'status-issued' : 'status-overdue'}`}>
                          {r.isActive ? 'Active' : 'Off'}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-sm" onClick={() => handleEdit(r)} title="Edit">✏️</button>
                        <button className="btn btn-sm btn-danger" onClick={() => setConfirmModal(r)} title="Delete" style={{ marginLeft: 4 }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* ── Form ── */
        <div className="form-container">
          <h2>{editingRule ? 'Edit Rule' : 'New Categorisation Rule'}</h2>

          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="form-group">
              <label>Rule Name</label>
              <input value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. AWS charges" />
            </div>
            <div className="form-group">
              <label>Target Category</label>
              <select value={formData.targetCategory} onChange={e => setFormData(prev => ({ ...prev, targetCategory: e.target.value }))}>
                <option value="">Select category…</option>
                {commonCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                style={{ marginTop: 4 }}
                value={formData.targetCategory}
                onChange={e => setFormData(prev => ({ ...prev, targetCategory: e.target.value }))}
                placeholder="Or type a custom category"
              />
            </div>
            <div className="form-group">
              <label>Match Pattern</label>
              <input value={formData.matchPattern} onChange={e => setFormData(prev => ({ ...prev, matchPattern: e.target.value }))} placeholder="e.g. Amazon Web Services or AWS.*" />
              <small style={{ color: '#94a3b8' }}>Supports regex or plain text (case-insensitive)</small>
            </div>
            <div className="form-group">
              <label>Match Field</label>
              <select value={formData.matchField} onChange={e => setFormData(prev => ({ ...prev, matchField: e.target.value }))}>
                <option value="Description">Description</option>
                <option value="MerchantName">Merchant Name</option>
                <option value="Reference">Reference</option>
              </select>
            </div>
            <div className="form-group">
              <label>Direction</label>
              <select value={formData.direction} onChange={e => setFormData(prev => ({ ...prev, direction: e.target.value }))}>
                <option value="">Any</option>
                <option value="In">In (Income)</option>
                <option value="Out">Out (Expense)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <input type="number" min="1" max="9999" value={formData.priority} onChange={e => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) || 100 }))} />
              <small style={{ color: '#94a3b8' }}>Lower = runs first</small>
            </div>
            <div className="form-group">
              <label>Min Amount (£)</label>
              <input type="number" min="0" step="0.01" value={formData.amountMin} onChange={e => setFormData(prev => ({ ...prev, amountMin: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>Max Amount (£)</label>
              <input type="number" min="0" step="0.01" value={formData.amountMax} onChange={e => setFormData(prev => ({ ...prev, amountMax: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label>Active</label>
              <select value={formData.isActive ? 'true' : 'false'} onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.value === 'true' }))}>
                <option value="true">Active</option>
                <option value="false">Disabled</option>
              </select>
            </div>
          </div>

          <div className="form-actions" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleSave}>
              {editingRule ? 'Update Rule' : 'Create Rule'}
            </button>
            <button className="btn" onClick={() => { setShowForm(false); setEditingRule(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
