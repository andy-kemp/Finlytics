import React, { useEffect, useState, useMemo, lazy, Suspense } from 'react';
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

const ProfitAndLoss = lazy(() => import('./ProfitAndLoss'));
const BalanceSheet  = lazy(() => import('./BalanceSheet'));
const AgedDebtors   = lazy(() => import('./AgedDebtors'));
const CT600Form     = lazy(() => import('./CT600Form'));
const YearEndPack   = lazy(() => import('./YearEndPack'));

// --- Helpers ---

/** Build a financial year label matching backend format e.g. "2024/25" */
function fyLabel(startYear) {
    return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

/** Compute date range for a given FY label + company FY settings */
function fyDateRange(label, fyStartMonth, fyStartDay) {
    const startYear = parseInt(label.split('/')[0], 10);
    const start = new Date(startYear, fyStartMonth - 1, fyStartDay, 0, 0, 0, 0);
    const end   = new Date(startYear + 1, fyStartMonth - 1, fyStartDay, 23, 59, 59, 999);
    end.setDate(end.getDate() - 1);
    return { start, end };
}

/** Compute CT liability and rate from taxable profit */
function computeCT(profit) {
    const LOWER = 50_000;
    const UPPER = 250_000;
    if (profit <= 0)     return { tax: 0,            rate: 0,            rateLabel: 'No taxable profit' };
    if (profit <= LOWER) return { tax: profit * 0.19, rate: 0.19,         rateLabel: '19% (Small Profits Rate)' };
    if (profit >= UPPER) return { tax: profit * 0.25, rate: 0.25,         rateLabel: '25% (Main Rate)' };
    // Marginal Relief: CT = 25%P − (3/200)(250,000 − P)
    const tax = 0.25 * profit - (3 / 200) * (UPPER - profit);
    return { tax, rate: tax / profit, rateLabel: `${((tax / profit) * 100).toFixed(2)}% (Marginal Relief)` };
}

// --- Shared styles ---
const thStyle = {
    padding: '0.5rem 0.75rem',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '0.75rem',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
};
const tdStyle = {
    padding: '0.5rem 0.75rem',
    color: '#374151',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '0.85rem',
};

// --- Sub-components ---

function SummaryCard({ label, value, color, icon, sub, highlight }) {
    return (
        <div style={{
            background: highlight ? color : '#fff',
            border: `1px solid ${highlight ? color : '#e5e7eb'}`,
            borderRadius: 10,
            padding: '1rem 1.25rem',
            boxShadow: highlight ? `0 4px 14px ${color}44` : '0 1px 3px rgba(0,0,0,0.06)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: highlight ? 'rgba(255,255,255,0.85)' : '#6b7280', fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: '1.2rem' }}>{icon}</span>
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: highlight ? '#fff' : color, marginBottom: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div style={{ fontSize: '0.75rem', color: highlight ? 'rgba(255,255,255,0.75)' : '#9ca3af' }}>{sub}</div>
        </div>
    );
}

function WaterfallRow({ label, value, fmt, bold, indent, highlighted, tax, total }) {
    const absVal = Math.abs(value ?? 0);
    const isNeg  = (value ?? 0) < 0;
    let color = 'inherit';
    if (total)       color = '#1a1a2e';
    else if (tax)    color = '#dc2626';
    else if (highlighted) color = '#1d4ed8';
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: `0.35rem ${(highlighted || total) ? '0.5rem' : '0'}`,
            paddingLeft: indent ? '1.5rem' : ((highlighted || total) ? '0.5rem' : 0),
            fontWeight: bold ? 600 : 400,
            fontSize: total ? '1rem' : '0.9rem',
            color,
            background: highlighted ? '#eff6ff' : total ? '#f0f0f8' : 'transparent',
            borderRadius: (highlighted || total) ? 4 : 0,
            marginBottom: 2,
        }}>
            <span style={{ color: indent && !tax && !total ? '#6b7280' : 'inherit' }}>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: isNeg ? '#16a34a' : ((tax || total) && (value ?? 0) > 0) ? '#dc2626' : 'inherit' }}>
                {isNeg ? `(${fmt(absVal)})` : fmt(absVal)}
            </span>
        </div>
    );
}

function DetailSection({ title, expanded, onToggle, total, warning, children }) {
    return (
        <div style={{
            background: '#fff',
            borderRadius: 10,
            border: `1px solid ${warning ? '#fed7aa' : '#e5e7eb'}`,
            marginBottom: '0.875rem',
            overflow: 'hidden',
        }}>
            <div
                onClick={onToggle}
                style={{
                    padding: '0.875rem 1.25rem',
                    cursor: 'pointer',
                    background: warning ? '#fff7ed' : '#f9fafb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: expanded ? `1px solid ${warning ? '#fed7aa' : '#e5e7eb'}` : 'none',
                    userSelect: 'none',
                }}
            >
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{title}</span>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: warning ? '#c2410c' : '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>{total}</span>
                    <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{expanded ? '▲' : '▼'}</span>
                </div>
            </div>
            {expanded && (
                <div style={{ padding: '1rem 1.25rem', overflowX: 'auto' }}>
                    {children}
                </div>
            )}
        </div>
    );
}

