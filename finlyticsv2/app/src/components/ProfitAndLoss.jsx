import React, { useEffect, useState, useMemo } from 'react';
import { getProfitAndLoss, getCompanySettings } from '../services/apiService';

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n ?? 0);

function fyLabel(startYear) { return `${startYear}/${String(startYear + 1).slice(-2)}`; }

function buildAvailableYears(settings) {
    if (!settings) return [];
    const fyStartMonth = settings.fyStartMonth ?? settings.fYStartMonth ?? 4;
    const fyStartDay = settings.fyStartDay ?? settings.fYStartDay ?? 1;
    const inceptionRaw = settings.incorporationDate || settings.companyInceptionDate;
    const inception = inceptionRaw ? new Date(inceptionRaw) : new Date(new Date().getFullYear() - 3, 0, 1);
    let y = inception.getFullYear();
    if (new Date(y, fyStartMonth - 1, fyStartDay) > inception) y--;
    const now = new Date();
    const years = [];
    while (true) {
        const start = new Date(y, fyStartMonth - 1, fyStartDay);
        if (start > now) break;
        years.push(fyLabel(y));
        y++;
    }
    return years.reverse();
}

/* ── Shared row component ── */
function PLRow({ label, value, bold, indent, highlight, negative, divider, total }) {
    const isNeg = (value ?? 0) < 0 || negative;
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: `${divider ? '0.5rem' : '0.35rem'} ${(highlight || total) ? '0.75rem' : '0'}`,
            paddingLeft: indent ? '1.5rem' : ((highlight || total) ? '0.75rem' : 0),
            fontWeight: bold || total ? 700 : 400,
            fontSize: total ? '1.05rem' : '0.9rem',
            color: total ? '#1a1a2e' : isNeg ? '#dc2626' : '#374151',
            background: highlight ? '#eff6ff' : total ? '#f0f4ff' : 'transparent',
            borderRadius: (highlight || total) ? 6 : 0,
            borderTop: divider ? '1px solid #e5e7eb' : 'none',
            marginTop: divider ? '0.35rem' : 0,
            marginBottom: 2,
        }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {value !== undefined ? fmt(Math.abs(value ?? 0)) : ''}
            </span>
        </div>
    );
}

function Card({ title, icon, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{
            background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
            marginBottom: '0.875rem', overflow: 'hidden',
        }}>
            <div onClick={() => setOpen(o => !o)} style={{
                padding: '0.875rem 1.25rem', cursor: 'pointer', background: '#f9fafb',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: open ? '1px solid #e5e7eb' : 'none', userSelect: 'none',
            }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{icon} {title}</span>
                <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{open ? '▲' : '▼'}</span>
            </div>
            {open && <div style={{ padding: '1rem 1.25rem' }}>{children}</div>}
        </div>
    );
}

function SummaryCard({ label, value, color, icon, sub }) {
    return (
        <div style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: '1rem 1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: '1.2rem' }}>{icon}</span>
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color, marginBottom: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</div>
            {sub && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{sub}</div>}
        </div>
    );
}

