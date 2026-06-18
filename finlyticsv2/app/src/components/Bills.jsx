import React, { useEffect, useState, useCallback } from 'react';
import {
    getBills, createBill, updateBill, deleteBill,
    approveBill, payBill, getNextBillNumber, getBillsSummary,
    getSuppliers, analyzeInvoice
} from '../services/apiService';

const STATUS_COLOURS = {
    Draft: '#6c757d',
    'Awaiting Approval': '#f59e0b',
    Approved: '#3b82f6',
    Paid: '#16a34a',
    Overdue: '#dc3545',
    Cancelled: '#adb5bd'
};

const VAT_OPTIONS = [
    { value: 'Standard', label: 'Standard (20%)', rate: 20 },
    { value: 'Reduced', label: 'Reduced (5%)', rate: 5 },
    { value: 'Zero', label: 'Zero Rated (0%)', rate: 0 },
    { value: 'Exempt', label: 'Exempt', rate: 0 },
];

const PAYMENT_METHODS = ['Bank Transfer', 'Direct Debit', 'Credit Card', 'Debit Card', 'Cash', 'PayPal', 'Other'];
const CT_TAGS = ['Revenue', 'Capital', 'NonCT'];

const CATEGORIES = [
    'Office Supplies', 'Software & Subscriptions', 'Professional Services', 'Utilities',
    'Rent & Rates', 'Insurance', 'Travel & Transport', 'Marketing & Advertising',
    'IT & Hosting', 'Equipment', 'Maintenance & Repairs', 'Training & Development',
    'Accountancy Fees', 'Legal Fees', 'Telecommunications', 'Postage & Delivery',
    'Cleaning', 'Bank Charges', 'Other'
];

