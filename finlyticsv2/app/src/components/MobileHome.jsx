import React, { useState, useEffect } from 'react';
import FinlyticsLogo from './FinlyticsLogo';
import TrivialBenefitModal from './TrivialBenefitModal';
import { getDlaEntries, getExpenses, getTrivialBenefitSummary, getCompanySettings } from '../services/apiService';

// Helper: current UK tax year label e.g. "2025/26"
function currentTaxYear() {
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const startYear = (m > 4 || (m === 4 && now.getDate() >= 6)) ? y : y - 1;
    return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const MobileHome = ({ onNavigate }) => {
    const [summary, setSummary] = useState(null);
    const [recent, setRecent] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showTrivialBenefit, setShowTrivialBenefit] = useState(false);
    const [directors, setDirectors] = useState([]);
    const [trivialCount, setTrivialCount] = useState(null); // { used, limit }

    useEffect(() => {
        load();
    }, []);

    const load = async () => {
        try {
            const [dlaData, expData, tbSummary, settingsData] = await Promise.all([
                getDlaEntries().catch(() => []),
                getExpenses().catch(() => []),
                getTrivialBenefitSummary(currentTaxYear()).catch(() => null),
                getCompanySettings().catch(() => null)
            ]);

            // Directors list
            if (settingsData?.directors) {
                setDirectors(settingsData.directors.split(',').map(d => d.trim()).filter(Boolean));
            } else if (settingsData?.directorName) {
                setDirectors([settingsData.directorName]);
            }

            // Trivial benefit count — API returns { count, limit, remaining, isAtLimit }
            if (tbSummary) {
                setTrivialCount({ used: tbSummary.count ?? 0, limit: tbSummary.limit ?? 6 });
            }

            const dlaOwed = (dlaData || [])
                .filter(e => e.direction === 'OwedToDirector')
                .reduce((s, e) => s + (e.remainingBalance || 0), 0);

            const now = new Date();
            const monthExp = (expData || [])
                .filter(e => !e.isDLA)
                .filter(e => {
                    const d = new Date(e.datePaid || e.entryDate);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                });
            const monthTotal = monthExp.reduce((s, e) => s + (e.amountGross || 0), 0);

            setSummary({ dlaOwed, monthTotal, monthCount: monthExp.length });

            // Recent items: merge expenses + DLA, sort by date, take 8
            const items = [
                ...(expData || []).filter(e => !e.isDLA).slice(0, 8).map(e => ({
                    type: 'expenses',
                    label: e.supplier || 'Expense',
                    sub: e.category || '',
                    amount: e.amountGross,
                    date: e.datePaid || e.entryDate,
                    icon: '💳'
                })),
                ...(dlaData || []).slice(0, 8).map(e => ({
                    type: 'dla',
                    label: e.description || 'DLA Entry',
                    sub: e.director || '',
                    amount: e.amountGross,
                    date: e.entryDate,
                    icon: '🏦'
                }))
            ]
                .filter(i => i.date)
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, 8);

            setRecent(items);
        } catch (err) {
            console.error('MobileHome load error:', err);
        } finally {
            setLoading(false);
        }
    };

    const fmt = (n) => `£${(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const todayStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    return (
        <>
        <div className="mobile-home">
            {/* Full-bleed branded header */}
            <div className="mobile-home-header">
                <FinlyticsLogo />
                <div className="mhh-date">{todayStr}</div>
            </div>

            {/* Body content */}
            <div className="mobile-home-body">

            {/* Summary strip */}
            {summary && (
                <div className="mobile-summary-strip">
                    <div className="mobile-summary-item" onClick={() => onNavigate('dla')}>
                        <span className="msi-label">DLA owed to you</span>
                        <strong className="msi-value">{fmt(summary.dlaOwed)}</strong>
                    </div>
                    <div className="mobile-summary-divider" />
                    <div className="mobile-summary-item" onClick={() => onNavigate('expenses')}>
                        <span className="msi-label">Expenses this month</span>
                        <strong className="msi-value">{fmt(summary.monthTotal)}</strong>
                        <span className="msi-sub">{summary.monthCount} {summary.monthCount === 1 ? 'entry' : 'entries'}</span>
                    </div>
                </div>
            )}

            {/* Quick action tiles */}
            <div className="mobile-actions-grid">
                <button className="mobile-action-tile primary" onClick={() => onNavigate('expenses')}>
                    <span className="mat-icon">📸</span>
                    <span className="mat-label">Capture Receipt</span>
                    <span className="mat-sub">Photo or drag & drop</span>
                </button>
                <button className="mobile-action-tile" onClick={() => onNavigate('expenses')}>
                    <span className="mat-icon">💳</span>
                    <span className="mat-label">Add Expense</span>
                    <span className="mat-sub">Manual entry</span>
                </button>
                <button className="mobile-action-tile" onClick={() => onNavigate('dla')}>
                    <span className="mat-icon">🏦</span>
                    <span className="mat-label">Add DLA</span>
                    <span className="mat-sub">Director expense</span>
                </button>
                <button className="mobile-action-tile" onClick={() => onNavigate('mileage')}>
                    <span className="mat-icon">🚗</span>
                    <span className="mat-label">Log Mileage</span>
                    <span className="mat-sub">Record a trip</span>
                </button>
                <button className="mobile-action-tile" onClick={() => setShowTrivialBenefit(true)}>
                    <span className="mat-icon">🎁</span>
                    <span className="mat-label">Trivial Benefit</span>
                    <span className="mat-sub">
                        {trivialCount !== null
                            ? `${trivialCount.used} / ${trivialCount.limit} used this year`
                            : 'Staff gift (max £50)'}
                    </span>
                </button>
                <button className="mobile-action-tile" onClick={() => onNavigate('invoices')}>
                    <span className="mat-icon">💰</span>
                    <span className="mat-label">Invoices</span>
                    <span className="mat-sub">Raise or view</span>
                </button>
            </div>

            {/* Recent activity */}
            <div className="mobile-recent">
                <h3 className="mobile-section-title">Recent Activity</h3>
                {loading ? (
                    <div className="mobile-loading">Loading…</div>
                ) : recent.length === 0 ? (
                    <div className="mobile-empty">
                        No recent entries yet.<br />
                        Tap <strong>Capture Receipt</strong> to get started!
                    </div>
                ) : (
                    <div className="mobile-recent-list">
                        {recent.map((item, i) => (
                            <div
                                key={i}
                                className="mobile-recent-item"
                                onClick={() => onNavigate(item.type)}
                            >
                                <span className="mri-icon">{item.icon}</span>
                                <div className="mri-body">
                                    <span className="mri-label">{item.label}</span>
                                    {item.sub && <span className="mri-sub">{item.sub}</span>}
                                </div>
                                <div className="mri-right">
                                    <strong className="mri-amount">{fmt(item.amount)}</strong>
                                    <span className="mri-date">{fmtDate(item.date)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            </div>
        </div>
        {showTrivialBenefit && (
            <TrivialBenefitModal
                directors={directors}
                onClose={() => setShowTrivialBenefit(false)}
                onSaved={() => { setShowTrivialBenefit(false); load(); }}
            />
        )}
        </>
    );
};

export default MobileHome;
