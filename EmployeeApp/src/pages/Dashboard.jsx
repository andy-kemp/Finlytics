

import { useAuth, useUser } from '@clerk/react'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getProfile, getExpenses, getMileage, getMileageTracker } from '../services/api'

const StatCard = ({ label, value, icon, className = '' }) => (
  <div className={`stat-card ${className}`}>
    <div className="stat-icon">{icon}</div>
    <div className="stat-info">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  </div>
);

export default function Dashboard() {
  const { getToken } = useAuth()
  const { user } = useUser()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showExpenseSheet, setShowExpenseSheet] = useState(false)
  const sheetRef = useRef(null)

  useEffect(() => {
    async function load() {
      try {
        const [prof, expensesRaw, mileageRaw, tracker] = await Promise.all([
          getProfile(getToken),
          getExpenses(getToken).catch(() => []),
          getMileage(getToken).catch(() => []),
          getMileageTracker(getToken).catch(() => null),
        ])
        const expenses = Array.isArray(expensesRaw) ? expensesRaw : []
        const mileage = Array.isArray(mileageRaw) ? mileageRaw : []
        setProfile(prof)
        setStats({
          totalExpenses: expenses.length,
          pendingExpenses: expenses.filter(e => e.approvalStatus === 'Submitted').length,
          approvedExpenses: expenses.filter(e => e.approvalStatus === 'Approved').length,
          rejectedExpenses: expenses.filter(e => e.approvalStatus === 'Rejected').length,
          totalMileageTrips: mileage.length,
          mileageTracker: tracker,
        })
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [getToken])

  // Close the action sheet when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (sheetRef.current && !sheetRef.current.contains(e.target)) {
        setShowExpenseSheet(false)
      }
    }
    if (showExpenseSheet) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showExpenseSheet])

  if (loading) return <div className="loading">Loading dashboard...</div>
  if (error) return <div className="error-banner">⚠️ {error}</div>

  const tracker = stats?.mileageTracker
  const primaryRatePence = tracker?.rateBelow ? Math.round(tracker.rateBelow * 100) : 55
  const secondaryRatePence = tracker?.rateAbove ? Math.round(tracker.rateAbove * 100) : 25
  const pct = tracker?.percentUsed || 0
  const todayStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const displayName = user?.fullName || user?.firstName || profile?.displayName || 'there'

  return (
    <div className="dashboard">
      {/* Hero banner */}
      <div className="dashboard-hero">
        <img src="/finlytics-logo.png" alt="Finlytics" className="hero-logo" />
        <div className="hero-info">
          <div className="hero-date">{todayStr}</div>
          <div className="hero-greeting">Welcome back, {displayName} 👋</div>
        </div>
      </div>

      <div className="quick-actions">
        <div className="action-wrapper" ref={sheetRef}>
          <button className="btn btn-primary" onClick={() => setShowExpenseSheet(!showExpenseSheet)}>
            ＋ New Expense
          </button>
          {showExpenseSheet && (
            <div className="action-sheet">
              <div className="action-sheet-header">How would you like to add an expense?</div>
              <button className="action-sheet-item" onClick={() => navigate('/expenses?mode=scan')}>
                <span className="action-sheet-icon">📸</span>
                <div className="action-sheet-text">
                  <strong>Scan Receipt</strong>
                  <span>Take a photo or use your camera</span>
                </div>
              </button>
              <button className="action-sheet-item" onClick={() => navigate('/expenses?mode=upload')}>
                <span className="action-sheet-icon">📎</span>
                <div className="action-sheet-text">
                  <strong>Upload File</strong>
                  <span>Upload a photo, image, or PDF</span>
                </div>
              </button>
              <button className="action-sheet-item" onClick={() => navigate('/expenses?mode=manual')}>
                <span className="action-sheet-icon">✏️</span>
                <div className="action-sheet-text">
                  <strong>Manual Entry</strong>
                  <span>Enter expense details by hand</span>
                </div>
              </button>
            </div>
          )}
        </div>
        <button className="btn btn-accent" onClick={() => navigate('/mileage?new=true')}>
          ＋ Add Mileage
        </button>
      </div>

      <div className="dashboard-grid">
        <div className="main-content">
          <h2 className="section-title">💰 Expenses</h2>
          <div className="stat-grid">
            <StatCard label="Total Expenses" value={stats.totalExpenses} icon="🧾" />
            <StatCard label="Pending Approval" value={stats.pendingExpenses} icon="⏳" className="pending" />
            <StatCard label="Approved" value={stats.approvedExpenses} icon="✅" className="approved" />
            <StatCard label="Rejected" value={stats.rejectedExpenses} icon="❌" className="rejected" />
          </div>

          <h2 className="section-title">🚗 Mileage</h2>
          <div className="stat-grid">
            <StatCard label="Mileage Trips" value={stats.totalMileageTrips} icon="🗺️" />
            <StatCard label="Miles Logged" value={tracker?.totalMilesLogged?.toLocaleString() || 0} icon="📏" />
          </div>
        </div>

        <aside className="sidebar-content">
          {tracker && (
            <div className="tracker-card">
              <h2 className="section-title">Mileage Allowance {tracker.taxYear}</h2>
              <div className="tracker-bar-container">
                <div className="tracker-bar" style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <div className="tracker-stats">
                <span>{tracker.approvedMiles?.toLocaleString()} / {tracker.threshold?.toLocaleString()} mi</span>
                <span className="tracker-pct">{pct}%</span>
              </div>
              <div className="tracker-details">
                <div className="detail-item">
                  <span>At {primaryRatePence}p ({tracker.milesAt45p?.toLocaleString()} mi)</span>
                  <strong>£{tracker.amountClaimed?.toFixed(2)}</strong>
                </div>
                <div className="detail-item">
                  <span>Remaining at {primaryRatePence}p</span>
                  <strong>{tracker.remainingMilesAt45p?.toLocaleString()} mi (£{tracker.remainingValueAt45p?.toFixed(2)})</strong>
                </div>
                {tracker.isOver10k && (
                  <div className="rate-warning">⚠️ Over 10,000 miles — rate now {secondaryRatePence}p/mile</div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