export default function ProfitAndLoss() {
    const [loading, setLoading] = useState(true);
    const [report, setReport] = useState(null);
    const [settings, setSettings] = useState(null);
    const [selectedFY, setSelectedFY] = useState(null);
    const [error, setError] = useState(null);

    const availableYears = useMemo(() => buildAvailableYears(settings), [settings]);

    useEffect(() => {
        getCompanySettings().then(s => {
            setSettings(s);
            const years = buildAvailableYears(s);
            if (years.length > 0) setSelectedFY(years[0]);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selectedFY) return;
        setLoading(true);
        setError(null);
        getProfitAndLoss(selectedFY)
            .then(data => { setReport(data); setLoading(false); })
            .catch(err => { setError(err.message); setLoading(false); });
    }, [selectedFY]);

    if (loading && !report) return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading Profit & Loss…</div>;

    return (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {/* Header & FY selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>📊 Profit & Loss</h2>
                <select
                    value={selectedFY || ''} onChange={(e) => setSelectedFY(e.target.value)}
                    style={{ padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid #d1d5db', fontSize: '0.9rem', fontWeight: 600 }}
                >
                    {availableYears.map(y => <option key={y} value={y}>FY {y}</option>)}
                </select>
            </div>

            {error && <div style={{ padding: '1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: '1rem' }}>Error: {error}</div>}

            {report && (
                <>
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                        <SummaryCard label="Revenue" value={report.totalRevenue} color="#059669" icon="💰" sub={`${report.revenueByCustomer?.length || 0} customer(s)`} />
                        <SummaryCard label="Operating Expenses" value={report.totalOperatingExpenses} color="#dc2626" icon="📉" />
                        <SummaryCard label="Profit Before Tax" value={report.profitBeforeTax} color={report.profitBeforeTax >= 0 ? '#1d4ed8' : '#dc2626'} icon="📈" />
                        <SummaryCard label="Corporation Tax" value={report.corporationTaxEstimate} color="#9333ea" icon="🏛️" sub={report.corporationTaxRate} />
                        <SummaryCard label="Net Profit" value={report.netProfit} color={report.netProfit >= 0 ? '#059669' : '#dc2626'} icon="✅" sub={`${report.netProfitMargin}% margin`} />
                        <SummaryCard label="Retained Profit" value={report.retainedProfit} color="#0284c7" icon="🏦" sub={`After ${fmt(report.dividendsDeclared)} dividends`} />
                    </div>

                    {/* Profit & Loss Statement */}
                    <Card title="Profit & Loss Statement" icon="📋" defaultOpen={true}>
                        <PLRow label="Revenue (Sales)" value={report.totalRevenue} bold highlight />
                        <PLRow label="Cost of Sales" value={report.costOfSales} indent />
                        <PLRow label="Gross Profit" value={report.grossProfit} bold divider total />

                        <div style={{ marginTop: '0.75rem' }} />
                        <PLRow label="Operating Expenses" bold />
                        {report.expensesByCategory?.map(c => (
                            <PLRow key={c.category} label={`  ${c.category} (${c.count})`} value={c.amountNet} indent />
                        ))}
                        <PLRow label="Staff Costs" value={report.staffCosts} indent />
                        {report.salaryGross > 0 && <PLRow label="    Salaries" value={report.salaryGross} indent />}
                        {report.employerNI > 0 && <PLRow label="    Employer NI" value={report.employerNI} indent />}
                        {report.depreciation > 0 && <PLRow label="Depreciation" value={report.depreciation} indent />}
                        {report.mileageClaims > 0 && <PLRow label="Mileage Claims" value={report.mileageClaims} indent />}
                        {report.subscriptionCosts > 0 && <PLRow label="Software & Subscriptions" value={report.subscriptionCosts} indent />}
                        <PLRow label="Total Operating Expenses" value={report.totalOperatingExpenses} bold divider negative />

                        <PLRow label="Operating Profit" value={report.operatingProfit} bold highlight divider />
                        <PLRow label="Profit Before Tax" value={report.profitBeforeTax} bold total divider />

                        <div style={{ marginTop: '0.5rem' }} />
                        <PLRow label={`Corporation Tax (${report.corporationTaxRate})`} value={report.corporationTaxEstimate} negative />
                        <PLRow label="Net Profit After Tax" value={report.netProfit} bold total divider />

                        <div style={{ marginTop: '0.5rem' }} />
                        <PLRow label="Dividends Declared" value={report.dividendsDeclared} indent />
                        <PLRow label="Retained Profit" value={report.retainedProfit} bold highlight />
                    </Card>

                    {/* Revenue by Customer */}
                    {report.revenueByCustomer?.length > 0 && (
                        <Card title="Revenue by Customer" icon="👥" defaultOpen={false}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f9fafb' }}>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Customer</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Invoices</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>Net Revenue</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 600, fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }}>%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.revenueByCustomer.map(c => (
                                        <tr key={c.customerName}>
                                            <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem' }}>{c.customerName}</td>
                                            <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem', textAlign: 'right' }}>{c.invoiceCount}</td>
                                            <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}>{fmt(c.amountNet)}</td>
                                            <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem', textAlign: 'right', color: '#6b7280' }}>{c.percentage}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Card>
                    )}

                    {/* Revenue by Month */}
                    {report.revenueByMonth?.length > 0 && (
                        <Card title="Monthly Revenue Trend" icon="📈" defaultOpen={false}>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160, padding: '0.5rem 0' }}>
                                {report.revenueByMonth.map(m => {
                                    const maxVal = Math.max(...report.revenueByMonth.map(m => m.amount));
                                    const pct = maxVal > 0 ? (m.amount / maxVal) * 100 : 0;
                                    return (
                                        <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                            <span style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: 600 }}>{fmt(m.amount)}</span>
                                            <div style={{
                                                width: '100%', maxWidth: 40, height: `${Math.max(pct, 4)}%`,
                                                background: 'linear-gradient(180deg, #3b82f6, #1d4ed8)', borderRadius: '4px 4px 0 0',
                                            }} />
                                            <span style={{ fontSize: '0.6rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                                                {new Date(m.month + '-01').toLocaleDateString('en-GB', { month: 'short' })}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>
                    )}

                    {/* Expenses by Category */}
                    {report.expensesByCategory?.length > 0 && (
                        <Card title="Expenses by Category" icon="📊" defaultOpen={false}>
                            {report.expensesByCategory.map(c => (
                                <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                    <span style={{ flex: '0 0 150px', fontSize: '0.85rem', fontWeight: 500 }}>{c.category}</span>
                                    <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${Math.max(c.percentage, 2)}%`, height: '100%',
                                            background: 'linear-gradient(90deg, #ef4444, #dc2626)', borderRadius: 4,
                                        }} />
                                    </div>
                                    <span style={{ flex: '0 0 90px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 600 }}>{fmt(c.amountNet)}</span>
                                    <span style={{ flex: '0 0 40px', textAlign: 'right', fontSize: '0.75rem', color: '#6b7280' }}>{c.percentage}%</span>
                                </div>
                            ))}
                        </Card>
                    )}

                    <div style={{
                        marginTop: '0.5rem', padding: '0.875rem 1rem', background: '#f9fafb', borderRadius: 8,
                        border: '1px solid #e5e7eb', fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.6,
                    }}>
                        <strong>Note:</strong> This P&L is generated from data in Finlytics. Revenue is based on issued/paid invoices.
                        Expenses exclude DLA-backed items and non-deductible costs. Corporation Tax uses HMRC 2025-26 rates with marginal relief.
                        This should be reviewed by a qualified accountant.
                    </div>
                </>
            )}
        </div>
    );
}
