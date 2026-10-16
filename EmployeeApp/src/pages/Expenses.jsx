import { useAuth } from '@clerk/react'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getExpenses, createExpense, updateExpense, deleteExpense, uploadReceipt, analyzeReceipt } from '../services/api'

const CATEGORIES = [
  'Travel', 'Fuel', 'Meals & Entertainment', 'Office Supplies',
  'Software & Subscriptions', 'Equipment', 'Parking', 'Accommodation',
  'Training', 'Phone & Internet', 'Professional Services', 'Other'
]

const VAT_APPLICABILITIES = ['Standard', 'Reduced', 'Zero', 'Exempt', 'Not Applicable']

const PAYMENT_METHODS = ['Personal Card', 'Company Card', 'Cash', 'Bank Transfer']

function calculateVAT(isGross, amount, applicability) {
  const val = parseFloat(amount) || 0
  const rate = applicability === 'Standard' ? 20 : applicability === 'Reduced' ? 5 : 0
  if (rate === 0) return { amountNet: val.toFixed(2), vatAmount: '0.00', amountGross: val.toFixed(2) }
  if (isGross) {
    const net = val / (1 + rate / 100)
    return { amountNet: net.toFixed(2), vatAmount: (val - net).toFixed(2), amountGross: val.toFixed(2) }
  }
  const vat = val * rate / 100
  return { amountNet: val.toFixed(2), vatAmount: vat.toFixed(2), amountGross: (val + vat).toFixed(2) }
}

