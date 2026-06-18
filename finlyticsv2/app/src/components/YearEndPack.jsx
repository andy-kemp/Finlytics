import React, { useEffect, useState, useMemo } from 'react';
import {
    getInvoices,
    getExpenses,
    getPayrollRuns,
    getAssets,
    getDlaEntries,
    getCompanySettings,
    getDividends,
    getMileageTrips,
    getVatReturns,
} from '../services/apiService';
import { useToast } from '../hooks/useToast';

// ── Helpers ──

function fyLabel(startYear) {
    return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

function fyDateRange(label, fyStartMonth, fyStartDay) {
    const startYear = parseInt(label.split('/')[0], 10);
    const start = new Date(startYear, fyStartMonth - 1, fyStartDay, 0, 0, 0, 0);
    const end   = new Date(startYear + 1, fyStartMonth - 1, fyStartDay, 23, 59, 59, 999);
    end.setDate(end.getDate() - 1);
    return { start, end };
}

function computeCT(taxable) {
    if (taxable <= 0) return { ct: 0, rate: 0, label: 'No profit — no CT' };
    if (taxable <= 50000) return { ct: taxable * 0.19, rate: 0.19, label: 'Small Profits Rate (19%)' };
    if (taxable >= 250000) return { ct: taxable * 0.25, rate: 0.25, label: 'Main Rate (25%)' };
    const main = taxable * 0.25;
    const relief = (3 / 200) * (250000 - taxable);
    const ct = main - relief;
    return { ct, rate: ct / taxable, label: 'Marginal Relief' };
}

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n ?? 0);
const d2 = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB') : '—';

// ── Checklist Items ──

const CHECKLIST_ITEMS = [
    { id: 'reconcile-bank', category: 'Pre-Close', label: 'Reconcile bank account balance', desc: 'Verify the bank balance in Finlytics matches your actual bank statement at period end.' },
    { id: 'review-debtors', category: 'Pre-Close', label: 'Review aged debtors', desc: 'Chase outstanding invoices. Write off any genuinely irrecoverable debts before period end.' },
    { id: 'review-creditors', category: 'Pre-Close', label: 'Review outstanding creditors', desc: 'Ensure all supplier invoices received in the period are entered.' },
    { id: 'review-expenses', category: 'Pre-Close', label: 'Review expense CT tags', desc: 'Ensure all expenses are correctly tagged as Revenue, Capital, or Non-CT (disallowable).' },
    { id: 'review-dla', category: 'Pre-Close', label: 'Review Director\'s Loan Account', desc: 'Ensure all DLA entries are recorded. Check OwedToCompany balance for S.455 implications.' },
    { id: 'review-payroll', category: 'Pre-Close', label: 'Verify all payroll runs posted', desc: 'Check that all payroll runs in the period are status "Posted" and employer NI is calculated.' },
    { id: 'review-assets', category: 'Pre-Close', label: 'Review fixed assets', desc: 'Confirm all asset purchases in the period are recorded. Check AIA eligibility (cars excluded).' },
    { id: 'review-dividends', category: 'Pre-Close', label: 'Review dividends declared', desc: 'Verify sufficient distributable reserves existed before each dividend declaration.' },
    { id: 'vat-reconciliation', category: 'Pre-Close', label: 'Reconcile VAT returns', desc: 'Cross-check VAT return Box 6 figures against turnover. File any outstanding returns.' },
    { id: 'mileage-review', category: 'Pre-Close', label: 'Review mileage claims', desc: 'Ensure no duplication between mileage claims and DLA expense entries.' },
    { id: 'prepare-accounts', category: 'Year-End Filing', label: 'Prepare statutory accounts', desc: 'Use P&L and Balance Sheet reports. Your accountant will prepare formal iXBRL accounts.' },
    { id: 'prepare-ct600', category: 'Year-End Filing', label: 'Prepare CT600 return', desc: 'Use the CT600 Form tab to map box values. Review with your accountant before filing.' },
    { id: 'file-accounts-ch', category: 'Year-End Filing', label: 'File accounts at Companies House', desc: 'Micro-entity or small company accounts. Deadline: 9 months after period end.' },
    { id: 'file-ct600', category: 'Year-End Filing', label: 'File CT600 with HMRC', desc: 'Submit online via HMRC\'s CT Online service. Deadline: 12 months after period end.' },
    { id: 'pay-ct', category: 'Year-End Filing', label: 'Pay Corporation Tax', desc: 'Payment due 9 months + 1 day after period end. Earlier for large companies (QIPs).' },
    { id: 'pay-s455', category: 'Year-End Filing', label: 'Pay S.455 tax (if applicable)', desc: 'Due with CT payment. Repayable when the director\'s loan is repaid.' },
    { id: 'confirmation-stmt', category: 'Annual', label: 'File Confirmation Statement', desc: 'Annual company update at Companies House. Due within 14 days of review date.' },
    { id: 'psc-register', category: 'Annual', label: 'Update PSC register', desc: 'Verify Persons with Significant Control register is up to date.' },
];

