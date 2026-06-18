import React, { useState, useEffect } from 'react';
import {
    getInvoices, getExpenses, getDlaEntries,
    getVatReturns, getCompanyLedger, getCompanySettings
} from '../services/apiService';

const SECTIONS = [
    { key: 'invoices',      label: '📄 Invoices',        fetch: () => getInvoices() },
    { key: 'expenses',      label: '💳 Expenses',         fetch: () => getExpenses() },
    { key: 'dla',           label: '🤝 DLA Entries',      fetch: () => getDlaEntries() },
    { key: 'ledger',        label: '📒 Company Ledger',   fetch: () => getCompanyLedger('all') },
    { key: 'vatReturns',    label: '🏛️ VAT Returns',     fetch: () => getVatReturns() },
];

function flattenObj(obj, prefix = '') {
    return Object.keys(obj || {}).reduce((acc, k) => {
        const val = obj[k];
        const key = prefix ? `${prefix}_${k}` : k;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(acc, flattenObj(val, key));
        } else if (Array.isArray(val)) {
            acc[key] = JSON.stringify(val);
        } else {
            acc[key] = val ?? '';
        }
        return acc;
    }, {});
}

function toCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const flat = rows.map(r => flattenObj(r));
    const headers = Array.from(new Set(flat.flatMap(r => Object.keys(r))));
    const escape = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
        headers.join(','),
        ...flat.map(r => headers.map(h => escape(r[h] ?? '')).join(','))
    ].join('\n');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function filterByDate(rows, dateFrom, dateTo) {
    if (!dateFrom && !dateTo) return rows;
    return (rows || []).filter(row => {
        const raw = row.invoiceDate || row.datePaid || row.entryDate || row.date || row.returnStart || null;
        if (!raw) return true;
        const d = new Date(raw);
        if (dateFrom && d < new Date(dateFrom)) return false;
        if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
        return true;
    });
}

