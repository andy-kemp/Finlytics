import React, { useEffect, useState, useCallback } from 'react';
import {
    getVatReturns,
    createVatReturn,
    updateVatReturn,
    deleteVatReturn,
    getInvoices,
    getExpenses,
    getCompanySettings,
    getDlaEntries,
    getHmrcStatus,
    getHmrcAuthUrl,
    disconnectHmrc,
    getHmrcVatObligations,
    submitVatReturnToHmrc,
    viewHmrcVatReturn
} from '../services/apiService';

// ── Quarter helpers ──────────────────────────────────────────────────────────

/**
 * Given vatQuarterStartMonth (1-12) and a reference date,
 * compute the last N quarter periods (most-recent first).
 */
function getVatQuarterPeriods(vatQuarterStartMonth = 1, numQuarters = 8) {
    const startM = (vatQuarterStartMonth - 1 + 12) % 12; // 0-indexed
    const now = new Date();

    // Months elapsed since the most recent quarter-start month
    const monthsFromLastStart = (now.getMonth() - startM + 12) % 12;
    const monthsBack = monthsFromLastStart % 3; // offset within current quarter

    const currentQStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);

    const quarters = [];
    for (let i = 0; i < numQuarters; i++) {
        const qStart = new Date(currentQStart.getFullYear(), currentQStart.getMonth() - i * 3, 1);
        const qEnd   = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0, 23, 59, 59, 999);

        // VAT fiscal year: most recent occurrence of startM on or before qStart
        let vatYearStart = new Date(qStart.getFullYear(), startM, 1);
        if (vatYearStart > qStart) vatYearStart.setFullYear(vatYearStart.getFullYear() - 1);

        const monthsIn = (qStart.getFullYear() - vatYearStart.getFullYear()) * 12
                       + (qStart.getMonth() - vatYearStart.getMonth());
        const qNum = Math.floor(monthsIn / 3) + 1;

        const vy = vatYearStart.getFullYear();
        const vatYearLabel = `${vy}/${String(vy + 1).slice(-2)}`;

        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthsLabel = `${MONTHS[qStart.getMonth()]} – ${MONTHS[qEnd.getMonth()]} ${qEnd.getFullYear()}`;

        quarters.push({
            quarterLabel: `Q${qNum} ${vatYearLabel}`,
            monthsLabel,
            quarterStartDate: qStart.toISOString(),
            quarterEndDate:   qEnd.toISOString(),
            isCurrent: i === 0
        });
    }
    return quarters;
}

