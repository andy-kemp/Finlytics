import React, { useEffect, useRef, useState } from 'react';
import BankImportPreview from './BankImportPreview';
import MonthlyReconciliationReview from './MonthlyReconciliationReview';
import ReceiptInbox from './ReceiptInbox';
import { parseBankCsv, previewBankImport } from '../utils/bankCsv.mjs';
import { compareBankToApp } from '../utils/bankReconciliation.mjs';
import { bankAttention } from '../utils/bankAttention.mjs';
import { calculateRecordedTradingCash } from '../utils/cashCalculations.mjs';
import { mainAccountBookBreakdown } from '../utils/cashBaseline.mjs';
import { buildMonthlyApplyRequest, buildMonthlyProposals, selectPaymentForReview } from '../utils/monthlyReconciliation.mjs';
import { getInvoices, getExpenses, getDlaEntries, getAllDlaPayments, getCompanyLedger, confirmExpenseGbpSettlement, getCategories, getCashBaseline, getReceiptInbox, applyMonthlyReconciliation, getPayrollSettings, getPayrollRuns } from '../services/apiService';
import { getBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount, getBankTransactionsByAccount, createBankTransaction, importBankTransactions, getTrueLayerStatus, getTrueLayerAuthUrl, syncTrueLayerTransactions, disconnectTrueLayer, getGoCardlessInstitutions, connectBankGoCardless, syncGoCardlessTransactions, getGoCardlessBankStatus, getMonzoStatus, getMonzoAuthUrl, syncMonzoTransactions } from '../services/apiService';

// TrueLayer and GoCardless bank feeds are parked in favour of the direct Monzo API.
const legacyBankFeeds = import.meta.env.VITE_ENABLE_LEGACY_BANK_FEEDS === 'true';
const monzoErrors = {
    cancelled: 'Monzo connection was cancelled.',
    invalid_state: 'Monzo connection link expired or was tampered with. Please try again.',
    token_exchange_failed: 'Monzo rejected the authorisation code. Please try again.',
    callback_failed: 'Monzo connection failed. Please try again.'
};

function describeMonzoSync(result) {
    const parts = [`Monzo synced: ${result.imported} new, ${result.linked} linked, ${result.unchanged ?? 0} already imported`];
    if (result.fetched != null) parts.push(`${result.fetched} fetched from Monzo`);
    if (result.vatPot != null || result.ctPot != null) parts.push(`VAT pot £${Number(result.vatPot ?? 0).toFixed(2)}, CT pot £${Number(result.ctPot ?? 0).toFixed(2)}`);
    for (const interest of result.interestRecorded || []) parts.push(`interest £${Number(interest.residual).toFixed(2)} recorded on ${interest.potName}`);
    return parts.join(' · ');
}

const defaultAccount = {
    accountName: '',
    bankName: '',
    sortCode: '',
    accountNumber: '',
    currency: 'GBP',
    openingBalance: '',
    isActive: true,
    notes: ''
};

const defaultTransaction = {
    transactionDate: '',
    amount: '',
    description: '',
    reference: '',
    category: '',
    direction: 'Out'
};

