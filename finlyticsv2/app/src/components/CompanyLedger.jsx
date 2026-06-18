import React, { useState, useEffect, useMemo } from 'react';
import { 
    getCompanyLedger, 
    createCompanyLedgerEntry, 
    deleteCompanyLedgerEntry,
    getCompanyAggregates,
    getCompanySettings,
    getDlaEntries,
    getInvoices,
    getExpenses,
    getAuthHeaders
} from '../services/apiService';
import { calculateDlaCompliance } from '../services/dlaRules';

const CompanyLedger = () => {
    const [entries, setEntries] = useState([]);
    const [aggregates, setAggregates] = useState(null);
    const [dashboardMetrics, setDashboardMetrics] = useState(null);
    const [dlaCompliance, setDlaCompliance] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [companySettings, setCompanySettings] = useState(null);
    const [showDlaRepayModal, setShowDlaRepayModal] = useState(false);
    const [showBulkDlaModal, setShowBulkDlaModal] = useState(false);
    const [bulkDlaSelected, setBulkDlaSelected] = useState(new Set());
    const [bulkDlaPaymentData, setBulkDlaPaymentData] = useState({
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: '',
        notes: ''
    });
    const [expandedDlaGroups, setExpandedDlaGroups] = useState(new Set());
    const [dlaEntries, setDlaEntries] = useState([]);
    const [periodExpenses, setPeriodExpenses] = useState([]);
    const [expenseSourceFilter, setExpenseSourceFilter] = useState('all'); // 'all' | 'company' | 'employee'
    const [repayData, setRepayData] = useState({
        dlaId: '',
        amount: '',
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod: '',
        notes: '',
        useSuggested: false
    });
    
    // Form state
    const [formData, setFormData] = useState({
        title: '',
        entryType: 'Salary',
        amount: '',
        effectiveDate: new Date().toISOString().split('T')[0],
        notes: '',
        periodKey: getCurrentPeriodKey(),
        taxYear: getCurrentTaxYear(),
        financialYear: getCurrentFinancialYear()
    });

    // Period selection
    const [selectedPeriod, setSelectedPeriod] = useState(getCurrentPeriodKey());
    const [viewMode, setViewMode] = useState('month'); // 'month' | 'quarter' | 'year'
    const [selectedQuarter, setSelectedQuarter] = useState(getCurrentQuarter());
    const [selectedYear, setSelectedYear] = useState(getCurrentCalendarYear());

    useEffect(() => {
        loadCompanySettings();
    }, []);

    useEffect(() => {
        if (companySettings) {
            loadCompanyLedger();
        }
    }, [viewMode, selectedPeriod, selectedQuarter, selectedYear, companySettings]);

    const loadCompanySettings = async () => {
        try {
            const settings = await getCompanySettings();
            setCompanySettings(settings);
        } catch (err) {
            console.error('Error loading company settings:', err);
        }
    };

    function getCurrentPeriodKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    function getCurrentTaxYear() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        return month >= 4 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
    }

    function getCurrentFinancialYear() {
        return new Date().getFullYear().toString();
    }

    function getCurrentQuarter() {
        const now = new Date();
        const q = Math.ceil((now.getMonth() + 1) / 3);
        return `${now.getFullYear()}-Q${q}`;
    }

    function getCurrentCalendarYear() {
        return String(new Date().getFullYear());
    }

    function getViewPeriodKeys() {
        if (viewMode === 'quarter') {
            const [yr, q] = selectedQuarter.split('-Q');
            const startMonth = (parseInt(q) - 1) * 3 + 1;
            return [0, 1, 2].map(i => `${yr}-${String(startMonth + i).padStart(2, '0')}`);
        }
        if (viewMode === 'year') {
            return Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, '0')}`);
        }
        return [selectedPeriod];
    }

    function getViewDateRange() {
        if (viewMode === 'quarter') {
            const [yr, q] = selectedQuarter.split('-Q').map(Number);
            const startMonth = (q - 1) * 3;
            return { start: new Date(yr, startMonth, 1), end: new Date(yr, startMonth + 3, 0, 23, 59, 59, 999) };
        }
        if (viewMode === 'year') {
            const yr = parseInt(selectedYear);
            return { start: new Date(yr, 0, 1), end: new Date(yr, 11, 31, 23, 59, 59, 999) };
        }
        const [year, month] = selectedPeriod.split('-').map(Number);
        return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999) };
    }

    function getViewLabel() {
        if (viewMode === 'quarter') {
            const [yr, q] = selectedQuarter.split('-Q');
            const qLabels = { '1': 'Q1 (Jan–Mar)', '2': 'Q2 (Apr–Jun)', '3': 'Q3 (Jul–Sep)', '4': 'Q4 (Oct–Dec)' };
            return `${qLabels[q]} ${yr}`;
        }
        if (viewMode === 'year') return `Calendar Year ${selectedYear}`;
        return generatePeriodOptions().find(p => p.key === selectedPeriod)?.label ?? selectedPeriod;
    }

    function generateQuarterOptions() {
        const now = new Date();
        const startYear = companySettings?.companyInceptionDate
            ? new Date(companySettings.companyInceptionDate).getFullYear()
            : now.getFullYear() - 4;
        const opts = [];
        for (let year = now.getFullYear(); year >= startYear; year--) {
            const maxQ = year === now.getFullYear() ? Math.ceil((now.getMonth() + 1) / 3) : 4;
            for (let q = maxQ; q >= 1; q--) {
                const labels = { 1: 'Q1 (Jan–Mar)', 2: 'Q2 (Apr–Jun)', 3: 'Q3 (Jul–Sep)', 4: 'Q4 (Oct–Dec)' };
                opts.push({ key: `${year}-Q${q}`, label: `${labels[q]} ${year}` });
            }
        }
        return opts;
    }

    function generateYearOptions() {
        const now = new Date();
        const startYear = companySettings?.companyInceptionDate
            ? new Date(companySettings.companyInceptionDate).getFullYear()
            : now.getFullYear() - 5;
        const opts = [];
        for (let year = now.getFullYear(); year >= startYear; year--) {
            opts.push({ key: String(year), label: String(year) });
        }
        return opts;
    }

    const loadCompanyLedger = async () => {
        try {
            setLoading(true);
            setError(null);
            const periodKeys = getViewPeriodKeys();
            const [entriesArrays, aggregatesArray, invoicesData, expensesData, dlaEntriesData] = await Promise.all([
                Promise.all(periodKeys.map(pk => getCompanyLedger(pk))),
                Promise.all(periodKeys.map(pk => getCompanyAggregates(pk).catch(() => null))),
                getInvoices(),
                getExpenses(),
                getDlaEntries().catch(() => [])
            ]);

            setEntries(entriesArrays.flat());

            // Sum aggregates across all fetched periods
            const combinedAggregates = aggregatesArray.reduce((acc, agg) => {
                if (!agg) return acc;
                const add = (f) => (acc[f] || 0) + (agg[f] || 0);
                return {
                    salaryGross: add('salaryGross'),
                    employeeNI: add('employeeNI'),
                    employerNI: add('employerNI'),
                    payeRemitted: add('payeRemitted'),
                    corpTaxReserved: add('corpTaxReserved'),
                    corpTaxPaid: add('corpTaxPaid'),
                    dividendsDeclared: add('dividendsDeclared'),
                    dividendsPaid: add('dividendsPaid'),
                    dlaNet: add('dlaNet'),
                };
            }, {});
            setAggregates(aggregatesArray.some(a => a) ? combinedAggregates : null);

            setDlaEntries(Array.isArray(dlaEntriesData) ? dlaEntriesData : []);
            setDlaCompliance(calculateDlaCompliance(dlaEntriesData, companySettings));

            const { start: periodStart, end: periodEnd } = getViewDateRange();

            const periodInvoices = invoicesData.filter(inv => {
                if (!inv?.dateIssued) return false;
                const d = new Date(inv.dateIssued);
                return d >= periodStart && d <= periodEnd && inv.status === 'Paid';
            });

            const periodExpenses = expensesData.filter(exp => {
                if (!exp?.entryDate) return false;
                const d = new Date(exp.entryDate);
                return d >= periodStart && d <= periodEnd;
            });

            setPeriodExpenses(periodExpenses);

            // Period DLA entries (OwedToDirector = director paid for company, CT-deductible)
            const periodDla = (Array.isArray(dlaEntriesData) ? dlaEntriesData : []).filter(e => {
                if (!e?.entryDate) return false;
                const d = new Date(e.entryDate);
                return d >= periodStart && d <= periodEnd && e.direction === 'OwedToDirector';
            });
            const periodDlaCtNet = periodDla
                .filter(e => e.ctTag !== 'NonCT')
                .reduce((sum, e) => sum + (e.amountNet || 0), 0);

            const incomeNet = periodInvoices.reduce((sum, inv) => sum + (inv.amountNet || 0), 0);
            const incomeVat = periodInvoices.reduce((sum, inv) => sum + (inv.vatAmount || 0), 0);
            const expenseNet = periodExpenses
                .filter(exp => exp.ctTag !== 'NonCT')
                .reduce((sum, exp) => sum + (exp.amountNet || 0), 0);
            const expenseVat = periodExpenses.reduce((sum, exp) => sum + (exp.vatAmount || 0), 0);

            setDashboardMetrics({
                incomeNet,
                expenseNet,
                periodDlaCtNet,
                tradingProfit: incomeNet - expenseNet - periodDlaCtNet,
                vatBalance: incomeVat - expenseVat
            });
        } catch (err) {
            console.error('Error loading company ledger:', err);
            setError('Failed to load company ledger entries');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            setError(null);

            const parsedTaxYear = typeof formData.taxYear === 'string'
                ? parseInt(formData.taxYear.split('/')[0], 10)
                : formData.taxYear;
            const fallbackTaxYear = Number(selectedPeriod.split('-')[0]);
            const normalizedTaxYear = Number.isFinite(parsedTaxYear) ? parsedTaxYear : fallbackTaxYear;

            const entry = {
                ...formData,
                amount: parseFloat(formData.amount),
                effectiveDate: new Date(formData.effectiveDate).toISOString(),
                periodKey: selectedPeriod,
                taxYear: normalizedTaxYear
            };

            await createCompanyLedgerEntry(entry);
            
            // Reset form and reload data
            setFormData({
                title: '',
                entryType: 'Salary',
                amount: '',
                effectiveDate: new Date().toISOString().split('T')[0],
                notes: '',
                periodKey: getCurrentPeriodKey(),
                taxYear: getCurrentTaxYear(),
                financialYear: getCurrentFinancialYear()
            });
            setShowForm(false);
            await loadCompanyLedger();
        } catch (err) {
            console.error('Error creating entry:', err);
            setError('Failed to create entry');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (id === null || id === undefined || (typeof id === 'string' && id.trim() === '')) {
            alert('Cannot delete: Invalid entry ID');
            return;
        }
        if (!confirm('Are you sure you want to delete this entry?')) return;
        
        try {
            setLoading(true);
            setError(null);
            await deleteCompanyLedgerEntry(id);
            await loadCompanyLedger();
        } catch (err) {
            console.error('Error deleting entry:', err);
            setError('Failed to delete entry');
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: 'GBP'
        }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('en-GB');
    };

    const getDlaReferencePrefix = (entry) => {
        if (!entry || (entry.entryType !== 'DLA_In' && entry.entryType !== 'DLA_Out')) return null;
        const match = (entry.notes || '').match(/Batch payment ref:\s*(DLA-(?:\d{6}-)?\d{3,})/i);
        return match ? match[1].toUpperCase() : null;
    };

    const ledgerRows = useMemo(() => {
        const groupedEntries = new Map();
        for (const entry of entries) {
            const ref = getDlaReferencePrefix(entry);
            if (!ref) continue;
            if (!groupedEntries.has(ref)) groupedEntries.set(ref, []);
            groupedEntries.get(ref).push(entry);
        }

        const seenGroups = new Set();
        const rows = [];

        for (const entry of entries) {
            const ref = getDlaReferencePrefix(entry);

            if (!ref) {
                rows.push({ kind: 'entry', key: `entry-${entry.id}`, entry });
                continue;
            }

            if (seenGroups.has(ref)) continue;
            seenGroups.add(ref);

            const items = (groupedEntries.get(ref) || []).slice().sort((a, b) =>
                new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime());
            const total = items.reduce((sum, item) => sum + (item.amount || 0), 0);
            const latestDate = items[items.length - 1]?.effectiveDate || entry.effectiveDate;

            rows.push({
                kind: 'group',
                key: `group-${ref}`,
                ref,
                total,
                count: items.length,
                latestDate,
                items
            });

            if (expandedDlaGroups.has(ref)) {
                for (const child of items) {
                    rows.push({ kind: 'child', key: `child-${ref}-${child.id}`, ref, entry: child });
                }
            }
        }

        return rows;
    }, [entries, expandedDlaGroups]);

    const toggleDlaGroup = (ref) => {
        setExpandedDlaGroups(prev => {
            const next = new Set(prev);
            if (next.has(ref)) next.delete(ref);
            else next.add(ref);
            return next;
        });
    };

    const openDlaRepayModal = () => {
        setRepayData(prev => ({
            ...prev,
            dlaId: '',
            amount: '',
            paymentDate: new Date().toISOString().split('T')[0],
            paymentMethod: '',
            notes: '',
            useSuggested: false
        }));
        setShowDlaRepayModal(true);
    };

    const getSuggestedRepayment = (dlaId) => {
        const entry = dlaEntries.find(d => d.dlaId === dlaId);
        if (!entry) return 0;
        const remaining = entry.remainingBalance || 0;
        const profit = dashboardMetrics?.tradingProfit || 0;
        return Math.max(0, Math.min(remaining, profit));
    };

    const submitDlaRepayment = async (e) => {
        e.preventDefault();
        if (!repayData.dlaId) return;

        try {
            setLoading(true);
            const headers = await getAuthHeaders();
            const payload = {
                paymentAmount: parseFloat(repayData.amount) || 0,
                paymentDate: new Date(repayData.paymentDate).toISOString(),
                paymentMethod: repayData.paymentMethod || null,
                notes: repayData.notes
            };

            const response = await fetch(`https://finlyticsdevfunc.azurewebsites.net/api/dla/${repayData.dlaId}/payment`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Failed to record DLA repayment');
            }

            await loadCompanyLedger();
            setShowDlaRepayModal(false);
        } catch (err) {
            console.error('Error repaying DLA:', err);
            setError('Failed to repay DLA');
        } finally {
            setLoading(false);
        }
    };

    const openBulkDlaModal = () => {
        setBulkDlaSelected(new Set());
        setBulkDlaPaymentData({
            paymentDate: new Date().toISOString().split('T')[0],
            paymentMethod: '',
            notes: ''
        });
        setShowBulkDlaModal(true);
    };

    const toggleBulkDlaEntry = (dlaId) => {
        setBulkDlaSelected(prev => {
            const next = new Set(prev);
            if (next.has(dlaId)) next.delete(dlaId);
            else next.add(dlaId);
            return next;
        });
    };

    const submitBulkDlaPayment = async (e) => {
        e.preventDefault();
        if (bulkDlaSelected.size === 0) return;
        try {
            setLoading(true);
            const headers = await getAuthHeaders();
            const dlaIds = Array.from(bulkDlaSelected);
            const payload = {
                dlaIds,
                paymentDate: new Date(bulkDlaPaymentData.paymentDate).toISOString(),
                paymentMethod: bulkDlaPaymentData.paymentMethod || null,
                notes: bulkDlaPaymentData.notes || null
            };
            const response = await fetch('https://finlyticsdevfunc.azurewebsites.net/api/dla/batch-payment', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errBody = await response.text();
                let errMessage = 'Failed to record batch payment';
                try {
                    const parsed = JSON.parse(errBody);
                    errMessage = parsed.error || parsed.message || errBody || errMessage;
                } catch {
                    if (errBody) errMessage = errBody;
                }
                throw new Error(errMessage);
            }
            const result = await response.json();
            await loadCompanyLedger();
            setShowBulkDlaModal(false);
            const successCount = result.success?.length || 0;
            const errorCount = result.errors?.length || 0;
            alert(`Batch payment recorded: ${successCount} entr${successCount === 1 ? 'y' : 'ies'} paid off` +
                (result.reference ? `, ref ${result.reference}` : '') +
                (errorCount > 0 ? `, ${errorCount} could not be processed` : ''));
        } catch (err) {
            console.error('Error recording batch DLA payment:', err);
            setError(err?.message || 'Failed to record batch DLA payment');
        } finally {
            setLoading(false);
        }
    };

    const getEntryTypeLabel = (type) => {
        const labels = {
            'Salary': 'Salary (Gross)',
            'EmployeeNI': 'Employee NI',
            'EmployerNI': 'Employer NI',
            'PAYE': 'PAYE Remitted',
            'DLA_In': 'DLA In (to company)',
            'DLA_Out': 'DLA Out (to director)',
            'DLA_Payment': 'DLA Payment',
            'CorpTax_Reserve': 'Corporation Tax Reserved',
            'CorpTax_Paid': 'Corporation Tax Paid',
            'VAT_Paid': 'VAT Paid to HMRC',
            'VAT_Reclaim': 'VAT Reclaim from HMRC',
            'Dividend_Declared': 'Dividend Declared',
            'Dividend_Paid': 'Dividend Paid'
        };
        return labels[type] || type;
    };

    const generatePeriodOptions = () => {
        const options = [];
        const now = new Date();
        
        // Use company inception date or default to 24 months ago
        let startDate;
        if (companySettings?.companyInceptionDate) {
            startDate = new Date(companySettings.companyInceptionDate);
        } else {
            startDate = new Date(now.getFullYear(), now.getMonth() - 24, 1);
        }
        
        // Generate all months from inception to current month
        let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const endDate = new Date(now.getFullYear(), now.getMonth(), 1);
        
        while (currentDate <= endDate) {
            const key = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
            const label = currentDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'long' });
            options.push({ key, label });
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
        
        // Return in reverse order (most recent first)
        return options.reverse();
    };

    const generateMonthEndReport = () => {
        if (!aggregates || !entries.length) {
            alert('No data available for this period');
            return;
        }

        const periodLabel = getViewLabel();
        
        let report = `PERIOD REPORT\n`;
        report += `${companySettings?.companyName || 'Company'}\n`;
        report += `Period: ${periodLabel}\n`;
        report += `Generated: ${new Date().toLocaleDateString('en-GB')}\n`;
        report += `${'='.repeat(60)}\n\n`;
        
        report += `PAYROLL SUMMARY\n`;
        report += `${'-'.repeat(60)}\n`;
        report += `Salary (Gross):           £${(aggregates.salaryGross || 0).toFixed(2)}\n`;
        report += `Employee NI:              £${(aggregates.employeeNI || 0).toFixed(2)}\n`;
        report += `Employer NI:              £${(aggregates.employerNI || 0).toFixed(2)}\n`;
        report += `PAYE Remitted:            £${(aggregates.payeRemitted || 0).toFixed(2)}\n`;
        report += `\n`;
        
        report += `CORPORATION TAX\n`;
        report += `${'-'.repeat(60)}\n`;
        report += `Reserved:                 £${(aggregates.corpTaxReserved || 0).toFixed(2)}\n`;
        report += `Paid:                     £${(aggregates.corpTaxPaid || 0).toFixed(2)}\n`;
        report += `Balance:                  £${((aggregates.corpTaxReserved || 0) - (aggregates.corpTaxPaid || 0)).toFixed(2)}\n`;
        report += `\n`;
        
        report += `DIVIDENDS\n`;
        report += `${'-'.repeat(60)}\n`;
        report += `Declared:                 £${(aggregates.dividendsDeclared || 0).toFixed(2)}\n`;
        report += `Paid:                     £${(aggregates.dividendsPaid || 0).toFixed(2)}\n`;
        report += `Balance:                  £${((aggregates.dividendsDeclared || 0) - (aggregates.dividendsPaid || 0)).toFixed(2)}\n`;
        report += `\n`;
        
        report += `DIRECTORS LOAN ACCOUNT\n`;
        report += `${'-'.repeat(60)}\n`;
        report += `Net Position:             £${(aggregates.dlaNet || 0).toFixed(2)}\n`;
        report += `${aggregates.dlaNet >= 0 ? 'Owed to company' : 'Owed to director'}\n`;
        if (dlaCompliance) {
            report += `Owed to director:         £${(dlaCompliance.totalOwedToDirector || 0).toFixed(2)}\n`;
            report += `Owed to company:          £${(dlaCompliance.totalOwedToCompany || 0).toFixed(2)}\n`;
            report += `Outstanding balance:      £${(dlaCompliance.totalOutstanding || 0).toFixed(2)}\n`;
            report += `S455 due now:             £${(dlaCompliance.s455DueTotal || 0).toFixed(2)}\n`;
            report += `S455 pending:             £${(dlaCompliance.s455PendingTotal || 0).toFixed(2)}\n`;
            report += `BIK risk entries:         ${dlaCompliance.bikRiskCount || 0}\n`;
        }
        report += `\n`;
        
        report += `ENTRIES (${entries.length})\n`;
        report += `${'-'.repeat(60)}\n`;
        entries.forEach(entry => {
            report += `${formatDate(entry.effectiveDate)} - ${entry.title} (${getEntryTypeLabel(entry.entryType)}): £${entry.amount.toFixed(2)}\n`;
        });
        const blob = new Blob([report], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safePeriod = viewMode === 'month' ? selectedPeriod : viewMode === 'quarter' ? selectedQuarter : `Year-${selectedYear}`;
        a.download = `Period-Report-${safePeriod}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const generateYearEndReport = () => {
        alert('Year-end report generation coming soon! This will include full financial year summary with all trading and company ledger data.');
    };

    if (loading) {
        return <div className="loading">Loading company ledger...</div>;
    }

    return (
        <div className="company-ledger">
            <div className="header">
                <h1>Company Ledger</h1>
                <p className="subtitle">Non-trading entries: Salary, NI, PAYE, DLA, Corporation Tax, Dividends</p>
            </div>

            {error && (
                <div className="error-message">
                    {error}
                </div>
            )}

            {/* Period Selector and Actions */}
            <div className="toolbar">
                <div className="period-selector" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '2px', borderRadius: '0.3rem', overflow: 'hidden', border: '1px solid #0f2a4a' }}>
                        {['month', 'quarter', 'year'].map(mode => (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                style={{
                                    padding: '0.25rem 0.65rem',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: viewMode === mode ? '#0f2a4a' : '#f8fafc',
                                    color: viewMode === mode ? '#fff' : '#0f2a4a',
                                    textTransform: 'capitalize'
                                }}
                            >{mode}</button>
                        ))}
                    </div>
                    {viewMode === 'month' && (
                        <>
                            <label htmlFor="period">Month:</label>
                            <select
                                id="period"
                                value={selectedPeriod}
                                onChange={(e) => setSelectedPeriod(e.target.value)}
                            >
                                {generatePeriodOptions().map(opt => (
                                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                                ))}
                            </select>
                        </>
                    )}
                    {viewMode === 'quarter' && (
                        <>
                            <label htmlFor="quarter">Quarter:</label>
                            <select
                                id="quarter"
                                value={selectedQuarter}
                                onChange={(e) => setSelectedQuarter(e.target.value)}
                            >
                                {generateQuarterOptions().map(opt => (
                                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                                ))}
                            </select>
                        </>
                    )}
                    {viewMode === 'year' && (
                        <>
                            <label htmlFor="year">Year:</label>
                            <select
                                id="year"
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(e.target.value)}
                            >
                                {generateYearOptions().map(opt => (
                                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                                ))}
                            </select>
                        </>
                    )}
                </div>
                <div className="toolbar-actions">
                    <button 
                        className="btn btn-secondary"
                        onClick={generateMonthEndReport}
                        disabled={loading || !entries.length}
                        title="Generate period report"
                    >
                        📄 Period Report
                    </button>
                    <button 
                        className="btn btn-secondary"
                        onClick={generateYearEndReport}
                        disabled={loading}
                        title="Generate year-end report"
                    >
                        📊 Year-End Report
                    </button>
                    <button 
                        className="btn btn-primary"
                        onClick={() => setShowForm(!showForm)}
                        disabled={loading}
                    >
                        {showForm ? 'Cancel' : '+ Add Entry'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={openDlaRepayModal}
                        disabled={loading}
                    >
                        💷 Repay DLA
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={openBulkDlaModal}
                        disabled={loading}
                        title="Pay multiple DLA entries in one bank transfer"
                    >
                        💳 Batch Pay DLA
                    </button>
                </div>
            </div>

            {/* Add Entry Form */}
            {showForm && (
                <div className="entry-form card">
                    <h3>Add Company Entry</h3>
                    <form onSubmit={handleSubmit}>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="title">Title *</label>
                                <input
                                    type="text"
                                    id="title"
                                    name="title"
                                    value={formData.title}
                                    onChange={handleInputChange}
                                    required
                                    placeholder="e.g. Director Salary Jan 2026"
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="entryType">Entry Type *</label>
                                <select
                                    id="entryType"
                                    name="entryType"
                                    value={formData.entryType}
                                    onChange={handleInputChange}
                                    required
                                >
                                    <option value="Salary">Salary (Gross)</option>
                                    <option value="EmployeeNI">Employee NI</option>
                                    <option value="EmployerNI">Employer NI</option>
                                    <option value="PAYE">PAYE Remitted</option>
                                    <option value="DLA_In">DLA In (to company)</option>
                                    <option value="DLA_Out">DLA Out (to director)</option>
                                    <option value="CorpTax_Reserve">Corporation Tax Reserved</option>
                                    <option value="CorpTax_Paid">Corporation Tax Paid</option>
                                    <option value="VAT_Paid">VAT Paid to HMRC</option>
                                    <option value="VAT_Reclaim">VAT Reclaim from HMRC</option>
                                    <option value="Dividend_Declared">Dividend Declared</option>
                                    <option value="Dividend_Paid">Dividend Paid</option>
                                </select>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="amount">Amount (£) *</label>
                                <input
                                    type="number"
                                    id="amount"
                                    name="amount"
                                    value={formData.amount}
                                    onChange={handleInputChange}
                                    required
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="effectiveDate">Effective Date *</label>
                                <input
                                    type="date"
                                    id="effectiveDate"
                                    name="effectiveDate"
                                    value={formData.effectiveDate}
                                    onChange={handleInputChange}
                                    required
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="notes">Notes</label>
                            <textarea
                                id="notes"
                                name="notes"
                                value={formData.notes}
                                onChange={handleInputChange}
                                rows="3"
                                placeholder="Optional notes about this entry..."
                            />
                        </div>

                        <div className="form-actions">
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Saving...' : 'Save Entry'}
                            </button>
                            <button 
                                type="button" 
                                className="btn btn-secondary" 
                                onClick={() => setShowForm(false)}
                                disabled={loading}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Period Summary */}
            {aggregates && (
                <div className="period-summary card">
                    <h3>Period Summary — {getViewLabel()}</h3>
                    {dashboardMetrics && (
                        <div className="summary-grid" style={{ marginBottom: '1rem' }}>
                            <div className="summary-section">
                                <h4>Trading Summary</h4>
                                <div className="summary-item">
                                    <span>Income (Net, Paid):</span>
                                    <strong>{formatCurrency(dashboardMetrics.incomeNet)}</strong>
                                </div>
                                <div className="summary-item">
                                    <span>Expenses (Net, CT-allowable):</span>
                                    <strong>{formatCurrency(dashboardMetrics.expenseNet)}</strong>
                                </div>
                                {dashboardMetrics.periodDlaCtNet > 0 && (
                                    <div className="summary-item">
                                        <span>DLA relief (CT-deductible):</span>
                                        <strong className="positive">-{formatCurrency(dashboardMetrics.periodDlaCtNet)}</strong>
                                    </div>
                                )}
                                <div className="summary-item">
                                    <span>Trading Profit (after DLA):</span>
                                    <strong>{formatCurrency(dashboardMetrics.tradingProfit)}</strong>
                                </div>
                                <div className="summary-item">
                                    <span>VAT Balance:</span>
                                    <strong className={dashboardMetrics.vatBalance >= 0 ? 'positive' : 'negative'}>
                                        {formatCurrency(dashboardMetrics.vatBalance)}
                                    </strong>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="summary-grid">
                        <div className="summary-section">
                            <h4>Payroll</h4>
                            <div className="summary-item">
                                <span>Salary (Gross):</span>
                                <strong>{formatCurrency(aggregates.salaryGross)}</strong>
                            </div>
                            <div className="summary-item">
                                <span>Employee NI:</span>
                                <strong>{formatCurrency(aggregates.employeeNI)}</strong>
                            </div>
                            <div className="summary-item">
                                <span>Employer NI:</span>
                                <strong>{formatCurrency(aggregates.employerNI)}</strong>
                            </div>
                            <div className="summary-item">
                                <span>PAYE Remitted:</span>
                                <strong>{formatCurrency(aggregates.payeRemitted)}</strong>
                            </div>
                        </div>

                        <div className="summary-section">
                            <h4>Corporation Tax</h4>
                            <div className="summary-item">
                                <span>Reserved:</span>
                                <strong>{formatCurrency(aggregates.corpTaxReserved)}</strong>
                            </div>
                            <div className="summary-item">
                                <span>Paid:</span>
                                <strong>{formatCurrency(aggregates.corpTaxPaid)}</strong>
                            </div>
                        </div>

                        <div className="summary-section">
                            <h4>Dividends</h4>
                            <div className="summary-item">
                                <span>Declared:</span>
                                <strong>{formatCurrency(aggregates.dividendsDeclared)}</strong>
                            </div>
                            <div className="summary-item">
                                <span>Paid:</span>
                                <strong>{formatCurrency(aggregates.dividendsPaid)}</strong>
                            </div>
                        </div>

                        <div className="summary-section">
                            <h4>Director's Loan Account</h4>
                            {/* Period movement — how much new DLA was charged this month */}
                            {aggregates?.dlaNet !== undefined && aggregates.dlaNet !== 0 && (
                                <div className="summary-item">
                                    <span>This period (charged):</span>
                                    <strong className="positive">
                                        {formatCurrency(aggregates.dlaNet)}
                                    </strong>
                                </div>
                            )}
                            {dlaCompliance && (
                                <>
                                    <div className="summary-item">
                                        <span>All-time owed to director:</span>
                                        <strong className="positive">{formatCurrency(dlaCompliance.totalOwedToDirector)}</strong>
                                    </div>
                                    {dlaCompliance.totalOwedToCompany > 0 && (
                                        <div className="summary-item">
                                            <span>Director owes company:</span>
                                            <strong className="negative">{formatCurrency(dlaCompliance.totalOwedToCompany)}</strong>
                                        </div>
                                    )}
                                    <div className="summary-item">
                                        <span>Net outstanding:</span>
                                        <strong className={dlaCompliance.netOwedToDirector >= 0 ? 'positive' : 'negative'}>
                                            {formatCurrency(dlaCompliance.netOwedToDirector)}
                                        </strong>
                                    </div>
                                    {dlaCompliance.s455DueTotal > 0 && (
                                        <div className="summary-item">
                                            <span>S455 due now:</span>
                                            <strong className="negative">{formatCurrency(dlaCompliance.s455DueTotal)}</strong>
                                        </div>
                                    )}
                                    {dlaCompliance.s455PendingTotal > 0 && (
                                        <div className="summary-item">
                                            <span>S455 pending:</span>
                                            <strong>{formatCurrency(dlaCompliance.s455PendingTotal)}</strong>
                                        </div>
                                    )}
                                    {dlaCompliance.bikRiskCount > 0 && (
                                        <div className="summary-item">
                                            <span>BIK risk entries:</span>
                                            <strong>{dlaCompliance.bikRiskCount}</strong>
                                        </div>
                                    )}
                                </>
                            )}
                            <div className="info-note">
                                <small>
                                    DLA reflects amounts owed to directors for company costs paid personally (e.g. devices, software, services). Director meals/travel/hotels should be recorded as normal expenses.
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showDlaRepayModal && (
                <div className="modal-overlay" onClick={() => setShowDlaRepayModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Repay DLA</h3>
                            <button className="btn-close" onClick={() => setShowDlaRepayModal(false)}>✖</button>
                        </div>
                        <form onSubmit={submitDlaRepayment} className="dla-form">
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>DLA Entry *</label>
                                    <select
                                        value={repayData.dlaId}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            const suggested = getSuggestedRepayment(value);
                                            setRepayData(prev => ({
                                                ...prev,
                                                dlaId: value,
                                                amount: prev.useSuggested ? suggested.toFixed(2) : prev.amount
                                            }));
                                        }}
                                        required
                                    >
                                        <option value="">Select DLA</option>
                                        {dlaEntries.map(entry => (
                                            <option key={entry.dlaId} value={entry.dlaId}>
                                                {entry.dlaId} - {entry.director} ({entry.remainingBalance?.toFixed(2) || '0.00'})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Payment Date *</label>
                                    <input
                                        type="date"
                                        value={repayData.paymentDate}
                                        onChange={(e) => setRepayData(prev => ({ ...prev, paymentDate: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Amount *</label>
                                    <input
                                        type="number"
                                        value={repayData.amount}
                                        onChange={(e) => setRepayData(prev => ({ ...prev, amount: e.target.value }))}
                                        step="0.01"
                                        required
                                    />
                                    <label style={{ marginTop: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={repayData.useSuggested}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                const suggested = getSuggestedRepayment(repayData.dlaId);
                                                setRepayData(prev => ({
                                                    ...prev,
                                                    useSuggested: checked,
                                                    amount: checked ? suggested.toFixed(2) : prev.amount
                                                }));
                                            }}
                                        />
                                        {' '}Use suggested amount (profit after CT)
                                    </label>
                                </div>
                                <div className="form-group">
                                    <label>Payment Method</label>
                                    <input
                                        type="text"
                                        value={repayData.paymentMethod}
                                        onChange={(e) => setRepayData(prev => ({ ...prev, paymentMethod: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group full-width">
                                    <label>Notes</label>
                                    <textarea
                                        value={repayData.notes}
                                        onChange={(e) => setRepayData(prev => ({ ...prev, notes: e.target.value }))}
                                        rows="3"
                                    />
                                </div>
                            </div>
                            <div className="form-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowDlaRepayModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={loading}>
                                    {loading ? 'Saving...' : 'Record Repayment'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Bulk DLA Payment Modal */}
            {showBulkDlaModal && (() => {
                const outstanding = dlaEntries.filter(e => (e.remainingBalance || 0) > 0);
                const selectedItems = outstanding.filter(e => bulkDlaSelected.has(e.dlaId));
                const selectedTotal = selectedItems.reduce((s, e) => s + (e.remainingBalance || 0), 0);
                const allSelected = outstanding.length > 0 && outstanding.every(e => bulkDlaSelected.has(e.dlaId));
                return (
                    <div className="modal-overlay" onClick={() => !loading && setShowBulkDlaModal(false)}>
                        <div className="modal-content" style={{ maxWidth: '580px' }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3>💳 Batch DLA Payment</h3>
                                <button className="btn-close" onClick={() => setShowBulkDlaModal(false)} disabled={loading}>✖</button>
                            </div>
                            {outstanding.length === 0 ? (
                                <p style={{ padding: '1rem 1.25rem' }}>No outstanding DLA entries to pay.</p>
                            ) : (
                                <>
                                    {/* Entry selection */}
                                    <div style={{ padding: '0.75rem 1.25rem 0' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={() => {
                                                    if (allSelected) setBulkDlaSelected(new Set());
                                                    else setBulkDlaSelected(new Set(outstanding.map(e => e.dlaId)));
                                                }}
                                            />
                                            Select all outstanding ({outstanding.length})
                                        </label>
                                        <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: '6px', overflow: 'hidden', maxHeight: '220px', overflowY: 'auto' }}>
                                            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ background: 'rgba(0,0,0,0.05)', position: 'sticky', top: 0 }}>
                                                        <th style={{ padding: '0.4rem 0.75rem', width: '36px' }}></th>
                                                        <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left' }}>DLA ID</th>
                                                        <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left' }}>Description</th>
                                                        <th style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>Remaining</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {outstanding.map(entry => (
                                                        <tr key={entry.dlaId} style={{ borderTop: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}
                                                            onClick={() => toggleBulkDlaEntry(entry.dlaId)}>
                                                            <td style={{ padding: '0.35rem 0.75rem', textAlign: 'center' }}>
                                                                <input type="checkbox" checked={bulkDlaSelected.has(entry.dlaId)}
                                                                    onChange={() => toggleBulkDlaEntry(entry.dlaId)}
                                                                    onClick={e => e.stopPropagation()}
                                                                    style={{ width: '15px', height: '15px' }} />
                                                            </td>
                                                            <td style={{ padding: '0.35rem 0.75rem' }}><strong>{entry.dlaId}</strong></td>
                                                            <td style={{ padding: '0.35rem 0.75rem', color: 'rgba(0,0,0,0.65)' }}>{entry.description}</td>
                                                            <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right' }}>{formatCurrency(entry.remainingBalance)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                {bulkDlaSelected.size > 0 && (
                                                    <tfoot>
                                                        <tr style={{ background: 'rgba(0,0,0,0.04)', borderTop: '2px solid rgba(0,0,0,0.15)' }}>
                                                            <td colSpan="3" style={{ padding: '0.5rem 0.75rem', fontWeight: 700 }}>Total bank transfer to director</td>
                                                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{formatCurrency(selectedTotal)}</td>
                                                        </tr>
                                                    </tfoot>
                                                )}
                                            </table>
                                        </div>
                                    </div>
                                    <form onSubmit={submitBulkDlaPayment} className="dla-form" style={{ padding: '0.75rem 1.25rem 1rem' }}>
                                        <div className="form-grid">
                                            <div className="form-group">
                                                <label>Payment Date *</label>
                                                <input type="date" value={bulkDlaPaymentData.paymentDate}
                                                    onChange={e => setBulkDlaPaymentData(prev => ({ ...prev, paymentDate: e.target.value }))}
                                                    required />
                                            </div>
                                            <div className="form-group">
                                                <label>Payment Method</label>
                                                <input type="text" value={bulkDlaPaymentData.paymentMethod}
                                                    onChange={e => setBulkDlaPaymentData(prev => ({ ...prev, paymentMethod: e.target.value }))}
                                                    placeholder="e.g. Bank Transfer" />
                                            </div>
                                            <div className="form-group full-width">
                                                <label>Payment Reference</label>
                                                <div style={{ padding: '0.8rem 0.95rem', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}>
                                                    Generated automatically when you submit, using the payment month and next available sequence, for example DLA-202604-001.
                                                </div>
                                            </div>
                                            <div className="form-group full-width">
                                                <label>Notes <span style={{ opacity: 0.55, fontSize: '0.8rem' }}>(optional)</span></label>
                                                <textarea value={bulkDlaPaymentData.notes}
                                                    onChange={e => setBulkDlaPaymentData(prev => ({ ...prev, notes: e.target.value }))}
                                                    rows="2" placeholder="e.g. Monthly director repayment" />
                                            </div>
                                        </div>
                                        <div className="form-actions">
                                            <button type="button" className="btn btn-secondary" onClick={() => setShowBulkDlaModal(false)} disabled={loading}>Cancel</button>
                                            <button type="submit" className="btn btn-primary" disabled={loading || bulkDlaSelected.size === 0}>
                                                {loading ? 'Processing…' : bulkDlaSelected.size === 0 ? 'Select entries above' : `💳 Pay ${bulkDlaSelected.size} entr${bulkDlaSelected.size === 1 ? 'y' : 'ies'} (${formatCurrency(selectedTotal)})`}
                                            </button>
                                        </div>
                                    </form>
                                </>
                            )}
                        </div>
                    </div>
                );
            })()}

            {/* Entries Table */}
            <div className="entries-table card">
                <h3>Entries</h3>
                {loading && <p>Loading...</p>}
                {!loading && entries.length === 0 && (
                    <p className="no-data">No entries for this period. Click "Add Entry" to create one.</p>
                )}
                {!loading && entries.length > 0 && (
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Title</th>
                                <th>Type</th>
                                <th>Amount</th>
                                <th>Notes</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ledgerRows.map(row => {
                                if (row.kind === 'group') {
                                    const isExpanded = expandedDlaGroups.has(row.ref);
                                    return (
                                        <tr key={row.key} style={{ background: '#f8fafc', borderTop: '2px solid rgba(15,42,74,0.2)' }}>
                                            <td>{formatDate(row.latestDate)}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleDlaGroup(row.ref)}
                                                    style={{
                                                        border: 'none',
                                                        background: 'transparent',
                                                        cursor: 'pointer',
                                                        fontWeight: 700,
                                                        color: '#0f2a4a',
                                                        padding: 0
                                                    }}
                                                    title={isExpanded ? 'Collapse items' : 'Expand items'}
                                                >
                                                    {isExpanded ? '▼' : '▶'} {row.ref} ({row.count} items)
                                                </button>
                                            </td>
                                            <td>
                                                <span style={{
                                                    display: 'inline-block',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '999px',
                                                    background: '#dbeafe',
                                                    color: '#1e40af',
                                                    fontWeight: 600,
                                                    fontSize: '0.75rem'
                                                }}>
                                                    DLA Batch
                                                </span>
                                            </td>
                                            <td className="amount"><strong>{formatCurrency(row.total)}</strong></td>
                                            <td className="notes">Grouped repayment entries for {row.ref}</td>
                                            <td></td>
                                        </tr>
                                    );
                                }

                                const entry = row.entry;
                                const isChild = row.kind === 'child';

                                return (
                                    <tr key={row.key} style={isChild ? { background: '#fcfdff' } : undefined}>
                                        <td>{formatDate(entry.effectiveDate)}</td>
                                        <td style={isChild ? { paddingLeft: '1.5rem' } : undefined}>
                                            {isChild ? `↳ ${entry.title}` : entry.title}
                                        </td>
                                        <td>
                                            <span className={`badge badge-${entry.entryType.toLowerCase()}`}>
                                                {getEntryTypeLabel(entry.entryType)}
                                            </span>
                                        </td>
                                        <td className="amount">{formatCurrency(entry.amount)}</td>
                                        <td className="notes">{entry.notes}</td>
                                        <td>
                                            <button
                                                className="btn-icon"
                                                onClick={() => handleDelete(entry.id)}
                                                disabled={loading}
                                                title="Delete entry"
                                            >
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Expenses Table */}
            <div className="entries-table card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0 }}>Expenses</h3>
                    <div style={{ display: 'flex', gap: '4px', borderRadius: '0.3rem', overflow: 'hidden', border: '1px solid #0f2a4a' }}>
                        {[{ key: 'all', label: 'All' }, { key: 'company', label: 'Company' }, { key: 'employee', label: 'Employee Claims' }].map(opt => (
                            <button
                                key={opt.key}
                                onClick={() => setExpenseSourceFilter(opt.key)}
                                style={{
                                    padding: '0.2rem 0.6rem',
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: expenseSourceFilter === opt.key ? '#0f2a4a' : '#f8fafc',
                                    color: expenseSourceFilter === opt.key ? '#fff' : '#0f2a4a'
                                }}
                            >{opt.label}</button>
                        ))}
                    </div>
                </div>
                {(() => {
                    const filtered = periodExpenses
                        .filter(e => !e.isDLA)
                        .filter(e => {
                            if (expenseSourceFilter === 'company') return !e.submittedByTeamMemberId;
                            if (expenseSourceFilter === 'employee') return !!e.submittedByTeamMemberId;
                            return true;
                        });
                    if (loading) return <p>Loading...</p>;
                    if (filtered.length === 0) return <p className="no-data">No expenses for this period.</p>;
                    return (
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Supplier</th>
                                    <th>Category</th>
                                    <th>Source</th>
                                    <th>Net</th>
                                    <th>VAT</th>
                                    <th>Gross</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(exp => (
                                    <tr key={exp.id}>
                                        <td>{formatDate(exp.entryDate)}</td>
                                        <td>{exp.supplier}</td>
                                        <td>{exp.category}</td>
                                        <td>
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '0.15rem 0.5rem',
                                                borderRadius: '999px',
                                                fontSize: '0.72rem',
                                                fontWeight: 600,
                                                background: exp.submittedByTeamMemberId ? '#f3e8ff' : '#f1f5f9',
                                                color: exp.submittedByTeamMemberId ? '#7c3aed' : '#64748b'
                                            }}>
                                                {exp.submittedByTeamMemberId ? 'Employee' : 'Company'}
                                            </span>
                                        </td>
                                        <td className="amount">{formatCurrency(exp.amountNet)}</td>
                                        <td className="amount">{formatCurrency(exp.vatAmount)}</td>
                                        <td className="amount">{formatCurrency(exp.amountGross)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ fontWeight: 700, borderTop: '2px solid rgba(0,0,0,0.15)' }}>
                                    <td colSpan="4">Total ({filtered.length})</td>
                                    <td className="amount">{formatCurrency(filtered.reduce((s, e) => s + (e.amountNet || 0), 0))}</td>
                                    <td className="amount">{formatCurrency(filtered.reduce((s, e) => s + (e.vatAmount || 0), 0))}</td>
                                    <td className="amount">{formatCurrency(filtered.reduce((s, e) => s + (e.amountGross || 0), 0))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    );
                })()}
            </div>
        </div>
    );
};

export default CompanyLedger;

