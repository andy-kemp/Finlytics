import React, { useEffect, useState, useMemo } from 'react';
import { getBalanceSheet, getCompanySettings } from '../services/apiService';

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

function BSRow({ label, value, bold, indent, total, divider, highlight }) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: `${divider ? '0.5rem' : '0.35rem'} ${(highlight || total) ? '0.75rem' : '0'}`,
            paddingLeft: indent ? '1.5rem' : ((highlight || total) ? '0.75rem' : 0),
            fontWeight: bold || total ? 700 : 400,
            fontSize: total ? '1.05rem' : '0.9rem',
            color: total ? '#1a1a2e' : '#374151',
            background: highlight ? '#eff6ff' : total ? '#f0f4ff' : 'transparent',
            borderRadius: (highlight || total) ? 6 : 0,
            borderTop: divider ? '1px solid #e5e7eb' : 'none',
            marginTop: divider ? '0.35rem' : 0,
            marginBottom: 2,
        }}>
            <span>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {value !== undefined && value !== null ? fmt(value) : ''}
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

export default function BalanceSheet() {
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
        getBalanceSheet(selectedFY)
            .then(data => { setReport(data); setLoading(false); })
            .catch(err => { setError(err.message); setLoading(false); });
    }, [selectedFY]);

    if (loading && !report) return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading Balance Sheet…</div>;

    const bal = report?.balanceCheck;
    const isBalanced = bal && Math.abs(bal.difference) < 0.01;

    return (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>🏦 Balance Sheet</h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {report && (
                        <span style={{
                            padding: '0.3rem 0.75rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600,
                            background: isBalanced ? '#dcfce7' : '#fef2f2',
                            color: isBalanced ? '#166534' : '#991b1b',
                        }}>
                            {isBalanced ? '✅ Balanced' : '⚠️ Imbalance: ' + fmt(bal?.difference)}
                        </span>
                    )}
                    <select
                        value={selectedFY || ''} onChange={(e) => setSelectedFY(e.target.value)}
                        style={{ padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid #d1d5db', fontSize: '0.9rem', fontWeight: 600 }}
                    >
                        {availableYears.map(y => <option key={y} value={y}>FY {y}</option>)}
                    </select>
                </div>
            </div>

            {error && <div style={{ padding: '1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: '1rem' }}>Error: {error}</div>}

            {report && (
                <>
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                        <SummaryCard label="Total Assets" value={report.totalAssets} color="#059669" icon="🏢" />
                        <SummaryCard label="Total Liabilities" value={report.totalLiabilities} color="#dc2626" icon="📋" />
                        <SummaryCard label="Net Assets" value={report.netAssets} color="#1d4ed8" icon="💎" />
                        <SummaryCard label="Shareholders' Funds" value={report.totalCapitalAndReserves} color="#7c3aed" icon="🏛️" />
                    </div>

                    {/* Fixed Assets */}
                    <Card title="Fixed Assets" icon="🏗️" defaultOpen={true}>
                        {report.fixedAssets?.items?.map(a => (
                            <div key={a.name} style={{ marginBottom: '0.75rem' }}>
                                <BSRow label={a.name} value={a.netBookValue} bold />
                                <div style={{ display: 'flex', gap: '2rem', paddingLeft: '1.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
                                    <span>Cost: {fmt(a.cost)}</span>
                                    <span>Depn: {fmt(a.accumulatedDepreciation)}</span>
                                    {a.remainingLifeYears !== undefined && <span>Life: {a.remainingLifeYears}yr(s) left</span>}
                                </div>
                            </div>
                        ))}
                        <BSRow label="Total Fixed Assets" value={report.fixedAssets?.total} bold total divider />
                    </Card>

                    {/* Current Assets */}
                    <Card title="Current Assets" icon="💰" defaultOpen={true}>
                        <BSRow label="Trade Debtors" value={report.currentAssets?.tradeDebtors} />
                        <BSRow label="Bank & Cash" value={report.currentAssets?.bankBalance} />
                        {(report.currentAssets?.dlaOwedToDirector ?? 0) > 0 && (
                            <BSRow label="DLA (Owed to Director)" value={report.currentAssets.dlaOwedToDirector} />
                        )}
                        <BSRow label="Total Current Assets" value={report.currentAssets?.total} bold total divider />
                    </Card>

                    {/* Current Liabilities */}
                    <Card title="Current Liabilities" icon="📋" defaultOpen={true}>
                        {(report.currentLiabilities?.payeOwed ?? 0) > 0 && (
                            <BSRow label="PAYE / NI Owed" value={report.currentLiabilities.payeOwed} />
                        )}
                        {(report.currentLiabilities?.corporationTax ?? 0) > 0 && (
                            <BSRow label="Corporation Tax" value={report.currentLiabilities.corporationTax} />
                        )}
                        {(report.currentLiabilities?.vatOwed ?? 0) > 0 && (
                            <BSRow label="VAT Owed" value={report.currentLiabilities.vatOwed} />
                        )}
                        {(report.currentLiabilities?.dividendsPayable ?? 0) > 0 && (
                            <BSRow label="Dividends Payable" value={report.currentLiabilities.dividendsPayable} />
                        )}
                        {(report.currentLiabilities?.dlaOwedToCompany ?? 0) > 0 && (
                            <BSRow label="DLA (Owed to Company)" value={report.currentLiabilities.dlaOwedToCompany} />
                        )}
                        <BSRow label="Total Current Liabilities" value={report.currentLiabilities?.total} bold total divider />
                    </Card>

                    {/* Net Assets */}
                    <Card title="Net Assets" icon="💎" defaultOpen={true}>
                        <BSRow label="Total Assets" value={report.totalAssets} />
                        <BSRow label="Less: Current Liabilities" value={report.totalLiabilities} />
                        <BSRow label="Net Assets" value={report.netAssets} bold total divider />
                    </Card>

                    {/* Capital & Reserves */}
                    <Card title="Capital & Reserves" icon="🏛️" defaultOpen={true}>
                        <BSRow label="Share Capital" value={report.capitalAndReserves?.shareCapital} />
                        <BSRow label="Retained Earnings" value={report.capitalAndReserves?.retainedEarnings} />
                        <BSRow label="Total Capital & Reserves" value={report.totalCapitalAndReserves} bold total divider />
                    </Card>

                    <div style={{
                        marginTop: '0.5rem', padding: '0.875rem 1rem', background: '#f9fafb', borderRadius: 8,
                        border: '1px solid #e5e7eb', fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.6,
                    }}>
                        <strong>Note:</strong> This Balance Sheet is generated from data in Finlytics and shows the position at the end of the selected financial year.
                        Fixed assets are shown at net book value after straight-line depreciation. Trade debtors include unpaid/overdue invoices.
                        This should be reviewed by a qualified accountant.
                    </div>
                </>
            )}
        </div>
    );
}