export default function Bills() {
    const [bills, setBills] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [showPayModal, setShowPayModal] = useState(null);
    const [paymentDetails, setPaymentDetails] = useState({});
    const [ocrProcessing, setOcrProcessing] = useState(false);
    const [ocrResult, setOcrResult] = useState(null);
    const [dragOver, setDragOver] = useState(false);

    const emptyBill = {
        billNumber: '',
        supplierId: '',
        supplierName: '',
        supplierReference: '',
        dateReceived: new Date().toISOString().split('T')[0],
        dateIssued: new Date().toISOString().split('T')[0],
        dueDate: '',
        status: 'Draft',
        amountNet: '',
        vatAmount: '',
        amountGross: '',
        vatApplicability: 'Standard',
        category: '',
        ctTag: 'Revenue',
        paymentMethod: '',
        notes: '',
        lineItems: [],
        isRecurring: false,
        recurringFrequency: '',
    };

    const [form, setForm] = useState({ ...emptyBill });

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [billsData, suppliersData, summaryData] = await Promise.all([
                getBills(),
                getSuppliers(),
                getBillsSummary().catch(() => null)
            ]);
            setBills(billsData);
            setSuppliers(suppliersData);
            setSummary(summaryData);
        } catch (err) {
            console.error('Error loading bills:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const formatCurrency = (amount) =>
        new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount || 0);

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

    // ──── OCR: Scan bill document ─────────────────────────────────────────────
    const handleOcrUpload = async (file) => {
        if (!file) return;
        setOcrProcessing(true);
        setOcrResult(null);
        try {
            const result = await analyzeInvoice(file);
            setOcrResult(result);

            if (result.found) {
                // Auto-fill form from OCR
                const updates = {};
                if (result.vendor) updates.supplierName = result.vendor;
                if (result.invoiceDate) updates.dateIssued = result.invoiceDate;
                if (result.invoiceRef) updates.supplierReference = result.invoiceRef;

                // Try to match supplier
                if (result.vendor) {
                    const match = suppliers.find(s =>
                        s.name.toLowerCase().includes(result.vendor.toLowerCase()) ||
                        result.vendor.toLowerCase().includes(s.name.toLowerCase()));
                    if (match) {
                        updates.supplierId = match.id;
                        updates.supplierName = match.name;
                    }
                }

                // Amounts from lines or totals
                if (result.lines && result.lines.length > 0) {
                    const lineItems = result.lines.map((l, i) => ({
                        lineNumber: i + 1,
                        description: l.description || '',
                        quantity: l.quantity || 1,
                        unitPrice: l.amountNet || 0,
                        vatRate: 20,
                        vatAmount: l.vatAmount || 0,
                        amountNet: l.amountNet || 0,
                        amountGross: l.amountGross || (l.amountNet || 0) + (l.vatAmount || 0)
                    }));
                    updates.lineItems = lineItems;
                    updates.amountNet = lineItems.reduce((s, l) => s + l.amountNet, 0).toFixed(2);
                    updates.vatAmount = lineItems.reduce((s, l) => s + l.vatAmount, 0).toFixed(2);
                    updates.amountGross = lineItems.reduce((s, l) => s + l.amountGross, 0).toFixed(2);
                } else {
                    if (result.subtotal) updates.amountNet = result.subtotal.toFixed(2);
                    if (result.tax) updates.vatAmount = result.tax.toFixed(2);
                    if (result.total) updates.amountGross = result.total.toFixed(2);
                }

                // Calculate due date (default net 30)
                if (result.invoiceDate && !form.dueDate) {
                    const due = new Date(result.invoiceDate);
                    due.setDate(due.getDate() + 30);
                    updates.dueDate = due.toISOString().split('T')[0];
                }

                setForm(prev => ({ ...prev, ...updates }));
            }
        } catch (err) {
            console.error('OCR error:', err);
            setOcrResult({ configured: true, found: false, error: err.message });
        } finally {
            setOcrProcessing(false);
        }
    };

    const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = () => setDragOver(false);
    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleOcrUpload(file);
    };

    // ──── VAT calculation ────────────────────────────────────────────────────
    const recalcAmounts = (field, value, currentForm) => {
        const f = { ...currentForm, [field]: value };
        const vatOpt = VAT_OPTIONS.find(v => v.value === f.vatApplicability);
        const rate = vatOpt ? vatOpt.rate / 100 : 0.2;

        if (field === 'amountNet') {
            const net = parseFloat(value) || 0;
            f.vatAmount = (net * rate).toFixed(2);
            f.amountGross = (net + parseFloat(f.vatAmount)).toFixed(2);
        } else if (field === 'amountGross') {
            const gross = parseFloat(value) || 0;
            const net = rate > 0 ? (gross / (1 + rate)) : gross;
            f.amountNet = net.toFixed(2);
            f.vatAmount = (gross - net).toFixed(2);
        } else if (field === 'vatApplicability') {
            const net = parseFloat(f.amountNet) || 0;
            f.vatAmount = (net * rate).toFixed(2);
            f.amountGross = (net + parseFloat(f.vatAmount)).toFixed(2);
        }
        return f;
    };

    // ──── Form actions ────────────────────────────────────────────────────────
    const openNewBill = async () => {
        const nextNum = await getNextBillNumber().catch(() => ({ billNumber: '' }));
        setForm({ ...emptyBill, billNumber: nextNum.billNumber });
        setEditing(null);
        setOcrResult(null);
        setShowForm(true);
    };

    const openEditBill = (bill) => {
        setForm({
            ...bill,
            dateReceived: bill.dateReceived?.split('T')[0] || '',
            dateIssued: bill.dateIssued?.split('T')[0] || '',
            dueDate: bill.dueDate?.split('T')[0] || '',
            datePaid: bill.datePaid?.split('T')[0] || '',
            amountNet: bill.amountNet?.toString() || '',
            vatAmount: bill.vatAmount?.toString() || '',
            amountGross: bill.amountGross?.toString() || '',
        });
        setEditing(bill.id);
        setOcrResult(null);
        setShowForm(true);
    };

    const handleSave = async () => {
        try {
            const payload = {
                ...form,
                amountNet: parseFloat(form.amountNet) || 0,
                vatAmount: parseFloat(form.vatAmount) || 0,
                amountGross: parseFloat(form.amountGross) || 0,
            };

            if (editing) {
                await updateBill(editing, payload);
            } else {
                await createBill(payload);
            }
            setShowForm(false);
            await loadData();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this bill?')) return;
        await deleteBill(id);
        await loadData();
    };

    const handleApprove = async (id) => {
        await approveBill(id, 'Director');
        await loadData();
    };

    const handlePaySubmit = async () => {
        if (!showPayModal) return;
        await payBill(showPayModal, {
            amountPaid: parseFloat(paymentDetails.amountPaid) || 0,
            paymentMethod: paymentDetails.paymentMethod || '',
            paymentReference: paymentDetails.paymentReference || '',
            datePaid: paymentDetails.datePaid || new Date().toISOString()
        });
        setShowPayModal(null);
        setPaymentDetails({});
        await loadData();
    };

    // ──── Line items ────────────────────────────────────────────────────────
    const addLine = () => {
        setForm(prev => ({
            ...prev,
            lineItems: [...(prev.lineItems || []), {
                lineNumber: (prev.lineItems?.length || 0) + 1,
                description: '', quantity: 1, unitPrice: 0, vatRate: 20,
                vatAmount: 0, amountNet: 0, amountGross: 0
            }]
        }));
    };

    const updateLine = (idx, field, value) => {
        setForm(prev => {
            const lines = [...(prev.lineItems || [])];
            lines[idx] = { ...lines[idx], [field]: value };
            const l = lines[idx];
            if (field === 'unitPrice' || field === 'quantity' || field === 'vatRate') {
                l.amountNet = (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0);
                l.vatAmount = l.amountNet * ((parseFloat(l.vatRate) || 0) / 100);
                l.amountGross = l.amountNet + l.vatAmount;
            }
            // Recalc totals
            const totalNet = lines.reduce((s, ln) => s + (ln.amountNet || 0), 0);
            const totalVat = lines.reduce((s, ln) => s + (ln.vatAmount || 0), 0);
            const totalGross = lines.reduce((s, ln) => s + (ln.amountGross || 0), 0);
            return {
                ...prev,
                lineItems: lines,
                amountNet: totalNet.toFixed(2),
                vatAmount: totalVat.toFixed(2),
                amountGross: totalGross.toFixed(2)
            };
        });
    };

    const removeLine = (idx) => {
        setForm(prev => {
            const lines = (prev.lineItems || []).filter((_, i) => i !== idx);
            const totalNet = lines.reduce((s, l) => s + (l.amountNet || 0), 0);
            const totalVat = lines.reduce((s, l) => s + (l.vatAmount || 0), 0);
            const totalGross = lines.reduce((s, l) => s + (l.amountGross || 0), 0);
            return {
                ...prev,
                lineItems: lines,
                amountNet: totalNet.toFixed(2),
                vatAmount: totalVat.toFixed(2),
                amountGross: totalGross.toFixed(2)
            };
        });
    };

    // ──── Filter & search ────────────────────────────────────────────────────
    const filteredBills = bills.filter(b => {
        if (filter !== 'all' && b.status !== filter) return false;
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            return (b.billNumber || '').toLowerCase().includes(s) ||
                   (b.supplierName || '').toLowerCase().includes(s) ||
                   (b.supplierReference || '').toLowerCase().includes(s);
        }
        return true;
    });

    // ──── Render ─────────────────────────────────────────────────────────────
    if (loading) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading bills...</div>
        </div>
    );

    return (
        <div className="bills-page">
            <div className="page-header">
                <h1>📋 Bills &amp; Accounts Payable</h1>
                <button className="btn-primary" onClick={openNewBill}>+ New Bill</button>
            </div>

            {/* Summary cards */}
            {summary && (
                <div className="metrics-grid" style={{ marginBottom: 24 }}>
                    <div className="metric-card" style={{ borderLeft: '4px solid #3b82f6' }}>
                        <div className="metric-content">
                            <div className="metric-label">Total Unpaid</div>
                            <div className="metric-value">{formatCurrency(summary.totalUnpaidAmount)}</div>
                            <div className="metric-detail">{summary.totalUnpaid} bill{summary.totalUnpaid !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div className="metric-card" style={{ borderLeft: '4px solid #dc3545' }}>
                        <div className="metric-content">
                            <div className="metric-label">Overdue</div>
                            <div className="metric-value" style={{ color: '#dc3545' }}>{formatCurrency(summary.overdueAmount)}</div>
                            <div className="metric-detail">{summary.overdueCount} bill{summary.overdueCount !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div className="metric-card" style={{ borderLeft: '4px solid #f59e0b' }}>
                        <div className="metric-content">
                            <div className="metric-label">Due This Week</div>
                            <div className="metric-value">{formatCurrency(summary.dueThisWeekAmount)}</div>
                            <div className="metric-detail">{summary.dueThisWeekCount} bill{summary.dueThisWeekCount !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div className="metric-card" style={{ borderLeft: '4px solid #16a34a' }}>
                        <div className="metric-content">
                            <div className="metric-label">Paid This Month</div>
                            <div className="metric-value" style={{ color: '#16a34a' }}>{formatCurrency(summary.paidThisMonthAmount)}</div>
                            <div className="metric-detail">{summary.paidThisMonthCount} bill{summary.paidThisMonthCount !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* AP Aging */}
            {summary && summary.overdueCount > 0 && (
                <div className="info-card" style={{ marginBottom: 20 }}>
                    <h3>📊 Accounts Payable Aging</h3>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ fontSize: '0.82rem', color: '#6c757d' }}>0–30 days</div>
                            <div style={{ fontWeight: 600, color: '#f59e0b' }}>{formatCurrency(summary.overdue0to30Amount)} <small>({summary.overdue0to30Count})</small></div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.82rem', color: '#6c757d' }}>31–60 days</div>
                            <div style={{ fontWeight: 600, color: '#e65100' }}>{formatCurrency(summary.overdue31to60Amount)} <small>({summary.overdue31to60Count})</small></div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.82rem', color: '#6c757d' }}>61+ days</div>
                            <div style={{ fontWeight: 600, color: '#dc3545' }}>{formatCurrency(summary.overdue61PlusAmount)} <small>({summary.overdue61PlusCount})</small></div>
                        </div>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="dashboard-controls" style={{ marginBottom: 16 }}>
                <div className="period-selector">
                    {['all', 'Draft', 'Awaiting Approval', 'Approved', 'Overdue', 'Paid', 'Cancelled'].map(f => (
                        <button key={f}
                            className={`period-btn ${filter === f ? 'active' : ''}`}
                            onClick={() => setFilter(f)}>
                            {f === 'all' ? 'All' : f}
                        </button>
                    ))}
                </div>
                <input
                    type="text"
                    placeholder="Search bills..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem', marginTop: 8, maxWidth: 300 }}
                />
            </div>

            {/* Bills list */}
            {filteredBills.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#6c757d' }}>
                    <p style={{ fontSize: '1.2rem' }}>No bills found</p>
                    <p>Create your first bill or scan a supplier invoice to get started.</p>
                </div>
            ) : (
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Bill #</th>
                                <th>Supplier</th>
                                <th>Supplier Ref</th>
                                <th>Date Issued</th>
                                <th>Due Date</th>
                                <th>Status</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredBills.map(bill => {
                                const isOverdue = bill.status !== 'Paid' && bill.status !== 'Cancelled' && bill.dueDate &&
                                    new Date(bill.dueDate) < new Date();
                                return (
                                    <tr key={bill.id} style={isOverdue ? { background: '#fff5f5' } : {}}>
                                        <td><strong>{bill.billNumber}</strong></td>
                                        <td>{bill.supplierName}</td>
                                        <td style={{ color: '#6c757d' }}>{bill.supplierReference || '—'}</td>
                                        <td>{formatDate(bill.dateIssued)}</td>
                                        <td style={isOverdue ? { color: '#dc3545', fontWeight: 600 } : {}}>
                                            {formatDate(bill.dueDate)}
                                            {isOverdue && ' ⚠️'}
                                        </td>
                                        <td>
                                            <span style={{
                                                padding: '2px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 500,
                                                background: STATUS_COLOURS[bill.status] + '18',
                                                color: STATUS_COLOURS[bill.status]
                                            }}>
                                                {bill.status}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                            {formatCurrency(bill.amountGross)}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                <button className="btn-secondary" style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                                                    onClick={() => openEditBill(bill)}>Edit</button>
                                                {(bill.status === 'Draft' || bill.status === 'Awaiting Approval') && (
                                                    <button className="btn-primary" style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                                                        onClick={() => handleApprove(bill.id)}>Approve</button>
                                                )}
                                                {bill.status !== 'Paid' && bill.status !== 'Cancelled' && bill.status !== 'Draft' && (
                                                    <button className="btn-primary" style={{ padding: '3px 8px', fontSize: '0.78rem', background: '#16a34a' }}
                                                        onClick={() => {
                                                            setShowPayModal(bill.id);
                                                            setPaymentDetails({
                                                                amountPaid: bill.amountGross,
                                                                datePaid: new Date().toISOString().split('T')[0],
                                                                paymentMethod: bill.paymentMethod || '',
                                                                paymentReference: ''
                                                            });
                                                        }}>Pay</button>
                                                )}
                                                {bill.status === 'Draft' && (
                                                    <button style={{ padding: '3px 8px', fontSize: '0.78rem', background: '#dc354518', color: '#dc3545', border: '1px solid #dc354540', borderRadius: 6, cursor: 'pointer' }}
                                                        onClick={() => handleDelete(bill.id)}>Delete</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ──── Bill Form Modal ──── */}
            {showForm && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', paddingTop: 40, paddingBottom: 40 }}
                    onClick={() => setShowForm(false)}
                >
                    <div
                        style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 780, width: '95%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <h2 style={{ margin: 0 }}>{editing ? 'Edit Bill' : 'New Bill'}</h2>
                            <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6c757d' }}>×</button>
                        </div>

                        {/* OCR Upload Area */}
                        {!editing && (
                            <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                style={{
                                    border: `2px dashed ${dragOver ? '#3b82f6' : '#dee2e6'}`,
                                    borderRadius: 10, padding: 20, textAlign: 'center', marginBottom: 20,
                                    background: dragOver ? '#eff6ff' : '#f8f9fa', transition: 'all 0.2s',
                                    cursor: 'pointer'
                                }}
                                onClick={() => document.getElementById('bill-ocr-input').click()}
                            >
                                <input
                                    id="bill-ocr-input"
                                    type="file"
                                    accept="image/*,.pdf"
                                    style={{ display: 'none' }}
                                    onChange={e => handleOcrUpload(e.target.files?.[0])}
                                />
                                {ocrProcessing ? (
                                    <div>
                                        <div className="spinner" style={{ margin: '0 auto 8px' }}></div>
                                        <p style={{ margin: 0, color: '#3b82f6', fontWeight: 500 }}>Scanning document with AI...</p>
                                    </div>
                                ) : (
                                    <>
                                        <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500 }}>
                                            📄 Drop a supplier invoice/bill here or click to scan
                                        </p>
                                        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#6c757d' }}>
                                            AI will auto-fill supplier, amounts, line items &amp; dates
                                        </p>
                                    </>
                                )}
                            </div>
                        )}

                        {ocrResult && (
                            <div style={{
                                padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: '0.85rem',
                                background: ocrResult.found ? '#d4edda' : '#fff3cd',
                                color: ocrResult.found ? '#155724' : '#856404'
                            }}>
                                {ocrResult.found
                                    ? `✅ Extracted data from document — ${ocrResult.vendor || 'unknown vendor'}, ${ocrResult.lines?.length || 0} line items`
                                    : `⚠️ Could not extract data. ${ocrResult.error || 'Please enter details manually.'}`
                                }
                            </div>
                        )}

                        {/* Form fields */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
                            <div>
                                <label style={labelStyle}>Bill Number</label>
                                <input style={inputStyle} value={form.billNumber} onChange={e => setForm({ ...form, billNumber: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Status</label>
                                <select style={inputStyle} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                                    <option>Draft</option>
                                    <option>Awaiting Approval</option>
                                    <option>Approved</option>
                                    <option>Paid</option>
                                    <option>Cancelled</option>
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>Supplier</label>
                                <select style={inputStyle} value={form.supplierId}
                                    onChange={e => {
                                        const s = suppliers.find(s => s.id === e.target.value);
                                        setForm({ ...form, supplierId: e.target.value, supplierName: s?.name || form.supplierName });
                                    }}>
                                    <option value="">— select or type below —</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>Supplier Name (or new)</label>
                                <input style={inputStyle} value={form.supplierName} onChange={e => setForm({ ...form, supplierName: e.target.value })}
                                    placeholder="Auto-creates supplier if new" />
                            </div>
                            <div>
                                <label style={labelStyle}>Supplier Reference / Invoice #</label>
                                <input style={inputStyle} value={form.supplierReference} onChange={e => setForm({ ...form, supplierReference: e.target.value })}
                                    placeholder="Their invoice number" />
                            </div>
                            <div>
                                <label style={labelStyle}>Category</label>
                                <select style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                                    <option value="">— select —</option>
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>Date Received</label>
                                <input type="date" style={inputStyle} value={form.dateReceived} onChange={e => setForm({ ...form, dateReceived: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Date Issued</label>
                                <input type="date" style={inputStyle} value={form.dateIssued} onChange={e => setForm({ ...form, dateIssued: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Due Date</label>
                                <input type="date" style={inputStyle} value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Payment Method</label>
                                <select style={inputStyle} value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
                                    <option value="">— select —</option>
                                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>VAT Treatment</label>
                                <select style={inputStyle} value={form.vatApplicability}
                                    onChange={e => setForm(recalcAmounts('vatApplicability', e.target.value, form))}>
                                    {VAT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>CT Tag</label>
                                <select style={inputStyle} value={form.ctTag} onChange={e => setForm({ ...form, ctTag: e.target.value })}>
                                    {CT_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Line items */}
                        <div style={{ marginTop: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <h3 style={{ margin: 0, fontSize: '1rem' }}>Line Items</h3>
                                <button className="btn-secondary" style={{ padding: '3px 10px', fontSize: '0.82rem' }} onClick={addLine}>+ Add Line</button>
                            </div>
                            {(form.lineItems || []).length > 0 && (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid #dee2e6' }}>
                                            <th style={{ textAlign: 'left', padding: 4 }}>Description</th>
                                            <th style={{ width: 60, padding: 4 }}>Qty</th>
                                            <th style={{ width: 90, padding: 4 }}>Unit Price</th>
                                            <th style={{ width: 60, padding: 4 }}>VAT %</th>
                                            <th style={{ width: 90, padding: 4, textAlign: 'right' }}>Net</th>
                                            <th style={{ width: 90, padding: 4, textAlign: 'right' }}>Gross</th>
                                            <th style={{ width: 30 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.lineItems.map((line, idx) => (
                                            <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                                <td style={{ padding: 4 }}>
                                                    <input style={{ ...inputStyle, margin: 0, width: '100%' }} value={line.description}
                                                        onChange={e => updateLine(idx, 'description', e.target.value)} />
                                                </td>
                                                <td style={{ padding: 4 }}>
                                                    <input type="number" style={{ ...inputStyle, margin: 0, width: '100%' }} value={line.quantity}
                                                        onChange={e => updateLine(idx, 'quantity', e.target.value)} />
                                                </td>
                                                <td style={{ padding: 4 }}>
                                                    <input type="number" step="0.01" style={{ ...inputStyle, margin: 0, width: '100%' }} value={line.unitPrice}
                                                        onChange={e => updateLine(idx, 'unitPrice', e.target.value)} />
                                                </td>
                                                <td style={{ padding: 4 }}>
                                                    <input type="number" style={{ ...inputStyle, margin: 0, width: '100%' }} value={line.vatRate}
                                                        onChange={e => updateLine(idx, 'vatRate', e.target.value)} />
                                                </td>
                                                <td style={{ padding: 4, textAlign: 'right' }}>{formatCurrency(line.amountNet)}</td>
                                                <td style={{ padding: 4, textAlign: 'right', fontWeight: 600 }}>{formatCurrency(line.amountGross)}</td>
                                                <td style={{ padding: 4 }}>
                                                    <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: 16 }}>×</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Totals */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
                            <div>
                                <label style={labelStyle}>Amount Net</label>
                                <input type="number" step="0.01" style={inputStyle} value={form.amountNet}
                                    onChange={e => setForm(recalcAmounts('amountNet', e.target.value, form))} />
                            </div>
                            <div>
                                <label style={labelStyle}>VAT</label>
                                <input type="number" step="0.01" style={inputStyle} value={form.vatAmount}
                                    onChange={e => setForm({ ...form, vatAmount: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Amount Gross</label>
                                <input type="number" step="0.01" style={{ ...inputStyle, fontWeight: 600, fontSize: '1.05rem' }} value={form.amountGross}
                                    onChange={e => setForm(recalcAmounts('amountGross', e.target.value, form))} />
                            </div>
                        </div>

                        {/* Notes */}
                        <div style={{ marginTop: 12 }}>
                            <label style={labelStyle}>Notes</label>
                            <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes || ''}
                                onChange={e => setForm({ ...form, notes: e.target.value })} />
                        </div>

                        {/* Recurring */}
                        <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
                                <input type="checkbox" checked={form.isRecurring} onChange={e => setForm({ ...form, isRecurring: e.target.checked })} />
                                Recurring bill
                            </label>
                            {form.isRecurring && (
                                <select style={inputStyle} value={form.recurringFrequency || ''} onChange={e => setForm({ ...form, recurringFrequency: e.target.value })}>
                                    <option value="">— frequency —</option>
                                    <option value="Monthly">Monthly</option>
                                    <option value="Quarterly">Quarterly</option>
                                    <option value="Annual">Annual</option>
                                </select>
                            )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 24, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleSave}>
                                {editing ? 'Update Bill' : 'Save Bill'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ──── Pay Modal ──── */}
            {showPayModal && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setShowPayModal(null)}
                >
                    <div
                        style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', maxWidth: 420, width: '95%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 style={{ margin: '0 0 20px' }}>Record Payment</h3>
                        <div style={{ display: 'grid', gap: 12 }}>
                            <div>
                                <label style={labelStyle}>Amount Paid</label>
                                <input type="number" step="0.01" style={inputStyle} value={paymentDetails.amountPaid || ''}
                                    onChange={e => setPaymentDetails({ ...paymentDetails, amountPaid: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Date Paid</label>
                                <input type="date" style={inputStyle} value={paymentDetails.datePaid || ''}
                                    onChange={e => setPaymentDetails({ ...paymentDetails, datePaid: e.target.value })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Payment Method</label>
                                <select style={inputStyle} value={paymentDetails.paymentMethod || ''}
                                    onChange={e => setPaymentDetails({ ...paymentDetails, paymentMethod: e.target.value })}>
                                    <option value="">— select —</option>
                                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>Reference</label>
                                <input style={inputStyle} value={paymentDetails.paymentReference || ''} placeholder="Bank ref / transaction #"
                                    onChange={e => setPaymentDetails({ ...paymentDetails, paymentReference: e.target.value })} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" onClick={() => setShowPayModal(null)}>Cancel</button>
                            <button className="btn-primary" style={{ background: '#16a34a' }} onClick={handlePaySubmit}>Record Payment</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const labelStyle = { display: 'block', fontSize: '0.82rem', fontWeight: 500, color: '#495057', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem', boxSizing: 'border-box' };