export default function Banking({ reviewAccountId = null, reviewTransactionId = null }) {
    const [accounts, setAccounts] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [showAccountForm, setShowAccountForm] = useState(false);
    const [showTransactionForm, setShowTransactionForm] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [accountForm, setAccountForm] = useState(defaultAccount);
    const [transactionForm, setTransactionForm] = useState(defaultTransaction);
    const [syncResult, setSyncResult] = useState(null);
    const [trueLayerStatus, setTrueLayerStatus] = useState(null);
    const [tlSyncing, setTlSyncing] = useState(false);
    const [gcInstitutions, setGcInstitutions] = useState([]);
    const [gcConnecting, setGcConnecting] = useState(false);
    const [gcSyncing, setGcSyncing] = useState(false);
    const [showGcPicker, setShowGcPicker] = useState(false);
    const [gcPickerAccountId, setGcPickerAccountId] = useState(null);
    const [csvImporting, setCsvImporting] = useState(false);
    const [csvPreview, setCsvPreview] = useState(null);
    const [inboxVersion, setInboxVersion] = useState(0);
    const [monzoStatus, setMonzoStatus] = useState(null);
    const [monzoSyncing, setMonzoSyncing] = useState(false);
    const [monzoWarnings, setMonzoWarnings] = useState([]);
    const [attention, setAttention] = useState(null);
    const [attentionError, setAttentionError] = useState(null);
    const [monzoBalance, setMonzoBalance] = useState(null);
    const openedReview = useRef(null);
    const transactionLoadVersion = useRef(0);
    const ownerApi = Boolean(import.meta.env.VITE_SETTLEMENT_API_SCOPE);
    const csvInputRef = useRef(null);

    const gcInstitutionList = Array.isArray(gcInstitutions)
        ? gcInstitutions
        : (gcInstitutions?.results || gcInstitutions?.institutions || []);

    useEffect(() => {
        loadAccounts();
        if (legacyBankFeeds) getTrueLayerStatus().then(setTrueLayerStatus).catch(() => setTrueLayerStatus({ connected: false }));
        loadMonzoStatus();

        // Handle redirect back from TrueLayer OAuth
        const params = new URLSearchParams(window.location.search);
        if (params.get('monzo_connected') === 'true') {
            setSyncResult(params.get('refresh') === 'missing'
                ? { success: false, message: 'Monzo connected, but no refresh token was issued, so the daily sync will stop working after a few hours. Make the Monzo OAuth client "Confidential" and reconnect.' }
                : { success: true, message: 'Monzo connected. Approve Finlytics in the Monzo app, then press Sync now.' });
            window.history.replaceState({}, '', window.location.pathname);
        } else if (params.get('monzo_error')) {
            setSyncResult({ success: false, message: monzoErrors[params.get('monzo_error')] || 'Monzo connection failed.' });
            window.history.replaceState({}, '', window.location.pathname);
        }
        if (params.get('truelayer_connected') === 'true') {
            setSyncResult({ success: true, message: 'Bank connected via TrueLayer!' });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('truelayer_auth_pending');
            setTimeout(() => { getTrueLayerStatus().then(setTrueLayerStatus).catch(() => {}); loadAccounts(); }, 1500);
        } else if (params.get('truelayer_error')) {
            const errMsg = decodeURIComponent(params.get('truelayer_error'));
            setSyncResult({ success: false, message: `TrueLayer connection failed: ${errMsg}` });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('truelayer_auth_pending');
        }

        // Handle redirect back from GoCardless Bank Data OAuth
        if (params.get('gc_connected') === 'true') {
            setSyncResult({ success: true, message: 'Bank connected via GoCardless!' });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('gc_auth_pending');
            setTimeout(() => { loadAccounts(); }, 1500);
        } else if (params.get('gc_error')) {
            const errMsg = decodeURIComponent(params.get('gc_error'));
            setSyncResult({ success: false, message: `GoCardless connection failed: ${errMsg}` });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('gc_auth_pending');
        }

        // PWA: when user switches back from browser after completing TrueLayer auth,
        // detect connection via visibilitychange / focus events
        const checkPendingAuth = async () => {
            if (!localStorage.getItem('truelayer_auth_pending')) return;
            try {
                const status = await getTrueLayerStatus();
                if (status?.connected) {
                    localStorage.removeItem('truelayer_auth_pending');
                    setTrueLayerStatus(status);
                    setSyncResult({ success: true, message: 'Bank connected via TrueLayer!' });
                    await loadAccounts();
                }
            } catch { /* ignore */ }
        };
        const onResume = () => { if (document.visibilityState === 'visible') { checkPendingAuth(); loadMonzoStatus(); } };
        document.addEventListener('visibilitychange', onResume);
        window.addEventListener('focus', checkPendingAuth);

        // Also check immediately in case PWA was reopened from scratch
        checkPendingAuth();

        return () => {
            document.removeEventListener('visibilitychange', onResume);
            window.removeEventListener('focus', checkPendingAuth);
        };
    }, []);

    async function loadMonzoStatus() {
        try {
            setMonzoStatus(await getMonzoStatus());
        } catch {
            setMonzoStatus({ configured: false, connected: false, unavailable: true });
        }
    }

    const handleMonzoConnect = async () => {
        try {
            const { authUrl } = await getMonzoAuthUrl();
            window.location.href = authUrl;
        } catch (err) {
            setSyncResult({ success: false, message: 'Could not start Monzo connection: ' + err.message });
        }
    };

    const handleMonzoSync = async () => {
        setMonzoSyncing(true);
        setSyncResult(null);
        try {
            const result = await syncMonzoTransactions();
            setMonzoWarnings(result.warnings || []);
            setMonzoBalance(result.mainAccountBalance == null ? null : Number(result.mainAccountBalance));
            const review = await loadAccounts();
            setSyncResult({ success: true, message: describeMonzoSync(result)
                + (review ? ` · ${review.missing.length} payment(s) still missing accounting records` : ' · Accounting review unavailable') });
        } catch (err) {
            setSyncResult({ success: false, message: err.message });
        } finally {
            setMonzoSyncing(false);
            loadMonzoStatus();
        }
    };

    async function loadAccounts() {
        try {
            const data = await getBankAccounts();
            setAccounts(data);
            if (data.length > 0) {
                const account = data.find(item => String(item.id) === String(reviewAccountId)) || data[0];
                setSelectedAccount(account);
                return await loadTransactions(account.id);
            }
        } catch (error) {
            console.error('Error loading accounts:', error);
        } finally {
            setLoading(false);
        }
    }

    async function loadTransactions(accountId) {
        const version = ++transactionLoadVersion.current;
        setAttention(null);
        setAttentionError(null);
        try {
            const data = await getBankTransactionsByAccount(accountId);
            if (version !== transactionLoadVersion.current) return null;
            setTransactions(data);
            const [invoices, expenses, dlaEntries, dlaPayments, ledgerEntries, baseline, payrollSettings, payrollRuns] = await Promise.all([
                getInvoices(), getExpenses(), getDlaEntries(), getAllDlaPayments(), getCompanyLedger('all'), getCashBaseline(accountId),
                getPayrollSettings(), getPayrollRuns()
            ]);
            if (version !== transactionLoadVersion.current) return null;
            const records = { invoices, expenses, dlaEntries, dlaPayments, ledgerEntries,
                includePayroll: Boolean(payrollSettings?.employerPAYEReference || payrollSettings?.employerPayeReference) || payrollRuns.length > 0 };
            const review = bankAttention(data, records, baseline?.asOfDate);
            const breakdown = mainAccountBookBreakdown(calculateRecordedTradingCash(records), baseline, data);
            const result = { ...review, breakdown, baseline, accountId };
            setAttention(result);
            return result;
        } catch (error) {
            console.error('Error loading transactions:', error);
            if (version === transactionLoadVersion.current) setAttentionError(error.message);
            return null;
        }
    }

    const handleReviewPayments = async (event, bankTransactionId = null) => {
        if (!attention || attention.accountId !== selectedAccount?.id) return;
        if (attention.possibleDuplicatePayments.length) {
            setSyncResult({ success: false, message: 'Resolve the possible CSV/Monzo duplicate payments before reconciliation.' });
            return;
        }
        setCsvImporting(true);
        try {
            const [inbox, categories] = await Promise.all([getReceiptInbox(), getCategories()]);
            const proposals = buildMonthlyProposals({ transactions: attention.transactions, comparisons: attention.comparisons,
                existing: transactions, inbox: inbox.filter(receipt => receipt.status === 'analysed'),
                baselineDate: attention.baseline.asOfDate, categories });
            const selectedProposals = bankTransactionId == null ? proposals : selectPaymentForReview(proposals, bankTransactionId);
            setCsvPreview({ source: 'saved', accountId: selectedAccount.id, transactions: attention.transactions, proposals: selectedProposals, categories,
                rejected: [], statement: { balanceErrors: [] } });
        } catch (error) {
            setSyncResult({ success: false, message: `Payment review unavailable: ${error.message}` });
        } finally {
            setCsvImporting(false);
        }
    };

    useEffect(() => {
        if (reviewTransactionId == null || !attention || attention.accountId !== selectedAccount?.id) return;
        if (reviewAccountId != null && String(reviewAccountId) !== String(attention.accountId)) return;
        const key = `${attention.accountId}:${reviewTransactionId}`;
        if (openedReview.current === key) return;
        openedReview.current = key;
        handleReviewPayments(null, reviewTransactionId);
    }, [attention, selectedAccount?.id, reviewAccountId, reviewTransactionId]);

    useEffect(() => {
        if (csvPreview?.source !== 'saved') return;
        const review = document.getElementById('bank-payment-review');
        review?.scrollIntoView({ block: 'start' });
        review?.focus({ preventScroll: true });
    }, [csvPreview?.source]);

    const handleSelectAccount = async (account) => {
        setCsvPreview(null);
        setSelectedAccount(account);
        await loadTransactions(account.id);
    };

    const handleNewAccount = () => {
        setAccountForm(defaultAccount);
        setEditingAccount(null);
        setShowAccountForm(true);
    };

    const handleEditAccount = (account) => {
        setEditingAccount(account);
        setAccountForm({
            accountName: account.accountName || '',
            bankName: account.bankName || '',
            sortCode: account.sortCode || '',
            accountNumber: account.accountNumber || '',
            currency: account.currency || 'GBP',
            openingBalance: account.openingBalance ?? '',
            isActive: account.isActive !== false,
            notes: account.notes || ''
        });
        setShowAccountForm(true);
    };

    const handleSaveAccount = async (e) => {
        e.preventDefault();
        setProcessing(true);
        try {
            const payload = {
                ...accountForm,
                openingBalance: accountForm.openingBalance === '' ? null : Number(accountForm.openingBalance)
            };

            if (editingAccount) {
                await updateBankAccount(editingAccount.id, payload);
            } else {
                await createBankAccount(payload);
            }

            await loadAccounts();
            setShowAccountForm(false);
        } catch (error) {
            console.error('Error saving account:', error);
            alert('Failed to save account: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteAccount = async (account) => {
        if (!confirm(`Delete bank account "${account.accountName}"?`)) return;
        setProcessing(true);
        try {
            await deleteBankAccount(account.id);
            await loadAccounts();
        } catch (error) {
            console.error('Error deleting account:', error);
            alert('Failed to delete account: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleNewTransaction = () => {
        setTransactionForm(defaultTransaction);
        setShowTransactionForm(true);
    };

    const handleCsvImportClick = () => {
        if (!selectedAccount || csvImporting) return;
        csvInputRef.current?.click();
    };

    const handleCsvSelected = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !selectedAccount) return;

        setCsvImporting(true);
        setCsvPreview(null);
        try {
            const csvText = await file.text();
            const parsed = parseBankCsv(csvText, selectedAccount.id, selectedAccount.currency || 'GBP');
            const existing = await getBankTransactionsByAccount(selectedAccount.id);
            let comparison;
            try {
                const [invoices, expenses, dlaEntries, dlaPayments, ledgerEntries] = await Promise.all([
                    getInvoices(), getExpenses(), getDlaEntries(), getAllDlaPayments(), getCompanyLedger('all')
                ]);
                comparison = compareBankToApp(parsed.transactions, { invoices, expenses, dlaEntries, dlaPayments, ledgerEntries });
            } catch (error) {
                comparison = { comparisonError: error.message };
            }
            let monthly = {};
            if (ownerApi && !comparison.comparisonError) {
                const [inbox, categories, baseline] = await Promise.all([
                    getReceiptInbox().catch(() => []), getCategories().catch(() => []), getCashBaseline(selectedAccount.id).catch(() => null)
                ]);
                const categoryList = Array.isArray(categories) ? categories : [];
                monthly = {
                    categories: categoryList,
                    proposals: buildMonthlyProposals({ transactions: parsed.transactions, comparisons: comparison.comparisons, existing,
                        inbox: inbox.filter(item => item.status === 'analysed'), baselineDate: baseline?.asOfDate || null, categories: categoryList })
                };
            }
            setCsvPreview({ ...previewBankImport(parsed.transactions, existing), ...parsed, ...comparison, ...monthly, fileName: file.name, accountId: selectedAccount.id, currency: selectedAccount.currency || 'GBP' });
        } catch (error) {
            console.error('Error importing CSV:', error);
            setSyncResult({ success: false, message: `CSV import failed: ${error.message}` });
        } finally {
            setCsvImporting(false);
        }
    };

    const handleConfirmCsvImport = async () => {
        if (!csvPreview || csvPreview.accountId !== selectedAccount?.id || csvImporting) return;
        setCsvImporting(true);
        try {
            const existing = await getBankTransactionsByAccount(csvPreview.accountId);
            const latest = previewBankImport(csvPreview.newTransactions, existing);
            const result = latest.newTransactions.length ? await importBankTransactions(latest.newTransactions) : [];
            await loadTransactions(csvPreview.accountId);
            setSyncResult({ success: true, message: `Imported ${Array.isArray(result) ? result.length : latest.newTransactions.length} new transactions; ${csvPreview.duplicates.length + latest.duplicates.length} duplicates skipped` });
            setCsvPreview(null);
        } catch (error) {
            setSyncResult({ success: false, message: `CSV import failed: ${error.message}` });
        } finally {
            setCsvImporting(false);
        }
    };

    const handleApplyMonthly = async () => {
        if (!csvPreview?.proposals || csvPreview.accountId !== selectedAccount?.id || csvImporting) return;
        const request = buildMonthlyApplyRequest(csvPreview.accountId, csvPreview.proposals);
        if (!request.actions.length) return;
        if (request.actions.some(action => action.action === 'createExpense' && !action.supplier)) {
            setSyncResult({ success: false, message: 'Every new expense needs a supplier name.' });
            return;
        }
        if (!window.confirm(`Apply ${request.actions.length} reconciliation action(s)? New expenses and links are created in one step.`)) return;
        setCsvImporting(true);
        try {
            const ids = new Set(request.actions.map(action => action.externalId));
            const existing = await getBankTransactionsByAccount(csvPreview.accountId);
            const missing = previewBankImport(csvPreview.transactions.filter(transaction => ids.has(transaction.externalId)), existing).newTransactions;
            if (missing.length) await importBankTransactions(missing);
            const result = await applyMonthlyReconciliation(request);
            const bankRecords = await getBankTransactionsByAccount(csvPreview.accountId);
            setCsvPreview(previous => ({
                ...previous, ...previewBankImport(previous.transactions, bankRecords),
                proposals: previous.proposals.map(proposal => ids.has(proposal.externalId)
                    ? { ...proposal, kind: 'done', selected: false, reason: 'Reconciled' } : proposal)
            }));
            await loadTransactions(csvPreview.accountId);
            setInboxVersion(version => version + 1);
            setSyncResult({ success: true, message: `Reconciled: ${result.linked} linked, ${result.expenses.length} expense(s) created` });
        } catch (error) {
            setSyncResult({ success: false, message: `Reconciliation not applied: ${error.message}. Imported bank rows are kept for review.` });
        } finally {
            setCsvImporting(false);
        }
    };

    const handleConfirmSettlement = async (rowIndex, proposal) => {
        const transaction = csvPreview?.transactions[rowIndex];
        if (!transaction || csvImporting || csvPreview.accountId !== selectedAccount?.id || !transaction.externalId || proposal.ambiguous) return;
        if (!import.meta.env.VITE_SETTLEMENT_API_SCOPE) return;
        if (csvPreview.rejected.length || csvPreview.statement.balanceErrors.length) return;
        if (!window.confirm(`Record GBP ${proposal.actualGbp.toFixed(2)} paid for ${proposal.label}? Invoice and VAT amounts will remain unchanged.`)) return;
        setCsvImporting(true);
        try {
            const records = await getExpenses();
            const expense = records.find(record => record.id === proposal.expenseId);
            if (!expense || expense.actualGbpPaid != null) throw new Error('Expense has changed. Reload the statement preview.');
            const current = compareBankToApp([transaction], { expenses: [expense] }).comparisons[0].settlementCandidates?.[0];
            if (!current || current.actualGbp !== proposal.actualGbp) throw new Error('Settlement no longer matches the invoice.');
            let bankRecords = await getBankTransactionsByAccount(selectedAccount.id);
            let bankTransaction = bankRecords.find(record => record.externalId === transaction.externalId || record.monzoTransactionId === transaction.externalId);
            if (!bankTransaction) {
                await importBankTransactions([transaction]);
                bankRecords = await getBankTransactionsByAccount(selectedAccount.id);
                bankTransaction = bankRecords.find(record => record.externalId === transaction.externalId || record.monzoTransactionId === transaction.externalId);
            }
            if (!bankTransaction || bankTransaction.direction !== 'Out' || Math.round(Number(bankTransaction.amount) * 100) !== Math.round(proposal.actualGbp * 100)) throw new Error('Imported bank transaction differs from the proposal.');
            await confirmExpenseGbpSettlement(expense.id, {
                actualGbpPaid: proposal.actualGbp,
                settlementDate: bankTransaction.transactionDate,
                settlementBankTransactionId: bankTransaction.id
            });
            setCsvPreview(previous => {
                const next = { ...previous, ...previewBankImport(previous.transactions, bankRecords) };
                next.comparisons = previous.comparisons.map((comparison, index) => index === rowIndex
                    ? { ...comparison, status: 'GBP settlement confirmed', settlementCandidates: [] } : comparison);
                return next;
            });
            await loadTransactions(selectedAccount.id);
            setSyncResult({ success: true, message: `GBP ${proposal.actualGbp.toFixed(2)} settlement saved; invoice and VAT amounts unchanged` });
        } catch (error) {
            setSyncResult({ success: false, message: `Settlement failed: ${error.message}. Any imported bank row is retained for review.` });
        } finally {
            setCsvImporting(false);
        }
    };

    const handleSaveTransaction = async (e) => {
        e.preventDefault();
        if (!selectedAccount) return;
        setProcessing(true);
        try {
            const payload = {
                ...transactionForm,
                bankAccountId: selectedAccount.id,
                amount: transactionForm.amount === '' ? null : Number(transactionForm.amount),
                transactionDate: transactionForm.transactionDate || null,
                source: 'Manual'
            };

            await createBankTransaction(payload);
            await loadTransactions(selectedAccount.id);
            setShowTransactionForm(false);
        } catch (error) {
            console.error('Error saving transaction:', error);
            alert('Failed to save transaction: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleTrueLayerConnect = async () => {
        try {
            const data = await getTrueLayerAuthUrl();
            // Set flag so when user returns (especially in PWA) we auto-check status
            localStorage.setItem('truelayer_auth_pending', Date.now().toString());
            window.location.href = data.authUrl;
        } catch (err) {
            setSyncResult({ success: false, message: 'Could not start TrueLayer connection: ' + err.message });
        }
    };

    const handleTrueLayerSync = async () => {
        setTlSyncing(true);
        setSyncResult(null);
        try {
            const result = await syncTrueLayerTransactions();
            setSyncResult({ success: true, message: result.message, imported: result.imported });
            getTrueLayerStatus().then(setTrueLayerStatus).catch(() => {});
            await loadAccounts();
            if (selectedAccount) await loadTransactions(selectedAccount.id);
        } catch (err) {
            setSyncResult({ success: false, message: err.message });
        } finally {
            setTlSyncing(false);
        }
    };

    const handleTrueLayerDisconnect = async () => {
        if (!confirm('Disconnect TrueLayer? Existing imported transactions will remain.')) return;
        try {
            await disconnectTrueLayer();
            setTrueLayerStatus({ connected: false });
            setSyncResult({ success: true, message: 'TrueLayer disconnected' });
            await loadAccounts();
        } catch (err) {
            setSyncResult({ success: false, message: err.message });
        }
    };

    // ── GoCardless Bank Data ──
    const handleGcConnectBank = async (bankAccountId) => {
        setGcPickerAccountId(bankAccountId);
        setShowGcPicker(true);
        if (gcInstitutionList.length === 0) {
            try {
                const data = await getGoCardlessInstitutions();
                setGcInstitutions(Array.isArray(data) ? data : (data?.results || data?.institutions || []));
            } catch (err) {
                setSyncResult({ success: false, message: 'Could not load banks: ' + err.message });
                setShowGcPicker(false);
            }
        }
    };

    const handleGcSelectInstitution = async (institutionId) => {
        setGcConnecting(true);
        try {
            const data = await connectBankGoCardless(institutionId, gcPickerAccountId);
            localStorage.setItem('gc_auth_pending', Date.now().toString());
            window.location.href = data.authUrl;
        } catch (err) {
            setSyncResult({ success: false, message: 'GoCardless connection failed: ' + err.message });
        } finally {
            setGcConnecting(false);
            setShowGcPicker(false);
        }
    };

    const handleGcSync = async (bankAccountId) => {
        setGcSyncing(true);
        setSyncResult(null);
        try {
            const result = await syncGoCardlessTransactions(bankAccountId);
            setSyncResult({ success: true, message: result.message || `Synced ${result.imported || 0} transactions via GoCardless` });
            await loadAccounts();
            if (selectedAccount) await loadTransactions(selectedAccount.id);
        } catch (err) {
            setSyncResult({ success: false, message: err.message });
        } finally {
            setGcSyncing(false);
        }
    };

    return (
        <div className="content-container">
            <div className="section-header">
                <h2>Banking</h2>
                <button className="btn-primary" onClick={handleNewAccount} disabled={processing}>
                    + Add Bank Account
                </button>
            </div>

            {/* ── Monzo Panel ── */}
            {monzoStatus && (
                <div style={{
                    background: monzoStatus.connected ? '#f0fdf4' : '#fff7ed',
                    border: `1px solid ${monzoStatus.connected ? '#bbf7d0' : '#fed7aa'}`,
                    borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: monzoStatus.connected ? '#15803d' : '#9a3412' }}>
                                {monzoStatus.connected ? '✓ Monzo connected' : monzoStatus.configured === false ? 'Monzo not configured' : 'Monzo needs reconnecting'}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                                {monzoStatus.connected
                                    ? 'Transactions and pot balances sync automatically every morning; pot interest is recorded as taxable income.'
                                    : monzoStatus.unavailable
                                        ? 'Could not check the Monzo connection.'
                                        : monzoStatus.message || 'Connect Monzo, then approve Finlytics in the Monzo app.'}
                                {monzoStatus.lastSyncedAt && (
                                    <span> · Last sync: {new Date(monzoStatus.lastSyncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                )}
                                {monzoStatus.connected && monzoStatus.canRefresh && (
                                    <span> · Access renews automatically</span>
                                )}
                                {monzoStatus.connected && monzoStatus.canRefresh === false && (
                                    <span role={monzoStatus.expiryWarning ? 'alert' : undefined} style={{ color: monzoStatus.expiryWarning ? '#dc2626' : '#6b7280', fontWeight: 600 }}>
                                        {monzoStatus.accessExpiresAtUtc
                                            ? ` · Reconnect before ${new Date(monzoStatus.accessExpiresAtUtc).toLocaleString('en-GB')}; automatic renewal is unavailable.`
                                            : ' · No refresh token: automatic renewal is unavailable; expiry time is unknown.'}
                                    </span>
                                )}
                            </div>
                        </div>
                        {monzoStatus.configured !== false && !monzoStatus.unavailable && (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {monzoStatus.connected && (
                                    <button className="btn-primary" onClick={handleMonzoSync} disabled={monzoSyncing || csvImporting}>
                                        {monzoSyncing ? '⏳ Syncing…' : '🔄 Sync now'}
                                    </button>
                                )}
                                <button className={monzoStatus.connected ? 'btn-secondary' : 'btn-primary'} onClick={handleMonzoConnect} disabled={monzoSyncing}>
                                    {monzoStatus.connected ? 'Reconnect' : '🔗 Connect Monzo'}
                                </button>
                            </div>
                        )}
                    </div>
                    {monzoWarnings.length > 0 && (
                        <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.2rem', fontSize: '0.8rem', color: '#9a3412' }}>
                            {monzoWarnings.map(warning => <li key={warning}>{warning}</li>)}
                        </ul>
                    )}
                </div>
            )}

            {/* ── Open Banking Panel ── */}
            {legacyBankFeeds && trueLayerStatus && (
                <div style={{
                    background: trueLayerStatus.connected ? '#eff6ff' : '#fafafa',
                    border: `1px solid ${trueLayerStatus.connected ? '#bfdbfe' : '#e5e7eb'}`,
                    borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>🏛️</span>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: trueLayerStatus.connected ? '#1d4ed8' : '#374151' }}>
                                {trueLayerStatus.connected
                                    ? `✓ Open Banking Connected${trueLayerStatus.provider ? ` — ${trueLayerStatus.provider}` : ''} (${trueLayerStatus.accountCount} account${trueLayerStatus.accountCount !== 1 ? 's' : ''})`
                                    : 'Open Banking (TrueLayer)'}
                            </div>
                            {trueLayerStatus.connected && (
                                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                                    {trueLayerStatus.balance != null && (
                                        <span>Balance: <strong>£{parseFloat(trueLayerStatus.balance).toFixed(2)}</strong></span>
                                    )}
                                    {trueLayerStatus.lastSyncedAt && (
                                        <span style={{ marginLeft: 8 }}>· Last sync: {new Date(trueLayerStatus.lastSyncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    )}
                                    {trueLayerStatus.tokenExpired && (
                                        <span style={{ marginLeft: 8, color: '#dc2626', fontWeight: 600 }}>⚠ Token expired — reconnect below</span>
                                    )}
                                </div>
                            )}
                            {!trueLayerStatus.connected && (
                                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                                    Connect any UK bank account securely via Open Banking
                                </div>
                            )}
                        </div>
                    </div>
                    {!trueLayerStatus.connected && (
                        <button
                            onClick={handleTrueLayerConnect}
                            style={{
                                background: '#2563eb', color: '#fff', border: 'none',
                                borderRadius: 6, padding: '0.5rem 1.1rem',
                                fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer'
                            }}
                        >
                            🔗 Connect Bank
                        </button>
                    )}
                    {trueLayerStatus.connected && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button
                                onClick={handleTrueLayerSync}
                                disabled={tlSyncing}
                                style={{
                                    background: tlSyncing ? '#bfdbfe' : '#2563eb', color: '#fff',
                                    border: 'none', borderRadius: 6, padding: '0.45rem 1rem',
                                    fontWeight: 600, fontSize: '0.875rem', cursor: tlSyncing ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                                }}
                            >
                                {tlSyncing ? '⏳ Syncing…' : '🔄 Sync Transactions'}
                            </button>
                            <button
                                onClick={handleTrueLayerConnect}
                                style={{
                                    background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db',
                                    borderRadius: 6, padding: '0.45rem 0.85rem',
                                    fontWeight: 500, fontSize: '0.8rem', cursor: 'pointer'
                                }}
                            >
                                + Add Bank
                            </button>
                            <button
                                onClick={handleTrueLayerDisconnect}
                                style={{
                                    background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5',
                                    borderRadius: 6, padding: '0.45rem 0.85rem',
                                    fontWeight: 500, fontSize: '0.8rem', cursor: 'pointer'
                                }}
                            >
                                Disconnect
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── GoCardless Bank Institution Picker ── */}
            {legacyBankFeeds && showGcPicker && (
                <div style={{
                    background: '#f9fafb', border: '1px solid #e5e7eb',
                    borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Select your Bank (GoCardless)</h4>
                        <button onClick={() => setShowGcPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#6b7280' }}>✕</button>
                    </div>
                    {gcInstitutionList.length === 0 ? (
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading banks...</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', maxHeight: 300, overflowY: 'auto' }}>
                            {gcInstitutionList.map(inst => (
                                <button
                                    key={inst.id}
                                    onClick={() => handleGcSelectInstitution(inst.id)}
                                    disabled={gcConnecting}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        padding: '0.5rem 0.75rem', border: '1px solid #d1d5db',
                                        borderRadius: 8, background: '#fff', cursor: gcConnecting ? 'not-allowed' : 'pointer',
                                        fontSize: '0.8rem', fontWeight: 500, textAlign: 'left'
                                    }}
                                >
                                    {inst.logo && <img src={inst.logo} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />}
                                    {inst.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Sync / Connection Result Banner ── */}
            {syncResult && (
                <div style={{
                    background: syncResult.success ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${syncResult.success ? '#bbf7d0' : '#fca5a5'}`,
                    borderRadius: 8, padding: '0.6rem 1rem', marginBottom: '1rem',
                    color: syncResult.success ? '#15803d' : '#dc2626',
                    fontWeight: 500, fontSize: '0.875rem',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <span>{syncResult.success ? '✓' : '✗'} {syncResult.message}</span>
                    <button onClick={() => setSyncResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#6b7280' }}>✕</button>
                </div>
            )}

            {showAccountForm && (
                <div className="form-card">
                    <h3>{editingAccount ? 'Edit Bank Account' : 'New Bank Account'}</h3>
                    <form onSubmit={handleSaveAccount}>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Account Name</label>
                                <input value={accountForm.accountName} onChange={e => setAccountForm({ ...accountForm, accountName: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label>Bank Name</label>
                                <input value={accountForm.bankName} onChange={e => setAccountForm({ ...accountForm, bankName: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Sort Code</label>
                                <input value={accountForm.sortCode} onChange={e => setAccountForm({ ...accountForm, sortCode: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Account Number</label>
                                <input value={accountForm.accountNumber} onChange={e => setAccountForm({ ...accountForm, accountNumber: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Currency</label>
                                <input value={accountForm.currency} onChange={e => setAccountForm({ ...accountForm, currency: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Opening Balance</label>
                                <input type="number" step="0.01" value={accountForm.openingBalance} onChange={e => setAccountForm({ ...accountForm, openingBalance: e.target.value })} />
                            </div>
                            <div className="form-group full-width">
                                <label>Notes</label>
                                <textarea value={accountForm.notes} onChange={e => setAccountForm({ ...accountForm, notes: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-actions">
                            <button type="submit" className="btn-primary" disabled={processing}>Save</button>
                            <button type="button" className="btn-secondary" onClick={() => setShowAccountForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="loading">Loading...</div>
            ) : (
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Account</th>
                                <th>Bank</th>
                                <th>Currency</th>
                                <th>Active</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map(account => (
                                <tr key={account.id}>
                                    <td>
                                        <button className="btn-link" onClick={() => handleSelectAccount(account)} disabled={csvImporting}>
                                            {account.accountName}
                                        </button>
                                    </td>
                                    <td>{account.bankName}</td>
                                    <td>{account.currency}</td>
                                    <td>{account.isActive ? 'Yes' : 'No'}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                            <button className="btn-secondary" onClick={() => handleEditAccount(account)}>Edit</button>
                                            <button className="btn-danger" onClick={() => handleDeleteAccount(account)}>Delete</button>
                                            {legacyBankFeeds && (account.goCardlessConnected ? (
                                                <button
                                                    className="btn-secondary"
                                                    disabled={gcSyncing}
                                                    onClick={() => handleGcSync(account.id)}
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    {gcSyncing ? '⏳' : '🔄'} GC Sync
                                                </button>
                                            ) : (
                                                <button
                                                    className="btn-secondary"
                                                    onClick={() => handleGcConnectBank(account.id)}
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    🔗 Connect GC
                                                </button>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {selectedAccount && (
                <div style={{ marginTop: '2rem' }}>
                    <div className="section-header">
                        <h3>Transactions - {selectedAccount.accountName}</h3>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <input
                                ref={csvInputRef}
                                type="file"
                                accept=".csv,text/csv"
                                style={{ display: 'none' }}
                                onChange={handleCsvSelected}
                            />
                            <button className="btn-secondary" onClick={handleCsvImportClick} disabled={csvImporting}>
                                {csvImporting ? 'Reading CSV...' : 'Import CSV'}
                            </button>
                            <button className="btn-primary" onClick={handleNewTransaction}>+ Add Transaction</button>
                        </div>
                    </div>

                    {ownerApi && <ReceiptInbox key={inboxVersion} />}

                    {attentionError && <p role="alert">Accounting comparison unavailable: {attentionError}</p>}
                    {attention && <section aria-label="Bank payments needing attention" style={{ margin: '1rem 0', borderTop: '1px solid #d1d5db', paddingTop: '1rem' }}>
                        <div className="section-header">
                            <h3>Needs Attention ({attention.missing.length}{attention.possibleDuplicatePayments.length ? ' bank rows' : ''})</h3>
                            {ownerApi && attention.transactions.length > 0 && <button className="btn-secondary" onClick={handleReviewPayments} disabled={csvImporting || monzoSyncing || attention.possibleDuplicatePayments.length > 0}>Review Payments</button>}
                        </div>
                        {attention.possibleDuplicatePayments.length > 0
                            ? <p role="alert">{attention.possibleDuplicatePayments.length} possible duplicate payment group(s). Unrecorded totals and reconciliation are unavailable until these bank rows are resolved.</p>
                            : <p>Unrecorded money out: £{attention.moneyOut.toFixed(2)} | Unrecorded money in: £{attention.moneyIn.toFixed(2)}</p>}
                        {attention.missing.length > 0 && <div className="table-container"><table className="data-table">
                            <thead><tr><th>Date</th><th>Description</th><th>Money Out</th><th>Money In</th></tr></thead>
                            <tbody>{attention.missing.map(transaction => <tr key={transaction.id}>
                                <td>{String(transaction.transactionDate).slice(0, 10)}</td><td>{transaction.description}</td>
                                <td>{transaction.direction === 'Out' ? `£${Number(transaction.amount).toFixed(2)}` : '-'}</td>
                                <td>{transaction.direction === 'In' ? `£${Number(transaction.amount).toFixed(2)}` : '-'}</td>
                            </tr>)}</tbody>
                        </table></div>}
                        {attention.transactions.length > attention.missing.length && <p>{attention.transactions.length - attention.missing.length} other payment(s) have potential matches awaiting review.</p>}
                        {attention.possibleDuplicatePayments.length > 0 && <section aria-label="Possible duplicate card payments" style={{ marginTop: '1rem' }}>
                            <h4>Possible Duplicate Payments ({attention.possibleDuplicatePayments.length})</h4>
                            <div className="table-container"><table className="data-table">
                                <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Source</th><th>Bank Row ID</th></tr></thead>
                                <tbody>{attention.possibleDuplicatePayments.flat().map(transaction => <tr key={transaction.id}>
                                    <td>{String(transaction.transactionDate).slice(0, 10)}</td><td>{transaction.description}</td>
                                    <td>£{Number(transaction.amount).toFixed(2)}</td><td>{transaction.source}</td><td>{transaction.id}</td>
                                </tr>)}</tbody>
                            </table></div>
                        </section>}
                        {attention.possibleDuplicatePots.length > 0 && <section aria-label="Possible duplicate pot transfers" style={{ marginTop: '1rem' }}>
                            <h4 role="alert">Possible Duplicate Pot Transfers ({attention.possibleDuplicatePots.length})</h4>
                            <div className="table-container"><table className="data-table">
                                <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Direction</th><th>Source</th><th>Bank Row ID</th></tr></thead>
                                <tbody>{attention.possibleDuplicatePots.flat().map(transaction => <tr key={transaction.id}>
                                    <td>{String(transaction.transactionDate).slice(0, 10)}</td><td>{transaction.description}</td>
                                    <td>£{Number(transaction.amount).toFixed(2)}</td><td>{transaction.direction}</td><td>{transaction.source}</td><td>{transaction.id}</td>
                                </tr>)}</tbody>
                            </table></div>
                        </section>}
                        <details style={{ marginTop: '1rem' }}>
                            <summary>Book Balance Breakdown: £{attention.breakdown.balance.toFixed(2)}</summary>
                            <dl>
                                <dt>Baseline book balance</dt><dd>£{attention.breakdown.baseline.toFixed(2)}</dd>
                                <dt>Historical corrections</dt><dd>£{attention.breakdown.historicalAdjustment.toFixed(2)}</dd>
                                <dt>Change in recorded accounting payments</dt><dd>£{attention.breakdown.recordedChange.toFixed(2)}</dd>
                                <dt>Net pot transfers after baseline</dt><dd>£{attention.breakdown.potTransfers.toFixed(2)}</dd>
                                {monzoBalance != null && <>
                                    <dt>Monzo main-account balance at last manual sync</dt><dd>£{monzoBalance.toFixed(2)}</dd>
                                    <dt>Book minus Monzo</dt><dd>£{(attention.breakdown.balance - monzoBalance).toFixed(2)}</dd>
                                    {attention.possibleDuplicatePayments.length === 0 && <>
                                        <dt>Unrecorded money out minus money in</dt><dd>£{(attention.moneyOut - attention.moneyIn).toFixed(2)}</dd>
                                        <dt>Difference not explained by these missing payments</dt><dd>£{(attention.breakdown.balance - monzoBalance - attention.moneyOut + attention.moneyIn).toFixed(2)}</dd>
                                    </>}
                                </>}
                            </dl>
                        </details>
                    </section>}

                    {csvPreview && csvPreview.source !== 'saved' && <BankImportPreview preview={csvPreview} processing={csvImporting} onConfirm={handleConfirmCsvImport} onCancel={() => setCsvPreview(null)} onSettlement={import.meta.env.VITE_SETTLEMENT_API_SCOPE ? handleConfirmSettlement : undefined} />}

                    {csvPreview?.proposals && <section id="bank-payment-review" tabIndex={-1} aria-label="Selected bank payment review"><MonthlyReconciliationReview proposals={csvPreview.proposals} categories={csvPreview.categories || []}
                        processing={csvImporting} canApply={csvPreview.rejected.length === 0 && csvPreview.statement.balanceErrors.length === 0}
                        onChange={proposals => setCsvPreview(previous => ({ ...previous, proposals }))} onApply={handleApplyMonthly} /></section>}

                    {showTransactionForm && (
                        <div className="form-card">
                            <h4>New Transaction</h4>
                            <form onSubmit={handleSaveTransaction}>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Date</label>
                                        <input type="date" value={transactionForm.transactionDate} onChange={e => setTransactionForm({ ...transactionForm, transactionDate: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Amount</label>
                                        <input type="number" step="0.01" value={transactionForm.amount} onChange={e => setTransactionForm({ ...transactionForm, amount: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Direction</label>
                                        <select value={transactionForm.direction} onChange={e => setTransactionForm({ ...transactionForm, direction: e.target.value })}>
                                            <option>In</option>
                                            <option>Out</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Description</label>
                                        <input value={transactionForm.description} onChange={e => setTransactionForm({ ...transactionForm, description: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Reference</label>
                                        <input value={transactionForm.reference} onChange={e => setTransactionForm({ ...transactionForm, reference: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Category</label>
                                        <input value={transactionForm.category} onChange={e => setTransactionForm({ ...transactionForm, category: e.target.value })} />
                                    </div>
                                </div>
                                <div className="form-actions">
                                    <button type="submit" className="btn-primary">Save</button>
                                    <button type="button" className="btn-secondary" onClick={() => setShowTransactionForm(false)}>Cancel</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Category</th>
                                    <th>Amount</th>
                                    <th>Direction</th>
                                    <th>Reconciled</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map(tx => (
                                    <tr key={tx.id}>
                                        <td>{tx.transactionDate ? tx.transactionDate.substring(0, 10) : ''}</td>
                                        <td>{tx.description}</td>
                                        <td>{tx.category || '—'}</td>
                                        <td>{tx.amount ? `£${tx.amount}` : ''}</td>
                                        <td>{tx.direction}</td>
                                        <td>{tx.isReconciled ? 'Yes' : 'No'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
