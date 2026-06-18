import React, { useState, useEffect, useCallback } from 'react';
import {
    getMileageTrips, createMileageTrip, updateMileageTrip, deleteMileageTrip,
    getMileageSummary, getMileageClaims, generateMileageClaim,
    submitMileageClaim, markMileageClaimPaid, getCompanySettings
} from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';
import ConfirmDeleteModal from './ConfirmDeleteModal';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute current UK tax year label  e.g. "2025/26"
// ─────────────────────────────────────────────────────────────────────────────
function currentTaxYear() {
    const now = new Date();
    const m = now.getMonth() + 1; // 1-based
    const d = now.getDate();
    const y = now.getFullYear();
    const startYear = (m > 4 || (m === 4 && d >= 6)) ? y : y - 1;
    return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a Google Maps directions URL from two address strings
// ─────────────────────────────────────────────────────────────────────────────
function googleMapsUrl(start, end) {
    if (!start || !end) return null;
    return `https://www.google.com/maps/dir/${encodeURIComponent(start)}/${encodeURIComponent(end)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance lookup: Nominatim geocode → OSRM driving distance (no API key)
// Returns distance in miles, or throws with a user-friendly message.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchDrivingDistanceMiles(start, end) {
    const geocode = async (address) => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'Finlytics/1.0' } });
        if (!res.ok) throw new Error('Geocoding request failed');
        const data = await res.json();
        if (!data.length) throw new Error(`Could not find location: "${address}"`);
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    };

    const [from, to] = await Promise.all([geocode(start), geocode(end)]);
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await fetch(osrmUrl);
    if (!res.ok) throw new Error('Routing request failed');
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No driving route found between these locations');
    const metres = data.routes[0].distance;
    return metres / 1609.344; // metres → miles
}

const CATEGORIES = ['Consulting', 'Photography', 'Conference', 'Training', 'Client Visit', 'Other'];

const EMPTY_FORM = {
    tripDate:      new Date().toISOString().split('T')[0],
    director:      '',
    startLocation: '',
    endLocation:   '',
    miles:         '',
    isReturn:      false,
    purpose:       '',
    category:      'Consulting',
    notes:         ''
};

const MileageTrips = ({ openNew }) => {
    const { toast, showToast, clearToast } = useToast();

    // ── state ─────────────────────────────────────────────────────────────────
    const [activeTab,     setActiveTab]     = useState('trips');
    const [trips,         setTrips]         = useState([]);
    const [claims,        setClaims]        = useState([]);
    const [summary,       setSummary]       = useState(null);
    const [directors,     setDirectors]     = useState([]);
    const [loading,       setLoading]       = useState(true);
    const [processing,    setProcessing]    = useState(false);
    const [companySettings, setCompanySettings] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', itemLabels: [], onConfirm: () => {} });

    const [taxYear,       setTaxYear]       = useState(currentTaxYear());
    const [filterDirector,setFilterDirector]= useState('');

    // Trip form
    const [showForm,      setShowForm]      = useState(false);
    const [editingTrip,   setEditingTrip]   = useState(null);

    // Auto-open new entry form if launched from Dashboard quick-add
    useEffect(() => { if (openNew) setShowForm(true); }, [openNew]);
    const [form,          setForm]          = useState(EMPTY_FORM);
    const [distanceLookup, setDistanceLookup] = useState({ loading: false, error: null });
    const [viewingTrip,    setViewingTrip]    = useState(null);

    // Generate claim modal
    const [showClaimModal,  setShowClaimModal]  = useState(false);
    const [claimForm,       setClaimForm]       = useState({
        director:    '',
        periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        periodEnd:   new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
        notes:       ''
    });

    // ── data loaders ──────────────────────────────────────────────────────────
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [tripsData, claimsData, summaryData, settingsData] = await Promise.all([
                getMileageTrips({ taxYear, director: filterDirector || undefined }),
                getMileageClaims({ taxYear, director: filterDirector || undefined }),
                getMileageSummary({ taxYear, director: filterDirector || undefined }),
                getCompanySettings()
            ]);
            setTrips(Array.isArray(tripsData) ? tripsData : []);
            setClaims(Array.isArray(claimsData) ? claimsData : []);
            setSummary(summaryData);
            setCompanySettings(settingsData);

            // Build directors list from company settings + existing mileage data,
            // so users can still claim trips even if settings are stale/missing.
            const settingsDirectors = settingsData?.directors
                ? settingsData.directors.split(',').map(d => d.trim()).filter(Boolean)
                : (settingsData?.directorName ? [settingsData.directorName] : []);
            const tripDirectors = (Array.isArray(tripsData) ? tripsData : []).map(t => t?.director).filter(Boolean);
            const claimDirectors = (Array.isArray(claimsData) ? claimsData : []).map(c => c?.director).filter(Boolean);
            const mergedDirectors = [...new Set([...settingsDirectors, ...tripDirectors, ...claimDirectors])];
            setDirectors(mergedDirectors);
        } catch (err) {
            console.error(err);
            showToast(`Failed to load mileage data: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [taxYear, filterDirector]);

    useEffect(() => { loadData(); }, [loadData]);

    // ── form helpers ──────────────────────────────────────────────────────────
    const openAddForm = () => {
        setEditingTrip(null);
        setForm({ ...EMPTY_FORM, director: directors[0] || '' });
        setDistanceLookup({ loading: false, error: null });
        setShowForm(true);
    };

    const openEditForm = (trip) => {
        setEditingTrip(trip);
        setForm({
            tripDate:      trip.tripDate?.split('T')[0] ?? '',
            director:      trip.director ?? '',
            startLocation: trip.startLocation ?? '',
            endLocation:   trip.endLocation ?? '',
            // Display the actual miles; if it was a return trip the stored value is already doubled
            miles:         trip.isReturn ? String(trip.miles / 2) : String(trip.miles),
            isReturn:      trip.isReturn ?? false,
            purpose:       trip.purpose ?? '',
            category:      trip.category ?? 'Consulting',
            notes:         trip.notes ?? ''
        });
        setDistanceLookup({ loading: false, error: null });
        setShowForm(true);
    };

    const handleFormChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const computedMiles = () => {
        const raw = parseFloat(form.miles) || 0;
        return form.isReturn ? raw * 2 : raw;
    };

    const openMaps = () => {
        const url = googleMapsUrl(form.startLocation, form.endLocation);
        if (url) window.open(url, '_blank', 'noopener');
    };

    const lookupDistance = async () => {
        if (!form.startLocation || !form.endLocation) return;
        setDistanceLookup({ loading: true, error: null });
        try {
            const miles = await fetchDrivingDistanceMiles(form.startLocation, form.endLocation);
            setForm(prev => ({ ...prev, miles: miles.toFixed(1) }));
            setDistanceLookup({ loading: false, error: null, result: miles });
        } catch (err) {
            setDistanceLookup({ loading: false, error: err.message });
        }
    };

    // ── submit trip form ──────────────────────────────────────────────────────
    const handleSaveTrip = async (e) => {
        e.preventDefault();
        if (!form.director || !form.startLocation || !form.endLocation || !form.miles || !form.purpose) {
            showToast('Please fill in all required fields', 'error');
            return;
        }
        setProcessing(true);
        try {
            const payload = {
                ...form,
                miles:   parseFloat(form.miles),
                mapLink: googleMapsUrl(form.startLocation, form.endLocation) ?? ''
            };

            if (editingTrip) {
                await updateMileageTrip(editingTrip.id, payload);
                showToast('Trip updated', 'success');
            } else {
                await createMileageTrip(payload);
                showToast('Trip recorded', 'success');
            }
            setShowForm(false);
            await loadData();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    // ── delete trip ────────────────────────────────────────────────────────────
    const allowDataDeletion = companySettings?.allowDataDeletion === true;

    const handleDeleteTrip = (trip) => {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Trip',
            message: 'Are you sure you want to permanently delete this trip?',
            itemLabels: [`${trip.tripId} — ${trip.fromLocation ?? ''} → ${trip.toLocation ?? ''}`],
            onConfirm: async () => {
                setConfirmModal(m => ({ ...m, isOpen: false }));
                setProcessing(true);
                try {
                    await deleteMileageTrip(trip.id);
                    showToast('Trip deleted', 'success');
                    await loadData();
                } catch (err) {
                    showToast(`Error: ${err.message}`, 'error');
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    // ── generate claim ─────────────────────────────────────────────────────────
    const handleGenerateClaim = async (e) => {
        e.preventDefault();
        if (!claimForm.director) {
            showToast('Please select the director for this claim.', 'error');
            return;
        }
        setProcessing(true);
        try {
            await generateMileageClaim({ ...claimForm, taxYear });
            showToast('Claim generated', 'success');
            setShowClaimModal(false);
            setActiveTab('claims');
            await loadData();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    // ── submit claim ───────────────────────────────────────────────────────────
    const handleSubmitClaim = async (claim) => {
        if (!window.confirm(`Submit claim ${claim.claimRef}? This will create a DLA entry for £${claim.totalAmount?.toFixed(2)} and lock all trips.`)) return;
        setProcessing(true);
        try {
            const result = await submitMileageClaim(claim.id);
            showToast(`Claim posted — DLA entry ${result.dlaEntry?.dlaId} created`, 'success');
            await loadData();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    // ── mark paid ──────────────────────────────────────────────────────────────
    const handleMarkPaid = async (claim) => {
        if (!window.confirm(`Mark claim ${claim.claimRef} as Paid? This will mark the DLA entry as reimbursed.`)) return;
        setProcessing(true);
        try {
            await markMileageClaimPaid(claim.id);
            showToast('Claim marked as Paid', 'success');
            await loadData();
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    };

    // ── render helpers ─────────────────────────────────────────────────────────
    const fmtCcy = (n) => `£${(n ?? 0).toFixed(2)}`;
    const fmtMi  = (n) => `${(n ?? 0).toFixed(1)} mi`;

    const statusBadge = (status) => {
        const labels  = { Draft: 'Unclaimed', Claimed: 'Claimed', Posted: 'Posted', Paid: 'Paid' };
        const colours = { Draft: '#0d6efd', Claimed: '#fd7e14', Posted: '#198754', Paid: '#0dcaf0' };
        return (
            <span style={{
                background: colours[status] ?? '#6c757d',
                color: '#fff', padding: '2px 8px', borderRadius: 12,
                fontSize: 11, fontWeight: 600
            }}>{labels[status] ?? status}</span>
        );
    };

    const taxYearOptions = () => {
        const year = new Date().getFullYear();
        return [-1, 0, 1].map(offset => {
            const y = year + offset - 1;
            return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
        });
    };

    // ── progress bar for 10,000 mile threshold ────────────────────────────────
    const ThresholdBar = () => {
        if (!summary) return null;
        const threshold = summary.thresholdMiles ?? 10000;
        const rate45p = summary.rate45p ?? 0.45;
        const rate25p = summary.rate25p ?? 0.25;
        const pct = Math.min(100, ((summary.totalMiles ?? 0) / threshold) * 100);
        const over = (summary.totalMiles ?? 0) > threshold;
        return (
            <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>{fmtMi(summary.totalMiles)} used</span>
                    <span style={{ color: over ? '#dc3545' : '#198754', fontWeight: 600 }}>
                        {over ? `${Math.round(rate25p * 100)}p/mile rate` : `${Math.round(rate45p * 100)}p rate · ${fmtMi(summary.remaining45pMiles)} remaining`}
                    </span>
                </div>
                <div style={{ background: '#e9ecef', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                    <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 6,
                        background: over ? '#dc3545' : '#198754',
                        transition: 'width 0.4s'
                    }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6c757d', marginTop: 3 }}>
                    <span>0</span><span>{(summary.thresholdMiles ?? 10000).toLocaleString()} miles ({Math.round((summary.rate45p ?? 0.45) * 100)}p threshold)</span>
                </div>
            </div>
        );
    };

    // ── main render ────────────────────────────────────────────────────────────
    if (loading) return <div className="loading">Loading mileage data…</div>;

    return (
        <div className="module-container">
            <Toast toast={toast} onClose={clearToast} />

            {/* ── Header ── */}
            <div className="module-header">
                <div>
                    <h2>🚗 Mileage Allowance</h2>
                    <p style={{ margin: 0, fontSize: 13, color: '#6c757d' }}>
                        {summary
                            ? `HMRC MAP — ${Math.round((summary.rate45p ?? 0.45) * 100)}p/mile (first ${(summary.thresholdMiles ?? 10000).toLocaleString()}) · ${Math.round((summary.rate25p ?? 0.25) * 100)}p/mile (over ${(summary.thresholdMiles ?? 10000).toLocaleString()}) per tax year`
                            : 'HMRC MAP — 45p/mile (first 10,000) · 25p/mile (over 10,000) per tax year'
                        }
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                        value={taxYear}
                        onChange={e => setTaxYear(e.target.value)}
                        className="form-select"
                        style={{ width: 120 }}
                    >
                        {taxYearOptions().map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    {directors.length > 0 && (
                        <select
                            value={filterDirector}
                            onChange={e => setFilterDirector(e.target.value)}
                            className="form-select"
                            style={{ width: 160 }}
                        >
                            <option value="">All directors</option>
                            {directors.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    )}
                    <button className="btn-primary" onClick={openAddForm} disabled={processing}>
                        + Add Trip
                    </button>
                </div>
            </div>

            {/* ── Summary Cards ── */}
            {summary && (
                <div className="summary-cards">
                    <div className="summary-card">
                        <div className="summary-label">Miles This Year</div>
                        <div className="summary-value">{fmtMi(summary.totalMiles)}</div>
                    </div>
                    <div className="summary-card">
                        <div className="summary-label">At 45p/mile</div>
                        <div className="summary-value">{fmtMi(summary.milesAt45p)}</div>
                    </div>
                    <div className="summary-card">
                        <div className="summary-label">At 25p/mile</div>
                        <div className="summary-value">{fmtMi(summary.milesAt25p)}</div>
                    </div>
                    <div className="summary-card" style={{ borderLeft: '4px solid #198754' }}>
                        <div className="summary-label">Total Owed to Director</div>
                        <div className="summary-value" style={{ color: '#198754' }}>{fmtCcy(summary.totalAmount)}</div>
                    </div>
                    <div className="summary-card" style={{ borderLeft: '4px solid #0d6efd' }}>
                        <div className="summary-label">Unclaimed</div>
                        <div className="summary-value" style={{ color: '#6c757d' }}>{summary.draftCount}</div>
                    </div>
                    <div className="summary-card" style={{ borderLeft: '4px solid #fd7e14' }}>
                        <div className="summary-label">Claimed / Posted</div>
                        <div className="summary-value" style={{ color: '#fd7e14' }}>{summary.claimedCount}</div>
                    </div>
                    <div className="summary-card" style={{ borderLeft: '4px solid #0dcaf0' }}>
                        <div className="summary-label">Paid</div>
                        <div className="summary-value" style={{ color: '#0dcaf0' }}>{summary.paidCount}</div>
                    </div>
                </div>
            )}

            {/* ── Threshold Progress Bar ── */}
            <ThresholdBar />

            {/* ── Tabs ── */}
            <div className="tab-bar" style={{ marginBottom: 16 }}>
                <button
                    className={`tab-btn ${activeTab === 'trips' ? 'active' : ''}`}
                    onClick={() => setActiveTab('trips')}
                >
                    Trips ({trips.length})
                </button>
                <button
                    className={`tab-btn ${activeTab === 'claims' ? 'active' : ''}`}
                    onClick={() => setActiveTab('claims')}
                >
                    Claims ({claims.length})
                </button>
            </div>

            {/* ── TRIPS TAB ── */}
            {activeTab === 'trips' && (
                <div>
                    {trips.length === 0 ? (
                        <div className="empty-state">
                            <p>No trips recorded for {taxYear}.</p>
                            <button className="btn-primary" onClick={openAddForm}>Record your first trip</button>
                        </div>
                    ) : (
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Trip ID</th>
                                        <th>Date</th>
                                        <th>Director</th>
                                        <th>Route</th>
                                        <th>Miles</th>
                                        <th>45p</th>
                                        <th>25p</th>
                                        <th>Amount</th>
                                        <th>Purpose</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trips.map(trip => (
                                        <tr
                                            key={trip.id}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => setViewingTrip(trip)}
                                            title="Click to view details"
                                        >
                                            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{trip.tripId}</td>
                                            <td>{trip.tripDate ? new Date(trip.tripDate).toLocaleDateString('en-GB') : '—'}</td>
                                            <td>{trip.director}</td>
                                            <td>
                                                <span title={`${trip.startLocation} → ${trip.endLocation}`}>
                                                    {trip.startLocation?.substring(0, 18)}{trip.startLocation?.length > 18 ? '…' : ''}
                                                    {' → '}
                                                    {trip.endLocation?.substring(0, 18)}{trip.endLocation?.length > 18 ? '…' : ''}
                                                    {trip.isReturn && <span style={{ fontSize: 10, color: '#6c757d' }}> (return)</span>}
                                                </span>
                                                {trip.mapLink && (
                                                    <a
                                                        href={trip.mapLink}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View route on Google Maps"
                                                        style={{ marginLeft: 4, fontSize: 12 }}
                                                        onClick={e => e.stopPropagation()}
                                                    >🗺️</a>
                                                )}
                                            </td>
                                            <td>{fmtMi(trip.miles)}</td>
                                            <td style={{ color: '#198754' }}>{fmtMi(trip.milesAt45p)}</td>
                                            <td style={{ color: '#dc3545' }}>{trip.milesAt25p > 0 ? fmtMi(trip.milesAt25p) : '—'}</td>
                                            <td style={{ fontWeight: 600 }}>{fmtCcy(trip.totalAmount)}</td>
                                            <td title={trip.purpose}>{trip.purpose?.substring(0, 22)}{trip.purpose?.length > 22 ? '…' : ''}</td>
                                            <td>{statusBadge(trip.status)}</td>
                                            <td onClick={e => e.stopPropagation()}>
                                                {trip.status === 'Draft' && (
                                                    <>
                                                        <button
                                                            className="btn-icon"
                                                            title="Edit"
                                                            onClick={() => openEditForm(trip)}
                                                        >✏️</button>
                                                        {allowDataDeletion && (
                                                            <button
                                                                className="btn-icon btn-danger-icon"
                                                                title="Delete"
                                                                onClick={() => handleDeleteTrip(trip)}
                                                            >🗑️</button>
                                                        )}
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ fontWeight: 700, background: '#f8f9fa' }}>
                                        <td colSpan={4}>Total</td>
                                        <td>{fmtMi(trips.reduce((s, t) => s + (t.miles ?? 0), 0))}</td>
                                        <td style={{ color: '#198754' }}>{fmtMi(trips.reduce((s, t) => s + (t.milesAt45p ?? 0), 0))}</td>
                                        <td style={{ color: '#dc3545' }}>{fmtMi(trips.reduce((s, t) => s + (t.milesAt25p ?? 0), 0))}</td>
                                        <td>{fmtCcy(trips.reduce((s, t) => s + (t.totalAmount ?? 0), 0))}</td>
                                        <td colSpan={3} />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}

                    {/* Generate Claim button if there are unclaimed draft trips */}
                    {trips.some(t => t.status === 'Draft' && !t.claimId) && (
                        <div style={{ marginTop: 16 }}>
                            <button
                                className="btn-secondary"
                                onClick={() => {
                                    setClaimForm(prev => ({ ...prev, director: filterDirector || directors[0] || '' }));
                                    setShowClaimModal(true);
                                }}
                                disabled={processing}
                            >
                                📋 Generate Claim from Draft Trips
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── CLAIMS TAB ── */}
            {activeTab === 'claims' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                        <button
                            className="btn-secondary"
                            onClick={() => {
                                setClaimForm(prev => ({ ...prev, director: filterDirector || directors[0] || '' }));
                                setShowClaimModal(true);
                            }}
                            disabled={processing}
                        >
                            📋 Generate Claim
                        </button>
                    </div>

                    {claims.length === 0 ? (
                        <div className="empty-state">
                            <p>No claims yet. Generate a claim from your Draft trips.</p>
                        </div>
                    ) : (
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Claim Ref</th>
                                        <th>Director</th>
                                        <th>Period</th>
                                        <th>Tax Year</th>
                                        <th>Miles</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                        <th>DLA ID</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {claims.map(claim => (
                                        <tr key={claim.id}>
                                            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{claim.claimRef}</td>
                                            <td>{claim.director}</td>
                                            <td style={{ fontSize: 12 }}>
                                                {claim.periodStart ? new Date(claim.periodStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}
                                                {' – '}
                                                {claim.periodEnd ? new Date(claim.periodEnd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                                            </td>
                                            <td>{claim.taxYear}</td>
                                            <td>{fmtMi(claim.totalMiles)}</td>
                                            <td style={{ fontWeight: 600 }}>{fmtCcy(claim.totalAmount)}</td>
                                            <td>{statusBadge(claim.status)}</td>
                                            <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#6c757d' }}>
                                                {claim.dlaEntryId ? `#${claim.dlaEntryId}` : '—'}
                                            </td>
                                            <td>
                                                {claim.status === 'Draft' && (
                                                    <button
                                                        className="btn-primary"
                                                        style={{ fontSize: 12, padding: '4px 10px' }}
                                                        onClick={() => handleSubmitClaim(claim)}
                                                        disabled={processing}
                                                    >
                                                        Submit → DLA
                                                    </button>
                                                )}
                                                {(claim.status === 'Posted' || claim.status === 'Submitted') && (
                                                    <button
                                                        className="btn-secondary"
                                                        style={{ fontSize: 12, padding: '4px 10px' }}
                                                        onClick={() => handleMarkPaid(claim)}
                                                        disabled={processing}
                                                    >
                                                        ✓ Mark Paid
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── TRIP VIEW MODAL ── */}
            {viewingTrip && (
                <div className="modal-overlay" onClick={() => setViewingTrip(null)}>
                    <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🚗 {viewingTrip.tripId}</h3>
                            <button className="modal-close" onClick={() => setViewingTrip(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            {/* Status banner */}
                            <div style={{ marginBottom: 16 }}>
                                {statusBadge(viewingTrip.status)}
                                {viewingTrip.status === 'Draft' && (
                                    <span style={{ fontSize: 12, color: '#6c757d', marginLeft: 10 }}>
                                        Recorded but not yet claimed — click <strong>Edit</strong> to make changes, or close and use <strong>Generate Claim</strong> when ready.
                                    </span>
                                )}
                                {viewingTrip.claimRef && (
                                    <span style={{ fontSize: 12, color: '#6c757d', marginLeft: 10 }}>
                                        Claim: <strong>{viewingTrip.claimRef}</strong>
                                    </span>
                                )}
                            </div>

                            {/* Details grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: 14, marginBottom: 16 }}>
                                <div>
                                    <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Date</div>
                                    <div>{viewingTrip.tripDate ? new Date(viewingTrip.tripDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Director</div>
                                    <div>{viewingTrip.director}</div>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Route</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span><strong>{viewingTrip.startLocation}</strong></span>
                                        <span style={{ color: '#6c757d' }}>→</span>
                                        <span><strong>{viewingTrip.endLocation}</strong></span>
                                        {viewingTrip.isReturn && <span style={{ fontSize: 11, color: '#6c757d' }}>(return journey)</span>}
                                        {viewingTrip.mapLink && (
                                            <a href={viewingTrip.mapLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>🗺️ Map</a>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Total Miles</div>
                                    <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtMi(viewingTrip.miles)}</div>
                                    {viewingTrip.isReturn && (
                                        <div style={{ fontSize: 11, color: '#6c757d' }}>{(viewingTrip.miles / 2).toFixed(1)} mi × 2</div>
                                    )}
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Allowance</div>
                                    <div style={{ fontWeight: 700, fontSize: 16, color: '#198754' }}>{fmtCcy(viewingTrip.totalAmount)}</div>
                                    <div style={{ fontSize: 11, color: '#6c757d' }}>
                                        {viewingTrip.milesAt45p > 0 && `${fmtMi(viewingTrip.milesAt45p)} @ 45p`}
                                        {viewingTrip.milesAt25p > 0 && ` + ${fmtMi(viewingTrip.milesAt25p)} @ 25p`}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Category</div>
                                    <div>{viewingTrip.category || '—'}</div>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Business Purpose</div>
                                    <div>{viewingTrip.purpose || '—'}</div>
                                </div>
                                {viewingTrip.notes && (
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <div style={{ fontSize: 11, color: '#6c757d', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Notes</div>
                                        <div style={{ color: '#6c757d' }}>{viewingTrip.notes}</div>
                                    </div>
                                )}
                            </div>

                            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                {viewingTrip.status === 'Draft' && (
                                    <>
                                        {allowDataDeletion && (
                                            <button
                                                className="btn-danger"
                                                style={{ fontSize: 13 }}
                                                onClick={() => { setViewingTrip(null); handleDeleteTrip(viewingTrip); }}
                                            >🗑️ Delete</button>
                                        )}
                                        <button
                                            className="btn-secondary"
                                            onClick={() => { setViewingTrip(null); openEditForm(viewingTrip); }}
                                        >✏️ Edit</button>
                                    </>
                                )}
                                <button className="btn-primary" onClick={() => setViewingTrip(null)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── TRIP FORM MODAL ── */}
            {showForm && (
                <div className="modal-overlay" onClick={() => setShowForm(false)}>
                    <div className="modal-content" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingTrip ? `Edit Trip — ${editingTrip.tripId}` : 'Record Mileage Trip'}</h3>
                            <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
                        </div>
                        <form onSubmit={handleSaveTrip} className="modal-body">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div className="form-group">
                                    <label>Date *</label>
                                    <input type="date" name="tripDate" value={form.tripDate}
                                        onChange={handleFormChange} className="form-control" required />
                                </div>
                                <div className="form-group">
                                    <label>Director *</label>
                                    {directors.length > 0 ? (
                                        <select name="director" value={form.director}
                                            onChange={handleFormChange} className="form-select" required>
                                            <option value="">Select…</option>
                                            {directors.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    ) : (
                                        <input type="text" name="director" value={form.director}
                                            onChange={handleFormChange} className="form-control" required placeholder="Director name" />
                                    )}
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Start Location *</label>
                                <input type="text" name="startLocation" value={form.startLocation}
                                    onChange={handleFormChange} className="form-control" required
                                    placeholder="e.g. 123 High Street, London, SW1A 1AA" />
                            </div>

                            <div className="form-group">
                                <label>End Location *</label>
                                <input type="text" name="endLocation" value={form.endLocation}
                                    onChange={handleFormChange} className="form-control" required
                                    placeholder="e.g. Client Office, Manchester, M1 1AA" />
                            </div>

                            {/* Map & distance lookup */}
                            {form.startLocation && form.endLocation && (
                                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <button
                                        type="button"
                                        className="btn-primary"
                                        style={{ fontSize: 13 }}
                                        onClick={lookupDistance}
                                        disabled={distanceLookup.loading}
                                        title="Auto-calculate driving distance using OpenStreetMap routing"
                                    >
                                        {distanceLookup.loading ? '⏳ Calculating…' : '📍 Get Driving Distance'}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{ fontSize: 13 }}
                                        onClick={openMaps}
                                    >
                                        🗺️ View on Google Maps
                                    </button>
                                    {distanceLookup.error && (
                                        <span style={{ fontSize: 12, color: '#dc3545' }}>⚠️ {distanceLookup.error}</span>
                                    )}
                                    {distanceLookup.result && !distanceLookup.loading && !distanceLookup.error && (
                                        <span style={{ fontSize: 12, color: '#198754' }}>
                                            ✓ {distanceLookup.result.toFixed(1)} mi one-way
                                        </span>
                                    )}
                                </div>
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div className="form-group">
                                    <label>
                                        Miles {form.isReturn ? '(one-way)' : '(total)'} *
                                    </label>
                                    <input type="number" name="miles" value={form.miles}
                                        onChange={handleFormChange} className="form-control" required
                                        min="0.1" step="0.1" placeholder="0.0" />
                                    {form.isReturn && parseFloat(form.miles) > 0 && (
                                        <small style={{ color: '#6c757d' }}>
                                            Return total: {(parseFloat(form.miles) * 2).toFixed(1)} miles
                                        </small>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label>Category</label>
                                    <select name="category" value={form.category}
                                        onChange={handleFormChange} className="form-select">
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Return toggle */}
                            <div className="form-group">
                                <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                    <input type="checkbox" name="isReturn" checked={form.isReturn}
                                        onChange={handleFormChange} style={{ width: 16, height: 16 }} />
                                    <span>Return journey <small style={{ color: '#6c757d' }}>(miles entered above will be doubled)</small></span>
                                </label>
                            </div>

                            <div className="form-group">
                                <label>Business Purpose * <small style={{ color: '#6c757d' }}>(HMRC requires this)</small></label>
                                <input type="text" name="purpose" value={form.purpose}
                                    onChange={handleFormChange} className="form-control" required
                                    placeholder="e.g. Client meeting — Acme Ltd annual review" />
                            </div>

                            <div className="form-group">
                                <label>Notes</label>
                                <textarea name="notes" value={form.notes}
                                    onChange={handleFormChange} className="form-control" rows={2}
                                    placeholder="Optional notes" />
                            </div>

                            {/* Live rate preview */}
                            {summary && parseFloat(form.miles) > 0 && (
                                <div style={{
                                    background: '#f0f9f4', border: '1px solid #b2dfdb',
                                    borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13
                                }}>
                                    <strong>Estimated allowance:</strong>
                                    {' '}
                                    {(() => {
                                        const total  = computedMiles();
                                        const prior  = summary.totalMiles ?? 0;
                                        const thresh = companySettings?.amapThresholdMiles ?? summary?.thresholdMiles ?? 10000;
                                        const r45    = companySettings?.amapRate45p ?? summary?.rate45p ?? 0.45;
                                        const r25    = companySettings?.amapRate25p ?? summary?.rate25p ?? 0.25;
                                        const rem45  = Math.max(0, thresh - prior);
                                        const at45   = Math.min(total, rem45);
                                        const at25   = Math.max(0, total - rem45);
                                        const amount = (at45 * r45) + (at25 * r25);
                                        const p45 = Math.round(r45 * 100);
                                        const p25 = Math.round(r25 * 100);
                                        return (
                                            <>
                                                <strong style={{ color: '#198754' }}>£{amount.toFixed(2)}</strong>
                                                {' '}({at45.toFixed(1)} mi @ {p45}p
                                                {at25 > 0 ? ` + ${at25.toFixed(1)} mi @ ${p25}p` : ''})
                                                {prior + total > thresh && prior < thresh && (
                                                    <span style={{ color: '#dc3545', marginLeft: 8 }}>⚠️ Crosses {thresh.toLocaleString()} mile threshold</span>
                                                )}
                                                {prior >= thresh && (
                                                    <span style={{ color: '#dc3545', marginLeft: 8 }}>ℹ️ All at {p25}p — threshold already reached</span>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                                <button type="submit" className="btn-primary" disabled={processing}>
                                    {processing ? 'Saving…' : editingTrip ? 'Update Trip' : 'Save Trip'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── GENERATE CLAIM MODAL ── */}
            {showClaimModal && (
                <div className="modal-overlay" onClick={() => setShowClaimModal(false)}>
                    <div className="modal-content" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Generate Mileage Claim</h3>
                            <button className="modal-close" onClick={() => setShowClaimModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleGenerateClaim} className="modal-body">
                            <p style={{ fontSize: 13, color: '#6c757d', marginTop: 0 }}>
                                All unclaimed Draft trips within this period will be bundled into a new claim.
                            </p>
                            <div className="form-group">
                                <label>Director *</label>
                                {directors.length > 0 ? (
                                    <select value={claimForm.director}
                                        onChange={e => setClaimForm(p => ({ ...p, director: e.target.value }))}
                                        className="form-select" required>
                                        <option value="">Select…</option>
                                        {directors.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                ) : (
                                    <input type="text" value={claimForm.director}
                                        onChange={e => setClaimForm(p => ({ ...p, director: e.target.value }))}
                                        className="form-control" required placeholder="Director name" />
                                )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div className="form-group">
                                    <label>Period Start *</label>
                                    <input type="date" value={claimForm.periodStart}
                                        onChange={e => setClaimForm(p => ({ ...p, periodStart: e.target.value }))}
                                        className="form-control" required />
                                </div>
                                <div className="form-group">
                                    <label>Period End *</label>
                                    <input type="date" value={claimForm.periodEnd}
                                        onChange={e => setClaimForm(p => ({ ...p, periodEnd: e.target.value }))}
                                        className="form-control" required />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Notes</label>
                                <textarea value={claimForm.notes}
                                    onChange={e => setClaimForm(p => ({ ...p, notes: e.target.value }))}
                                    className="form-control" rows={2} placeholder="Optional notes" />
                            </div>
                            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                <button type="button" className="btn-secondary" onClick={() => setShowClaimModal(false)}>Cancel</button>
                                <button type="submit" className="btn-primary" disabled={processing}>
                                    {processing ? 'Generating…' : 'Generate Claim'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmDeleteModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                itemLabels={confirmModal.itemLabels}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(m => ({ ...m, isOpen: false }))}
            />
        </div>
    );
};

export default MileageTrips;
