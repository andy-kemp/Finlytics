import React, { useState, useEffect } from 'react';
import { getTeamMembers, updateTeamMember, deleteTeamMember, getTeamApprovals, getTeamApprovalHistory, approveItem, rejectItem, batchApproveItems } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';

const STATUS_STYLES = {
  Invited:  { bg: '#fef9c3', color: '#854d0e', icon: '📧' },
  Active:   { bg: '#dcfce7', color: '#166534', icon: '✅' },
  Disabled: { bg: '#fee2e2', color: '#dc2626', icon: '🚫' },
};

const ROLE_STYLES = {
  Employee: { bg: '#e0e7ff', color: '#3730a3' },
  Admin:    { bg: '#dbeafe', color: '#1d4ed8' },
  Approver: { bg: '#fae8ff', color: '#86198f' },
};

export default function TeamManagement() {
  const [members, setMembers] = useState([]);
  const [approvals, setApprovals] = useState({ expenses: [], mileage: [] });
  const [history, setHistory] = useState({ expenses: [], mileage: [] });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [activeSection, setActiveSection] = useState('approvals'); // approvals | history | members
  const [viewingMember, setViewingMember] = useState(null);
  const [rejectingItem, setRejectingItem] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  // Batch selection
  const [selectedExpenseIds, setSelectedExpenseIds] = useState(new Set());
  const [selectedMileageIds, setSelectedMileageIds] = useState(new Set());
  const { toast, showToast, clearToast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [membersData, approvalsData, historyData] = await Promise.all([
        getTeamMembers(),
        getTeamApprovals().catch(() => ({ expenses: [], mileage: [] })),
        getTeamApprovalHistory().catch(() => ({ expenses: [], mileage: [] }))
      ]);
      setMembers(membersData);
      // API now returns { expenses: [...], mileage: [...] }
      const normalized = Array.isArray(approvalsData)
        ? { expenses: approvalsData.filter(a => a.type === 'expense'), mileage: approvalsData.filter(a => a.type === 'mileage') }
        : { expenses: approvalsData?.expenses || [], mileage: approvalsData?.mileage || [] };
      setApprovals(normalized);
      setHistory({
        expenses: historyData?.expenses || [],
        mileage: historyData?.mileage || []
      });
      setSelectedExpenseIds(new Set());
      setSelectedMileageIds(new Set());
    } catch (error) {
      console.error('Error loading team data:', error);
      showToast('Failed to load team data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableMember = async (member) => {
    const action = member.status === 'Disabled' ? 'enable' : 'disable';
    if (!confirm(`Are you sure you want to ${action} ${member.displayName || member.email}?`)) return;

    setProcessingMessage(action === 'disable' ? 'Disabling member...' : 'Enabling member...');
    setProcessing(true);
    try {
      const newStatus = member.status === 'Disabled' ? 'Active' : 'Disabled';
      await updateTeamMember(member.id, { status: newStatus });
      showToast(`${member.displayName || member.email} ${action}d successfully`, 'success');
      await loadData();
      setViewingMember(null);
    } catch (error) {
      showToast(`Failed to ${action} member: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveMember = async (member) => {
    if (!confirm(`Permanently remove ${member.displayName || member.email} from the team?\n\nThis will revoke their access to the expense portal.`)) return;

    setProcessingMessage('Removing member...');
    setProcessing(true);
    try {
      await deleteTeamMember(member.id);
      showToast(`${member.displayName || member.email} removed from team`, 'success');
      await loadData();
      setViewingMember(null);
    } catch (error) {
      showToast(`Failed to remove member: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleApprove = async (type, id) => {
    setProcessingMessage('Approving...');
    setProcessing(true);
    try {
      await approveItem(type, id);
      showToast('✅ Approved — employee notified by email', 'success');
      await loadData();
    } catch (error) {
      showToast(`Failed to approve: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!rejectingItem) return;
    setProcessingMessage('Rejecting...');
    setProcessing(true);
    try {
      await rejectItem(rejectingItem.type, rejectingItem.id, rejectReason);
      showToast('Rejected — employee notified by email', 'success');
      setRejectingItem(null);
      setRejectReason('');
      await loadData();
    } catch (error) {
      showToast(`Failed to reject: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const toggleExpenseSelection = (id) => {
    setSelectedExpenseIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleMileageSelection = (id) => {
    setSelectedMileageIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllExpenses = () => {
    if (selectedExpenseIds.size === approvals.expenses?.length) {
      setSelectedExpenseIds(new Set());
    } else {
      setSelectedExpenseIds(new Set(approvals.expenses?.map(e => e.id)));
    }
  };

  const toggleAllMileage = () => {
    if (selectedMileageIds.size === approvals.mileage?.length) {
      setSelectedMileageIds(new Set());
    } else {
      setSelectedMileageIds(new Set(approvals.mileage?.map(m => m.id)));
    }
  };

  const totalSelected = selectedExpenseIds.size + selectedMileageIds.size;
  const selectedTotal = [...(approvals.expenses || [])].filter(e => selectedExpenseIds.has(e.id)).reduce((s, e) => s + (e.amountGross || 0), 0)
    + [...(approvals.mileage || [])].filter(m => selectedMileageIds.has(m.id)).reduce((s, m) => s + (m.amount || 0), 0);

  const handleBatchApprove = async () => {
    if (totalSelected === 0) return;
    if (!confirm(`Approve ${totalSelected} selected item(s) for a total of £${selectedTotal.toFixed(2)}?\n\nApproval emails will be sent to the employees and a payment CSV will be sent to you.`)) return;
    setProcessingMessage(`Approving ${totalSelected} items...`);
    setProcessing(true);
    try {
      await batchApproveItems([...selectedExpenseIds], [...selectedMileageIds]);
      showToast(`✅ ${totalSelected} item(s) approved — emails sent with payment CSV`, 'success');
      await loadData();
    } catch (error) {
      showToast(`Failed to batch approve: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleChangeRole = async (member, newRole) => {
    setProcessingMessage('Updating role...');
    setProcessing(true);
    try {
      await updateTeamMember(member.id, { role: newRole });
      showToast(`${member.displayName || member.email} role updated to ${newRole}`, 'success');
      await loadData();
    } catch (error) {
      showToast(`Failed to update role: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const pendingCount = (approvals.expenses?.length || 0) + (approvals.mileage?.length || 0);
  const historyCount = (history.expenses?.length || 0) + (history.mileage?.length || 0);

  // Helper: best display name for a member
  const memberName = (m) => m.displayName || m.employeeName || m.email?.split('@')[0] || '—';

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Loading team expenses...</div>
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

      {/* ── Page Header ── */}
      <div className="page-header" style={{ marginBottom: '0' }}>
        <h1>Team Expenses</h1>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{
        display: 'flex', gap: '0', borderBottom: '2px solid #e5e7eb',
        marginBottom: '1.25rem', marginTop: '0.5rem'
      }}>
        <button onClick={() => setActiveSection('approvals')} style={{
          padding: '0.6rem 1.25rem', fontSize: '0.88em', fontWeight: 600,
          background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
          color: activeSection === 'approvals' ? '#1e40af' : '#6b7280',
          borderBottom: activeSection === 'approvals' ? '2px solid #1e40af' : '2px solid transparent',
          marginBottom: '-2px'
        }}>
          ✅ Pending Approvals
          {pendingCount > 0 && (
            <span style={{
              marginLeft: '0.4rem', background: '#dc2626', color: 'white', borderRadius: '10px',
              padding: '0.1rem 0.45rem', fontSize: '0.78em', fontWeight: 700, verticalAlign: 'middle'
            }}>
              {pendingCount}
            </span>
          )}
        </button>
        <button onClick={() => setActiveSection('history')} style={{
          padding: '0.6rem 1.25rem', fontSize: '0.88em', fontWeight: 600,
          background: 'none', border: 'none', cursor: 'pointer',
          color: activeSection === 'history' ? '#1e40af' : '#6b7280',
          borderBottom: activeSection === 'history' ? '2px solid #1e40af' : '2px solid transparent',
          marginBottom: '-2px'
        }}>
          📋 History ({historyCount})
        </button>
        <button onClick={() => setActiveSection('members')} style={{
          padding: '0.6rem 1.25rem', fontSize: '0.88em', fontWeight: 600,
          background: 'none', border: 'none', cursor: 'pointer',
          color: activeSection === 'members' ? '#1e40af' : '#6b7280',
          borderBottom: activeSection === 'members' ? '2px solid #1e40af' : '2px solid transparent',
          marginBottom: '-2px'
        }}>
          👥 Team Members ({members.length})
        </button>
      </div>

      {/* ── Members Section ── */}
      {activeSection === 'members' && (
        <div>
          {members.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#6b7280' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>👥</div>
              <p style={{ fontSize: '1.05em', fontWeight: 500 }}>No team members yet</p>
              <p style={{ fontSize: '0.88em' }}>
                Go to <strong>Employees</strong> → click an employee → <strong>📧 Invite to Expenses</strong> to get started.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem' }}>
              {members.map(member => {
                const ss = STATUS_STYLES[member.status] || STATUS_STYLES.Invited;
                const rs = ROLE_STYLES[member.role] || ROLE_STYLES.Employee;
                const name = memberName(member);
                const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                return (
                  <div key={member.id}
                    onClick={() => setViewingMember(member)}
                    style={{
                      background: 'white', border: '1px solid #e5e7eb', borderRadius: '0.75rem',
                      padding: '1rem 1.15rem', cursor: 'pointer', transition: 'box-shadow 0.15s',
                      display: 'flex', alignItems: 'center', gap: '0.85rem'
                    }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                    {/* Avatar */}
                    <div style={{
                      width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0,
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: '0.85em', letterSpacing: '0.03em'
                    }}>
                      {initials}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.15rem' }}>
                        <strong style={{ fontSize: '0.95em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}
                        </strong>
                        <span style={{
                          background: rs.bg, color: rs.color, borderRadius: '0.25rem',
                          padding: '0 0.4rem', fontSize: '0.72em', fontWeight: 600, flexShrink: 0
                        }}>
                          {member.role}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {member.email}
                        {member.employeeNumber && (
                          <span style={{ marginLeft: '0.5rem', color: '#9ca3af' }}>• {member.employeeNumber}</span>
                        )}
                      </div>
                    </div>
                    {/* Status badge */}
                    <span style={{
                      background: ss.bg, color: ss.color, borderRadius: '0.25rem',
                      padding: '0.15rem 0.5rem', fontSize: '0.75em', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap'
                    }}>
                      {ss.icon} {member.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Approvals Section ── */}
      {activeSection === 'approvals' && (
        <div>
          {/* Batch Action Bar */}
          {totalSelected > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem',
              padding: '0.75rem 1rem', marginBottom: '1rem'
            }}>
              <div style={{ fontSize: '0.9em', color: '#1e40af', fontWeight: 600 }}>
                {totalSelected} item{totalSelected > 1 ? 's' : ''} selected — £{selectedTotal.toFixed(2)}
              </div>
              <button className="btn-primary" onClick={handleBatchApprove}
                style={{ background: '#16a34a', borderColor: '#16a34a', padding: '0.5rem 1.25rem' }}>
                ✅ Approve Selected ({totalSelected})
              </button>
            </div>
          )}

          {pendingCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#6b7280' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
              <p style={{ fontSize: '1.05em', fontWeight: 500 }}>No pending approvals</p>
              <p style={{ fontSize: '0.88em' }}>When employees submit expenses or mileage claims, they'll appear here for approval.</p>
            </div>
          ) : (
            <>
              {/* Expense Approvals */}
              {approvals.expenses?.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '0.95em', color: '#374151', margin: 0 }}>
                      💰 Expense Claims ({approvals.expenses.length})
                    </h3>
                    <button className="btn-secondary" onClick={toggleAllExpenses}
                      style={{ fontSize: '0.8em', padding: '0.3rem 0.75rem' }}>
                      {selectedExpenseIds.size === approvals.expenses.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}></th>
                        <th>Employee</th>
                        <th>Supplier</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Net</th>
                        <th style={{ textAlign: 'right' }}>VAT</th>
                        <th style={{ textAlign: 'right' }}>Gross</th>
                        <th>Receipt</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvals.expenses.map(expense => (
                        <tr key={expense.id} style={selectedExpenseIds.has(expense.id) ? { background: '#eff6ff' } : {}}>
                          <td onClick={e => e.stopPropagation()}>
                            <input type="checkbox"
                              checked={selectedExpenseIds.has(expense.id)}
                              onChange={() => toggleExpenseSelection(expense.id)} />
                          </td>
                          <td>
                            <strong>{expense.employeeName || '—'}</strong>
                            {expense.employeeEmail && expense.employeeName !== expense.employeeEmail && (
                              <div style={{ fontSize: '0.78em', color: '#6b7280' }}>{expense.employeeEmail}</div>
                            )}
                          </td>
                          <td>{expense.supplier || '—'}</td>
                          <td>{expense.category || '—'}</td>
                          <td style={{ fontSize: '0.85em' }}>
                            {expense.entryDate ? new Date(expense.entryDate).toLocaleDateString('en-GB') : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '0.9em' }}>£{(expense.amountNet || 0).toFixed(2)}</td>
                          <td style={{ textAlign: 'right', fontSize: '0.9em', color: '#6b7280' }}>£{(expense.vatAmount || expense.vATAmount || 0).toFixed(2)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>£{(expense.amountGross || 0).toFixed(2)}</td>
                          <td>{expense.hasReceipt ? '📎' : '—'}</td>
                          <td>
                            <button className="btn-icon" title="Approve"
                              onClick={() => handleApprove('expense', expense.id)}
                              style={{ color: '#16a34a' }}>
                              ✅
                            </button>
                            <button className="btn-icon" title="Reject"
                              onClick={() => setRejectingItem({ type: 'expense', id: expense.id, name: expense.supplier || 'Expense' })}
                              style={{ marginLeft: '5px', color: '#dc2626' }}>
                              ❌
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Mileage Approvals */}
              {approvals.mileage?.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '0.95em', color: '#374151', margin: 0 }}>
                      🚗 Mileage Claims ({approvals.mileage.length})
                    </h3>
                    <button className="btn-secondary" onClick={toggleAllMileage}
                      style={{ fontSize: '0.8em', padding: '0.3rem 0.75rem' }}>
                      {selectedMileageIds.size === approvals.mileage.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}></th>
                        <th>Employee</th>
                        <th>Trip</th>
                        <th>Miles</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th>Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvals.mileage.map(trip => (
                        <tr key={trip.id} style={selectedMileageIds.has(trip.id) ? { background: '#eff6ff' } : {}}>
                          <td onClick={e => e.stopPropagation()}>
                            <input type="checkbox"
                              checked={selectedMileageIds.has(trip.id)}
                              onChange={() => toggleMileageSelection(trip.id)} />
                          </td>
                          <td>
                            <strong>{trip.employeeName || '—'}</strong>
                            {trip.employeeEmail && trip.employeeName !== trip.employeeEmail && (
                              <div style={{ fontSize: '0.78em', color: '#6b7280' }}>{trip.employeeEmail}</div>
                            )}
                          </td>
                          <td>{trip.from} → {trip.to}</td>
                          <td>{trip.miles?.toFixed(1) || '0'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>£{(trip.amount || 0).toFixed(2)}</td>
                          <td style={{ fontSize: '0.85em' }}>
                            {trip.date ? new Date(trip.date).toLocaleDateString('en-GB') : '—'}
                          </td>
                          <td>
                            <button className="btn-icon" title="Approve"
                              onClick={() => handleApprove('mileage', trip.id)}
                              style={{ color: '#16a34a' }}>
                              ✅
                            </button>
                            <button className="btn-icon" title="Reject"
                              onClick={() => setRejectingItem({ type: 'mileage', id: trip.id, name: `${trip.from} → ${trip.to}` })}
                              style={{ marginLeft: '5px', color: '#dc2626' }}>
                              ❌
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── History Section ── */}
      {activeSection === 'history' && (
        <div>
          {historyCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#6b7280' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
              <p style={{ fontSize: '1.05em', fontWeight: 500 }}>No approval history yet</p>
              <p style={{ fontSize: '0.88em' }}>Approved and rejected claims will appear here.</p>
            </div>
          ) : (
            <>
              {/* Expense History */}
              {history.expenses?.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                  <h3 style={{ fontSize: '0.95em', color: '#374151', marginBottom: '0.75rem' }}>
                    💰 Expense Claims ({history.expenses.length})
                  </h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Employee</th>
                        <th>Supplier</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Gross</th>
                        <th>Actioned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.expenses.map(expense => (
                        <tr key={expense.id}>
                          <td>
                            {expense.approvalStatus === 'Approved' ? (
                              <span style={{ background: '#dcfce7', color: '#166534', borderRadius: '0.25rem',
                                padding: '0.1rem 0.5rem', fontSize: '0.82em', fontWeight: 500 }}>
                                ✅ Approved
                              </span>
                            ) : (
                              <span style={{ background: '#fee2e2', color: '#dc2626', borderRadius: '0.25rem',
                                padding: '0.1rem 0.5rem', fontSize: '0.82em', fontWeight: 500 }}
                                title={expense.rejectionReason || ''}>
                                ❌ Rejected
                              </span>
                            )}
                          </td>
                          <td>
                            <strong>{expense.employeeName || '—'}</strong>
                            {expense.employeeEmail && expense.employeeName !== expense.employeeEmail && (
                              <div style={{ fontSize: '0.78em', color: '#6b7280' }}>{expense.employeeEmail}</div>
                            )}
                          </td>
                          <td>{expense.supplier || '—'}</td>
                          <td>{expense.category || '—'}</td>
                          <td style={{ fontSize: '0.85em' }}>
                            {expense.entryDate ? new Date(expense.entryDate).toLocaleDateString('en-GB') : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>£{(expense.amountGross || 0).toFixed(2)}</td>
                          <td style={{ fontSize: '0.85em', color: '#6b7280' }}>
                            {expense.approvedAt ? new Date(expense.approvedAt).toLocaleDateString('en-GB') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Mileage History */}
              {history.mileage?.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '0.95em', color: '#374151', marginBottom: '0.75rem' }}>
                    🚗 Mileage Claims ({history.mileage.length})
                  </h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Employee</th>
                        <th>Trip</th>
                        <th>Miles</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th>Date</th>
                        <th>Actioned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.mileage.map(trip => (
                        <tr key={trip.id}>
                          <td>
                            {trip.approvalStatus === 'Approved' ? (
                              <span style={{ background: '#dcfce7', color: '#166534', borderRadius: '0.25rem',
                                padding: '0.1rem 0.5rem', fontSize: '0.82em', fontWeight: 500 }}>
                                ✅ Approved
                              </span>
                            ) : (
                              <span style={{ background: '#fee2e2', color: '#dc2626', borderRadius: '0.25rem',
                                padding: '0.1rem 0.5rem', fontSize: '0.82em', fontWeight: 500 }}
                                title={trip.rejectionReason || ''}>
                                ❌ Rejected
                              </span>
                            )}
                          </td>
                          <td>
                            <strong>{trip.employeeName || '—'}</strong>
                            {trip.employeeEmail && trip.employeeName !== trip.employeeEmail && (
                              <div style={{ fontSize: '0.78em', color: '#6b7280' }}>{trip.employeeEmail}</div>
                            )}
                          </td>
                          <td>{trip.from} → {trip.to}</td>
                          <td>{trip.miles?.toFixed(1) || '0'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>£{(trip.amount || 0).toFixed(2)}</td>
                          <td style={{ fontSize: '0.85em' }}>
                            {trip.date ? new Date(trip.date).toLocaleDateString('en-GB') : '—'}
                          </td>
                          <td style={{ fontSize: '0.85em', color: '#6b7280' }}>
                            {trip.approvedAt ? new Date(trip.approvedAt).toLocaleDateString('en-GB') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── View Member Modal ── */}
      {viewingMember && (
        <div className="modal-overlay" onClick={() => setViewingMember(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}
               style={{ maxWidth: '480px', width: '95%' }}>

            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>{memberName(viewingMember)}</h3>
                <div style={{ fontSize: '0.78em', color: '#888', marginTop: '0.15rem' }}>
                  {(() => {
                    const ss = STATUS_STYLES[viewingMember.status] || STATUS_STYLES.Invited;
                    return (
                      <span style={{ background: ss.bg, color: ss.color, borderRadius: '0.25rem',
                                     padding: '0.1rem 0.4rem', fontSize: '0.9em' }}>
                        {ss.icon} {viewingMember.status}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <button className="btn-close" onClick={() => setViewingMember(null)}>✕</button>
            </div>

            <div className="modal-body" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1.5rem', fontSize: '0.88em' }}>
                <div>
                  <span style={{ color: '#9ca3af' }}>Email</span><br/>
                  <strong>{viewingMember.email}</strong>
                </div>
                <div>
                  <span style={{ color: '#9ca3af' }}>Role</span><br/>
                  <select value={viewingMember.role}
                    onChange={e => handleChangeRole(viewingMember, e.target.value)}
                    style={{ fontWeight: 600, padding: '0.25rem 0.5rem', borderRadius: '0.25rem',
                             border: '1px solid #d1d5db', cursor: 'pointer' }}>
                    <option value="Employee">Employee</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>
                <div>
                  <span style={{ color: '#9ca3af' }}>Invited</span><br/>
                  <strong>{viewingMember.invitedAt ? new Date(viewingMember.invitedAt).toLocaleDateString('en-GB') : '—'}</strong>
                </div>
                <div>
                  <span style={{ color: '#9ca3af' }}>Accepted</span><br/>
                  <strong>{viewingMember.acceptedAt ? new Date(viewingMember.acceptedAt).toLocaleDateString('en-GB') : 'Not yet'}</strong>
                </div>
                {viewingMember.employeeNumber && (
                  <div>
                    <span style={{ color: '#9ca3af' }}>Employee Number</span><br/>
                    <strong>{viewingMember.employeeNumber}</strong>
                  </div>
                )}
                {viewingMember.clerkUserId && (
                  <div>
                    <span style={{ color: '#9ca3af' }}>Clerk User</span><br/>
                    <strong style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{viewingMember.clerkUserId}</strong>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid #e5e7eb',
                                                    padding: '0.875rem 1.25rem',
                                                    display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary"
                onClick={() => handleDisableMember(viewingMember)}
                style={{ color: viewingMember.status === 'Disabled' ? '#16a34a' : '#dc2626',
                         borderColor: viewingMember.status === 'Disabled' ? '#86efac' : '#fca5a5' }}>
                {viewingMember.status === 'Disabled' ? '✅ Re-enable' : '🔴 Disable'}
              </button>
              <button className="btn-secondary"
                onClick={() => handleRemoveMember(viewingMember)}
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}>
                🗑️ Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Reason Modal ── */}
      {rejectingItem && (
        <div className="modal-overlay" onClick={() => { setRejectingItem(null); setRejectReason(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}
               style={{ maxWidth: '420px', width: '95%' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>Reject: {rejectingItem.name}</h3>
              <button className="btn-close" onClick={() => { setRejectingItem(null); setRejectReason(''); }}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '1.25rem' }}>
              <div className="form-group">
                <label>Reason for rejection</label>
                <textarea rows="3" value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="e.g., Missing receipt, incorrect amount..." autoFocus />
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid #e5e7eb',
                                                    padding: '0.875rem 1.25rem',
                                                    display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn-secondary" onClick={() => { setRejectingItem(null); setRejectReason(''); }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleReject}
                style={{ background: '#dc2626', borderColor: '#dc2626' }}>
                ❌ Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