export default function Expenses() {
  const { getToken } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Receipt / scanning state
  const [selectedFiles, setSelectedFiles] = useState([])
  const [captureScanning, setCaptureScanning] = useState(false)
  const [captureScanToast, setCaptureScanToast] = useState(null)
  const [captureDragOver, setCaptureDragOver] = useState(false)
  const [formDragOver, setFormDragOver] = useState(false)
  const captureInputRef = useRef(null)
  const formFileRef = useRef(null)

  const emptyForm = {
    supplier: '', category: '', amountNet: '', vatAmount: '', amountGross: '',
    vatApplicability: 'Standard',
    entryDate: new Date().toISOString().slice(0, 10), reference: '', notes: '',
    paymentMethod: 'Personal Card'
  }
  const [form, setForm] = useState(emptyForm)

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const loadExpenses = async () => {
    try {
      setLoading(true)
      const data = await getExpenses(getToken)
      setExpenses(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadExpenses() }, [getToken])

  // Handle deep-link modes from Dashboard quick actions
  useEffect(() => {
    const mode = searchParams.get('mode')
    if (!mode) return
    setSearchParams({}, { replace: true })
    if (mode === 'scan') {
      setTimeout(() => captureInputRef.current?.click(), 300)
    } else if (mode === 'upload') {
      setTimeout(() => formFileRef.current?.click(), 300)
    } else if (mode === 'manual') {
      openNewForm()
    }
  }, [searchParams])

  const openNewForm = () => {
    setEditingExpense(null)
    setForm(emptyForm)
    setSelectedFiles([])
    setCaptureScanToast(null)
    setShowForm(true)
  }

  const openExpenseCapture = async (file) => {
    setSelectedFiles([file])
    setEditingExpense(null)
    setForm(emptyForm)
    setCaptureScanToast(null)
    setShowForm(true)
    setCaptureScanning(true)
    try {
      const scan = await analyzeReceipt(file, getToken)
      if (scan && scan.configured === false) {
        setCaptureScanToast('noOcr')
      } else if (scan && scan.found) {
        // Use the receipt's printed total; summing scanned lines can double-count subtotal/total rows
        const totalNet = scan.amountNet || 0
        const totalVat = scan.vatAmount || 0
        const totalGross = scan.amountGross || 0
        setForm(f => ({
          ...f,
          supplier: scan.vendor || f.supplier,
          reference: scan.invoiceRef || f.reference,
          entryDate: scan.invoiceDate || f.entryDate,
          amountNet: totalNet > 0 ? totalNet.toFixed(2) : (scan.subtotal || scan.total || f.amountNet),
          vatAmount: totalVat > 0 ? totalVat.toFixed(2) : (scan.vatAmount || f.vatAmount),
          amountGross: totalGross > 0 ? totalGross.toFixed(2) : (scan.total || f.amountGross),
          vatApplicability: totalVat > 0 ? 'Standard' : 'Zero'
        }))
        setCaptureScanToast('success')
      } else {
        setCaptureScanToast('error')
      }
    } catch {
      setCaptureScanToast('error')
    } finally {
      setCaptureScanning(false)
    }
  }

  const handleAmountChange = (field, value) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    setForm(f => ({ ...f, [field]: value }))
  }

  const handleAmountBlur = (field) => {
    const val = form[field]
    if (!val || val === '') return
    const calc = calculateVAT(field === 'amountGross', val, form.vatApplicability)
    setForm(f => ({ ...f, ...calc }))
  }

  const handleVatChange = (newApplicability) => {
    if (form.amountGross && parseFloat(form.amountGross) > 0) {
      const calc = calculateVAT(true, form.amountGross, newApplicability)
      setForm(f => ({ ...f, vatApplicability: newApplicability, ...calc }))
    } else if (form.amountNet && parseFloat(form.amountNet) > 0) {
      const calc = calculateVAT(false, form.amountNet, newApplicability)
      setForm(f => ({ ...f, vatApplicability: newApplicability, ...calc }))
    } else {
      setForm(f => ({ ...f, vatApplicability: newApplicability }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setProcessing(true)
    try {
      const payload = {
        ...form,
        amountNet: parseFloat(form.amountNet) || 0,
        vatAmount: parseFloat(form.vatAmount) || 0,
        amountGross: parseFloat(form.amountGross) || 0,
        entryDate: form.entryDate ? new Date(form.entryDate).toISOString() : null,
      }

      let saved
      if (editingExpense) {
        saved = await updateExpense(editingExpense.id, payload, getToken)
      } else {
        saved = await createExpense(payload, getToken)
      }

      // Upload receipt files
      if (selectedFiles.length > 0 && saved?.id) {
        for (const file of selectedFiles) {
          await uploadReceipt(saved.id, file, getToken)
        }
      }

      setShowForm(false)
      setForm(emptyForm)
      setEditingExpense(null)
      setSelectedFiles([])
      loadExpenses()
    } catch (err) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  const handleEdit = (exp) => {
    setEditingExpense(exp)
    setForm({
      supplier: exp.supplier || '',
      category: exp.category || '',
      amountNet: exp.amountNet || '',
      vatAmount: exp.vatAmount || '',
      amountGross: exp.amountGross || '',
      vatApplicability: exp.vatApplicability || 'Standard',
      entryDate: exp.entryDate ? new Date(exp.entryDate).toISOString().slice(0, 10) : '',
      reference: exp.reference || '',
      notes: exp.notes || '',
      paymentMethod: exp.paymentMethod || 'Personal Card',
    })
    setSelectedFiles([])
    setCaptureScanToast(null)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this draft expense?')) return
    try {
      await deleteExpense(id, getToken)
      loadExpenses()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <div className="loading">Loading expenses...</div>

  return (
    <div className="page">
      {/* Hidden file inputs */}
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) openExpenseCapture(f); e.target.value = '' }}
      />

      <div className="page-header">
        <h1>My Expenses</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-accent" onClick={() => captureInputRef.current?.click()}>
            📸 Scan Receipt
          </button>
          <button className="btn btn-primary" onClick={openNewForm}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* Drag & drop capture zone */}
      <div
        onDragOver={e => { e.preventDefault(); setCaptureDragOver(true) }}
        onDragLeave={() => setCaptureDragOver(false)}
        onDrop={e => { e.preventDefault(); setCaptureDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) openExpenseCapture(f) }}
        onClick={() => captureInputRef.current?.click()}
        className={`capture-dropzone ${captureDragOver ? 'active' : ''}`}
      >
        {isMobile
          ? '📸 Tap here to take a photo or choose a receipt — fields will be filled automatically'
          : '📎 Drag & drop a receipt (PDF or image) here to auto-fill the form, or click to browse'}
      </div>

      {error && <div className="error-banner">⚠️ {error} <button onClick={() => setError(null)}>✕</button></div>}

      {/* ─── Expense Form Modal ─── */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => !processing && setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingExpense ? 'Edit Expense' : 'New Expense'}</h2>
              <button className="modal-close" onClick={() => !processing && setShowForm(false)} disabled={processing}>✖</button>
            </div>

            {/* OCR scanning toast */}
            {captureScanning && (
              <div className="scan-toast scanning">
                <span className="scan-spinner" />
                🔍 Scanning receipt with AI…
              </div>
            )}
            {!captureScanning && captureScanToast === 'success' && (
              <div className="scan-toast success">
                ✅ Receipt scanned — fields pre-filled. Please check before saving.
              </div>
            )}
            {!captureScanning && captureScanToast === 'noOcr' && (
              <div className="scan-toast warning">
                ⚠️ Receipt scanning is not configured for this company.
              </div>
            )}
            {!captureScanning && captureScanToast === 'error' && (
              <div className="scan-toast error">
                ⚠️ Could not extract details — please fill in the fields manually.
              </div>
            )}

            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-group">
                <label>Supplier *</label>
                <input value={form.supplier} onChange={e => setForm(f => ({...f, supplier: e.target.value}))} required placeholder="e.g. Tesco, Amazon, Shell" />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category *</label>
                  <select value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))} required>
                    <option value="">Select Category</option>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Reference</label>
                  <input value={form.reference} onChange={e => setForm(f => ({...f, reference: e.target.value}))} placeholder="Invoice # / ref" />
                </div>
              </div>

              <div className="form-group">
                <label>VAT Treatment *</label>
                <select value={form.vatApplicability} onChange={e => handleVatChange(e.target.value)}>
                  {VAT_APPLICABILITIES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div className="form-group">
                  <label>Pre-VAT</label>
                  <input type="text" inputMode="decimal" value={form.amountNet}
                    onChange={e => handleAmountChange('amountNet', e.target.value)}
                    onBlur={() => handleAmountBlur('amountNet')}
                    placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label>VAT</label>
                  <input type="text" value={form.vatAmount} readOnly disabled />
                </div>
                <div className="form-group">
                  <label>Total (inc. VAT) *</label>
                  <input type="text" inputMode="decimal" value={form.amountGross}
                    onChange={e => handleAmountChange('amountGross', e.target.value)}
                    onBlur={() => handleAmountBlur('amountGross')}
                    placeholder="0.00" required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Date *</label>
                  <input type="date" value={form.entryDate} onChange={e => setForm(f => ({...f, entryDate: e.target.value}))} required />
                </div>
                <div className="form-group">
                  <label>Payment Method</label>
                  <select value={form.paymentMethod} onChange={e => setForm(f => ({...f, paymentMethod: e.target.value}))}>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} placeholder="Optional notes..." />
              </div>

              {/* Receipt upload area */}
              <div className="form-group">
                <label>Receipt(s)</label>
                <input
                  ref={formFileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { setSelectedFiles(prev => [...prev, ...Array.from(e.target.files)]); e.target.value = '' }}
                />

                {/* File previews */}
                {selectedFiles.length > 0 && (
                  <div className="file-previews">
                    {selectedFiles.map((f, i) => {
                      const isImage = f.type?.startsWith('image/')
                      const previewUrl = isImage ? URL.createObjectURL(f) : null
                      const isFromScan = i === 0 && captureScanToast === 'success'
                      return (
                        <div key={i} className={`file-preview-item ${isFromScan ? 'from-scan' : ''}`}>
                          {previewUrl
                            ? <img src={previewUrl} alt="preview" className="file-thumb" onLoad={() => URL.revokeObjectURL(previewUrl)} />
                            : <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>📄</span>
                          }
                          <span className="file-preview-name">{f.name}</span>
                          {isFromScan && <span className="scan-badge">from scan</span>}
                          <button type="button" onClick={() => setSelectedFiles(prev => prev.filter((_, j) => j !== i))} className="file-remove">×</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* In-form drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setFormDragOver(true) }}
                  onDragLeave={() => setFormDragOver(false)}
                  onDrop={e => { e.preventDefault(); setFormDragOver(false); setSelectedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]) }}
                  onClick={() => formFileRef.current?.click()}
                  className={`form-dropzone ${formDragOver ? 'active' : ''}`}
                >
                  {isMobile ? '📸 Tap to add a photo or file' : '📎 Drag & drop or click to add receipts'}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)} disabled={processing}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={processing}>
                  {processing ? 'Saving…' : editingExpense ? 'Update Expense' : 'Submit Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Expense List ─── */}
      <div className="item-list">
        {expenses.length === 0 && (
          <div className="empty">
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🧾</p>
            <p><strong>No expenses yet</strong></p>
            <p>Tap "Scan Receipt" or "+ Add Expense" to get started.</p>
          </div>
        )}
        {expenses.map(exp => (
          <div key={exp.id} className="item-card">
            <div className="item-main">
              <div className="item-title">{exp.supplier || 'No supplier'}</div>
              <div className="item-meta">
                {exp.category}
                {exp.entryDate && <> · {new Date(exp.entryDate).toLocaleDateString('en-GB')}</>}
                {' '}<span className={`badge badge-${(exp.approvalStatus || 'draft').toLowerCase()}`}>{exp.approvalStatus || 'Draft'}</span>
                {exp.hasReceipt && ' 📎'}
              </div>
              {exp.approvalStatus === 'Rejected' && exp.rejectionReason && (
                <div style={{ fontSize: '0.8rem', color: 'var(--danger)', marginTop: 4 }}>❌ {exp.rejectionReason}</div>
              )}
            </div>
            <div className="item-amount">£{(exp.amountGross || 0).toFixed(2)}</div>
            <div className="item-actions">
              {(exp.approvalStatus === 'Draft' || exp.approvalStatus === 'Rejected') && (
                <>
                  <button className="btn btn-sm btn-outline" onClick={() => handleEdit(exp)}>Edit</button>
                  {exp.approvalStatus === 'Draft' && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(exp.id)}>Delete</button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
