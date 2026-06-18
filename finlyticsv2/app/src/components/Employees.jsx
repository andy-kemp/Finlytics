import React, { useState, useEffect } from 'react';
import { getEmployees, createEmployee, updateEmployee, getNextEmployeeNumber, inviteTeamMember, getTeamMembers } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';

const TABS = ['👤 Personal', '💷 PAYE', '🏦 Bank'];

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const [inviteStatus, setInviteStatus] = useState({}); // { employeeId: 'Invited'|'Active' }
  const { toast, showToast, clearToast } = useToast();
  const [formData, setFormData] = useState({
    employeeNumber: '',
    name: '',
    email: '',
    personalEmail: '',
    nationalInsuranceNumber: '',
    taxCode: '1257L',
    niCategory: 'A',
    annualSalary: '',
    paymentSchedule: 'Monthly',
    startDate: new Date().toISOString().split('T')[0],
    bankAccountName: '',
    bankAccountNumber: '',
    bankSortCode: '',
    address: '',
    phoneNumber: '',
    isActive: true,
    isDirector: false,
    notes: ''
  });

  useEffect(() => {
    loadEmployees();
    loadTeamStatus();
  }, []);

  const loadEmployees = async () => {
    try {
      const data = await getEmployees();
      setEmployees(data);
    } catch (error) {
      console.error('Error loading employees:', error);
      showToast('Failed to load employees', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadTeamStatus = async () => {
    try {
      const members = await getTeamMembers();
      const statusMap = {};
      members.forEach(m => {
        if (m.employeeId) statusMap[m.employeeId] = m.status;
        // Also match by email
        statusMap[`email:${m.email?.toLowerCase()}`] = m.status;
      });
      setInviteStatus(statusMap);
    } catch (error) {
      console.error('Error loading team status:', error);
    }
  };

  const getEmployeeInviteStatus = (employee) => {
    if (inviteStatus[employee.id]) return inviteStatus[employee.id];
    if (employee.email && inviteStatus[`email:${employee.email.toLowerCase()}`])
      return inviteStatus[`email:${employee.email.toLowerCase()}`];
    if (employee.personalEmail && inviteStatus[`email:${employee.personalEmail.toLowerCase()}`])
      return inviteStatus[`email:${employee.personalEmail.toLowerCase()}`];
    return null;
  };

  const handleInviteToExpenses = async (employee) => {
    if (!employee.email) {
      showToast('Employee must have a business email address to invite', 'error');
      return;
    }
    if (!confirm(`Invite ${employee.name} to the Expense Portal?\n\nInvite will be sent to: ${employee.email}\nThey can sign up using either their business or personal email.`)) return;

    setProcessingMessage('Sending invitation...');
    setProcessing(true);
    try {
      const result = await inviteTeamMember({
        email: employee.email,
        displayName: employee.name,
        role: employee.isDirector ? 'Admin' : 'Employee',
        invitedBy: 'admin'
      });
      showToast(`Invitation sent to ${employee.name}! Invite URL copied to clipboard.`, 'success');
      // Copy invite URL to clipboard
      if (result.inviteUrl) {
        try { await navigator.clipboard.writeText(result.inviteUrl); } catch { }
      }
      await loadTeamStatus();
      setViewingEmployee(null);
    } catch (error) {
      console.error('Error inviting employee:', error);
      const msg = error.message.includes('already been invited')
        ? `${employee.name} has already been invited to the expense portal`
        : `Failed to invite employee: ${error.message}`;
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const formatNiNumber = (value) => {
    const clean = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 9);
    return clean
      .replace(/^(\w{2})(\d{2})(\d{2})(\d{2})(\w)$/, '$1 $2 $3 $4 $5')
      .replace(/^(\w{2})(\d{2})(\d{2})(\d{1,2})$/, '$1 $2 $3 $4')
      .replace(/^(\w{2})(\d{2})(\d{1,2})$/, '$1 $2 $3')
      .replace(/^(\w{2})(\d{1,2})$/, '$1 $2');
  };

  const handleNewEmployee = async () => {
    setFormData({
      employeeNumber: '',
      name: '',
      email: '',
      personalEmail: '',
      nationalInsuranceNumber: '',
      taxCode: '1257L',
      niCategory: 'A',
      annualSalary: '',
      paymentSchedule: 'Monthly',
      startDate: new Date().toISOString().split('T')[0],
      bankAccountName: '',
      bankAccountNumber: '',
      bankSortCode: '',
      address: '',
      phoneNumber: '',
      isActive: true,
      isDirector: false,
      notes: ''
    });
    setEditingEmployee(null);
    setActiveTab(0);
    try {
      const result = await getNextEmployeeNumber();
      setFormData(prev => ({ ...prev, employeeNumber: result.nextNumber || '' }));
    } catch (error) {
      console.error('Error fetching next employee number:', error);
    }
    setShowForm(true);
  };

  const handleEdit = (employee) => {
    setFormData({
      employeeNumber: employee.employeeNumber || '',
      name: employee.name || '',
      email: employee.email || '',
      personalEmail: employee.personalEmail || '',
      nationalInsuranceNumber: employee.nationalInsuranceNumber || '',
      taxCode: employee.taxCode || '1257L',
      niCategory: employee.niCategory || 'A',
      annualSalary: employee.annualSalary?.toString() || '',
      paymentSchedule: employee.paymentSchedule || 'Monthly',
      startDate: employee.startDate || new Date().toISOString().split('T')[0],
      bankAccountName: employee.bankAccountName || '',
      bankAccountNumber: employee.bankAccountNumber || '',
      bankSortCode: employee.bankSortCode || '',
      address: employee.address || '',
      phoneNumber: employee.phoneNumber || '',
      isActive: employee.isActive !== false,
      isDirector: employee.isDirector === true,
      notes: employee.notes || ''
    });
    setEditingEmployee(employee);
    setActiveTab(0);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingEmployee(null);
    setActiveTab(0);
    setFormData({
      employeeNumber: '',
      name: '',
      email: '',
      personalEmail: '',
      nationalInsuranceNumber: '',
      taxCode: '1257L',
      niCategory: 'A',
      annualSalary: '',
      paymentSchedule: 'Monthly',
      startDate: new Date().toISOString().split('T')[0],
      bankAccountName: '',
      bankAccountNumber: '',
      bankSortCode: '',
      address: '',
      phoneNumber: '',
      isActive: true,
      isDirector: false,
      notes: ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setProcessingMessage(editingEmployee ? 'Updating employee...' : 'Creating employee...');
    setProcessing(true);

    try {
      const employeeData = {
        ...formData,
        annualSalary: parseFloat(formData.annualSalary) || 0
      };

      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, employeeData);
        showToast('Employee updated successfully!', 'success');
      } else {
        await createEmployee(employeeData);
        showToast('Employee created successfully!', 'success');
      }

      await loadEmployees();
      handleCancel();
    } catch (error) {
      console.error('Error saving employee:', error);
      showToast(`Failed to save employee: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleActive = async (employee) => {
    const action = employee.isActive ? 'deactivate' : 'reactivate';
    if (!confirm(`Are you sure you want to ${action} employee "${employee.name}"?\n\nNote: Employees are never deleted — their record and ID are permanently retained.`)) return;

    setProcessingMessage(employee.isActive ? 'Deactivating employee...' : 'Reactivating employee...');
    setProcessing(true);
    try {
      await updateEmployee(employee.id, { ...employee, isActive: !employee.isActive });
      showToast(employee.isActive ? `${employee.name} deactivated.` : `${employee.name} reactivated.`, 'success');
      await loadEmployees();
    } catch (error) {
      console.error('Error toggling employee active state:', error);
      showToast(`Failed to ${action} employee`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Loading employees...</div>
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
    <div className="employees-container">
      <Toast toast={toast} onClose={clearToast} />
      <div className="page-header">
        <h1>Employees</h1>
        <button onClick={handleNewEmployee} className="btn-primary">
          + New Employee
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => !processing && handleCancel()}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}
               style={{ maxWidth: '580px', width: '95%' }}>

            {/* ── Header ── */}
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>
                  {editingEmployee ? `Edit — ${editingEmployee.name}` : 'New Employee'}
                </h3>
                <div style={{ fontSize: '0.78em', color: '#888', marginTop: '0.15rem' }}>
                  {formData.employeeNumber && <span>#{formData.employeeNumber}</span>}
                  {formData.isDirector && (
                    <span style={{ marginLeft: '0.5rem', background: '#dbeafe', color: '#1d4ed8',
                                   borderRadius: '0.25rem', padding: '0.1rem 0.4rem', fontSize: '0.9em' }}>
                      Director
                    </span>
                  )}
                  {formData.isActive === false && (
                    <span style={{ marginLeft: '0.5rem', background: '#fee2e2', color: '#dc2626',
                                   borderRadius: '0.25rem', padding: '0.1rem 0.4rem', fontSize: '0.9em' }}>
                      Inactive
                    </span>
                  )}
                </div>
              </div>
              <button className="btn-close" onClick={handleCancel} disabled={processing}>✕</button>
            </div>

            {/* ── Tabs ── */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', padding: '0 1.25rem' }}>
              {TABS.map((tab, i) => (
                <button key={i} type="button"
                  onClick={() => setActiveTab(i)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '0.65rem 1rem', fontSize: '0.85em', fontWeight: 500,
                    color: activeTab === i ? '#2563eb' : '#6b7280',
                    borderBottom: activeTab === i ? '2px solid #2563eb' : '2px solid transparent',
                    marginBottom: '-1px', whiteSpace: 'nowrap'
                  }}>
                  {tab}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ padding: '1.25rem', minHeight: '320px' }}>

                {/* ══ Tab 0: Personal ══════════════════════════════════════ */}
                {activeTab === 0 && (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Full Name <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="text" value={formData.name} required
                          onChange={e => setFormData({ ...formData, name: e.target.value })}
                          placeholder="e.g., Jane Smith" autoFocus />
                      </div>
                      <div className="form-group">
                        <label>Employee Number</label>
                        <input type="text" value={formData.employeeNumber} readOnly
                          style={{ background: '#f3f4f6', cursor: 'not-allowed', color: '#6b7280' }} />
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Email <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="email" value={formData.email} required
                          onChange={e => setFormData({ ...formData, email: e.target.value })}
                          placeholder="jane@company.com" />
                        <small style={{ color: '#6b7280' }}>Business email</small>
                      </div>
                      <div className="form-group">
                        <label>Personal Email</label>
                        <input type="email" value={formData.personalEmail}
                          onChange={e => setFormData({ ...formData, personalEmail: e.target.value })}
                          placeholder="jane@gmail.com" />
                        <small style={{ color: '#6b7280' }}>For expense portal sign-up</small>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Phone Number</label>
                        <input type="tel" value={formData.phoneNumber}
                          onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })}
                          placeholder="07700 900000" />
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Start Date <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="date" value={formData.startDate} required
                          onChange={e => setFormData({ ...formData, startDate: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                        {/* Director + Active toggles side by side */}
                        <div style={{ display: 'flex', gap: '1.25rem', marginTop: '1.6rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                                          cursor: 'pointer', userSelect: 'none', fontSize: '0.9em' }}>
                            <input type="checkbox" checked={formData.isDirector}
                              onChange={e => setFormData({ ...formData, isDirector: e.target.checked })}
                              style={{ width: 17, height: 17, cursor: 'pointer', margin: 0 }} />
                            <span>
                              Director
                              <span style={{ display: 'block', fontSize: '0.72em', color: '#6b7280', fontWeight: 400 }}>
                                Affects NI calc
                              </span>
                            </span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                                          cursor: 'pointer', userSelect: 'none', fontSize: '0.9em' }}>
                            <input type="checkbox" checked={formData.isActive}
                              onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                              style={{ width: 17, height: 17, cursor: 'pointer', margin: 0 }} />
                            <span>
                              Active
                              <span style={{ display: 'block', fontSize: '0.72em', color: '#6b7280', fontWeight: 400 }}>
                                Included in payroll
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Address</label>
                      <textarea rows="3" value={formData.address}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        placeholder="Street, City, Postcode" />
                    </div>

                    <div className="form-group">
                      <label>Notes</label>
                      <textarea rows="2" value={formData.notes}
                        onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                    </div>
                  </>
                )}

                {/* ══ Tab 1: PAYE ══════════════════════════════════════════ */}
                {activeTab === 1 && (
                  <>
                    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd',
                                  borderRadius: '0.375rem', padding: '0.625rem 0.875rem',
                                  marginBottom: '1rem', fontSize: '0.8em', color: '#0369a1' }}>
                      These fields are used directly by payroll calculations and FPS submissions to HMRC.
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>National Insurance Number <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="text" value={formData.nationalInsuranceNumber} required
                          onChange={e => setFormData({ ...formData, nationalInsuranceNumber: formatNiNumber(e.target.value) })}
                          placeholder="QQ 12 34 56 C" maxLength="13" />
                        <small style={{ color: '#6b7280' }}>Format: AB 12 34 56 C</small>
                      </div>
                      <div className="form-group">
                        <label>Tax Code <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="text" value={formData.taxCode} required
                          onChange={e => setFormData({ ...formData, taxCode: e.target.value.toUpperCase() })}
                          placeholder="1257L" />
                        <small style={{ color: '#6b7280' }}>
                          {formData.taxCode === '1257L' ? '1257L → £12,570 personal allowance' : ''}
                        </small>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>NI Category</label>
                        <select value={formData.niCategory}
                          onChange={e => setFormData({ ...formData, niCategory: e.target.value })}>
                          <option value="A">A – Standard (most employees)</option>
                          <option value="B">B – Married women's reduced rate</option>
                          <option value="C">C – Over state pension age (no employee NI)</option>
                          <option value="H">H – Apprentice under 25</option>
                          <option value="M">M – Under 21</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Payment Schedule <span style={{ color: '#dc2626' }}>*</span></label>
                        <select value={formData.paymentSchedule} required
                          onChange={e => setFormData({ ...formData, paymentSchedule: e.target.value })}>
                          <option value="Monthly">Monthly</option>
                          <option value="Weekly">Weekly</option>
                          <option value="Bi-weekly">Bi-weekly</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Annual Salary (£) <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="number" step="0.01" min="0" value={formData.annualSalary} required
                          onChange={e => setFormData({ ...formData, annualSalary: e.target.value })}
                          placeholder="12570.00" />
                      </div>
                      {/* Monthly preview */}
                      <div className="form-group">
                        <label style={{ color: '#6b7280' }}>Monthly Pay (preview)</label>
                        <div style={{ padding: '0.5rem 0.75rem', background: '#f3f4f6',
                                      borderRadius: '0.375rem', border: '1px solid #e5e7eb',
                                      fontSize: '1.05em', fontWeight: 600, color: '#111827',
                                      lineHeight: '1.9rem' }}>
                          {formData.annualSalary
                            ? `£${(parseFloat(formData.annualSalary) / 12).toFixed(2)}`
                            : '—'}
                        </div>
                        {formData.annualSalary && parseFloat(formData.annualSalary) <= 12570 && (
                          <small style={{ color: '#16a34a' }}>✓ Within personal allowance — £0 income tax</small>
                        )}
                        {formData.annualSalary && parseFloat(formData.annualSalary) > 12570 && (
                          <small style={{ color: '#d97706' }}>⚠ Income tax applies above £12,570</small>
                        )}
                      </div>
                    </div>

                    {/* Employer NI estimate */}
                    {formData.annualSalary && parseFloat(formData.annualSalary) > 0 && formData.niCategory !== 'C' && (
                      <div style={{ background: '#fff8e1', border: '1px solid #ffc107',
                                    borderRadius: '0.375rem', padding: '0.625rem 0.875rem',
                                    fontSize: '0.82em', color: '#856404' }}>
                        <strong>Employer NI estimate (2025-26):</strong>&nbsp;
                        {(() => {
                          const monthly = parseFloat(formData.annualSalary) / 12;
                          const erNI = monthly > 416.67 ? ((monthly - 416.67) * 0.15) : 0;
                          return erNI > 0
                            ? `£${erNI.toFixed(2)}/month · £${(erNI * 12).toFixed(2)}/year — company pays this to HMRC`
                            : 'Below £5,000/yr secondary threshold — no employer NI';
                        })()}
                      </div>
                    )}
                  </>
                )}

                {/* ══ Tab 2: Bank ═══════════════════════════════════════════ */}
                {activeTab === 2 && (
                  <>
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0',
                                  borderRadius: '0.375rem', padding: '0.625rem 0.875rem',
                                  marginBottom: '1rem', fontSize: '0.8em', color: '#166534' }}>
                      Bank details are used for payslip records only — payments are processed manually via your bank.
                    </div>

                    <div className="form-group">
                      <label>Account Name</label>
                      <input type="text" value={formData.bankAccountName}
                        onChange={e => setFormData({ ...formData, bankAccountName: e.target.value })}
                        placeholder="Jane Smith" />
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Account Number</label>
                        <input type="text" value={formData.bankAccountNumber}
                          onChange={e => setFormData({ ...formData, bankAccountNumber: e.target.value.replace(/\D/g, '') })}
                          placeholder="12345678" maxLength="8"
                          style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }} />
                        <small style={{ color: '#6b7280' }}>8 digits</small>
                      </div>
                      <div className="form-group">
                        <label>Sort Code</label>
                        <input type="text" value={formData.bankSortCode}
                          onChange={e => {
                            const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
                            const fmt = raw.replace(/(\d{2})(?=\d)/g, '$1-');
                            setFormData({ ...formData, bankSortCode: fmt });
                          }}
                          placeholder="12-34-56" maxLength="8"
                          style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }} />
                        <small style={{ color: '#6b7280' }}>Format: XX-XX-XX</small>
                      </div>
                    </div>
                  </>
                )}

              </div>

              {/* ── Footer ── */}
              <div className="modal-footer" style={{ borderTop: '1px solid #e5e7eb',
                                                      display: 'flex', justifyContent: 'space-between',
                                                      alignItems: 'center', padding: '0.875rem 1.25rem' }}>
                {/* Tab navigation */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {activeTab > 0 && (
                    <button type="button" className="btn-secondary"
                      onClick={() => setActiveTab(t => t - 1)}>← Back</button>
                  )}
                  {activeTab < TABS.length - 1 && (
                    <button type="button" className="btn-primary"
                      onClick={() => setActiveTab(t => t + 1)}>Next →</button>
                  )}
                </div>
                {/* Save / Cancel always visible */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn-secondary" onClick={handleCancel}
                    disabled={processing}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={processing}>
                    {processing ? 'Saving…' : (editingEmployee ? 'Save Changes' : 'Create Employee')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── View Modal (read-only) ── */}
      {viewingEmployee && (
        <div className="modal-overlay" onClick={() => setViewingEmployee(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}
               style={{ maxWidth: '560px', width: '95%' }}>

            {/* Header */}
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>{viewingEmployee.name}</h3>
                <div style={{ fontSize: '0.78em', color: '#888', marginTop: '0.15rem' }}>
                  {viewingEmployee.employeeNumber && <span>#{viewingEmployee.employeeNumber}</span>}
                  {viewingEmployee.isDirector && (
                    <span style={{ marginLeft: '0.5rem', background: '#dbeafe', color: '#1d4ed8',
                                   borderRadius: '0.25rem', padding: '0.1rem 0.4rem', fontSize: '0.9em' }}>Director</span>
                  )}
                  {!viewingEmployee.isActive && (
                    <span style={{ marginLeft: '0.5rem', background: '#fee2e2', color: '#dc2626',
                                   borderRadius: '0.25rem', padding: '0.1rem 0.4rem', fontSize: '0.9em' }}>Inactive</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="btn-secondary" style={{ fontSize: '0.85em' }}
                  onClick={() => { setViewingEmployee(null); handleEdit(viewingEmployee); }}>
                  ✏️ Edit
                </button>
                <button className="btn-close" onClick={() => setViewingEmployee(null)}>✕</button>
              </div>
            </div>

            <div className="modal-body" style={{ padding: '1.25rem' }}>

              {/* Personal Section */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.72em', fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: '0.05em', color: '#6b7280', marginBottom: '0.6rem' }}>
                  👤 Personal
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem',
                              fontSize: '0.88em' }}>
                  <div><span style={{ color: '#9ca3af' }}>Email</span><br/>
                    <strong>{viewingEmployee.email || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Personal Email</span><br/>
                    <strong>{viewingEmployee.personalEmail || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Phone</span><br/>
                    <strong>{viewingEmployee.phoneNumber || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Start Date</span><br/>
                    <strong>{viewingEmployee.startDate ? viewingEmployee.startDate.substring(0,10) : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Schedule</span><br/>
                    <strong>{viewingEmployee.paymentSchedule || '—'}</strong></div>
                  {viewingEmployee.address && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ color: '#9ca3af' }}>Address</span><br/>
                      <strong style={{ whiteSpace: 'pre-line' }}>{viewingEmployee.address}</strong>
                    </div>
                  )}
                </div>
              </div>

              <hr style={{ margin: '0 0 1.25rem', borderColor: '#f0f0f0' }} />

              {/* PAYE Section */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.72em', fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: '0.05em', color: '#6b7280', marginBottom: '0.6rem' }}>
                  💷 PAYE
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem',
                              fontSize: '0.88em' }}>
                  <div><span style={{ color: '#9ca3af' }}>NI Number</span><br/>
                    <strong style={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                      {viewingEmployee.nationalInsuranceNumber || '—'}
                    </strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Tax Code</span><br/>
                    <strong>{viewingEmployee.taxCode || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>NI Category</span><br/>
                    <strong>{viewingEmployee.niCategory || 'A'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Annual Salary</span><br/>
                    <strong>£{viewingEmployee.annualSalary?.toLocaleString('en-GB', { minimumFractionDigits: 2 }) || '0.00'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Monthly Pay</span><br/>
                    <strong>£{viewingEmployee.annualSalary
                      ? (parseFloat(viewingEmployee.annualSalary) / 12).toLocaleString('en-GB', { minimumFractionDigits: 2 })
                      : '0.00'}</strong></div>
                </div>
              </div>

              <hr style={{ margin: '0 0 1.25rem', borderColor: '#f0f0f0' }} />

              {/* Bank Section */}
              <div>
                <div style={{ fontSize: '0.72em', fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: '0.05em', color: '#6b7280', marginBottom: '0.6rem' }}>
                  🏦 Bank
                </div>
                {!viewingEmployee.bankAccountNumber && !viewingEmployee.bankSortCode ? (
                  <div style={{ color: '#9ca3af', fontSize: '0.88em' }}>No bank details recorded.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem',
                                fontSize: '0.88em' }}>
                    <div><span style={{ color: '#9ca3af' }}>Account Name</span><br/>
                      <strong>{viewingEmployee.bankAccountName || '—'}</strong></div>
                    <div><span style={{ color: '#9ca3af' }}>Sort Code</span><br/>
                      <strong style={{ fontFamily: 'monospace' }}>{viewingEmployee.bankSortCode || '—'}</strong></div>
                    <div><span style={{ color: '#9ca3af' }}>Account Number</span><br/>
                      <strong style={{ fontFamily: 'monospace' }}>****{viewingEmployee.bankAccountNumber?.slice(-4) || '—'}</strong></div>
                  </div>
                )}
              </div>

              {viewingEmployee.notes && (
                <>
                  <hr style={{ margin: '1.25rem 0 1rem', borderColor: '#f0f0f0' }} />
                  <div style={{ fontSize: '0.88em' }}>
                    <span style={{ color: '#9ca3af' }}>Notes</span><br/>
                    <span style={{ whiteSpace: 'pre-line' }}>{viewingEmployee.notes}</span>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid #e5e7eb',
                                                    padding: '0.875rem 1.25rem',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-secondary"
                  onClick={() => { handleToggleActive(viewingEmployee); setViewingEmployee(null); }}
                  style={{ color: viewingEmployee.isActive ? '#dc2626' : '#16a34a', borderColor: viewingEmployee.isActive ? '#fca5a5' : '#86efac' }}>
                  {viewingEmployee.isActive ? '🔴 Deactivate' : '✅ Reactivate'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {viewingEmployee.isActive && !getEmployeeInviteStatus(viewingEmployee) && (
                  <button className="btn-secondary"
                    onClick={() => handleInviteToExpenses(viewingEmployee)}
                    style={{ color: '#7c3aed', borderColor: '#c4b5fd' }}>
                    📧 Invite to Expenses
                  </button>
                )}
                {getEmployeeInviteStatus(viewingEmployee) && (
                  <span style={{
                    padding: '0.4rem 0.75rem', fontSize: '0.82em', borderRadius: '0.375rem',
                    background: getEmployeeInviteStatus(viewingEmployee) === 'Active' ? '#dcfce7' : '#fef9c3',
                    color: getEmployeeInviteStatus(viewingEmployee) === 'Active' ? '#166534' : '#854d0e',
                    display: 'flex', alignItems: 'center', fontWeight: 500
                  }}>
                    {getEmployeeInviteStatus(viewingEmployee) === 'Active' ? '✅ On Expense Portal' : '⏳ Invite Pending'}
                  </span>
                )}
                <button className="btn-primary"
                  onClick={() => { setViewingEmployee(null); handleEdit(viewingEmployee); }}>
                  ✏️ Edit Employee
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="employees-list">
          {employees.length === 0 ? (
            <p>No employees found. Create your first employee to get started.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '100px' }}>Employee #</th>
                  <th style={{ minWidth: '150px' }}>Name</th>
                  <th style={{ minWidth: '180px' }}>Email</th>
                  <th style={{ minWidth: '120px' }}>NI Number</th>
                  <th style={{ minWidth: '80px' }}>Tax Code</th>
                  <th style={{ minWidth: '60px' }}>NI Cat</th>
                  <th style={{ minWidth: '100px' }}>Salary</th>
                  <th style={{ minWidth: '90px' }}>Schedule</th>
                  <th style={{ minWidth: '80px' }}>Status</th>
                  <th style={{ minWidth: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(employee => (
                  <tr key={employee.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setViewingEmployee(employee)}>
                    <td><strong>{employee.employeeNumber}</strong></td>
                    <td>
                      {employee.name}
                      {employee.isDirector && (
                        <span style={{ marginLeft: '0.4rem', background: '#dbeafe', color: '#1d4ed8',
                                       borderRadius: '0.2rem', padding: '0.05rem 0.35rem',
                                       fontSize: '0.72em', verticalAlign: 'middle' }}>Dir</span>
                      )}
                    </td>
                    <td>{employee.email}</td>
                    <td style={{ fontFamily: 'monospace' }}>{employee.nationalInsuranceNumber}</td>
                    <td>{employee.taxCode}</td>
                    <td style={{ textAlign: 'center' }}>{employee.niCategory || 'A'}</td>
                    <td>£{employee.annualSalary?.toLocaleString() || '0'}</td>
                    <td>{employee.paymentSchedule}</td>
                    <td>
                      <span className={`status-badge ${employee.isActive ? 'status-paid' : 'status-draft'}`}>
                        {employee.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {getEmployeeInviteStatus(employee) && (
                        <span style={{
                          marginLeft: '0.3rem', fontSize: '0.7em', padding: '0.1rem 0.35rem',
                          borderRadius: '0.2rem', verticalAlign: 'middle',
                          background: getEmployeeInviteStatus(employee) === 'Active' ? '#dcfce7' : '#fef9c3',
                          color: getEmployeeInviteStatus(employee) === 'Active' ? '#166534' : '#854d0e'
                        }}>
                          {getEmployeeInviteStatus(employee) === 'Active' ? '📱' : '📧'}
                        </span>
                      )}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleEdit(employee)}
                        className="btn-icon"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleToggleActive(employee)}
                        className="btn-icon"
                        title={employee.isActive ? 'Deactivate' : 'Reactivate'}
                        style={{ marginLeft: '5px', color: employee.isActive ? '#dc2626' : '#16a34a' }}
                      >
                        {employee.isActive ? '🔴' : '✅'}
                      </button>
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
