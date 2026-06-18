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

// ── Helpers (shared logic with CTReport) ──

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

const fmt  = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n ?? 0);
const d2   = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB') : '—';

// ── CT600 Box Definition ──
// Mapping of HMRC CT600 box numbers to labels and data extraction

function BoxRow({ box, label, value, note, bold, highlight }) {
    return (
        <tr style={{ background: highlight ? '#fffbeb' : 'transparent' }}>
            <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', fontWeight: 600, color: '#6b7280', width: 80, fontSize: '0.82rem', verticalAlign: 'top' }}>
                {box}
            </td>
            <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', fontSize: '0.875rem', color: '#374151', fontWeight: bold ? 700 : 400 }}>
                {label}
                {note && <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>{note}</div>}
            </td>
            <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 700 : 500, fontSize: '0.9rem', color: highlight ? '#92400e' : '#1a1a2e', whiteSpace: 'nowrap' }}>
                {typeof value === 'number' ? fmt(value) : (value ?? '—')}
            </td>
        </tr>
    );
}

function SectionHeader({ title, icon }) {
    return (
        <tr>
            <td colSpan={3} style={{ padding: '0.875rem 0.75rem 0.5rem', background: '#f9fafb', fontWeight: 700, fontSize: '0.9rem', color: '#1d4ed8', borderBottom: '2px solid #dbeafe' }}>
                {icon} {title}
            </td>
        </tr>
    );
}

