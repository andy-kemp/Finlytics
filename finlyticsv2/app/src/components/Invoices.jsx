import React, { useState, useEffect } from 'react';
import { getInvoices, createInvoice, updateInvoice, deleteInvoice, getCustomers, getCompanySettings, getNextInvoiceNumber, sendInvoiceReminder, getCreditNotesByCustomer, applyCreditNote, getLineItemDescriptions } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import AutocompleteInput from './AutocompleteInput';

const API_BASE = 'https://finlyticsdevfunc.azurewebsites.net/api';

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [companySettings, setCompanySettings] = useState(null);
  const [descriptionSuggestions, setDescriptionSuggestions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  const [emailModal, setEmailModal] = useState(null); // { invoice, email }
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmModal, setConfirmModal] = useState(null);
  const [sendOnSave, setSendOnSave] = useState(false);
  const [availableCreditNotes, setAvailableCreditNotes] = useState([]);
  const [selectedCreditNoteId, setSelectedCreditNoteId] = useState(null);
  const [paidModal, setPaidModal] = useState(null);      // { invoice, datePaid }
  const [reminderModal, setReminderModal] = useState(null); // { invoice }
  const [isMobile, setIsMobile] = useState(false);
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    customerId: '',
    billingEmail: '',
    poReference: '',
    dateIssued: new Date().toISOString().split('T')[0],
    dueDate: '',
    datePaid: null,
    status: 'Draft',
    lineItems: [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }],
    discountPercent: 0,
    discountAmount: 0,
    discountNote: ''
  });

  useEffect(() => {
    loadInvoices();
    loadCustomers();
    loadCompanySettings();
    getLineItemDescriptions().then(setDescriptionSuggestions).catch(() => {});
  }, []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const loadInvoices = async () => {
    try {
      const data = await getInvoices();
      setInvoices(data);
    } catch (error) {
      console.error('Error loading invoices:', error);
      showToast('Failed to load invoices', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    try {
      const data = await getCustomers();
      console.log('Loaded customers:', data);
      console.log('First customer:', data[0]);
      setCustomers(data);
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  };

  const loadCompanySettings = async () => {
    try {
      const data = await getCompanySettings();
      setCompanySettings(data);
      console.log('Loaded company settings - Payment terms:', data.invoiceTermsDays);
    } catch (error) {
      console.error('Error loading company settings:', error);
    }
  };

  const calculateDueDate = (dateIssued) => {
    if (!dateIssued || !companySettings) return '';
    
    const paymentDays = parseInt(companySettings.invoiceTermsDays) || 14;
    const issued = new Date(dateIssued);
    const due = new Date(issued);
    due.setDate(due.getDate() + paymentDays);
    
    return due.toISOString().split('T')[0];
  };

  const normalizeInvoiceNumber = (invoiceNumber) => {
    if (!invoiceNumber) return invoiceNumber;

    const legacyMatch = invoiceNumber.match(/^INV-(\d{8})-(\d+)$/);
    if (!legacyMatch) return invoiceNumber;

    const yyyyMM = legacyMatch[1].slice(0, 6);
    const sequence = legacyMatch[2].padStart(3, '0');
    return `INV-${yyyyMM}-${sequence}`;
  };

  const handleNewInvoice = async () => {
    if (showForm) {
      // If form is showing, cancel/close it
      setShowForm(false);
      setEditingInvoice(null);
      return;
    }

    try {
      const nextNumber = await getNextInvoiceNumber();
      const normalizedInvoiceNumber = normalizeInvoiceNumber(nextNumber?.invoiceNumber);
      const todayStr = new Date().toISOString().split('T')[0];
      const calculatedDueDate = calculateDueDate(todayStr);

      setFormData({
        invoiceNumber: normalizedInvoiceNumber || nextNumber?.invoiceNumber || '',
        customerId: '',
        billingEmail: '',
        poReference: '',
        dateIssued: todayStr,
        dueDate: calculatedDueDate, // Auto-calculated from payment terms
        datePaid: null,
        status: 'Draft',
        lineItems: [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }],
        discountPercent: 0,
        discountAmount: 0,
        discountNote: ''
      });
      setEditingInvoice(null);
      setAvailableCreditNotes([]);
      setSelectedCreditNoteId(null);
      setShowForm(true);
    } catch (error) {
      console.error('Error getting next invoice number:', error);
      showToast('Failed to get next invoice number', 'error');
    }
  };

  const handleEditInvoice = (invoice) => {
    console.log('=== EDITING INVOICE ===');
    console.log('Invoice:', invoice);
    console.log('Invoice customerId:', invoice.customerId);
    console.log('Available customers:', customers);

    setFormData({
      invoiceNumber: invoice.invoiceNumber || '',
      customerId: invoice.customerId || '',
      billingEmail: invoice.billingEmail || '',
      poReference: invoice.poReference || '',
      dateIssued: invoice.dateIssued ? new Date(invoice.dateIssued).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().split('T')[0] : '',
      datePaid: invoice.datePaid || null,
      status: invoice.status || 'Draft',
      lineItems: invoice.lineItems && invoice.lineItems.length > 0 ? invoice.lineItems : [{ lineNumber: 1, description: '', rateType: 'Day Rate', quantity: 0, rate: 0, vatRate: 20, lineTotal: 0 }],
      discountPercent: invoice.discountPercent || 0,
      discountAmount: invoice.discountAmount || 0,
      discountNote: invoice.discountNote || ''
    });

    setEditingInvoice(invoice);
    setAvailableCreditNotes([]);
    setSelectedCreditNoteId(null);
    setShowForm(true);
  };

  const allowDataDeletion = companySettings?.allowDataDeletion === true;

  const toggleSelectId = (id) => setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
  });
  const selectAllInvoices = () => setSelectedIds(new Set(invoices.map(i => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleDeleteInvoice = (id) => {
    if (!id) { showToast('Cannot delete: Invalid invoice ID', 'error'); return; }
    const invoice = invoices.find(i => i.id === id);
    setConfirmModal({
      title: 'Delete Invoice?',
      message: `Are you sure you want to permanently delete invoice ${invoice?.invoiceNumber || id}?`,
      itemLabels: invoice ? [`${invoice.invoiceNumber} — ${invoice.customerName || ''} — ${invoice.status}`] : [],
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await deleteInvoice(id);
          showToast('Invoice deleted.', 'success');
          await loadInvoices();
        } catch (error) {
          console.error('Error deleting invoice:', error);
          showToast('Failed to delete invoice: ' + error.message, 'error');
        }
      }
    });
  };

  const handleBulkDeleteInvoices = () => {
    const toDelete = invoices.filter(i => selectedIds.has(i.id));
    if (toDelete.length === 0) return;
    setConfirmModal({
      title: `Delete ${toDelete.length} Invoice${toDelete.length > 1 ? 's' : ''}?`,
      message: `You are about to permanently delete ${toDelete.length} invoice${toDelete.length > 1 ? 's' : ''}:`,
      itemLabels: toDelete.map(i => `${i.invoiceNumber} — ${i.customerName || ''} — ${i.status}`),
      onConfirm: async () => {
        setConfirmModal(null);
        let failed = 0;
        for (const inv of toDelete) {
          try { await deleteInvoice(inv.id); } catch { failed++; }
        }
        clearSelection();
        await loadInvoices();
        if (failed > 0) showToast(`${failed} deletion(s) failed.`, 'error');
        else showToast(`${toDelete.length} invoice(s) deleted.`, 'success');
      }
    });
  };

  const handleMarkAsPaid = (invoice) => {
    setPaidModal({ invoice, datePaid: new Date().toISOString().split('T')[0], sendPaymentEmail: true });
  };

  const confirmMarkAsPaid = async () => {
    if (!paidModal) return;
    const { invoice, datePaid, sendPaymentEmail } = paidModal;
    setPaidModal(null);
    try {
      const updatedInvoice = {
        ...invoice,
        status: 'Paid',
        datePaid: new Date(datePaid).toISOString()
      };
      await updateInvoice(invoice.id, updatedInvoice);
      if (sendPaymentEmail) {
        try {
          const toEmail = invoice.billingEmail || '';
          const emailResp = await fetch(`${API_BASE}/invoices/${invoice.id}/payment-received-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: toEmail ? JSON.stringify({ email: toEmail }) : null
          });
          if (emailResp.ok) {
            const r = await emailResp.json().catch(() => ({}));
            showToast(`Invoice ${invoice.invoiceNumber} marked as Paid ✓ · Confirmation sent to ${r?.toEmail || toEmail}`, 'success');
          } else {
            showToast(`Invoice ${invoice.invoiceNumber} marked as Paid ✓ (confirmation email failed)`, 'warning');
          }
        } catch {
          showToast(`Invoice ${invoice.invoiceNumber} marked as Paid ✓ (confirmation email could not be sent)`, 'warning');
        }
      } else {
        showToast(`Invoice ${invoice.invoiceNumber} marked as Paid ✓`, 'success');
      }
      await loadInvoices();
    } catch (error) {
      console.error('Error marking invoice as paid:', error);
      showToast('Failed to mark invoice as paid', 'error');
    }
  };

  const handleViewPdf = async (invoiceId, invoiceNumber) => {
    try {
      // Open the PDF in a new window
      const pdfUrl = `${API_BASE}/invoices/${invoiceId}/pdf`;
      window.open(pdfUrl, '_blank');
    } catch (error) {
      console.error('Error viewing PDF:', error);
      showToast('Failed to open PDF', 'error');
    }
  };

  const handleEmailInvoice = (invoice) => {
    setEmailModal({ invoice, email: invoice?.billingEmail || '' });
  };

  const submitEmailInvoice = async () => {
    if (!emailModal) return;
    const { invoice, email } = emailModal;
    setEmailModal(null);
    try {
      const response = await fetch(`${API_BASE}/invoices/${invoice.id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: email ? JSON.stringify({ email }) : null
      });
      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        const toEmail = result?.toEmail || email || invoice?.billingEmail || 'the recipient';
        showToast(`Invoice emailed successfully to ${toEmail}`, 'success');
      } else {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `Failed to send email (HTTP ${response.status})`);
      }
    } catch (error) {
      console.error('Error emailing invoice:', error);
      showToast(`Failed to send invoice email: ${error.message}`, 'error');
    }
  };

  const handleSendReminder = (invoice) => {
    setReminderModal({ invoice });
  };

  const confirmSendReminder = async () => {
    if (!reminderModal) return;
    const { invoice } = reminderModal;
    setReminderModal(null);
    const toEmail = invoice.billingEmail || 'the billing address on file';
    try {
      setProcessing(true);
      const result = await sendInvoiceReminder(invoice.id);
      showToast(`Reminder #${result.reminderCount} sent to ${toEmail}`, 'success');
      await loadInvoices();
    } catch (error) {
      console.error('Error sending reminder:', error);
      showToast(`Failed to send reminder: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
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
      showToast('Invoice must have at least one line item', 'warning');
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

    const selectedCN = selectedCreditNoteId
      ? availableCreditNotes.find(cn => cn.id === selectedCreditNoteId)
      : null;
    // For new invoices: use the selected CN; for editing: use the stored deduction on the invoice
    const creditNoteAmount = selectedCN
      ? parseFloat(selectedCN.amountGross)
      : (editingInvoice?.creditNoteDeduction ? parseFloat(editingInvoice.creditNoteDeduction) : 0);
    const creditNoteNumber = selectedCN?.creditNoteNumber || editingInvoice?.creditNoteNumber || null;
    
    const total = Math.max(0, afterDiscount + vatAmount - creditNoteAmount);
    
    return {
      subtotal: subtotal.toFixed(2),
      discount: discount.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      creditNoteAmount: creditNoteAmount.toFixed(2),
      creditNoteNumber,
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
      const customer = formData.customerId ? customers.find(c => c.id.toString() === formData.customerId.toString()) : null;
      
      // Log due date handling for debugging
      console.log('Form due date:', formData.dueDate);
      console.log('Is new invoice:', !editingInvoice);
      
      const dueDate = (typeof formData.dueDate === 'string' && formData.dueDate.trim() !== '') 
        ? new Date(formData.dueDate).toISOString() 
        : null;
      
      console.log('Due date being sent:', dueDate);
      
      const invoiceData = {
        ...formData,
        customerId: formData.customerId,
        customerName: customer ? customer.customerName : '',
        dateIssued: new Date(formData.dateIssued).toISOString(),
        dueDate: dueDate, // null = auto-calculate from payment terms
        datePaid: formData.datePaid ? new Date(formData.datePaid).toISOString() : null,
        amountNet: parseFloat(totals.subtotal),
        vatAmount: parseFloat(totals.vatAmount),
        amountGross: parseFloat(totals.total),
        discountPercent: parseFloat(formData.discountPercent) || 0,
        discountAmount: parseFloat(formData.discountAmount) || 0,
        taxYear: calculateFinancialYear(new Date(formData.dateIssued)),
        financialYear: `${calculateFinancialYear(new Date(formData.dateIssued))}-${(calculateFinancialYear(new Date(formData.dateIssued)) + 1).toString().slice(2)}`,
        creditNoteId: (!editingInvoice && selectedCreditNoteId) ? selectedCreditNoteId : null,
        creditNoteNumber: (!editingInvoice && selectedCreditNoteId) ? (availableCreditNotes.find(cn => cn.id === selectedCreditNoteId)?.creditNoteNumber || null) : null,
        creditNoteDeduction: (!editingInvoice && selectedCreditNoteId) ? parseFloat(totals.creditNoteAmount) || null : null,
        lineItems: formData.lineItems.map(item => ({
          ...item,
          quantity: parseFloat(item.quantity),
          rate: parseFloat(item.rate),
          vatRate: parseFloat(item.vatRate),
          lineTotal: calculateLineTotal(item)
        }))
      };
      
      if (editingInvoice) {
        await updateInvoice(editingInvoice.id, invoiceData);
      } else {
        const statusToSave = sendOnSave ? 'Issued' : invoiceData.status;
        const created = await createInvoice({ ...invoiceData, status: statusToSave });
        // Apply any selected credit note to this new invoice
        if (selectedCreditNoteId && created?.id) {
          try {
            await applyCreditNote(selectedCreditNoteId, created.id);
          } catch (cnError) {
            console.error('Failed to apply credit note:', cnError);
          }
        }
        if (sendOnSave && created?.id) {
          try {
            const emailResp = await fetch(`${API_BASE}/invoices/${created.id}/email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: invoiceData.billingEmail ? JSON.stringify({ email: invoiceData.billingEmail }) : null
            });
            if (emailResp.ok) {
              const r = await emailResp.json().catch(() => ({}));
              showToast(`Invoice created & emailed to ${r?.toEmail || invoiceData.billingEmail}`, 'success');
            } else {
              showToast('Invoice created, but email failed to send', 'warning');
            }
          } catch {
            showToast('Invoice created, but email could not be sent', 'warning');
          }
        }
      }
      
      setShowForm(false);
      setSendOnSave(false);
      await loadInvoices();
    } catch (error) {
      console.error('Error saving invoice:', error);
      showToast('Failed to save invoice', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const calculateFinancialYear = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    // UK financial year starts April 6
    return month >= 4 ? year : year - 1;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Draft': return '#6c757d';
      case 'Issued': return '#ffc107';
      case 'Paid': return '#28a745';
      case 'Overdue': return '#dc3545';
      default: return '#6c757d';
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Loading invoices...</div>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">{editingInvoice ? 'Updating invoice...' : 'Generating invoice...'}</div>
      </div>
    );
  }

  const totals = showForm ? calculateTotals() : null;

  const handleCancel = () => {
    setShowForm(false);
    setEditingInvoice(null);
    setSendOnSave(false);
    setAvailableCreditNotes([]);
    setSelectedCreditNoteId(null);
  };

  return (
    <>
    <div className="invoices">
      <Toast toast={toast} onClose={clearToast} />
      <div className="page-header">
        <h1>Invoices</h1>
        <button onClick={handleNewInvoice} className="btn-primary">
          + New Invoice
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingInvoice ? 'Edit Invoice' : 'New Invoice'}</h3>
              <button className="btn-close" onClick={() => setShowForm(false)}>✖</button>
            </div>
            <form onSubmit={handleSubmit} className="entity-form">
            <div className="form-row">
              <div className="form-group">
                <label>Invoice Number *</label>
                <input
                  type="text"
                  value={formData.invoiceNumber}
                  onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                  required
                  placeholder="e.g. INV-202602-001"
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
                    // Fetch open (Issued) credit notes for this customer
                    setSelectedCreditNoteId(null);
                    if (e.target.value) {
                      getCreditNotesByCustomer(e.target.value)
                        .then(cns => setAvailableCreditNotes(cns.filter(cn => cn.status === 'Issued')))
                        .catch(() => setAvailableCreditNotes([]));
                    } else {
                      setAvailableCreditNotes([]);
                    }
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
                <label>Billing Email *</label>
                <input
                  type="email"
                  value={formData.billingEmail}
                  onChange={(e) => setFormData({ ...formData, billingEmail: e.target.value })}
                  placeholder="Invoice will be emailed to this address"
                  required
                />
              </div>

              <div className="form-group">
                <label>PO Reference</label>
                <input
                  type="text"
                  value={formData.poReference}
                  onChange={(e) => setFormData({ ...formData, poReference: e.target.value })}
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
                  <option value="Issued">Issued</option>
                  <option value="Paid">Paid</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </div>

              <div className="form-group">
                <label>Date Issued *</label>
                <input
                  type="date"
                  value={formData.dateIssued}
                  onChange={(e) => {
                    const newDateIssued = e.target.value;
                    const newDueDate = calculateDueDate(newDateIssued);
                    setFormData({ 
                      ...formData, 
                      dateIssued: newDateIssued,
                      dueDate: newDueDate 
                    });
                  }}
                  required
                />
              </div>

              <div className="form-group">
                <label>Due Date (leave empty to auto-calculate)</label>
                <input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </div>

              {formData.status === 'Paid' && (
                <div className="form-group">
                  <label>Date Paid</label>
                  <input
                    type="date"
                    value={formData.datePaid || ''}
                    onChange={(e) => setFormData({ ...formData, datePaid: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3>Line Items</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Description</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd', width: '120px' }}>Rate Type</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '80px' }}>Qty</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '100px' }}>Rate (£)</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '80px' }}>VAT %</th>
                    <th style={{ padding: '10px', textAlign: 'right', border: '1px solid #ddd', width: '100px' }}>Total (£)</th>
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
                  type="text"
                  inputMode="decimal"
                  value={formData.discountPercent}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setFormData({ ...formData, discountPercent: parseFloat(value) || 0, discountAmount: 0 });
                    }
                  }}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Discount Amount £ (mutually exclusive with %)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.discountAmount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setFormData({ ...formData, discountAmount: parseFloat(value) || 0, discountPercent: 0 });
                    }
                  }}
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
              {totals?.creditNoteNumber && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', color: '#dc2626', fontWeight: 500 }}>
                  <span>🔴 Less: Credit Note {totals.creditNoteNumber}:</span>
                  <span>-£{totals.creditNoteAmount}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '18px', borderTop: '2px solid #dee2e6', paddingTop: '10px' }}>
                <span>Total:</span>
                <span>£{totals?.total}</span>
              </div>
            </div>

            {!editingInvoice && availableCreditNotes.length > 0 && (
              <div style={{ background: selectedCreditNoteId ? '#fef2f2' : '#f9fafb', border: `1px solid ${selectedCreditNoteId ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1rem' }}>🔴</span>
                  <strong style={{ color: '#dc2626', fontSize: '0.9rem' }}>Open Credit {availableCreditNotes.length === 1 ? 'Note' : 'Notes'} Available</strong>
                </div>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: '#6b7280' }}>
                  This customer has {availableCreditNotes.length === 1 ? 'an unapplied credit note' : `${availableCreditNotes.length} unapplied credit notes`}. Select one to deduct it from this invoice.
                </p>
                <select
                  value={selectedCreditNoteId || ''}
                  onChange={e => setSelectedCreditNoteId(e.target.value ? parseInt(e.target.value) : null)}
                  style={{ width: '100%', padding: '8px', border: `1px solid ${selectedCreditNoteId ? '#f87171' : '#d1d5db'}`, borderRadius: 4, fontSize: '0.875rem' }}
                >
                  <option value=''>— Do not apply a credit note —</option>
                  {availableCreditNotes.map(cn => (
                    <option key={cn.id} value={cn.id}>
                      {cn.creditNoteNumber} · £{parseFloat(cn.amountGross).toFixed(2)}{cn.reason ? ` · ${cn.reason}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!editingInvoice && (
              <div style={{ display:'flex', alignItems:'flex-start', gap:'0.625rem', marginBottom:'1rem',
                padding:'0.75rem 1rem', background: sendOnSave ? '#eff6ff' : '#f9fafb',
                borderRadius:8, border:`1px solid ${sendOnSave ? '#bfdbfe' : '#e5e7eb'}`,
                transition:'all 0.15s' }}>
                <input
                  type="checkbox"
                  id="sendInvoiceOnSave"
                  checked={sendOnSave}
                  onChange={e => {
                    setSendOnSave(e.target.checked);
                    if (e.target.checked) setFormData(f => ({ ...f, status: 'Issued' }));
                  }}
                  style={{ width:16, height:16, marginTop:2, cursor:'pointer', accentColor:'#1565C0', flexShrink:0 }}
                />
                <label htmlFor="sendInvoiceOnSave" style={{ cursor:'pointer', fontSize:'0.875rem',
                  color: sendOnSave ? '#1d4ed8' : '#374151', fontWeight: sendOnSave ? 600 : 400,
                  userSelect:'none', lineHeight:1.5 }}>
                  📧 Email invoice immediately after saving — status will be set to <strong>Issued</strong>
                  {formData.billingEmail && (
                    <span style={{ display:'block', color:'#6b7280', fontWeight:400, marginTop:2 }}>
                      To: {formData.billingEmail}
                      {companySettings?.invoicesEmail && (
                        <span style={{ marginLeft:10 }}>· BCC: {companySettings.invoicesEmail}</span>
                      )}
                    </span>
                  )}
                </label>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingInvoice ? 'Update Invoice' : (sendOnSave ? 'Create & Send Invoice' : 'Create Invoice')}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
          </div>
        </div>
      )}

      <div className="invoices-list">
          {/* Bulk action bar */}
          {allowDataDeletion && selectedIds.size > 0 && (
              <div style={{ background: '#fdf2f2', border: '1px solid #f5c2c7', borderRadius: 6, padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: '#dc3545' }}>{selectedIds.size} invoice{selectedIds.size > 1 ? 's' : ''} selected</span>
                  <button onClick={clearSelection} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.2rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>✕ Clear</button>
                  <button onClick={handleBulkDeleteInvoices} style={{ background: '#dc3545', color: '#fff', border: 'none', borderRadius: 4, padding: '0.25rem 0.9rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>🗑️ Delete Selected</button>
              </div>
          )}
          {isMobile ? (
              <div className="mobile-cards">
                  {allowDataDeletion && (
                      <div className="mobile-select-bar">
                          <span>{selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Tap ☑ to select'}</span>
                          {selectedIds.size < invoices.length
                              ? <button onClick={selectAllInvoices}>Select All</button>
                              : <button onClick={clearSelection}>✕ Clear</button>
                          }
                      </div>
                  )}
                  {invoices.length === 0 ? (
                      <div className="mobile-empty">No invoices yet.<br />Tap <strong>+ New Invoice</strong> to create one.</div>
                  ) : invoices.map(invoice => (
                      <div key={invoice.id} className="mobile-card" style={{ background: selectedIds.has(invoice.id) ? 'rgba(220,53,69,0.04)' : undefined }}>
                          <div className="card-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  {allowDataDeletion && (
                                      <input type="checkbox" data-bwignore="true" autoComplete="off"
                                          checked={selectedIds.has(invoice.id)}
                                          onChange={() => toggleSelectId(invoice.id)}
                                          onClick={e => e.stopPropagation()}
                                          style={{ cursor: 'pointer', width: 16, height: 16 }}
                                      />
                                  )}
                                  <span className="card-id">{invoice.invoiceNumber}</span>
                              </div>
                              <strong className="card-amount">
                                £{invoice.amountGross?.toFixed(2) || '0.00'}
                                {invoice.creditNoteDeduction > 0 && (
                                  <span title={`Credit note ${invoice.creditNoteNumber} applied`}
                                    style={{ marginLeft: 4, fontSize: '0.65rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 4px', fontWeight: 600 }}>
                                    🔴 CN
                                  </span>
                                )}
                              </strong>
                          </div>
                          <div className="card-body">
                              <div className="card-main-row">
                                  <span>{invoice.customerName}</span>
                                  <span className={`status-badge status-${invoice.status?.toLowerCase()}`}>{invoice.status}</span>
                              </div>
                              <div className="card-meta-row">
                                  <span>{invoice.dateIssued ? new Date(invoice.dateIssued).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
                                  {invoice.dueDate && <span>Due: {new Date(invoice.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                                  {invoice.status !== 'Paid' && invoice.status !== 'Draft' && invoice.dueDate && new Date(invoice.dueDate) < new Date() && (
                                      <span className="badge badge-red">{Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000)}d overdue</span>
                                  )}
                              </div>
                          </div>
                          <div className="card-actions" onClick={e => e.stopPropagation()}>
                              <button onClick={() => handleViewPdf(invoice.id, invoice.invoiceNumber)} className="card-action-btn">📄 PDF</button>
                              <button onClick={() => handleEmailInvoice(invoice)} className="card-action-btn">📧 Email</button>
                              {invoice.status !== 'Paid' && (
                                  <button onClick={() => handleMarkAsPaid(invoice)} className="card-action-btn">💰 Paid</button>
                              )}
                              <button onClick={() => handleEditInvoice(invoice)} className="card-action-btn">✏️ Edit</button>
                              {allowDataDeletion && (
                                  <button onClick={() => handleDeleteInvoice(invoice.id)} className="card-action-btn">🗑️</button>
                              )}
                          </div>
                      </div>
                  ))}
              </div>
          ) : (
          invoices.length === 0 ? (
            <p>No invoices found. Create your first invoice to get started.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  {allowDataDeletion && (
                      <th style={{ width: 40, textAlign: 'center' }}>
                          <input type="checkbox" data-bwignore="true" autoComplete="off" title="Select All"
                              onChange={e => e.target.checked ? selectAllInvoices() : clearSelection()}
                              checked={selectedIds.size > 0 && invoices.every(i => selectedIds.has(i.id))}
                          />
                      </th>
                  )}
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Date Issued</th>
                  <th>Due Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id} style={{ background: selectedIds.has(invoice.id) ? 'rgba(220,53,69,0.05)' : undefined }}>
                    {allowDataDeletion && (
                        <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                            <input type="checkbox" data-bwignore="true" autoComplete="off" checked={selectedIds.has(invoice.id)} onChange={() => toggleSelectId(invoice.id)} />
                        </td>
                    )}
                    <td><strong>{invoice.invoiceNumber}</strong></td>
                    <td>{invoice.customerName}</td>
                    <td>
                      {invoice.dateIssued ? new Date(invoice.dateIssued).toLocaleDateString() : 'N/A'}
                    </td>
                    <td>
                      {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}
                      {invoice.status !== 'Paid' && invoice.status !== 'Draft' && invoice.dueDate && new Date(invoice.dueDate) < new Date() && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '4px', padding: '1px 5px', fontWeight: 600 }}>
                          {Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000)}d overdue
                        </span>
                      )}
                    </td>
                    <td>
                      £{invoice.amountGross?.toFixed(2) || '0.00'}
                      {invoice.creditNoteDeduction > 0 && (
                        <span title={`Credit note ${invoice.creditNoteNumber} applied: -£${invoice.creditNoteDeduction.toFixed(2)}`}
                          style={{ marginLeft: 5, fontSize: '0.7rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 4px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          🔴 CN
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge status-${invoice.status.toLowerCase()}`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleViewPdf(invoice.id, invoice.invoiceNumber)}
                        className="btn-icon"
                        title="View PDF"
                      >
                        📄
                      </button>
                      <button
                        onClick={() => handleEmailInvoice(invoice)}
                        className="btn-icon"
                        title="Email Invoice"
                        style={{marginLeft: '5px'}}
                      >
                        📧
                      </button>
                      {(invoice.status === 'Issued' || invoice.status === 'Overdue') && invoice.dueDate && new Date(invoice.dueDate) < new Date() && (
                        <button
                          onClick={() => handleSendReminder(invoice)}
                          className="btn-icon"
                          title={`Send payment reminder${invoice.reminderCount ? ` (${invoice.reminderCount} sent)` : ''}`}
                          style={{marginLeft: '5px'}}
                          disabled={processing}
                        >
                          🔔
                        </button>
                      )}
                      {invoice.status !== 'Paid' && (
                        <button
                          onClick={() => handleMarkAsPaid(invoice)}
                          className="btn-icon"
                          title="Mark as Paid"
                          style={{marginLeft: '5px'}}
                        >
                          💰
                        </button>
                      )}
                      <button
                        onClick={() => handleEditInvoice(invoice)}
                        className="btn-icon"
                        title="Edit"
                        style={{marginLeft: '5px'}}
                      >
                        ✏️
                      </button>
                      {allowDataDeletion && (
                          <button
                            onClick={() => handleDeleteInvoice(invoice.id)}
                            className="btn-icon"
                            title="Delete"
                            style={{marginLeft: '5px'}}
                          >
                            🗑️
                          </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          )}
        </div>
    </div>

    {/* ── Email Invoice Modal ── */}
    {emailModal && (
      <div
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
        onClick={() => setEmailModal(null)}
      >
        <div
          style={{ background:'#fff', borderRadius:14, maxWidth:460, width:'95%', boxShadow:'0 12px 40px rgba(0,0,0,0.22)', overflow:'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ background:'#1565C0', padding:'18px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <h3 style={{ margin:0, fontSize:'1.05rem', color:'#fff' }}>📧 Send Invoice</h3>
            <button onClick={() => setEmailModal(null)} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:'50%', width:28, height:28, fontSize:16, cursor:'pointer', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
          </div>
          <div style={{ padding:'20px 24px' }}>
            <div style={{ background:'#f8faff', border:'1px solid #dbeafe', borderRadius:8, padding:'12px 14px', marginBottom:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:'0.75rem', color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.04em', fontWeight:600 }}>Invoice</div>
                  <div style={{ fontSize:'1.05rem', fontWeight:700, color:'#1a1a2e' }}>{emailModal.invoice?.invoiceNumber}</div>
                  {emailModal.invoice?.customerName && <div style={{ fontSize:'0.85rem', color:'#6b7280' }}>{emailModal.invoice.customerName}</div>}
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:'1.1rem', fontWeight:700, color:'#1565C0' }}>£{emailModal.invoice?.amountGross?.toFixed(2) || '0.00'}</div>
                  {emailModal.invoice?.dueDate && <div style={{ fontSize:'0.8rem', color:'#6b7280' }}>Due {new Date(emailModal.invoice.dueDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</div>}
                </div>
              </div>
            </div>
            <label style={{ display:'block', fontSize:'0.78rem', fontWeight:600, color:'#374151', marginBottom:'0.375rem', textTransform:'uppercase', letterSpacing:'0.04em' }}>Recipient email</label>
            <input
              type="email"
              value={emailModal.email}
              onChange={e => setEmailModal(m => ({ ...m, email: e.target.value }))}
              placeholder="client@example.com"
              autoFocus
              style={{ width:'100%', padding:'0.625rem 0.75rem', borderRadius:6, border:'1px solid #d1d5db', fontSize:'0.95rem', marginBottom:'0.75rem', boxSizing:'border-box', outline:'none' }}
              onKeyDown={e => { if (e.key === 'Enter' && emailModal.email) submitEmailInvoice(); if (e.key === 'Escape') setEmailModal(null); }}
            />
            {companySettings?.invoicesEmail && (
              <div style={{ fontSize:'0.8rem', color:'#6b7280', marginBottom:'1.25rem', display:'flex', alignItems:'center', gap:6 }}>
                <span>📬</span>
                BCC copy to your invoices mailbox: <strong style={{ color:'#374151' }}>{companySettings.invoicesEmail}</strong>
              </div>
            )}
            <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setEmailModal(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!emailModal.email?.trim()}
                onClick={submitEmailInvoice}
              >
                Send Invoice
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Mark as Paid Modal ── */}
    {paidModal && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
        onClick={() => setPaidModal(null)}>
        <div style={{ background:'#fff', borderRadius:14, maxWidth:420, width:'95%', boxShadow:'0 12px 40px rgba(0,0,0,0.22)', overflow:'hidden' }}
          onClick={e => e.stopPropagation()}>
          <div style={{ background:'#16a34a', padding:'16px 22px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <h3 style={{ margin:0, color:'#fff', fontSize:'1rem' }}>💰 Mark as Paid</h3>
            <button onClick={() => setPaidModal(null)} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:'50%', width:28, height:28, fontSize:16, cursor:'pointer', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
          </div>
          <div style={{ padding:'20px 22px' }}>
            <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'12px 14px', marginBottom:18 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:'1.05rem', color:'#1a1a2e' }}>{paidModal.invoice.invoiceNumber}</div>
                  {paidModal.invoice.customerName && <div style={{ fontSize:'0.85rem', color:'#6b7280' }}>{paidModal.invoice.customerName}</div>}
                </div>
                <div style={{ fontSize:'1.2rem', fontWeight:700, color:'#16a34a' }}>£{paidModal.invoice.amountGross?.toFixed(2) || '0.00'}</div>
              </div>
            </div>
            <label style={{ display:'block', fontSize:'0.78rem', fontWeight:600, color:'#374151', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>Date Received</label>
            <input
              type="date"
              value={paidModal.datePaid}
              onChange={e => setPaidModal(m => ({ ...m, datePaid: e.target.value }))}
              style={{ width:'100%', padding:'0.625rem 0.75rem', borderRadius:6, border:'1px solid #d1d5db', fontSize:'0.95rem', marginBottom:'1rem', boxSizing:'border-box' }}
              autoFocus
            />
            <div style={{ display:'flex', alignItems:'flex-start', gap:'0.625rem', padding:'0.75rem 1rem',
              background: paidModal.sendPaymentEmail ? '#f0fdf4' : '#f9fafb',
              borderRadius:8, border:`1px solid ${paidModal.sendPaymentEmail ? '#bbf7d0' : '#e5e7eb'}`,
              marginBottom:'1.25rem', transition:'all 0.15s', cursor:'pointer' }}
              onClick={() => setPaidModal(m => ({ ...m, sendPaymentEmail: !m.sendPaymentEmail }))}>
              <input
                type="checkbox"
                id="sendPaymentEmailChk"
                checked={paidModal.sendPaymentEmail}
                onChange={e => { e.stopPropagation(); setPaidModal(m => ({ ...m, sendPaymentEmail: e.target.checked })); }}
                style={{ width:16, height:16, marginTop:2, cursor:'pointer', accentColor:'#16a34a', flexShrink:0 }}
              />
              <label htmlFor="sendPaymentEmailChk" style={{ cursor:'pointer', fontSize:'0.875rem',
                color: paidModal.sendPaymentEmail ? '#15803d' : '#374151',
                fontWeight: paidModal.sendPaymentEmail ? 600 : 400, userSelect:'none', lineHeight:1.5 }}>
                📧 Send payment confirmation to customer
                {paidModal.invoice.billingEmail && (
                  <span style={{ display:'block', color:'#6b7280', fontWeight:400, marginTop:1, fontSize:'0.8rem' }}>
                    To: {paidModal.invoice.billingEmail}
                    {companySettings?.invoicesEmail && (
                      <span style={{ marginLeft:8 }}>· BCC: {companySettings.invoicesEmail}</span>
                    )}
                  </span>
                )}
              </label>
            </div>
            <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
              <button className="btn-secondary" onClick={() => setPaidModal(null)}>Cancel</button>
              <button onClick={confirmMarkAsPaid}
                style={{ background:'#16a34a', color:'#fff', border:'none', borderRadius:6, padding:'0.5rem 1.25rem', fontWeight:600, fontSize:'0.9rem', cursor:'pointer' }}>
                ✓ Mark as Paid
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Send Reminder Modal ── */}
    {reminderModal && (() => {
      const inv = reminderModal.invoice;
      const daysOverdue = inv.dueDate ? Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000) : 0;
      const reminderNum = (inv.reminderCount || 0) + 1;
      const toEmail = inv.billingEmail || 'billing address on file';
      return (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setReminderModal(null)}>
          <div style={{ background:'#fff', borderRadius:14, maxWidth:420, width:'95%', boxShadow:'0 12px 40px rgba(0,0,0,0.22)', overflow:'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background:'#d97706', padding:'16px 22px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ margin:0, color:'#fff', fontSize:'1rem' }}>🔔 Send Payment Reminder</h3>
              <button onClick={() => setReminderModal(null)} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:'50%', width:28, height:28, fontSize:16, cursor:'pointer', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
            </div>
            <div style={{ padding:'20px 22px' }}>
              <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'12px 14px', marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:'1.05rem', color:'#1a1a2e' }}>{inv.invoiceNumber}</div>
                    {inv.customerName && <div style={{ fontSize:'0.85rem', color:'#6b7280' }}>{inv.customerName}</div>}
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:'1.1rem', fontWeight:700, color:'#b45309' }}>£{inv.amountGross?.toFixed(2) || '0.00'}</div>
                    {daysOverdue > 0 && <span style={{ background:'#fef2f2', color:'#b91c1c', border:'1px solid #fca5a5', borderRadius:4, padding:'1px 6px', fontSize:'0.75rem', fontWeight:600 }}>{daysOverdue}d overdue</span>}
                  </div>
                </div>
              </div>
              <div style={{ fontSize:'0.9rem', color:'#374151', marginBottom:6 }}>
                Reminder <strong>#{reminderNum}</strong> will be sent to:
              </div>
              <div style={{ fontSize:'0.95rem', fontWeight:600, color:'#1565C0', marginBottom:'1.25rem', padding:'0.5rem 0.75rem', background:'#eff6ff', borderRadius:6 }}>
                📧 {toEmail}
              </div>
              {inv.reminderCount > 0 && (
                <div style={{ fontSize:'0.8rem', color:'#9ca3af', marginBottom:'1rem' }}>
                  {inv.reminderCount} reminder{inv.reminderCount > 1 ? 's' : ''} previously sent
                </div>
              )}
              <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                <button className="btn-secondary" onClick={() => setReminderModal(null)}>Cancel</button>
                <button onClick={confirmSendReminder}
                  style={{ background:'#d97706', color:'#fff', border:'none', borderRadius:6, padding:'0.5rem 1.25rem', fontWeight:600, fontSize:'0.9rem', cursor:'pointer' }}>
                  Send Reminder
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    })()}
    <ConfirmDeleteModal
        isOpen={!!confirmModal}
        title={confirmModal?.title}
        message={confirmModal?.message}
        itemLabels={confirmModal?.itemLabels || []}
        onConfirm={confirmModal?.onConfirm}
        onCancel={() => setConfirmModal(null)}
    />
    </>
  );
}

