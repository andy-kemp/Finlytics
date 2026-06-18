import React, { useState, useEffect } from 'react';
import { getAuthHeaders, getCompanySettings, getDlaEntries, getDlaPayments, getAllDlaPayments, getCompanyDocuments, uploadDocument, deleteDocument, downloadDocument, analyzeInvoice, getSuppliers, createSupplier, generateCode, getTrivialBenefitSummary, getDlaDeclaration, createDlaDeclaration, finaliseDlaDeclaration, voidDlaDeclaration, getDlaDeclarationPdfUrl, patchDlaNoReceiptReason } from '../services/apiService';
import { calculateDlaCompliance } from '../services/dlaRules';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import TrivialBenefitModal from './TrivialBenefitModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

const DLA = ({ openNew }) => {
    const { toast, showToast, clearToast } = useToast();
    const [dlaEntries, setDlaEntries] = useState([]);
    const [directors, setDirectors] = useState([]);
    const [showTrivialBenefit, setShowTrivialBenefit] = useState(false);
    const [trivialSummary, setTrivialSummary] = useState(null);
    const [categories, setCategories] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [companySettings, setCompanySettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);

    // Auto-open new entry form if launched from Dashboard quick-add
    useEffect(() => { if (openNew) setShowForm(true); }, [openNew]);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploadingReceipt, setUploadingReceipt] = useState(false);
    const [viewingReceipts, setViewingReceipts] = useState(null);
    const [showReceiptsModal, setShowReceiptsModal] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewMime, setPreviewMime] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewFileName, setPreviewFileName] = useState(null);
    const [isMobile, setIsMobile] = useState(false);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentEntry, setPaymentEntry] = useState(null);
    const [paymentData, setPaymentData] = useState({
        paymentAmount: '',
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: '',
        notes: ''
    });
    const [showPaymentHistory, setShowPaymentHistory] = useState(false);
    const [paymentHistory, setPaymentHistory] = useState([]);
    const [showStartupModal, setShowStartupModal] = useState(false);
    const [startupMode, setStartupMode] = useState('Single');
    const [startupBatchId, setStartupBatchId] = useState('');
    const [startupForm, setStartupForm] = useState({
        director: '',
        totalAmount: '',
        vatAmount: '0.00',
        totalGross: '',
        canClaimVat: false,
        entryDate: new Date().toISOString().split('T')[0],
        category: 'Startup Costs',
        ctTag: 'Revenue',
        rationale: ''
    });
    const [startupItems, setStartupItems] = useState([]);
    const [startupDocs, setStartupDocs] = useState({ statutory: [], evidence: [] });
    const [dlaDocuments, setDlaDocuments] = useState([]);
    const [incorporationDate, setIncorporationDate] = useState(null);
    const [classificationStatus, setClassificationStatus] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [viewingEntry, setViewingEntry] = useState(null);

    // Missing Receipt Declaration
    const [declarationModal, setDeclarationModal] = useState(null); // { dlaId, entry }
    const [declarationForm, setDeclarationForm] = useState({});
    const [declarationSaving, setDeclarationSaving] = useState(false);
    // No-receipt required flow
    const [receiptRequiredModal, setReceiptRequiredModal] = useState(null); // { savedId, savedEntry } | null
    const [noReceiptReasonValue, setNoReceiptReasonValue] = useState('');
    const [noReceiptReasonOther, setNoReceiptReasonOther] = useState('');
    const [savingNoReceiptReason, setSavingNoReceiptReason] = useState(false);
    const [noReceiptInfoModal, setNoReceiptInfoModal] = useState(null); // { entry } | null


    // Bulk payment state
    const [selectMode, setSelectMode] = useState(false);
    const [selectedEntries, setSelectedEntries] = useState(new Set());
    const [showBulkPaymentModal, setShowBulkPaymentModal] = useState(false);
    const [bulkPaymentData, setBulkPaymentData] = useState({
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: '',
        notes: '',
        sendEmail: true,
        recipientEmail: ''
    });

    // Delete select mode (separate from bulk payment selectMode)
    const [deleteSelectMode, setDeleteSelectMode] = useState(false);
    const [deleteSelectedIds, setDeleteSelectedIds] = useState(new Set());
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', itemLabels: [], onConfirm: () => {} });

    // Filter & pagination state
    const [filterText, setFilterText] = useState('');
    const [filterDirection, setFilterDirection] = useState('');
    const [filterCtTag, setFilterCtTag] = useState('');
    const [filterYear, setFilterYear] = useState('');
    const [filterPaymentStatus, setFilterPaymentStatus] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 20;

    // DLA document viewer state
    const [showDocViewerModal, setShowDocViewerModal] = useState(false);
    const [docViewerUrl, setDocViewerUrl] = useState(null);
    const [docViewerMime, setDocViewerMime] = useState(null);
    const [docViewerFileName, setDocViewerFileName] = useState(null);
    const [docViewerLoading, setDocViewerLoading] = useState(false);

    // DLA document upload state
    const [showDocUploadForm, setShowDocUploadForm] = useState(false);
    const [docUploadFile, setDocUploadFile] = useState(null);
    const [docUploadType, setDocUploadType] = useState('DLA Agreement');
    const [docUploadLoading, setDocUploadLoading] = useState(false);

    // Invoice Quick Capture (drag & drop)
    const [showInvoiceCapture, setShowInvoiceCapture] = useState(false);
    const [captureInvoiceFile, setCaptureInvoiceFile] = useState(null);
    const [captureInvoiceUrl, setCaptureInvoiceUrl] = useState(null);
    const [captureInvoiceMime, setCaptureInvoiceMime] = useState(null);
    const [captureUploading, setCaptureUploading] = useState(false);
    const [captureSubmitting, setCaptureSubmitting] = useState(false);
    const [captureScanning, setCaptureScanning] = useState(false);
    const [captureScanToast, setCaptureScanToast] = useState(null); // 'success' | 'noOcr' | 'error'
    const [captureDragOver, setCaptureDragOver] = useState(false);
    const [captureHeader, setCaptureHeader] = useState({
        director: '',
        vendor: '',
        invoiceDate: new Date().toISOString().split('T')[0],
        invoiceRef: '',
        direction: 'OwedToDirector',
        category: ''
    });
    const [captureLines, setCaptureLines] = useState([
        { description: '', amountNet: '', vatAmount: '0.00', amountGross: '', vatExempt: false }
    ]);

    const DLA_DOCUMENT_TYPES = [
        'DLA Agreement',
        'Asset Transfer Agreement',
        'Board Resolution',
        'Asset Valuation',
        'Supporting Evidence',
        'Other'
    ];
    
    const getDefaultCtTag = (category) => {
        if (category === 'Client Entertainment' || category === 'Client Gifts') return 'NonCT';
        return 'Revenue';
    };

    const [formData, setFormData] = useState({
        director: '',
        direction: 'OwedToDirector',
        description: '',
        category: '',
        ctTag: 'Revenue',
        amountNet: '',
        vatAmount: '',
        amountGross: '',
        vatExempt: false,
        entryDate: new Date().toISOString().split('T')[0],
        datePaid: '',
        paymentMethod: '',
        notes: '',
        isStartupCost: false,
        classificationSource: 'auto',
        overrideClassification: false
    });

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://finlyticsdevfunc.azurewebsites.net/api';

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
            const [dlaData, settingsData, categoriesData, paymentMethodsData, documentsData] = await Promise.all([
                getDlaEntries().catch(() => []),
                getCompanySettings().catch(() => null),
                fetch(`${API_BASE_URL}/categories`).then(r => r.json()).catch(() => []),
                fetch(`${API_BASE_URL}/paymentmethods`).then(r => r.json()).catch(() => []),
                getCompanyDocuments().catch(() => [])
            ]);

            setDlaEntries(Array.isArray(dlaData) ? dlaData : []);
            setCategories(Array.isArray(categoriesData) ? categoriesData : []);
            setPaymentMethods(Array.isArray(paymentMethodsData) ? paymentMethodsData : []);
            setCompanySettings(settingsData || null);
            
            // Extract incorporation date for classification
            const incDate = settingsData?.companyInceptionDate;
            if (incDate) {
                setIncorporationDate(new Date(incDate));
            }
            const filteredDocs = (Array.isArray(documentsData) ? documentsData : []).filter(doc => {
                const entity = (doc.relatedEntity || '').toLowerCase();
                const type = (doc.documentType || '').toLowerCase();
                // Include docs explicitly uploaded as DLA agreements/supporting docs
                if (entity === 'dla:agreements') return true;
                // Include docs whose type matches known DLA agreement types
                if (['dla agreement', 'asset transfer agreement', 'board resolution', 'asset valuation', 'supporting evidence'].includes(type)) return true;
                // Include generic DLA-related docs that aren't per-transaction receipts
                if (entity.startsWith('dla:') && !entity.startsWith('dla:receipt')) return true;
                return false;
            });
            setDlaDocuments(filteredDocs);
            
            // Parse directors from company settings
            if (settingsData?.directors) {
                const directorsList = settingsData.directors.split(',').map(d => d.trim()).filter(d => d);
                setDirectors(directorsList);
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
            console.error('Error loading DLA data:', error);
            console.error('Full error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            setDlaEntries([]);
            setDirectors([]);
            setCategories([]);
            setPaymentMethods([]);
            setCompanySettings(null);
        } finally {
            setLoading(false);
        }
    };

    const classifyDlaEntry = (entryDate, overrideEnabled, manualValue) => {
        // If override is enabled, use manual classification
        if (overrideEnabled && manualValue !== undefined) {
            return { isStartup: manualValue, status: 'manual' };
        }

        // If no incorporation date, warn and default to false
        if (!incorporationDate) {
            return { isStartup: false, status: 'auto', warning: true };
        }

        // If no entry date set yet, don't classify
        if (!entryDate) {
            return { isStartup: false, status: 'auto', warning: false };
        }

        // Compare using local dates only (YYYY-MM-DD) to avoid timezone issues
        const entryDateObj = new Date(entryDate);
        const entryLocal = new Date(entryDateObj.getFullYear(), entryDateObj.getMonth(), entryDateObj.getDate());
        const incorporationLocal = new Date(incorporationDate.getFullYear(), incorporationDate.getMonth(), incorporationDate.getDate());

        const isStartup = entryLocal < incorporationLocal;
        return { isStartup, status: 'auto', warning: false };
    };

    const getClassificationMessage = (isStartup, warning) => {
        if (warning) {
            return 'Warning: Incorporation date not set. Defaulting to standard expense.';
        }
        if (isStartup) {
            return 'This will be recorded as a pre-incorporation startup cost.';
        }
        return 'This will be recorded as a standard director-paid expense.';
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
        const d = new Date(date);
        return d.getFullYear().toString();
    };

    const sanitizeMoneyInput = (value) => {
        if (value === null || value === undefined) return '';
        let cleaned = String(value).replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) {
            cleaned = `${parts[0]}.${parts.slice(1).join('')}`;
        }
        if (cleaned.includes('.')) {
            const [intPart, decPart] = cleaned.split('.');
            cleaned = `${intPart}.${(decPart || '').slice(0, 2)}`;
        }
        return cleaned;
    };

    const formatMoneyInput = (value) => {
        const num = parseFloat(value);
        return Number.isFinite(num) ? num.toFixed(2) : '';
    };

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => {
            const moneyFields = ['amountNet', 'vatAmount', 'amountGross'];
            const boolFields = ['overrideClassification', 'vatExempt'];
            
            let nextValue = value;
            if (moneyFields.includes(name)) {
                nextValue = sanitizeMoneyInput(value);
            } else if (boolFields.includes(name)) {
                nextValue = checked;
            }
            
            const updated = { ...prev, [name]: nextValue };
            
            // --- Smart amount calculations ---
            if (name === 'vatExempt') {
                if (checked) {
                    // VAT exempt: zero out VAT, Gross = Net
                    updated.vatAmount = '0.00';
                    const net = parseFloat(updated.amountNet) || 0;
                    updated.amountGross = net.toFixed(2);
                } else {
                    // Re-enabling VAT: recalculate from current Net at 20%
                    const net = parseFloat(updated.amountNet) || 0;
                    const vat = Math.round(net * 0.2 * 100) / 100;
                    updated.vatAmount = vat.toFixed(2);
                    updated.amountGross = (net + vat).toFixed(2);
                }
            } else if (name === 'amountNet') {
                const net = parseFloat(nextValue) || 0;
                if (updated.vatExempt) {
                    updated.vatAmount = '0.00';
                    updated.amountGross = net.toFixed(2);
                } else {
                    // Auto-calc VAT at 20% and Gross
                    const vat = Math.round(net * 0.2 * 100) / 100;
                    updated.vatAmount = vat.toFixed(2);
                    updated.amountGross = (net + vat).toFixed(2);
                }
            } else if (name === 'amountGross') {
                const gross = parseFloat(nextValue) || 0;
                if (updated.vatExempt) {
                    updated.vatAmount = '0.00';
                    updated.amountNet = gross.toFixed(2);
                } else {
                    // Back-calc: Net = Gross / 1.2, VAT = Gross - Net
                    const net = Math.round((gross / 1.2) * 100) / 100;
                    const vat = Math.round((gross - net) * 100) / 100;
                    updated.amountNet = net.toFixed(2);
                    updated.vatAmount = vat.toFixed(2);
                }
            } else if (name === 'vatAmount') {
                // Manual VAT override: recalculate Gross only
                const net = parseFloat(updated.amountNet) || 0;
                const vat = parseFloat(nextValue) || 0;
                updated.amountGross = (net + vat).toFixed(2);
            }
            
            // Auto-set CT tag when category changes
            if (name === 'category') {
                updated.ctTag = (nextValue === 'Client Entertainment' || nextValue === 'Client Gifts')
                    ? 'NonCT'
                    : (updated.ctTag === 'NonCT' ? 'Revenue' : (updated.ctTag || 'Revenue'));
            }

            // Re-classify when date or override changes
            if (name === 'entryDate' || name === 'overrideClassification' || name === 'isStartupCost') {
                const classification = classifyDlaEntry(
                    updated.entryDate,
                    updated.overrideClassification,
                    updated.isStartupCost
                );
                updated.isStartupCost = classification.isStartup;
                updated.classificationSource = classification.status;
                setClassificationStatus(getClassificationMessage(classification.isStartup, classification.warning));
            }
            
            return updated;
        });
    };

    const handleMoneyBlur = (name) => {
        setFormData(prev => ({ ...prev, [name]: formatMoneyInput(prev[name]) }));
    };

    const handleAddEntry = () => {
        console.log('Add DLA Entry button clicked');
        setEditingEntry(null);
        const newDate = new Date().toISOString().split('T')[0];
        const defaultForm = {
            director: '',
            direction: 'OwedToDirector',
            description: '',
            category: '',
            ctTag: 'Revenue',
            amountNet: '',
            vatAmount: '',
            amountGross: '',
            vatExempt: false,
            entryDate: newDate,
            datePaid: '',
            paymentMethod: '',
            notes: '',
            isStartupCost: false,
            classificationSource: 'auto',
            overrideClassification: false
        };
        setFormData(defaultForm);
        setShowAdvanced(false);
        
        // Trigger initial classification with new date
        const classification = classifyDlaEntry(newDate, false, false);
        setClassificationStatus(getClassificationMessage(classification.isStartup, classification.warning));
        
        setSelectedFiles([]);
        setShowForm(true);
        console.log('ShowForm set to true');
    };

    const handleEditEntry = async (entry) => {
        setEditingEntry(entry);
        const editForm = {
            director: entry.director || '',
            direction: entry.direction || 'OwedToDirector',
            description: entry.description || '',
            category: entry.category || '',
            ctTag: entry.ctTag || getDefaultCtTag(entry.category || ''),
            amountNet: entry.amountNet?.toFixed(2) || '',
            vatAmount: entry.vatAmount?.toFixed(2) || '',
            amountGross: entry.amountGross?.toFixed(2) || '',
            vatExempt: entry.vatAmount === 0 || entry.vatAmount == null ? false : false,
            entryDate: entry.entryDate?.split('T')[0] || new Date().toISOString().split('T')[0],
            datePaid: entry.datePaid?.split('T')[0] || '',
            paymentMethod: entry.paymentMethod || '',
            notes: entry.notes || '',
            isStartupCost: entry.isStartupCost || false,
            classificationSource: entry.classificationSource || 'auto',
            overrideClassification: entry.classificationSource === 'manual'
        };
        setFormData(editForm);
        setShowAdvanced(entry.classificationSource === 'manual');
        
        // Display classification status
        const classification = classifyDlaEntry(
            editForm.entryDate,
            editForm.overrideClassification,
            editForm.isStartupCost
        );
        setClassificationStatus(getClassificationMessage(classification.isStartup, classification.warning));
        
        setSelectedFiles([]);
        setShowForm(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setProcessing(true);

        try {
            const entryData = {
                ...formData,
                director: formData.director,
                description: formData.description,
                amountNet: parseFloat(formData.amountNet) || 0,
                vatAmount: parseFloat(formData.vatAmount) || 0,
                amountGross: parseFloat(formData.amountGross) || 0,
                entryDate: new Date(formData.entryDate).toISOString(),
                datePaid: formData.datePaid ? new Date(formData.datePaid).toISOString() : null,
                taxYear: calculateTaxYear(formData.entryDate),
                financialYear: calculateFinancialYear(formData.entryDate)
            };

            let savedEntry;
            if (editingEntry) {
                const headers = await getAuthHeaders();
                const response = await fetch(`${API_BASE_URL}/dla/${editingEntry.id}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify(entryData)
                });
                if (!response.ok) throw new Error('Failed to update DLA entry');
                savedEntry = await response.json();
            } else {
                const headers = await getAuthHeaders();
                const response = await fetch(`${API_BASE_URL}/dla`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(entryData)
                });
                if (!response.ok) throw new Error('Failed to create DLA entry');
                savedEntry = await response.json();
            }

            // Upload receipts if any
            if (selectedFiles.length > 0 && savedEntry?.id) {
                await handleUploadReceipts(savedEntry.id);
            }

            // Close and reset immediately — before the background refresh so there's no form flash
            const hasReceipt = selectedFiles.length > 0;
            const editHadReceipt = editingEntry?.receiptUrl;
            const alreadyHandled = savedEntry?.hasMissingReceiptDeclaration || savedEntry?.noReceiptReason;
            const wasEditing = !!editingEntry;
            setShowForm(false);
            setEditingEntry(null);
            setSelectedFiles([]);
            setFormData({
                director: '',
                direction: 'OwedToDirector',
                description: '',
                category: '',
                ctTag: 'Revenue',
                amountNet: '',
                vatAmount: '0.00',
                amountGross: '',
                entryDate: new Date().toISOString().split('T')[0],
                datePaid: '',
                paymentMethod: '',
                notes: ''
            });
            if (!hasReceipt && !editHadReceipt && !alreadyHandled) {
                setReceiptRequiredModal({ savedId: savedEntry.id, savedEntry });
            } else {
                showToast(wasEditing ? 'DLA entry updated.' : 'DLA entry added.', 'success');
            }

            // Refresh list silently in the background
            loadData();
        } catch (error) {
            console.error('Error saving DLA entry:', error);
            showToast('Failed to save DLA entry. Please try again.', 'error');
        } finally {
            setProcessing(false);
        }
    };

    const handleUploadReceipts = async (dlaId) => {
        setUploadingReceipt(true);
        try {
            const headers = await getAuthHeaders();
            const authHeaders = { Authorization: headers.Authorization };
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch(`${API_BASE_URL}/dla/${dlaId}/upload`, {
                    method: 'POST',
                    headers: authHeaders,
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`Failed to upload ${file.name}`);
                }
            }
        } catch (error) {
            console.error('Error uploading receipts:', error);
            showToast('Some receipts failed to upload. Please try again.', 'error');
        } finally {
            setUploadingReceipt(false);
        }
    };

    const handleFileSelect = (e) => {
        setSelectedFiles(Array.from(e.target.files));
    };

    const openDlaDeclarationModal = (entry) => {
        setDeclarationForm({
            declarationType: 'DirectorExpenseDeclaration',
            declarerName: companySettings?.directorName || '',
            declarerRole: 'Director',
            declarerEmail: companySettings?.companyEmail || '',
            amountGross: entry.amountGross || entry.AmountGross || 0,
            merchantOrPayee: '',
            bankTransactionRef: '',
            expenseCategory: entry.category || '',
            description: entry.description || '',
            reasonReceiptMissing: 'NotProvided',
            otherReasonText: '',
            acknowledgementDisallowable: false,
            signatureType: 'TypedName',
            typedSignature: companySettings?.directorName || ''
        });
        setDeclarationModal({ dlaId: entry.id, entry });
    };

    const handleCreateDlaDeclaration = async () => {
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
            const created = await createDlaDeclaration(declarationModal.dlaId, declarationForm);
            await finaliseDlaDeclaration(declarationModal.dlaId);
            const declaredId = declarationModal.dlaId;
            setDeclarationModal(null);
            showToast(`✅ Declaration ${created.declarationId} created and finalised. VAT set to £0.00.`, 'success');
            // Immediately patch the list so the button switches from 📋 to 📎 without waiting for loadData()
            setDlaEntries(prev => prev.map(e =>
                e.id === declaredId
                    ? { ...e, hasMissingReceiptDeclaration: true, missingReceiptDeclarationRef: created.declarationId, vatAmount: 0, amountNet: e.amountGross }
                    : e
            ));
            // Patch viewingEntry in-place so the detail panel reflects the new state immediately
            if (viewingEntry?.id === declaredId) {
                setViewingEntry(v => v ? { ...v, hasMissingReceiptDeclaration: true, missingReceiptDeclarationRef: created.declarationId, vatAmount: 0, amountNet: v.amountGross } : v);
            }
            loadData();
        } catch (err) {
            showToast('Failed to create declaration: ' + err.message, 'error');
        } finally {
            setDeclarationSaving(false);
        }
    };

    const handleReceiptRequiredDlaDeclaration = () => {
        const { savedEntry } = receiptRequiredModal;
        setReceiptRequiredModal(null);
        setNoReceiptReasonValue('');
        setNoReceiptReasonOther('');
        openDlaDeclarationModal(savedEntry);
    };

    const handleDlaNoReceiptReasonSave = async () => {
        const finalReason = noReceiptReasonValue === 'Other' ? noReceiptReasonOther.trim() : noReceiptReasonValue;
        if (!finalReason) { showToast('Please select a reason.', 'error'); return; }
        setSavingNoReceiptReason(true);
        try {
            await patchDlaNoReceiptReason(receiptRequiredModal.savedId, finalReason);
            showToast('DLA entry saved.', 'success');
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

    const allowDataDeletion = companySettings?.allowDataDeletion === true;

    const toggleDeleteSelectId = (id) => setDeleteSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const selectAllForDelete = () => setDeleteSelectedIds(new Set(dlaEntries.map(e => e.id)));
    const clearDeleteSelection = () => setDeleteSelectedIds(new Set());

    const handleDeleteEntry = (id) => {
        const entry = dlaEntries.find(e => e.id === id);
        setConfirmModal({
            isOpen: true,
            title: 'Delete DLA Entry?',
            message: `Are you sure you want to permanently delete DLA entry ${entry?.dlaId || id}?`,
            itemLabels: entry ? [`${entry.dlaId} — ${entry.description || ''} — ${entry.director}`] : [],
            onConfirm: async () => {
                setConfirmModal(m => ({ ...m, isOpen: false }));
                try {
                    const headers = await getAuthHeaders();
                    const response = await fetch(`${API_BASE_URL}/dla/${id}`, { method: 'DELETE', headers });
                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error || `HTTP ${response.status}`);
                    }
                    showToast('DLA entry deleted.', 'success');
                    await loadData();
                } catch (error) {
                    console.error('Error deleting DLA entry:', error);
                    showToast('Failed to delete DLA entry: ' + error.message, 'error');
                }
            }
        });
    };

    const handleBulkDeleteDla = () => {
        const toDelete = dlaEntries.filter(e => deleteSelectedIds.has(e.id));
        if (toDelete.length === 0) return;
        setConfirmModal({
            isOpen: true,
            title: `Delete ${toDelete.length} DLA Entr${toDelete.length > 1 ? 'ies' : 'y'}?`,
            message: `You are about to permanently delete ${toDelete.length} DLA entr${toDelete.length > 1 ? 'ies' : 'y'}:`,
            itemLabels: toDelete.map(e => `${e.dlaId} — ${e.description || ''}`),
            onConfirm: async () => {
                setConfirmModal(m => ({ ...m, isOpen: false }));
                let failed = 0;
                for (const e of toDelete) {
                    try {
                        const headers = await getAuthHeaders();
                        const resp = await fetch(`${API_BASE_URL}/dla/${e.id}`, { method: 'DELETE', headers });
                        if (!resp.ok) failed++;
                    } catch { failed++; }
                }
                clearDeleteSelection();
                setDeleteSelectMode(false);
                await loadData();
                if (failed > 0) showToast(`${failed} deletion(s) failed.`, 'error');
                else showToast(`${toDelete.length} DLA entr${toDelete.length > 1 ? 'ies' : 'y'} deleted.`, 'success');
            }
        });
    };

    const openPaymentModal = (entry) => {
        setPaymentEntry(entry);
        setPaymentData({
            paymentAmount: entry?.remainingBalance?.toFixed(2) || '',
            paymentDate: new Date().toISOString().split('T')[0],
            paymentMethod: '',
            notes: ''
        });
        setShowPaymentModal(true);
    };

    const handlePaymentChange = (e) => {
        const { name, value } = e.target;
        const nextValue = name === 'paymentAmount' ? sanitizeMoneyInput(value) : value;
        setPaymentData(prev => ({ ...prev, [name]: nextValue }));
    };

    const submitPayment = async (e) => {
        e.preventDefault();
        if (!paymentEntry?.dlaId) return;

        setProcessing(true);
        try {
            const headers = await getAuthHeaders();
            const payload = {
                paymentAmount: parseFloat(paymentData.paymentAmount) || 0,
                paymentDate: new Date(paymentData.paymentDate).toISOString(),
                paymentMethod: paymentData.paymentMethod || null,
                notes: paymentData.notes
            };

            const response = await fetch(`${API_BASE_URL}/dla/${paymentEntry.dlaId}/payment`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Failed to record payment');
            }

            const result = await response.json();
            await loadData();
            setShowPaymentModal(false);
            setPaymentEntry(null);

            const emailWarning = result.emailNotification?.warning;
            const message = result.message || 'Payment recorded successfully';
            if (emailWarning) {
                showToast(`${message} | Email notification issue: ${emailWarning}`, 'warning');
            } else {
                showToast(message, 'success');
            }
        } catch (error) {
            console.error('Error recording payment:', error);
            alert('Failed to record payment. Please try again.');
        } finally {
            setProcessing(false);
        }
    };

    const openPaymentHistory = async (entry) => {
        try {
            setProcessing(true);
            const payments = await getDlaPayments(entry.dlaId);
            setPaymentHistory(Array.isArray(payments) ? payments : []);
            setPaymentEntry(entry);
            setShowPaymentHistory(true);
        } catch (error) {
            console.error('Error loading payment history:', error);
            alert('Failed to load payment history.');
        } finally {
            setProcessing(false);
        }
    };

    // ── Bulk payment handlers ────────────────────────────────────────────
    const toggleSelectEntry = (entryId) => {
        setSelectedEntries(prev => {
            const next = new Set(prev);
            if (next.has(entryId)) next.delete(entryId);
            else next.add(entryId);
            return next;
        });
    };

    const toggleSelectAll = (eligible) => {
        if (eligible.length === 0) return;
        const allSelected = eligible.every(e => selectedEntries.has(e.id));
        if (allSelected) {
            setSelectedEntries(new Set());
        } else {
            setSelectedEntries(new Set(eligible.map(e => e.id)));
        }
    };

    const handleBulkPaymentChange = (e) => {
        const { name, value, type, checked } = e.target;
        setBulkPaymentData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const openBulkPaymentModal = () => {
        const defaultRecipient = companySettings?.paymentsEmail || companySettings?.email || '';

        setBulkPaymentData({
            paymentDate: new Date().toISOString().split('T')[0],
            paymentMethod: '',
            notes: '',
            sendEmail: true,
            recipientEmail: defaultRecipient
        });
        setShowBulkPaymentModal(true);
    };

    const submitBulkPayment = async (e) => {
        e.preventDefault();
        if (selectedEntries.size === 0) return;

        setProcessing(true);
        try {
            const headers = await getAuthHeaders();
            const selectedDlaEntries = dlaEntries.filter(e => selectedEntries.has(e.id));
            const dlaIds = selectedDlaEntries.map(e => e.dlaId);

            if (bulkPaymentData.sendEmail && !bulkPaymentData.recipientEmail?.trim()) {
                showToast('Please enter an email address for the payment confirmation.', 'error');
                setProcessing(false);
                return;
            }

            const payload = {
                dlaIds,
                paymentDate: new Date(bulkPaymentData.paymentDate).toISOString(),
                paymentMethod: bulkPaymentData.paymentMethod || null,
                notes: bulkPaymentData.notes || null,
                sendEmail: bulkPaymentData.sendEmail !== false,
                recipientEmail: bulkPaymentData.sendEmail ? bulkPaymentData.recipientEmail.trim() : null
            };

            const response = await fetch(`${API_BASE_URL}/dla/batch-payment`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errBody = await response.text();
                console.error('Batch payment failed:', response.status, errBody);
                let errMessage = `Failed to record batch payment (${response.status})`;
                try {
                    const parsed = JSON.parse(errBody);
                    errMessage = parsed.error || parsed.message || errBody || errMessage;
                } catch {
                    if (errBody) errMessage = errBody;
                }
                throw new Error(errMessage);
            }

            const result = await response.json();
            console.log('Batch payment result:', JSON.stringify(result));
            await loadData();
            setShowBulkPaymentModal(false);
            setSelectedEntries(new Set());
            setSelectMode(false);

            const successCount = result.success?.length || 0;
            const errorCount = result.errors?.length || 0;
            const errorDetails = result.errors?.map(e => `${e.dlaId}: ${e.error}`).join(', ');
            const emailWarning = result.emailNotification?.warning;
            showToast(
                `Batch payment recorded: ${successCount} entr${successCount === 1 ? 'y' : 'ies'} paid off` +
                (result.reference ? ` | Ref: ${result.reference}` : '') +
                (errorCount > 0 ? ` | ${errorCount} skipped (${errorDetails})` : '') +
                (emailWarning ? ` | Email notification issue: ${emailWarning}` : ''),
                successCount === 0 ? 'error' : (errorCount > 0 || emailWarning) ? 'warning' : 'success'
            );
        } catch (error) {
            console.error('Error recording batch payment:', error);
            alert(error?.message || 'Failed to record batch payment. Please try again.');
        } finally {
            setProcessing(false);
        }
    };

    const exportDlaCsv = async () => {
        // Helper: escape a value for CSV — wraps in quotes, escapes internal quotes, strips newlines
        const csvField = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val).replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
            return str.includes(',') || str.includes('"') ? `"${str}"` : str;
        };

        try {
            const [entries, payments] = await Promise.all([
                getDlaEntries().catch(() => []),
                getAllDlaPayments().catch(() => [])
            ]);

            const lines = [];
            lines.push('DLA Entries');
            lines.push('DLA ID,Director,Direction,Description,Category,Entry Date,Date Paid,Net,VAT,Gross,Paid,Remaining');
            entries.forEach(entry => {
                lines.push([
                    csvField(entry.dlaId),
                    csvField(entry.director),
                    csvField(getDirectionLabel(entry.direction)),
                    csvField(entry.description),
                    csvField(entry.category),
                    csvField(entry.entryDate ? new Date(entry.entryDate).toLocaleDateString('en-GB') : ''),
                    csvField(entry.datePaid ? new Date(entry.datePaid).toLocaleDateString('en-GB') : ''),
                    entry.amountNet ?? '',
                    entry.vatAmount ?? '',
                    entry.amountGross ?? '',
                    entry.amountPaid ?? '',
                    entry.remainingBalance ?? ''
                ].join(','));
            });

            lines.push('');
            lines.push('DLA Payments');
            lines.push('Payment ID,DLA ID,Director,Amount,Payment Date,Method,Notes');
            payments.forEach(payment => {
                lines.push([
                    csvField(payment.paymentId),
                    csvField(payment.dlaId),
                    csvField(payment.director),
                    payment.amount ?? '',
                    csvField(payment.paymentDate ? new Date(payment.paymentDate).toLocaleDateString('en-GB') : ''),
                    csvField(payment.paymentMethod),
                    csvField(payment.notes)
                ].join(','));
            });

            const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `DLA-Audit-${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting DLA CSV:', error);
            alert('Failed to export DLA CSV.');
        }
    };

    const handleViewReceipts = async (entry) => {
        // No receipt attached — route to declaration PDF or reason info
        if (!entry.receiptUrl) {
            if (entry.hasMissingReceiptDeclaration) {
                window.open(getDlaDeclarationPdfUrl(entry.id), '_blank');
            } else if (entry.noReceiptReason) {
                setNoReceiptInfoModal({ entry });
            } else {
                showToast('No receipt or declaration found for this entry.', 'info');
            }
            return;
        }

        // Has a receipt — open the viewer modal as normal
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setPreviewMime(null);
        setPreviewFileName(null);
        setViewingReceipts(entry);
        setShowReceiptsModal(true);

        if (!entry.receiptUrl) return;

        // Extract filename from blob URL and URL-encode it for safe routing
        const rawFilename = entry.receiptUrl.split('/').pop().split('?')[0];
        const filename = decodeURIComponent(rawFilename); // normalise any existing encoding
        setPreviewFileName(filename);
        setPreviewLoading(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_BASE_URL}/dla/${entry.id}/receipts/${encodeURIComponent(filename)}`, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const mime = res.headers.get('Content-Type') || 'application/octet-stream';
            const blob = await res.blob();
            setPreviewUrl(URL.createObjectURL(blob));
            setPreviewMime(mime);
        } catch (err) {
            console.error('Failed to load receipt preview:', err);
            // Leave previewUrl null — UI will show fallback download button
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleCloseReceiptsModal = () => {
        setShowReceiptsModal(false);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setPreviewMime(null);
        setPreviewFileName(null);
    };

    const handleDownloadReceipt = () => {
        if (!previewUrl || !previewFileName) return;
        const a = document.createElement('a');
        a.href = previewUrl;
        a.download = previewFileName;
        a.click();
    };

    const handleOpenReceiptTab = () => {
        if (!previewUrl) return;
        window.open(previewUrl, '_blank', 'noopener,noreferrer');
    };

    // ── DLA Document viewer / uploader ──────────────────────────────────────
    const handleViewDocument = async (doc) => {
        if (docViewerUrl) URL.revokeObjectURL(docViewerUrl);
        setDocViewerUrl(null);
        setDocViewerMime(null);
        setDocViewerFileName(doc.fileName || 'document');
        setDocViewerLoading(true);
        setShowDocViewerModal(true);
        try {
            const blob = await downloadDocument(doc.blobName);
            setDocViewerUrl(URL.createObjectURL(blob));
            setDocViewerMime(blob.type || 'application/octet-stream');
        } catch (err) {
            console.error('Failed to load document preview:', err);
            alert('Failed to load document: ' + err.message);
            setShowDocViewerModal(false);
        } finally {
            setDocViewerLoading(false);
        }
    };

    const handleCloseDocViewer = () => {
        setShowDocViewerModal(false);
        if (docViewerUrl) URL.revokeObjectURL(docViewerUrl);
        setDocViewerUrl(null);
        setDocViewerMime(null);
        setDocViewerFileName(null);
    };

    const handleDownloadDocument = async (doc) => {
        try {
            const blob = await downloadDocument(doc.blobName);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = doc.fileName || 'document';
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to download document:', err);
            alert('Failed to download document: ' + err.message);
        }
    };

    const handleUploadDlaDocument = async () => {
        if (!docUploadFile) { alert('Please select a file.'); return; }
        setDocUploadLoading(true);
        try {
            await uploadDocument(docUploadFile, {
                documentType: docUploadType,
                relatedEntity: 'DLA:agreements',
                notes: ''
            });
            setDocUploadFile(null);
            setDocUploadType('DLA Agreement');
            setShowDocUploadForm(false);
            const input = document.getElementById('dlaDocFileInput');
            if (input) input.value = '';
            await loadData();
        } catch (err) {
            console.error('Failed to upload DLA document:', err);
            alert('Failed to upload document: ' + err.message);
        } finally {
            setDocUploadLoading(false);
        }
    };

    const handleDeleteDlaDocument = async (doc) => {
        if (!confirm(`Delete "${doc.fileName}"?`)) return;
        try {
            await deleteDocument(doc.blobName || doc.url);
            await loadData();
        } catch (err) {
            console.error('Error deleting document:', err);
            alert('Failed to delete document: ' + err.message);
        }
    };

    // ── Invoice Quick Capture ─────────────────────────────────────────────────
    const handleCaptureDrop = (e) => {
        e.preventDefault();
        setCaptureDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) openInvoiceCapture(file);
    };

    const openInvoiceCapture = async (file) => {
        setCaptureInvoiceFile(file);
        setCaptureInvoiceUrl(URL.createObjectURL(file));
        setCaptureInvoiceMime(file.type);
        setCaptureHeader({
            director: directors[0] || '',
            vendor: '',
            invoiceDate: new Date().toISOString().split('T')[0],
            invoiceRef: '',
            direction: 'OwedToDirector',
            category: ''
        });
        setCaptureLines([{ description: '', amountNet: '', vatAmount: '0.00', amountGross: '', vatExempt: false }]);
        setCaptureScanToast(null);
        setShowInvoiceCapture(true);

        // Auto-scan with Azure Document Intelligence
        setCaptureScanning(true);
        try {
            const scan = await analyzeInvoice(file);
            if (!scan.configured) {
                setCaptureScanToast('noOcr');
            } else if (scan.found) {
                // Pre-fill header
                setCaptureHeader(prev => ({
                    ...prev,
                    vendor:      scan.vendor      || prev.vendor,
                    invoiceDate: scan.invoiceDate || prev.invoiceDate,
                    invoiceRef:  scan.invoiceRef  || prev.invoiceRef
                }));
                // Pre-fill lines
                if (scan.lines && scan.lines.length > 0) {
                    setCaptureLines(scan.lines.map(l => ({
                        description: l.description || '',
                        amountNet:   l.amountNet   ? l.amountNet.toFixed(2)   : '',
                        vatAmount:   l.vatAmount   ? l.vatAmount.toFixed(2)   : '0.00',
                        amountGross: l.amountGross ? l.amountGross.toFixed(2) : '',
                        vatExempt:   (l.vatAmount || 0) === 0
                    })));
                }
                setCaptureScanToast('success');
            } else {
                setCaptureScanToast('error');
            }
        } catch (err) {
            console.warn('Invoice scan failed:', err.message);
            setCaptureScanToast('error');
        } finally {
            setCaptureScanning(false);
        }
    };

    const addCaptureLine = () => {
        setCaptureLines(prev => [...prev, { description: '', amountNet: '', vatAmount: '0.00', amountGross: '', vatExempt: false }]);
    };

    const removeCaptureLine = (idx) => {
        setCaptureLines(prev => prev.filter((_, i) => i !== idx));
    };

    const updateCaptureLine = (idx, field, value) => {
        setCaptureLines(prev => prev.map((line, i) => {
            if (i !== idx) return line;
            const next = { ...line, [field]: value };
            if (field === 'vatExempt') {
                if (value) { next.vatAmount = '0.00'; next.amountGross = next.amountNet; }
                else {
                    const vat = Math.round((parseFloat(next.amountNet) || 0) * 0.2 * 100) / 100;
                    next.vatAmount = vat.toFixed(2);
                    next.amountGross = ((parseFloat(next.amountNet) || 0) + vat).toFixed(2);
                }
            } else if (field === 'amountNet') {
                const net = parseFloat(value) || 0;
                if (!next.vatExempt) {
                    const vat = Math.round(net * 0.2 * 100) / 100;
                    next.vatAmount = vat.toFixed(2);
                    next.amountGross = (net + vat).toFixed(2);
                } else { next.amountGross = net.toFixed(2); }
            } else if (field === 'vatAmount') {
                next.amountGross = ((parseFloat(next.amountNet) || 0) + (parseFloat(value) || 0)).toFixed(2);
            } else if (field === 'amountGross') {
                const gross = parseFloat(value) || 0;
                if (!next.vatExempt) {
                    const net = Math.round((gross / 1.2) * 100) / 100;
                    next.amountNet = net.toFixed(2);
                    next.vatAmount = (gross - net).toFixed(2);
                } else { next.amountNet = gross.toFixed(2); }
            }
            return next;
        }));
    };

    const blurCaptureLine = (idx, field) => {
        setCaptureLines(prev => prev.map((line, i) => {
            if (i !== idx) return line;
            const val = parseFloat(line[field]);
            return { ...line, [field]: Number.isFinite(val) ? val.toFixed(2) : '' };
        }));
    };

    const submitInvoiceCapture = async () => {
        if (!captureInvoiceFile) return;
        const validLines = captureLines.filter(l => l.description && (parseFloat(l.amountGross) || 0) > 0);
        if (validLines.length === 0) { showToast('Please add at least one line item with a description and amount.', 'error'); return; }
        if (!captureHeader.director) { showToast('Please select a director.', 'error'); return; }

        setCaptureSubmitting(true);
        try {
            const headers = await getAuthHeaders();
            const invoiceRef = captureHeader.invoiceRef ? ` [${captureHeader.invoiceRef}]` : '';
            const vendorPrefix = captureHeader.vendor ? `${captureHeader.vendor} - ` : '';
            const invoiceNotes = captureHeader.vendor
                ? `Invoice from ${captureHeader.vendor}${captureHeader.invoiceRef ? ', Ref: ' + captureHeader.invoiceRef : ''}`
                : '';

            // 1. Create a DLA entry for each line item (without receipt URL first)
            const createdIds = [];
            for (const line of validLines) {
                const entryData = {
                    director: captureHeader.director,
                    direction: captureHeader.direction,
                    description: `${vendorPrefix}${line.description}${invoiceRef}`,
                    category: captureHeader.category || '',
                    amountNet: parseFloat(line.amountNet) || 0,
                    vatAmount: parseFloat(line.vatAmount) || 0,
                    amountGross: parseFloat(line.amountGross) || 0,
                    entryDate: new Date(captureHeader.invoiceDate).toISOString(),
                    taxYear: calculateTaxYear(captureHeader.invoiceDate),
                    financialYear: calculateFinancialYear(captureHeader.invoiceDate),
                    notes: invoiceNotes
                };
                const res = await fetch(`${API_BASE_URL}/dla`, { method: 'POST', headers, body: JSON.stringify(entryData) });
                if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    throw new Error(`Failed to create DLA entry: ${errText}`);
                }
                const created = await res.json();
                createdIds.push(created.id);
            }

            // 2. Upload the invoice receipt to the first created entry using the DLA receipt endpoint
            if (captureInvoiceFile && createdIds.length > 0) {
                setCaptureUploading(true);
                try {
                    const formData = new FormData();
                    formData.append('file', captureInvoiceFile);
                    const uploadRes = await fetch(`${API_BASE_URL}/dla/${createdIds[0]}/upload`, {
                        method: 'POST',
                        headers: { Authorization: headers.Authorization },
                        body: formData
                    });
                    if (uploadRes.ok) {
                        const uploadResult = await uploadRes.json();
                        const receiptUrl = uploadResult?.url || null;
                        // Patch remaining entries with the same receipt URL
                        if (receiptUrl && createdIds.length > 1) {
                            const allEntries = await fetch(`${API_BASE_URL}/dla`, { headers }).then(r => r.json());
                            for (const entryId of createdIds.slice(1)) {
                                const entry = allEntries.find(e => e.id === entryId);
                                if (entry) {
                                    await fetch(`${API_BASE_URL}/dla/${entryId}`, {
                                        method: 'PUT',
                                        headers,
                                        body: JSON.stringify({ ...entry, receiptUrl })
                                    });
                                }
                            }
                        }
                    }
                } catch (uploadErr) {
                    console.warn('Receipt upload failed (entries still created):', uploadErr);
                } finally {
                    setCaptureUploading(false);
                }
            }

            await loadData();

            // Auto-add vendor to Payees/Suppliers list if not already present
            if (captureHeader.vendor && captureHeader.vendor.trim()) {
                try {
                    const vendorName = captureHeader.vendor.trim();
                    const existingSuppliers = await getSuppliers().catch(() => []);
                    const alreadyExists = existingSuppliers.some(s =>
                        (s.name || '').toLowerCase() === vendorName.toLowerCase()
                    );
                    if (!alreadyExists) {
                        const codeResult = await generateCode(vendorName, 'Supplier').catch(() => ({
                            code: vendorName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'VENDOR'
                        }));
                        await createSupplier({
                            name: vendorName,
                            supplierCode: codeResult.code,
                            payeeType: 'Supplier',
                            isActive: true,
                            category: captureHeader.category || '',
                            currency: 'GBP',
                            defaultVATRate: 20
                        });
                        showToast(`"${vendorName}" added to Payees list`, 'success');
                    }
                } catch (supplierErr) {
                    // Non-fatal — entries already created
                    console.warn('Could not auto-add supplier:', supplierErr);
                }
            }

            setShowInvoiceCapture(false);
            if (captureInvoiceUrl) URL.revokeObjectURL(captureInvoiceUrl);
            setCaptureInvoiceFile(null);
            setCaptureInvoiceUrl(null);
            showToast(`Created ${validLines.length} DLA entr${validLines.length === 1 ? 'y' : 'ies'} from invoice`, 'success');
        } catch (err) {
            console.error('Invoice capture failed:', err);
            showToast('Failed to process invoice: ' + err.message, 'error');
        } finally {
            setCaptureSubmitting(false);
            setCaptureUploading(false);
        }
    };

    const captureLineTotals = captureLines.reduce((acc, l) => ({
        net: acc.net + (parseFloat(l.amountNet) || 0),
        vat: acc.vat + (parseFloat(l.vatAmount) || 0),
        gross: acc.gross + (parseFloat(l.amountGross) || 0)
    }), { net: 0, vat: 0, gross: 0 });

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: 'GBP'
        }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-GB');
    };
    const openStartupModal = () => {
        console.log('Startup DLA Capture button clicked');
        const batchId = `DLA-${Date.now()}`;
        setStartupBatchId(batchId);
        setStartupMode('Single');
        setStartupForm({
            director: '',
            totalAmount: '',
            vatAmount: '0.00',
            totalGross: '',
            canClaimVat: false,
            entryDate: new Date().toISOString().split('T')[0],
            category: 'Startup Costs',
            ctTag: 'Revenue',
            rationale: ''
        });
        setStartupItems([]);
        setStartupDocs({ statutory: [], evidence: [] });
        setShowStartupModal(true);
        console.log('ShowStartupModal set to true');
    };

    const handleStartupFormChange = (field, value) => {
        setStartupForm(prev => {
            const moneyFields = ['totalAmount', 'vatAmount', 'totalGross'];
            const nextValue = moneyFields.includes(field) ? sanitizeMoneyInput(value) : value;
            const updated = { ...prev, [field]: nextValue };
            
            // If toggling VAT checkbox off, reset VAT to 0
            if (field === 'canClaimVat' && !value) {
                updated.vatAmount = '0.00';
                const net = parseFloat(updated.totalAmount) || 0;
                updated.totalGross = net.toFixed(2);
            }
            // Auto-calculate totals
            else if (field === 'totalAmount' || field === 'vatAmount') {
                const net = parseFloat(updated.totalAmount) || 0;
                const vat = parseFloat(updated.vatAmount) || 0;
                updated.totalGross = (net + vat).toFixed(2);
            } else if (field === 'totalGross') {
                const gross = parseFloat(updated.totalGross) || 0;
                const vat = parseFloat(updated.vatAmount) || 0;
                updated.totalAmount = (gross - vat).toFixed(2);
            }
            
            return updated;
        });
    };

    const addStartupItem = () => {
        setStartupItems(prev => ([
            ...prev,
            {
                entryDate: new Date().toISOString().split('T')[0],
                description: '',
                category: 'Startup Costs',
                ctTag: 'Revenue',
                amountNet: '',
                vatAmount: '0.00',
                amountGross: ''
            }
        ]));
    };

    const updateStartupItem = (index, field, value) => {
        setStartupItems(prev => prev.map((item, idx) => {
            if (idx !== index) return item;
            const moneyFields = ['amountNet', 'vatAmount', 'amountGross'];
            const nextValue = moneyFields.includes(field) ? sanitizeMoneyInput(value) : value;
            const updated = { ...item, [field]: nextValue };
            if (field === 'amountNet' || field === 'vatAmount') {
                const net = parseFloat(updated.amountNet) || 0;
                const vat = parseFloat(updated.vatAmount) || 0;
                updated.amountGross = (net + vat).toFixed(2);
            } else if (field === 'amountGross') {
                const gross = parseFloat(updated.amountGross) || 0;
                const vat = parseFloat(updated.vatAmount) || 0;
                updated.amountNet = (gross - vat).toFixed(2);
            }
            return updated;
        }));
    };

    const normalizeStartupItem = (index, field) => {
        setStartupItems(prev => prev.map((item, idx) => {
            if (idx !== index) return item;
            return { ...item, [field]: formatMoneyInput(item[field]) };
        }));
    };

    const removeStartupItem = (index) => {
        setStartupItems(prev => prev.filter((_, idx) => idx !== index));
    };

    const uploadStartupDocs = async (files, docType) => {
        if (!files || files.length === 0) return;
        const uploads = [];
        for (const file of files) {
            const renamed = new File([file], `DLA_${file.name}`, { type: file.type });
            const metadata = {
                documentType: docType,
                personName: startupForm.director,
                relatedEntity: `DLA:${startupBatchId}`,
                notes: 'DLA Startup'
            };
            const uploaded = await uploadDocument(renamed, metadata);
            uploads.push(uploaded);
        }

        setStartupDocs(prev => ({
            ...prev,
            [docType === 'Statutory Document' ? 'statutory' : 'evidence']: [...prev[docType === 'Statutory Document' ? 'statutory' : 'evidence'], ...uploads]
        }));
    };

    const submitStartupCapture = async (e) => {
        e.preventDefault();
        setProcessing(true);
        try {
            const supportingCount = startupDocs.statutory.length + startupDocs.evidence.length;
            if (supportingCount === 0) {
                alert('Please upload at least one supporting document.');
                return;
            }

            const payload = {
                mode: startupMode,
                director: startupForm.director,
                batchId: startupBatchId,
                entryDate: new Date(startupForm.entryDate).toISOString(),
                category: startupForm.category,
                ctTag: startupForm.ctTag,
                totalAmount: parseFloat(startupForm.totalAmount) || 0,
                rationale: startupForm.rationale,
                supportingDocumentCount: supportingCount,
                items: startupItems.map(item => ({
                    entryDate: new Date(item.entryDate).toISOString(),
                    description: item.description,
                    category: item.category,
                    ctTag: item.ctTag,
                    amountNet: parseFloat(item.amountNet) || 0,
                    vatAmount: parseFloat(item.vatAmount) || 0,
                    amountGross: parseFloat(item.amountGross) || 0
                }))
            };

            const headers = await getAuthHeaders();
            const response = await fetch(`${API_BASE_URL}/dla/startup`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Failed to create startup DLA capture');
            }

            await loadData();
            setShowStartupModal(false);
        } catch (error) {
            console.error('Error creating startup capture:', error);
            alert('Failed to create startup DLA capture.');
        } finally {
            setProcessing(false);
        }
    };

    const ctBreakdown = (entries) => {
        const breakdown = {
            Revenue: 0,
            Capital: 0,
            NonCT: 0
        };

        const categoryTotals = {};
        entries.forEach(entry => {
            const tag = entry.ctTag || 'Revenue';
            breakdown[tag] = (breakdown[tag] || 0) + (entry.amountGross || 0);
            const key = `${tag}:${entry.category || 'Uncategorized'}`;
            categoryTotals[key] = (categoryTotals[key] || 0) + (entry.amountGross || 0);
        });

        return { breakdown, categoryTotals };
    };

    const startupEntries = dlaEntries.filter(entry => entry.isStartupCost);
    const startupCt = ctBreakdown(startupEntries);
    const allCt = ctBreakdown(dlaEntries);

    const getDirectionLabel = (direction) => {
        return direction === 'OwedToCompany'
            ? 'Paid by company (owed to business)'
            : 'Paid by director (owed to director)';
    };

    const compliance = calculateDlaCompliance(dlaEntries, companySettings);

    // ── Filter & pagination computations ────────────────────────────────────
    const uniqueYears = [...new Set(dlaEntries.map(e => e.taxYear).filter(Boolean))].sort().reverse();

    const filtered = dlaEntries.filter(e => {
        if (filterText) {
            const haystack = `${e.description || ''} ${e.category || ''} ${e.dlaId || ''}`.toLowerCase();
            if (!haystack.includes(filterText.toLowerCase())) return false;
        }
        if (filterDirection && e.direction !== filterDirection) return false;
        if (filterCtTag && e.ctTag !== filterCtTag) return false;
        if (filterYear && e.taxYear !== filterYear) return false;
        if (filterPaymentStatus) {
            const isPaid = (e.remainingBalance || 0) <= 0 && e.datePaid;
            const isPartial = (e.amountPaid || 0) > 0 && (e.remainingBalance || 0) > 0;
            if (filterPaymentStatus === 'paid' && !isPaid) return false;
            if (filterPaymentStatus === 'unpaid' && (isPaid || isPartial)) return false;
            if (filterPaymentStatus === 'partial' && !isPartial) return false;
        }
        return true;
    });

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const filterTotalNet = filtered.reduce((s, e) => s + (e.amountNet || 0), 0);
    const filterTotalVat = filtered.reduce((s, e) => s + (e.vatAmount || 0), 0);
    // VAT reclaimable: exclude NonCT items (no CT relief = no VAT relief)
    // The gross amount still counts in the DLA total — only VAT reclaim is blocked
    const filterVatReclaimable = filtered
        .filter(e => e.ctTag !== 'NonCT')
        .reduce((s, e) => s + (e.vatAmount || 0), 0);
    const vatExcludedEntries = filtered.filter(e => e.ctTag === 'NonCT' && (e.vatAmount || 0) > 0);
    const filterTotalGross = filtered.reduce((s, e) => s + (e.amountGross || 0), 0);
    const filterTotalPaid = filtered.reduce((s, e) => s + (e.amountPaid || 0), 0);
    const filterTotalOutstanding = filtered.reduce((s, e) => s + (e.remainingBalance || 0), 0);
    const filterCtRelief = filtered
        .filter(e => e.direction === 'OwedToDirector' && e.ctTag !== 'NonCT')
        .reduce((s, e) => s + (e.amountNet || 0), 0);

    if (loading) {
        return <div className="loading">Loading DLA entries...</div>;
    }

    return (
        <div className="dla-container">
            <Toast toast={toast} onClose={clearToast} />
            <div className="page-header">
                <h2>Directors Loan Account (DLA)</h2>
                <div className="toolbar-actions">
                    <button className="btn-secondary" onClick={exportDlaCsv}>
                        📄 Export DLA CSV
                    </button>
                    <button className="btn-secondary" onClick={() => setShowInvoiceCapture(true)} style={{marginLeft: '5px'}}>
                        📥 Capture Invoice
                    </button>
                    <button
                        className="btn-secondary"
                        onClick={() => setShowTrivialBenefit(true)}
                        title="Record an HMRC s.323 Trivial Benefit (max £50, max 6/year)"
                        style={{ marginLeft: '5px', opacity: trivialSummary?.isAtLimit ? 0.5 : 1 }}
                    >
                        🎁 Trivial Benefit
                        {trivialSummary && (
                            <span style={{ marginLeft: '0.4rem', fontSize: '0.78rem', opacity: 0.8 }}>
                                ({trivialSummary.count}/{trivialSummary.limit})
                            </span>
                        )}
                    </button>
                    <button className="btn-primary" onClick={handleAddEntry} style={{marginLeft: '5px'}}>
                        ➕ Add DLA Entry
                    </button>
                </div>
            </div>

            {/* Drag & drop zone */}
            <div
                onDragOver={e => { e.preventDefault(); setCaptureDragOver(true); }}
                onDragLeave={() => setCaptureDragOver(false)}
                onDrop={handleCaptureDrop}
                style={{
                    border: `2px dashed ${captureDragOver ? '#3b82f6' : '#cbd5e1'}`,
                    borderRadius: '8px',
                    padding: '1rem',
                    textAlign: 'center',
                    marginBottom: '1.25rem',
                    background: captureDragOver ? 'rgba(59,130,246,0.05)' : 'transparent',
                    color: '#94a3b8',
                    fontSize: '0.85rem',
                    transition: 'all 0.15s',
                    cursor: 'pointer'
                }}
                onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='image/*,.pdf'; i.onchange = e => e.target.files[0] && openInvoiceCapture(e.target.files[0]); i.click(); }}
            >
                📎 Drop an invoice here (or click) to auto-create DLA entries
            </div>

            <div className="info-note">
                <small>
                    Use DLA for director-paid company costs (e.g. devices, software, services). Director meals, travel and hotels should be recorded as normal expenses.
                </small>
            </div>

            <div className="dla-summary">
                {/* ── Totals & CT ─── */}
                {(() => {
                    const owedToDirectorEntries = dlaEntries.filter(e => e.direction === 'OwedToDirector');
                    const totalCharged = owedToDirectorEntries.reduce((s, e) => s + (e.amountGross || 0), 0);
                    const totalPaid = owedToDirectorEntries.reduce((s, e) => s + (e.amountPaid || 0), 0);
                    const ctDeductible = owedToDirectorEntries
                        .filter(e => e.ctTag !== 'NonCT')
                        .reduce((s, e) => s + (e.amountNet || 0), 0);
                    // Estimated CT saving at small-company rate (19%)
                    const ctSaving = Math.round(ctDeductible * 0.19 * 100) / 100;
                    return (
                        <>
                            <div className="summary-item">
                                <span>Total DLA charged (gross)</span>
                                <strong>{formatCurrency(totalCharged)}</strong>
                            </div>
                            <div className="summary-item">
                                <span>Total paid back</span>
                                <strong>{formatCurrency(totalPaid)}</strong>
                            </div>
                        </>
                    );
                })()}
                <div className="summary-item">
                    <span>Outstanding (company owes director)</span>
                    <strong className="positive">{formatCurrency(compliance.totalOwedToDirector)}</strong>
                </div>
                {compliance.totalOwedToCompany > 0 && (
                    <div className="summary-item">
                        <span>Director owes company</span>
                        <strong className="negative">{formatCurrency(compliance.totalOwedToCompany)}</strong>
                    </div>
                )}
                {/* CT relief */}
                {(() => {
                    const owedToDirectorEntries = dlaEntries.filter(e => e.direction === 'OwedToDirector');
                    const ctDeductible = owedToDirectorEntries
                        .filter(e => e.ctTag !== 'NonCT')
                        .reduce((s, e) => s + (e.amountNet || 0), 0);
                    const ctSaving = Math.round(ctDeductible * 0.19 * 100) / 100;
                    return ctDeductible > 0 ? (
                        <>
                            <div className="summary-item" title="Net amount of Revenue/Capital DLA entries — reduces taxable profit">
                                <span>CT-deductible (all-time net)</span>
                                <strong style={{ color: '#16a34a' }}>{formatCurrency(ctDeductible)}</strong>
                            </div>
                            <div className="summary-item" title="Estimated CT saving at 19% small-company rate">
                                <span>Est. CT saving (~19%)</span>
                                <strong style={{ color: '#16a34a' }}>{formatCurrency(ctSaving)}</strong>
                            </div>
                        </>
                    ) : null;
                })()}
                <div className="summary-item">
                    <span>S455 due now</span>
                    <strong className={compliance.s455DueTotal > 0 ? 'danger' : ''}>
                        {formatCurrency(compliance.s455DueTotal)}
                    </strong>
                </div>
                <div className="summary-item">
                    <span>S455 pending</span>
                    <strong>{formatCurrency(compliance.s455PendingTotal)}</strong>
                </div>
                <div className="summary-item">
                    <span>BIK risk entries</span>
                    <strong>{compliance.bikRiskCount}</strong>
                </div>
            </div>

            <div className="info-card" style={{ marginBottom: '1.5rem' }}>
                <h3>CT Breakdown — All DLA Entries</h3>
                <div className="info-content">
                    <div className="info-row">
                        <span>Revenue (CT-deductible)</span>
                        <strong style={{ color: '#22c55e' }}>{formatCurrency(allCt.breakdown.Revenue || 0)}</strong>
                    </div>
                    <div className="info-row">
                        <span>Capital (capital allowances)</span>
                        <strong style={{ color: '#3b82f6' }}>{formatCurrency(allCt.breakdown.Capital || 0)}</strong>
                    </div>
                    <div className="info-row">
                        <span>Non-CT (not deductible)</span>
                        <strong style={{ color: '#f59e0b' }}>{formatCurrency(allCt.breakdown.NonCT || 0)}</strong>
                    </div>
                    {startupEntries.length > 0 && (
                        <div className="info-row" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.15)', opacity: 0.8 }}>
                            <span>↳ of which startup costs (pre-incorporation)</span>
                            <strong>{formatCurrency(startupEntries.reduce((s, e) => s + (e.amountGross || 0), 0))}</strong>
                        </div>
                    )}
                </div>
            </div>

            {/* ── DLA Agreements & Supporting Documents ─────────────────────── */}
            <div className="info-card" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0 }}>DLA Agreements &amp; Documents</h3>
                    <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                        onClick={() => setShowDocUploadForm(v => !v)}
                    >
                        {showDocUploadForm ? 'Cancel' : '+ Upload Document'}
                    </button>
                </div>

                {showDocUploadForm && (
                    <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div style={{ flex: '1 1 200px' }}>
                                <label style={{ display: 'block', fontSize: '0.78rem', marginBottom: '0.25rem', opacity: 0.8 }}>Document Type</label>
                                <select
                                    value={docUploadType}
                                    onChange={e => setDocUploadType(e.target.value)}
                                    style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: 'inherit' }}
                                >
                                    {DLA_DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: '2 1 260px' }}>
                                <label style={{ display: 'block', fontSize: '0.78rem', marginBottom: '0.25rem', opacity: 0.8 }}>File</label>
                                <input
                                    id="dlaDocFileInput"
                                    type="file"
                                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls"
                                    onChange={e => setDocUploadFile(e.target.files[0] || null)}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <button
                                className="btn btn-primary"
                                style={{ fontSize: '0.8rem', padding: '0.4rem 1rem', whiteSpace: 'nowrap' }}
                                onClick={handleUploadDlaDocument}
                                disabled={docUploadLoading || !docUploadFile}
                            >
                                {docUploadLoading ? 'Uploading…' : 'Upload'}
                            </button>
                        </div>
                    </div>
                )}

                {dlaDocuments.length === 0 ? (
                    <p style={{ opacity: 0.6, fontSize: '0.85rem', margin: '0.5rem 0' }}>
                        No documents uploaded yet. Upload DLA agreements, asset transfer agreements, board resolutions and other supporting documents here.
                    </p>
                ) : (
                    <div className="info-content">
                        {dlaDocuments.map(doc => (
                            <div key={doc.blobName || doc.url} className="info-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</span>
                                    {doc.documentType && (
                                        <span style={{ fontSize: '0.72rem', opacity: 0.6 }}>{doc.documentType}</span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                                        onClick={() => handleViewDocument(doc)}
                                        title="View"
                                    >
                                        👁 View
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                                        onClick={() => handleDownloadDocument(doc)}
                                        title="Download"
                                    >
                                        ⬇
                                    </button>
                                    <button
                                        onClick={() => handleDeleteDlaDocument(doc)}
                                        className="btn-icon"
                                        title="Delete"
                                        style={{ padding: '0.2rem 0.4rem', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Document Viewer Modal ─────────────────────────────────────── */}
            {showDocViewerModal && (
                <div className="modal-overlay" onClick={handleCloseDocViewer}>
                    <div className="modal-content" style={{ maxWidth: '900px', width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docViewerFileName}</h3>
                            <button className="btn-close" onClick={handleCloseDocViewer}>✖</button>
                        </div>
                        <div style={{ flex: 1, overflow: 'auto', minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}>
                            {docViewerLoading ? (
                                <div style={{ color: '#fff', opacity: 0.7 }}>Loading…</div>
                            ) : docViewerUrl && docViewerMime?.startsWith('image/') ? (
                                <img src={docViewerUrl} alt={docViewerFileName} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
                            ) : docViewerUrl ? (
                                <iframe src={docViewerUrl} title={docViewerFileName} style={{ width: '100%', height: '70vh', border: 'none' }} />
                            ) : null}
                        </div>
                        <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <button className="btn btn-secondary" style={{ fontSize: '0.85rem' }}
                                onClick={() => { if (docViewerUrl) window.open(docViewerUrl, '_blank', 'noopener,noreferrer'); }}
                                disabled={!docViewerUrl}
                            >
                                Open in Tab
                            </button>
                            <button className="btn btn-primary" style={{ fontSize: '0.85rem' }}
                                onClick={() => {
                                    if (!docViewerUrl) return;
                                    const a = document.createElement('a');
                                    a.href = docViewerUrl;
                                    a.download = docViewerFileName || 'document';
                                    a.click();
                                }}
                                disabled={!docViewerUrl}
                            >
                                Download
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showForm && (
                <div className="modal-overlay" onClick={() => !processing && setShowForm(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingEntry ? 'Edit DLA Entry' : 'Add DLA Entry'}</h3>
                            <button 
                                className="btn-close" 
                                onClick={() => setShowForm(false)}
                                disabled={processing}
                            >
                                ✖
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="dla-form">
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Director *</label>
                                    <select
                                        name="director"
                                        value={formData.director}
                                        onChange={handleInputChange}
                                        required
                                    >
                                        <option value="">Select Director</option>
                                        {directors.map(dir => (
                                            <option key={dir} value={dir}>{dir}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Transaction *</label>
                                    <select
                                        name="direction"
                                        value={formData.direction}
                                        onChange={handleInputChange}
                                        required
                                    >
                                        <option value="OwedToDirector">Paid by director (owed to director)</option>
                                        <option value="OwedToCompany">Paid by company (owed to business)</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Description *</label>
                                    <input
                                        type="text"
                                        name="description"
                                        value={formData.description}
                                        onChange={handleInputChange}
                                        placeholder="e.g., Personal expense reimbursement"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Category</label>
                                    <select
                                        name="category"
                                        value={formData.category}
                                        onChange={handleInputChange}
                                    >
                                        <option value="">Select Category</option>
                                        {categories.map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>
                                        CT Treatment
                                        {formData.ctTag === 'NonCT' && (
                                            <span style={{ marginLeft: '6px', fontSize: '0.72rem', fontWeight: 600, color: '#fff', backgroundColor: '#dc3545', padding: '1px 6px', borderRadius: '10px' }}>
                                                Non-CT
                                            </span>
                                        )}
                                    </label>
                                    <select
                                        name="ctTag"
                                        value={formData.ctTag}
                                        onChange={handleInputChange}
                                    >
                                        <option value="Revenue">Revenue (CT-deductible)</option>
                                        <option value="Capital">Capital (capital allowances)</option>
                                        <option value="NonCT">Non-CT (disallowed)</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Entry Date *</label>
                                    <input
                                        type="date"
                                        name="entryDate"
                                        value={formData.entryDate}
                                        onChange={handleInputChange}
                                        required
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <div className="classification-status">
                                        <small>{classificationStatus || ''}</small>
                                    </div>
                                </div>

                                <div className="form-group full-width">
                                    <button
                                        type="button"
                                        className="btn-text"
                                        onClick={() => setShowAdvanced(!showAdvanced)}
                                    >
                                        {showAdvanced ? '▼' : '▶'} Advanced
                                    </button>
                                </div>

                                {showAdvanced && (
                                    <div className="form-group full-width">
                                        <label>
                                            <input
                                                type="checkbox"
                                                name="overrideClassification"
                                                checked={formData.overrideClassification}
                                                onChange={handleInputChange}
                                            />
                                            Override automatic classification
                                        </label>
                                    </div>
                                )}

                                {showAdvanced && formData.overrideClassification && (
                                    <div className="form-group full-width">
                                        <label>Classification</label>
                                        <select
                                            name="isStartupCost"
                                            value={formData.isStartupCost ? 'true' : 'false'}
                                            onChange={(e) => {
                                                const value = e.target.value === 'true';
                                                handleInputChange({
                                                    target: { name: 'isStartupCost', value, type: 'checkbox', checked: value }
                                                });
                                            }}
                                        >
                                            <option value="false">Standard director-paid expense</option>
                                            <option value="true">Pre-incorporation startup cost</option>
                                        </select>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>Date Paid</label>
                                    <input
                                        type="date"
                                        name="datePaid"
                                        value={formData.datePaid}
                                        onChange={handleInputChange}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Payment Method</label>
                                    <select
                                        name="paymentMethod"
                                        value={formData.paymentMethod}
                                        onChange={handleInputChange}
                                    >
                                        <option value="">Select Method</option>
                                        {paymentMethods.map(pm => (
                                            <option key={pm} value={pm}>{pm}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Amount (Net) *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        pattern="^\d*(\.\d{0,2})?$"
                                        name="amountNet"
                                        value={formData.amountNet}
                                        onChange={handleInputChange}
                                        onBlur={() => handleMoneyBlur('amountNet')}
                                        placeholder="0.00"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>
                                        VAT Amount
                                        {!formData.vatExempt && formData.amountNet && (
                                            <span className="vat-hint"> (20% = auto-calculated)</span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        pattern="^\d*(\.\d{0,2})?$"
                                        name="vatAmount"
                                        value={formData.vatAmount}
                                        onChange={handleInputChange}
                                        onBlur={() => handleMoneyBlur('vatAmount')}
                                        placeholder="0.00"
                                        disabled={formData.vatExempt}
                                        style={formData.vatExempt ? { opacity: 0.5 } : {}}
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label className="vat-exempt-label">
                                        <input
                                            type="checkbox"
                                            name="vatExempt"
                                            checked={formData.vatExempt}
                                            onChange={handleInputChange}
                                        />
                                        <span>No VAT <small>(travel, mileage, exempt items)</small></span>
                                    </label>
                                </div>

                                <div className="form-group">
                                    <label>Amount (Gross) *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        pattern="^\d*(\.\d{0,2})?$"
                                        name="amountGross"
                                        value={formData.amountGross}
                                        onChange={handleInputChange}
                                        onBlur={() => handleMoneyBlur('amountGross')}
                                        placeholder="0.00"
                                        required
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Notes</label>
                                    <textarea
                                        name="notes"
                                        value={formData.notes}
                                        onChange={handleInputChange}
                                        rows="3"
                                        placeholder="Additional notes..."
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Upload Receipts</label>
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/*,.pdf"
                                        onChange={handleFileSelect}
                                    />
                                    {selectedFiles.length > 0 && (
                                        <small>{selectedFiles.length} file(s) selected</small>
                                    )}
                                </div>

                                {/* No-receipt warning banner */}
                                {selectedFiles.length === 0 && !editingEntry?.hasMissingReceiptDeclaration && !editingEntry?.noReceiptReason && (
                                    <div style={{ gridColumn: '1 / -1', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: '#78350f' }}>
                                        ⚠️ <strong>No receipt attached.</strong> Saving without a receipt will require a Missing Receipt Declaration or a reason — you will be prompted automatically.
                                    </div>
                                )}
                                {editingEntry?.hasMissingReceiptDeclaration && (
                                    <div style={{ gridColumn: '1 / -1', background: '#eff6ff', border: '1px solid #3b82f6', borderRadius: 6, padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: '#1e40af', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                                        <span>📋 <strong>Missing Receipt Declaration on file</strong> — {editingEntry.missingReceiptDeclarationRef}</span>
                                        <a href={getDlaDeclarationPdfUrl(editingEntry.id)} target="_blank" rel="noreferrer" style={{ color: '#1e40af', fontSize: '0.78rem', textDecoration: 'underline' }}>View PDF ↗</a>
                                    </div>
                                )}
                                {editingEntry?.noReceiptReason && !editingEntry?.hasMissingReceiptDeclaration && (
                                    <div style={{ gridColumn: '1 / -1', background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6, padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: '#15803d' }}>
                                        ✅ <strong>No-receipt reason on file</strong> — {editingEntry.noReceiptReason}
                                    </div>
                                )}
                            </div>

                            <div className="form-actions">
                                <button 
                                    type="button" 
                                    className="btn-secondary" 
                                    onClick={() => setShowForm(false)}
                                    disabled={processing}
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="btn-primary"
                                    disabled={processing || uploadingReceipt}
                                >
                                    {processing ? 'Saving...' : editingEntry ? 'Update Entry' : 'Create Entry'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showReceiptsModal && viewingReceipts && (
                <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={handleCloseReceiptsModal}>
                    <div className="modal-content receipt-viewer-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Receipt — {viewingReceipts.dlaId}</h3>
                            <button className="btn-close" onClick={handleCloseReceiptsModal}>✖</button>
                        </div>

                        <div className="receipt-viewer-body">
                            {!viewingReceipts.receiptUrl ? (
                                // Should not reach here now (handleViewReceipts intercepts), but kept as fallback
                                <div className="receipt-empty">No receipt attached to this entry.</div>
                            ) : previewLoading ? (
                                <div className="receipt-loading">Loading receipt…</div>
                            ) : previewUrl ? (
                                previewMime?.startsWith('image/') ? (
                                    <img
                                        src={previewUrl}
                                        alt={previewFileName}
                                        className="receipt-preview-img"
                                    />
                                ) : (
                                    <iframe
                                        src={previewUrl}
                                        title={previewFileName}
                                        className="receipt-preview-iframe"
                                    />
                                )
                            ) : (
                                <div style={{ textAlign: 'center', padding: '2rem' }}>
                                    <div style={{ fontSize: '2rem', marginBottom: 12 }}>📄</div>
                                    <div style={{ marginBottom: 12, color: '#6c757d' }}>Could not load receipt preview.</div>
                                    <button
                                        className="btn-primary"
                                        onClick={async () => {
                                            try {
                                                const headers = await getAuthHeaders();
                                                const filename = viewingReceipts.receiptUrl.split('/').pop().split('?')[0];
                                                const res = await fetch(`${API_BASE_URL}/dla/${viewingReceipts.id}/receipts/${encodeURIComponent(filename)}`, { headers });
                                                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                                const blob = await res.blob();
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = filename;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            } catch (e) {
                                                alert('Download failed: ' + e.message);
                                            }
                                        }}
                                    >⬇ Download Receipt</button>
                                </div>
                            )}
                        </div>

                        {viewingReceipts.receiptUrl && (
                            <div className="modal-footer">
                                <span className="receipt-filename">{previewFileName}</span>
                                <div className="receipt-actions">
                                    <button
                                        className="btn-secondary"
                                        onClick={handleOpenReceiptTab}
                                        disabled={!previewUrl}
                                    >
                                        ↗ Open in tab
                                    </button>
                                    <button
                                        className="btn-primary"
                                        onClick={handleDownloadReceipt}
                                        disabled={!previewUrl}
                                    >
                                        ⬇ Download
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showPaymentModal && paymentEntry && (
                <div className="modal-overlay" onClick={() => !processing && setShowPaymentModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Record Payment - {paymentEntry.dlaId}</h3>
                            <button
                                className="btn-close"
                                onClick={() => setShowPaymentModal(false)}
                                disabled={processing}
                            >
                                ✖
                            </button>
                        </div>
                        <form onSubmit={submitPayment} className="dla-form">
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Payment Amount *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        pattern="^\d*(\.\d{0,2})?$"
                                        name="paymentAmount"
                                        value={paymentData.paymentAmount}
                                        onChange={handlePaymentChange}
                                        onBlur={() => setPaymentData(prev => ({ ...prev, paymentAmount: formatMoneyInput(prev.paymentAmount) }))}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Payment Date *</label>
                                    <input
                                        type="date"
                                        name="paymentDate"
                                        value={paymentData.paymentDate}
                                        onChange={handlePaymentChange}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Payment Method</label>
                                    <select
                                        name="paymentMethod"
                                        value={paymentData.paymentMethod}
                                        onChange={handlePaymentChange}
                                    >
                                        <option value="">Select Method</option>
                                        {paymentMethods.map(pm => (
                                            <option key={pm} value={pm}>{pm}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group full-width">
                                    <label>Notes</label>
                                    <textarea
                                        name="notes"
                                        value={paymentData.notes}
                                        onChange={handlePaymentChange}
                                        rows="3"
                                    />
                                </div>
                            </div>
                            <div className="form-actions">
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => setShowPaymentModal(false)}
                                    disabled={processing}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={processing}
                                >
                                    {processing ? 'Saving...' : 'Record Payment'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showPaymentHistory && paymentEntry && (
                <div className="modal-overlay" onClick={() => !processing && setShowPaymentHistory(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Payment History - {paymentEntry.dlaId}</h3>
                            <button
                                className="btn-close"
                                onClick={() => setShowPaymentHistory(false)}
                                disabled={processing}
                            >
                                ✖
                            </button>
                        </div>
                        {paymentHistory.length === 0 ? (
                            <p>No payments recorded.</p>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Amount</th>
                                        <th>Method</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paymentHistory.map(payment => (
                                        <tr key={payment.id}>
                                            <td>{formatDate(payment.paymentDate)}</td>
                                            <td className="amount">{formatCurrency(payment.amount)}</td>
                                            <td>{payment.paymentMethod || '-'}</td>
                                            <td>{payment.notes || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* ── Bulk Payment Modal ────────────────────────────────────────── */}
            {showBulkPaymentModal && selectedEntries.size > 0 && (() => {
                const selectedItems = dlaEntries.filter(e => selectedEntries.has(e.id));
                const selectedTotal = selectedItems.reduce((s, e) => s + (e.remainingBalance || 0), 0);
                return (
                    <div className="modal-overlay" onClick={() => !processing && setShowBulkPaymentModal(false)}>
                        <div className="modal-content" style={{ maxWidth: '580px' }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3>💳 Batch Payment — {selectedItems.length} {selectedItems.length === 1 ? 'Entry' : 'Entries'}</h3>
                                <button className="btn-close" onClick={() => setShowBulkPaymentModal(false)} disabled={processing}>✖</button>
                            </div>

                            {/* Selected entries list */}
                            <div style={{ margin: '0.75rem 1.25rem 0', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '6px', overflow: 'hidden' }}>
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: 'rgba(0,0,0,0.05)', position: 'sticky', top: 0 }}>
                                                <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left', fontWeight: 600 }}>DLA ID</th>
                                                <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left', fontWeight: 600 }}>Description</th>
                                                <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 600 }}>Remaining</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedItems.map(entry => (
                                                <tr key={entry.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                                                    <td style={{ padding: '0.35rem 0.75rem' }}><strong>{entry.dlaId}</strong></td>
                                                    <td style={{ padding: '0.35rem 0.75rem', color: 'rgba(0,0,0,0.65)' }}>{entry.description}</td>
                                                    <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right' }}>{formatCurrency(entry.remainingBalance)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: 'rgba(0,0,0,0.04)', borderTop: '2px solid rgba(0,0,0,0.15)' }}>
                                                <td colSpan="2" style={{ padding: '0.5rem 0.75rem', fontWeight: 700 }}>Total bank transfer to director</td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{formatCurrency(selectedTotal)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            <form onSubmit={submitBulkPayment} className="dla-form" style={{ padding: '0.75rem 1.25rem 1rem' }}>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Payment Date *</label>
                                        <input
                                            type="date"
                                            name="paymentDate"
                                            value={bulkPaymentData.paymentDate}
                                            onChange={handleBulkPaymentChange}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Payment Method</label>
                                        <select name="paymentMethod" value={bulkPaymentData.paymentMethod} onChange={handleBulkPaymentChange}>
                                            <option value="">Select Method</option>
                                            {paymentMethods.map(pm => <option key={pm} value={pm}>{pm}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group full-width">
                                        <label>Payment Reference</label>
                                        <div style={{ padding: '0.8rem 0.95rem', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}>
                                            Generated automatically when you submit, using the payment month and next available sequence, for example DLA-202604-001.
                                        </div>
                                    </div>
                                    <div className="form-group full-width">
                                        <label>Notes <span style={{ opacity: 0.55, fontSize: '0.8rem' }}>(optional)</span></label>
                                        <textarea
                                            name="notes"
                                            value={bulkPaymentData.notes}
                                            onChange={handleBulkPaymentChange}
                                            rows="2"
                                            placeholder="e.g. Monthly director repayment"
                                        />
                                    </div>
                                    <div className="form-group full-width">
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                name="sendEmail"
                                                checked={!!bulkPaymentData.sendEmail}
                                                onChange={handleBulkPaymentChange}
                                            />
                                            <span>Send payment confirmation email</span>
                                        </label>
                                        {(() => {
                                            const selectedDlaEntries = dlaEntries.filter(e => selectedEntries.has(e.id));
                                            const directors = [...new Set(selectedDlaEntries.map(e => e.director).filter(Boolean))];
                                            return directors.length > 0 ? (
                                                <div style={{ marginTop: '0.3rem', fontSize: '0.82rem', color: '#64748b' }}>
                                                    Directors in this batch: <strong>{directors.join(', ')}</strong>
                                                </div>
                                            ) : (
                                                <div style={{ marginTop: '0.3rem', fontSize: '0.82rem', color: '#b45309' }}>
                                                    No director information found for selected entries.
                                                </div>
                                            );
                                        })()}

                                        {bulkPaymentData.sendEmail && (
                                            <div style={{ marginTop: '0.65rem' }}>
                                                <label>Email address to send to *</label>
                                                <input
                                                    type="email"
                                                    name="recipientEmail"
                                                    value={bulkPaymentData.recipientEmail || ''}
                                                    onChange={handleBulkPaymentChange}
                                                    placeholder="name@company.com"
                                                    required={!!bulkPaymentData.sendEmail}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="form-actions">
                                    <button type="button" className="btn-secondary" onClick={() => setShowBulkPaymentModal(false)} disabled={processing}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary" disabled={processing}>
                                        {processing ? 'Processing…' : `💳 Record Batch Payment (${formatCurrency(selectedTotal)})`}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                );
            })()}

            {showStartupModal && (
                <div className="modal-overlay" onClick={() => !processing && setShowStartupModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Director-Funded Startup Costs (DLA)</h3>
                            <button
                                className="btn-close"
                                onClick={() => setShowStartupModal(false)}
                                disabled={processing}
                            >
                                ✖
                            </button>
                        </div>
                        <div className="form-group">
                            <label>Mode</label>
                            <select value={startupMode} onChange={(e) => setStartupMode(e.target.value)}>
                                <option value="Single">Single Amount</option>
                                <option value="Itemised">Itemised</option>
                            </select>
                        </div>
                        <form onSubmit={submitStartupCapture} className="dla-form">
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Director *</label>
                                    <select
                                        value={startupForm.director}
                                        onChange={(e) => setStartupForm(prev => ({ ...prev, director: e.target.value }))}
                                        required
                                    >
                                        <option value="">Select Director</option>
                                        {directors.map(dir => (
                                            <option key={dir} value={dir}>{dir}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Entry Date *</label>
                                    <input
                                        type="date"
                                        value={startupForm.entryDate}
                                        onChange={(e) => setStartupForm(prev => ({ ...prev, entryDate: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Category</label>
                                    <select
                                        value={startupForm.category}
                                        onChange={(e) => setStartupForm(prev => ({ ...prev, category: e.target.value }))}
                                    >
                                        <option value="Startup Costs">Startup Costs</option>
                                        <option value="Cloud">Cloud</option>
                                        <option value="Software">Software</option>
                                        <option value="Device">Device</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>CT Tag</label>
                                    <select
                                        value={startupForm.ctTag}
                                        onChange={(e) => setStartupForm(prev => ({ ...prev, ctTag: e.target.value }))}
                                    >
                                        <option value="Revenue">Revenue</option>
                                        <option value="Capital">Capital</option>
                                        <option value="NonCT">Non-CT</option>
                                    </select>
                                </div>
                            </div>

                            {startupMode === 'Single' ? (
                                <>
                                    <div className="form-group">
                                        <label>Total Amount (Net) *</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            pattern="^\d*(\.\d{0,2})?$"
                                            value={startupForm.totalAmount}
                                            onChange={(e) => handleStartupFormChange('totalAmount', e.target.value)}
                                            onBlur={() => setStartupForm(prev => ({ ...prev, totalAmount: formatMoneyInput(prev.totalAmount) }))}
                                            placeholder="0.00"
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer'}}>
                                            <input
                                                type="checkbox"
                                                checked={startupForm.canClaimVat}
                                                onChange={(e) => handleStartupFormChange('canClaimVat', e.target.checked)}
                                                style={{cursor: 'pointer'}}
                                            />
                                            Can claim VAT
                                        </label>
                                    </div>
                                    {startupForm.canClaimVat && (
                                        <div className="form-group">
                                            <label>VAT Amount</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                pattern="^\d*(\.\d{0,2})?$"
                                                value={startupForm.vatAmount}
                                                onChange={(e) => handleStartupFormChange('vatAmount', e.target.value)}
                                                onBlur={() => setStartupForm(prev => ({ ...prev, vatAmount: formatMoneyInput(prev.vatAmount) }))}
                                                placeholder="0.00"
                                            />
                                        </div>
                                    )}
                                    <div className="form-group">
                                        <label>Total Amount (Gross) *</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            pattern="^\d*(\.\d{0,2})?$"
                                            value={startupForm.totalGross}
                                            onChange={(e) => handleStartupFormChange('totalGross', e.target.value)}
                                            onBlur={() => setStartupForm(prev => ({ ...prev, totalGross: formatMoneyInput(prev.totalGross) }))}
                                            placeholder="0.00"
                                            required
                                        />
                                    </div>
                                    <div className="form-group full-width">
                                        <label>Rationale *</label>
                                        <textarea
                                            value={startupForm.rationale}
                                            onChange={(e) => handleStartupFormChange('rationale', e.target.value)}
                                            rows="3"
                                            required
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="form-group full-width">
                                    <div className="toolbar-actions" style={{ marginBottom: '0.5rem' }}>
                                        <button type="button" className="btn-secondary" onClick={addStartupItem}>
                                            ➕ Add Item
                                        </button>
                                    </div>
                                    {startupItems.length === 0 && <p>No items added.</p>}
                                    {startupItems.map((item, idx) => (
                                        <div key={idx} className="card" style={{ padding: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div className="form-grid">
                                                <div className="form-group">
                                                    <label>Date</label>
                                                    <input
                                                        type="date"
                                                        value={item.entryDate}
                                                        onChange={(e) => updateStartupItem(idx, 'entryDate', e.target.value)}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label>Description</label>
                                                    <input
                                                        type="text"
                                                        value={item.description}
                                                        onChange={(e) => updateStartupItem(idx, 'description', e.target.value)}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label>Category</label>
                                                    <select
                                                        value={item.category}
                                                        onChange={(e) => updateStartupItem(idx, 'category', e.target.value)}
                                                    >
                                                        <option value="Startup Costs">Startup Costs</option>
                                                        <option value="Cloud">Cloud</option>
                                                        <option value="Software">Software</option>
                                                        <option value="Device">Device</option>
                                                        <option value="Other">Other</option>
                                                    </select>
                                                </div>
                                                <div className="form-group">
                                                    <label>CT Tag</label>
                                                    <select
                                                        value={item.ctTag}
                                                        onChange={(e) => updateStartupItem(idx, 'ctTag', e.target.value)}
                                                    >
                                                        <option value="Revenue">Revenue</option>
                                                        <option value="Capital">Capital</option>
                                                        <option value="NonCT">Non-CT</option>
                                                    </select>
                                                </div>
                                                <div className="form-group">
                                                    <label>Net</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        pattern="^\d*(\.\d{0,2})?$"
                                                        value={item.amountNet}
                                                        onChange={(e) => updateStartupItem(idx, 'amountNet', e.target.value)}
                                                        onBlur={() => normalizeStartupItem(idx, 'amountNet')}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label>VAT</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        pattern="^\d*(\.\d{0,2})?$"
                                                        value={item.vatAmount}
                                                        onChange={(e) => updateStartupItem(idx, 'vatAmount', e.target.value)}
                                                        onBlur={() => normalizeStartupItem(idx, 'vatAmount')}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label>Gross</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        pattern="^\d*(\.\d{0,2})?$"
                                                        value={item.amountGross}
                                                        onChange={(e) => updateStartupItem(idx, 'amountGross', e.target.value)}
                                                        onBlur={() => normalizeStartupItem(idx, 'amountGross')}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <button type="button" className="btn-secondary" onClick={() => removeStartupItem(idx)}>
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="form-group full-width">
                                <label>Upload Statutory Documents (DLA agreement, board minute)</label>
                                <input
                                    type="file"
                                    multiple
                                    onChange={(e) => uploadStartupDocs(Array.from(e.target.files || []), 'Statutory Document')}
                                />
                            </div>
                            <div className="form-group full-width">
                                <label>Upload Evidence (receipts/invoices)</label>
                                <input
                                    type="file"
                                    multiple
                                    onChange={(e) => uploadStartupDocs(Array.from(e.target.files || []), 'DLA Evidence')}
                                />
                            </div>

                            <div className="form-actions">
                                <button type="button" className="btn-secondary" onClick={() => setShowStartupModal(false)} disabled={processing}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary" disabled={processing}>
                                    {processing ? 'Saving...' : 'Create DLA Startup'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Invoice Quick Capture Modal ──────────────────────────── */}
            {showInvoiceCapture && (
                <div className="modal-overlay" onClick={() => !captureSubmitting && setShowInvoiceCapture(false)}>
                    <div className="modal-content" style={{ maxWidth: '1100px', width: '97vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📥 Invoice Quick Capture</h3>
                            <button className="btn-close" onClick={() => setShowInvoiceCapture(false)} disabled={captureSubmitting}>✖</button>
                        </div>

                        {/* Scan status banner */}
                        {captureScanning && (
                            <div style={{ background: '#e8f4fd', borderBottom: '1px solid #bee5eb', padding: '8px 16px', fontSize: '0.88rem', color: '#0c5460', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #0c5460', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}></span>
                                🔍 Scanning invoice with Azure AI…
                            </div>
                        )}
                        {!captureScanning && captureScanToast === 'success' && (
                            <div style={{ background: '#d4edda', borderBottom: '1px solid #c3e6cb', padding: '8px 16px', fontSize: '0.88rem', color: '#155724' }}>
                                ✅ Invoice scanned — fields pre-filled. Please check and correct any details before submitting.
                            </div>
                        )}
                        {!captureScanning && captureScanToast === 'noOcr' && (
                            <div style={{ background: '#fff3cd', borderBottom: '1px solid #ffc107', padding: '8px 16px', fontSize: '0.88rem', color: '#856404' }}>
                                ⚠️ OCR not configured. Add <strong>DocumentIntelligenceEndpoint</strong> &amp; <strong>DocumentIntelligenceKey</strong> to your Function App settings to enable auto-scanning.
                            </div>
                        )}
                        {!captureScanning && captureScanToast === 'error' && (
                            <div style={{ background: '#f8d7da', borderBottom: '1px solid #f5c6cb', padding: '8px 16px', fontSize: '0.88rem', color: '#721c24' }}>
                                ⚠️ Could not extract details from this invoice — please fill in the fields manually.
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem', flex: 1, overflow: 'hidden', padding: '1rem' }}>

                            {/* Left — invoice preview */}
                            <div style={{ flex: '0 0 42%', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0 }}>
                                {captureInvoiceFile ? (
                                    <>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', opacity: 0.7 }}>📄 {captureInvoiceFile.name}</div>
                                        <div style={{ flex: 1, background: '#111', borderRadius: '6px', overflow: 'auto', minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {captureInvoiceMime?.startsWith('image/') ? (
                                                <img src={captureInvoiceUrl} alt="invoice" style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
                                            ) : (
                                                <iframe src={captureInvoiceUrl} title="invoice" style={{ width: '100%', height: '60vh', border: 'none' }} />
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div
                                        onDragOver={e => { e.preventDefault(); setCaptureDragOver(true); }}
                                        onDragLeave={() => setCaptureDragOver(false)}
                                        onDrop={e => { e.preventDefault(); setCaptureDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) openInvoiceCapture(f); }}
                                        style={{ border: '2px dashed #4b5563', borderRadius: '8px', padding: '2rem', textAlign: 'center', cursor: 'pointer', flex: 1 }}
                                        onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='image/*,.pdf'; i.onchange = e => { const f = e.target.files[0]; if (f) openInvoiceCapture(f); }; i.click(); }}
                                    >
                                        📎 Drop invoice here or click to choose
                                    </div>
                                )}
                            </div>

                            {/* Right — form */}
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                                {/* Header fields */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                                    <div className="form-group">
                                        <label>Director *</label>
                                        <select value={captureHeader.director} onChange={e => setCaptureHeader(h => ({...h, director: e.target.value}))}>
                                            <option value="">Select Director</option>
                                            {directors.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Transaction Type</label>
                                        <select value={captureHeader.direction} onChange={e => setCaptureHeader(h => ({...h, direction: e.target.value}))}>
                                            <option value="OwedToDirector">Paid by director (owed to director)</option>
                                            <option value="OwedToCompany">Paid by company (owed to business)</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Vendor / Supplier</label>
                                        <input type="text" placeholder="e.g. Amazon, Apple" value={captureHeader.vendor} onChange={e => setCaptureHeader(h => ({...h, vendor: e.target.value}))} />
                                    </div>
                                    <div className="form-group">
                                        <label>Invoice Date *</label>
                                        <input type="date" value={captureHeader.invoiceDate} onChange={e => setCaptureHeader(h => ({...h, invoiceDate: e.target.value}))} />
                                    </div>
                                    <div className="form-group">
                                        <label>Invoice / Order Ref</label>
                                        <input type="text" placeholder="e.g. INV-12345" value={captureHeader.invoiceRef} onChange={e => setCaptureHeader(h => ({...h, invoiceRef: e.target.value}))} />
                                    </div>
                                    <div className="form-group">
                                        <label>Category</label>
                                        <select value={captureHeader.category} onChange={e => setCaptureHeader(h => ({...h, category: e.target.value}))}>
                                            <option value="">Select Category</option>
                                            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Line items */}
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Line Items <span style={{ opacity: 0.5, fontWeight: 400 }}>(each becomes a DLA entry linked to this invoice)</span></h4>
                                        <button className="btn-secondary" style={{ fontSize: '0.78rem', padding: '0.2rem 0.6rem' }} onClick={addCaptureLine} type="button">+ Add Line</button>
                                    </div>

                                    {captureLines.map((line, idx) => (
                                        <div key={idx} style={{ background: 'rgba(0,0,0,0.04)', borderRadius: '6px', padding: '0.6rem', marginBottom: '0.4rem', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '0.4rem', alignItems: 'end' }}>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ fontSize: '0.73rem' }}>Description *</label>
                                                <input type="text" placeholder="e.g. USB-C cable" value={line.description} onChange={e => updateCaptureLine(idx, 'description', e.target.value)} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ fontSize: '0.73rem' }}>Net £</label>
                                                <input type="text" inputMode="decimal" placeholder="0.00" value={line.amountNet} onChange={e => updateCaptureLine(idx, 'amountNet', e.target.value)} onBlur={() => blurCaptureLine(idx, 'amountNet')} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ fontSize: '0.73rem' }}>VAT £ {line.vatExempt && <span style={{color:'#9ca3af'}}>(exempt)</span>}</label>
                                                <input type="text" inputMode="decimal" placeholder="0.00" value={line.vatAmount} onChange={e => updateCaptureLine(idx, 'vatAmount', e.target.value)} onBlur={() => blurCaptureLine(idx, 'vatAmount')} disabled={line.vatExempt} style={line.vatExempt ? {opacity:0.4} : {}} />
                                            </div>
                                            <div className="form-group" style={{ margin: 0 }}>
                                                <label style={{ fontSize: '0.73rem' }}>Gross £</label>
                                                <input type="text" inputMode="decimal" placeholder="0.00" value={line.amountGross} onChange={e => updateCaptureLine(idx, 'amountGross', e.target.value)} onBlur={() => blurCaptureLine(idx, 'amountGross')} />
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                                                <label style={{ fontSize: '0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                    <input type="checkbox" checked={line.vatExempt} onChange={e => updateCaptureLine(idx, 'vatExempt', e.target.checked)} style={{ cursor: 'pointer' }} /> 0%
                                                </label>
                                                {captureLines.length > 1 && (
                                                    <button onClick={() => removeCaptureLine(idx)} className="btn-icon" style={{ fontSize: '12px', padding: '2px 4px' }} type="button" title="Remove line">✕</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Totals row */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '0.4rem', padding: '0.4rem 0.6rem', background: 'rgba(0,0,0,0.07)', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                                        <div>Totals</div>
                                        <div>{formatCurrency(captureLineTotals.net)}</div>
                                        <div>{formatCurrency(captureLineTotals.vat)}</div>
                                        <div>{formatCurrency(captureLineTotals.gross)}</div>
                                        <div></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                                {captureLines.filter(l => l.description).length} line item(s) → will create {captureLines.filter(l => l.description && parseFloat(l.amountGross) > 0).length} DLA entr{captureLines.filter(l => l.description && parseFloat(l.amountGross) > 0).length === 1 ? 'y' : 'ies'}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn-secondary" onClick={() => setShowInvoiceCapture(false)} disabled={captureSubmitting}>Cancel</button>
                                <button className="btn-primary" onClick={submitInvoiceCapture} disabled={captureSubmitting || !captureInvoiceFile}>
                                    {captureUploading ? '⬆ Uploading...' : captureSubmitting ? '⚙ Creating entries...' : `✅ Create ${captureLines.filter(l => l.description && parseFloat(l.amountGross) > 0).length} DLA Entr${captureLines.filter(l => l.description && parseFloat(l.amountGross) > 0).length === 1 ? 'y' : 'ies'}`}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── DLA Entry View Modal ──────────────────────────────────── */}
            {viewingEntry && (
                <div className="modal-overlay" onClick={() => setViewingEntry(null)}>
                    <div className="modal-content" style={{ maxWidth: '700px', width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📋 DLA Entry — {viewingEntry.dlaId}</h3>
                            <button className="btn-close" onClick={() => setViewingEntry(null)}>✖</button>
                        </div>
                        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                            {/* Entry Details */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Entry Details</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem' }}>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>DLA ID</span><div style={{ fontWeight: 600 }}>{viewingEntry.dlaId}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Director</span><div>{viewingEntry.director || '—'}</div></div>
                                    <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Description</span><div>{viewingEntry.description || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Category</span><div>{viewingEntry.category || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Direction</span><div>{getDirectionLabel(viewingEntry.direction)}</div></div>
                                </div>
                            </section>

                            {/* Dates */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Dates</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem' }}>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Entry Date</span><div>{formatDate(viewingEntry.entryDate)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Date Paid</span><div>{formatDate(viewingEntry.datePaid)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Tax Year</span><div>{viewingEntry.taxYear || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Financial Year</span><div>{viewingEntry.financialYear || '—'}</div></div>
                                </div>
                            </section>

                            {/* Financial */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Financial</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem' }}>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Net</span><div style={{ fontWeight: 500 }}>{formatCurrency(viewingEntry.amountNet)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>VAT</span><div>{formatCurrency(viewingEntry.vatAmount)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Gross</span><div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{formatCurrency(viewingEntry.amountGross)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Payment Method</span><div>{viewingEntry.paymentMethod || '—'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Paid back</span><div style={{ color: '#16a34a', fontWeight: 500 }}>{formatCurrency(viewingEntry.amountPaid)}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Still outstanding</span><div style={{ fontWeight: 600, color: viewingEntry.remainingBalance > 0 ? '#d97706' : '#16a34a' }}>{formatCurrency(viewingEntry.remainingBalance)}</div></div>
                                </div>
                                {/* Payment progress bar */}
                                {viewingEntry.amountGross > 0 && (
                                    <div style={{ marginTop: '0.75rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.25rem' }}>
                                            <span>Repaid {Math.round(((viewingEntry.amountPaid || 0) / viewingEntry.amountGross) * 100)}%</span>
                                            <span>{formatCurrency(viewingEntry.amountPaid || 0)} / {formatCurrency(viewingEntry.amountGross)}</span>
                                        </div>
                                        <div style={{ height: '6px', background: 'rgba(0,0,0,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${Math.min(100, ((viewingEntry.amountPaid || 0) / viewingEntry.amountGross) * 100)}%`, background: viewingEntry.remainingBalance <= 0 ? '#16a34a' : '#f59e0b', borderRadius: '3px', transition: 'width 0.3s' }} />
                                        </div>
                                    </div>
                                )}
                                {/* CT note */}
                                {viewingEntry.direction === 'OwedToDirector' && viewingEntry.ctTag !== 'NonCT' && (
                                    <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(22,163,74,0.08)', borderRadius: '6px', fontSize: '0.8rem', color: '#16a34a' }}>
                                        ✅ CT-deductible — this reduces taxable profit by {formatCurrency(viewingEntry.amountNet)}
                                        {' '}(saving ~{formatCurrency(Math.round(viewingEntry.amountNet * 0.19 * 100) / 100)} CT at 19%)
                                    </div>
                                )}
                            </section>

                            {/* Classification */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Classification</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.5rem' }}>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Type</span><div>{viewingEntry.isStartupCost ? '🔵 Pre-incorporation startup cost' : '🟢 Standard director-paid expense'}</div></div>
                                    <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Source</span><div style={{ textTransform: 'capitalize' }}>{viewingEntry.classificationSource || 'auto'}</div></div>
                                    {viewingEntry.ctTag && <div><span style={{ opacity: 0.6, fontSize: '0.8rem' }}>CT Tag</span><div>{viewingEntry.ctTag}</div></div>}
                                </div>
                            </section>

                            {/* Notes */}
                            {viewingEntry.notes && (
                                <section>
                                    <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Notes</h4>
                                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{viewingEntry.notes}</p>
                                </section>
                            )}

                            {/* Receipt / Declaration */}
                            <section>
                                <h4 style={{ margin: '0 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>Receipt</h4>
                                {viewingEntry.receiptUrl ? (
                                    <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => handleViewReceipts(viewingEntry)}>📎 View Receipt</button>
                                ) : viewingEntry.hasMissingReceiptDeclaration ? (
                                    <div style={{ padding: '0.6rem 0.9rem', background: '#f0f4ff', border: '1px solid #1565C0', borderRadius: 6, fontSize: '0.85rem', color: '#1565C0', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        📋 <strong>Missing Receipt Declaration on file</strong> — {viewingEntry.missingReceiptDeclarationRef}
                                        <a href={getDlaDeclarationPdfUrl(viewingEntry.id)} target="_blank" rel="noreferrer" style={{ color: '#1565C0', fontWeight: 600, fontSize: '0.8rem', marginLeft: 'auto' }}>View Declaration PDF ↗</a>
                                    </div>
                                ) : viewingEntry.noReceiptReason ? (
                                    <div style={{ padding: '0.6rem 0.9rem', background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6, fontSize: '0.85rem', color: '#15803d' }}>
                                        ✅ <strong>No receipt — reason on file:</strong> {viewingEntry.noReceiptReason}
                                    </div>
                                ) : (
                                    <div style={{ opacity: 0.4, fontSize: '0.85rem' }}>No receipt attached</div>
                                )}
                            </section>

                        </div>
                        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {!viewingEntry.hasMissingReceiptDeclaration && !viewingEntry.receiptUrl && (
                                <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { setViewingEntry(null); openDlaDeclarationModal(viewingEntry); }}>📋 Declaration</button>
                            )}
                            {viewingEntry.hasMissingReceiptDeclaration && (
                                <a href={getDlaDeclarationPdfUrl(viewingEntry.id)} target="_blank" rel="noreferrer" className="btn-secondary" style={{ fontSize: '0.85rem', textDecoration: 'none' }}>📎 View Declaration</a>
                            )}
                            <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { openPaymentHistory(viewingEntry); }}>📜 Payment History</button>
                            {viewingEntry.remainingBalance > 0 && (
                                <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { setViewingEntry(null); openPaymentModal(viewingEntry); }}>💷 Record Payment</button>
                            )}
                            <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { setViewingEntry(null); handleEditEntry(viewingEntry); }}>✏️ Edit</button>
                            <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={() => setViewingEntry(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

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
                                <strong>{noReceiptInfoModal.entry.dlaId}</strong>
                                <span style={{ float: 'right', fontWeight: 700 }}>{formatCurrency(noReceiptInfoModal.entry.amountGross)}</span>
                                <div style={{ color: '#6c757d', marginTop: 2 }}>{noReceiptInfoModal.entry.description}</div>
                            </div>
                            <div style={{ background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 6, padding: '0.75rem 1rem', fontSize: '0.9rem', color: '#15803d' }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>Reason recorded:</div>
                                <div>{noReceiptInfoModal.entry.noReceiptReason}</div>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>
                                No receipt is attached to this entry. A reason has been recorded above. If you now have a receipt, edit the entry to attach it.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button
                                    className="btn-secondary"
                                    onClick={() => { setNoReceiptInfoModal(null); openDlaDeclarationModal(noReceiptInfoModal.entry); }}
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
                                onClick={handleReceiptRequiredDlaDeclaration}
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
                                    onClick={handleDlaNoReceiptReasonSave}
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

            {/* ── Missing Receipt Declaration Modal ─────────────────────── */}
            {declarationModal && (
                <div className="modal-overlay" onClick={() => !declarationSaving && setDeclarationModal(null)}>
                    <div className="modal-content" style={{ maxWidth: 580, width: '95vw' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header" style={{ background: '#1565C0', color: '#fff', borderRadius: '8px 8px 0 0' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem' }}>📋 Missing Receipt Declaration</h3>
                            <button className="btn-close" style={{ color: '#fff', background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => !declarationSaving && setDeclarationModal(null)} disabled={declarationSaving}>✖</button>
                        </div>
                        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Entry summary */}
                            <div style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 6, padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                                <strong>{declarationModal.entry.dlaId}</strong> — {declarationModal.entry.director}
                                <span style={{ float: 'right', fontWeight: 700 }}>£{(declarationModal.entry.amountGross || 0).toFixed(2)}</span>
                                <div style={{ color: '#6c757d', marginTop: 2 }}>{declarationModal.entry.description || declarationModal.entry.category}</div>
                            </div>

                            <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#78350f' }}>
                                ⚠️ <strong>VAT cannot be reclaimed</strong> without a valid VAT invoice. Finalising this declaration will set VAT to <strong>£0.00</strong> on this entry.
                                {(declarationModal.entry?.vatAmount || 0) > 0 && (
                                    <span> The current VAT amount of <strong>£{(declarationModal.entry.vatAmount || 0).toFixed(2)}</strong> will be cleared.</span>
                                )}
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
                                onClick={handleCreateDlaDeclaration} disabled={declarationSaving}>
                                {declarationSaving ? '⏳ Saving…' : '📋 Create & Finalise Declaration'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Payment status toggle ─────────────────────────────── */}
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, marginRight: '0.5rem', color: '#555' }}>Show:</span>
                {[
                    { value: '', label: 'All', icon: '📋' },
                    { value: 'unpaid', label: 'Unpaid', icon: '❌' },
                    { value: 'partial', label: 'Partial', icon: '⏳' },
                    { value: 'paid', label: 'Paid', icon: '✅' },
                ].map(opt => (
                    <button
                        key={opt.value}
                        onClick={() => { setFilterPaymentStatus(opt.value); setCurrentPage(1); }}
                        style={{
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.85rem',
                            fontWeight: filterPaymentStatus === opt.value ? 700 : 500,
                            border: filterPaymentStatus === opt.value ? '2px solid #1565C0' : '1px solid rgba(0,0,0,0.2)',
                            borderRadius: '20px',
                            cursor: 'pointer',
                            background: filterPaymentStatus === opt.value ? '#E3F2FD' : '#fff',
                            color: filterPaymentStatus === opt.value ? '#1565C0' : '#333',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {opt.icon} {opt.label}
                    </button>
                ))}
            </div>

            {/* ── Filter bar ────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    type="text"
                    placeholder="🔍 Search description, category, ID…"
                    value={filterText}
                    onChange={e => { setFilterText(e.target.value); setCurrentPage(1); }}
                    style={{ flex: '1 1 200px', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.2)', fontSize: '0.85rem' }}
                />
                <select
                    value={filterDirection}
                    onChange={e => { setFilterDirection(e.target.value); setCurrentPage(1); }}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.2)', fontSize: '0.85rem' }}
                >
                    <option value="">All directions</option>
                    <option value="OwedToDirector">Director paid (owed to director)</option>
                    <option value="OwedToCompany">Company paid (owed to company)</option>
                </select>
                <select
                    value={filterCtTag}
                    onChange={e => { setFilterCtTag(e.target.value); setCurrentPage(1); }}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.2)', fontSize: '0.85rem' }}
                >
                    <option value="">All CT tags</option>
                    <option value="Revenue">Revenue</option>
                    <option value="Capital">Capital</option>
                    <option value="NonCT">Non-CT</option>
                </select>
                <select
                    value={filterYear}
                    onChange={e => { setFilterYear(e.target.value); setCurrentPage(1); }}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.2)', fontSize: '0.85rem' }}
                >
                    <option value="">All tax years</option>
                    {uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {(filterText || filterDirection || filterCtTag || filterYear || filterPaymentStatus) && (
                    <button
                        className="btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => { setFilterText(''); setFilterDirection(''); setFilterCtTag(''); setFilterYear(''); setFilterPaymentStatus(''); setCurrentPage(1); }}
                    >
                        ✖ Clear
                    </button>
                )}
                <button
                    className={selectMode ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    onClick={() => { setSelectMode(prev => !prev); setSelectedEntries(new Set()); }}
                >
                    {selectMode ? '✖ Cancel' : '☑ Batch Pay'}
                </button>
                {allowDataDeletion && (
                    <button
                        className={deleteSelectMode ? 'btn-primary' : 'btn-secondary'}
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap', background: deleteSelectMode ? '#dc3545' : undefined, borderColor: deleteSelectMode ? '#dc3545' : undefined }}
                        onClick={() => { setDeleteSelectMode(prev => !prev); clearDeleteSelection(); }}
                    >
                        {deleteSelectMode ? '✖ Cancel Delete' : '🗑️ Bulk Delete'}
                    </button>
                )}
            </div>

            {/* ── Batch selection bar ──────────────────────────────────────── */}
            {selectMode && (() => {
                const eligible = filtered.filter(e => e.remainingBalance > 0);
                const allSelected = eligible.length > 0 && eligible.every(e => selectedEntries.has(e.id));
                const selectedItems = dlaEntries.filter(e => selectedEntries.has(e.id));
                const selectedTotal = selectedItems.reduce((s, e) => s + (e.remainingBalance || 0), 0);
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', background: selectedEntries.size > 0 ? 'rgba(59,130,246,0.08)' : 'rgba(0,0,0,0.04)', borderRadius: '8px', marginBottom: '0.75rem', border: `1px solid ${selectedEntries.size > 0 ? 'rgba(59,130,246,0.35)' : 'rgba(0,0,0,0.1)'}`, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem', userSelect: 'none' }}>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={() => toggleSelectAll(eligible)}
                                style={{ width: '16px', height: '16px' }}
                            />
                            Select all unpaid ({eligible.length})
                        </label>
                        <span style={{ flex: 1, fontSize: '0.85rem', opacity: 0.7 }}>
                            {selectedEntries.size === 0
                                ? 'Tick entries to include in a single batch bank transfer'
                                : `${selectedEntries.size} entr${selectedEntries.size === 1 ? 'y' : 'ies'} selected`}
                        </span>
                        {selectedEntries.size > 0 && (
                            <button
                                className="btn-primary"
                                style={{ fontSize: '0.85rem', padding: '0.35rem 1rem' }}
                                onClick={openBulkPaymentModal}
                                disabled={processing}
                            >
                                💳 Pay {selectedEntries.size} {selectedEntries.size === 1 ? 'entry' : 'entries'} — {formatCurrency(selectedTotal)}
                            </button>
                        )}
                    </div>
                );
            })()}

            {/* ── Delete selection bar ─────────────────────────────────────── */}
            {allowDataDeletion && deleteSelectMode && (
                <div style={{ background: '#fdf2f2', border: '1px solid #f5c2c7', borderRadius: 6, padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: '#dc3545' }}>
                        {deleteSelectedIds.size > 0 ? `${deleteSelectedIds.size} entr${deleteSelectedIds.size === 1 ? 'y' : 'ies'} selected` : 'Tick entries to delete'}
                    </span>
                    <button onClick={selectAllForDelete} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.2rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>Select All</button>
                    {deleteSelectedIds.size > 0 && (
                        <>
                            <button onClick={clearDeleteSelection} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.2rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>✕ Clear</button>
                            <button onClick={handleBulkDeleteDla} style={{ background: '#dc3545', color: '#fff', border: 'none', borderRadius: 4, padding: '0.25rem 0.9rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>🗑️ Delete {deleteSelectedIds.size} Entr{deleteSelectedIds.size === 1 ? 'y' : 'ies'}</button>
                        </>
                    )}
                </div>
            )}

            {/* ── Totals summary bar ───────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem', marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.04)', borderRadius: '8px', fontSize: '0.82rem' }}>
                <div><span style={{ opacity: 0.6, display: 'block', marginBottom: '0.15rem' }}>Gross</span><strong>{formatCurrency(filterTotalGross)}</strong></div>
                <div><span style={{ opacity: 0.6, display: 'block', marginBottom: '0.15rem' }}>Net</span><strong>{formatCurrency(filterTotalNet)}</strong></div>
                <div title={filterVatReclaimable !== filterTotalVat ? `Total VAT: ${formatCurrency(filterTotalVat)} — only reclaimable portion shown (NonCT items excluded)` : undefined}>
                    <span style={{ opacity: 0.6, display: 'block', marginBottom: '0.15rem' }}>VAT (reclaimable)</span>
                    <strong>{formatCurrency(filterVatReclaimable)}</strong>
                    {filterVatReclaimable !== filterTotalVat && (
                        <span style={{ display: 'block', fontSize: '0.72rem', opacity: 0.5 }}>of {formatCurrency(filterTotalVat)} total</span>
                    )}
                </div>
                <div><span style={{ opacity: 0.6, display: 'block', marginBottom: '0.15rem' }}>Paid back</span><strong style={{ color: '#16a34a' }}>{formatCurrency(filterTotalPaid)}</strong></div>
                <div><span style={{ opacity: 0.6, display: 'block', marginBottom: '0.15rem' }}>Outstanding</span><strong style={{ color: filterTotalOutstanding > 0 ? '#d97706' : '#16a34a' }}>{formatCurrency(filterTotalOutstanding)}</strong></div>
                {filterCtRelief > 0 && (
                    <div title="Net amount deductible for Corporation Tax">
                        <span style={{ opacity: 0.6, display: 'block', marginBottom: '0.15rem' }}>CT relief</span>
                        <strong style={{ color: '#16a34a' }}>{formatCurrency(filterCtRelief)}</strong>
                    </div>
                )}
                <div style={{ opacity: 0.5, alignSelf: 'center', fontSize: '0.75rem', textAlign: 'right' }}>
                    {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}
                    {totalPages > 1 && ` · page ${currentPage}/${totalPages}`}
                </div>
            </div>

            {/* VAT-excluded items (NonCT) */}
            {vatExcludedEntries.length > 0 && (
                <details style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: '#fff8e1', border: '1px solid #ffe0b2', borderRadius: '8px', fontSize: '0.82rem' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#e65100' }}>
                        ⚠️ {vatExcludedEntries.length} item{vatExcludedEntries.length !== 1 ? 's' : ''} excluded from VAT reclaim — {formatCurrency(vatExcludedEntries.reduce((s, e) => s + (e.vatAmount || 0), 0))} VAT not reclaimable
                    </summary>
                    <div style={{ fontSize: '0.75rem', color: '#5d4037', margin: '0.4rem 0' }}>
                        These entries have NonCT status — their VAT cannot be reclaimed but the gross amount is included in the DLA total.
                    </div>
                    <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', marginTop: '0.3rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #ffe0b2' }}>
                                <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Description</th>
                                <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Category</th>
                                <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Date</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>Gross</th>
                                <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>VAT (excluded)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vatExcludedEntries.map(entry => (
                                <tr key={entry.id} style={{ borderBottom: '1px solid #fff3e0' }}>
                                    <td style={{ padding: '4px 6px' }}>{entry.description || '—'}</td>
                                    <td style={{ padding: '4px 6px' }}>{entry.category || '—'}</td>
                                    <td style={{ padding: '4px 6px' }}>{entry.entryDate ? new Date(entry.entryDate).toLocaleDateString('en-GB') : '—'}</td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{formatCurrency(entry.amountGross || 0)}</td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right', color: '#e65100', fontWeight: 600 }}>{formatCurrency(entry.vatAmount || 0)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </details>
            )}


            <div className="dla-list">
                {isMobile ? (
                    <div className="mobile-cards">
                        {paginated.map(entry => (
                            (() => {
                                const entryCompliance = compliance.entryMap[entry.id] || {};
                                return (
                            <div key={entry.id} className="mobile-card" style={{ cursor: 'pointer' }} onClick={() => setViewingEntry(entry)}>
                                <div className="card-header">
                                    <strong>{entry.dlaId}</strong>
                                    <span className="amount">{formatCurrency(entry.amountGross)}</span>
                                </div>
                                <div className="card-body">
                                    <div><strong>Director:</strong> {entry.director}</div>
                                    <div><strong>Description:</strong> {entry.description}</div>
                                    <div><strong>Direction:</strong> {getDirectionLabel(entry.direction)}</div>
                                    <div><strong>Date:</strong> {formatDate(entry.entryDate)}</div>
                                    {entry.category && <div><strong>Category:</strong> {entry.category}</div>}
                                    <div><strong>Paid:</strong> {formatCurrency(entry.amountPaid)}</div>
                                    <div><strong>Remaining:</strong> {formatCurrency(entry.remainingBalance)}</div>
                                    {(entryCompliance.s455DueAmount > 0 || entryCompliance.s455PendingAmount > 0 || entryCompliance.bikRisk) && (
                                        <div className="dla-flags">
                                            {entryCompliance.s455DueAmount > 0 && (
                                                <span
                                                    className="dla-flag dla-flag-danger"
                                                    title={`S455 due on ${formatDate(entryCompliance.s455DueDate)}`}
                                                >
                                                    S455 due
                                                </span>
                                            )}
                                            {entryCompliance.s455PendingAmount > 0 && (
                                                <span
                                                    className="dla-flag dla-flag-warning"
                                                    title={`S455 due on ${formatDate(entryCompliance.s455DueDate)}`}
                                                >
                                                    S455 pending
                                                </span>
                                            )}
                                            {entryCompliance.bikRisk && (
                                                <span className="dla-flag dla-flag-info" title="Loan exceeds £10k in tax year">
                                                    BIK risk
                                                </span>
                                            )}
                                            <div className="dla-compliance-detail">
                                                {entryCompliance.s455DueAmount > 0 && (
                                                    <div>
                                                        S455 due: {formatCurrency(entryCompliance.s455DueAmount)}
                                                    </div>
                                                )}
                                                {entryCompliance.s455PendingAmount > 0 && (
                                                    <div>
                                                        S455 pending: {formatCurrency(entryCompliance.s455PendingAmount)}
                                                    </div>
                                                )}
                                                {(entryCompliance.s455DueAmount > 0 || entryCompliance.s455PendingAmount > 0) && (
                                                    <div>
                                                        Due date: {formatDate(entryCompliance.s455DueDate)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="card-actions" onClick={e => e.stopPropagation()}>
                                    {allowDataDeletion && deleteSelectMode && (
                                        <input type="checkbox" data-bwignore="true" autoComplete="off" checked={deleteSelectedIds.has(entry.id)} onChange={() => toggleDeleteSelectId(entry.id)}
                                            style={{ marginRight: '0.4rem', cursor: 'pointer', width: 16, height: 16 }} />
                                    )}
                                    <button onClick={() => setViewingEntry(entry)} className="btn-icon" title="View">👁️</button>
                                    <button onClick={() => handleEditEntry(entry)} className="btn-icon" title="Edit" style={{marginLeft: '5px'}}>✏️</button>
                                    {entry.remainingBalance > 0 && (
                                        <button onClick={() => openPaymentModal(entry)} className="btn-icon" title="Record Payment" style={{marginLeft: '5px'}}>💷</button>
                                    )}
                                    {entry.receiptUrl && (
                                        <button onClick={() => handleViewReceipts(entry)} className="btn-icon" title="View Receipts" style={{marginLeft: '5px'}}>📎</button>
                                    )}
                                    {!entry.receiptUrl && entry.hasMissingReceiptDeclaration && (
                                        <button onClick={() => window.open(getDlaDeclarationPdfUrl(entry.id), '_blank')} className="btn-icon" title={`Declaration on file: ${entry.missingReceiptDeclarationRef}`} style={{marginLeft: '5px'}}>📎</button>
                                    )}
                                    {!entry.receiptUrl && !entry.hasMissingReceiptDeclaration && !entry.noReceiptReason && (
                                        <button onClick={() => openDlaDeclarationModal(entry)} className="btn-icon" title="Create Missing Receipt Declaration" style={{ marginLeft: '5px', opacity: 0.5 }}>📋</button>
                                    )}
                                    {allowDataDeletion && (
                                        <button onClick={() => handleDeleteEntry(entry.id)} className="btn-icon" title="Delete" style={{marginLeft: '5px'}}>🗑️</button>
                                    )}
                                </div>
                            </div>
                                );
                            })()
                        ))}
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                {selectMode && <th style={{ width: '40px', textAlign: 'center' }}>☑</th>}
                                {allowDataDeletion && deleteSelectMode && <th style={{ width: '40px', textAlign: 'center' }}>🗑️</th>}
                                <th>DLA ID</th>
                                <th>Director</th>
                                <th>Description</th>
                                <th>Direction</th>
                                <th>Category</th>
                                <th>Entry Date</th>
                                <th>Status</th>
                                <th>Date Paid</th>
                                <th>Net</th>
                                <th>VAT</th>
                                <th>Gross</th>
                                <th>Paid</th>
                                <th>Remaining</th>
                                <th>Compliance</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={15 + (selectMode ? 1 : 0) + (allowDataDeletion && deleteSelectMode ? 1 : 0)} style={{ textAlign: 'center' }}>
                                        {dlaEntries.length === 0 ? 'No DLA entries found. Click "Add DLA Entry" to create one.' : 'No entries match the current filter.'}
                                    </td>
                                </tr>
                            ) : (
                                paginated.map(entry => {
                                    const entryCompliance = compliance.entryMap[entry.id] || {};
                                    return (
                                    <tr key={entry.id} style={{ cursor: 'pointer', background: selectMode && selectedEntries.has(entry.id) ? 'rgba(59,130,246,0.08)' : undefined }} onClick={() => selectMode && entry.remainingBalance > 0 ? toggleSelectEntry(entry.id) : setViewingEntry(entry)}>
                                        {selectMode && (
                                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                                {entry.remainingBalance > 0 && (
                                                    <input
                                                        type="checkbox"
                                                        data-bwignore="true"
                                                        autoComplete="off"
                                                        checked={selectedEntries.has(entry.id)}
                                                        onChange={() => toggleSelectEntry(entry.id)}
                                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                    />
                                                )}
                                            </td>
                                        )}
                                        {allowDataDeletion && deleteSelectMode && (
                                            <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    data-bwignore="true"
                                                    autoComplete="off"
                                                    checked={deleteSelectedIds.has(entry.id)}
                                                    onChange={() => toggleDeleteSelectId(entry.id)}
                                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                />
                                            </td>
                                        )}
                                        <td><strong>{entry.dlaId}</strong></td>
                                        <td>{entry.director}</td>
                                        <td>{entry.description}</td>
                                        <td>{getDirectionLabel(entry.direction)}</td>
                                        <td>
                                            {entry.category || '-'}
                                            {entry.hasMissingReceiptDeclaration && (
                                                <span title={`Declaration: ${entry.missingReceiptDeclarationRef}`} style={{ marginLeft: '4px', fontSize: '0.72rem', fontWeight: 600, color: '#fff', backgroundColor: '#1565C0', padding: '1px 6px', borderRadius: '10px', verticalAlign: 'middle' }}>MRD</span>
                                            )}
                                        </td>
                                        <td>{formatDate(entry.entryDate)}</td>
                                        <td>
                                            {(entry.remainingBalance || 0) <= 0 && entry.datePaid
                                                ? <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', backgroundColor: '#2e7d32', padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap' }}>Paid</span>
                                                : (entry.amountPaid || 0) > 0 && (entry.remainingBalance || 0) > 0
                                                    ? <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', backgroundColor: '#ed6c02', padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap' }}>Partial</span>
                                                    : <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', backgroundColor: '#d32f2f', padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap' }}>Unpaid</span>
                                            }
                                        </td>
                                        <td>{formatDate(entry.datePaid)}</td>
                                        <td className="amount">{formatCurrency(entry.amountNet)}</td>
                                        <td className="amount">{formatCurrency(entry.vatAmount)}</td>
                                        <td className="amount"><strong>{formatCurrency(entry.amountGross)}</strong></td>
                                        <td className="amount">{formatCurrency(entry.amountPaid)}</td>
                                        <td className="amount">{formatCurrency(entry.remainingBalance)}</td>
                                        <td>
                                            {(entryCompliance.s455DueAmount > 0 || entryCompliance.s455PendingAmount > 0 || entryCompliance.bikRisk) ? (
                                                <div>
                                                    <div className="dla-flags">
                                                        {entryCompliance.s455DueAmount > 0 && (
                                                            <span
                                                                className="dla-flag dla-flag-danger"
                                                                title={`S455 due on ${formatDate(entryCompliance.s455DueDate)}`}
                                                            >
                                                                S455 due
                                                            </span>
                                                        )}
                                                        {entryCompliance.s455PendingAmount > 0 && (
                                                            <span
                                                                className="dla-flag dla-flag-warning"
                                                                title={`S455 due on ${formatDate(entryCompliance.s455DueDate)}`}
                                                            >
                                                                S455 pending
                                                            </span>
                                                        )}
                                                        {entryCompliance.bikRisk && (
                                                            <span className="dla-flag dla-flag-info" title="Loan exceeds £10k in tax year">
                                                                BIK risk
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="dla-compliance-detail">
                                                        {entryCompliance.s455DueAmount > 0 && (
                                                            <div>
                                                                S455 due: {formatCurrency(entryCompliance.s455DueAmount)}
                                                            </div>
                                                        )}
                                                        {entryCompliance.s455PendingAmount > 0 && (
                                                            <div>
                                                                S455 pending: {formatCurrency(entryCompliance.s455PendingAmount)}
                                                            </div>
                                                        )}
                                                        {(entryCompliance.s455DueAmount > 0 || entryCompliance.s455PendingAmount > 0) && (
                                                            <div>
                                                                Due date: {formatDate(entryCompliance.s455DueDate)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-muted">-</span>
                                            )}
                                        </td>
                                        <td className="actions" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => setViewingEntry(entry)} className="btn-icon" title="View">👁️</button>
                                            <button onClick={() => handleEditEntry(entry)} className="btn-icon" title="Edit" style={{marginLeft: '5px'}}>✏️</button>
                                            {entry.remainingBalance > 0 && (
                                                <button onClick={() => openPaymentModal(entry)} className="btn-icon" title="Record Payment" style={{marginLeft: '5px'}}>💷</button>
                                            )}
                                            <button onClick={() => openPaymentHistory(entry)} className="btn-icon" title="Payment History" style={{marginLeft: '5px'}}>📜</button>
                                            {entry.receiptUrl && (
                                                <button onClick={() => handleViewReceipts(entry)} className="btn-icon" title="View Receipts" style={{marginLeft: '5px'}}>📎</button>
                                            )}
                                            {!entry.receiptUrl && entry.hasMissingReceiptDeclaration && (
                                                <button onClick={() => window.open(getDlaDeclarationPdfUrl(entry.id), '_blank')} className="btn-icon" title={`Declaration on file: ${entry.missingReceiptDeclarationRef}`} style={{marginLeft: '5px'}}>📎</button>
                                            )}
                                            {!entry.receiptUrl && !entry.hasMissingReceiptDeclaration && !entry.noReceiptReason && (
                                                <button onClick={() => openDlaDeclarationModal(entry)} className="btn-icon" title="Create Missing Receipt Declaration" style={{ marginLeft: '5px', opacity: 0.5 }}>📋</button>
                                            )}
                                            {allowDataDeletion && (
                                                <button onClick={() => handleDeleteEntry(entry.id)} className="btn-icon" title="Delete" style={{marginLeft: '5px'}}>🗑️</button>
                                            )}
                                        </td>
                                    </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                )}

                {/* ── Pagination controls ─────────────────────────────── */}
                {totalPages > 1 && (
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }} disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>«</button>
                        <button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }} disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>‹ Prev</button>
                        <span style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem', opacity: 0.7 }}>Page {currentPage} of {totalPages}</span>
                        <button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }} disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next ›</button>
                        <button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }} disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}>»</button>
                    </div>
                )}
            </div>

            <ConfirmDeleteModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                itemLabels={confirmModal.itemLabels}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(m => ({ ...m, isOpen: false }))}
            />

            {showTrivialBenefit && (
                <TrivialBenefitModal
                    directors={directors}
                    onClose={() => setShowTrivialBenefit(false)}
                    onSaved={() => { setShowTrivialBenefit(false); loadData(); }}
                />
            )}
        </div>
    );
};

export default DLA;