function ChecklistItem({ item, checked, onToggle }) {
    return (
        <div
            onClick={onToggle}
            style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6',
                cursor: 'pointer', transition: 'background 0.1s',
                background: checked ? '#f0fdf4' : 'transparent',
            }}
            onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#f9fafb'; }}
            onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
        >
            <div style={{
                width: 22, height: 22, borderRadius: 4, flexShrink: 0, marginTop: 1,
                border: checked ? '2px solid #16a34a' : '2px solid #d1d5db',
                background: checked ? '#16a34a' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
            }}>
                {checked && <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>✓</span>}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, color: checked ? '#16a34a' : '#374151', textDecoration: checked ? 'line-through' : 'none' }}>
                    {item.label}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2, lineHeight: 1.4 }}>
                    {item.desc}
                </div>
            </div>
        </div>
    );
}

export default function YearEndPack() {
    const [loading, setLoading] = useState(true);
    const [companySettings, setCompanySettings] = useState(null);
    const [invoices, setInvoices] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [payrollRuns, setPayrollRuns] = useState([]);
    const [assets, setAssets] = useState([]);
    const [dlaEntries, setDlaEntries] = useState([]);
    const [dividends, setDividends] = useState([]);
    const [mileage, setMileage] = useState([]);
    const [vatReturns, setVatReturns] = useState([]);
    const [selectedFY, setSelectedFY] = useState(null);
    const [checkedItems, setCheckedItems] = useState(() => {
        try { return JSON.parse(localStorage.getItem('yearend-checklist') || '{}'); }
        catch { return {}; }
    });
    const { toast, showToast } = useToast();

    function toggleCheck(id) {
        setCheckedItems(prev => {
            const key = `${selectedFY}:${id}`;
            const next = { ...prev, [key]: !prev[key] };
            localStorage.setItem('yearend-checklist', JSON.stringify(next));
            return next;
        });
    }

    async function loadData() {
        setLoading(true);
        try {
            const results = await Promise.allSettled([
                getCompanySettings(), getInvoices(), getExpenses(), getPayrollRuns(),
                getAssets(), getDlaEntries(), getDividends(), getMileageTrips(), getVatReturns(),
            ]);
            const v = (i) => results[i].status === 'fulfilled' ? results[i].value : [];
            setCompanySettings(results[0].status === 'fulfilled' ? results[0].value : {});
            setInvoices(Array.isArray(v(1)) ? v(1) : []);
            setExpenses(Array.isArray(v(2)) ? v(2) : []);
            setPayrollRuns(Array.isArray(v(3)) ? v(3) : []);
            setAssets(Array.isArray(v(4)) ? v(4) : []);
            setDlaEntries(Array.isArray(v(5)) ? v(5) : []);
            setDividends(Array.isArray(v(6)) ? v(6) : []);
            setMileage(Array.isArray(v(7)) ? v(7) : []);
            setVatReturns(Array.isArray(v(8)) ? v(8) : []);
        } catch {
            showToast('Failed to load data', 'error');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadData(); }, []);

    // ── Available Years ──
    const availableYears = useMemo(() => {
        const cs = companySettings ?? {};
        const fyM = cs.fYStartMonth ?? cs.fyStartMonth ?? 4;
        const fyD = cs.fYStartDay ?? cs.fyStartDay ?? 1;
        const allDates = [
            ...invoices.map(i => i.dateIssued),
            ...expenses.map(e => e.entryDate),
            ...dlaEntries.map(d => d.entryDate),
        ].filter(Boolean).map(d => new Date(d));
        if (allDates.length === 0) return [];
        const minYear = Math.min(...allDates.map(d => d.getFullYear())) - 1;
        const maxYear = Math.max(...allDates.map(d => d.getFullYear())) + 1;
        const years = [];
        for (let y = minYear; y <= maxYear; y++) {
            const { start, end } = fyDateRange(fyLabel(y), fyM, fyD);
            if (allDates.some(d => d >= start && d <= end)) {
                years.push({ label: fyLabel(y), start, end });
            }
        }
        return years.sort((a, b) => b.start - a.start);
    }, [companySettings, invoices, expenses, dlaEntries]);

    useEffect(() => {
        if (availableYears.length > 0 && !selectedFY) setSelectedFY(availableYears[0].label);
    }, [availableYears, selectedFY]);

    // ── Year-End Summary ──
    const summary = useMemo(() => {
        if (!selectedFY || !companySettings) return null;
        const cs = companySettings;
        const fyM = cs.fYStartMonth ?? cs.fyStartMonth ?? 4;
        const fyD = cs.fYStartDay ?? cs.fyStartDay ?? 1;
        const { start: fyStart, end: fyEnd } = fyDateRange(selectedFY, fyM, fyD);

        const fyInvoices = invoices.filter(i => {
            const d = new Date(i.dateIssued);
            return d >= fyStart && d <= fyEnd && (i.status === 'Sent' || i.status === 'Paid' || i.status === 'Overdue');
        });
        const turnover = fyInvoices.reduce((s, i) => s + (i.amountNet ?? 0), 0);

        const fyExpenses = expenses.filter(e => { const d = new Date(e.entryDate); return d >= fyStart && d <= fyEnd; });
        const totalExpenses = fyExpenses.reduce((s, e) => s + (e.amountNet ?? 0), 0);
        const allowableExpenses = fyExpenses.filter(e => (e.ctTag || 'Revenue') !== 'NonCT').reduce((s, e) => s + (e.amountNet ?? 0), 0);
        const disallowableExpenses = fyExpenses.filter(e => e.ctTag === 'NonCT').reduce((s, e) => s + (e.amountNet ?? 0), 0);
        const untaggedExpenses = fyExpenses.filter(e => !e.ctTag).length;

        // Determine the first accounting period using the company inception date
        // (matching the CT Report logic — CTA 2009 s.61).
        const inceptionRaw = cs.incorporationDate || cs.companyInceptionDate;
        const inception = inceptionRaw ? new Date(inceptionRaw) : null;
        let firstFYStart = null;
        if (inception) {
            let fy0 = inception.getFullYear();
            if (new Date(fy0, fyM - 1, fyD) > inception) fy0--;
            firstFYStart = new Date(fy0, fyM - 1, fyD);
        }
        const isFirstFY = firstFYStart !== null && fyStart.getTime() === firstFYStart.getTime();
        const fyDlaExpenses = dlaEntries.filter(d => {
            if (d.direction !== 'OwedToDirector') return false;
            const dt = new Date(d.entryDate);
            if (isFirstFY && dt < fyStart) return true;
            return dt >= fyStart && dt <= fyEnd;
        });
        const totalDla = fyDlaExpenses.reduce((s, d) => s + (d.amountNet ?? 0), 0);

        const fyPayroll = payrollRuns.filter(r => {
            if (r.status !== 'Posted') return false;
            const d = new Date(r.periodStart);
            return d >= fyStart && d <= fyEnd;
        });
        const totalPayroll = fyPayroll.reduce((s, r) => s + (r.totalGross ?? 0) + (r.totalEmployerNi ?? 0), 0);
        const draftPayroll = payrollRuns.filter(r => r.status === 'Draft' && new Date(r.periodStart) >= fyStart && new Date(r.periodStart) <= fyEnd).length;

        const fyAssets = assets.filter(a => { const d = new Date(a.purchaseDate); return d >= fyStart && d <= fyEnd; });
        const aiaTotal = Math.min(fyAssets.reduce((s, a) => s + (a.purchasePrice ?? 0), 0), 1000000);

        const totalDeductions = allowableExpenses + totalDla + totalPayroll + aiaTotal;
        const adjustedProfit = turnover - totalDeductions;
        const taxableProfit = Math.max(0, adjustedProfit + disallowableExpenses);
        const { ct: ctLiability } = computeCT(taxableProfit);

        const s455Base = dlaEntries
            .filter(d => d.direction === 'OwedToCompany' && (d.remainingBalance ?? 0) > 0)
            .reduce((s, d) => s + (d.remainingBalance ?? 0), 0);
        const s455Charge = s455Base * 0.3375;

        const fyDivs = dividends.filter(d => {
            const dt = new Date(d.paymentDate || d.meetingDate);
            return dt >= fyStart && dt <= fyEnd;
        });
        const totalDividends = fyDivs.reduce((s, d) => s + (d.totalAmount ?? 0), 0);

        const fyVat = vatReturns.filter(v => {
            const d = new Date(v.quarterStartDate);
            return d >= fyStart && d <= fyEnd;
        });

        const overdue = fyInvoices.filter(i => i.status === 'Overdue');

        // Deadlines
        const chDeadline = new Date(fyEnd); chDeadline.setMonth(chDeadline.getMonth() + 9);
        const ctPayDeadline = new Date(fyEnd); ctPayDeadline.setMonth(ctPayDeadline.getMonth() + 9); ctPayDeadline.setDate(ctPayDeadline.getDate() + 2);
        const ct600Deadline = new Date(fyEnd); ct600Deadline.setMonth(ct600Deadline.getMonth() + 12);
        const now = new Date();

        return {
            fyStart, fyEnd, turnover, totalExpenses, allowableExpenses, disallowableExpenses,
            untaggedExpenses, totalDla, totalPayroll, draftPayroll, aiaTotal,
            taxableProfit, ctLiability, s455Charge, s455Base, totalDividends,
            invoiceCount: fyInvoices.length, expenseCount: fyExpenses.length,
            payrollCount: fyPayroll.length, assetCount: fyAssets.length,
            dlaCount: fyDlaExpenses.length, vatCount: fyVat.length,
            overdueCount: overdue.length, overdueTotal: overdue.reduce((s, i) => s + (i.amountNet ?? 0), 0),
            chDeadline, ctPayDeadline, ct600Deadline,
            chDaysLeft: Math.ceil((chDeadline - now) / 86400000),
            ctPayDaysLeft: Math.ceil((ctPayDeadline - now) / 86400000),
            ct600DaysLeft: Math.ceil((ct600Deadline - now) / 86400000),
        };
    }, [selectedFY, companySettings, invoices, expenses, payrollRuns, assets, dlaEntries, dividends, mileage, vatReturns, availableYears]);

    // ── Print Year-End Pack ──
    function printYearEndPack() {
        if (!summary || !companySettings) return;
        const cs = companySettings;
        const s = summary;

        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Year-End Pack — ${cs.companyName} — FY ${selectedFY}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1a1a2e; background: #fff; padding: 25px 35px; }
h1 { font-size: 16pt; margin-bottom: 2px; color: #1565C0; }
h2 { font-size: 12pt; margin: 18px 0 6px; color: #1a1a2e; border-bottom: 2px solid #1565C0; padding-bottom: 3px; }
.meta { font-size: 9pt; color: #6b7280; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
.card dt { font-size: 8pt; color: #6b7280; text-transform: uppercase; }
.card dd { font-size: 10.5pt; font-weight: 600; margin-bottom: 6px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9pt; }
th { background: #1565C0; color: #fff; padding: 5px 8px; text-align: left; font-weight: 600; }
td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.total td { font-weight: 700; background: #eff6ff; border-top: 2px solid #1565C0; }
.deadline { border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
.warn { background: #fef3c7; border: 1px solid #fde68a; }
.ok { background: #f0fdf4; border: 1px solid #bbf7d0; }
.urgent { background: #fef2f2; border: 1px solid #fca5a5; }
.checklist { list-style: none; }
.checklist li { padding: 4px 0; font-size: 9pt; }
.checklist li::before { content: "☐ "; font-size: 11pt; }
.notice { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; font-size: 8.5pt; color: #6b7280; margin-top: 16px; }
@media print { body { padding: 10px 15px; } @page { margin: 12mm; } }
</style></head><body>
<h1>Year-End Reporting Pack</h1>
<p class="meta">${cs.companyName} · Company No. ${cs.companyRegistrationNumber || 'N/A'} · UTR ${cs.utr || 'N/A'} · FY ${selectedFY} · ${s.fyStart.toLocaleDateString('en-GB')} – ${s.fyEnd.toLocaleDateString('en-GB')} · Generated ${new Date().toLocaleDateString('en-GB')}</p>

<h2>Financial Summary</h2>
<div class="grid">
<div class="card"><dl>
  <dt>Turnover</dt><dd>${fmt(s.turnover)}</dd>
  <dt>Total Expenses</dt><dd>${fmt(s.totalExpenses)}</dd>
  <dt>Payroll Costs</dt><dd>${fmt(s.totalPayroll)}</dd>
  <dt>DLA Expenses</dt><dd>${fmt(s.totalDla)}</dd>
</dl></div>
<div class="card"><dl>
  <dt>Capital Allowances (AIA)</dt><dd>${fmt(s.aiaTotal)}</dd>
  <dt>Taxable Profit</dt><dd>${fmt(s.taxableProfit)}</dd>
  <dt>Est. CT Liability</dt><dd>${fmt(s.ctLiability)}</dd>
  <dt>S.455 Charge</dt><dd>${fmt(s.s455Charge)}</dd>
</dl></div>
</div>
<div class="grid">
<div class="card"><dl>
  <dt>Dividends Paid</dt><dd>${fmt(s.totalDividends)}</dd>
  <dt>Invoices</dt><dd>${s.invoiceCount} (${s.overdueCount} overdue = ${fmt(s.overdueTotal)})</dd>
  <dt>Expenses</dt><dd>${s.expenseCount} entries</dd>
  <dt>Payroll Runs</dt><dd>${s.payrollCount} posted${s.draftPayroll > 0 ? `, ${s.draftPayroll} draft!` : ''}</dd>
</dl></div>
<div class="card"><dl>
  <dt>Fixed Assets Purchased</dt><dd>${s.assetCount}</dd>
  <dt>DLA Entries</dt><dd>${s.dlaCount}</dd>
  <dt>VAT Returns</dt><dd>${s.vatCount}</dd>
  <dt>Disallowable Expenses</dt><dd>${fmt(s.disallowableExpenses)}</dd>
</dl></div>
</div>

<h2>Key Deadlines</h2>
<div class="deadline ${s.chDaysLeft < 30 ? 'urgent' : s.chDaysLeft < 90 ? 'warn' : 'ok'}">
  <strong>Companies House Accounts</strong>: ${s.chDeadline.toLocaleDateString('en-GB')} (${s.chDaysLeft > 0 ? s.chDaysLeft + ' days' : '⚠️ OVERDUE'})
</div>
<div class="deadline ${s.ctPayDaysLeft < 30 ? 'urgent' : s.ctPayDaysLeft < 90 ? 'warn' : 'ok'}">
  <strong>CT Payment</strong>: ${s.ctPayDeadline.toLocaleDateString('en-GB')} — ${fmt(s.ctLiability + s.s455Charge)} (${s.ctPayDaysLeft > 0 ? s.ctPayDaysLeft + ' days' : '⚠️ OVERDUE'})
</div>
<div class="deadline ${s.ct600DaysLeft < 30 ? 'urgent' : s.ct600DaysLeft < 90 ? 'warn' : 'ok'}">
  <strong>CT600 Filing</strong>: ${s.ct600Deadline.toLocaleDateString('en-GB')} (${s.ct600DaysLeft > 0 ? s.ct600DaysLeft + ' days' : '⚠️ OVERDUE'})
</div>

<h2>Year-End Checklist</h2>
${['Pre-Close', 'Year-End Filing', 'Annual'].map(cat =>
  `<h3 style="font-size:10pt;margin:10px 0 4px;color:#374151">${cat}</h3>
  <ul class="checklist">${CHECKLIST_ITEMS.filter(i => i.category === cat).map(i =>
    `<li>${i.label} — <em style="color:#9ca3af">${i.desc}</em></li>`).join('')}</ul>`
).join('')}

${s.overdueCount > 0 ? `<h2>⚠️ Alerts</h2>
<p style="color:#991b1b;font-size:9.5pt">${s.overdueCount} overdue invoice(s) totalling ${fmt(s.overdueTotal)} — chase before year-end close.</p>` : ''}
${s.draftPayroll > 0 ? `<p style="color:#b45309;font-size:9.5pt">${s.draftPayroll} draft payroll run(s) in period — post before closing.</p>` : ''}
${s.untaggedExpenses > 0 ? `<p style="color:#b45309;font-size:9.5pt">${s.untaggedExpenses} expense(s) without CT tags — review and tag before CT computation.</p>` : ''}

<div class="notice"><strong>⚠️</strong> This pack is prepared from Finlytics data and is for internal review only. Formal statutory accounts and CT600 filing should be prepared by a qualified accountant.</div>
</body></html>`;

        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
        else showToast('Pop-up blocked — please allow pop-ups', 'error');
    }

    // ── Render ──
    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <div style={{ textAlign: 'center', color: '#6b7280' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                    <p>Loading year-end data…</p>
                </div>
            </div>
        );
    }

    const checkedCount = selectedFY ? CHECKLIST_ITEMS.filter(i => checkedItems[`${selectedFY}:${i.id}`]).length : 0;
    const totalItems = CHECKLIST_ITEMS.length;
    const progress = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0;

    return (
        <div>
            {toast && (
                <div style={{
                    position: 'fixed', top: 16, right: 16, zIndex: 9999,
                    padding: '0.75rem 1.25rem', borderRadius: 8, fontWeight: 600,
                    background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`,
                    color: toast.type === 'error' ? '#dc2626' : '#16a34a',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                }}>{toast.type === 'error' ? '❌ ' : '✅ '}{toast.message}</div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#1a1a2e' }}>📦 Year-End Pack</h2>
                    <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                        Year-end summary, checklist &amp; deadlines for <strong>{companySettings?.companyName || 'your company'}</strong>
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                        value={selectedFY || ''}
                        onChange={e => setSelectedFY(e.target.value)}
                        style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.9rem', background: '#fff', cursor: 'pointer' }}
                    >
                        {availableYears.map(fy => (
                            <option key={fy.label} value={fy.label}>FY {fy.label}</option>
                        ))}
                    </select>
                    <button
                        onClick={printYearEndPack}
                        disabled={!summary}
                        style={{
                            padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
                            background: '#1565C0', color: '#fff',
                            cursor: summary ? 'pointer' : 'not-allowed',
                            fontSize: '0.875rem', fontWeight: 600, opacity: summary ? 1 : 0.5,
                        }}
                    >
                        🖨️ Print Year-End Pack
                    </button>
                    <button
                        onClick={loadData}
                        style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}
                        title="Refresh data"
                    >🔄</button>
                </div>
            </div>

            {!summary ? (
                <div className="card" style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                    <p>Select a financial year to view the year-end pack.</p>
                </div>
            ) : (
                <>
                    {/* ── Deadlines ── */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                        {[
                            { label: '🏛️ Companies House Accounts', date: summary.chDeadline, days: summary.chDaysLeft, desc: '9 months after period end' },
                            { label: '🏦 CT Payment', date: summary.ctPayDeadline, days: summary.ctPayDaysLeft, desc: '9 months + 1 day', extra: fmt(summary.ctLiability + summary.s455Charge) },
                            { label: '📄 CT600 Filing', date: summary.ct600Deadline, days: summary.ct600DaysLeft, desc: '12 months after period end' },
                        ].map(dl => {
                            const urgent = dl.days < 30;
                            const warn = dl.days < 90;
                            return (
                                <div key={dl.label} style={{
                                    padding: '1rem', borderRadius: 10,
                                    background: dl.days <= 0 ? '#fef2f2' : urgent ? '#fff7ed' : warn ? '#fefce8' : '#f0fdf4',
                                    border: `1.5px solid ${dl.days <= 0 ? '#fca5a5' : urgent ? '#fed7aa' : warn ? '#fde68a' : '#bbf7d0'}`,
                                }}>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{dl.label}</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: dl.days <= 0 ? '#dc2626' : '#1a1a2e' }}>
                                        {dl.date.toLocaleDateString('en-GB')}
                                    </div>
                                    {dl.extra && <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#c2410c', marginTop: 2 }}>{dl.extra}</div>}
                                    <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>{dl.desc}</div>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: dl.days <= 0 ? '#dc2626' : dl.days < 60 ? '#c2410c' : '#16a34a', marginTop: 4 }}>
                                        {dl.days > 0 ? `${dl.days} day${dl.days !== 1 ? 's' : ''} remaining` : '⚠️ DEADLINE PASSED'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* ── Financial Summary ── */}
                    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: '1.25rem' }}>
                        <div style={{ padding: '0.75rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>📊 Financial Summary — FY {selectedFY}</h3>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0 }}>
                            {[
                                { label: 'Turnover', value: fmt(summary.turnover), detail: `${summary.invoiceCount} invoices`, color: '#3b82f6' },
                                { label: 'Total Expenses', value: fmt(summary.totalExpenses), detail: `${summary.expenseCount} entries`, color: '#f59e0b' },
                                { label: 'Payroll Costs', value: fmt(summary.totalPayroll), detail: `${summary.payrollCount} runs posted`, color: '#8b5cf6' },
                                { label: 'DLA Expenses', value: fmt(summary.totalDla), detail: `${summary.dlaCount} entries`, color: '#06b6d4' },
                                { label: 'Capital Allowances', value: fmt(summary.aiaTotal), detail: `${summary.assetCount} assets (AIA)`, color: '#10b981' },
                                { label: 'Taxable Profit', value: fmt(summary.taxableProfit), detail: 'After all adjustments', color: '#ef4444' },
                                { label: 'CT Liability', value: fmt(summary.ctLiability), detail: 'Estimated', color: '#dc2626' },
                                { label: 'S.455 Charge', value: fmt(summary.s455Charge), detail: `On ${fmt(summary.s455Base)} DLA`, color: '#f97316' },
                                { label: 'Dividends', value: fmt(summary.totalDividends), detail: 'Paid in period', color: '#a855f7' },
                                { label: 'VAT Returns', value: `${summary.vatCount} filed`, detail: 'In period', color: '#64748b' },
                                { label: 'Disallowable', value: fmt(summary.disallowableExpenses), detail: 'Added back to profit', color: '#9ca3af' },
                                { label: 'Total Tax Bill', value: fmt(summary.ctLiability + summary.s455Charge), detail: 'CT + S.455', color: '#b91c1c' },
                            ].map(item => (
                                <div key={item.label} style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #f3f4f6', borderRight: '1px solid #f3f4f6' }}>
                                    <div style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{item.label}</div>
                                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: item.color, marginTop: 2 }}>{item.value}</div>
                                    <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 1 }}>{item.detail}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── Alerts ── */}
                    {(summary.overdueCount > 0 || summary.draftPayroll > 0 || summary.untaggedExpenses > 0) && (
                        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '1rem', marginBottom: '1.25rem' }}>
                            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: '#c2410c' }}>⚠️ Actions Required</h3>
                            {summary.overdueCount > 0 && (
                                <div style={{ fontSize: '0.85rem', color: '#9a3412', padding: '0.25rem 0' }}>
                                    <strong>{summary.overdueCount}</strong> overdue invoice{summary.overdueCount !== 1 ? 's' : ''} totalling <strong>{fmt(summary.overdueTotal)}</strong> — chase before year-end close.
                                </div>
                            )}
                            {summary.draftPayroll > 0 && (
                                <div style={{ fontSize: '0.85rem', color: '#9a3412', padding: '0.25rem 0' }}>
                                    <strong>{summary.draftPayroll}</strong> draft payroll run{summary.draftPayroll !== 1 ? 's' : ''} in period — post before closing year-end.
                                </div>
                            )}
                            {summary.untaggedExpenses > 0 && (
                                <div style={{ fontSize: '0.85rem', color: '#9a3412', padding: '0.25rem 0' }}>
                                    <strong>{summary.untaggedExpenses}</strong> expense{summary.untaggedExpenses !== 1 ? 's' : ''} without CT tags — review and tag for accurate CT computation.
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Checklist ── */}
                    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: '1.25rem' }}>
                        <div style={{ padding: '0.75rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>✅ Year-End Checklist</h3>
                            <span style={{ fontSize: '0.82rem', color: progress === 100 ? '#16a34a' : '#6b7280', fontWeight: 600 }}>
                                {checkedCount}/{totalItems} complete
                            </span>
                        </div>

                        {/* Progress bar */}
                        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6' }}>
                            <div style={{ background: '#f3f4f6', borderRadius: 20, height: 8, overflow: 'hidden' }}>
                                <div style={{
                                    width: `${progress}%`, height: '100%', borderRadius: 20,
                                    background: progress === 100 ? '#16a34a' : progress > 50 ? '#3b82f6' : '#f59e0b',
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                        </div>

                        {['Pre-Close', 'Year-End Filing', 'Annual'].map(cat => (
                            <div key={cat}>
                                <div style={{ padding: '0.5rem 1rem', background: '#f9fafb', fontWeight: 600, fontSize: '0.82rem', color: '#1d4ed8', borderBottom: '1px solid #e5e7eb' }}>
                                    {cat === 'Pre-Close' ? '📋' : cat === 'Year-End Filing' ? '📄' : '🗓️'} {cat}
                                </div>
                                {CHECKLIST_ITEMS.filter(i => i.category === cat).map(item => (
                                    <ChecklistItem
                                        key={item.id}
                                        item={item}
                                        checked={!!checkedItems[`${selectedFY}:${item.id}`]}
                                        onToggle={() => toggleCheck(item.id)}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>

                    {/* Disclaimer */}
                    <div style={{
                        padding: '1rem 1.25rem',
                        background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb',
                        fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.7,
                    }}>
                        <strong>⚠️ Important:</strong> This year-end pack is prepared from data in Finlytics and is for
                        internal planning purposes. Formal statutory accounts and CT600 filing should be prepared by a
                        qualified accountant. Deadlines are for standard 12-month accounting periods — shorter or extended
                        periods have different deadlines.
                    </div>
                </>
            )}
        </div>
    );
}