export default function CT600Form() {
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
    const { toast, showToast } = useToast();

    // ── Load Data ──
    async function loadData() {
        setLoading(true);
        try {
            const results = await Promise.allSettled([
                getCompanySettings(),
                getInvoices(),
                getExpenses(),
                getPayrollRuns(),
                getAssets(),
                getDlaEntries(),
                getDividends(),
                getMileageTrips(),
                getVatReturns(),
            ]);
            const v = (i) => results[i].status === 'fulfilled' ? results[i].value : [];
            const cs = results[0].status === 'fulfilled' ? results[0].value : {};
            setCompanySettings(cs);
            setInvoices(Array.isArray(v(1)) ? v(1) : []);
            setExpenses(Array.isArray(v(2)) ? v(2) : []);
            setPayrollRuns(Array.isArray(v(3)) ? v(3) : []);
            setAssets(Array.isArray(v(4)) ? v(4) : []);
            setDlaEntries(Array.isArray(v(5)) ? v(5) : []);
            setDividends(Array.isArray(v(6)) ? v(6) : []);
            setMileage(Array.isArray(v(7)) ? v(7) : []);
            setVatReturns(Array.isArray(v(8)) ? v(8) : []);
        } catch (err) {
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

    // ── CT600 Computation ──
    const ct600 = useMemo(() => {
        if (!selectedFY || !companySettings) return null;
        const cs = companySettings;
        const fyM = cs.fYStartMonth ?? cs.fyStartMonth ?? 4;
        const fyD = cs.fYStartDay ?? cs.fyStartDay ?? 1;
        const { start: fyStart, end: fyEnd } = fyDateRange(selectedFY, fyM, fyD);

        // Income
        const fyInvoices = invoices.filter(i => {
            const d = new Date(i.dateIssued);
            return d >= fyStart && d <= fyEnd && (i.status === 'Sent' || i.status === 'Paid' || i.status === 'Overdue');
        });
        const turnover = fyInvoices.reduce((s, i) => s + (i.amountNet ?? 0), 0);

        // Expenses
        const fyExpenses = expenses.filter(e => {
            const d = new Date(e.entryDate);
            return d >= fyStart && d <= fyEnd;
        });
        const allowable = fyExpenses.filter(e => (e.ctTag || 'Revenue') !== 'NonCT');
        const disallowable = fyExpenses.filter(e => e.ctTag === 'NonCT');
        const totalAllowable = allowable.reduce((s, e) => s + (e.amountNet ?? 0), 0);
        const totalDisallowable = disallowable.reduce((s, e) => s + (e.amountNet ?? 0), 0);

        // DLA Expenses — use inception-date-based first-FY detection (matching CT Report — CTA 2009 s.61)
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
        const dlaAllowable = fyDlaExpenses.filter(d => (d.ctTag || 'Revenue') === 'Revenue');
        const dlaCapital = fyDlaExpenses.filter(d => d.ctTag === 'Capital');
        const dlaDisallowable = fyDlaExpenses.filter(d => d.ctTag === 'NonCT');
        const totalDlaAllowable = dlaAllowable.reduce((s, d) => s + (d.amountNet ?? 0), 0);
        const totalDlaCapital = dlaCapital.reduce((s, d) => s + (d.amountNet ?? 0), 0);
        const totalDlaDisallowable = dlaDisallowable.reduce((s, d) => s + (d.amountNet ?? 0), 0);

        // Payroll
        const fyPayroll = payrollRuns.filter(r => {
            if (r.status !== 'Posted') return false;
            const d = new Date(r.periodStart);
            return d >= fyStart && d <= fyEnd;
        });
        const totalPayroll = fyPayroll.reduce((s, r) => s + (r.totalGross ?? 0) + (r.totalEmployerNi ?? 0), 0);

        // Capital Allowances (AIA)
        const fyAssets = assets.filter(a => {
            const d = new Date(a.purchaseDate);
            return d >= fyStart && d <= fyEnd;
        });
        const totalAssetCost = fyAssets.reduce((s, a) => s + (a.purchasePrice ?? 0), 0);
        const aiaAllowance = Math.min(totalAssetCost, 1000000);

        // Adjusted profit
        const totalDeductions = totalAllowable + totalDlaAllowable + totalDlaCapital + totalPayroll + aiaAllowance;
        const adjustedProfit = turnover - totalDeductions;
        const taxableProfit = Math.max(0, adjustedProfit + totalDisallowable + totalDlaDisallowable);

        // CT
        const { ct: ctLiability, rate: effectiveRate, label: rateLabel } = computeCT(taxableProfit);

        // S.455
        const s455Entries = dlaEntries.filter(d => {
            if (d.direction !== 'OwedToCompany') return false;
            return (d.remainingBalance ?? 0) > 0;
        });
        const totalS455Base = s455Entries.reduce((s, d) => s + (d.remainingBalance ?? 0), 0);
        const s455Charge = totalS455Base * 0.3375;

        // Deadlines
        const ctPayDeadline = new Date(fyEnd);
        ctPayDeadline.setMonth(ctPayDeadline.getMonth() + 9);
        ctPayDeadline.setDate(ctPayDeadline.getDate() + 2);

        const ct600Deadline = new Date(fyEnd);
        ct600Deadline.setMonth(ct600Deadline.getMonth() + 12);

        // Dividends
        const fyDivs = dividends.filter(d => {
            const dt = new Date(d.paymentDate || d.meetingDate);
            return dt >= fyStart && dt <= fyEnd;
        });
        const totalDividends = fyDivs.reduce((s, d) => s + (d.totalAmount ?? 0), 0);

        // Retained profit
        const retainedProfit = taxableProfit - ctLiability - totalDividends;

        // Marginal relief
        const marginalRelief = taxableProfit > 50000 && taxableProfit < 250000
            ? (3 / 200) * (250000 - taxableProfit)
            : 0;

        return {
            fyStart, fyEnd, turnover, totalAllowable, totalDlaAllowable, totalDlaCapital,
            totalPayroll, aiaAllowance, totalAssetCost,
            adjustedProfit, totalDisallowable, totalDlaDisallowable, taxableProfit,
            ctLiability, effectiveRate, rateLabel, marginalRelief,
            s455Charge, totalS455Base, s455Entries,
            ctPayDeadline, ct600Deadline,
            totalDividends, retainedProfit,
            fyInvoices, fyExpenses, fyPayroll, fyAssets, fyDlaExpenses,
        };
    }, [selectedFY, companySettings, invoices, expenses, payrollRuns, assets, dlaEntries, dividends, mileage, vatReturns, availableYears]);

    // ── Print CT600 ──
    function printCT600() {
        if (!ct600 || !companySettings) return;
        const cs = companySettings;
        const c = ct600;

        const boxRows = buildBoxRows(cs, c);
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CT600 Form — ${cs.companyName} — FY ${selectedFY}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1a1a2e; background: #fff; padding: 25px 35px; }
  h1 { font-size: 16pt; margin-bottom: 2px; color: #1a1a2e; }
  .subtitle { font-size: 10pt; color: #6b7280; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .section-header td { background: #1565C0; color: #fff; font-weight: 700; font-size: 10pt; padding: 8px 10px; }
  .box-num { width: 70px; font-weight: 600; color: #1565C0; font-size: 9pt; }
  td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; font-size: 9.5pt; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .bold td { font-weight: 700; }
  .highlight td { background: #fffbeb; font-weight: 700; }
  .total td { background: #eff6ff; font-weight: 700; border-top: 2px solid #1565C0; }
  .note { font-size: 8pt; color: #9ca3af; }
  .notice { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; font-size: 8.5pt; color: #6b7280; line-height: 1.5; margin-top: 16px; }
  @media print { body { padding: 10px 15px; } @page { margin: 12mm; } }
</style>
</head>
<body>
<h1>CT600 Corporation Tax Return — Form Summary</h1>
<p class="subtitle">${cs.companyName} · UTR ${cs.utr || 'N/A'} · Company No. ${cs.companyRegistrationNumber || 'N/A'} · FY ${selectedFY} · Generated ${new Date().toLocaleDateString('en-GB')}</p>
<table>
${boxRows}
</table>
<div class="notice">
<strong>⚠️ This is a summary mapping of CT600 box values only — not a completed CT600 submission.</strong>
It should be reviewed by a qualified accountant before filing with HMRC. Some boxes may require manual entries
not captured in Finlytics (e.g. capital gains, group relief, carried-forward losses).
</div>
</body></html>`;
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
        else showToast('Pop-up blocked — please allow pop-ups', 'error');
    }

    function buildBoxRows(cs, c) {
        const f = (n) => typeof n === 'number' ? fmt(n) : (n ?? '—');
        const sections = [
            {
                title: 'Company Information',
                icon: '🏢',
                rows: [
                    { box: '1', label: 'Company name', value: cs.companyName || '—' },
                    { box: '2', label: 'Company registration number', value: cs.companyRegistrationNumber || '—' },
                    { box: '3', label: 'Tax district / reference (UTR)', value: cs.utr || '—' },
                    { box: '4', label: 'Type of company', value: 'Private limited by shares' },
                    { box: '30', label: 'Start of accounting period', value: c.fyStart.toLocaleDateString('en-GB') },
                    { box: '35', label: 'End of accounting period', value: c.fyEnd.toLocaleDateString('en-GB') },
                ],
            },
            {
                title: 'Turnover & Income',
                icon: '💰',
                rows: [
                    { box: '145', label: 'Turnover from trade', value: f(c.turnover), bold: true, note: `${c.fyInvoices.length} invoice(s) in period` },
                    { box: '150', label: 'Other trading income', value: f(0) },
                    { box: '155', label: 'Trading profits (before capital allowances)', value: f(c.turnover - c.totalAllowable - c.totalDlaAllowable - c.totalPayroll) },
                    { box: '160', label: 'Trading losses', value: f(Math.max(0, -(c.turnover - c.totalAllowable - c.totalDlaAllowable - c.totalPayroll))) },
                ],
            },
            {
                title: 'Deductions from Trading Profits',
                icon: '📉',
                rows: [
                    { box: '170', label: 'Allowable business expenses', value: f(c.totalAllowable), note: 'Expenses tagged as Revenue/Capital, excl. DLA' },
                    { box: '—', label: 'Director\'s expenses via DLA (allowable)', value: f(c.totalDlaAllowable), note: 'OwedToDirector entries tagged Revenue' },
                    { box: '—', label: 'Director\'s capital items via DLA', value: f(c.totalDlaCapital), note: 'OwedToDirector entries tagged Capital' },
                    { box: '175', label: 'Staff costs (gross wages + employer NI)', value: f(c.totalPayroll), note: `${c.fyPayroll.length} payroll run(s)` },
                    { box: '—', label: 'Disallowable expenses (added back)', value: f(c.totalDisallowable + c.totalDlaDisallowable), note: 'Non-CT tagged items' },
                ],
            },
            {
                title: 'Capital Allowances',
                icon: '🏭',
                rows: [
                    { box: '245', label: 'Annual Investment Allowance (AIA)', value: f(c.aiaAllowance), bold: true, note: `${c.fyAssets.length} asset(s), total cost ${f(c.totalAssetCost)}. AIA max £1,000,000` },
                    { box: '250', label: 'Other capital allowances', value: f(0), note: 'Writing-down allowances etc. — not computed' },
                ],
            },
            {
                title: 'Profits & Tax Calculation',
                icon: '📋',
                rows: [
                    { box: '275', label: 'Adjusted trading profit before CA', value: f(c.adjustedProfit + c.aiaAllowance) },
                    { box: '280', label: 'Adjusted trading profit after CA', value: f(Math.max(0, c.adjustedProfit)) },
                    { box: '295', label: 'Net trading profits', value: f(Math.max(0, c.adjustedProfit + c.totalDisallowable + c.totalDlaDisallowable)), bold: true },
                    { box: '315', label: 'Income from non-trading loan relationships', value: f(0), note: 'Bank interest etc. — enter manually' },
                    { box: '335', label: 'Annual payments not otherwise charged', value: f(0) },
                    { box: '345', label: 'Non-trading gains on intangible fixed assets', value: f(0) },
                ],
            },
            {
                title: 'Chargeable Gains',
                icon: '📈',
                rows: [
                    { box: '350', label: 'Gross chargeable gains', value: f(0), note: 'Enter manually if applicable' },
                    { box: '355', label: 'Allowable losses (current period)', value: f(0) },
                    { box: '360', label: 'Net chargeable gains', value: f(0) },
                ],
            },
            {
                title: 'Profits Chargeable to Corporation Tax',
                icon: '🏛️',
                rows: [
                    { box: '375', label: 'Profits before qualifying donations and group relief', value: f(c.taxableProfit), bold: true },
                    { box: '380', label: 'Less: qualifying donations', value: f(0), note: 'Charitable donations — enter manually' },
                    { box: '385', label: 'Less: group relief', value: f(0) },
                    { box: '390', label: 'Profits chargeable to Corporation Tax', value: f(c.taxableProfit), bold: true, highlight: true },
                ],
            },
            {
                title: 'Tax Calculation',
                icon: '🧮',
                rows: [
                    { box: '400', label: 'FY Corporation Tax rate', value: c.rateLabel },
                    { box: '405', label: 'Corporation Tax at FY rate', value: f(c.taxableProfit * 0.25), note: 'Before marginal relief' },
                    ...(c.marginalRelief > 0 ? [
                        { box: '420', label: 'Marginal rate relief', value: f(c.marginalRelief), note: 'Standard fraction 3/200 × (£250,000 − P)' },
                    ] : []),
                    { box: '430', label: 'Corporation Tax net of marginal relief', value: f(c.ctLiability), bold: true, highlight: true },
                    { box: '440', label: 'Less: reliefs, deductions, credits', value: f(0), note: 'R&D credits, RDEC, DTR etc. — enter manually' },
                    { box: '475', label: 'Tax chargeable (CT only)', value: f(c.ctLiability), bold: true },
                ],
            },
            {
                title: 'Section 455 Tax',
                icon: '⚠️',
                rows: [
                    { box: '480', label: 'S.455 tax on loans to participators', value: f(c.s455Charge), bold: true, highlight: c.s455Charge > 0, note: `33.75% on £${(c.totalS455Base ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })} outstanding` },
                    { box: '—', label: 'S.455 repayment due date', value: c.ctPayDeadline.toLocaleDateString('en-GB'), note: 'Repayable when loan repaid' },
                ],
            },
            {
                title: 'Total Tax & Key Dates',
                icon: '🏦',
                rows: [
                    { box: '510', label: 'Tax payable (CT + S.455)', value: f(c.ctLiability + c.s455Charge), bold: true, highlight: true },
                    { box: '—', label: 'Effective CT rate', value: c.taxableProfit > 0 ? (c.effectiveRate * 100).toFixed(2) + '%' : 'N/A' },
                    { box: '—', label: 'CT payment deadline', value: c.ctPayDeadline.toLocaleDateString('en-GB'), note: '9 months + 1 day after period end' },
                    { box: '—', label: 'CT600 filing deadline', value: c.ct600Deadline.toLocaleDateString('en-GB'), note: '12 months after period end' },
                ],
            },
            {
                title: 'Supplementary Information',
                icon: '📎',
                rows: [
                    { box: '—', label: 'Dividends paid/declared in period', value: f(c.totalDividends), note: 'Not CT-deductible — from post-tax reserves' },
                    { box: '—', label: 'Retained profit for the period', value: f(c.retainedProfit), note: 'Taxable profit less CT less dividends' },
                    { box: '755', label: 'Total allowable expenses for HMRC', value: f(c.totalAllowable + c.totalDlaAllowable + c.totalDlaCapital + c.totalPayroll + c.aiaAllowance), bold: true },
                ],
            },
        ];

        return sections.map(sec =>
            `<tr class="section-header"><td colspan="3">${sec.icon} ${sec.title}</td></tr>` +
            sec.rows.map(r =>
                `<tr class="${r.bold ? 'bold' : ''} ${r.highlight ? 'highlight' : ''}">` +
                `<td class="box-num">${r.box}</td>` +
                `<td>${r.label}${r.note ? `<br><span class="note">${r.note}</span>` : ''}</td>` +
                `<td class="num">${typeof r.value === 'number' ? fmt(r.value) : (r.value ?? '—')}</td></tr>`
            ).join('')
        ).join('');
    }

    // ── Render ──
    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <div style={{ textAlign: 'center', color: '#6b7280' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                    <p>Loading CT600 data…</p>
                </div>
            </div>
        );
    }

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
                    <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#1a1a2e' }}>📄 CT600 Form</h2>
                    <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                        HMRC CT600 box mapping for <strong>{companySettings?.companyName || 'your company'}</strong>
                        {ct600 && (
                            <span style={{ marginLeft: 8, color: '#9ca3af' }}>
                                · {ct600.fyStart.toLocaleDateString('en-GB')} – {ct600.fyEnd.toLocaleDateString('en-GB')}
                            </span>
                        )}
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
                        onClick={printCT600}
                        disabled={!ct600}
                        style={{
                            padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
                            background: '#1565C0', color: '#fff',
                            cursor: ct600 ? 'pointer' : 'not-allowed',
                            fontSize: '0.875rem', fontWeight: 600, opacity: ct600 ? 1 : 0.5,
                        }}
                    >
                        🖨️ Print CT600
                    </button>
                    <button
                        onClick={loadData}
                        style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}
                        title="Refresh data"
                    >🔄</button>
                </div>
            </div>

            {!ct600 ? (
                <div className="card" style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                    <p>Select a financial year to view the CT600 form.</p>
                </div>
            ) : (
                <>
                    {/* Info banner */}
                    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.82rem', color: '#1e40af', lineHeight: 1.6 }}>
                        <strong>ℹ️ About this view:</strong> This maps your financial data to HMRC CT600 box numbers.
                        Boxes marked <strong>"—"</strong> are supplementary data not directly on the CT600 form but useful
                        for your accountant. Some boxes require manual entries (e.g. capital gains, R&D credits, group relief).
                    </div>

                    {/* CT600 Box Grid */}
                    {(() => {
                        const cs = companySettings;
                        const c = ct600;
                        const sections = [
                            {
                                title: 'Company Information',
                                icon: '🏢',
                                rows: [
                                    { box: '1', label: 'Company name', value: cs.companyName || '—' },
                                    { box: '2', label: 'Company registration number', value: cs.companyRegistrationNumber || '—' },
                                    { box: '3', label: 'Tax district / reference (UTR)', value: cs.utr || '—' },
                                    { box: '4', label: 'Type of company', value: 'Private limited by shares' },
                                    { box: '30', label: 'Start of accounting period', value: c.fyStart.toLocaleDateString('en-GB') },
                                    { box: '35', label: 'End of accounting period', value: c.fyEnd.toLocaleDateString('en-GB') },
                                ],
                            },
                            {
                                title: 'Turnover & Income',
                                icon: '💰',
                                rows: [
                                    { box: '145', label: 'Turnover from trade', value: c.turnover, bold: true, note: `${c.fyInvoices.length} invoice(s) in period` },
                                    { box: '150', label: 'Other trading income', value: 0 },
                                    { box: '155', label: 'Trading profits (before CA & add-backs)', value: c.turnover - c.totalAllowable - c.totalDlaAllowable - c.totalDlaCapital - c.totalPayroll },
                                    { box: '160', label: 'Trading losses brought forward', value: 0, note: 'Enter manually if applicable' },
                                ],
                            },
                            {
                                title: 'Deductions',
                                icon: '📉',
                                rows: [
                                    { box: '170', label: 'Allowable business expenses', value: c.totalAllowable, note: 'Non-DLA expenses tagged Revenue/Capital' },
                                    { box: '—', label: 'Director\'s expenses via DLA (allowable)', value: c.totalDlaAllowable, note: 'OwedToDirector entries tagged Revenue' },
                                    { box: '—', label: 'Director\'s capital items via DLA', value: c.totalDlaCapital, note: 'OwedToDirector entries tagged Capital' },
                                    { box: '175', label: 'Staff costs (gross wages + employer NI)', value: c.totalPayroll, note: `${c.fyPayroll.length} payroll run(s)` },
                                    { box: '—', label: 'Disallowable expenses (added back)', value: c.totalDisallowable + c.totalDlaDisallowable, note: 'Non-CT tagged items' },
                                ],
                            },
                            {
                                title: 'Capital Allowances',
                                icon: '🏭',
                                rows: [
                                    { box: '245', label: 'Annual Investment Allowance (AIA)', value: c.aiaAllowance, bold: true, note: `${c.fyAssets.length} asset(s), total cost ${fmt(c.totalAssetCost)}` },
                                    { box: '250', label: 'Other capital allowances', value: 0, note: 'WDA etc. — enter manually if applicable' },
                                ],
                            },
                            {
                                title: 'Profits Chargeable to Corporation Tax',
                                icon: '🏛️',
                                rows: [
                                    { box: '275', label: 'Adjusted trading profit before CA', value: c.adjustedProfit + c.aiaAllowance },
                                    { box: '280', label: 'Adjusted trading profit after CA', value: Math.max(0, c.adjustedProfit) },
                                    { box: '295', label: 'Net trading profits', value: Math.max(0, c.adjustedProfit + c.totalDisallowable + c.totalDlaDisallowable), bold: true },
                                    { box: '315', label: 'Income from non-trading loan relationships', value: 0, note: 'Bank interest — enter manually' },
                                    { box: '335', label: 'Annual payments not otherwise charged', value: 0 },
                                    { box: '375', label: 'Profits before qualifying donations', value: c.taxableProfit, bold: true },
                                    { box: '380', label: 'Less: qualifying donations', value: 0, note: 'Charitable donations — enter manually' },
                                    { box: '390', label: 'Profits chargeable to Corporation Tax', value: c.taxableProfit, bold: true, highlight: true },
                                ],
                            },
                            {
                                title: 'Tax Calculation',
                                icon: '🧮',
                                rows: [
                                    { box: '400', label: `CT at main rate (25% × ${fmt(c.taxableProfit)})`, value: c.taxableProfit * 0.25, note: 'Before marginal relief' },
                                    ...(c.marginalRelief > 0 ? [
                                        { box: '420', label: 'Marginal rate relief', value: c.marginalRelief, note: '3/200 × (£250,000 − P)' },
                                    ] : []),
                                    { box: '430', label: 'Corporation Tax net of relief', value: c.ctLiability, bold: true, highlight: true },
                                    { box: '440', label: 'Less: reliefs & credits (R&D, DTR etc.)', value: 0, note: 'Enter manually if applicable' },
                                    { box: '475', label: 'Tax chargeable', value: c.ctLiability, bold: true },
                                ],
                            },
                            {
                                title: 'Section 455 Tax (Director\'s Loans)',
                                icon: '⚠️',
                                rows: [
                                    { box: '480', label: 'S.455 tax on loans to participators', value: c.s455Charge, bold: true, highlight: c.s455Charge > 0, note: `33.75% on ${fmt(c.totalS455Base)} outstanding DLA (OwedToCompany)` },
                                ],
                            },
                            {
                                title: 'Total Tax Payable',
                                icon: '🏦',
                                rows: [
                                    { box: '510', label: 'Total tax payable', value: c.ctLiability + c.s455Charge, bold: true, highlight: true },
                                    { box: '—', label: 'Effective CT rate', value: c.taxableProfit > 0 ? (c.effectiveRate * 100).toFixed(2) + '%' : 'N/A' },
                                ],
                            },
                            {
                                title: 'Key Dates',
                                icon: '📅',
                                rows: [
                                    { box: '—', label: 'CT payment deadline', value: c.ctPayDeadline.toLocaleDateString('en-GB'), note: '9 months + 1 day after period end' },
                                    { box: '—', label: 'CT600 filing deadline', value: c.ct600Deadline.toLocaleDateString('en-GB'), note: '12 months after period end' },
                                ],
                            },
                            {
                                title: 'Supplementary — Dividends & Retained Profit',
                                icon: '📎',
                                rows: [
                                    { box: '—', label: 'Dividends paid/declared in period', value: c.totalDividends, note: 'Not CT-deductible — from post-tax distributable reserves' },
                                    { box: '—', label: 'Retained profit for the period', value: c.retainedProfit, note: 'Taxable profit − CT − dividends' },
                                    { box: '755', label: 'Total allowable deductions', value: c.totalAllowable + c.totalDlaAllowable + c.totalDlaCapital + c.totalPayroll + c.aiaAllowance, bold: true },
                                ],
                            },
                        ];

                        return sections.map(sec => (
                            <div key={sec.title} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: '1rem' }}>
                                <div style={{ padding: '0.75rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1d4ed8' }}>
                                        {sec.icon} {sec.title}
                                    </h3>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <tbody>
                                        {sec.rows.map((r, i) => (
                                            <BoxRow key={i} box={r.box} label={r.label} value={r.value} note={r.note} bold={r.bold} highlight={r.highlight} />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ));
                    })()}

                    {/* Disclaimer */}
                    <div style={{
                        marginTop: '0.5rem', padding: '1rem 1.25rem',
                        background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb',
                        fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.7,
                    }}>
                        <strong>⚠️ Important:</strong> This is a <em>summary mapping</em> of CT600 box values based on data
                        in Finlytics. It does not constitute a completed CT600 return or formal tax advice. Boxes left at
                        zero may require manual entries (capital gains, R&D credits, group relief, non-trading income,
                        carried-forward losses). Reviewed by a qualified accountant before submitting to HMRC.
                    </div>
                </>
            )}
        </div>
    );
}