function ExpenseTable({ expenses, fmt }) {
    if (!expenses || expenses.length === 0) return null;
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr style={{ background: '#f9fafb' }}>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Supplier</th>
                    <th style={thStyle}>Category</th>
                    <th style={thStyle}>Reference</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Net Amount</th>
                </tr>
            </thead>
            <tbody>
                {expenses.map((exp, i) => (
                    <tr key={exp.expenseId || i}>
                        <td style={tdStyle}>{exp.entryDate ? new Date(exp.entryDate).toLocaleDateString('en-GB') : '—'}</td>
                        <td style={tdStyle}>{exp.supplier || exp.supplierFreeText || '—'}</td>
                        <td style={tdStyle}>{exp.category || '—'}</td>
                        <td style={tdStyle}>{exp.reference || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>{fmt(exp.amountNet)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Build available financial years from company settings — used both in useMemo and loadData */
function buildAvailableYears(settings) {
    if (!settings) return [];
    // .NET CamelCase serialises FYStartMonth as fYStartMonth — handle both variants
    const fyStartMonth = settings.fyStartMonth ?? settings.fYStartMonth ?? 4;
    const fyStartDay   = settings.fyStartDay   ?? settings.fYStartDay   ?? 1;
    const inceptionRaw = settings.incorporationDate || settings.companyInceptionDate;
    const inception    = inceptionRaw ? new Date(inceptionRaw) : new Date(new Date().getFullYear() - 3, 0, 1);

    let y = inception.getFullYear();
    if (new Date(y, fyStartMonth - 1, fyStartDay) > inception) y--;

    const now   = new Date();
    const years = [];
    while (true) {
        const start = new Date(y, fyStartMonth - 1, fyStartDay);
        if (start > now) break;
        years.push({ label: fyLabel(y), start });
        y++;
    }
    return years.reverse();
}

// ============================================================
// CT Report Component (existing)
// ============================================================
function CTReport() {
    const { toast, showToast } = useToast();

    const [loading, setLoading]                   = useState(true);
    const [companySettings, setCompanySettings]   = useState(null);
    const [invoices, setInvoices]                 = useState([]);
    const [expenses, setExpenses]                 = useState([]);
    const [payrollRuns, setPayrollRuns]           = useState([]);
    const [assets, setAssets]                     = useState([]);
    const [dlaEntries, setDlaEntries]             = useState([]);
    const [dividends, setDividends]               = useState([]);
    const [mileageTrips, setMileageTrips]         = useState([]);
    const [vatReturns, setVatReturns]             = useState([]);
    const [selectedFY, setSelectedFY]             = useState(null);
    const [expandedSections, setExpandedSections] = useState({
        income:      true,
        allowable:   true,
        dlaExpenses: true,
        payroll:     true,
        capital:     false,
        addback:     false,
        dla:         false,
    });

    // Available years derived from company settings
    const availableYears = useMemo(() => buildAvailableYears(companySettings), [companySettings]);

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        setLoading(true);
        try {
            // Use allSettled so a failing endpoint (e.g. payroll not configured) doesn't blank the whole page
            const [settingsRes, invRes, expRes, payrollRes, assetRes, dlaRes, divRes, milRes, vatRes] = await Promise.allSettled([
                getCompanySettings(),
                getInvoices(),
                getExpenses(),
                getPayrollRuns(),
                getAssets(),
                getDlaEntries(),
                getDividends(),
                getMileageTrips({ status: 'Paid' }),
                getVatReturns(),
            ]);

            const settings = settingsRes.status === 'fulfilled' ? settingsRes.value : null;
            const inv       = invRes.status     === 'fulfilled' ? invRes.value     : [];
            const exp       = expRes.status     === 'fulfilled' ? expRes.value     : [];
            const payroll   = payrollRes.status === 'fulfilled' ? payrollRes.value : [];
            const assetList = assetRes.status   === 'fulfilled' ? assetRes.value   : [];
            const dla       = dlaRes.status     === 'fulfilled' ? dlaRes.value     : [];
            const divs      = divRes.status     === 'fulfilled' ? divRes.value     : [];
            const miles     = milRes.status     === 'fulfilled' ? milRes.value     : [];
            const vats      = vatRes.status     === 'fulfilled' ? vatRes.value     : [];

            if (!settings) {
                showToast('Could not load company settings — CT computation unavailable', 'error');
            }

            setCompanySettings(settings);
            setInvoices(asArray(inv));
            setExpenses(asArray(exp));
            setPayrollRuns(asArray(payroll));
            setAssets(asArray(assetList));
            setDlaEntries(asArray(dla));
            setDividends(asArray(divs));
            setMileageTrips(asArray(miles));
            setVatReturns(asArray(vats));

            // Set initial FY straight away (avoids needing a useEffect re-render cycle)
            if (settings && !selectedFY) {
                const fy = buildAvailableYears(settings);
                if (fy.length > 0) setSelectedFY(fy[0].label);
            }
        } catch (err) {
            showToast('Failed to load data: ' + err.message, 'error');
        }
        setLoading(false);
    }

    function asArray(v) { return Array.isArray(v) ? v : []; }

    const fmt = (n) =>
        new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n ?? 0);

    const pct = (n) => `${(n * 100).toFixed(2)}%`;

    const toggleSection = (key) =>
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

    // ---- CT Computation (pure derivation — no extra API call needed) ----
    const computation = useMemo(() => {
        if (!selectedFY || !companySettings) return null;

        // .NET CamelCase serialises FYStartMonth → fYStartMonth; handle both variants
        const fyStartMonth = companySettings.fyStartMonth ?? companySettings.fYStartMonth ?? 4;
        const fyStartDay   = companySettings.fyStartDay   ?? companySettings.fYStartDay   ?? 1;
        const { start, end } = fyDateRange(selectedFY, fyStartMonth, fyStartDay);

        const inRange = (dateStr) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return d >= start && d <= end;
        };

        // --- Is this the first (earliest) accounting period? ---
        // Pre-trading startup costs (isStartupCost = true, entryDate before incorporation)
        // are treated by HMRC as incurred on the first day of trading and deductible in the
        // first accounting period only (ICTA 1988 s.401 / CTA 2009 s.61).
        const inceptionRaw = companySettings.incorporationDate || companySettings.companyInceptionDate;
        const inception = inceptionRaw ? new Date(inceptionRaw) : null;
        let firstFYStart = null;
        if (inception) {
            let fy0 = inception.getFullYear();
            if (new Date(fy0, fyStartMonth - 1, fyStartDay) > inception) fy0--;
            firstFYStart = new Date(fy0, fyStartMonth - 1, fyStartDay);
        }
        const isFirstFY = firstFYStart !== null && start.getTime() === firstFYStart.getTime();

        // --- Income ---
        // Use date-range filtering (inRange) rather than financialYear string match.
        // Invoices have no FinancialYear stamped by the backend, so string match always returns empty.
        const fyInvoices = invoices.filter(inv =>
            inRange(inv.dateIssued) && inv.status !== 'Draft'
        );
        const turnover = fyInvoices.reduce((sum, inv) => sum + (inv.amountNet ?? 0), 0);

        // --- Expenses (regular — exclude DLA-backed entries) ---
        const fyExpenses = expenses.filter(exp =>
            inRange(exp.entryDate ?? exp.datePaid) && !exp.isDLA
        );
        const allowableExpenses    = fyExpenses.filter(exp => !exp.ctTag || exp.ctTag === '' || exp.ctTag === 'Revenue');
        const disallowableExpenses = fyExpenses.filter(exp => exp.ctTag === 'NonCT');
        const totalAllowable    = allowableExpenses.reduce((sum, e) => sum + (e.amountNet ?? 0), 0);
        const totalDisallowable = disallowableExpenses.reduce((sum, e) => sum + (e.amountNet ?? 0), 0);

        // --- DLA Expenses (director paid personally on behalf of company — OwedToDirector entries) ---
        // These are CT-deductible costs that live in the DLA, not the expense register.
        // Pre-trading startup costs (isStartupCost=true, entryDate before FY start) are included
        // in the FIRST accounting period only — HMRC treats them as incurred on the first trading day.
        const fyDlaExpenses = dlaEntries.filter(d => {
            if (d.direction !== 'OwedToDirector' || d.isTrivialBenefit) return false;
            if (inRange(d.entryDate)) return true;
            // Pre-trading: any OwedToDirector entry dated before this FY's start is included in the
            // first accounting period only (date alone is the criterion — CTA 2009 s.61).
            if (isFirstFY && new Date(d.entryDate) < start) return true;
            return false;
        });
        const dlaAllowable    = fyDlaExpenses.filter(d => !d.ctTag || d.ctTag === '' || d.ctTag === 'Revenue');
        const dlaDisallowable = fyDlaExpenses.filter(d => d.ctTag === 'NonCT');
        const dlaCapital      = fyDlaExpenses.filter(d => d.ctTag === 'Capital');
        const totalDlaAllowable    = dlaAllowable.reduce((sum, d) => sum + (d.amountNet ?? 0), 0);
        const totalDlaDisallowable = dlaDisallowable.reduce((sum, d) => sum + (d.amountNet ?? 0), 0);
        const totalDlaCapital      = dlaCapital.reduce((sum, d) => sum + (d.amountNet ?? 0), 0);

        // --- Payroll (Posted runs with payDate/periodEnd in this FY) ---
        const fyPayroll = payrollRuns.filter(run => {
            if (run.status !== 'Posted') return false;
            return inRange(run.payDate) || inRange(run.periodEnd);
        });
        const totalGrossPayroll = fyPayroll.reduce((sum, r) => sum + (r.totalGross      ?? 0), 0);
        const totalEmployerNI   = fyPayroll.reduce((sum, r) => sum + (r.totalEmployerNi ?? 0), 0);
        const totalPayroll      = totalGrossPayroll + totalEmployerNI;

        // --- Capital Allowances (AIA on assets purchased this FY) ---
        const fyAssets       = assets.filter(a => inRange(a.purchaseDate));
        const totalAssetCost = fyAssets.reduce((sum, a) => sum + (a.purchasePrice ?? 0), 0);
        const aiaAllowance   = Math.min(totalAssetCost, 1_000_000);
        const aiaCapped      = totalAssetCost > 1_000_000;

        // --- Profit ---
        // Deduct: regular allowable + DLA allowable + DLA capital items + payroll + AIA
        // Add back: regular disallowable + DLA disallowable
        const adjustedProfit = turnover
            - totalAllowable
            - totalDlaAllowable
            - totalDlaCapital
            - totalPayroll
            - aiaAllowance;
        const taxableProfit  = adjustedProfit + totalDisallowable + totalDlaDisallowable;

        // --- CT ---
        const { tax: ctLiability, rate: effectiveRate, rateLabel } = computeCT(Math.max(0, taxableProfit));

        // --- S.455 (33.75% on loans owed to company, outstanding as at FY end) ---
        // Filter to OwedToCompany entries that existed on or before FY end and still have a balance.
        const s455DueDate = new Date(end);
        s455DueDate.setMonth(s455DueDate.getMonth() + 9);
        s455DueDate.setDate(s455DueDate.getDate() + 2);

        const s455Entries   = dlaEntries.filter(d =>
            d.direction === 'OwedToCompany' &&
            new Date(d.entryDate) <= end &&
            (d.remainingBalance ?? 0) > 0
        );
        const totalS455Base = s455Entries.reduce((sum, d) => sum + (d.remainingBalance ?? 0), 0);
        const s455Charge    = totalS455Base * 0.3375;

        // --- Dividends declared/paid in this FY ---
        // Note: dividends are NOT CT-deductible — they come from post-tax distributable reserves.
        // Included for the accountant to verify retained earnings and reconcile the P&L.
        const fyDividends = dividends.filter(d => {
            const dt = d.paymentDate || d.meetingDate || d.createdDate;
            return dt && inRange(dt) && d.status !== 'Draft';
        });
        const totalDividendsPaid = fyDividends.reduce((s, d) => s + (d.totalAmount ?? 0), 0);

        // --- Mileage (Paid AMAP claims with trip dates in this FY) ---
        // These are deductible business travel expenses paid by the company.
        // If they were reimbursed via DLA they are already captured in fyDlaExpenses;
        // trips fetched here have status=Paid (company reimbursed the director directly).
        const fyMileage = mileageTrips.filter(t => inRange(t.tripDate));
        const totalMileageAmount = fyMileage.reduce((s, t) => s + (t.totalAmount ?? 0), 0);
        const totalMileageMiles  = fyMileage.reduce((s, t) => s + (t.miles ?? 0), 0);

        // --- VAT returns covering periods that fall within this FY ---
        const fyVatReturns = vatReturns.filter(v => {
            const qs = v.quarterStartDate ? new Date(v.quarterStartDate) : null;
            return qs && qs >= start && qs < end;
        });
        const totalVatOwed   = fyVatReturns.reduce((s, v) => s + (v.vatOwed ?? 0), 0);
        const totalVatIn     = fyVatReturns.reduce((s, v) => s + (v.vatIn  ?? 0), 0);
        const totalVatOut    = fyVatReturns.reduce((s, v) => s + (v.vatOut ?? 0), 0);

        // --- Quarterly breakdown (4 equal quarters of the AP) ---
        // Used for the quarterly progress / MTD-for-CT view.
        const quarters = [0, 1, 2, 3].map(q => {
            const qStart = new Date(start);
            qStart.setMonth(qStart.getMonth() + q * 3);
            const qEnd = new Date(start);
            qEnd.setMonth(qEnd.getMonth() + (q + 1) * 3);
            qEnd.setDate(qEnd.getDate() - 1);
            qEnd.setHours(23, 59, 59, 999);

            const inQ = (dateStr) => {
                if (!dateStr) return false;
                const d = new Date(dateStr);
                return d >= qStart && d <= qEnd;
            };

            const qInvoices  = fyInvoices.filter(i => inQ(i.dateIssued));
            const qExpenses  = fyExpenses.filter(e => inQ(e.entryDate ?? e.datePaid));
            const qDla       = fyDlaExpenses.filter(d => inQ(d.entryDate));
            const qPayroll   = fyPayroll.filter(r => inQ(r.payDate) || inQ(r.periodEnd));
            const qAssets    = fyAssets.filter(a => inQ(a.purchaseDate));

            const qTurnover      = qInvoices.reduce((s, i) => s + (i.amountNet ?? 0), 0);
            const qAllowable     = qExpenses.filter(e => !e.ctTag || e.ctTag === '' || e.ctTag === 'Revenue')
                                            .reduce((s, e) => s + (e.amountNet ?? 0), 0);
            const qDisallowable  = qExpenses.filter(e => e.ctTag === 'NonCT')
                                            .reduce((s, e) => s + (e.amountNet ?? 0), 0);
            const qDlaAllowable  = qDla.filter(d => !d.ctTag || d.ctTag === '' || d.ctTag === 'Revenue')
                                       .reduce((s, d) => s + (d.amountNet ?? 0), 0);
            const qDlaCapital    = qDla.filter(d => d.ctTag === 'Capital')
                                       .reduce((s, d) => s + (d.amountNet ?? 0), 0);
            const qDlaDisallow   = qDla.filter(d => d.ctTag === 'NonCT')
                                       .reduce((s, d) => s + (d.amountNet ?? 0), 0);
            const qPayrollTotal  = qPayroll.reduce((s, r) => s + (r.totalGross ?? 0) + (r.totalEmployerNi ?? 0), 0);
            const qAIA           = qAssets.reduce((s, a) => s + (a.purchasePrice ?? 0), 0);

            const qAdjProfit = qTurnover - qAllowable - qDlaAllowable - qDlaCapital - qPayrollTotal - qAIA;
            const qTaxable   = qAdjProfit + qDisallowable + qDlaDisallow;
            const { tax: qCT } = computeCT(Math.max(0, qTaxable));

            const now = new Date();
            const status = now < qStart ? 'future'
                         : now > qEnd   ? 'complete'
                         : 'current';

            return {
                q: q + 1, qStart, qEnd, status,
                qTurnover, qAllowable, qDisallowable,
                qDlaAllowable, qDlaCapital, qDlaDisallow,
                qPayrollTotal, qAIA,
                qAdjProfit, qTaxable, qCT,
                invoiceCount: qInvoices.length,
            };
        });

        // Year-to-date figures (completed + current quarters)
        const ytdTurnover = quarters
            .filter(q => q.status !== 'future')
            .reduce((s, q) => s + q.qTurnover, 0);
        const ytdTaxable  = quarters
            .filter(q => q.status !== 'future')
            .reduce((s, q) => s + Math.max(0, q.qTaxable), 0);
        // Simple run-rate projection based on quarters elapsed
        const quartersElapsed = quarters.filter(q => q.status !== 'future').length;
        const projectedTaxable = quartersElapsed > 0
            ? (ytdTaxable / quartersElapsed) * 4
            : taxableProfit;
        const { tax: projectedCT } = computeCT(Math.max(0, projectedTaxable));

        return {
            fyStart: start, fyEnd: end,
            fyInvoices, turnover,
            allowableExpenses, totalAllowable,
            disallowableExpenses, totalDisallowable,
            fyDlaExpenses, dlaAllowable, dlaDisallowable, dlaCapital,
            totalDlaAllowable, totalDlaDisallowable, totalDlaCapital,
            fyPayroll, totalGrossPayroll, totalEmployerNI, totalPayroll,
            fyAssets, totalAssetCost, aiaAllowance, aiaCapped,
            adjustedProfit, taxableProfit,
            ctLiability, effectiveRate, rateLabel,
            s455Entries, totalS455Base, s455Charge, s455DueDate,
            totalTaxBill: ctLiability + s455Charge,
            quarters, ytdTurnover, ytdTaxable,
            quartersElapsed, projectedTaxable, projectedCT,
            fyDividends, totalDividendsPaid,
            fyMileage, totalMileageAmount, totalMileageMiles,
            fyVatReturns, totalVatOwed, totalVatIn, totalVatOut,
        };
    }, [selectedFY, companySettings, invoices, expenses, payrollRuns, assets, dlaEntries, dividends, mileageTrips, vatReturns]);

    function exportForAccountant() {
        if (!computation) return;
        const cs = companySettings ?? {};
        const ctPayDeadline = (() => { const d = new Date(computation.fyEnd); d.setMonth(d.getMonth() + 9); d.setDate(d.getDate() + 2); return d; })();
        const ct600Deadline = (() => { const d = new Date(computation.fyEnd); d.setMonth(d.getMonth() + 9); d.setDate(d.getDate() + 2); return d; })();
        const data = {
            _note: 'Generated by Finlytics — CT600 supporting data package. Figures are estimates; review with accountant before filing.',
            company: {
                name:               cs.companyName,
                registrationNumber: cs.companyRegistrationNumber,
                utr:                cs.utr,
                address:            cs.companyAddress || cs.address,
                incorporationDate:  cs.incorporationDate || cs.companyInceptionDate,
                vatNumber:          cs.vatRegistrationNumber || cs.vATNumber,
            },
            accountingPeriod: {
                financialYear: selectedFY,
                startDate:     computation.fyStart.toISOString().split('T')[0],
                endDate:       computation.fyEnd.toISOString().split('T')[0],
            },
            exportedAt: new Date().toISOString(),
            ct600Computation: {
                _boxRefs: 'Box numbers are indicative references to CT600 (2024). Confirm with accountant.',
                box145_turnover:              computation.turnover,
                box755_allowableExpenses:     computation.totalAllowable + computation.totalDlaAllowable + computation.totalDlaCapital,
                box_payrollCosts:             computation.totalPayroll,
                box_capitalAllowancesAIA:     computation.aiaAllowance,
                box_aiaCapped:                computation.aiaCapped,
                box_adjustedTradingProfit:    computation.adjustedProfit,
                box_disallowableAddBacks:     computation.totalDisallowable + computation.totalDlaDisallowable,
                box295_taxableProfit:         computation.taxableProfit,
                box_effectiveRate:            computation.effectiveRate,
                box_rateLabel:                computation.rateLabel,
                box390_ctLiability:           computation.ctLiability,
                box480_s455Charge:            computation.s455Charge,
                box_totalTaxBill:             computation.totalTaxBill,
            },
            keyDates: {
                ctPaymentDeadline: ctPayDeadline.toISOString().split('T')[0],
                ct600FilingDeadline: ct600Deadline.toISOString().split('T')[0],
            },
            invoices: computation.fyInvoices.map(i => ({
                invoiceNumber: i.invoiceNumber,
                customer:      i.customerName,
                dateIssued:    i.dateIssued,
                status:        i.status,
                amountNet:     i.amountNet,
                vatAmount:     i.vatAmount,
                amountGross:   i.amountGross,
            })),
            allowableExpenses:    computation.allowableExpenses.map(expToRow),
            disallowableExpenses: computation.disallowableExpenses.map(expToRow),
            dlaExpenses: computation.fyDlaExpenses.map(d => ({
                dlaId:       d.dlaId,
                date:        d.entryDate,
                description: d.description,
                category:    d.category,
                ctTag:       d.ctTag || 'Revenue',
                amountNet:   d.amountNet,
                isStartupCost: d.isStartupCost,
                preTrading:  new Date(d.entryDate) < computation.fyStart,
            })),
            payrollRuns: computation.fyPayroll.map(r => ({
                periodStart:    r.periodStart,
                periodEnd:      r.periodEnd,
                payDate:        r.payDate,
                totalGross:     r.totalGross,
                totalEmployerNI: r.totalEmployerNi,
                totalCost:      (r.totalGross ?? 0) + (r.totalEmployerNi ?? 0),
            })),
            capitalAllowances: {
                aiaLimit:     1_000_000,
                totalCost:    computation.totalAssetCost,
                aiaClaimed:   computation.aiaAllowance,
                aiaCapped:    computation.aiaCapped,
                assets: computation.fyAssets.map(a => ({
                    assetId:       a.assetId,
                    name:          a.name,
                    category:      a.category,
                    purchaseDate:  a.purchaseDate,
                    purchasePrice: a.purchasePrice,
                })),
            },
            s455Analysis: {
                totalOutstandingLoans: computation.totalS455Base,
                s455Rate:              0.3375,
                s455Charge:           computation.s455Charge,
                dueDate:              computation.s455DueDate?.toISOString().split('T')[0],
                entries: computation.s455Entries.map(d => ({
                    dlaId:            d.dlaId,
                    description:      d.description,
                    entryDate:        d.entryDate,
                    remainingBalance: d.remainingBalance,
                    s455On:           (d.remainingBalance ?? 0) * 0.3375,
                })),
            },
            quarterlyBreakdown: computation.quarters.map(q => ({
                quarter:       q.q,
                startDate:     q.qStart.toISOString().split('T')[0],
                endDate:       q.qEnd.toISOString().split('T')[0],
                status:        q.status,
                turnover:      q.qTurnover,
                allowable:     q.qAllowable + q.qDlaAllowable + q.qDlaCapital,
                disallowable:  q.qDisallowable + q.qDlaDisallow,
                payroll:       q.qPayrollTotal,
                aia:           q.qAIA,
                taxableProfit: q.qTaxable,
                estimatedCT:   q.qCT,
            })),
            dividends: {
                _note: 'Dividends are NOT CT-deductible. Included for retained earnings reconciliation and to confirm distributable reserves were sufficient.',
                total: computation.totalDividendsPaid,
                declarations: computation.fyDividends.map(d => ({
                    ref:           d.dividendRef,
                    type:          d.dividendType,
                    shareClass:    d.shareClass,
                    meetingDate:   d.meetingDate,
                    paymentDate:   d.paymentDate,
                    amountPerShare: d.amountPerShare,
                    totalAmount:   d.totalAmount,
                    status:        d.status,
                })),
            },
            mileageClaims: {
                _note: 'HMRC AMAP mileage reimbursed to director. These are allowable business travel expenses paid by the company. If already in DLA expenses they may be double-counted — confirm with accountant.',
                totalMiles:   computation.totalMileageMiles,
                totalAmount:  computation.totalMileageAmount,
                trips: computation.fyMileage.map(t => ({
                    tripId:      t.tripId,
                    tripDate:    t.tripDate,
                    director:    t.director,
                    from:        t.startLocation,
                    to:          t.endLocation,
                    purpose:     t.purpose,
                    miles:       t.miles,
                    totalAmount: t.totalAmount,
                    status:      t.status,
                })),
            },
            vatReturns: {
                _note: 'VAT returns with quarter start dates falling within this accounting period. Reconcile Box 6 (net sales) against turnover figure above.',
                totalVatIn:  computation.totalVatIn,
                totalVatOut: computation.totalVatOut,
                totalVatOwed: computation.totalVatOwed,
                returns: computation.fyVatReturns.map(v => ({
                    quarter:          v.quarterLabel,
                    months:           v.monthsLabel,
                    periodStart:      v.quarterStartDate,
                    periodEnd:        v.quarterEndDate,
                    vatOnSales:       v.vatIn,
                    vatReclaimed:     v.vatOut,
                    netVatOwed:       v.vatOwed,
                    filedDate:        v.filedDate,
                    hmrcReference:    v.reference,
                })),
            },
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `CT-Computation-FY${selectedFY.replace('/', '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('CT data package exported', 'success');
    }

    function printReport() {
        if (!computation) return;
        const cs  = companySettings ?? {};
        const f   = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n ?? 0);
        const d2  = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB') : '—';
        const ctPayDeadline = (() => { const d = new Date(computation.fyEnd); d.setMonth(d.getMonth() + 9); d.setDate(d.getDate() + 2); return d; })();
        const ct600Deadline = (() => { const d = new Date(computation.fyEnd); d.setMonth(d.getMonth() + 9); d.setDate(d.getDate() + 2); return d; })();
        const daysTo = (dt) => Math.ceil((dt - new Date()) / 86400000);

        const rowsHtml = (rows) => rows.map(r =>
            `<tr><td>${d2(r.date)}</td><td>${r.supplier || r.description || '—'}</td><td>${r.category || '—'}</td><td>${r.reference || r.dlaId || '—'}</td><td class="num">${f(r.amountNet)}</td></tr>`
        ).join('');

        const waterfallRows = [
            ['Turnover (Box 145)',                       computation.turnover,                                              false],
            ['Less: Allowable expenses',                 -(computation.totalAllowable),                                     false],
            ['Less: Director expenses via DLA (Revenue)',-(computation.totalDlaAllowable),                                  false],
            ['Less: Director expenses via DLA (Capital)',-(computation.totalDlaCapital),                                    false],
            ['Less: Payroll costs (gross + employer NI)',-(computation.totalPayroll),                                       false],
            ['Less: Capital allowances (AIA)',           -(computation.aiaAllowance),                                       false],
            ['Add back: Disallowable expenses',          computation.totalDisallowable + computation.totalDlaDisallowable,  false],
            ['Taxable profit / (loss) (Box 295)',        computation.taxableProfit,                                         true],
            ['CT liability (Box 390)',                   computation.ctLiability,                                           true],
            ['S.455 charge (Box 480)',                   computation.s455Charge,                                            false],
            ['Total tax bill',                           computation.totalTaxBill,                                          true],
        ];

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CT Computation — ${cs.companyName} — FY ${selectedFY}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a2e; background: #fff; padding: 30px 40px; }
  h1 { font-size: 18pt; margin-bottom: 4px; color: #1565C0; }
  h2 { font-size: 12pt; margin: 22px 0 8px; color: #1a1a2e; border-bottom: 2px solid #1565C0; padding-bottom: 4px; }
  h3 { font-size: 10.5pt; margin: 14px 0 6px; color: #374151; }
  .meta { font-size: 9.5pt; color: #6b7280; margin-bottom: 18px; }
  .meta strong { color: #374151; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 18px; }
  .info-block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .info-block dt { font-size: 8.5pt; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
  .info-block dd { font-size: 10.5pt; font-weight: 600; color: #1a1a2e; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 9.5pt; }
  th { background: #1565C0; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; }
  td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
  tr:last-child td { border-bottom: none; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total-row td { font-weight: 700; background: #eff6ff; border-top: 2px solid #1565C0; }
  .highlight-row td { font-weight: 700; background: #fef3c7; }
  .nil { color: #9ca3af; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 20px; font-size: 8pt; font-weight: 600; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-red   { background: #fee2e2; color: #991b1b; }
  .badge-purple{ background: #ede9fe; color: #5b21b6; }
  .badge-blue  { background: #dbeafe; color: #1e40af; }
  .deadline-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
  .deadline-card { border-radius: 8px; padding: 12px 14px; }
  .warn { background: #fef3c7; border: 1px solid #fde68a; }
  .info { background: #eff6ff; border: 1px solid #bfdbfe; }
  .urgent { background: #fef2f2; border: 1px solid #fca5a5; }
  .notice { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; font-size: 9pt; color: #6b7280; line-height: 1.6; margin-top: 20px; }
  .quarter-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
  .q-card { border-radius: 8px; padding: 10px 12px; border: 1.5px solid #e5e7eb; }
  .q-complete { border-color: #16a34a; background: #f0fdf4; }
  .q-current  { border-color: #2563eb; background: #eff6ff; }
  .q-future   { border-color: #d1d5db; background: #f9fafb; }
  @media print {
    body { padding: 15px 20px; font-size: 10pt; }
    h2 { page-break-before: auto; }
    .no-break { page-break-inside: avoid; }
    @page { margin: 15mm 15mm; }
  }
</style>
</head>
<body>

<h1>CT Computation — Supporting Schedule</h1>
<p class="meta">Prepared by Finlytics &nbsp;·&nbsp; <strong>${cs.companyName}</strong> &nbsp;·&nbsp; FY ${selectedFY} &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>

<div class="grid2">
  <div class="info-block"><dl>
    <dt>Company name</dt><dd>${cs.companyName || '—'}</dd>
    <dt>Company number</dt><dd>${cs.companyRegistrationNumber || '—'}</dd>
    <dt>UTR</dt><dd>${cs.utr || '—'}</dd>
    <dt>VAT number</dt><dd>${cs.vatRegistrationNumber || cs.vATNumber || '—'}</dd>
  </dl></div>
  <div class="info-block"><dl>
    <dt>Accounting period</dt><dd>${computation.fyStart.toLocaleDateString('en-GB')} – ${computation.fyEnd.toLocaleDateString('en-GB')}</dd>
    <dt>Incorporation date</dt><dd>${d2(cs.incorporationDate || cs.companyInceptionDate)}</dd>
    <dt>Registered address</dt><dd style="white-space:pre-line">${cs.companyAddress || cs.address || '—'}</dd>
  </dl></div>
</div>

<h2>CT600 Computation Waterfall</h2>
<table class="no-break">
<thead><tr><th>Item</th><th class="num">Amount</th></tr></thead>
<tbody>
${waterfallRows.map(([label, val, isTot]) =>
    `<tr class="${isTot ? 'highlight-row' : ''}"><td>${label}</td><td class="num">${f(val)}</td></tr>`
).join('')}
</tbody></table>
<p style="font-size:9pt;color:#6b7280;margin-bottom:18px">Effective rate: ${(computation.effectiveRate * 100).toFixed(2)}% — ${computation.rateLabel}</p>

<div class="deadline-grid no-break">
  <div class="deadline-card ${daysTo(ctPayDeadline) < 60 ? 'urgent' : 'warn'}">
    <div style="font-size:9pt;font-weight:600;margin-bottom:4px">🗓️ CT Payment deadline</div>
    <div style="font-size:14pt;font-weight:700">${ctPayDeadline.toLocaleDateString('en-GB')}</div>
    <div style="font-size:8.5pt">9 months + 1 day after period end</div>
    <div style="font-size:8.5pt;font-weight:600;margin-top:3px">${daysTo(ctPayDeadline) > 0 ? daysTo(ctPayDeadline) + ' days remaining' : '⚠️ Deadline passed'}</div>
  </div>
  <div class="deadline-card ${daysTo(ct600Deadline) < 60 ? 'urgent' : 'info'}">
    <div style="font-size:9pt;font-weight:600;margin-bottom:4px">📄 CT600 filing deadline</div>
    <div style="font-size:14pt;font-weight:700">${ct600Deadline.toLocaleDateString('en-GB')}</div>
    <div style="font-size:8.5pt">9 months + 1 day after period end</div>
    <div style="font-size:8.5pt;font-weight:600;margin-top:3px">${daysTo(ct600Deadline) > 0 ? daysTo(ct600Deadline) + ' days remaining' : '⚠️ Deadline passed'}</div>
  </div>
</div>

<h2>Income — Invoices (${computation.fyInvoices.length})</h2>
${computation.fyInvoices.length > 0 ? `
<table>
<thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Status</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Gross</th></tr></thead>
<tbody>
${computation.fyInvoices.map(i => `<tr>
  <td>${i.invoiceNumber}</td><td>${i.customerName || '—'}</td><td>${d2(i.dateIssued)}</td>
  <td><span class="badge badge-green">${i.status}</span></td>
  <td class="num">${f(i.amountNet)}</td><td class="num">${f(i.vatAmount)}</td><td class="num">${f(i.amountGross)}</td>
</tr>`).join('')}
<tr class="total-row"><td colspan="4">Total turnover</td><td class="num">${f(computation.turnover)}</td><td class="num"></td><td class="num"></td></tr>
</tbody></table>` : '<p class="nil">No invoices in this period.</p>'}

${computation.allowableExpenses.length > 0 ? `
<h2>Allowable Expenses (${computation.allowableExpenses.length})</h2>
<table>
<thead><tr><th>Date</th><th>Supplier</th><th>Category</th><th>Reference</th><th class="num">Net</th></tr></thead>
<tbody>${rowsHtml(computation.allowableExpenses.map(e => ({ date: e.entryDate, supplier: e.supplier || e.supplierFreeText, category: e.category, reference: e.reference, amountNet: e.amountNet })))}
<tr class="total-row"><td colspan="4">Total allowable expenses</td><td class="num">${f(computation.totalAllowable)}</td></tr>
</tbody></table>` : ''}

${computation.disallowableExpenses.length > 0 ? `
<h2>Disallowable Expenses — Add-backs (${computation.disallowableExpenses.length})</h2>
<table>
<thead><tr><th>Date</th><th>Supplier</th><th>Category</th><th>Reference</th><th class="num">Net</th></tr></thead>
<tbody>${rowsHtml(computation.disallowableExpenses.map(e => ({ date: e.entryDate, supplier: e.supplier || e.supplierFreeText, category: e.category, reference: e.reference, amountNet: e.amountNet })))}
<tr class="total-row"><td colspan="4">Total disallowable add-backs</td><td class="num">${f(computation.totalDisallowable)}</td></tr>
</tbody></table>` : ''}

${computation.fyDlaExpenses.length > 0 ? `
<h2>Director's Loan Account — Expense Entries (${computation.fyDlaExpenses.length})</h2>
<p style="font-size:9pt;color:#6b7280;margin-bottom:8px">Expenses paid personally by the director and recorded in the DLA (OwedToDirector). Revenue/Capital entries are deductible; Non-CT entries are added back.</p>
<table>
<thead><tr><th>Date</th><th>Description</th><th>Category</th><th>CT Tag</th><th class="num">Net</th></tr></thead>
<tbody>
${computation.fyDlaExpenses.map(d => {
    const isPreTrading = new Date(d.entryDate) < computation.fyStart;
    const tagBadge = d.ctTag === 'NonCT' ? 'badge-red' : d.ctTag === 'Capital' ? 'badge-purple' : 'badge-green';
    return `<tr>
      <td>${d2(d.entryDate)}${isPreTrading ? ' <span class="badge badge-blue">Pre-trading</span>' : ''}</td>
      <td>${d.description || '—'}</td>
      <td>${d.category || '—'}</td>
      <td><span class="badge ${tagBadge}">${d.ctTag || 'Revenue'}</span></td>
      <td class="num">${f(d.amountNet)}</td>
    </tr>`;
}).join('')}
<tr class="total-row"><td colspan="4">Total DLA allowable (Revenue + Capital)</td><td class="num">${f(computation.totalDlaAllowable + computation.totalDlaCapital)}</td></tr>
</tbody></table>` : ''}

${computation.fyPayroll.length > 0 ? `
<h2>Payroll (${computation.fyPayroll.length} run${computation.fyPayroll.length !== 1 ? 's' : ''})</h2>
<table>
<thead><tr><th>Period start</th><th>Period end</th><th>Pay date</th><th class="num">Gross</th><th class="num">Employer NI</th><th class="num">Total cost</th></tr></thead>
<tbody>
${computation.fyPayroll.map(r => `<tr><td>${d2(r.periodStart)}</td><td>${d2(r.periodEnd)}</td><td>${d2(r.payDate)}</td><td class="num">${f(r.totalGross)}</td><td class="num">${f(r.totalEmployerNi)}</td><td class="num">${f((r.totalGross ?? 0) + (r.totalEmployerNi ?? 0))}</td></tr>`).join('')}
<tr class="total-row"><td colspan="5">Total payroll costs</td><td class="num">${f(computation.totalPayroll)}</td></tr>
</tbody></table>` : ''}

${computation.fyAssets.length > 0 ? `
<h2>Capital Allowances — Annual Investment Allowance</h2>
<table>
<thead><tr><th>Asset ID</th><th>Description</th><th>Category</th><th>Purchase date</th><th class="num">Cost</th></tr></thead>
<tbody>
${computation.fyAssets.map(a => `<tr><td>${a.assetId || '—'}</td><td>${a.name || '—'}</td><td>${a.category || '—'}</td><td>${d2(a.purchaseDate)}</td><td class="num">${f(a.purchasePrice)}</td></tr>`).join('')}
<tr class="total-row"><td colspan="4">Total cost</td><td class="num">${f(computation.totalAssetCost)}</td></tr>
<tr class="total-row"><td colspan="4">AIA claimed (max £1,000,000)${computation.aiaCapped ? ' ⚠️ Capped' : ''}</td><td class="num">${f(computation.aiaAllowance)}</td></tr>
</tbody></table>
<p style="font-size:9pt;color:#6b7280">Note: Cars are generally excluded from AIA. Confirm asset eligibility with accountant.</p>` : ''}

${computation.s455Entries.length > 0 ? `
<h2>S.455 Analysis — Director's Loan (Owed to Company)</h2>
<p style="font-size:9pt;color:#6b7280;margin-bottom:8px">33.75% charge on outstanding director's loan balances as at ${computation.fyEnd.toLocaleDateString('en-GB')}. Repayable if loan is repaid within 9 months of period end.</p>
<table>
<thead><tr><th>DLA reference</th><th>Description</th><th>Entry date</th><th class="num">Outstanding</th><th class="num">S.455 @ 33.75%</th></tr></thead>
<tbody>
${computation.s455Entries.map(d => `<tr><td>${d.dlaId}</td><td>${d.description || '—'}</td><td>${d2(d.entryDate)}</td><td class="num">${f(d.remainingBalance)}</td><td class="num">${f((d.remainingBalance ?? 0) * 0.3375)}</td></tr>`).join('')}
<tr class="total-row"><td colspan="3">Total S.455 charge (Box 480)</td><td class="num">${f(computation.totalS455Base)}</td><td class="num">${f(computation.s455Charge)}</td></tr>
</tbody></table>
<p style="font-size:9pt;color:#6b7280">S.455 due by: <strong>${computation.s455DueDate?.toLocaleDateString('en-GB')}</strong></p>` : ''}

${computation.fyDividends.length > 0 ? `
<h2>Dividends Declared / Paid (${computation.fyDividends.length})</h2>
<p style="font-size:9pt;color:#6b7280;margin-bottom:8px">Dividends are <strong>not CT-deductible</strong> — they are paid from post-tax distributable reserves. Included here so your accountant can verify retained earnings and confirm sufficient distributable profits existed at the time of each declaration.</p>
<table>
<thead><tr><th>Ref</th><th>Type</th><th>Share class</th><th>Meeting date</th><th>Payment date</th><th>Status</th><th class="num">Per share</th><th class="num">Total paid</th></tr></thead>
<tbody>
${computation.fyDividends.map(d => `<tr>
  <td>${d.dividendRef || '—'}</td><td>${d.dividendType || '—'}</td><td>${d.shareClass || '—'}</td>
  <td>${d2(d.meetingDate)}</td><td>${d2(d.paymentDate)}</td>
  <td><span class="badge badge-green">${d.status}</span></td>
  <td class="num">${f(d.amountPerShare)}</td><td class="num">${f(d.totalAmount)}</td>
</tr>`).join('')}
<tr class="total-row"><td colspan="7">Total dividends paid</td><td class="num">${f(computation.totalDividendsPaid)}</td></tr>
</tbody></table>` : ''}

${computation.fyMileage.length > 0 ? `
<h2>Mileage Claims — AMAP (${computation.fyMileage.length} trips)</h2>
<p style="font-size:9pt;color:#6b7280;margin-bottom:8px">HMRC Approved Mileage Allowance Payments reimbursed by the company. These are allowable business travel expenses. If any trips were also recorded in the DLA they may need de-duplicating — confirm with accountant.</p>
<table>
<thead><tr><th>Trip ID</th><th>Director</th><th>Date</th><th>From → To</th><th>Purpose</th><th class="num">Miles</th><th class="num">Amount</th></tr></thead>
<tbody>
${computation.fyMileage.map(t => `<tr>
  <td>${t.tripId || '—'}</td><td>${t.director || '—'}</td><td>${d2(t.tripDate)}</td>
  <td>${t.startLocation || '—'} → ${t.endLocation || '—'}</td>
  <td>${t.purpose || '—'}</td>
  <td class="num">${t.miles ?? '—'}</td><td class="num">${f(t.totalAmount)}</td>
</tr>`).join('')}
<tr class="total-row"><td colspan="5">Totals</td><td class="num">${computation.totalMileageMiles.toFixed(1)}</td><td class="num">${f(computation.totalMileageAmount)}</td></tr>
</tbody></table>` : ''}

${computation.fyVatReturns.length > 0 ? `
<h2>VAT Returns (${computation.fyVatReturns.length} quarter${computation.fyVatReturns.length !== 1 ? 's' : ''})</h2>
<p style="font-size:9pt;color:#6b7280;margin-bottom:8px">VAT quarters with start dates falling within this accounting period. Reconcile Box 6 (net sales declared to HMRC, approx. VAT-in ÷ VAT rate) against the turnover figure above.</p>
<table>
<thead><tr><th>Quarter</th><th>Period</th><th>Filed</th><th>HMRC Ref</th><th class="num">VAT on sales</th><th class="num">VAT reclaimed</th><th class="num">Net owed</th></tr></thead>
<tbody>
${computation.fyVatReturns.map(v => `<tr>
  <td>${v.quarterLabel || '—'}</td>
  <td>${d2(v.quarterStartDate)} – ${d2(v.quarterEndDate)}</td>
  <td>${d2(v.filedDate)}</td><td>${v.reference || '—'}</td>
  <td class="num">${f(v.vatIn)}</td><td class="num">${f(v.vatOut)}</td>
  <td class="num" style="font-weight:600;color:${(v.vatOwed ?? 0) > 0 ? '#c2410c' : '#16a34a'}">${f(v.vatOwed)}</td>
</tr>`).join('')}
<tr class="total-row"><td colspan="4">Totals</td><td class="num">${f(computation.totalVatIn)}</td><td class="num">${f(computation.totalVatOut)}</td><td class="num">${f(computation.totalVatOwed)}</td></tr>
</tbody></table>` : ''}

<h2>Quarterly Breakdown (MTD for CT)</h2>
<div class="quarter-grid no-break">
${computation.quarters.map(q => `
  <div class="q-card ${q.status === 'complete' ? 'q-complete' : q.status === 'current' ? 'q-current' : 'q-future'}">
    <div style="font-weight:700;font-size:10.5pt">Q${q.q} ${q.status === 'complete' ? '✅' : q.status === 'current' ? '🔵' : '⬜'}</div>
    <div style="font-size:8pt;color:#6b7280;margin-bottom:6px">${q.qStart.toLocaleDateString('en-GB')} – ${q.qEnd.toLocaleDateString('en-GB')}</div>
    <table style="margin:0"><tbody>
      <tr><td>Income</td><td class="num">${f(q.qTurnover)}</td></tr>
      <tr><td>Taxable profit</td><td class="num">${f(Math.max(0, q.qTaxable))}</td></tr>
      <tr><td>Est. CT</td><td class="num">${f(q.qCT)}</td></tr>
    </tbody></table>
  </div>`).join('')}
</div>

<div class="notice">
  <strong>⚠️ Important notice:</strong> This document is an <em>estimate</em> prepared from data entered in Finlytics and does not constitute formal tax advice or a completed CT600 return. It should be reviewed by a qualified accountant before filing. Capital allowances assume 100% AIA — eligibility varies by asset type (cars are generally excluded). S.455 charges are indicative. Accounting periods shorter or longer than 12 months require pro-rated calculations.
</div>

</body></html>`;

        const win = window.open('', '_blank');
        if (win) {
            win.document.write(html);
            win.document.close();
        } else {
            showToast('Pop-up blocked — please allow pop-ups for this site', 'error');
        }
    }

    function expToRow(e) {
        return {
            date: e.entryDate, supplier: e.supplier || e.supplierFreeText,
            category: e.category, reference: e.reference, amountNet: e.amountNet,
        };
    }

    // ---- Render ----

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <div style={{ textAlign: 'center', color: '#6b7280' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                    <p>Loading financial data…</p>
                </div>
            </div>
        );
    }

    return (
        <div>

            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', top: 16, right: 16, zIndex: 9999,
                    padding: '0.75rem 1.25rem', borderRadius: 8, fontWeight: 600,
                    background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`,
                    color: toast.type === 'error' ? '#dc2626' : '#16a34a',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                }}>
                    {toast.type === 'error' ? '❌ ' : '✅ '}{toast.message}
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#1a1a2e' }}>📊 CT Computation</h2>
                    <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                        Corporation Tax estimate for <strong>{companySettings?.companyName || 'your company'}</strong>
                        {computation && (
                            <span style={{ marginLeft: 8, color: '#9ca3af' }}>
                                · {computation.fyStart.toLocaleDateString('en-GB')} – {computation.fyEnd.toLocaleDateString('en-GB')}
                                <span style={{ marginLeft: 6, background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600 }}>Company accounting period</span>
                            </span>
                        )}
                    </p>
                    {companySettings && !companySettings.fYStartMonth && !companySettings.fyStartMonth && (
                        <p style={{ margin: '0.25rem 0 0', color: '#b45309', fontSize: '0.78rem' }}>
                            ⚠️ FY start date not configured — using 1 April as default. Set your company's accounting period start in <strong>Company Settings</strong> to match your Companies House ARD.
                        </p>
                    )}
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
                        onClick={printReport}
                        disabled={!computation}
                        title="Opens a printable CT600 supporting report in a new tab — use File › Print › Save as PDF"
                        style={{
                            padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
                            background: '#1565C0', color: '#fff',
                            cursor: computation ? 'pointer' : 'not-allowed',
                            fontSize: '0.875rem', fontWeight: 600, opacity: computation ? 1 : 0.5,
                        }}
                    >
                        🖨️ Print CT Report
                    </button>
                    <button
                        onClick={exportForAccountant}
                        disabled={!computation}
                        title="Downloads a full JSON data package for accountant software"
                        style={{
                            padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid #d1d5db',
                            background: '#fff', color: '#374151',
                            cursor: computation ? 'pointer' : 'not-allowed',
                            fontSize: '0.875rem', fontWeight: 500, opacity: computation ? 1 : 0.5,
                        }}
                    >
                        ⬇️ Export JSON
                    </button>
                    <button
                        onClick={loadData}
                        style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}
                        title="Refresh data"
                    >🔄</button>
                </div>
            </div>

            {!computation ? (
                <div className="card" style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                    <p>Select a financial year to view the CT computation.</p>
                </div>
            ) : (
                <>
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        <SummaryCard
                            label="Turnover" value={fmt(computation.turnover)}
                            color="#3b82f6" icon="💰"
                            sub={`${computation.fyInvoices.length} invoice${computation.fyInvoices.length !== 1 ? 's' : ''}`}
                        />
                        <SummaryCard
                            label="Taxable Profit" value={fmt(Math.max(0, computation.taxableProfit))}
                            color={computation.taxableProfit <= 0 ? '#16a34a' : '#f59e0b'} icon="📈"
                            sub={computation.taxableProfit <= 0 ? 'Loss — no CT due' : 'After all adjustments'}
                        />
                        <SummaryCard
                            label="CT Rate" value={computation.taxableProfit > 0 ? pct(computation.effectiveRate) : 'N/A'}
                            color="#8b5cf6" icon="📋"
                            sub={computation.rateLabel}
                        />
                        <SummaryCard
                            label="CT Due" value={fmt(computation.ctLiability)}
                            color="#ef4444" icon="🏦"
                            sub="Estimated liability"
                            highlight={computation.ctLiability > 0}
                        />
                        {computation.s455Charge > 0 && (
                            <SummaryCard
                                label="S.455 Charge" value={fmt(computation.s455Charge)}
                                color="#f97316" icon="⚠️"
                                sub={`Due by ${computation.s455DueDate.toLocaleDateString('en-GB')}`}
                                highlight
                            />
                        )}
                    </div>

                    {/* CT Computation Waterfall */}
                    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: '1.5rem' }}>
                        <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>📐 CT Computation — FY {selectedFY}</h3>
                            <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Accruals basis</span>
                        </div>
                        <div style={{ padding: '1rem 1.25rem' }}>
                            <WaterfallRow label="Turnover" value={computation.turnover} fmt={fmt} bold />
                            <WaterfallRow label="Less: Allowable expenses" value={-computation.totalAllowable} fmt={fmt} indent />
                            {computation.totalDlaAllowable > 0 && (
                                <WaterfallRow label="Less: Director's expenses via DLA (allowable)" value={-computation.totalDlaAllowable} fmt={fmt} indent />
                            )}
                            {computation.totalDlaCapital > 0 && (
                                <WaterfallRow label="Less: Director's capital items via DLA" value={-computation.totalDlaCapital} fmt={fmt} indent />
                            )}
                            <WaterfallRow label="Less: Payroll costs (gross wages + employer NI)" value={-computation.totalPayroll} fmt={fmt} indent />
                            <WaterfallRow label="Less: Capital allowances (AIA)" value={-computation.aiaAllowance} fmt={fmt} indent />
                            <div style={{ borderTop: '1px solid #e5e7eb', margin: '0.5rem 0' }} />
                            <WaterfallRow label="Adjusted trading profit" value={computation.adjustedProfit} fmt={fmt} bold />
                            {(computation.totalDisallowable + computation.totalDlaDisallowable) > 0 && (
                                <WaterfallRow label="Add: Disallowable add-backs (incl. DLA)" value={computation.totalDisallowable + computation.totalDlaDisallowable} fmt={fmt} indent />
                            )}
                            <div style={{ borderTop: '1px solid #e5e7eb', margin: '0.5rem 0' }} />
                            <WaterfallRow label="Taxable profit" value={Math.max(0, computation.taxableProfit)} fmt={fmt} bold highlighted />
                            <div style={{ margin: '0.5rem 0' }} />
                            <WaterfallRow label={`Corporation Tax — ${computation.rateLabel}`} value={computation.ctLiability} fmt={fmt} bold tax />
                            {computation.s455Charge > 0 && (
                                <WaterfallRow label="S.455 charge on director's loan" value={computation.s455Charge} fmt={fmt} bold tax />
                            )}
                            <div style={{ borderTop: '2px solid #1a1a2e', margin: '0.75rem 0' }} />
                            <WaterfallRow label="Total estimated tax" value={computation.totalTaxBill} fmt={fmt} bold total />
                        </div>
                    </div>

                    {/* ---- Detail Sections ---- */}

                    <DetailSection
                        title={`💰 Income — ${computation.fyInvoices.length} invoice${computation.fyInvoices.length !== 1 ? 's' : ''}`}
                        expanded={expandedSections.income}
                        onToggle={() => toggleSection('income')}
                        total={fmt(computation.turnover)}
                    >
                        {computation.fyInvoices.length > 0 ? (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f9fafb' }}>
                                        <th style={thStyle}>Invoice #</th>
                                        <th style={thStyle}>Customer</th>
                                        <th style={thStyle}>Date Issued</th>
                                        <th style={thStyle}>Status</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Net</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {computation.fyInvoices.map(inv => (
                                        <tr key={inv.invoiceNumber}>
                                            <td style={tdStyle}><strong>{inv.invoiceNumber}</strong></td>
                                            <td style={tdStyle}>{inv.customerName}</td>
                                            <td style={tdStyle}>{new Date(inv.dateIssued).toLocaleDateString('en-GB')}</td>
                                            <td style={tdStyle}>
                                                <span style={{
                                                    padding: '2px 8px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 500,
                                                    background: inv.status === 'Paid' ? '#d1fae5' : inv.status === 'Overdue' ? '#fee2e2' : '#fef3c7',
                                                    color:      inv.status === 'Paid' ? '#065f46' : inv.status === 'Overdue' ? '#991b1b'  : '#92400e',
                                                }}>
                                                    {inv.status}
                                                </span>
                                            </td>
                                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmt(inv.amountNet)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: '0.25rem 0' }}>No invoices found for FY {selectedFY}.</p>
                        )}
                    </DetailSection>

                    <DetailSection
                        title={`✅ Allowable Expenses — ${computation.allowableExpenses.length} item${computation.allowableExpenses.length !== 1 ? 's' : ''}`}
                        expanded={expandedSections.allowable}
                        onToggle={() => toggleSection('allowable')}
                        total={fmt(computation.totalAllowable)}
                    >
                        <ExpenseTable expenses={computation.allowableExpenses} fmt={fmt} />
                        {computation.allowableExpenses.length === 0 && (
                            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: '0.25rem 0' }}>No allowable expenses for FY {selectedFY}.</p>
                        )}
                    </DetailSection>

                    <DetailSection
                        title={`🏦 Director's Expenses via DLA — ${computation.fyDlaExpenses.length} item${computation.fyDlaExpenses.length !== 1 ? 's' : ''}`}
                        expanded={expandedSections.dlaExpenses}
                        onToggle={() => toggleSection('dlaExpenses')}
                        total={fmt(computation.totalDlaAllowable + computation.totalDlaCapital)}
                    >
                        <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.75rem', lineHeight: 1.6 }}>
                            Expenses paid personally by the director and recorded in the DLA (<em>OwedToDirector</em>). CT-tagged
                            as <strong>Revenue</strong> or <strong>Capital</strong> entries are deductible; <strong>Non-CT</strong> entries are added back.
                            {computation.fyDlaExpenses.some(d => new Date(d.entryDate) < computation.fyStart) && (
                                <span style={{ display: 'block', marginTop: '0.35rem', color: '#1d4ed8' }}>
                                    💡 <strong>Pre-trading startup costs</strong> incurred before the first accounting period are included here
                                    and treated as deductible on the first day of trading (CTA 2009 s.61).
                                </span>
                            )}
                        </p>
                        {computation.fyDlaExpenses.length > 0 ? (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f9fafb' }}>
                                        <th style={thStyle}>Date</th>
                                        <th style={thStyle}>Description</th>
                                        <th style={thStyle}>Category</th>
                                        <th style={thStyle}>CT Tag</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Net Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {computation.fyDlaExpenses.map((d, i) => {
                                        const isPreTrading = new Date(d.entryDate) < computation.fyStart;
                                        return (
                                            <tr key={d.dlaId || i} style={{ background: isPreTrading ? '#eff6ff' : 'transparent' }}>
                                                <td style={tdStyle}>
                                                    {new Date(d.entryDate).toLocaleDateString('en-GB')}
                                                    {isPreTrading && (
                                                        <span style={{ display: 'block', fontSize: '0.68rem', color: '#1d4ed8', fontWeight: 600 }}>Pre-trading</span>
                                                    )}
                                                </td>
                                                <td style={tdStyle}>{d.description || '—'}</td>
                                                <td style={tdStyle}>{d.category || '—'}</td>
                                                <td style={tdStyle}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
                                                        background: d.ctTag === 'NonCT' ? '#fee2e2' : d.ctTag === 'Capital' ? '#ede9fe' : '#d1fae5',
                                                        color:      d.ctTag === 'NonCT' ? '#991b1b' : d.ctTag === 'Capital' ? '#5b21b6' : '#065f46',
                                                    }}>
                                                        {d.ctTag || 'Revenue'}
                                                    </span>
                                                </td>
                                                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500,
                                                    color: d.ctTag === 'NonCT' ? '#9ca3af' : 'inherit' }}>
                                                    {fmt(d.amountNet)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: '0.25rem 0' }}>No DLA expense entries for FY {selectedFY}.</p>
                        )}
                    </DetailSection>

                    <DetailSection
                        title={`💼 Payroll Costs — ${computation.fyPayroll.length} run${computation.fyPayroll.length !== 1 ? 's' : ''}`}
                        expanded={expandedSections.payroll}
                        onToggle={() => toggleSection('payroll')}
                        total={fmt(computation.totalPayroll)}
                    >
                        {computation.fyPayroll.length > 0 ? (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f9fafb' }}>
                                        <th style={thStyle}>Pay Period</th>
                                        <th style={thStyle}>Pay Date</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Gross Wages</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Employer NI</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Total Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {computation.fyPayroll.map(run => (
                                        <tr key={run.id}>
                                            <td style={tdStyle}>
                                                {new Date(run.periodStart).toLocaleDateString('en-GB')} – {new Date(run.periodEnd).toLocaleDateString('en-GB')}
                                            </td>
                                            <td style={tdStyle}>{run.payDate ? new Date(run.payDate).toLocaleDateString('en-GB') : '—'}</td>
                                            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(run.totalGross)}</td>
                                            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(run.totalEmployerNi)}</td>
                                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                                                {fmt((run.totalGross ?? 0) + (run.totalEmployerNi ?? 0))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: '0.25rem 0' }}>No posted payroll runs found for FY {selectedFY}.</p>
                        )}
                    </DetailSection>

                    <DetailSection
                        title={`🏭 Capital Allowances (AIA) — ${computation.fyAssets.length} asset${computation.fyAssets.length !== 1 ? 's' : ''}`}
                        expanded={expandedSections.capital}
                        onToggle={() => toggleSection('capital')}
                        total={fmt(computation.aiaAllowance)}
                    >
                        {computation.fyAssets.length > 0 ? (
                            <>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f9fafb' }}>
                                            <th style={thStyle}>Asset ID</th>
                                            <th style={thStyle}>Name</th>
                                            <th style={thStyle}>Category</th>
                                            <th style={thStyle}>Purchase Date</th>
                                            <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {computation.fyAssets.map(a => (
                                            <tr key={a.assetId || a.id}>
                                                <td style={tdStyle}>{a.assetId}</td>
                                                <td style={tdStyle}>{a.name}</td>
                                                <td style={tdStyle}>{a.category}</td>
                                                <td style={tdStyle}>{a.purchaseDate ? new Date(a.purchaseDate).toLocaleDateString('en-GB') : '—'}</td>
                                                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>{fmt(a.purchasePrice)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {computation.aiaCapped && (
                                    <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#fef3c7', borderRadius: 6, fontSize: '0.8rem', color: '#92400e' }}>
                                        ⚠️ Total asset cost ({fmt(computation.totalAssetCost)}) exceeds the £1,000,000 AIA cap. Allowance is capped at £1,000,000.
                                    </div>
                                )}
                            </>
                        ) : (
                            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: '0.25rem 0' }}>No assets purchased in FY {selectedFY}.</p>
                        )}
                    </DetailSection>

                    {(computation.disallowableExpenses.length + computation.dlaDisallowable.length) > 0 && (
                        <DetailSection
                            title={`❌ Disallowable Add-backs — ${computation.disallowableExpenses.length + computation.dlaDisallowable.length} item${(computation.disallowableExpenses.length + computation.dlaDisallowable.length) !== 1 ? 's' : ''}`}
                            expanded={expandedSections.addback}
                            onToggle={() => toggleSection('addback')}
                            total={fmt(computation.totalDisallowable + computation.totalDlaDisallowable)}
                            warning
                        >
                            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.75rem', lineHeight: 1.6 }}>
                                These expenses are tagged <strong>Non-CT deductible</strong> and are added back to profit (e.g. client entertainment, personal expenditure, non-business DLA items).
                            </p>
                            <ExpenseTable expenses={computation.disallowableExpenses} fmt={fmt} />
                            {computation.dlaDisallowable.length > 0 && (
                                <>
                                    {computation.disallowableExpenses.length > 0 && <div style={{ borderTop: '1px solid #f3f4f6', margin: '0.5rem 0' }} />}
                                    <p style={{ fontSize: '0.78rem', color: '#92400e', fontWeight: 600, margin: '0.5rem 0 0.25rem' }}>From Director's Loan Account:</p>
                                    {computation.dlaDisallowable.map((d, i) => (
                                        <div key={d.dlaId || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: '0.85rem', borderBottom: '1px solid #f9fafb' }}>
                                            <span style={{ color: '#6b7280' }}>{new Date(d.entryDate).toLocaleDateString('en-GB')} · {d.description || d.category || '—'}</span>
                                            <span style={{ fontWeight: 500, color: '#9ca3af' }}>{fmt(d.amountNet)}</span>
                                        </div>
                                    ))}
                                </>
                            )}
                        </DetailSection>
                    )}

                    {computation.s455Entries.length > 0 && (
                        <DetailSection
                            title="⚠️ Section 455 — Director's Loan Account"
                            expanded={expandedSections.dla}
                            onToggle={() => toggleSection('dla')}
                            total={fmt(computation.s455Charge)}
                            warning
                        >
                            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.75rem', lineHeight: 1.6 }}>
                                S.455 tax at <strong>33.75%</strong> applies to loans owed to the company that remain outstanding
                                9 months and 1 day after the accounting period ends (<strong>{computation.s455DueDate.toLocaleDateString('en-GB')}</strong>).
                                This charge is <em>repayable</em> to the company once the director repays the loan.
                            </p>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#fff7ed' }}>
                                        <th style={thStyle}>DLA Reference</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Outstanding Balance</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>S.455 @ 33.75%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {computation.s455Entries.map(d => (
                                        <tr key={d.dlaId}>
                                            <td style={tdStyle}>{d.dlaId}</td>
                                            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(d.remainingBalance)}</td>
                                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#c2410c' }}>
                                                {fmt((d.remainingBalance ?? 0) * 0.3375)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </DetailSection>
                    )}

                    {/* ── Quarterly Progress & MTD Overview ── */}
                    {(() => {
                        const now = new Date();
                        const fyIsCurrentOrPast = now >= computation.fyStart;
                        if (!fyIsCurrentOrPast) return null;

                        const ctPayDeadline  = (() => { const d = new Date(computation.fyEnd); d.setMonth(d.getMonth() + 9); d.setDate(d.getDate() + 2); return d; })();
                        const ct600Deadline  = (() => { const d = new Date(computation.fyEnd); d.setMonth(d.getMonth() + 9); d.setDate(d.getDate() + 2); return d; })();
                        const fyComplete     = now > computation.fyEnd;
                        const daysToPayment  = Math.ceil((ctPayDeadline - now) / 86400000);
                        const daysToCT600    = Math.ceil((ct600Deadline  - now) / 86400000);

                        const qColour = (q) => q.status === 'complete' ? '#16a34a' : q.status === 'current' ? '#2563eb' : '#d1d5db';
                        const qBg     = (q) => q.status === 'complete' ? '#f0fdf4' : q.status === 'current' ? '#eff6ff' : '#f9fafb';
                        const qLabel  = (q) => q.status === 'complete' ? '✅ Complete' : q.status === 'current' ? '🔵 In progress' : '⬜ Future';

                        return (
                            <div style={{ marginBottom: '1rem' }}>
                                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1a1a2e', margin: '0 0 0.75rem' }}>
                                    📅 Quarterly Progress {fyComplete ? '' : `— ${computation.quartersElapsed} of 4 quarter${computation.quartersElapsed !== 1 ? 's' : ''} elapsed`}
                                </h3>

                                {/* Quarter cards */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                    {computation.quarters.map(q => (
                                        <div key={q.q} style={{
                                            border: `1.5px solid ${qColour(q)}`,
                                            background: qBg(q),
                                            borderRadius: 10, padding: '0.875rem 1rem',
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: qColour(q) }}>Q{q.q}</span>
                                                <span style={{ fontSize: '0.7rem', color: qColour(q), fontWeight: 600 }}>{qLabel(q)}</span>
                                            </div>
                                            <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                                                {q.qStart.toLocaleDateString('en-GB')} – {q.qEnd.toLocaleDateString('en-GB')}
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                                <span style={{ color: '#374151' }}>Income</span>
                                                <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{fmt(q.qTurnover)}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                                <span style={{ color: '#374151' }}>Taxable profit</span>
                                                <span style={{ fontWeight: 600, color: q.qTaxable > 0 ? '#b45309' : '#16a34a' }}>{fmt(Math.max(0, q.qTaxable))}</span>
                                            </div>
                                            {q.status !== 'future' && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginTop: '0.2rem', paddingTop: '0.3rem', borderTop: '1px solid #e5e7eb' }}>
                                                    <span style={{ color: '#374151' }}>Est. CT</span>
                                                    <span style={{ fontWeight: 700, color: '#ef4444' }}>{fmt(q.qCT)}</span>
                                                </div>
                                            )}
                                            {q.invoiceCount > 0 && (
                                                <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: '0.3rem' }}>
                                                    {q.invoiceCount} invoice{q.invoiceCount !== 1 ? 's' : ''}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* YTD summary + projection row */}
                                {!fyComplete && computation.quartersElapsed > 0 && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                        <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '0.75rem 1rem' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400e', marginBottom: 2 }}>📊 YTD Turnover</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#78350f' }}>{fmt(computation.ytdTurnover)}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#92400e' }}>Quarters 1–{computation.quartersElapsed} only</div>
                                        </div>
                                        <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '0.75rem 1rem' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400e', marginBottom: 2 }}>📈 Run-rate Projection</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#78350f' }}>{fmt(computation.projectedTaxable)}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#92400e' }}>Estimated full-year taxable profit</div>
                                        </div>
                                        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.75rem 1rem' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#c2410c', marginBottom: 2 }}>🏦 Projected CT Liability</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#9a3412' }}>{fmt(computation.projectedCT)}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#c2410c' }}>Based on current run-rate</div>
                                        </div>
                                    </div>
                                )}

                                {/* MTD for CT note */}
                                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#0369a1', lineHeight: 1.6 }}>
                                    <strong>ℹ️ Making Tax Digital for Corporation Tax (MTD for CT)</strong><br />
                                    HMRC plans to require quarterly digital updates for companies with turnover &gt;£50k from April 2026.
                                    These figures represent your quarterly income &amp; expense position as recorded in Finlytics — ready for when
                                    your accountant needs to submit each update. Quarterly instalment payments (QIPs) only apply to large
                                    companies with annual taxable profits above £1.5m.
                                </div>

                                {/* Key deadlines */}
                                {computation.taxableProfit > 0 && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                                        {[
                                            {
                                                label: '🗓️ CT Payment Deadline',
                                                date: ctPayDeadline,
                                                desc: '9 months + 1 day after period end',
                                                daysLeft: daysToPayment,
                                                bg: daysToPayment < 60 ? '#fef2f2' : '#fef3c7',
                                                border: daysToPayment < 60 ? '#fca5a5' : '#fde68a',
                                                text: daysToPayment < 60 ? '#991b1b' : '#92400e',
                                            },
                                            {
                                                label: '📄 CT600 Filing Deadline',
                                                date: ct600Deadline,
                                                desc: '9 months + 1 day after period end',
                                                daysLeft: daysToCT600,
                                                bg: daysToCT600 < 60 ? '#fef2f2' : '#eff6ff',
                                                border: daysToCT600 < 60 ? '#fca5a5' : '#bfdbfe',
                                                text: daysToCT600 < 60 ? '#991b1b' : '#1e40af',
                                            },
                                        ].map(({ label, date, desc, daysLeft, bg, border, text }) => (
                                            <div key={label} style={{ padding: '0.875rem 1rem', background: bg, borderRadius: 8, border: `1px solid ${border}` }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: text, marginBottom: '0.25rem' }}>{label}</div>
                                                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: text }}>{date.toLocaleDateString('en-GB')}</div>
                                                <div style={{ fontSize: '0.75rem', color: text, opacity: 0.85 }}>{desc}</div>
                                                {daysLeft > 0
                                                    ? <div style={{ fontSize: '0.75rem', fontWeight: 600, color: text, marginTop: '0.2rem' }}>
                                                          {daysLeft < 60 ? '⚠️ ' : ''}{daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
                                                      </div>
                                                    : <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', marginTop: '0.2rem' }}>⚠️ Deadline passed</div>
                                                }
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Disclaimer */}
                    <div style={{
                        marginTop: '0.75rem', padding: '1rem 1.25rem',
                        background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb',
                        fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.7,
                    }}>
                        <strong>⚠️ Important notice:</strong> This is an <em>estimate</em> based on data entered in Finlytics and does not
                        constitute formal tax advice. It should be reviewed by a qualified accountant before filing. Capital allowances
                        assume 100% AIA — eligibility varies by asset type (cars are generally excluded). Disallowable items should be
                        reviewed carefully. S.455 charges are based on current outstanding DLA balances and are indicative only.
                        Accounting periods shorter or longer than 12 months require pro-rated calculations.
                    </div>
                </>
            )}
        </div>
    );
}

// ============================================================
// Tabbed Reports Wrapper (default export)
// ============================================================
const TABS = [
    { key: 'ct',       label: '🏛️ CT Report',       icon: '🏛️' },
    { key: 'ct600',    label: '📄 CT600 Form',      icon: '📄' },
    { key: 'yearend',  label: '📦 Year-End Pack',   icon: '📦' },
    { key: 'pnl',      label: '📊 Profit & Loss',    icon: '📊' },
    { key: 'bs',       label: '🏦 Balance Sheet',    icon: '🏦' },
    { key: 'debtors',  label: '⏰ Aged Debtors',     icon: '⏰' },
];

export default function Reports() {
    const [activeTab, setActiveTab] = useState('ct');

    return (
        <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
            {/* Tab Bar */}
            <div style={{
                display: 'flex', gap: '0.25rem', marginBottom: '1.5rem',
                borderBottom: '2px solid #e5e7eb', paddingBottom: 0,
                overflowX: 'auto',
            }}>
                {TABS.map(tab => {
                    const active = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                padding: '0.65rem 1.25rem',
                                border: 'none',
                                borderBottom: active ? '3px solid #3b82f6' : '3px solid transparent',
                                background: active ? '#eff6ff' : 'transparent',
                                color: active ? '#1d4ed8' : '#6b7280',
                                fontWeight: active ? 700 : 500,
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                borderRadius: '8px 8px 0 0',
                                transition: 'all 0.15s ease',
                                whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => { if (!active) e.target.style.background = '#f3f4f6'; }}
                            onMouseLeave={e => { if (!active) e.target.style.background = 'transparent'; }}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <Suspense fallback={
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
                    <div style={{ textAlign: 'center', color: '#6b7280' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                        <p>Loading report…</p>
                    </div>
                </div>
            }>
                {activeTab === 'ct'      && <CTReport />}
                {activeTab === 'ct600'   && <CT600Form />}
                {activeTab === 'yearend' && <YearEndPack />}
                {activeTab === 'pnl'     && <ProfitAndLoss />}
                {activeTab === 'bs'      && <BalanceSheet />}
                {activeTab === 'debtors' && <AgedDebtors />}
            </Suspense>
        </div>
    );
}