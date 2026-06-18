import React, { useEffect, useState } from 'react';
import { getAgedDebtors } from '../services/apiService';

const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n ?? 0);

const bucketColors = {
    current: '#22c55e',
    '1-30': '#eab308',
    '31-60': '#f97316',
    '61-90': '#ef4444',
    '90+': '#991b1b',
};

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

function BucketBar({ report }) {
    const total = report?.totalOutstanding ?? 0;
    if (total <= 0) return null;
    const buckets = [
        { key: 'current', label: 'Current', value: report?.currentTotal ?? 0 },
        { key: '1-30', label: '1–30 days', value: report?.days1to30Total ?? 0 },
        { key: '31-60', label: '31–60 days', value: report?.days31to60Total ?? 0 },
        { key: '61-90', label: '61–90 days', value: report?.days61to90Total ?? 0 },
        { key: '90+', label: '90+ days', value: report?.days90PlusTotal ?? 0 },
    ];
    return (
        <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 28 }}>
                {buckets.filter(b => b.value > 0).map(b => (
                    <div key={b.key} title={`${b.label}: ${fmt(b.value)}`} style={{
                        width: `${(b.value / total) * 100}%`, background: bucketColors[b.key],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', color: '#fff', fontWeight: 600, minWidth: 2,
                    }}>
                        {(b.value / total) > 0.1 ? fmt(b.value) : ''}
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {buckets.map(b => (
                    <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#6b7280' }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: bucketColors[b.key] }} />
                        {b.label}
                    </div>
                ))}
            </div>
        </div>
    );
}

function CustomerSection({ customer }) {
    const [open, setOpen] = useState(false);
    const overdue = (customer.days1to30 ?? 0) + (customer.days31to60 ?? 0) + (customer.days61to90 ?? 0) + (customer.days90Plus ?? 0);
    const hasOverdue = overdue > 0;

    return (
        <div style={{
            background: '#fff', borderRadius: 10, border: `1px solid ${hasOverdue ? '#fca5a5' : '#e5e7eb'}`,
            marginBottom: '0.75rem', overflow: 'hidden',
        }}>
            <div onClick={() => setOpen(o => !o)} style={{
                padding: '0.875rem 1.25rem', cursor: 'pointer',
                background: hasOverdue ? '#fef2f2' : '#f9fafb',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: open ? '1px solid #e5e7eb' : 'none', userSelect: 'none',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        {hasOverdue ? '🔴' : '🟢'} {customer.customerName}
                    </span>
                    <span style={{
                        padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600,
                        background: hasOverdue ? '#fee2e2' : '#dcfce7',
                        color: hasOverdue ? '#991b1b' : '#166534',
                    }}>
                        {customer.invoiceCount} invoice{customer.invoiceCount !== 1 ? 's' : ''}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem', fontVariantNumeric: 'tabular-nums' }}>{fmt(customer.totalOwed)}</span>
                    <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{open ? '▲' : '▼'}</span>
                </div>
            </div>

            {open && (
                <div style={{ padding: '0.75rem 1.25rem' }}>
                    {/* Bucket mini-summary */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        {[
                            { label: 'Current', val: customer.current, color: bucketColors.current },
                            { label: '1–30d', val: customer.days1to30, color: bucketColors['1-30'] },
                            { label: '31–60d', val: customer.days31to60, color: bucketColors['31-60'] },
                            { label: '61–90d', val: customer.days61to90, color: bucketColors['61-90'] },
                            { label: '90+d', val: customer.days90Plus, color: bucketColors['90+'] },
                        ].filter(b => (b.val ?? 0) > 0).map(b => (
                            <span key={b.label} style={{
                                padding: '0.25rem 0.65rem', borderRadius: 14, fontSize: '0.7rem', fontWeight: 600,
                                background: b.color + '18', color: b.color, border: `1px solid ${b.color}40`,
                            }}>
                                {b.label}: {fmt(b.val)}
                            </span>
                        ))}
                    </div>

                    {/* Invoices table */}
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: '#f9fafb' }}>
                                {['Invoice', 'Date', 'Due Date', 'Amount', 'Outstanding', 'Days Overdue'].map(h => (
                                    <th key={h} style={{
                                        padding: '0.4rem 0.75rem', textAlign: h === 'Invoice' ? 'left' : 'right',
                                        fontWeight: 600, fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase',
                                        borderBottom: '1px solid #e5e7eb',
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {customer.invoices?.map((inv, i) => {
                                const days = inv.daysOverdue ?? 0;
                                const statusColor = days <= 0 ? '#22c55e' : days <= 30 ? '#eab308' : days <= 60 ? '#f97316' : '#ef4444';
                                return (
                                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                                        <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', fontWeight: 500 }}>
                                            {inv.invoiceNumber || inv.reference || `#${i + 1}`}
                                        </td>
                                        <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>
                                            {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-GB') : '—'}
                                        </td>
                                        <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>
                                            {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB') : '—'}
                                        </td>
                                        <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            {fmt(inv.totalAmount)}
                                        </td>
                                        <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                            {fmt(inv.outstandingAmount)}
                                        </td>
                                        <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>
                                            <span style={{
                                                padding: '0.15rem 0.5rem', borderRadius: 10, fontWeight: 600, fontSize: '0.75rem',
                                                background: statusColor + '18', color: statusColor,
                                            }}>
                                                {days <= 0 ? 'Not due' : `${days} days`}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default function AgedDebtors() {
    const [loading, setLoading] = useState(true);
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        setLoading(true);
        getAgedDebtors()
            .then(data => { setReport(data); setLoading(false); })
            .catch(err => { setError(err.message); setLoading(false); });
    }, []);

    if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading Aged Debtors…</div>;

    const overdueTotal = (report?.days1to30Total ?? 0) + (report?.days31to60Total ?? 0) + (report?.days61to90Total ?? 0) + (report?.days90PlusTotal ?? 0);

    return (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>⏰ Aged Debtors</h2>
                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                    As at {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
            </div>

            {error && <div style={{ padding: '1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', marginBottom: '1rem' }}>Error: {error}</div>}

            {report && (
                <>
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                        <SummaryCard label="Total Outstanding" value={report.totalOutstanding} color="#1d4ed8" icon="💳" sub={`${report.totalInvoices} invoice(s)`} />
                        <SummaryCard label="Current" value={report.currentTotal} color="#22c55e" icon="✅" />
                        <SummaryCard label="1–30 Days" value={report.days1to30Total} color="#eab308" icon="⚠️" />
                        <SummaryCard label="31–60 Days" value={report.days31to60Total} color="#f97316" icon="🔶" />
                        <SummaryCard label="61–90 Days" value={report.days61to90Total} color="#ef4444" icon="🔴" />
                        <SummaryCard label="90+ Days" value={report.days90PlusTotal} color="#991b1b" icon="🚨" />
                    </div>

                    {/* Stacked aging bar */}
                    <BucketBar report={report} />

                    {/* Alert banner for overdue */}
                    {overdueTotal > 0 && (
                        <div style={{
                            padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: 8,
                            background: '#fef2f2', border: '1px solid #fca5a5', fontSize: '0.85rem', color: '#991b1b',
                        }}>
                            ⚠️ <strong>{fmt(overdueTotal)}</strong> is overdue across {report.customers?.filter(c =>
                                (c.days1to30 ?? 0) + (c.days31to60 ?? 0) + (c.days61to90 ?? 0) + (c.days90Plus ?? 0) > 0
                            ).length || 0} customer(s). Consider sending reminders.
                        </div>
                    )}

                    {/* No outstanding */}
                    {(report.totalOutstanding ?? 0) === 0 && (
                        <div style={{
                            padding: '2rem', textAlign: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0',
                            borderRadius: 10, marginBottom: '1rem',
                        }}>
                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎉</div>
                            <div style={{ fontWeight: 600, color: '#166534' }}>All invoices are paid! No outstanding debtors.</div>
                        </div>
                    )}

                    {/* Customer breakdown */}
                    {report.customers?.sort((a, b) => (b.totalOwed ?? 0) - (a.totalOwed ?? 0)).map(c => (
                        <CustomerSection key={c.customerName} customer={c} />
                    ))}

                    <div style={{
                        marginTop: '0.5rem', padding: '0.875rem 1rem', background: '#f9fafb', borderRadius: 8,
                        border: '1px solid #e5e7eb', fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.6,
                    }}>
                        <strong>Note:</strong> Aged Debtors shows unpaid and overdue invoices at the current date.
                        Aging is calculated from each invoice's due date (or issue date + 30 days if no due date set).
                        Partially-paid invoices show the remaining balance.
                    </div>
                </>
            )}
        </div>
    );
}
