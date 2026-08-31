import React, { useState, useEffect, useRef } from 'react';
import { getExpenses, createExpense, updateExpense, deleteExpense, getCategories, getVATApplicabilities, getPaymentMethods, getSuppliers, uploadReceipt, deleteAttachment, getCompanySettings, getExpenseAttachments, analyzeInvoice, getAuthHeaders, getTrivialBenefitSummary, getMissingReceiptDeclaration, createMissingReceiptDeclaration, finaliseMissingReceiptDeclaration, voidMissingReceiptDeclaration, getExpenseAuditEvents, getDeclarationPdfUrl, patchExpenseNoReceiptReason } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import TrivialBenefitModal from './TrivialBenefitModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

const Expenses = ({ openNew }) => {
    const [expenses, setExpenses] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [vatApplicabilities, setVatApplicabilities] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [companySettings, setCompanySettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const { toast, showToast, clearToast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [editingExpense, setEditingExpense] = useState(null);

    // Auto-open new entry form if launched from Dashboard quick-add
    useEffect(() => { if (openNew) setShowForm(true); }, [openNew]);
    const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
    const [filteredSuppliers, setFilteredSuppliers] = useState([]);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploadingReceipt, setUploadingReceipt] = useState(false);
    const [existingAttachments, setExistingAttachments] = useState([]);
    const [isMobile, setIsMobile] = useState(false);
    const [captureScanning, setCaptureScanning] = useState(false);
    const [captureScanToast, setCaptureScanToast] = useState(null); // 'success' | 'noOcr' | 'error'
    const [captureDragOver, setCaptureDragOver] = useState(false);
    const [formDragOver, setFormDragOver] = useState(false);
    const [viewExpense, setViewExpense] = useState(null); // expense detail modal
    const [viewAttachments, setViewAttachments] = useState([]);
    const [viewAttachmentsLoading, setViewAttachmentsLoading] = useState(false);
    const [noReceiptInfoModal, setNoReceiptInfoModal] = useState(null); // { expense } | null
    const [directors, setDirectors] = useState([]);
    const [showTrivialBenefit, setShowTrivialBenefit] = useState(false);
    const [trivialSummary, setTrivialSummary] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [confirmModal, setConfirmModal] = useState(null);
    const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'company' | 'employee'
    // Missing Receipt Declaration
    const [declarationModal, setDeclarationModal] = useState(null); // { expenseId, expense } | null
    const [declarationForm, setDeclarationForm] = useState({});
    const [declarationSaving, setDeclarationSaving] = useState(false);
    const [declarationStep, setDeclarationStep] = useState('form'); // 'form' | 'preview' | 'done'
    // No-receipt required flow
    const [receiptRequiredModal, setReceiptRequiredModal] = useState(null); // { savedId, savedEntry } | null
    const [noReceiptReasonValue, setNoReceiptReasonValue] = useState('');
    const [noReceiptReasonOther, setNoReceiptReasonOther] = useState('');
    const [savingNoReceiptReason, setSavingNoReceiptReason] = useState(false);
    const captureInputRef = useRef(null);
    const formFileRef = useRef(null);

    const API_BASE = 'https://financehub-func-kemponline.azurewebsites.net/api';

    const [formData, setFormData] = useState({
        supplier: '',
        reference: '',
        category: '',
        ctTag: '',
        vatApplicability: 'Standard',
        vatIncluded: true,
        amountNet: '',
        vatAmount: '',
        amountGross: '',
        datePaid: new Date().toISOString().split('T')[0],
        paymentMethod: '',
        notes: '',
        taxYear: '',
        financialYear: '',
        isDLA: false,
        dlaDirector: '',
        isRecurring: false,
        recurringFrequency: '',
        recurringNextDate: ''
    });

    useEffect(() => {
        loadData();
        
        // Detect mobile device
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [expensesData, suppliersData, categoriesData, vatApplicabilitiesData, paymentMethodsData, settingsData] = await Promise.all([
                getExpenses().catch(err => { console.error('Error loading expenses:', err); return []; }),
                getSuppliers().catch(err => { console.error('Error loading suppliers:', err); return []; }),
                getCategories().catch(err => { console.error('Error loading categories:', err); return []; }),
                getVATApplicabilities().catch(err => { console.error('Error loading VAT applicabilities:', err); return []; }),
                getPaymentMethods().catch(err => { console.error('Error loading payment methods:', err); return []; }),
                getCompanySettings().catch(err => { console.error('Error loading settings:', err); return null; })
            ]);
            
            console.log('Expenses loaded:', expensesData);
            console.log('First expense data:', expensesData?.[0]);
            console.log('First expense supplier field:', expensesData?.[0]?.supplier);
            console.log('First expense supplierFreeText field:', expensesData?.[0]?.supplierFreeText);
            console.log('Categories loaded:', categoriesData);
            console.log('VAT Applicabilities loaded:', vatApplicabilitiesData);
            console.log('Payment Methods loaded:', paymentMethodsData);
            setExpenses(Array.isArray(expensesData) ? expensesData : []);
            setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
            setCategories(Array.isArray(categoriesData) ? categoriesData : []);
            setVatApplicabilities(Array.isArray(vatApplicabilitiesData) ? vatApplicabilitiesData : []);
            setPaymentMethods(Array.isArray(paymentMethodsData) ? paymentMethodsData : []);
            setCompanySettings(settingsData);
            if (settingsData?.directors) {
                setDirectors(settingsData.directors.split(',').map(d => d.trim()).filter(Boolean));
            }
            // Fetch trivial benefit summary for current tax year
            try {
                const today = new Date();
                const yr = today.getFullYear();
                const mo = today.getMonth() + 1;
                const dy = today.getDate();
                const taxYear = (mo > 4 || (mo === 4 && dy >= 6))
                    ? `${yr}/${String(yr + 1).slice(2)}`
                    : `${yr - 1}/${String(yr).slice(2)}`;
                const summary = await getTrivialBenefitSummary(taxYear);
                setTrivialSummary(summary);
            } catch (_) { /* non-critical */ }
        } catch (error) {
            console.error('Error loading data:', error);
            setExpenses([]);
            setSuppliers([]);
            setCategories([]);
            setVatApplicabilities([]);
            setPaymentMethods([]);
        } finally {
            setLoading(false);
        }
    };

    const calculateTaxYear = (date) => {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = d.getMonth();
        const day = d.getDate();
        
        // UK tax year starts April 6
        if (month < 3 || (month === 3 && day < 6)) {
            return `${year - 1}/${year.toString().slice(2)}`;
        }
        return `${year}/${(year + 1).toString().slice(2)}`;
    };

    const calculateFinancialYear = (date) => {
        console.log('calculateFinancialYear called with date:', date);
        console.log('Company settings:', companySettings);
        console.log('FY Start Month:', companySettings?.fyStartMonth, 'FY Start Day:', companySettings?.fyStartDay);
        console.log('Company Inception Date:', companySettings?.companyInceptionDate);
        
        // Use FY start month/day if set, otherwise fall back to inception date
        let fyMonth = companySettings?.fyStartMonth;
        let fyDay = companySettings?.fyStartDay;
        
        if (!fyMonth || !fyDay) {
            // If FY not set, use company inception date
            if (companySettings?.companyInceptionDate) {
                const inceptionDate = new Date(companySettings.companyInceptionDate);
                fyMonth = inceptionDate.getMonth() + 1;
                fyDay = inceptionDate.getDate();
                console.log('Using inception date for FY:', fyMonth, '/', fyDay);
            } else {
                console.log('No FY settings or inception date, using tax year calculation');
                return calculateTaxYear(date);
            }
        }
        
        const d = new Date(date);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const day = d.getDate();
        
        console.log('Date parts - Year:', year, 'Month:', month, 'Day:', day);
        console.log('FY starts on:', fyMonth, '/', fyDay);
        console.log('Comparison: month', month, '<', fyMonth, '?', month < fyMonth);
        console.log('Or: month', month, '==', fyMonth, '&& day', day, '<', fyDay, '?', (month === fyMonth && day < fyDay));
        
        if (month < fyMonth || (month === fyMonth && day < fyDay)) {
            const result = `${year - 1}/${year.toString().slice(2)}`;
            console.log('Before FY start, returning:', result);
            return result;
        }
        const result = `${year}/${(year + 1).toString().slice(2)}`;
        console.log('After FY start, returning:', result);
        return result;
    };

    const normalizeDateForApi = (value) => {
        if (!value) return '';

        // Already ISO date-only
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return value;
        }

        // Accept UK-style dates from OCR/manual entry: d/m/yyyy or dd/mm/yyyy
        const ukMatch = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (ukMatch) {
            const day = ukMatch[1].padStart(2, '0');
            const month = ukMatch[2].padStart(2, '0');
            const year = ukMatch[3];
            return `${year}-${month}-${day}`;
        }

        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }

        return String(value);
    };

    const sameDay = (a, b) => {
        if (!a || !b) return false;
        return normalizeDateForApi(a) === normalizeDateForApi(b);
    };

    const resolveCreatedExpenseId = async (expenseData) => {
        try {
            const list = await getExpenses({ companyOnly: true });
            const supplier = (expenseData.supplier || '').trim().toLowerCase();
            const reference = (expenseData.reference || '').trim().toLowerCase();
            const category = (expenseData.category || '').trim().toLowerCase();
            const amountGross = Number(expenseData.amountGross || 0);

            const candidates = (Array.isArray(list) ? list : []).filter(e => {
                const eSupplier = (e.supplier || '').trim().toLowerCase();
                const eReference = (e.reference || '').trim().toLowerCase();
                const eCategory = (e.category || '').trim().toLowerCase();
                const eGross = Number(e.amountGross || 0);
                const eDate = e.datePaid || e.entryDate;
                return eSupplier === supplier
                    && eReference === reference
                    && eCategory === category
                    && sameDay(eDate, expenseData.datePaid)
                    && Math.abs(eGross - amountGross) < 0.01;
            });

            if (candidates.length === 0) return null;

            // Prefer highest numeric ID; fallback to newest date if IDs are non-numeric.
            const best = candidates.sort((a, b) => {
                const aId = Number(a.id);
                const bId = Number(b.id);
                if (!Number.isNaN(aId) && !Number.isNaN(bId)) return bId - aId;
                const aTime = new Date(a.entryDate || a.datePaid || 0).getTime();
                const bTime = new Date(b.entryDate || b.datePaid || 0).getTime();
                return bTime - aTime;
            })[0];

            return best?.id ?? best?.Id ?? null;
        } catch (_) {
            return null;
        }
    };

    const getVATRate = (vatApplicability) => {
        // Determine VAT rate based on applicability
        switch (vatApplicability) {
            case 'Standard':
                return 20;
            case 'Reduced':
                return 5;
            case 'Zero-rated':
            case 'Exempt':
            case 'Outside Scope':
                return 0;
            default:
                return 20;
        }
    };

    const calculateVAT = (isGross, value, vatApplicability) => {
        const amount = parseFloat(value) || 0;
        const rate = getVATRate(vatApplicability);
        
        if (isGross) {
            // Calculate from gross amount
            const vatAmount = (amount * rate) / (100 + rate);
            const netAmount = amount - vatAmount;
            return {
                amountGross: amount.toFixed(2),
                vatAmount: vatAmount.toFixed(2),
                amountNet: netAmount.toFixed(2)
            };
        } else {
            // Calculate from net amount
            const vatAmount = (amount * rate) / 100;
            const grossAmount = amount + vatAmount;
            return {
                amountNet: amount.toFixed(2),
                vatAmount: vatAmount.toFixed(2),
                amountGross: grossAmount.toFixed(2)
            };
        }
    };

    const handleSupplierInput = (value) => {
        setFormData({ ...formData, supplier: value });
        
        if (value.length > 0) {
            const filtered = suppliers.filter(s => 
                s.name.toLowerCase().includes(value.toLowerCase())
            );
            setFilteredSuppliers(filtered);
            setShowSupplierDropdown(true);
        } else {
            setShowSupplierDropdown(false);
        }
    };

    const selectSupplier = (supplier) => {
        setFormData({
            ...formData,
            supplier: supplier.name
        });
        setShowSupplierDropdown(false);
    };

    const getDefaultCtTag = (category) => {
        if (category === 'Client Entertainment' || category === 'Client Gifts') return 'NonCT';
        return 'Revenue';
    };

    const resetForm = () => {
        setFormData({
            supplier: '',
            reference: '',
            category: '',
            ctTag: '',
            vatApplicability: 'Standard',
            vatIncluded: true,
            amountNet: '',
            vatAmount: '',
            amountGross: '',
            datePaid: new Date().toISOString().split('T')[0],
            paymentMethod: '',
            notes: '',
            taxYear: '',
            financialYear: '',
            isDLA: false,
            dlaDirector: '',
            isRecurring: false,
            recurringFrequency: '',
            recurringNextDate: ''
        });
        setSelectedFiles([]);
        setExistingAttachments([]);
        setShowForm(false);
        setEditingExpense(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const normalizedDatePaid = normalizeDateForApi(formData.datePaid);

        // ── Route isDLA saves straight into the DLA table ──────────────────
        if (formData.isDLA && !editingExpense) {
            if (!formData.dlaDirector) {
                showToast('Please select a director for this DLA entry.', 'error');
                return;
            }
            setProcessingMessage('Saving as DLA entry...');
            setProcessing(true);
            try {
                const description = formData.reference
                    ? `${formData.supplier} — ${formData.reference}`
                    : formData.supplier;
                const dlaPayload = {
                    director: formData.dlaDirector,
                    direction: 'OwedToDirector',
                    description,
                    category: formData.category,
                    ctTag: formData.ctTag || getDefaultCtTag(formData.category),
                    amountNet: parseFloat(formData.amountNet) || 0,
                    vatAmount: parseFloat(formData.vatAmount) || 0,
                    amountGross: parseFloat(formData.amountGross) || 0,
                    entryDate: new Date(normalizedDatePaid).toISOString(),
                    datePaid: null,
                    paymentMethod: formData.paymentMethod,
                    notes: formData.notes,
                    taxYear: calculateTaxYear(normalizedDatePaid),
                    financialYear: calculateFinancialYear(normalizedDatePaid),
                    isStartupCost: false,
                    classificationSource: 'auto'
                };
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/dla`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(dlaPayload)
                });
                if (!res.ok) throw new Error('Failed to create DLA entry');
                const savedDla = await res.json();

                // Upload receipts to the DLA receipt endpoint
                if (selectedFiles.length > 0 && savedDla?.id) {
                    setUploadingReceipt(true);
                    const authOnly = { Authorization: headers.Authorization };
                    for (const file of selectedFiles) {
                        const fd = new FormData();
                        fd.append('file', file);
                        await fetch(`${API_BASE}/dla/${savedDla.id}/upload`, {
                            method: 'POST', headers: authOnly, body: fd
                        }).catch(err => console.error('DLA receipt upload failed:', err));
                    }
                    setUploadingReceipt(false);
                }

                showToast('Saved as DLA entry!', 'success');
                resetForm();
                await loadData();
            } catch (err) {
                console.error('DLA save error:', err);
                showToast('Failed to save DLA entry: ' + err.message, 'error');
            } finally {
                setProcessing(false);
            }
            return;
        }
        // ── Normal expense save ─────────────────────────────────────────────
        setProcessingMessage(editingExpense ? 'Updating expense...' : 'Creating expense...');
        setProcessing(true);
        try {
            const expenseData = {
                ...formData,
                datePaid: normalizedDatePaid,
                amountNet: formData.amountNet ? parseFloat(formData.amountNet) : null,
                vatAmount: formData.vatAmount ? parseFloat(formData.vatAmount) : null,
                amountGross: formData.amountGross ? parseFloat(formData.amountGross) : null,
                taxYear: calculateTaxYear(normalizedDatePaid),
                financialYear: calculateFinancialYear(normalizedDatePaid)
            };

            let expenseId;
            if (editingExpense) {
                await updateExpense(editingExpense.id, expenseData);
                expenseId = editingExpense.id;
            } else {
                const result = await createExpense(expenseData);
                expenseId = result?.id ?? result?.Id ?? result?.expenseId ?? result?.ExpenseId;
                if (!expenseId) {
                    expenseId = await resolveCreatedExpenseId(expenseData);
                }
                if (!expenseId) {
                    throw new Error('Expense was created but no expense ID was returned. Please refresh and try again.');
                }
            }

            // Upload receipts if files selected
            if (selectedFiles.length > 0 && expenseId) {
                setUploadingReceipt(true);
                try {
                    for (const file of selectedFiles) {
                        await uploadReceipt(expenseId, file);
                    }
                } catch (uploadError) {
                    showToast('Expense saved but receipt upload failed: ' + uploadError.message, 'warning');
                }
                setUploadingReceipt(false);
            }

            // Intercept if no receipt and not already handled (declaration or reason on file)
            const hasReceipt = selectedFiles.length > 0 || existingAttachments.length > 0;
            const alreadyHandled = editingExpense?.hasMissingReceiptDeclaration || editingExpense?.noReceiptReason;
            if (!formData.isDLA && !hasReceipt && !alreadyHandled) {
                resetForm();
                setReceiptRequiredModal({
                    savedId: expenseId,
                    savedEntry: { id: expenseId, supplier: formData.supplier || formData.supplierFreeText, reference: formData.reference, amountGross: parseFloat(formData.amountGross) || 0, category: formData.category }
                });
                await loadData();
                return;
            }

            showToast('Expense saved successfully!', 'success');
            resetForm();
            await loadData();
        } catch (error) {
            console.error('Error saving expense:', error);
            showToast('Failed to save expense: ' + error.message, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const handleEdit = (expense) => {
        // Prefer datePaid (the field we write on save). Fall back to entryDate (legacy read field).
        const rawDate = expense.datePaid || expense.entryDate;
        const displayDate = rawDate ? new Date(rawDate).toISOString().split('T')[0] : '';
        setFormData({
            supplier: expense.supplier || '',
            reference: expense.reference || '',
            category: expense.category || '',
            ctTag: expense.ctTag || getDefaultCtTag(expense.category),
            vatApplicability: expense.vatApplicability || 'Standard',
            vatIncluded: expense.vatIncluded !== false,
            amountNet: expense.amountNet || '',
            vatAmount: expense.vatAmount || '',
            amountGross: expense.amountGross || '',
            datePaid: displayDate,
            paymentMethod: expense.paymentMethod || '',
            notes: expense.notes || '',
            taxYear: expense.taxYear || '',
            financialYear: expense.financialYear || '',
            isDLA: expense.isDLA || false,
            dlaDirector: '',
            isRecurring: expense.isRecurring || false,
            recurringFrequency: expense.recurringFrequency || '',
            recurringNextDate: expense.recurringNextDate ? new Date(expense.recurringNextDate).toISOString().split('T')[0] : ''
        });
        setEditingExpense({
            ...expense,
            hasMissingReceiptDeclaration: expense.hasMissingReceiptDeclaration,
            missingReceiptDeclarationRef: expense.missingReceiptDeclarationRef
        });
        setSelectedFiles([]);
        setExistingAttachments(expense.attachments || []);
        setShowForm(true);
    };

    const handleViewReceipts = async (expense) => {
        try {
            const attachments = await getExpenseAttachments(expense.id);
            if (attachments && attachments.length > 0) {
                // Has a real receipt — open it normally
                const apiBase = 'https://financehub-func-kemponline.azurewebsites.net/api';
                const receiptUrl = `${apiBase}/expenses/${expense.id}/receipts/${attachments[0].fileName}`;
                window.open(receiptUrl, '_blank');
            } else if (expense.hasMissingReceiptDeclaration) {
                // No receipt but declaration on file — open declaration PDF
                window.open(getDeclarationPdfUrl(expense.id), '_blank');
            } else if (expense.noReceiptReason) {
                // No receipt, no declaration — show reason modal
                setNoReceiptInfoModal({ expense });
            } else {
                showToast('No receipt or declaration found for this expense.', 'info');
            }
        } catch (error) {
            console.error('Error viewing receipts:', error);
            showToast('Failed to load receipts: ' + error.message, 'error');
        }
    };

    const handleViewExpense = async (expense) => {
        setViewExpense(expense);
        setViewAttachments([]);
        setViewAttachmentsLoading(true);
        try {
            const attachments = await getExpenseAttachments(expense.id);
            setViewAttachments(attachments || []);
        } catch (err) {
            console.warn('Could not load attachments:', err.message);
            setViewAttachments([]);
        } finally {
            setViewAttachmentsLoading(false);
        }
    };

    const handleDownloadPDF = async (expense) => {
        try {
            setProcessing(true);
            const apiBase = 'https://financehub-func-kemponline.azurewebsites.net/api';
            const pdfUrl = `${apiBase}/expenses/${expense.id}/claim-pdf`;
            window.open(pdfUrl, '_blank');
        } catch (error) {
            console.error('Error downloading PDF:', error);
            showToast('Failed to download PDF: ' + error.message, 'error');
        } finally {
            setProcessing(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingExpense(null);
        setExistingAttachments([]);
        setFormData({
            supplier: '',
            reference: '',
            category: '',
            ctTag: '',
            vatApplicability: 'Standard',
            vatIncluded: true,
            amountNet: '',
            vatAmount: '',
            amountGross: '',
            datePaid: new Date().toISOString().split('T')[0],
            paymentMethod: '',
            notes: '',
            taxYear: '',
            financialYear: '',
            isDLA: false,
            dlaDirector: ''
        });
        setSelectedFiles([]);
        setCaptureScanToast(null);
        setShowForm(false);
    };

    // ── Receipt Quick Capture (drag & drop / photo) ───────────────────────────
    const openExpenseCapture = async (file) => {
        // Pre-attach file so it uploads on save
        setSelectedFiles([file]);
        // Reset & open form
        setEditingExpense(null);
        setExistingAttachments([]);
        setFormData({
            supplier: '',
            reference: '',
            category: '',
            ctTag: '',
            vatApplicability: 'Standard',
            vatIncluded: true,
            amountNet: '',
            vatAmount: '',
            amountGross: '',
            datePaid: new Date().toISOString().split('T')[0],
            paymentMethod: '',
            notes: '',
            taxYear: '',
            financialYear: '',
            isDLA: false,
            dlaDirector: ''
        });
        setCaptureScanToast(null);
        setShowForm(true);
        // Run OCR scan
        setCaptureScanning(true);
        try {
            const scan = await analyzeInvoice(file);
            if (!scan.configured) {
                setCaptureScanToast('noOcr');
            } else if (scan.found) {
                // Sum amounts across all lines
                const totalNet   = scan.lines?.reduce((s, l) => s + (l.amountNet   || 0), 0) || 0;
                const totalVat   = scan.lines?.reduce((s, l) => s + (l.vatAmount   || 0), 0) || 0;
                const totalGross = scan.lines?.reduce((s, l) => s + (l.amountGross || 0), 0) || 0;
                setFormData(prev => ({
                    ...prev,
                    supplier:        scan.vendor      || prev.supplier,
                    reference:       scan.invoiceRef  || prev.reference,
                    datePaid:        normalizeDateForApi(scan.invoiceDate) || prev.datePaid,
                    amountNet:       totalNet   > 0 ? totalNet.toFixed(2)   : prev.amountNet,
                    vatAmount:       totalVat   > 0 ? totalVat.toFixed(2)   : prev.vatAmount,
                    amountGross:     totalGross > 0 ? totalGross.toFixed(2) : prev.amountGross,
                    vatApplicability: totalVat  > 0 ? 'Standard' : 'Zero'
                }));
                setCaptureScanToast('success');
            } else {
                setCaptureScanToast('error');
            }
        } catch (err) {
            console.warn('Receipt scan failed:', err.message);
            setCaptureScanToast('error');
        } finally {
            setCaptureScanning(false);
        }
    };

    const allowDataDeletion = companySettings?.allowDataDeletion === true;

    // Apply source filter (company vs employee claims) on top of the existing isDLA exclusion
    const displayExpenses = expenses.filter(e => {
        if (e.isDLA) return false;
        if (sourceFilter === 'company') return !e.submittedByTeamMemberId;
        if (sourceFilter === 'employee') return !!e.submittedByTeamMemberId;
        return true;
    });

    const toggleSelectId = (id) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const selectAllExpenses = () => setSelectedIds(new Set(displayExpenses.map(e => e.id)));
    const clearSelection = () => setSelectedIds(new Set());

    const handleDeleteExpense = (expense) => {
        setConfirmModal({
            title: 'Delete Expense?',
            message: `Are you sure you want to delete the expense from "${expense.supplier}"?`,
            itemLabels: [`${expense.supplier} — £${(expense.amountGross || 0).toFixed(2)} (${expense.entryDate ? new Date(expense.entryDate).toLocaleDateString() : expense.datePaid ? new Date(expense.datePaid).toLocaleDateString() : ''})`],
            onConfirm: async () => {
                setConfirmModal(null);
                setProcessingMessage('Deleting expense...');
                setProcessing(true);
                try {
                    await deleteExpense(expense.id);
                    showToast('Expense deleted.', 'success');
                    await loadData();
                } catch (error) {
                    console.error('Error deleting expense:', error);
                    showToast('Failed to delete expense: ' + error.message, 'error');
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const handleBulkDeleteExpenses = () => {
        const toDelete = expenses.filter(e => !e.isDLA && selectedIds.has(e.id));
        if (toDelete.length === 0) return;
        setConfirmModal({
            title: `Delete ${toDelete.length} Expense${toDelete.length > 1 ? 's' : ''}?`,
            message: `You are about to permanently delete ${toDelete.length} expense${toDelete.length > 1 ? 's' : ''}:`,
            itemLabels: toDelete.map(e => `${e.supplier} — £${(e.amountGross || 0).toFixed(2)}`),
            onConfirm: async () => {
                setConfirmModal(null);
                setProcessing(true);
                setProcessingMessage(`Deleting ${toDelete.length} expenses...`);
                let failed = 0;
                for (const e of toDelete) {
                    try { await deleteExpense(e.id); } catch { failed++; }
                }
                clearSelection();
                await loadData();
                setProcessing(false);
                if (failed > 0) showToast(`${failed} deletion(s) failed.`, 'error');
                else showToast(`${toDelete.length} expense(s) deleted.`, 'success');
            }
        });
    };

    const openDeclarationModal = (expense) => {
        const expenseId = expense?.id ?? expense?.Id;
        if (!expenseId) {
            showToast('Cannot create declaration: missing expense ID. Please refresh and try again.', 'error');
            return;
        }
        setDeclarationForm({
            declarationType: 'MissingReceiptDeclaration',
            declarerName: companySettings?.directorName || '',
            declarerRole: 'Director',
            declarerEmail: companySettings?.companyEmail || '',
            merchantOrPayee: expense.supplier || '',
            bankTransactionRef: expense.reference || '',
            expenseCategory: expense.category || '',
            description: '',
            reasonReceiptMissing: 'NotProvided',
            otherReasonText: '',
            acknowledgementDisallowable: false,
            signatureType: 'TypedName',
            typedSignature: companySettings?.directorName || ''
        });
        setDeclarationStep('form');
        setDeclarationModal({ expenseId, expense: { ...expense, id: expenseId } });
    };

    const handleCreateDeclaration = async () => {
        if (!declarationForm.description?.trim()) {
            showToast('Please enter a description of the expense.', 'error');
            return;
        }
        if (!declarationForm.acknowledgementDisallowable) {
            showToast('You must acknowledge that VAT cannot be reclaimed and CT may be disallowed.', 'error');
            return;
        }
        if (declarationForm.signatureType === 'TypedName' && !declarationForm.typedSignature?.trim()) {
            showToast('Please enter your typed signature.', 'error');
            return;
        }
        setDeclarationSaving(true);
        try {
            const created = await createMissingReceiptDeclaration(declarationModal.expenseId, declarationForm);
            // Auto-finalise since all required fields are present
            await finaliseMissingReceiptDeclaration(declarationModal.expenseId);
            const declaredExpenseId = declarationModal.expenseId;
            setDeclarationModal(null);
            showToast(`✅ Declaration ${created.declarationId} created and finalised. VAT set to zero.`, 'success');
            // Patch viewExpense in-place so the modal reflects the new state immediately
            if (viewExpense?.id === declaredExpenseId) {
                setViewExpense(v => v ? { ...v, hasMissingReceiptDeclaration: true, missingReceiptDeclarationRef: created.declarationId, vatAmount: 0, vatRate: 0 } : v);
            }
            await loadData();
        } catch (err) {
            showToast('Failed to create declaration: ' + err.message, 'error');
        } finally {
            setDeclarationSaving(false);
        }
    };

    const handleVoidDeclaration = async (expense, reason) => {
        try {
            await voidMissingReceiptDeclaration(expense.id, reason);
            showToast('Declaration voided.', 'success');
            await loadData();
        } catch (err) {
            showToast('Failed to void declaration: ' + err.message, 'error');
        }
    };

    const handleReceiptRequiredExpenseDeclaration = () => {
        const { savedEntry } = receiptRequiredModal;
        setReceiptRequiredModal(null);
        setNoReceiptReasonValue('');
        setNoReceiptReasonOther('');
        openDeclarationModal(savedEntry);
    };

    const handleExpenseNoReceiptReasonSave = async () => {
        const finalReason = noReceiptReasonValue === 'Other' ? noReceiptReasonOther.trim() : noReceiptReasonValue;
        if (!finalReason) { showToast('Please select a reason.', 'error'); return; }
        setSavingNoReceiptReason(true);
        try {
            await patchExpenseNoReceiptReason(receiptRequiredModal.savedId, finalReason);
            showToast('Expense saved.', 'success');
            setReceiptRequiredModal(null);
            setNoReceiptReasonValue('');
            setNoReceiptReasonOther('');
            await loadData();
        } catch (err) {
            showToast('Failed to save reason: ' + err.message, 'error');
        } finally {
            setSavingNoReceiptReason(false);
        }
    };

    const handleAmountChange = (field, value) => {
        // Update the field being edited immediately without formatting
        setFormData({
            ...formData,
            [field]: value
        });
    };

    const handleAmountBlur = (field) => {
        // Only calculate and format when user finishes editing (onBlur)
        const value = formData[field];
        if (value === '' || value === '.' || isNaN(parseFloat(value))) {
            return;
        }
        
        const isGross = field === 'amountGross';
        const calculated = calculateVAT(isGross, value, formData.vatApplicability);
        setFormData({
            ...formData,
            ...calculated
        });
    };

    if (processing) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">{processingMessage || 'Please wait...'}</div>
        </div>
    );

    if (loading) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading expenses...</div>
        </div>
    );

    const exportToCsv = () => {
        const headers = ['ID','Date','Supplier','Reference','Category','CT Tag','VAT Treatment','Payment Method','Net','VAT','Gross','Tax Year','Financial Year','Notes'];
        const csvRows = expenses.map(e => [
            e.expenseId || e.id,
            e.entryDate ? new Date(e.entryDate).toLocaleDateString('en-GB') : e.datePaid ? new Date(e.datePaid).toLocaleDateString('en-GB') : '',
            `"${(e.supplier||'').replace(/"/g,'""')}"`,
            `"${(e.reference||'').replace(/"/g,'""')}"`,
            `"${(e.category||'').replace(/"/g,'""')}"`,
            e.ctTag||'',
            e.vatApplicability||'',
            e.paymentMethod||'',
            (e.amountNet||0).toFixed(2),
            (e.vatAmount||0).toFixed(2),
            (e.amountGross||0).toFixed(2),
            e.taxYear||'',
            e.financialYear||'',
            `"${(e.notes||'').replace(/"/g,'""')}"`
        ].join(','));
        const csv = [headers.join(','), ...csvRows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expenses-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="expenses-container">
            <Toast toast={toast} onClose={clearToast} />
            {/* Hidden file input for capture button & drop zone */}
            <input
                ref={captureInputRef}
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) openExpenseCapture(f); e.target.value = ''; }}
            />

            <div className="page-header">
                <h1>Expenses</h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={exportToCsv}
                        className="btn-secondary"
                        title="Export all expenses to CSV"
                    >
                        ⬇️ Export CSV
                    </button>
                    <button
                        onClick={() => captureInputRef.current?.click()}
                        style={{ background: '#0d6efd', border: 'none', borderRadius: 6, color: '#fff', padding: '7px 14px', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600 }}
                        title="Scan a receipt or take a photo to auto-fill the form"
                    >
                        📸 Scan Receipt
                    </button>
                    <button
                        className="btn-secondary"
                        onClick={() => setShowTrivialBenefit(true)}
                        title="Record an HMRC s.323 Trivial Benefit (max £50, max 6/year)"
                        style={{ opacity: trivialSummary?.isAtLimit ? 0.5 : 1 }}
                    >
                        🎁 Trivial Benefit
                        {trivialSummary && (
                            <span style={{ marginLeft: '0.4rem', fontSize: '0.78rem', opacity: 0.8 }}>
                                ({trivialSummary.count}/{trivialSummary.limit})
                            </span>
                        )}
                    </button>
                    <button onClick={() => { setCaptureScanToast(null); setShowForm(true); }} className="btn-primary">
                        + Add Expense
                    </button>
                </div>
            </div>

            {/* Drag-and-drop zone */}
            <div
                onDragOver={e => { e.preventDefault(); setCaptureDragOver(true); }}
                onDragLeave={() => setCaptureDragOver(false)}
                onDrop={e => { e.preventDefault(); setCaptureDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) openExpenseCapture(f); }}
                onClick={() => captureInputRef.current?.click()}
                style={{
                    border: `2px dashed ${captureDragOver ? '#0d6efd' : '#ced4da'}`,
                    borderRadius: 8,
                    padding: '14px 20px',
                    textAlign: 'center',
                    marginBottom: 16,
                    cursor: 'pointer',
                    background: captureDragOver ? 'rgba(13,110,253,0.05)' : '#f8f9fa',
                    color: captureDragOver ? '#0d6efd' : '#6c757d',
                    fontSize: '0.9rem',
                    transition: 'all 0.15s',
                    userSelect: 'none'
                }}
            >
                {isMobile
                    ? '📸 Tap here to take a photo or choose a receipt — fields will be filled automatically'
                    : '📎 Drag & drop a receipt (PDF or image) here to auto-fill the form, or click to browse'}
            </div>

            {showForm && (
                <div className="modal-overlay" onClick={() => !processing && setShowForm(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingExpense ? 'Edit Expense' : 'New Expense'}</h3>
                            <button className="btn-close" onClick={() => !processing && setShowForm(false)} disabled={processing}>✖</button>
                        </div>
                        {editingExpense && (
                            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '4px', border: '1px solid #ddd' }}>
                                <strong>Expense ID:</strong> <span style={{ fontSize: '1.1em', color: '#333' }}>{editingExpense.expenseId}</span>
                            </div>
                        )}
                        {/* OCR scan status */}
                        {captureScanning && (
                            <div style={{ background: '#e8f4fd', borderBottom: '1px solid #bee5eb', padding: '8px 16px', fontSize: '0.88rem', color: '#0c5460', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #0c5460', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                🔍 Scanning receipt with Azure AI…
                            </div>
                        )}
                        {!captureScanning && captureScanToast === 'success' && (
                            <div style={{ background: '#d4edda', borderBottom: '1px solid #c3e6cb', padding: '8px 16px', fontSize: '0.88rem', color: '#155724' }}>
                                ✅ Receipt scanned — fields pre-filled. Please check and correct before saving.
                            </div>
                        )}
                        {!captureScanning && captureScanToast === 'noOcr' && (
                            <div style={{ background: '#fff3cd', borderBottom: '1px solid #ffc107', padding: '8px 16px', fontSize: '0.88rem', color: '#856404' }}>
                                ⚠️ OCR not configured. Add <strong>DocumentIntelligenceEndpoint</strong> &amp; <strong>DocumentIntelligenceKey</strong> to Function App settings to enable auto-scanning.
                            </div>
                        )}
                        {!captureScanning && captureScanToast === 'error' && (
                            <div style={{ background: '#f8d7da', borderBottom: '1px solid #f5c6cb', padding: '8px 16px', fontSize: '0.88rem', color: '#721c24' }}>
                                ⚠️ Could not extract details — please fill in the fields manually.
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="entity-form">
                        <div className="form-group" style={{ position: 'relative' }}>
                            <label>Supplier *</label>
                            <input
                                type="text"
                                value={formData.supplier}
                                onChange={(e) => handleSupplierInput(e.target.value)}
                                required
                                placeholder="Type to search suppliers..."
                            />
                            {showSupplierDropdown && filteredSuppliers.length > 0 && (
                                <ul className="dropdown-list">
                                    {filteredSuppliers.map(supplier => (
                                        <li 
                                            key={supplier.id} 
                                            onClick={() => selectSupplier(supplier)}
                                            className="dropdown-item"
                                        >
                                            {supplier.name}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="form-group">
                            <label>Reference</label>
                            <input
                                type="text"
                                value={formData.reference}
                                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                            />
                        </div>

                        <div className="form-group">
                            <label>Category *</label>
                            <select
                                value={formData.category}
                                onChange={(e) => {
                                    const cat = e.target.value;
                                    setFormData(prev => ({
                                        ...prev,
                                        category: cat,
                                        ctTag: prev.ctTag || getDefaultCtTag(cat)
                                    }));
                                }}
                                required
                            >
                                <option value="">Select Category</option>
                                {Array.isArray(categories) && categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label>CT Treatment</label>
                            <select
                                value={formData.ctTag || getDefaultCtTag(formData.category)}
                                onChange={(e) => setFormData({ ...formData, ctTag: e.target.value })}
                            >
                                <option value="Revenue">✅ Revenue (CT allowable)</option>
                                <option value="Capital">🏗️ Capital (allowable via CA)</option>
                                <option value="NonCT">🚫 Non-CT (disallowed)</option>
                            </select>
                            {(formData.ctTag || getDefaultCtTag(formData.category)) === 'NonCT' && (
                                <p style={{ color: '#dc3545', fontSize: '0.82rem', marginTop: '4px', marginBottom: 0 }}>
                                    ⚠️ This expense will not reduce your Corporation Tax liability.
                                </p>
                            )}
                        </div>

                        <div className="form-group">
                            <label>VAT Applicability *</label>
                            <select
                                value={formData.vatApplicability}
                                    onChange={(e) => {
                                        const newVatApplicability = e.target.value;
                                        setFormData({ ...formData, vatApplicability: newVatApplicability });
                                        // Recalculate VAT with new applicability
                                        if (formData.amountGross && parseFloat(formData.amountGross) > 0) {
                                            const calculated = calculateVAT(true, formData.amountGross, newVatApplicability);
                                            setFormData(prev => ({
                                                ...prev,
                                                vatApplicability: newVatApplicability,
                                                amountNet: calculated.amountNet,
                                                vatAmount: calculated.vatAmount,
                                                amountGross: calculated.amountGross
                                            }));
                                        } else if (formData.amountNet && parseFloat(formData.amountNet) > 0) {
                                            const calculated = calculateVAT(false, formData.amountNet, newVatApplicability);
                                            setFormData(prev => ({
                                                ...prev,
                                                vatApplicability: newVatApplicability,
                                                amountNet: calculated.amountNet,
                                                vatAmount: calculated.vatAmount,
                                                amountGross: calculated.amountGross
                                            }));
                                        }
                                    }}
                                >
                                    <option value="">Select VAT Applicability</option>
                                {Array.isArray(vatApplicabilities) && vatApplicabilities.map(vat => (
                                    <option key={vat} value={vat}>{vat}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                            <div className="form-group">
                                <label>Amount (Pre-VAT)</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9]*\.?[0-9]*"
                                    value={formData.amountNet}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        // Allow only numbers and decimal point
                                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                            handleAmountChange('amountNet', value);
                                        }
                                    }}
                                    onBlur={() => handleAmountBlur('amountNet')}
                                    placeholder="Enter pre-VAT amount"
                                />
                            </div>

                            <div className="form-group">
                                <label>VAT Amount</label>
                                <input
                                    type="text"
                                    value={formData.vatAmount}
                                    readOnly
                                    disabled
                                />
                            </div>

                            <div className="form-group">
                                <label>Amount (Post-VAT)</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9]*\.?[0-9]*"
                                    value={formData.amountGross}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        // Allow only numbers and decimal point
                                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                            handleAmountChange('amountGross', value);
                                        }
                                    }}
                                    onBlur={() => handleAmountBlur('amountGross')}
                                    placeholder="Enter post-VAT amount"
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Date Paid *</label>
                                <input
                                    type="date"
                                    value={formData.datePaid}
                                    onChange={(e) => setFormData({ ...formData, datePaid: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>Payment Method</label>
                                <select
                                    value={formData.paymentMethod}
                                    onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                                >
                                    <option value="">Select Payment Method</option>
                                    {Array.isArray(paymentMethods) && paymentMethods.map(method => (
                                        <option key={method} value={method}>{method}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Notes</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows="3"
                            />
                        </div>

                        <div className="form-group">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isDLA}
                                    onChange={(e) => setFormData({ ...formData, isDLA: e.target.checked, dlaDirector: '' })}
                                />
                                <span>Save as Director's Loan Account (DLA) entry</span>
                            </label>
                            {formData.isDLA && (
                                <div style={{ marginTop: '0.6rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.88rem', fontWeight: 500 }}>Director *</label>
                                    {directors.length > 0 ? (
                                        <select
                                            value={formData.dlaDirector}
                                            onChange={(e) => setFormData({ ...formData, dlaDirector: e.target.value })}
                                            required={formData.isDLA}
                                        >
                                            <option value="">Select director…</option>
                                            {directors.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={formData.dlaDirector}
                                            onChange={(e) => setFormData({ ...formData, dlaDirector: e.target.value })}
                                            placeholder="Director name"
                                            required={formData.isDLA}
                                        />
                                    )}
                                    <small style={{ color: '#6b7280', fontSize: '0.78rem', marginTop: '0.25rem', display: 'block' }}>
                                        This will be saved directly as a DLA entry — not an expense.
                                    </small>
                                </div>
                            )}
                        </div>

                        {!formData.isDLA && (
                        <div className="form-group">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isRecurring || false}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        isRecurring: e.target.checked,
                                        recurringFrequency: e.target.checked ? (formData.recurringFrequency || 'Monthly') : '',
                                        recurringNextDate: e.target.checked
                                            ? (formData.recurringNextDate || (() => {
                                                const d = new Date(formData.datePaid || new Date());
                                                d.setMonth(d.getMonth() + 1);
                                                return d.toISOString().split('T')[0];
                                              })())
                                            : ''
                                    })}
                                />
                                <span>Recurring expense</span>
                            </label>
                            {formData.isRecurring && (
                                <div style={{ marginTop: '0.6rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: 140 }}>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.88rem', fontWeight: 500 }}>Frequency</label>
                                        <select
                                            value={formData.recurringFrequency || 'Monthly'}
                                            onChange={(e) => setFormData({ ...formData, recurringFrequency: e.target.value })}
                                        >
                                            <option value="Monthly">Monthly</option>
                                            <option value="Quarterly">Quarterly</option>
                                            <option value="Annual">Annual</option>
                                        </select>
                                    </div>
                                    <div style={{ flex: 1, minWidth: 160 }}>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.88rem', fontWeight: 500 }}>Next due date</label>
                                        <input
                                            type="date"
                                            value={formData.recurringNextDate || ''}
                                            onChange={(e) => setFormData({ ...formData, recurringNextDate: e.target.value })}
                                        />
                                    </div>
                                    <small style={{ width: '100%', color: '#6b7280', fontSize: '0.78rem' }}>
                                        A new expense will be created automatically on each due date.
                                    </small>
                                </div>
                            )}
                        </div>
                        )}

                        <div className="form-group">
                            <label>Receipt(s)</label>

                            {/* Existing attachments */}
                            {existingAttachments.length > 0 && (
                                <div style={{ marginBottom: '0.75rem' }}>
                                    {existingAttachments.map((attachment, index) => {
                                        const fileName = attachment.split('/').pop();
                                        return (
                                            <div key={index} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.4rem', padding: '0.4rem 0.75rem', backgroundColor: '#f0f7ff', borderRadius: 4, border: '1px solid #bee5eb' }}>
                                                <a href={attachment} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: '#0066cc', textDecoration: 'none', fontSize: '0.88rem' }}>
                                                    📎 {fileName}
                                                </a>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        if (confirm('Delete this attachment?')) {
                                                            try {
                                                                await deleteAttachment(editingExpense.id, fileName);
                                                                setExistingAttachments(existingAttachments.filter((_, i) => i !== index));
                                                                showToast('Attachment deleted', 'success');
                                                            } catch (error) {
                                                                showToast('Failed to delete: ' + error.message, 'error');
                                                            }
                                                        }
                                                    }}
                                                    style={{ marginLeft: 8, padding: '2px 8px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: '0.8rem' }}
                                                >✕</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Drop zone / file picker */}
                            <>
                                <input
                                    ref={formFileRef}
                                    type="file"
                                    accept="image/*,application/pdf"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        // Append new picks to any already-loaded files (e.g. from scan)
                                        setSelectedFiles(prev => [...prev, ...Array.from(e.target.files)]);
                                        e.target.value = '';
                                    }}
                                />

                                {/* Show already-selected files (including scanned) */}
                                {selectedFiles.length > 0 && (
                                    <div style={{ marginBottom: 6 }}>
                                        {selectedFiles.map((f, i) => {
                                            const isImage = f.type?.startsWith('image/');
                                            const previewUrl = isImage ? URL.createObjectURL(f) : null;
                                            const isFromScan = i === 0 && captureScanToast === 'success';
                                            return (
                                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: isFromScan ? 'rgba(13,110,253,0.06)' : '#f8f9fa', border: `1px solid ${isFromScan ? '#0d6efd' : '#dee2e6'}`, borderRadius: 6, marginBottom: 4 }}>
                                                    {previewUrl && (
                                                        <img src={previewUrl} alt="preview" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} onLoad={() => URL.revokeObjectURL(previewUrl)} />
                                                    )}
                                                    {!previewUrl && (
                                                        <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>📄</span>
                                                    )}
                                                    <span style={{ fontSize: '0.82rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                                    {isFromScan && (
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#0d6efd', background: 'rgba(13,110,253,0.1)', padding: '1px 6px', borderRadius: 10, flexShrink: 0 }}>from scan</span>
                                                    )}
                                                    <button type="button" onClick={() => setSelectedFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6c757d', fontSize: '1rem', lineHeight: 1, flexShrink: 0 }} title="Remove">×</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Drop zone — always visible to add more */}
                                <div
                                    onDragOver={e => { e.preventDefault(); setFormDragOver(true); }}
                                    onDragLeave={() => setFormDragOver(false)}
                                    onDrop={e => { e.preventDefault(); setFormDragOver(false); setSelectedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
                                    onClick={() => formFileRef.current?.click()}
                                    style={{
                                        border: `2px dashed ${formDragOver ? '#0d6efd' : '#ced4da'}`,
                                        borderRadius: 6, padding: '8px 14px', cursor: 'pointer', textAlign: 'center',
                                        background: formDragOver ? 'rgba(13,110,253,0.05)' : '#f8f9fa',
                                        color: formDragOver ? '#0d6efd' : '#6c757d', fontSize: '0.82rem',
                                        transition: 'all 0.15s'
                                    }}
                                >
                                    {isMobile ? '📸 Tap to add another photo or file' : '📎 Drag & drop or click to add more receipts'}
                                </div>
                            </>
                        </div>

                        <div className="form-actions">
                            {/* Missing receipt banner — shown when no attachments and no existing declaration */}
                            {!formData.isDLA && selectedFiles.length === 0 && existingAttachments.length === 0 && !editingExpense?.hasMissingReceiptDeclaration && !editingExpense?.noReceiptReason && (
                                <div style={{ width: '100%', marginBottom: '0.75rem', padding: '0.75rem 1rem', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, fontSize: '0.85rem', color: '#92400e' }}>
                                    <strong>⚠️ No receipt attached.</strong> Saving without a receipt will require a Missing Receipt Declaration or a reason — you will be prompted automatically.
                                </div>
                            )}
                            {editingExpense?.hasMissingReceiptDeclaration && (
                                <div style={{ width: '100%', marginBottom: '0.75rem', padding: '0.75rem 1rem', background: '#f0f4ff', border: '1px solid #1565C0', borderRadius: 6, fontSize: '0.85rem', color: '#1565C0', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <span>📋 <strong>Missing Receipt Declaration on file</strong> — {editingExpense.missingReceiptDeclarationRef} · VAT set to £0.00</span>
                                    <a href={getDeclarationPdfUrl(editingExpense.id)} target="_blank" rel="noreferrer" style={{ color: '#1565C0', fontWeight: 600, fontSize: '0.8rem' }}>View PDF ↗</a>
                                    <button type="button" onClick={() => {
                                        if (window.confirm('Void this declaration? VAT rules will no longer apply automatically.')) {
                                            handleVoidDeclaration(editingExpense, 'Voided by user');
                                        }
                                    }} style={{ background: 'none', border: '1px solid #dc3545', color: '#dc3545', borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: '0.78rem', marginLeft: 'auto' }}>
                                        Void Declaration
                                    </button>
                                </div>
                            )}
                            {editingExpense?.noReceiptReason && !editingExpense?.hasMissingReceiptDeclaration && (
                                <div style={{ width: '100%', marginBottom: '0.75rem', padding: '0.75rem 1rem', background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6, fontSize: '0.85rem', color: '#15803d' }}>
                                    ✅ <strong>No-receipt reason on file</strong> — {editingExpense.noReceiptReason}
                                </div>
                            )}
                            <button type="submit" className="btn-primary" disabled={uploadingReceipt || processing}>
                                {uploadingReceipt ? 'Uploading...' : processing ? 'Saving...' : formData.isDLA && !editingExpense ? '🏦 Save as DLA Entry' : editingExpense ? 'Update Expense' : 'Create Expense'}
                            </button>
                            {editingExpense && (
                                <button type="button" onClick={handleCancelEdit} className="btn-secondary">
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                    </div>
                </div>
            )}

            {loading ? (
                <p>Loading expenses...</p>
            ) : (
                <>
                    {/* Source filter */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>Source:</span>
                        {[{key:'all',label:'All'},{key:'company',label:'Company'},{key:'employee',label:'Employee Claims'}].map(f => (
                            <button key={f.key} onClick={() => setSourceFilter(f.key)}
                                style={{ padding: '0.25rem 0.75rem', borderRadius: 16, border: sourceFilter === f.key ? '2px solid #2563eb' : '1px solid #d1d5db',
                                    background: sourceFilter === f.key ? '#eff6ff' : '#fff', color: sourceFilter === f.key ? '#2563eb' : '#374151',
                                    fontWeight: sourceFilter === f.key ? 700 : 400, fontSize: '0.82rem', cursor: 'pointer' }}>{f.label}</button>
                        ))}
                    </div>
                    {/* Bulk action bar — only when allowDataDeletion and items selected */}
                    {allowDataDeletion && selectedIds.size > 0 && (
                        <div style={{ background: '#fdf2f2', border: '1px solid #f5c2c7', borderRadius: 6, padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, color: '#dc3545' }}>{selectedIds.size} expense{selectedIds.size > 1 ? 's' : ''} selected</span>
                            <button onClick={clearSelection} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.2rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>✕ Clear</button>
                            <button onClick={handleBulkDeleteExpenses} style={{ background: '#dc3545', color: '#fff', border: 'none', borderRadius: 4, padding: '0.25rem 0.9rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>🗑️ Delete Selected</button>
                        </div>
                    )}
                    {isMobile ? (
                        <div className="mobile-cards">
                            {allowDataDeletion && (
                                <div className="mobile-select-bar">
                                    <span>{selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Tap ☑ to select'}</span>
                                    {selectedIds.size < displayExpenses.length
                                        ? <button onClick={selectAllExpenses}>Select All</button>
                                        : <button onClick={clearSelection}>✕ Clear</button>
                                    }
                                </div>
                            )}
                            {displayExpenses.length === 0 ? (
                                <div className="mobile-empty">No expenses yet.<br />Tap <strong>+ Add Expense</strong> to get started.</div>
                            ) : displayExpenses.map(expense => (
                                <div key={expense.id} className="mobile-card" onClick={() => handleViewExpense(expense)}>
                                    <div className="card-header">
                                        <span className="card-id">{expense.expenseId || expense.id}</span>
                                        <strong className="card-amount">£{(expense.amountGross || 0).toFixed(2)}</strong>
                                    </div>
                                    <div className="card-body">
                                        <div className="card-main-row">
                                            <span>{expense.supplier || '—'}</span>
                                            {expense.ctTag === 'NonCT' && <span className="badge badge-red">Non-CT</span>}
                                            {expense.submittedByTeamMemberId && <span className="badge" style={{ background: '#ede9fe', color: '#7c3aed', border: '1px solid #c4b5fd' }}>Employee</span>}
                                        </div>
                                        <div className="card-meta-row">
                                            <span>
                                                {expense.entryDate
                                                    ? new Date(expense.entryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                                    : expense.datePaid
                                                        ? new Date(expense.datePaid).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                                        : ''}
                                            </span>
                                            {expense.category && <span className="badge">{expense.category}</span>}
                                            {expense.paymentMethod && <span className="badge">{expense.paymentMethod}</span>}
                                            {expense.taxYear && <span className="badge">{expense.taxYear}</span>}
                                            {expense.isRecurring && (
                                                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }} title={`Recurring ${expense.recurringFrequency || ''} — next: ${expense.recurringNextDate ? new Date(expense.recurringNextDate).toLocaleDateString('en-GB') : '?'}`}>🔁 {expense.recurringFrequency || 'Recurring'}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="card-actions" onClick={e => e.stopPropagation()}>
                                        {allowDataDeletion && (
                                            <input type="checkbox" data-bwignore="true" autoComplete="off" checked={selectedIds.has(expense.id)} onChange={() => toggleSelectId(expense.id)}
                                                style={{ marginRight: '0.4rem', cursor: 'pointer' }} onClick={e => e.stopPropagation()} />
                                        )}
                                        <button onClick={() => handleEdit(expense)} className="card-action-btn">✏️ Edit</button>
                                        <button onClick={() => handleDownloadPDF(expense)} className="card-action-btn">📄 PDF</button>
                                        {allowDataDeletion && (
                                            <button onClick={() => handleDeleteExpense(expense)} className="card-action-btn" disabled={processing}>🗑️ Delete</button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                    <div className="expenses-table-container" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            {allowDataDeletion && (
                                <th style={{ width: 40, textAlign: 'center' }}>
                                    <input type="checkbox" data-bwignore="true" autoComplete="off" title="Select All"
                                        onChange={e => e.target.checked ? selectAllExpenses() : clearSelection()}
                                        checked={selectedIds.size > 0 && displayExpenses.every(e => selectedIds.has(e.id))}
                                    />
                                </th>
                            )}
                            <th>ID</th>
                            <th>Date</th>
                            <th>Supplier</th>
                            <th>Category</th>
                            <th>Reference</th>
                            <th>Net</th>
                            <th>VAT</th>
                            <th>Gross</th>
                            <th>Tax Year</th>
                            <th>FY</th>
                            <th>Source</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Array.isArray(expenses) && displayExpenses.map(expense => (
                            <tr key={expense.id} onClick={() => handleViewExpense(expense)} style={{ cursor: 'pointer', background: selectedIds.has(expense.id) ? 'rgba(220,53,69,0.05)' : undefined }}>
                                {allowDataDeletion && (
                                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                                        <input type="checkbox" data-bwignore="true" autoComplete="off" checked={selectedIds.has(expense.id)} onChange={() => toggleSelectId(expense.id)} />
                                    </td>
                                )}
                                <td><strong>{expense.expenseId || expense.id}</strong></td>
                                <td>{expense.entryDate ? new Date(expense.entryDate).toLocaleDateString() : (expense.datePaid ? new Date(expense.datePaid).toLocaleDateString() : '')}</td>
                                <td>{expense.supplier}</td>
                                <td>
                                    {expense.category}
                                    {expense.ctTag === 'NonCT' && (
                                        <span style={{ marginLeft: '6px', fontSize: '0.72rem', fontWeight: 600, color: '#fff', backgroundColor: '#dc3545', padding: '1px 6px', borderRadius: '10px', verticalAlign: 'middle' }}>
                                            Non-CT
                                        </span>
                                    )}
                                    {expense.hasMissingReceiptDeclaration && (
                                        <span title={`Declaration: ${expense.missingReceiptDeclarationRef}`} style={{ marginLeft: '4px', fontSize: '0.72rem', fontWeight: 600, color: '#fff', backgroundColor: '#1565C0', padding: '1px 6px', borderRadius: '10px', verticalAlign: 'middle' }}>
                                            MRD
                                        </span>
                                    )}
                                </td>
                                <td>{expense.reference}</td>
                                <td>£{expense.amountNet?.toFixed(2)}</td>
                                <td>£{expense.vatAmount?.toFixed(2)}</td>
                                <td>£{expense.amountGross?.toFixed(2)}</td>
                                <td>{expense.taxYear || ''}</td>
                                <td>{expense.financialYear || ''}</td>
                                <td>
                                    {expense.submittedByTeamMemberId
                                        ? <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#fff', backgroundColor: '#7c3aed', padding: '1px 6px', borderRadius: '10px' }}>Employee</span>
                                        : <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#fff', backgroundColor: '#6b7280', padding: '1px 6px', borderRadius: '10px' }}>Company</span>}
                                </td>
                                <td onClick={e => e.stopPropagation()}>
                                    <button 
                                        onClick={() => handleEdit(expense)} 
                                        className="btn-icon"
                                        title="Edit"
                                    >
                                        ✏️
                                    </button>
                                    <button 
                                        onClick={() => handleDownloadPDF(expense)} 
                                        className="btn-icon"
                                        title="Download Expense Claim PDF"
                                        style={{marginLeft: '5px'}}
                                    >
                                        📄
                                    </button>
                                    {expense.hasMissingReceiptDeclaration && (
                                        <button
                                            onClick={() => window.open(getDeclarationPdfUrl(expense.id), '_blank')}
                                            className="btn-icon"
                                            title={`Declaration on file: ${expense.missingReceiptDeclarationRef}`}
                                            style={{ marginLeft: '5px' }}
                                        >
                                            📎
                                        </button>
                                    )}
                                    {allowDataDeletion && (
                                        <button 
                                            onClick={() => handleDeleteExpense(expense)} 
                                            className="btn-icon"
                                            title="Delete Expense"
                                            style={{marginLeft: '5px'}}
                                            disabled={processing}
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
                    )}

                    {/* CT Summary */}
                    {(() => {
                        const nonDlaExpenses = displayExpenses;
                        const ctTotal    = nonDlaExpenses.filter(e => e.ctTag !== 'NonCT').reduce((s, e) => s + (e.amountNet || 0), 0);
                        const nonCtTotal = nonDlaExpenses.filter(e => e.ctTag === 'NonCT').reduce((s, e) => s + (e.amountNet || 0), 0);
                        const total      = nonDlaExpenses.reduce((s, e) => s + (e.amountNet || 0), 0);
                        return (
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: '150px', padding: '0.75rem 1rem', backgroundColor: '#e8f5e9', borderRadius: '6px', borderLeft: '4px solid #4caf50' }}>
                                    <div style={{ fontSize: '0.78rem', color: '#2e7d32', fontWeight: 600 }}>CT Allowable (Net)</div>
                                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1b5e20' }}>£{ctTotal.toFixed(2)}</div>
                                </div>
                                <div style={{ flex: 1, minWidth: '150px', padding: '0.75rem 1rem', backgroundColor: '#fdecea', borderRadius: '6px', borderLeft: '4px solid #dc3545' }}>
                                    <div style={{ fontSize: '0.78rem', color: '#c62828', fontWeight: 600 }}>Non-CT Disallowed (Net)</div>
                                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#b71c1c' }}>£{nonCtTotal.toFixed(2)}</div>
                                </div>
                                <div style={{ flex: 1, minWidth: '150px', padding: '0.75rem 1rem', backgroundColor: '#f3f4f6', borderRadius: '6px', borderLeft: '4px solid #6b7280' }}>
                                    <div style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 600 }}>Total Expenses (Net)</div>
                                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#111827' }}>£{total.toFixed(2)}</div>
                                </div>
                            </div>
                        );
                    })()}
                </>
            )}

            {/* Expense Detail Modal */}
            {viewExpense && (
                <div className="modal-overlay" onClick={() => setViewExpense(null)}>
                    <div className="modal-content" style={{ maxWidth: '700px', width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📋 Expense — {viewExpense.expenseId || `#${viewExpense.id}`}</h3>
                            <button className="btn-close" onClick={() => setViewExpense(null)}>✖</button>
                        </div>
                        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                            {/* Details */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Details</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem' }}>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Supplier</span><div style={{ fontWeight: 600 }}>{viewExpense.supplier || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Date Paid</span><div>{viewExpense.entryDate ? new Date(viewExpense.entryDate).toLocaleDateString('en-GB') : viewExpense.datePaid ? new Date(viewExpense.datePaid).toLocaleDateString('en-GB') : '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Reference</span><div>{viewExpense.reference || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Category</span><div>{viewExpense.category || '—'}{viewExpense.ctTag === 'NonCT' && <span style={{ marginLeft: 6, fontSize: '0.72rem', fontWeight: 600, color: '#fff', backgroundColor: '#dc3545', padding: '1px 6px', borderRadius: 10 }}>Non-CT</span>}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Payment Method</span><div>{viewExpense.paymentMethod || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>VAT Treatment</span><div>{viewExpense.vatApplicability || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Tax Year</span><div>{viewExpense.taxYear || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Financial Year</span><div>{viewExpense.financialYear || '—'}</div></div>
                                </div>
                            </section>

                            {/* Financial */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Financial</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem' }}>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Net</span><div style={{ fontWeight: 500 }}>£{(viewExpense.amountNet || 0).toFixed(2)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>VAT</span><div>£{(viewExpense.vatAmount || 0).toFixed(2)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Gross</span><div style={{ fontWeight: 700, fontSize: '1.05rem' }}>£{(viewExpense.amountGross || 0).toFixed(2)}</div></div>
                                </div>
                                {viewExpense.ctTag !== 'NonCT' && (
                                    <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(22,163,74,0.08)', borderRadius: '6px', fontSize: '0.8rem', color: '#16a34a' }}>
                                        ✅ CT-allowable — reduces taxable profit by £{(viewExpense.amountNet || 0).toFixed(2)}
                                        {' '}(saving ~£{(Math.round((viewExpense.amountNet || 0) * 0.19 * 100) / 100).toFixed(2)} CT at 19%)
                                    </div>
                                )}
                            </section>

                            {/* Notes */}
                            {viewExpense.notes && (
                                <section>
                                    <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Notes</h4>
                                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{viewExpense.notes}</p>
                                </section>
                            )}

                            {/* Receipts */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Receipt</h4>
                                {viewAttachmentsLoading && <div style={{ opacity: 0.6, fontSize: '0.85rem' }}>Loading…</div>}
                                {!viewAttachmentsLoading && viewAttachments.length === 0 && !viewExpense.hasMissingReceiptDeclaration && !viewExpense.noReceiptReason && (
                                    <div style={{ opacity: 0.4, fontSize: '0.85rem' }}>No receipt attached</div>
                                )}
                                {!viewAttachmentsLoading && viewAttachments.length === 0 && viewExpense.hasMissingReceiptDeclaration && (
                                    <div style={{ padding: '0.6rem 0.9rem', background: '#f0f4ff', border: '1px solid #1565C0', borderRadius: 6, fontSize: '0.85rem', color: '#1565C0', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        📋 <strong>Missing Receipt Declaration on file</strong> — {viewExpense.missingReceiptDeclarationRef}
                                        <a href={getDeclarationPdfUrl(viewExpense.id)} target="_blank" rel="noreferrer" style={{ color: '#1565C0', fontWeight: 600, fontSize: '0.8rem', marginLeft: 'auto' }}>View Declaration PDF ↗</a>
                                    </div>
                                )}
                                {!viewAttachmentsLoading && viewAttachments.length === 0 && !viewExpense.hasMissingReceiptDeclaration && viewExpense.noReceiptReason && (
                                    <div style={{ padding: '0.6rem 0.9rem', background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6, fontSize: '0.85rem', color: '#15803d' }}>
                                        ✅ <strong>No receipt — reason on file:</strong> {viewExpense.noReceiptReason}
                                    </div>
                                )}
                                {!viewAttachmentsLoading && viewAttachments.map((att, i) => {
                                    const apiBase = 'https://financehub-func-kemponline.azurewebsites.net/api';
                                    const url = `${apiBase}/expenses/${viewExpense.id}/receipts/${att.fileName}`;
                                    const isPdf = att.fileName?.toLowerCase().endsWith('.pdf');
                                    return (
                                        <div key={i} style={{ marginBottom: '0.75rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                                <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>📎 {att.fileName}</span>
                                                <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', color: '#0d6efd' }}>Open in new tab ↗</a>
                                            </div>
                                            {isPdf ? (
                                                <iframe src={url} title={att.fileName} style={{ width: '100%', height: 420, border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6 }} />
                                            ) : (
                                                <img src={url} alt={att.fileName} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', display: 'block', cursor: 'zoom-in' }} onClick={() => window.open(url, '_blank')} />
                                            )}
                                        </div>
                                    );
                                })}
                            </section>

                        </div>
                        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { setViewExpense(null); handleDownloadPDF(viewExpense); }}>📄 PDF Claim</button>
                            {!viewExpense.hasMissingReceiptDeclaration && !viewAttachmentsLoading && viewAttachments.length === 0 && (
                                <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { setViewExpense(null); openDeclarationModal(viewExpense); }}>📋 Declaration</button>
                            )}
                            {viewExpense.hasMissingReceiptDeclaration && (
                                <a href={getDeclarationPdfUrl(viewExpense.id)} target="_blank" rel="noreferrer" className="btn-secondary" style={{ fontSize: '0.85rem', textDecoration: 'none' }}>📎 View Declaration</a>
                            )}
                            <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { setViewExpense(null); handleEdit(viewExpense); }}>✏️ Edit</button>
                            <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={() => setViewExpense(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {showTrivialBenefit && (
                <TrivialBenefitModal
                    directors={directors}
                    onClose={() => setShowTrivialBenefit(false)}
                    onSaved={() => { setShowTrivialBenefit(false); loadData(); }}
                />
            )}

            <ConfirmDeleteModal
                isOpen={!!confirmModal}
                title={confirmModal?.title}
                message={confirmModal?.message}
                itemLabels={confirmModal?.itemLabels || []}
                onConfirm={confirmModal?.onConfirm}
                onCancel={() => setConfirmModal(null)}
            />

            {/* No-Receipt Reason Info Modal */}
            {noReceiptInfoModal && (
                <div className="modal-overlay" style={{ zIndex: 2050 }} onClick={() => setNoReceiptInfoModal(null)}>
                    <div className="modal-content" style={{ maxWidth: 420, width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header" style={{ background: '#15803d', color: '#fff', borderRadius: '8px 8px 0 0' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem' }}>✅ No Receipt on File</h3>
                            <button className="btn-close" style={{ color: '#fff', background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => setNoReceiptInfoModal(null)}>✖</button>
                        </div>
                        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 6, padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                                <strong>{noReceiptInfoModal.expense.supplier || noReceiptInfoModal.expense.supplierFreeText}</strong>
                                {noReceiptInfoModal.expense.reference && <span> — {noReceiptInfoModal.expense.reference}</span>}
                                <span style={{ float: 'right', fontWeight: 700 }}>£{(noReceiptInfoModal.expense.amountGross || 0).toFixed(2)}</span>
                                <div style={{ color: '#6c757d', marginTop: 2 }}>{noReceiptInfoModal.expense.category}</div>
                            </div>
                            <div style={{ background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6, padding: '0.75rem 1rem', fontSize: '0.9rem', color: '#15803d' }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>Reason recorded:</div>
                                <div>{noReceiptInfoModal.expense.noReceiptReason}</div>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>
                                No receipt is attached to this expense. A reason has been recorded above. If you now have a receipt, edit the expense to attach it.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button
                                    className="btn-secondary"
                                    onClick={() => { setNoReceiptInfoModal(null); openDeclarationModal(noReceiptInfoModal.expense); }}
                                    style={{ fontSize: '0.85rem' }}
                                >
                                    📋 Create Declaration Instead
                                </button>
                                <button className="btn-primary" onClick={() => setNoReceiptInfoModal(null)} style={{ fontSize: '0.85rem' }}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Receipt Required Modal — auto-shown after saving with no receipt */}
            {receiptRequiredModal && (
                <div className="modal-overlay" style={{ zIndex: 2050 }}>
                    <div className="modal-content" style={{ maxWidth: 480, width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header" style={{ background: '#1565C0', color: '#fff', borderRadius: '8px 8px 0 0' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem' }}>🧾 Receipt Required</h3>
                        </div>
                        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <p style={{ margin: 0, color: '#374151', fontSize: '0.9rem' }}>
                                This entry has no receipt attached. You must either create a <strong>Missing Receipt Declaration</strong>, or provide a reason why no receipt is needed.
                            </p>
                            <button
                                onClick={handleReceiptRequiredExpenseDeclaration}
                                className="btn-primary"
                                style={{ width: '100%', padding: '0.75rem', fontSize: '0.9rem' }}
                            >
                                📋 Create Missing Receipt Declaration
                            </button>
                            <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.82rem' }}>— or —</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151' }}>No receipt needed — select a reason:</label>
                                <select
                                    value={noReceiptReasonValue}
                                    onChange={e => setNoReceiptReasonValue(e.target.value)}
                                    style={{ padding: '0.5rem', borderRadius: 5, border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                                >
                                    <option value="">Select reason...</option>
                                    <option>Under £10 — receipt not required by HMRC</option>
                                    <option>Receipt lost or unavailable</option>
                                    <option>Digital/contactless — no physical receipt issued</option>
                                    <option>Mileage or fuel — receipt not applicable</option>
                                    <option>Receipt to follow</option>
                                    <option>Other</option>
                                </select>
                                {noReceiptReasonValue === 'Other' && (
                                    <input
                                        type="text"
                                        value={noReceiptReasonOther}
                                        onChange={e => setNoReceiptReasonOther(e.target.value)}
                                        placeholder="Describe the reason..."
                                        style={{ padding: '0.5rem', borderRadius: 5, border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                                    />
                                )}
                                <button
                                    onClick={handleExpenseNoReceiptReasonSave}
                                    disabled={!noReceiptReasonValue || (noReceiptReasonValue === 'Other' && !noReceiptReasonOther.trim()) || savingNoReceiptReason}
                                    className="btn-secondary"
                                    style={{ padding: '0.6rem', fontSize: '0.85rem' }}
                                >
                                    {savingNoReceiptReason ? 'Saving...' : '✔ Save Without Receipt'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Missing Receipt Declaration Modal */}
            {declarationModal && (
                <div className="modal-overlay" onClick={() => !declarationSaving && setDeclarationModal(null)}>
                    <div className="modal-content" style={{ maxWidth: 580, width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header" style={{ background: '#1565C0', color: '#fff', borderRadius: '8px 8px 0 0' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem' }}>📋 Missing Receipt Declaration</h3>
                            <button className="btn-close" style={{ color: '#fff', background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => !declarationSaving && setDeclarationModal(null)} disabled={declarationSaving}>✖</button>
                        </div>
                        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Expense summary */}
                            <div style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 6, padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                                <strong>{declarationModal.expense.supplier}</strong>
                                {declarationModal.expense.reference && <span> — {declarationModal.expense.reference}</span>}
                                <span style={{ float: 'right', fontWeight: 700 }}>£{(declarationModal.expense.amountGross || 0).toFixed(2)}</span>
                                <div style={{ color: '#6c757d', marginTop: 2 }}>{declarationModal.expense.category}</div>
                            </div>

                            <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#78350f' }}>
                                ⚠️ <strong>VAT cannot be reclaimed</strong> without a valid VAT invoice. Finalising this declaration will set VAT to £0.00 on this expense.
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 3 }}>Your Name *</label>
                                    <input type="text" value={declarationForm.declarerName || ''} onChange={e => setDeclarationForm(p => ({ ...p, declarerName: e.target.value }))}
                                        placeholder="Full name" style={{ width: '100%', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: '0.85rem', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 3 }}>Role</label>
                                    <select value={declarationForm.declarerRole || 'Director'} onChange={e => setDeclarationForm(p => ({ ...p, declarerRole: e.target.value }))}
                                        style={{ width: '100%', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: '0.85rem', boxSizing: 'border-box' }}>
                                        <option value="Director">Director</option>
                                        <option value="Finance Manager">Finance Manager</option>
                                        <option value="Employee">Employee</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 3 }}>Email</label>
                                    <input type="email" value={declarationForm.declarerEmail || ''} onChange={e => setDeclarationForm(p => ({ ...p, declarerEmail: e.target.value }))}
                                        placeholder="your@email.com" style={{ width: '100%', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: '0.85rem', boxSizing: 'border-box' }} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 3 }}>Reason receipt unavailable *</label>
                                    <select value={declarationForm.reasonReceiptMissing || 'NotProvided'} onChange={e => setDeclarationForm(p => ({ ...p, reasonReceiptMissing: e.target.value }))}
                                        style={{ width: '100%', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: '0.85rem', boxSizing: 'border-box' }}>
                                        <option value="NotProvided">Not provided by supplier</option>
                                        <option value="Lost">Lost or misplaced</option>
                                        <option value="DigitalUnavailable">Digital receipt not available</option>
                                        <option value="Other">Other (specify below)</option>
                                    </select>
                                    {declarationForm.reasonReceiptMissing === 'Other' && (
                                        <input type="text" value={declarationForm.otherReasonText || ''} onChange={e => setDeclarationForm(p => ({ ...p, otherReasonText: e.target.value }))}
                                            placeholder="Please specify..." style={{ width: '100%', marginTop: 6, padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: '0.85rem', boxSizing: 'border-box' }} />
                                    )}
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 3 }}>Description of expense *</label>
                                    <textarea value={declarationForm.description || ''} onChange={e => setDeclarationForm(p => ({ ...p, description: e.target.value }))}
                                        rows={3} placeholder="Describe the business purpose of this expense..."
                                        style={{ width: '100%', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: '0.85rem', resize: 'vertical', boxSizing: 'border-box' }} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 3 }}>Typed Signature *</label>
                                    <input type="text" value={declarationForm.typedSignature || ''} onChange={e => setDeclarationForm(p => ({ ...p, typedSignature: e.target.value }))}
                                        placeholder="Type your full name to sign..." style={{ width: '100%', padding: '6px 10px', border: '1px solid #ced4da', borderRadius: 4, fontSize: '0.85rem', fontStyle: 'italic', boxSizing: 'border-box' }} />
                                </div>
                            </div>

                            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#664d03' }}>
                                <strong>Declaration:</strong> I confirm that this expense was incurred wholly and exclusively for the purposes of the business. No receipt is available for this transaction. I understand that VAT cannot be reclaimed without a valid VAT invoice, and that HMRC may disallow this expense if challenged.
                            </div>

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                                <input type="checkbox" checked={declarationForm.acknowledgementDisallowable || false}
                                    onChange={e => setDeclarationForm(p => ({ ...p, acknowledgementDisallowable: e.target.checked }))}
                                    style={{ marginTop: 2, flexShrink: 0 }} />
                                <span>I acknowledge that this expense may be <strong>disallowed for Corporation Tax purposes</strong> without a valid receipt, and that <strong>VAT cannot be reclaimed</strong>. *</span>
                            </label>
                        </div>

                        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button type="button" className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => setDeclarationModal(null)} disabled={declarationSaving}>Cancel</button>
                            <button type="button" style={{ background: '#1565C0', color: '#fff', border: 'none', borderRadius: 6, padding: '0.45rem 1.1rem', cursor: declarationSaving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.85rem', opacity: declarationSaving ? 0.7 : 1 }}
                                onClick={handleCreateDeclaration} disabled={declarationSaving}>
                                {declarationSaving ? '⏳ Saving…' : '📋 Create & Finalise Declaration'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Expenses;
