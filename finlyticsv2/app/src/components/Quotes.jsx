import React, { useState, useEffect } from 'react';
import { getQuotes, createQuote, updateQuote, deleteQuote, getNextQuoteNumber, getCustomers, getLineItemDescriptions } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import AutocompleteInput from './AutocompleteInput';

const API_BASE = 'https://finlyticsdevfunc.azurewebsites.net/api';

export default function Quotes() {
  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [descriptionSuggestions, setDescriptionSuggestions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingQuote, setEditingQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [emailModal, setEmailModal] = useState(null); // { quote, email }
  const [sendOnSave, setSendOnSave] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  const [formData, setFormData] = useState({
    quoteNumber: '',
    customerId: '',
    quoteDateIssued: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    billingEmail: '',
    status: 'Sent',
    linkedInvoiceId: null,
    lineItems: [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }],
    discountPercent: 0,
    discountAmount: 0,
    discountNote: ''
  });

  useEffect(() => {
    loadQuotes();
    loadCustomers();
    getLineItemDescriptions().then(setDescriptionSuggestions).catch(() => {});
  }, []);

  const toDateInput = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      if (value.includes('T')) return value.split('T')[0];
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  };

  const loadQuotes = async () => {
    try {
      const data = await getQuotes();
      setQuotes(data);
    } catch (error) {
      console.error('Error loading quotes:', error);
      showToast('Failed to load quotes', 'error');
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

  const handleNewQuote = async () => {
    if (showForm) {
      // If form is showing, cancel/close it
      setShowForm(false);
      setEditingQuote(null);
      return;
    }
    
    try {
      const nextNumber = await getNextQuoteNumber();
      setFormData({
        quoteNumber: nextNumber.quoteNumber,
        customerId: '',
        quoteDateIssued: new Date().toISOString().split('T')[0],
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        billingEmail: '',
        status: 'Sent',
        linkedInvoiceId: null,
        lineItems: [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }],
        discountPercent: 0,
        discountAmount: 0,
        discountNote: ''
      });
      setEditingQuote(null);
      setShowForm(true);
    } catch (error) {
      console.error('Error getting next quote number:', error);
      showToast('Failed to get next quote number', 'error');
    }
  };

  const handleEditQuote = (quote) => {
    const quoteDateIssued = quote.quoteDateIssued || quote.dateIssued || '';
    const selectedCustomerId = quote.customerId
      ? quote.customerId.toString()
      : (customers.find(c => (c.customerName || c.name) === quote.customerName)?.id?.toString() || '');
    const selectedCustomer = selectedCustomerId
      ? customers.find(c => c.id?.toString() === selectedCustomerId)
      : null;
    const billingEmail = quote.billingEmail || selectedCustomer?.billingEmail || selectedCustomer?.email || '';
    setFormData({
      quoteNumber: quote.quoteNumber,
      customerId: selectedCustomerId,
      quoteDateIssued: toDateInput(quoteDateIssued),
      validUntil: toDateInput(quote.validUntil),
      billingEmail: billingEmail,
      status: quote.status,
      linkedInvoiceId: quote.linkedInvoiceId,
      lineItems: quote.lineItems && quote.lineItems.length > 0 ? quote.lineItems : [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }],
      discountPercent: quote.discountPercent || 0,
      discountAmount: quote.discountAmount || 0,
      discountNote: quote.discountNote || ''
    });
    setEditingQuote(quote);
    setShowForm(true);
  };

  const handleDeleteQuote = async (id) => {
    if (id === null || id === undefined || (typeof id === 'string' && id.trim() === '')) {
      showToast('Cannot delete: Invalid quote ID', 'error');
      return;
    }
    if (!confirm('Are you sure you want to delete this quote?')) return;
    
    try {
      await deleteQuote(id);
      await loadQuotes();
    } catch (error) {
      console.error('Error deleting quote:', error);
      showToast('Failed to delete quote', 'error');
    }
  };

  const handleViewPdf = async (quoteId, quoteNumber) => {
    try {
      // Open the PDF in a new window
      const pdfUrl = `${API_BASE}/quotes/${quoteId}/pdf`;
      window.open(pdfUrl, '_blank');
    } catch (error) {
      console.error('Error viewing PDF:', error);
      showToast('Failed to open PDF', 'error');
    }
  };

  const handleEmailQuote = (quote) => {
    setEmailModal({ quote, email: quote.billingEmail || '' });
  };

  const sendEmailTo = async (quote, email) => {
    try {
      const response = await fetch(`${API_BASE}/quotes/${quote.id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: email ? JSON.stringify({ email }) : null,
      });
      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        const toEmail = result?.toEmail || email || 'the recipient';
        showToast(`Quote emailed to ${toEmail}`, 'success');
      } else {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Error emailing quote:', error);
      showToast(`Failed to send email: ${error.message}`, 'error');
    }
  };

  const calculateLineTotal = (lineItem) => {
    const subtotal = lineItem.quantity * lineItem.rate;
    const vatAmount = subtotal * (lineItem.vatRate / 100);
    return subtotal + vatAmount;
  };

  const handleLineItemChange = (index, field, value) => {
    const updatedLineItems = [...formData.lineItems];
    updatedLineItems[index] = { ...updatedLineItems[index], [field]: value };
    
    // Recalculate line total
    updatedLineItems[index].lineTotal = calculateLineTotal(updatedLineItems[index]);
    
    setFormData({ ...formData, lineItems: updatedLineItems });
  };

  const addLineItem = () => {
    const selectedCustomer = customers.find(c => c.id?.toString() === formData.customerId?.toString());
    const defaultRate = parseFloat(selectedCustomer?.defaultDayRate) || 0;
    const defaultVatRate = selectedCustomer?.defaultVATRate ?? 20;
    setFormData({
      ...formData,
      lineItems: [
        ...formData.lineItems,
        { lineNumber: formData.lineItems.length + 1, description: '', rateType: 'Day Rate', quantity: 0, rate: defaultRate, vatRate: defaultVatRate, lineTotal: 0 }
      ]
    });
  };

  const removeLineItem = (index) => {
    if (formData.lineItems.length === 1) {
      showToast('Quote must have at least one line item', 'warning');
      return;
    }
    const updatedLineItems = formData.lineItems.filter((_, i) => i !== index);
    // Renumber line items
    updatedLineItems.forEach((item, i) => item.lineNumber = i + 1);
    setFormData({ ...formData, lineItems: updatedLineItems });
  };

  const calculateTotals = () => {
    const subtotal = formData.lineItems.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
    let discount = 0;
    
    // Use percentage discount if set, otherwise use fixed amount
    if (formData.discountPercent > 0) {
      discount = subtotal * (formData.discountPercent / 100);
    } else if (formData.discountAmount > 0) {
      discount = formData.discountAmount;
    }
    
    const afterDiscount = subtotal - discount;
    const vatAmount = formData.lineItems.reduce((sum, item) => {
      const lineSubtotal = item.quantity * item.rate;
      return sum + (lineSubtotal * (item.vatRate / 100));
    }, 0);
    
    const total = afterDiscount + vatAmount;
    
    return {
      subtotal: subtotal.toFixed(2),
      discount: discount.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      total: total.toFixed(2)
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.customerId) {
      showToast('Please select a customer', 'warning');
      return;
    }
    
    if (formData.lineItems.length === 0 || formData.lineItems.every(item => !item.description)) {
      showToast('Please add at least one line item', 'warning');
      return;
    }
    
    setProcessing(true);
    
    try {
      const totals = calculateTotals();
      const customer = customers.find(c => c.id?.toString() === formData.customerId?.toString());
      
      const quoteData = {
        quoteNumber: formData.quoteNumber,
        customerId: formData.customerId,   // Customer.Id is a string — do NOT parseInt
        customerName: customer ? (customer.customerName || customer.name) : (editingQuote?.customerName || ''),
        billingEmail: formData.billingEmail,
        dateIssued: new Date(formData.quoteDateIssued).toISOString(),
        validUntil: new Date(formData.validUntil).toISOString(),
        status: formData.status,
        amountNet: parseFloat(totals.subtotal),
        vatAmount: parseFloat(totals.vatAmount),
        amountGross: parseFloat(totals.total),
        discountPercent: parseFloat(formData.discountPercent) || 0,
        discountAmount: parseFloat(formData.discountAmount) || 0,
        discountNote: formData.discountNote || '',
        taxYear: calculateFinancialYear(new Date(formData.quoteDateIssued)),
        financialYear: `${calculateFinancialYear(new Date(formData.quoteDateIssued))}-${(calculateFinancialYear(new Date(formData.quoteDateIssued)) + 1).toString().slice(2)}`,
        lineItems: formData.lineItems.map(item => ({
          ...item,
          quantity: parseFloat(item.quantity),
          rate: parseFloat(item.rate),
          vatRate: parseFloat(item.vatRate),
          lineTotal: calculateLineTotal(item)
        }))
      };
      
      if (editingQuote) {
        await updateQuote(editingQuote.id, quoteData);
      } else {
        const created = await createQuote(quoteData);
        if (sendOnSave && quoteData.billingEmail) {
          await sendEmailTo(created, quoteData.billingEmail);
        }
      }

      setShowForm(false);
      setSendOnSave(false);
      await loadQuotes();
    } catch (error) {
      console.error('Error saving quote:', error);
      showToast('Failed to save quote', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const calculateFinancialYear = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    const day = date.getDate();
    // UK financial year starts April 6th
    // If before April 6th, use previous year
    if (month < 4 || (month === 4 && day < 6)) {
      return year - 1;
    }
    return year;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Draft': return '#6c757d';
      case 'Sent': return '#17a2b8';
      case 'Accepted': return '#28a745';
      case 'Declined': return '#dc3545';
      case 'Expired': return '#ffc107';
      case 'ConvertedToInvoice': return '#007bff';
      default: return '#6c757d';
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Loading quotes...</div>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">{editingQuote ? 'Updating quote...' : 'Creating quote...'}</div>
      </div>
    );
  }

  const totals = showForm ? calculateTotals() : null;

  return (
    <div className="quotes">
      <Toast toast={toast} onClose={clearToast} />
      <div className="page-header">
        <h1>Quotes</h1>
        <button onClick={handleNewQuote} className="btn-primary">
          + New Quote
        </button>
      </div>

      {emailModal && (
        <div className="modal-overlay" onClick={() => setEmailModal(null)}>
          <div className="modal-content" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📧 Send Quote</h3>
              <button className="btn-close" onClick={() => setEmailModal(null)}>✖</button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ margin: '0 0 0.5rem', color: '#6b7280', fontSize: '0.875rem' }}>Sending</p>
              <p style={{ margin: '0 0 1.25rem', fontWeight: 700, fontSize: '1.05rem', color: '#1a1a2e' }}>
                {emailModal.quote.quoteNumber}
                {emailModal.quote.customerName && (
                  <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '0.875rem', marginLeft: 8 }}>· {emailModal.quote.customerName}</span>
                )}
              </p>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Recipient email</label>
              <input
                type="email"
                value={emailModal.email}
                onChange={e => setEmailModal({ ...emailModal, email: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const { quote, email } = emailModal;
                    if (email) { setEmailModal(null); sendEmailTo(quote, email); }
                  }
                }}
                placeholder="recipient@example.com"
                autoFocus
                style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: 6,
                  border: '1px solid #d1d5db', fontSize: '0.95rem', marginBottom: '1.5rem',
                  boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setEmailModal(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!emailModal.email}
                  onClick={() => {
                    const { quote, email } = emailModal;
                    setEmailModal(null);
                    sendEmailTo(quote, email);
                  }}
                >
                  Send Quote
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingQuote ? 'Edit Quote' : 'New Quote'}</h3>
              <button className="btn-close" onClick={() => setShowForm(false)}>✖</button>
            </div>
            <form onSubmit={handleSubmit} className="entity-form">
            <div className="form-row">
              <div className="form-group">
                <label>Quote Number</label>
                <input
                  type="text"
                  value={formData.quoteNumber}
                  disabled
                />
              </div>

              <div className="form-group">
                <label>Customer *</label>
                <select
                  value={formData.customerId}
                  onChange={(e) => {
                    const selectedCustomer = customers.find(c => c.id.toString() === e.target.value.toString());
                    const billingEmail = selectedCustomer?.billingEmail || selectedCustomer?.email || '';
                    const updatedLineItems = formData.lineItems.map(item => {
                      const rate = item.rateType === 'Day Rate'
                        ? parseFloat(selectedCustomer?.defaultDayRate) || item.rate
                        : item.rateType === 'Hourly Rate'
                        ? parseFloat(selectedCustomer?.defaultHourlyRate) || item.rate
                        : item.rate;
                      const vatRate = selectedCustomer?.defaultVATRate != null ? selectedCustomer.defaultVATRate : item.vatRate;
                      const lineTotal = item.quantity * rate * (1 + vatRate / 100);
                      return { ...item, rate, vatRate, lineTotal };
                    });
                    setFormData({ 
                      ...formData, 
                      customerId: e.target.value,
                      billingEmail,
                      lineItems: updatedLineItems
                    });
                  }}
                  required
                >
                  <option value="">Select Customer</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.customerCode ? `${customer.customerCode} - ${customer.customerName || customer.name}` : (customer.customerName || customer.name)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Date Issued *</label>
                <input
                  type="date"
                  value={formData.quoteDateIssued}
                  onChange={(e) => setFormData({ ...formData, quoteDateIssued: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Valid Until *</label>
                <input
                  type="date"
                  value={formData.validUntil}
                  onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Status *</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  required
                >
                  <option value="Draft">Draft</option>
                  <option value="Sent">Sent</option>
                  <option value="Accepted">Accepted</option>
                  <option value="Declined">Declined</option>
                  <option value="Expired">Expired</option>
                  <option value="ConvertedToInvoice">Converted To Invoice</option>
                </select>
              </div>

              <div className="form-group">
                <label>Billing Email *</label>
                <input
                  type="email"
                  value={formData.billingEmail}
                  onChange={(e) => setFormData({ ...formData, billingEmail: e.target.value })}
                  placeholder="Quote will be emailed to this address"
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3>Line Items</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Description</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd', width: '120px' }}>Rate Type</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '80px' }}>Qty</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '100px' }}>Rate</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '80px' }}>VAT %</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '100px' }}>Total</th>
                    <th style={{ padding: '10px', border: '1px solid #ddd', width: '50px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {formData.lineItems.map((item, index) => (
                    <tr key={index}>
                      <td style={{ padding: '5px', border: '1px solid #ddd' }}>
                        <AutocompleteInput
                          value={item.description}
                          onChange={(val) => handleLineItemChange(index, 'description', val)}
                          suggestions={descriptionSuggestions}
                          style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                      </td>
                      <td style={{ padding: '5px', border: '1px solid #ddd' }}>
                        <select
                          value={item.rateType}
                          onChange={(e) => handleLineItemChange(index, 'rateType', e.target.value)}
                          style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                          <option value="Day Rate">Day Rate</option>
                          <option value="Hourly Rate">Hourly Rate</option>
                        </select>
                      </td>
                      <td style={{ padding: '5px', border: '1px solid #ddd' }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.quantity}
                          onChange={(e) => {
                            const value = e.target.value;
                            // Allow only numbers and decimal point
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              handleLineItemChange(index, 'quantity', parseFloat(value) || 0);
                            }
                          }}
                          style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '5px', border: '1px solid #ddd' }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.rate}
                          onChange={(e) => {
                            const value = e.target.value;
                            // Allow only numbers and decimal point
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              handleLineItemChange(index, 'rate', parseFloat(value) || 0);
                            }
                          }}
                          style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '5px', border: '1px solid #ddd' }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.vatRate}
                          onChange={(e) => {
                            const value = e.target.value;
                            // Allow only numbers and decimal point
                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                              handleLineItemChange(index, 'vatRate', parseFloat(value) || 0);
                            }
                          }}
                          style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '5px', border: '1px solid #ddd', textAlign: 'right' }}>
                        £{item.lineTotal.toFixed(2)}
                      </td>
                      <td style={{ padding: '5px', border: '1px solid #ddd', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => removeLineItem(index)}
                          style={{ padding: '5px 10px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                onClick={addLineItem}
                style={{ padding: '8px 16px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Add Line Item
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Discount % (mutually exclusive with fixed amount)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.discountPercent}
                  onChange={(e) => setFormData({ ...formData, discountPercent: parseFloat(e.target.value) || 0, discountAmount: 0 })}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Discount Amount £ (mutually exclusive with %)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.discountAmount}
                  onChange={(e) => setFormData({ ...formData, discountAmount: parseFloat(e.target.value) || 0, discountPercent: 0 })}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Discount Note</label>
                <input
                  type="text"
                  value={formData.discountNote}
                  onChange={(e) => setFormData({ ...formData, discountNote: e.target.value })}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                  placeholder="Optional note about the discount"
                />
              </div>
            </div>

            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Subtotal:</span>
                <span>£{totals?.subtotal}</span>
              </div>
              {(formData.discountPercent > 0 || formData.discountAmount > 0) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', color: '#dc3545' }}>
                  <span>Discount:</span>
                  <span>-£{totals?.discount}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>VAT:</span>
                <span>£{totals?.vatAmount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '18px', borderTop: '2px solid #dee2e6', paddingTop: '10px' }}>
                <span>Total:</span>
                <span>£{totals?.total}</span>
              </div>
            </div>

            {!editingQuote && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem',
                padding: '0.75rem 1rem', background: sendOnSave ? '#eff6ff' : '#f9fafb',
                borderRadius: 8, border: `1px solid ${sendOnSave ? '#bfdbfe' : '#e5e7eb'}`,
                transition: 'all 0.15s' }}>
                <input
                  type="checkbox"
                  id="sendOnSave"
                  checked={sendOnSave}
                  onChange={e => setSendOnSave(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <label htmlFor="sendOnSave" style={{ cursor: 'pointer', fontSize: '0.875rem',
                  color: sendOnSave ? '#1d4ed8' : '#374151', fontWeight: sendOnSave ? 600 : 400,
                  userSelect: 'none' }}>
                  📧 Send quote by email immediately after saving
                  {formData.billingEmail && (
                    <span style={{ color: '#6b7280', fontWeight: 400 }}> → {formData.billingEmail}</span>
                  )}
                </label>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={processing}>
                {processing ? 'Saving…' : editingQuote ? 'Update Quote' : (sendOnSave ? 'Save & Send Quote' : 'Create Quote')}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setSendOnSave(false); }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
          </div>
        </div>
      )}

      <div className="quotes-list">
          {quotes.length === 0 ? (
            <p>No quotes found. Create your first quote to get started.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quote #</th>
                  <th>Customer</th>
                  <th>Date Issued</th>
                  <th>Valid Until</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(quote => (
                  <tr key={quote.id}>
                    <td><strong>{quote.quoteNumber}</strong></td>
                    <td>{quote.customerName || customers.find(c => c.id?.toString() === quote.customerId?.toString())?.customerName || customers.find(c => c.id?.toString() === quote.customerId?.toString())?.name || 'N/A'}</td>
                    <td>
                      {quote.quoteDateIssued ? new Date(quote.quoteDateIssued).toLocaleDateString() : (quote.dateIssued ? new Date(quote.dateIssued).toLocaleDateString() : 'N/A')}
                    </td>
                    <td>
                      {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : 'N/A'}
                    </td>
                    <td>£{quote.amountGross?.toFixed(2) || '0.00'}</td>
                    <td>
                      <span className={`status-badge status-${quote.status.toLowerCase()}`}>
                        {quote.status}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleViewPdf(quote.id, quote.quoteNumber)}
                        className="btn-icon"
                        title="View PDF"
                      >
                        📄
                      </button>
                      <button
                        onClick={() => handleEmailQuote(quote)}
                        className="btn-icon"
                        title="Email Quote"
                        style={{marginLeft: '5px'}}
                      >
                        📧
                      </button>
                      <button
                        onClick={() => handleEditQuote(quote)}
                        className="btn-icon"
                        title="Edit"
                        style={{marginLeft: '5px'}}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteQuote(quote.id)}
                        className="btn-icon"
                        title="Delete"
                        style={{marginLeft: '5px'}}
                      >
                        🗑️
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