export default function ExportModal({ onClose }) {
    const [selected, setSelected] = useState({ invoices: true, expenses: true, dla: true, ledger: true, vatReturns: true });
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [data, setData] = useState({});
    const [fetching, setFetching] = useState(true);

    // Pre-fetch all data on open
    useEffect(() => {
        let active = true;
        setFetching(true);
        Promise.allSettled(SECTIONS.map(s => s.fetch().then(d => ({ key: s.key, rows: d }))))
            .then(results => {
                if (!active) return;
                const fetched = {};
                results.forEach(r => {
                    if (r.status === 'fulfilled') {
                        const { key, rows } = r.value;
                        fetched[key] = Array.isArray(rows) ? rows : (rows?.items || rows?.entries || rows?.returns || []);
                    }
                });
                setData(fetched);
                setFetching(false);
            });
        return () => { active = false; };
    }, []);

    const toggleSection = key => setSelected(s => ({ ...s, [key]: !s[key] }));
    const allSelected = SECTIONS.every(s => selected[s.key]);
    const toggleAll = () => {
        const next = !allSelected;
        const newSel = {};
        SECTIONS.forEach(s => { newSel[s.key] = next; });
        setSelected(newSel);
    };

    const exportCsv = async () => {
        setLoading(true);
        setStatus('Preparing CSV files…');
        const today = new Date().toISOString().slice(0, 10);
        let count = 0;
        for (const sec of SECTIONS) {
            if (!selected[sec.key]) continue;
            const rows = filterByDate(data[sec.key] || [], dateFrom, dateTo);
            if (!rows.length) continue;
            const csv = toCsv(rows);
            downloadFile(csv, `finlytics-${sec.key}-${today}.csv`, 'text/csv');
            count++;
            await new Promise(r => setTimeout(r, 300)); // stagger downloads
        }
        setStatus(count ? `✅ ${count} file(s) downloaded.` : '⚠️ No data matched the selected filters.');
        setLoading(false);
    };

    const exportJson = async () => {
        setLoading(true);
        setStatus('Preparing JSON…');
        const today = new Date().toISOString().slice(0, 10);
        const payload = {};
        for (const sec of SECTIONS) {
            if (!selected[sec.key]) continue;
            payload[sec.key] = filterByDate(data[sec.key] || [], dateFrom, dateTo);
        }
        const content = JSON.stringify(payload, null, 2);
        downloadFile(content, `finlytics-export-${today}.json`, 'application/json');
        setStatus('✅ JSON file downloaded.');
        setLoading(false);
    };

    const rowCounts = key => {
        const rows = filterByDate(data[key] || [], dateFrom, dateTo);
        return rows.length;
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-content" style={{ maxWidth: 540, width: '95vw' }}>
                {/* Header */}
                <div className="modal-header">
                    <h2 style={{ margin: 0 }}>📤 Export Data</h2>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="modal-body" style={{ padding: '20px 24px' }}>
                    {/* Date range filter */}
                    <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
                        <div style={{ fontWeight: 600, marginBottom: 10, color: '#495057' }}>📅 Date Range Filter <span style={{ fontSize: '0.78rem', fontWeight: 400, color: '#6c757d' }}>(optional)</span></div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 160 }}>
                                <label style={{ fontSize: '0.82rem', color: '#6c757d', display: 'block', marginBottom: 4 }}>From</label>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem' }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 160 }}>
                                <label style={{ fontSize: '0.82rem', color: '#6c757d', display: 'block', marginBottom: 4 }}>To</label>
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                    style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.9rem' }} />
                            </div>
                            {(dateFrom || dateTo) && (
                                <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                                    style={{ alignSelf: 'flex-end', padding: '6px 12px', borderRadius: 6, border: '1px solid #dee2e6', background: '#fff', cursor: 'pointer', fontSize: '0.82rem', marginBottom: 0 }}>
                                    × Clear
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Section selector */}
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ fontWeight: 600, color: '#495057' }}>📦 Select Datasets</div>
                            <button onClick={toggleAll}
                                style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: 6, border: '1px solid #dee2e6', background: '#fff', cursor: 'pointer' }}>
                                {allSelected ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        {fetching ? (
                            <div style={{ textAlign: 'center', color: '#6c757d', padding: 16 }}>Loading data…</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {SECTIONS.map(sec => {
                                    const count = rowCounts(sec.key);
                                    return (
                                        <label key={sec.key}
                                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                                                borderRadius: 8, border: `1.5px solid ${selected[sec.key] ? '#0d6efd' : '#dee2e6'}`,
                                                background: selected[sec.key] ? '#f0f4ff' : '#fff', cursor: 'pointer', transition: 'all 0.15s' }}>
                                            <input type="checkbox" checked={selected[sec.key]} onChange={() => toggleSection(sec.key)}
                                                style={{ width: 16, height: 16, accentColor: '#0d6efd' }} />
                                            <span style={{ flex: 1, fontWeight: 500, fontSize: '0.9rem' }}>{sec.label}</span>
                                            <span style={{ fontSize: '0.78rem', color: count > 0 ? '#0d6efd' : '#adb5bd',
                                                background: count > 0 ? '#e7f0fd' : '#f8f9fa', borderRadius: 12, padding: '2px 8px' }}>
                                                {count} row{count !== 1 ? 's' : ''}
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {status && (
                        <div style={{ background: '#f0f4ff', border: '1px solid #c7d7fa', borderRadius: 8, padding: '10px 14px',
                            fontSize: '0.88rem', color: '#3b5bdb', marginBottom: 8 }}>
                            {status}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button className="btn-secondary" onClick={onClose} style={{ minWidth: 80 }}>Close</button>
                    <button className="btn-secondary" disabled={loading || fetching} onClick={exportJson}
                        style={{ minWidth: 140 }}>
                        {loading ? '⏳ Exporting…' : '📋 Export as JSON'}
                    </button>
                    <button className="btn-primary" disabled={loading || fetching} onClick={exportCsv}
                        style={{ minWidth: 140 }}>
                        {loading ? '⏳ Exporting…' : '⬇️ Export as CSV'}
                    </button>
                </div>
            </div>
        </div>
    );
}