/** Sum VAT for items whose dateField falls within [start, end] */
function sumVatInPeriod(items, dateField, vatField, start, end) {
    return items.reduce((sum, item) => {
        if (!item[dateField]) return sum;
        const d = new Date(item[dateField]);
        if (d >= start && d <= end) return sum + (item[vatField] || 0);
        return sum;
    }, 0);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VatReturns() {
    const [loading, setLoading]           = useState(true);
    const [quarters, setQuarters]         = useState([]);
    const [filedReturns, setFiledReturns] = useState([]);
    const [invoices, setInvoices]         = useState([]);
    const [expenses, setExpenses]         = useState([]);
    const [dlaEntries, setDlaEntries]     = useState([]);
    const [settings, setSettings]         = useState(null);
    const [toast, setToast]               = useState(null);

    // File modal state
    const [showFileModal, setShowFileModal] = useState(false);
    const [filingQuarter, setFilingQuarter] = useState(null); // the quarter being filed
    const [filingCalc, setFilingCalc]       = useState(null); // calculated vatIn/vatOut/owed
    const [filingRef, setFilingRef]         = useState('');
    const [filingDate, setFilingDate]       = useState('');
    const [filingNotes, setFilingNotes]     = useState('');
    const [filingSubmitting, setFilingSubmitting] = useState(false);

    // Edit modal state  
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingReturn, setEditingReturn] = useState(null);
    const [editRef, setEditRef]             = useState('');
    const [editDate, setEditDate]           = useState('');
    const [editNotes, setEditNotes]         = useState('');
    const [editSubmitting, setEditSubmitting] = useState(false);

    const [showAllYears, setShowAllYears] = useState(false);

    // ── HMRC MTD state ────────────────────────────────────────────────────────
    const [hmrcConnected, setHmrcConnected]     = useState(false);
    const [hmrcLoading, setHmrcLoading]         = useState(false);
    const [hmrcObligations, setHmrcObligations] = useState([]);

    // HMRC submit modal
    const [showHmrcModal, setShowHmrcModal]     = useState(false);
    const [hmrcQuarter, setHmrcQuarter]         = useState(null);
    const [hmrcCalc, setHmrcCalc]               = useState(null);
    const [hmrcPeriodKey, setHmrcPeriodKey]     = useState('');
    const [hmrcFinalise, setHmrcFinalise]       = useState(true);
    const [hmrcSubmitting, setHmrcSubmitting]   = useState(false);
    const [hmrcModalMsg, setHmrcModalMsg]       = useState(null); // { type: 'success'|'info'|'warning'|'error', text: string }
    const [hmrcVerify, setHmrcVerify]           = useState({}); // { [key]: { loading, result, error } }
    const [verifyModal, setVerifyModal]         = useState(null); // { quarterLabel, periodKey, filed } — drives verify modal

    const showToast = useCallback((msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }, []);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [filed, invs, exps, dla, sett] = await Promise.all([
                getVatReturns().catch(() => []),
                getInvoices().catch(() => []),
                getExpenses().catch(() => []),
                getDlaEntries().catch(() => []),
                getCompanySettings().catch(() => null)
            ]);
            setFiledReturns(filed);
            setInvoices(invs);
            setExpenses(exps);
            setDlaEntries(dla);
            setSettings(sett);

            const vatStartMonth = sett?.vatQuarterStartMonth || 1;
            setQuarters(getVatQuarterPeriods(vatStartMonth, 40));
        } catch (err) {
            console.error('Error loading VAT returns:', err);
            showToast('Failed to load data', 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { loadData(); }, [loadData]);

    // Check HMRC connection status on mount + handle OAuth callback redirect
    useEffect(() => {
        getHmrcStatus()
            .then(r => setHmrcConnected(r?.connected || false))
            .catch(() => {});

        const hash = window.location.hash;
        if (hash === '#hmrc-connected') {
            showToast('Connected to HMRC MTD ✓');
            setHmrcConnected(true);
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        } else if (hash.startsWith('#hmrc-error=')) {
            const errMsg = decodeURIComponent(hash.slice('#hmrc-error='.length));
            showToast('HMRC connection failed: ' + errMsg, 'error');
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }, [showToast]);

    // ── Derived data ──────────────────────────────────────────────────────────

    const calcForQuarter = (q) => {
        const start = new Date(q.quarterStartDate);
        const end   = new Date(q.quarterEndDate);

        // Inception/VAT-registration reference date for pre-registration reclaim rules.
        // HMRC VAT Notice 700/1: goods purchased up to 4 years before VAT registration
        // can be reclaimed in the first VAT return.
        const inceptionDate = settings?.incorporationDate
            ? new Date(settings.incorporationDate)
            : settings?.companyInceptionDate
                ? new Date(settings.companyInceptionDate)
                : null;

        // Is this the oldest displayed quarter?
        // Check whether the previous quarter (3 months earlier) would pass the inception-date
        // filter. If it wouldn't, this quarter is the first visible one.
        const prevQuarterStart = new Date(start.getFullYear(), start.getMonth() - 3, 1);
        const prevWouldShow = inceptionDate ? prevQuarterStart >= inceptionDate : true;
        const isOldestDisplayedQuarter = !prevWouldShow;

        // VAT accounting method: 'invoice' = count by issue date; default (cash) = count by payment date.
        const usePaymentDate = settings?.vatAccountingMethod !== 'invoice';

        // "First VAT quarter" = the quarter whose period contains the inception date,
        // or the oldest displayed quarter if inception predates it.
        // Pre-registration entries belong here, not scattered in historical quarters.
        const isFirstVatQuarter = inceptionDate
            ? (start <= inceptionDate && end >= inceptionDate)
                || isOldestDisplayedQuarter
            : isOldestDisplayedQuarter;

        // 4-year lookback cutoff for pre-registration goods (DLA & expenses)
        const fourYearCutoff = inceptionDate
            ? new Date(inceptionDate.getFullYear() - 4, inceptionDate.getMonth(), inceptionDate.getDate())
            : null;

        // VAT on sales.
        // Cash accounting: count by payment date (Paid invoices only).
        // Standard accounting: count by issue date, absorbing pre-inception and stub-period invoices.
        const vatIn = invoices.reduce((sum, inv) => {
            if (usePaymentDate) {
                // Cash accounting — only Paid invoices, counted by payment date
                if (!inv.datePaid || inv.status !== 'Paid') return sum;
                const d = new Date(inv.datePaid);
                if (d >= start && d <= end) return sum + (inv.vatAmount || 0);
                return sum;
            }
            // Standard (invoice date) accounting
            if (!inv.dateIssued) return sum;
            const d = new Date(inv.dateIssued);
            const isPreInception = inceptionDate && d < inceptionDate;
            // Post-inception entry in its natural period
            if (!isPreInception && d >= start && d <= end) return sum + (inv.vatAmount || 0);
            // Pre-inception: claim in first VAT quarter only
            if (isPreInception && isFirstVatQuarter) return sum + (inv.vatAmount || 0);
            // Stub period: between inception and first quarter start — absorb into first quarter
            if (isFirstVatQuarter && !isPreInception && inceptionDate && d >= inceptionDate && d < start)
                return sum + (inv.vatAmount || 0);
            // Fallback when no inception date configured
            if (!inceptionDate && isOldestDisplayedQuarter && d < start) return sum + (inv.vatAmount || 0);
            return sum;
        }, 0);

        // Input VAT on expenses — first-VAT-quarter absorbs pre-registration expenses (4-year rule).
        // NonCT items (e.g. client entertainment) have no VAT relief — excluded from reclaim.
        const vatOutExpenses = expenses.filter(e => e.ctTag !== 'NonCT').reduce((sum, e) => {
            if (!e.entryDate) return sum;
            const d = new Date(e.entryDate);
            const isPreInception = inceptionDate && d < inceptionDate;
            // Post-inception entry in its natural period
            if (!isPreInception && d >= start && d <= end) return sum + (e.vatAmount || 0);
            // Pre-registration: claim in first VAT quarter only, within 4-year lookback
            if (isPreInception && isFirstVatQuarter && (!fourYearCutoff || d >= fourYearCutoff))
                return sum + (e.vatAmount || 0);
            // Stub period: between inception and first quarter start — absorb into first quarter
            if (isFirstVatQuarter && !isPreInception && inceptionDate && d >= inceptionDate && d < start)
                return sum + (e.vatAmount || 0);
            // Fallback
            if (!inceptionDate && isOldestDisplayedQuarter && d < start) return sum + (e.vatAmount || 0);
            return sum;
        }, 0);

        // DLA — first-VAT-quarter absorbs pre-registration director-paid costs (4-year rule).
        // HMRC allows reclaiming VAT on goods purchased up to 4 years before VAT registration.
        // NonCT items (e.g. client entertainment) have no VAT relief — excluded from reclaim.
        const vatOutDla = dlaEntries
            .filter(e => e.direction === 'OwedToDirector' && e.ctTag !== 'NonCT')
            .reduce((sum, e) => {
                if (!e.entryDate) return sum;
                const d = new Date(e.entryDate);
                const isPreInception = inceptionDate && d < inceptionDate;
                // Post-inception entry in its natural period
                const inPeriod = !isPreInception && d >= start && d <= end;
                // Pre-registration: first VAT quarter only, within 4-year lookback
                const preRegistration = isPreInception && isFirstVatQuarter
                    && (!fourYearCutoff || d >= fourYearCutoff);
                // Stub period: between inception and first quarter start — absorb into first quarter
                const stubPeriod = isFirstVatQuarter && !isPreInception && inceptionDate
                    && d >= inceptionDate && d < start;
                // Fallback when no inception date configured
                const preInception = !inceptionDate && isOldestDisplayedQuarter && d < start;
                if (inPeriod || preRegistration || stubPeriod || preInception) return sum + (e.vatAmount || 0);
                return sum;
            }, 0);

        // Collect NonCT items that fall in this quarter but are excluded from VAT reclaim
        const vatExcludedItems = [
            ...expenses.filter(e => e.ctTag === 'NonCT' && e.vatAmount).filter(e => {
                if (!e.entryDate) return false;
                const d = new Date(e.entryDate);
                const isPreInception = inceptionDate && d < inceptionDate;
                if (!isPreInception && d >= start && d <= end) return true;
                if (isPreInception && isFirstVatQuarter && (!fourYearCutoff || d >= fourYearCutoff)) return true;
                if (isFirstVatQuarter && !isPreInception && inceptionDate && d >= inceptionDate && d < start) return true;
                if (!inceptionDate && isOldestDisplayedQuarter && d < start) return true;
                return false;
            }).map(e => ({ ...e, source: 'Expense' })),
            ...dlaEntries.filter(e => e.direction === 'OwedToDirector' && e.ctTag === 'NonCT' && e.vatAmount).filter(e => {
                if (!e.entryDate) return false;
                const d = new Date(e.entryDate);
                const isPreInception = inceptionDate && d < inceptionDate;
                const inPeriod = !isPreInception && d >= start && d <= end;
                const preRegistration = isPreInception && isFirstVatQuarter && (!fourYearCutoff || d >= fourYearCutoff);
                const stubPeriod = isFirstVatQuarter && !isPreInception && inceptionDate && d >= inceptionDate && d < start;
                const preInception = !inceptionDate && isOldestDisplayedQuarter && d < start;
                return inPeriod || preRegistration || stubPeriod || preInception;
            }).map(e => ({ ...e, source: 'DLA' }))
        ];
        const vatExcludedTotal = vatExcludedItems.reduce((s, e) => s + (e.vatAmount || 0), 0);

        const vatOut  = vatOutExpenses + vatOutDla;
        const vatOwed = vatIn - vatOut;
        return { vatIn, vatOut, vatOutExpenses, vatOutDla, vatOwed, isOldestDisplayedQuarter, vatExcludedItems, vatExcludedTotal };
    };

    const getFiledForQuarter = (q) => {
        // Return the most-recently filed record (highest filedDate) to handle
        // cases where a quarter was submitted multiple times.
        const matches = filedReturns.filter(fr => {
            const frStart = new Date(fr.quarterStartDate);
            const qStart  = new Date(q.quarterStartDate);
            return Math.abs(frStart - qStart) < 86400000; // within 1 day
        });
        if (matches.length === 0) return undefined;
        return matches.reduce((latest, fr) =>
            new Date(fr.filedDate) > new Date(latest.filedDate) ? fr : latest
        );
    };

    const isCurrentQuarter = (q) => q.isCurrent;
    const isPastQuarter     = (q) => !q.isCurrent;

    // Only show quarters from the VAT registration / inception date onwards.
    // Quarters entirely before incorporation are not real VAT filing obligations.
    // Always keep quarters that already have a filed record (historical data).
    const inceptionDateForFilter = settings?.incorporationDate
        ? new Date(settings.incorporationDate)
        : settings?.companyInceptionDate
            ? new Date(settings.companyInceptionDate)
            : null;

    const displayQuarters = inceptionDateForFilter
        ? quarters.filter(q =>
            new Date(q.quarterStartDate) >= inceptionDateForFilter
            || !!getFiledForQuarter(q)
          )
        : quarters;

    // Total unfiled VAT owed across displayed quarters only
    const unfiledOwed = displayQuarters.reduce((sum, q) => {
        if (getFiledForQuarter(q)) return sum; // already filed
        const { vatOwed } = calcForQuarter(q);
        return sum + vatOwed;
    }, 0);

    const unfiledCount = displayQuarters.filter(q => !isCurrentQuarter(q) && !getFiledForQuarter(q)).length;

    // ── Handlers ──────────────────────────────────────────────────────────────

    const openFileModal = (q) => {
        const calc = calcForQuarter(q);
        setFilingQuarter(q);
        setFilingCalc(calc);
        setFilingRef('');
        setFilingDate(new Date().toISOString().slice(0, 10));
        setFilingNotes('');
        setShowFileModal(true);
    };

    const submitFiling = async () => {
        if (!filingQuarter || !filingCalc) return;
        setFilingSubmitting(true);
        try {
            await createVatReturn({
                quarterLabel:      filingQuarter.quarterLabel,
                monthsLabel:       filingQuarter.monthsLabel,
                quarterStartDate:  filingQuarter.quarterStartDate,
                quarterEndDate:    filingQuarter.quarterEndDate,
                vatIn:             filingCalc.vatIn,
                vatOut:            filingCalc.vatOut,
                vatOwed:           filingCalc.vatOwed,
                filedDate:         filingDate ? new Date(filingDate).toISOString() : new Date().toISOString(),
                reference:         filingRef,
                notes:             filingNotes
            });
            showToast(`${filingQuarter.quarterLabel} marked as filed ✓`);
            setShowFileModal(false);
            await loadData();
        } catch (err) {
            showToast('Failed to file return: ' + err.message, 'error');
        } finally {
            setFilingSubmitting(false);
        }
    };

    const openEditModal = (fr) => {
        setEditingReturn(fr);
        setEditRef(fr.reference || '');
        setEditDate(fr.filedDate ? fr.filedDate.slice(0, 10) : '');
        setEditNotes(fr.notes || '');
        setShowEditModal(true);
    };

    const submitEdit = async () => {
        if (!editingReturn) return;
        setEditSubmitting(true);
        try {
            await updateVatReturn(editingReturn.id, {
                quarterLabel:     editingReturn.quarterLabel,
                monthsLabel:      editingReturn.monthsLabel,
                quarterStartDate: editingReturn.quarterStartDate,
                quarterEndDate:   editingReturn.quarterEndDate,
                vatIn:            editingReturn.vatIn,
                vatOut:           editingReturn.vatOut,
                vatOwed:          editingReturn.vatOwed,
                filedDate:        editDate ? new Date(editDate).toISOString() : editingReturn.filedDate,
                reference:        editRef,
                notes:            editNotes
            });
            showToast('Return updated ✓');
            setShowEditModal(false);
            await loadData();
        } catch (err) {
            showToast('Failed to update: ' + err.message, 'error');
        } finally {
            setEditSubmitting(false);
        }
    };

    const handleUnfile = async (fr) => {
        if (!window.confirm(`Unfile ${fr.quarterLabel}? This will remove the filed record.`)) return;
        try {
            await deleteVatReturn(fr.id);
            showToast(`${fr.quarterLabel} unfiled`);
            await loadData();
        } catch (err) {
            showToast('Failed to unfile: ' + err.message, 'error');
        }
    };

    // ── HMRC handlers ─────────────────────────────────────────────────────────

    const handleHmrcConnect = async () => {
        try {
            setHmrcLoading(true);
            const { url } = await getHmrcAuthUrl(window.location.origin);
            window.location.href = url;
        } catch (err) {
            showToast('Failed to start HMRC authorisation: ' + err.message, 'error');
            setHmrcLoading(false);
        }
    };

    const handleHmrcDisconnect = async () => {
        if (!window.confirm('Disconnect from HMRC MTD? Your stored tokens will be removed.')) return;
        try {
            setHmrcLoading(true);
            await disconnectHmrc();
            setHmrcConnected(false);
            setHmrcObligations([]);
            showToast('Disconnected from HMRC');
        } catch (err) {
            showToast('Failed to disconnect: ' + err.message, 'error');
        } finally {
            setHmrcLoading(false);
        }
    };

    const handleFetchObligations = async () => {
        try {
            setHmrcLoading(true);
            const data = await getHmrcVatObligations();
            const obs = data?.obligations || (Array.isArray(data) ? data : []);
            setHmrcObligations(obs);
            showToast(obs.length === 0
                ? 'No open VAT obligations found in HMRC'
                : `${obs.length} obligation${obs.length > 1 ? 's' : ''} fetched from HMRC`);
        } catch (err) {
            showToast('Failed to fetch obligations: ' + err.message, 'error');
        } finally {
            setHmrcLoading(false);
        }
    };

    const openHmrcModal = (q) => {
        const calc = calcForQuarter(q);
        setHmrcQuarter(q);
        setHmrcCalc(calc);
        const qStart = new Date(q.quarterStartDate);
        const matching = hmrcObligations.find(ob => {
            const obStart = ob.start ? new Date(ob.start) : null;
            return obStart && Math.abs(obStart - qStart) < 86400000 * 10;
        });
        setHmrcPeriodKey(matching?.periodKey || '');
        setHmrcFinalise(true);
        setHmrcModalMsg(null);
        setShowHmrcModal(true);
    };

    const submitToHmrc = async () => {
        if (!hmrcQuarter || !hmrcCalc || !hmrcPeriodKey.trim()) {
            showToast('Please enter the HMRC period key', 'error');
            return;
        }
        setHmrcSubmitting(true);
        try {
            const vatDueSales            = Math.round(hmrcCalc.vatIn * 100) / 100;
            const vatDueAcquisitions     = 0;
            const totalVatDue            = Math.round((vatDueSales + vatDueAcquisitions) * 100) / 100;
            const vatReclaimedCurrPeriod = Math.round(hmrcCalc.vatOut * 100) / 100;
            const netVatDue              = Math.round(Math.abs(totalVatDue - vatReclaimedCurrPeriod) * 100) / 100;

            const qStart = new Date(hmrcQuarter.quarterStartDate);
            const qEnd   = new Date(hmrcQuarter.quarterEndDate);

            // Match calcForQuarter: oldest displayed quarter absorbs pre-inception/stub-period data
            const hmrcInceptionDate = settings?.incorporationDate
                ? new Date(settings.incorporationDate)
                : settings?.companyInceptionDate
                    ? new Date(settings.companyInceptionDate)
                    : null;
            const hmrcPrevQStart = new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1);
            const hmrcPrevWouldShow = hmrcInceptionDate ? hmrcPrevQStart >= hmrcInceptionDate : true;
            const isOldestDisplayed = !hmrcPrevWouldShow;
            const hmrcUsePayment = settings?.vatAccountingMethod !== 'invoice';

            const totalValueSalesExVAT = Math.round(
                invoices.filter(inv => {
                    if (hmrcUsePayment) {
                        if (!inv.datePaid || inv.status !== 'Paid') return false;
                        const d = new Date(inv.datePaid);
                        return d >= qStart && d <= qEnd;
                    }
                    if (!inv.dateIssued) return false;
                    const d = new Date(inv.dateIssued);
                    if (d >= qStart && d <= qEnd) return true;
                    if (isOldestDisplayed) {
                        if (hmrcInceptionDate && d < hmrcInceptionDate) return true;
                        if (hmrcInceptionDate && d >= hmrcInceptionDate && d < qStart) return true;
                        if (!hmrcInceptionDate && d < qStart) return true;
                    }
                    return false;
                }).reduce((s, inv) => s + (inv.amount || 0), 0)
            );
            const totalValuePurchasesExVAT = Math.round(
                expenses.filter(e => {
                    if (!e.entryDate) return false;
                    const d = new Date(e.entryDate);
                    return (d >= qStart && d <= qEnd) || (isOldest && d < qStart);
                }).reduce((s, e) => s + (e.amount || 0), 0)
            );

            const submission = {
                periodKey:                    hmrcPeriodKey.trim(),
                vatDueSales,
                vatDueAcquisitions,
                totalVatDue,
                vatReclaimedCurrPeriod,
                netVatDue,
                totalValueSalesExVAT,
                totalValuePurchasesExVAT,
                totalValueGoodsSuppliedExVAT: 0,
                totalAcquisitionsExVAT:       0,
                finalised:                    hmrcFinalise
            };

            const result = await submitVatReturnToHmrc(submission);

            // Remove any existing filed record for this quarter before saving the new
            // snapshot — prevents duplicate records if the user resubmits.
            const existingFiled = getFiledForQuarter(hmrcQuarter);
            if (existingFiled?.id) {
                try { await deleteVatReturn(existingFiled.id); } catch (_) { /* best-effort */ }
            }

            // Snapshot as filed locally too.
            // reference = HMRC period key (4-char, e.g. "24A1") — used by the Verify button.
            // notes = bundle number for audit trail.
            await createVatReturn({
                quarterLabel:     hmrcQuarter.quarterLabel,
                monthsLabel:      hmrcQuarter.monthsLabel,
                quarterStartDate: hmrcQuarter.quarterStartDate,
                quarterEndDate:   hmrcQuarter.quarterEndDate,
                vatIn:            hmrcCalc.vatIn,
                vatOut:           hmrcCalc.vatOut,
                vatOwed:          hmrcCalc.vatOwed,
                filedDate:        new Date().toISOString(),
                reference:        hmrcPeriodKey.trim(),
                notes:            `HMRC MTD submission · Bundle: ${result?.formBundleNumber || 'n/a'}${hmrcFinalise ? '' : ' · Not finalised'}`
            });

            showToast(
                `VAT return submitted to HMRC ✓${result?.formBundleNumber ? '  Ref: ' + result.formBundleNumber : ''}`
            );
            setShowHmrcModal(false);
            await loadData();
        } catch (err) {
            showToast('HMRC submission failed: ' + err.message, 'error');
        } finally {
            setHmrcSubmitting(false);
        }
    };

    // ── Formatting ────────────────────────────────────────────────────────────

    const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n || 0);
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

    // UK VAT payment due: 1 calendar month + 7 days after quarter end
    const vatPaymentDue = (qEndDate) => {
        const d = new Date(qEndDate);
        d.setMonth(d.getMonth() + 1);
        d.setDate(d.getDate() + 7);
        return d;
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) return (
        <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading VAT returns...</div>
        </div>
    );

    const vatStartMonth = settings?.vatQuarterStartMonth;

    return (
        <div className="page-container">
            {/* Toast */}
            {toast && (
                <div className={`toast toast-${toast.type}`} style={{
                    position: 'fixed', top: 20, right: 20, zIndex: 9999,
                    padding: '12px 20px', borderRadius: 8,
                    background: toast.type === 'error' ? '#dc3545' : '#28a745',
                    color: '#fff', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}>
                    {toast.msg}
                </div>
            )}

            <div className="page-header">
                <div>
                    <h1>📋 VAT Returns</h1>
                    {vatStartMonth && (
                        <p style={{ color: '#6c757d', margin: '4px 0 0', fontSize: '0.9rem' }}>
                            {vatStartMonth == 1 && 'Stagger: January — Q1 Jan/Feb/Mar · Q2 Apr · Q3 Jul · Q4 Oct'}
                            {vatStartMonth == 2 && 'Stagger: February — Q1 Feb/Mar/Apr · Q2 May · Q3 Aug · Q4 Nov'}
                            {vatStartMonth == 3 && 'Stagger: March — Q1 Mar/Apr/May · Q2 Jun · Q3 Sep · Q4 Dec'}
                        </p>
                    )}
                </div>
                {!vatStartMonth && (
                    <div className="alert-info" style={{
                        background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6,
                        padding: '8px 14px', fontSize: '0.9rem', color: '#856404'
                    }}>
                        ⚠️ Set your VAT quarter start month in <strong>Settings → VAT &amp; Tax</strong>
                    </div>
                )}
                <button
                    className="btn-secondary"
                    onClick={() => setShowAllYears(v => !v)}
                    style={{ whiteSpace: 'nowrap' }}
                >
                    {showAllYears ? '📅 Show Recent (2 years)' : '📂 Show All History'}
                </button>
            </div>

            {/* ── VAT Deadline Reminder Banner ── */}
            {displayQuarters.length > 0 && (() => {
                const now = new Date();
                const currentQ = displayQuarters.find(q => q.isCurrent);
                const overdueQ = displayQuarters.find(q => !isCurrentQuarter(q) && !getFiledForQuarter(q));
                return (
                    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {overdueQ && (() => {
                            const due = vatPaymentDue(overdueQ.quarterEndDate);
                            const isOverdue = now > due;
                            const calc = calcForQuarter(overdueQ);
                            return (
                                <div style={{
                                    background: isOverdue ? '#f8d7da' : '#fff3cd',
                                    border: `1px solid ${isOverdue ? '#f5c6cb' : '#ffc107'}`,
                                    borderRadius: 8, padding: '10px 16px',
                                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'
                                }}>
                                    <span style={{ fontSize: 18 }}>{isOverdue ? '🔴' : '⚠️'}</span>
                                    <div style={{ flex: 1 }}>
                                        <strong>{overdueQ.quarterLabel}</strong> ({overdueQ.monthsLabel}) — not yet filed
                                        <span style={{ marginLeft: 12, color: isOverdue ? '#721c24' : '#856404', fontWeight: 600 }}>
                                            · Payment {isOverdue ? 'was due' : 'due'} {fmtDate(due)}
                                        </span>
                                        {calc.vatOwed > 0 && (
                                            <span style={{ marginLeft: 12, color: '#6c757d' }}>
                                                · {fmt(calc.vatOwed)} estimated owed
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        className="btn-primary"
                                        style={{ padding: '4px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                                        onClick={() => openFileModal(overdueQ)}
                                    >
                                        File Now →
                                    </button>
                                </div>
                            );
                        })()}
                        {currentQ && (() => {
                            const qEnd = new Date(currentQ.quarterEndDate);
                            const due  = vatPaymentDue(currentQ.quarterEndDate);
                            const daysToEnd = Math.ceil((qEnd - now) / 86400000);
                            return (
                                <div style={{
                                    background: '#e7f3ff', border: '1px solid #b8d4f0',
                                    borderRadius: 8, padding: '10px 16px',
                                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'
                                }}>
                                    <span style={{ fontSize: 18 }}>📅</span>
                                    <div>
                                        <strong>Current: {currentQ.quarterLabel}</strong> ({currentQ.monthsLabel})
                                        <span style={{ marginLeft: 10, color: '#6c757d' }}>
                                            · ends {fmtDate(currentQ.quarterEndDate)}
                                            {daysToEnd >= 0 && <span> ({daysToEnd} day{daysToEnd !== 1 ? 's' : ''} left)</span>}
                                        </span>
                                        <span style={{ marginLeft: 10, color: '#0d6efd', fontWeight: 500 }}>
                                            · payment due {fmtDate(due)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                );
            })()}

            {/* Summary cards */}
            <div className="metrics-grid" style={{ marginBottom: 24 }}>
                <div className="metric-card vat">
                    <div className="metric-icon">🧾</div>
                    <div className="metric-content">
                        <div className="metric-label">Unfiled VAT Balance</div>
                        <div className={`metric-value ${unfiledOwed >= 0 ? 'positive' : 'negative'}`}>
                            {fmt(unfiledOwed)}
                        </div>
                        <div className="metric-detail">
                            {unfiledOwed >= 0 ? 'Owed to HMRC' : 'HMRC owes you'}
                        </div>
                    </div>
                </div>
                <div className="metric-card" style={{ borderLeft: '4px solid #6c757d' }}>
                    <div className="metric-icon">📅</div>
                    <div className="metric-content">
                        <div className="metric-label">Quarters Unfiled</div>
                        <div className="metric-value" style={{ color: unfiledCount > 0 ? '#dc3545' : '#28a745' }}>
                            {unfiledCount}
                        </div>
                        <div className="metric-detail">
                            {unfiledCount === 0 ? 'All past quarters filed ✓' : `${unfiledCount} past quarter${unfiledCount > 1 ? 's' : ''} need filing`}
                        </div>
                    </div>
                </div>
                <div className="metric-card income">
                    <div className="metric-icon">✅</div>
                    <div className="metric-content">
                        <div className="metric-label">Returns Filed</div>
                        <div className="metric-value">{filedReturns.length}</div>
                        <div className="metric-detail">Historical VAT filings recorded</div>
                    </div>
                </div>
            </div>

            {/* ── HMRC MTD Connection Panel ── */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header" style={{
                    padding: '14px 20px', borderBottom: '1px solid #dee2e6',
                    fontWeight: 600, fontSize: '1rem',
                    background: hmrcConnected ? '#f0fff4' : '#f8f9fa',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span>🏛️ HMRC Making Tax Digital</span>
                        <span style={{
                            background: hmrcConnected ? '#d4edda' : '#f8d7da',
                            color: hmrcConnected ? '#155724' : '#721c24',
                            padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600
                        }}>
                            {hmrcConnected ? '● Connected' : '○ Not connected'}
                        </span>
                    </div>
                    {hmrcConnected && (
                        <button
                            onClick={handleHmrcDisconnect}
                            disabled={hmrcLoading}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#999', fontSize: '0.8rem', padding: '2px 6px'
                            }}
                        >Disconnect</button>
                    )}
                </div>
                <div style={{ padding: '16px 20px' }}>
                    {!hmrcConnected ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                            <div style={{ color: '#6c757d', fontSize: '0.9rem', flex: 1 }}>
                                Connect your HMRC account to submit VAT returns directly via Making Tax Digital.
                                {settings?.hmrcGatewayUserId && (
                                    <span style={{ display: 'block', marginTop: 4, color: '#495057', fontSize: '0.85rem' }}>
                                        🔑 Gateway User ID from Settings: <strong style={{ fontFamily: 'monospace' }}>{settings.hmrcGatewayUserId}</strong> — use this to log in below.
                                    </span>
                                )}
                                {!settings?.hmrcGatewayUserId && (
                                    <span style={{ display: 'block', marginTop: 4, color: '#856404', fontSize: '0.85rem' }}>
                                        💡 You can store your Government Gateway User ID in <strong>Settings → HMRC</strong> for easy reference.
                                    </span>
                                )}
                            </div>
                            <button
                                className="btn-primary"
                                onClick={handleHmrcConnect}
                                disabled={hmrcLoading}
                                style={{ whiteSpace: 'nowrap', padding: '8px 20px' }}
                            >
                                {hmrcLoading ? 'Redirecting…' : '🔗 Connect to HMRC'}
                            </button>
                        </div>
                    ) : (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: hmrcObligations.length > 0 ? 14 : 0 }}>
                                <div style={{ color: '#155724', fontSize: '0.88rem', flex: 1 }}>
                                    Authorised — click <strong>Fetch Obligations</strong> to load open VAT periods from HMRC, then use the <strong>Submit to HMRC</strong> button on each quarter.
                                    {settings?.hmrcGatewayUserId && (
                                        <span style={{ display: 'block', marginTop: 3, color: '#495057', fontSize: '0.82rem' }}>
                                            🔑 Connected as Gateway User ID: <strong style={{ fontFamily: 'monospace' }}>{settings.hmrcGatewayUserId}</strong>
                                        </span>
                                    )}
                                </div>
                                <button
                                    className="btn-secondary"
                                    onClick={handleFetchObligations}
                                    disabled={hmrcLoading}
                                    style={{ fontSize: '0.85rem', padding: '6px 14px', whiteSpace: 'nowrap' }}
                                >
                                    {hmrcLoading ? '⏳ Loading…' : '📋 Fetch Obligations'}
                                </button>
                            </div>
                            {hmrcObligations.length > 0 && (
                                <div style={{
                                    background: '#f0fff4', border: '1px solid #c3e6cb',
                                    borderRadius: 8, padding: '12px 14px', fontSize: '0.85rem'
                                }}>
                                    <div style={{ fontWeight: 600, color: '#155724', marginBottom: 8 }}>
                                        📋 {hmrcObligations.length} open obligation{hmrcObligations.length > 1 ? 's' : ''} — submit oldest first
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {hmrcObligations.map((ob, i) => (
                                            <span key={i} style={{
                                                background: '#fff', border: '1px solid #28a745',
                                                borderRadius: 6, padding: '4px 12px',
                                                fontFamily: 'monospace', fontWeight: 700, color: '#155724'
                                            }}>
                                                {ob.periodKey}
                                                {ob.start && ob.end && (
                                                    <span style={{ color: '#6c757d', marginLeft: 6, fontFamily: 'inherit' }}>
                                                        ({new Date(ob.start).toLocaleDateString('en-GB')} – {new Date(ob.end).toLocaleDateString('en-GB')})
                                                    </span>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Quarters table */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header" style={{
                    padding: '14px 20px', borderBottom: '1px solid #dee2e6',
                    fontWeight: 600, fontSize: '1rem', background: '#f8f9fa'
                }}>
                    VAT Quarters
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: '100%' }}>
                        <thead>
                            <tr>
                                <th style={{ whiteSpace: 'nowrap', minWidth: 110 }}>Quarter</th>
                                <th style={{ whiteSpace: 'nowrap', minWidth: 110 }}>Period</th>
                                <th style={{ textAlign: 'right', whiteSpace: 'nowrap', minWidth: 100 }}>VAT In (Sales)</th>
                                <th style={{ textAlign: 'right', whiteSpace: 'nowrap', minWidth: 120 }}>VAT Out (Purchases + DLA)</th>
                                <th style={{ textAlign: 'right', whiteSpace: 'nowrap', minWidth: 100 }}>Net Owed</th>
                                <th style={{ whiteSpace: 'nowrap', minWidth: 100 }}>Status</th>
                                <th style={{ whiteSpace: 'nowrap', minWidth: 90 }}>Filed</th>
                                <th style={{ whiteSpace: 'nowrap', minWidth: 80 }}>Reference</th>
                                <th style={{ textAlign: 'center', minWidth: 160 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(showAllYears ? displayQuarters : displayQuarters.slice(0, 8)).map((q) => {
                                const calc   = calcForQuarter(q);
                                const filed  = getFiledForQuarter(q);
                                const isCurr = isCurrentQuarter(q);

                                return (
                                    <tr key={q.quarterLabel} style={{
                                        background: isCurr ? '#fffbec' : filed ? '#f0fff4' : undefined
                                    }}>
                                        <td>
                                            <strong>{q.quarterLabel}</strong>
                                            {isCurr && (
                                                <span style={{
                                                    marginLeft: 6, fontSize: '0.7rem', background: '#ffc107',
                                                    color: '#000', padding: '1px 6px', borderRadius: 10
                                                }}>Current</span>
                                            )}
                                            {calc.isOldestDisplayedQuarter && !filed && (
                                                <span
                                                    title="This quarter includes all invoices, expenses and DLA entries dated before it (pre-formation costs)"
                                                    style={{
                                                        display: 'block', marginTop: 3,
                                                        fontSize: '0.7rem', background: '#e2d9f3',
                                                        color: '#4a1d96', padding: '1px 6px', borderRadius: 10,
                                                        cursor: 'help'
                                                    }}
                                                >⚑ Includes pre-period entries</span>
                                            )}
                                        </td>
                                        <td style={{ color: '#6c757d', fontSize: '0.9rem' }}>{q.monthsLabel}</td>
                                        <td style={{ textAlign: 'right', color: '#28a745' }}>
                                            {fmt(filed ? filed.vatIn : calc.vatIn)}
                                        </td>
                                        <td style={{ textAlign: 'right', color: '#dc3545' }}>
                                            {fmt(filed ? filed.vatOut : calc.vatOut)}
                                        </td>
                                        <td style={{
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: (filed ? filed.vatOwed : calc.vatOwed) >= 0 ? '#dc3545' : '#28a745'
                                        }}>
                                            {fmt(filed ? filed.vatOwed : calc.vatOwed)}
                                        </td>
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                            {filed ? (
                                                <span style={{
                                                    background: '#d4edda', color: '#155724',
                                                    padding: '3px 10px', borderRadius: 12,
                                                    fontSize: '0.82rem', fontWeight: 600,
                                                    whiteSpace: 'nowrap', display: 'inline-block'
                                                }}>✓ Filed</span>
                                            ) : isCurr ? (
                                                <span style={{
                                                    background: '#fff3cd', color: '#856404',
                                                    padding: '3px 10px', borderRadius: 12,
                                                    fontSize: '0.82rem', whiteSpace: 'nowrap',
                                                    display: 'inline-block'
                                                }}>In Progress</span>
                                            ) : (
                                                <span style={{
                                                    background: '#f8d7da', color: '#721c24',
                                                    padding: '3px 10px', borderRadius: 12,
                                                    fontSize: '0.82rem', fontWeight: 600,
                                                    whiteSpace: 'nowrap', display: 'inline-block'
                                                }}>⚠ Unfiled</span>
                                            )}
                                        </td>
                                        <td style={{ fontSize: '0.88rem', color: '#6c757d' }}>
                                            {filed ? fmtDate(filed.filedDate) : '—'}
                                        </td>
                                        <td style={{ fontSize: '0.88rem', color: '#6c757d' }}>
                                            {filed?.reference || '—'}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {filed ? (() => {
                                                const refLooksLikePeriodKey = filed.reference
                                                    && filed.reference.length <= 6
                                                    && /^[A-Z0-9#]+$/i.test(filed.reference);
                                                const periodKeyFromNotes = filed.notes?.match(/Period key:\s*([A-Z0-9#]+)/i)?.[1];
                                                const verifyPeriodKey = hmrcConnected
                                                    ? (refLooksLikePeriodKey ? filed.reference : (periodKeyFromNotes || null))
                                                    : null;
                                                const verifyKey = verifyPeriodKey ? `${q.quarterLabel}-${verifyPeriodKey}` : null;
                                                return (
                                                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
                                                        <button
                                                            onClick={() => openEditModal(filed)}
                                                            className="btn-icon"
                                                            title="Edit filing details"
                                                        >✏️</button>
                                                        <button
                                                            onClick={() => handleUnfile(filed)}
                                                            className="btn-icon btn-danger"
                                                            title="Unfile this quarter"
                                                        >↩️</button>
                                                        {verifyPeriodKey && (
                                                            <button
                                                                onClick={() => {
                                                                    // Clear any cached HMRC result so fresh data is fetched
                                                                    setHmrcVerify(v => { const next = { ...v }; delete next[verifyKey]; return next; });
                                                                    setVerifyModal({ quarterLabel: q.quarterLabel, quarter: q, periodKey: verifyPeriodKey, verifyKey, filed });
                                                                }}
                                                                style={{
                                                                    fontSize: '0.78rem', padding: '3px 8px',
                                                                    background: '#e8f4fd', border: '1px solid #007bff',
                                                                    borderRadius: 4, cursor: 'pointer', color: '#0056b3',
                                                                    fontWeight: 600
                                                                }}
                                                                title={`Verify period ${verifyPeriodKey} on HMRC`}
                                                            >
                                                                🔍 Verify
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })() : isCurr ? (
                                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={() => openFileModal(q)}
                                                        className="btn-secondary"
                                                        style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                                                        title="Record as filed manually (local only — does NOT send to HMRC)"
                                                    >
                                                        📝 Record Manually
                                                    </button>
                                                    {hmrcConnected && (
                                                        <button
                                                            onClick={() => openHmrcModal(q)}
                                                            className="btn-primary"
                                                            style={{ fontSize: '0.82rem', padding: '4px 10px', background: '#006400', borderColor: '#006400' }}
                                                            title="Electronically submit this return to HMRC via Making Tax Digital"
                                                        >
                                                            🏛️ Submit to HMRC
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={() => openFileModal(q)}
                                                        className="btn-primary"
                                                        style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                                                        title="Record as filed manually (local only — does NOT send to HMRC)"
                                                    >
                                                        📝 Record Manually
                                                    </button>
                                                    {hmrcConnected && (
                                                        <button
                                                            onClick={() => openHmrcModal(q)}
                                                            className="btn-primary"
                                                            style={{ fontSize: '0.82rem', padding: '4px 10px', background: '#006400', borderColor: '#006400' }}
                                                            title="Submit directly to HMRC MTD"
                                                        >
                                                            🏛️ Submit to HMRC
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* How it works info */}
            <div style={{
                background: '#e8f4fd', border: '1px solid #bee5eb', borderRadius: 8,
                padding: '14px 18px', fontSize: '0.88rem', color: '#0c5460'
            }}>
                <strong>ℹ️ How this works:</strong> VAT figures are calculated live from your invoices, expenses, and DLA entries.
                VAT on invoices = <strong>VAT In</strong> (owed to HMRC). VAT on expenses and DLA entries where the director paid personally for company costs (Owed to Director) = <strong>VAT Out</strong> (reclaimable input VAT). The net balance is what you pay HMRC.
                When you file a VAT return with HMRC, click <strong>Mark Filed</strong> to record the filing —
                this snapshots the amounts at that moment.
            </div>

            {/* ── HMRC Verify Modal ── */}
            {verifyModal && (
                <div className="modal-overlay" onClick={() => setVerifyModal(null)}>
                    <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>🔍 Verify with HMRC — {verifyModal.quarterLabel}</h2>
                            <button className="modal-close" onClick={() => setVerifyModal(null)}>×</button>
                        </div>
                        <div style={{ padding: '20px 24px' }}>
                            <div style={{
                                background: '#f8f9fa', border: '1px solid #dee2e6',
                                borderRadius: 6, padding: '10px 14px', marginBottom: 16,
                                fontSize: '0.9rem', color: '#495057'
                            }}>
                                <div><strong>Period key:</strong> <code style={{ background: '#e9ecef', padding: '1px 6px', borderRadius: 3 }}>{verifyModal.periodKey}</code></div>
                                {verifyModal.filed?.notes?.match(/Bundle:\s*([0-9]+)/)?.[1] && (
                                    <div style={{ marginTop: 4 }}><strong>Bundle number:</strong> {verifyModal.filed.notes.match(/Bundle:\s*([0-9]+)/)[1]}</div>
                                )}
                            </div>

                            {/* Loading state */}
                            {!hmrcVerify[verifyModal.verifyKey] && (
                                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                    <button
                                        className="btn-primary"
                                        style={{ background: '#0d6efd', borderColor: '#0d6efd', padding: '8px 24px' }}
                                        onClick={async () => {
                                            setHmrcVerify(v => ({ ...v, [verifyModal.verifyKey]: { loading: true } }));
                                            try {
                                                const data = await viewHmrcVatReturn(verifyModal.periodKey);
                                                setHmrcVerify(v => ({ ...v, [verifyModal.verifyKey]: { loading: false, result: data } }));
                                            } catch (err) {
                                                setHmrcVerify(v => ({ ...v, [verifyModal.verifyKey]: { loading: false, error: err.message } }));
                                            }
                                        }}
                                    >
                                        📡 Fetch from HMRC
                                    </button>
                                </div>
                            )}
                            {hmrcVerify[verifyModal.verifyKey]?.loading && (
                                <div style={{ textAlign: 'center', padding: '20px 0', color: '#6c757d' }}>
                                    <div className="spinner" style={{ margin: '0 auto 8px' }}></div>
                                    Fetching from HMRC...
                                </div>
                            )}

                            {/* Error */}
                            {hmrcVerify[verifyModal.verifyKey]?.error && (
                                <div style={{
                                    background: '#f8d7da', border: '1px solid #f5c6cb',
                                    borderRadius: 6, padding: '12px 16px', color: '#721c24'
                                }}>
                                    ❌ {hmrcVerify[verifyModal.verifyKey].error}
                                </div>
                            )}

                            {/* Result */}
                            {hmrcVerify[verifyModal.verifyKey]?.result && (() => {
                                const r = hmrcVerify[verifyModal.verifyKey].result;
                                if (r?.code || r?.errors) {
                                    return (
                                        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: '12px 16px', color: '#856404' }}>
                                            ⚠️ HMRC returned: {r.message || r.code || 'unexpected response'}
                                        </div>
                                    );
                                }
                                const netVat    = r?.netVatDue ?? r?.NetVatDue;
                                const vatSales  = r?.vatDueSales ?? r?.VatDueSales;
                                const vatAcq    = r?.vatDueAcquisitions ?? r?.VatDueAcquisitions;
                                const totalVat  = r?.totalVatDue ?? r?.TotalVatDue;
                                const recl      = r?.vatReclaimedCurrPeriod ?? r?.VatReclaimedCurrPeriod;
                                const salesExVat = r?.totalValueSalesExVAT ?? r?.TotalValueSalesExVAT;
                                const purchExVat = r?.totalValuePurchasesExVAT ?? r?.TotalValuePurchasesExVAT;
                                const pk        = r?.periodKey || r?.PeriodKey || verifyModal.periodKey;
                                if (netVat === undefined && vatSales === undefined) {
                                    return (
                                        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: '12px 16px', color: '#856404' }}>
                                            ⚠️ Unexpected response shape. Fields received: {Object.keys(r || {}).join(', ') || 'none'}
                                        </div>
                                    );
                                }
                                // Format a raw HMRC number (e.g. 17.8) as currency string (e.g. £17.80)
                                const fmtBox = (v) => v === undefined || v === null ? '—'
                                    : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(v));

                                // Compare filed Box 4 against current calculated vatOut to detect stale submissions
                                const currentCalc = calcForQuarter(verifyModal.quarter);
                                const filedVatOut = verifyModal.filed?.vatOut;
                                const calcVatOut  = currentCalc?.vatOut;
                                const figuresMismatch = filedVatOut !== undefined && calcVatOut !== undefined
                                    && Math.abs(filedVatOut - calcVatOut) > 0.01;

                                const Row = ({ label, value, highlight, mismatch }) => (
                                    <div style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '8px 0', borderBottom: '1px solid #e9ecef',
                                        fontWeight: highlight ? 700 : 400
                                    }}>
                                        <span style={{ color: '#495057' }}>{label}</span>
                                        <span style={{
                                            fontFamily: 'monospace',
                                            color: mismatch ? '#856404' : highlight ? '#155724' : '#212529'
                                        }}>
                                            {value}
                                            {mismatch && <span style={{ fontSize: '0.75rem', marginLeft: 6, color: '#856404' }}>⚠️</span>}
                                        </span>
                                    </div>
                                );
                                return (
                                    <div>
                                        <div style={{ background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 6, padding: '10px 14px', marginBottom: figuresMismatch ? 0 : 16, color: '#155724', fontWeight: 600 }}>
                                            ✅ HMRC confirmed this return for period <code style={{ background: '#c3e6cb', padding: '1px 6px', borderRadius: 3 }}>{pk}</code>
                                        </div>
                                        {figuresMismatch && (
                                            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderTopLeftRadius: 0, borderTopRightRadius: 0, borderRadius: '0 0 6px 6px', padding: '8px 14px', marginBottom: 16, fontSize: '0.83rem', color: '#856404' }}>
                                                ⚠️ <strong>These figures were submitted before your DLA pre-registration entries were included.</strong> The current VAT Out is {fmtBox(calcVatOut)} but only {fmtBox(filedVatOut)} was filed. You should <strong>↩️ Unfile</strong> this return and resubmit to HMRC with the correct figures.
                                            </div>
                                        )}
                                        <div style={{ border: '1px solid #dee2e6', borderRadius: 6, overflow: 'hidden' }}>
                                            <div style={{ background: '#f8f9fa', padding: '8px 14px', fontWeight: 600, fontSize: '0.85rem', color: '#495057', borderBottom: '1px solid #dee2e6' }}>VAT Return Boxes — as filed with HMRC</div>
                                            <div style={{ padding: '0 14px' }}>
                                                {vatSales   !== undefined && <Row label="Box 1 · VAT on sales"              value={fmtBox(vatSales)} />}
                                                {vatAcq     !== undefined && <Row label="Box 2 · VAT on acquisitions"       value={fmtBox(vatAcq)} />}
                                                {totalVat   !== undefined && <Row label="Box 3 · Total VAT due"             value={fmtBox(totalVat)} />}
                                                {recl       !== undefined && <Row label="Box 4 · VAT reclaimed (input)"     value={fmtBox(recl)} mismatch={figuresMismatch} />}
                                                {netVat     !== undefined && <Row label="Box 5 · Net VAT payable"           value={fmtBox(netVat)} highlight />}
                                                {salesExVat !== undefined && <Row label="Box 6 · Total sales ex. VAT"       value={fmtBox(salesExVat)} />}
                                                {purchExVat !== undefined && <Row label="Box 7 · Total purchases ex. VAT"   value={fmtBox(purchExVat)} />}
                                            </div>
                                        </div>
                                        {figuresMismatch && (
                                            <div style={{ marginTop: 10, padding: '8px 12px', background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 6, fontSize: '0.83rem', color: '#495057' }}>
                                                <strong>Current calculated figures:</strong> VAT In {fmtBox(currentCalc.vatIn)} · VAT Out {fmtBox(calcVatOut)} · Net {fmtBox(currentCalc.vatOwed)}
                                            </div>
                                        )}
                                        <div style={{ marginTop: 12, textAlign: 'right' }}>
                                            <button
                                                onClick={async () => {
                                                    setHmrcVerify(v => ({ ...v, [verifyModal.verifyKey]: { loading: true } }));
                                                    try {
                                                        const data = await viewHmrcVatReturn(verifyModal.periodKey);
                                                        setHmrcVerify(v => ({ ...v, [verifyModal.verifyKey]: { loading: false, result: data } }));
                                                    } catch (err) {
                                                        setHmrcVerify(v => ({ ...v, [verifyModal.verifyKey]: { loading: false, error: err.message } }));
                                                    }
                                                }}
                                                style={{ fontSize: '0.82rem', padding: '4px 12px', background: '#f8f9fa', border: '1px solid #ced4da', borderRadius: 4, cursor: 'pointer', color: '#495057' }}
                                            >
                                                🔄 Refresh
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div style={{ padding: '12px 24px', borderTop: '1px solid #dee2e6', textAlign: 'right' }}>
                            <button className="btn-secondary" onClick={() => setVerifyModal(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── File Modal ── */}
            {showFileModal && filingQuarter && filingCalc && (
                <div className="modal-overlay" onClick={() => setShowFileModal(false)}>
                    <div className="modal-content" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>📋 File VAT Return — {filingQuarter.quarterLabel}</h2>
                            <button className="modal-close" onClick={() => setShowFileModal(false)}>✕</button>
                        </div>
                        <div className="modal-body" style={{ padding: '20px 24px' }}>
                            <p style={{ color: '#6c757d', marginTop: 0, marginBottom: 16, fontSize: '0.88rem' }}>
                                {filingQuarter.monthsLabel}
                            </p>

                            {/* VAT boxes */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                                <div style={{
                                    background: '#f6fff8', border: '1px solid #c3e6cb',
                                    borderRadius: 8, padding: '12px 10px', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>VAT In · Sales</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#155724' }}>
                                        {fmt(filingCalc.vatIn)}
                                    </div>
                                </div>
                                <div style={{
                                    background: '#fff8f8', border: '1px solid #f5c6cb',
                                    borderRadius: 8, padding: '12px 10px', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>VAT Out · Purchases</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#721c24' }}>
                                        {fmt(filingCalc.vatOut)}
                                    </div>
                                    {filingCalc.vatOutDla > 0 && (
                                        <div style={{ fontSize: '0.72rem', color: '#6c757d', marginTop: 2 }}>
                                            incl. DLA {fmt(filingCalc.vatOutDla)}
                                        </div>
                                    )}
                                    {filingCalc.vatExcludedTotal > 0 && (
                                        <div style={{ fontSize: '0.72rem', color: '#e65100', marginTop: 2 }}>
                                            {fmt(filingCalc.vatExcludedTotal)} excluded (NonCT)
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    background: filingCalc.vatOwed >= 0 ? '#fff5f5' : '#f6fff8',
                                    border: `1px solid ${filingCalc.vatOwed >= 0 ? '#f5c6cb' : '#c3e6cb'}`,
                                    borderRadius: 8, padding: '12px 10px', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Net Owed</div>
                                    <div style={{
                                        fontSize: '1.25rem', fontWeight: 700,
                                        color: filingCalc.vatOwed >= 0 ? '#dc3545' : '#28a745'
                                    }}>
                                        {fmt(Math.abs(filingCalc.vatOwed))}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginTop: 2 }}>
                                        {filingCalc.vatOwed >= 0 ? 'payable to HMRC' : 'HMRC owes you'}
                                    </div>
                                </div>
                            </div>

                            {/* VAT-Excluded items (NonCT) */}
                            {filingCalc.vatExcludedItems && filingCalc.vatExcludedItems.length > 0 && (
                                <div style={{ marginBottom: 16, padding: '10px 12px', background: '#fff8e1', border: '1px solid #ffe0b2', borderRadius: 8 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 8, color: '#e65100' }}>
                                        ⚠️ VAT excluded from reclaim ({filingCalc.vatExcludedItems.length} item{filingCalc.vatExcludedItems.length !== 1 ? 's' : ''} · {fmt(filingCalc.vatExcludedTotal)} VAT)
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: '#5d4037', marginBottom: 6 }}>
                                        These items have NonCT status — their VAT cannot be reclaimed but the gross amount counts in the DLA/expense total.
                                    </div>
                                    <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid #ffe0b2' }}>
                                                <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Source</th>
                                                <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Description</th>
                                                <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Category</th>
                                                <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>Gross</th>
                                                <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>VAT (excluded)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filingCalc.vatExcludedItems.map((item, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid #fff3e0' }}>
                                                    <td style={{ padding: '4px 6px' }}>{item.source}</td>
                                                    <td style={{ padding: '4px 6px' }}>{item.description || item.supplierName || '—'}</td>
                                                    <td style={{ padding: '4px 6px' }}>{item.category || '—'}</td>
                                                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(item.amountGross || 0)}</td>
                                                    <td style={{ padding: '4px 6px', textAlign: 'right', color: '#e65100', fontWeight: 600 }}>{fmt(item.vatAmount || 0)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label" style={{ fontWeight: 600 }}>Filing Date</label>
                                    <input
                                        type="date"
                                        className="form-control"
                                        value={filingDate}
                                        onChange={e => setFilingDate(e.target.value)}
                                    />
                                </div>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label" style={{ fontWeight: 600 }}>HMRC Reference <span style={{ fontWeight: 400, color: '#6c757d' }}>(optional)</span></label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="e.g. VAT-2025-Q1-XXXX"
                                        value={filingRef}
                                        onChange={e => setFilingRef(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label" style={{ fontWeight: 600 }}>Notes <span style={{ fontWeight: 400, color: '#6c757d' }}>(optional)</span></label>
                                <textarea
                                    className="form-control"
                                    rows={2}
                                    placeholder="Any notes about this filing..."
                                    value={filingNotes}
                                    onChange={e => setFilingNotes(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={() => setShowFileModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn-primary"
                                onClick={submitFiling}
                                disabled={filingSubmitting}
                            >
                                {filingSubmitting ? 'Filing...' : `✓ Confirm Filing — ${filingQuarter.quarterLabel}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit Modal ── */}
            {showEditModal && editingReturn && (
                <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Edit Filing — {editingReturn.quarterLabel}</h2>
                            <button className="modal-close" onClick={() => setShowEditModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Filing Date</label>
                                <input
                                    type="date"
                                    className="form-control"
                                    value={editDate}
                                    onChange={e => setEditDate(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">HMRC Reference</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={editRef}
                                    onChange={e => setEditRef(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Notes</label>
                                <textarea
                                    className="form-control"
                                    rows={3}
                                    value={editNotes}
                                    onChange={e => setEditNotes(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={() => setShowEditModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn-primary"
                                onClick={submitEdit}
                                disabled={editSubmitting}
                            >
                                {editSubmitting ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── HMRC Submit Modal ── */}
            {showHmrcModal && hmrcQuarter && hmrcCalc && (
                <div className="modal-overlay" onClick={() => setShowHmrcModal(false)}>
                    <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>🏛️ Submit to HMRC MTD — {hmrcQuarter.quarterLabel}</h2>
                            <button className="modal-close" onClick={() => setShowHmrcModal(false)}>✕</button>
                        </div>
                        <div className="modal-body" style={{ padding: '20px 24px' }}>
                            <p style={{ color: '#6c757d', marginTop: 0, marginBottom: 16, fontSize: '0.88rem' }}>
                                {hmrcQuarter.monthsLabel}
                                {hmrcCalc.isOldestDisplayedQuarter && (
                                    <span style={{
                                        marginLeft: 8, background: '#e2d9f3', color: '#4a1d96',
                                        padding: '1px 8px', borderRadius: 10, fontSize: '0.75rem'
                                    }}>⚑ Includes all pre-period entries</span>
                                )}
                            </p>

                            {/* VAT boxes */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                                <div style={{
                                    background: '#f6fff8', border: '1px solid #c3e6cb',
                                    borderRadius: 8, padding: '12px 10px', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Box 1 · VAT on Sales</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#155724' }}>
                                        {fmt(hmrcCalc.vatIn)}
                                    </div>
                                </div>
                                <div style={{
                                    background: '#fff8f8', border: '1px solid #f5c6cb',
                                    borderRadius: 8, padding: '12px 10px', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Box 4 · Input VAT</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#721c24' }}>
                                        {fmt(hmrcCalc.vatOut)}
                                    </div>
                                </div>
                                <div style={{
                                    background: hmrcCalc.vatOwed >= 0 ? '#fff5f5' : '#f6fff8',
                                    border: `1px solid ${hmrcCalc.vatOwed >= 0 ? '#f5c6cb' : '#c3e6cb'}`,
                                    borderRadius: 8, padding: '12px 10px', textAlign: 'center'
                                }}>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Box 5 · Net</div>
                                    <div style={{
                                        fontSize: '1.25rem', fontWeight: 700,
                                        color: hmrcCalc.vatOwed >= 0 ? '#dc3545' : '#28a745'
                                    }}>
                                        {fmt(Math.abs(hmrcCalc.vatOwed))}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: '#6c757d', marginTop: 2 }}>
                                        {hmrcCalc.vatOwed >= 0 ? 'payable to HMRC' : 'HMRC owes you'}
                                    </div>
                                </div>
                            </div>

                            {/* Period key */}
                            <div className="form-group" style={{ marginBottom: 14 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                                        HMRC Period Key <span style={{ color: '#dc3545' }}>*</span>
                                        {settings?.vatRegistrationNumber && (
                                            <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#6c757d', marginLeft: 8 }}>
                                                VRN: <code style={{ background: '#f4f4f4', padding: '0 4px', borderRadius: 3 }}>{settings.vatRegistrationNumber}</code>
                                            </span>
                                        )}
                                    </label>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            setHmrcModalMsg(null);
                                            try {
                                                setHmrcLoading(true);
                                                const data = await getHmrcVatObligations();
                                                const obs = data?.obligations || (Array.isArray(data) ? data : []);
                                                setHmrcObligations(obs);
                                                // Auto-select matching period key
                                                const qStart = new Date(hmrcQuarter.quarterStartDate);
                                                const match = obs.find(ob => {
                                                    const s = ob.start ? new Date(ob.start) : null;
                                                    return s && Math.abs(s - qStart) < 86400000 * 10;
                                                });
                                                if (match) {
                                                    setHmrcPeriodKey(match.periodKey);
                                                    setHmrcModalMsg({ type: 'success', text: `✅ ${obs.length} obligation${obs.length !== 1 ? 's' : ''} loaded — period key ${match.periodKey} selected automatically.` });
                                                } else if (obs.length > 0) {
                                                    setHmrcModalMsg({ type: 'info', text: `ℹ️ ${obs.length} obligation${obs.length !== 1 ? 's' : ''} loaded — none match this quarter's start date. Click a chip below or type the key manually.` });
                                                } else {
                                                    setHmrcModalMsg({ type: 'warning', text: `⚠️ No open obligations found for VRN ${settings?.vatRegistrationNumber || '(not set)'}. In sandbox only the current period has an obligation — this is expected. In production all unfiled quarters appear here. You can still type the period key manually.` });
                                                }
                                            } catch (err) {
                                                setHmrcModalMsg({ type: 'error', text: `❌ Failed to fetch obligations: ${err.message}` });
                                            } finally {
                                                setHmrcLoading(false);
                                            }
                                        }}
                                        disabled={hmrcLoading}
                                        style={{
                                            background: '#f0fff4', border: '1px solid #28a745', borderRadius: 6,
                                            color: '#155724', fontSize: '0.8rem', padding: '3px 10px',
                                            cursor: 'pointer', fontWeight: 600
                                        }}
                                    >
                                        {hmrcLoading ? '⏳ Loading…' : '📋 Load from HMRC'}
                                    </button>
                                </div>

                                {hmrcModalMsg && (
                                    <div style={{
                                        background: hmrcModalMsg.type === 'error' ? '#f8d7da' : hmrcModalMsg.type === 'success' ? '#d4edda' : hmrcModalMsg.type === 'warning' ? '#fff3cd' : '#d1ecf1',
                                        border: `1px solid ${hmrcModalMsg.type === 'error' ? '#f5c6cb' : hmrcModalMsg.type === 'success' ? '#c3e6cb' : hmrcModalMsg.type === 'warning' ? '#ffc107' : '#bee5eb'}`,
                                        color: hmrcModalMsg.type === 'error' ? '#721c24' : hmrcModalMsg.type === 'success' ? '#155724' : hmrcModalMsg.type === 'warning' ? '#856404' : '#0c5460',
                                        borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem', marginBottom: 8, lineHeight: 1.4
                                    }}>
                                        {hmrcModalMsg.text}
                                    </div>
                                )}
                                {!hmrcModalMsg && (
                                    <div style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: 8 }}>
                                        The period key is a short code (e.g. <code style={{ background: '#f4f4f4', padding: '0 4px', borderRadius: 3 }}>25AB</code>) that HMRC uses to identify which quarter you're filing. Click <strong>Load from HMRC</strong> to fetch yours automatically.
                                    </div>
                                )}

                                {/* Obligation chips */}
                                {hmrcObligations.length > 0 && (
                                    <div style={{ marginBottom: 8 }}>
                                        <div style={{ fontSize: '0.75rem', color: '#495057', marginBottom: 5, fontWeight: 600 }}>
                                            Open obligations — click to select:
                                        </div>
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {hmrcObligations.map((ob, i) => (
                                                <button
                                                    key={i}
                                                    type="button"
                                                    onClick={() => setHmrcPeriodKey(ob.periodKey)}
                                                    style={{
                                                        background: hmrcPeriodKey === ob.periodKey ? '#006400' : '#fff',
                                                        color: hmrcPeriodKey === ob.periodKey ? '#fff' : '#155724',
                                                        border: `2px solid ${hmrcPeriodKey === ob.periodKey ? '#006400' : '#28a745'}`,
                                                        borderRadius: 6, padding: '5px 14px',
                                                        fontFamily: 'monospace', fontWeight: 700,
                                                        cursor: 'pointer', fontSize: '1rem',
                                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1
                                                    }}
                                                >
                                                    {ob.periodKey}
                                                    {ob.start && ob.end && (
                                                        <span style={{
                                                            fontFamily: 'inherit', fontWeight: 400,
                                                            fontSize: '0.72rem',
                                                            color: hmrcPeriodKey === ob.periodKey ? 'rgba(255,255,255,0.85)' : '#6c757d'
                                                        }}>
                                                            {new Date(ob.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}–{new Date(ob.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* No matching obligation warning */}
                                {hmrcObligations.length > 0 && !hmrcObligations.some(ob => {
                                    const obStart = ob.start ? new Date(ob.start) : null;
                                    const qStart  = new Date(hmrcQuarter.quarterStartDate);
                                    return obStart && Math.abs(obStart - qStart) < 86400000 * 10;
                                }) && (
                                    <div style={{
                                        background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6,
                                        padding: '7px 10px', fontSize: '0.8rem', color: '#856404', marginBottom: 8
                                    }}>
                                        ⚠️ No obligation found for this quarter. In <strong>sandbox</strong> HMRC only creates an obligation for the current period — this is expected. In <strong>production</strong> all unfiled quarters will appear here.
                                    </div>
                                )}

                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g. 25AB"
                                    value={hmrcPeriodKey}
                                    onChange={e => setHmrcPeriodKey(e.target.value.toUpperCase())}
                                    style={{ fontFamily: 'monospace', letterSpacing: '0.1em', fontSize: '1.2rem', textAlign: 'center' }}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                                <input
                                    type="checkbox"
                                    id="hmrc-finalise"
                                    checked={hmrcFinalise}
                                    onChange={e => setHmrcFinalise(e.target.checked)}
                                />
                                <label htmlFor="hmrc-finalise" style={{ margin: 0, cursor: 'pointer', fontSize: '0.9rem' }}>
                                    Finalise this return (submit as final)
                                </label>
                            </div>

                            <div style={{
                                background: '#fffdf0', border: '1px solid #e8d44d',
                                borderRadius: 6, padding: '8px 12px',
                                fontSize: '0.8rem', color: '#7a6500', display: 'flex', gap: 8, alignItems: 'flex-start'
                            }}>
                                <span>⚠️</span>
                                <span><strong>Sandbox mode</strong> — no real filing occurs. Set <code>HmrcUseSandbox=false</code> in Azure to go live.</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={() => setShowHmrcModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn-primary"
                                onClick={submitToHmrc}
                                disabled={hmrcSubmitting || !hmrcPeriodKey.trim()}
                                style={{ background: '#006400', borderColor: '#006400', padding: '8px 20px' }}
                            >
                                {hmrcSubmitting ? '⏳ Submitting…' : `🏛️ Submit to HMRC — ${hmrcQuarter.quarterLabel}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
