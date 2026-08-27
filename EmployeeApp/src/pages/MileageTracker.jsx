import { useAuth } from '@clerk/react'
import { useState, useEffect } from 'react'
import { getMileageTracker } from '../services/api'

export default function MileageTracker() {
  const { getToken } = useAuth()
  const [tracker, setTracker] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await getMileageTracker(getToken)
        setTracker(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [getToken])

  if (loading) return <div className="loading">Loading mileage tracker...</div>
  if (error) return <div className="error-banner">⚠️ {error}</div>
  if (!tracker) return <div className="empty">No tracker data available.</div>

  const pct = tracker.percentUsed || 0
  const barColor = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981'
  const rateBelow = tracker.rateBelow ?? 0.55
  const rateAbove = tracker.rateAbove ?? 0.25
  const rateBelowPence = Math.round(rateBelow * 100)
  const rateAbovePence = Math.round(rateAbove * 100)

  return (
    <div className="page">
      <h1>🚗 HMRC Mileage Tracker</h1>
      <p className="subtitle">Tax Year {tracker.taxYear}</p>

      <div className="tracker-hero">
        <div className="tracker-circle">
          <svg viewBox="0 0 120 120" className="tracker-svg">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#1e293b" strokeWidth="10" />
            <circle
              cx="60" cy="60" r="52" fill="none"
              stroke={barColor} strokeWidth="10"
              strokeDasharray={`${Math.min(pct, 100) * 3.267} 326.7`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="tracker-circle-text">
            <span className="tracker-pct-large">{pct}%</span>
            <span className="tracker-pct-label">used</span>
          </div>
        </div>
      </div>

      <div className="tracker-detail-grid">
        <div className="detail-card">
          <div className="detail-value">{tracker.approvedMiles?.toLocaleString()}</div>
          <div className="detail-label">Approved Miles</div>
        </div>
        <div className="detail-card">
          <div className="detail-value">{tracker.pendingMiles?.toLocaleString()}</div>
          <div className="detail-label">Pending Miles</div>
        </div>
        <div className="detail-card">
          <div className="detail-value">{tracker.threshold?.toLocaleString()}</div>
          <div className="detail-label">HMRC Threshold</div>
        </div>
        <div className="detail-card">
          <div className="detail-value">{tracker.remainingMilesAt45p?.toLocaleString()}</div>
          <div className="detail-label">Remaining at {rateBelowPence}p</div>
        </div>
      </div>

      <div className="rate-breakdown">
        <h2>Rate Breakdown</h2>
        <table className="rate-table">
          <thead>
            <tr><th>Band</th><th>Miles</th><th>Rate</th><th>Amount</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>First 10,000</td>
              <td>{tracker.milesAt45p?.toLocaleString()}</td>
              <td>{rateBelowPence}p</td>
              <td>£{((tracker.milesAt45p || 0) * rateBelow).toFixed(2)}</td>
            </tr>
            <tr className={tracker.isOver10k ? 'active-rate' : 'inactive-rate'}>
              <td>Over 10,000</td>
              <td>{tracker.milesAt25p?.toLocaleString()}</td>
              <td>{rateAbovePence}p</td>
              <td>£{((tracker.milesAt25p || 0) * rateAbove).toFixed(2)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="3"><strong>Total Claimed</strong></td>
              <td><strong>£{tracker.amountClaimed?.toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {tracker.isOver10k && (
        <div className="rate-warning-banner">
          ⚠️ You've exceeded 10,000 miles this tax year. Additional miles are now reimbursed at <strong>{rateAbovePence}p/mile</strong> instead of {rateBelowPence}p/mile.
        </div>
      )}

      <div className="remaining-card">
        <h3>Remaining Allowance at {rateBelowPence}p</h3>
        <div className="remaining-value">
          {tracker.remainingMilesAt45p?.toLocaleString()} miles = <strong>£{tracker.remainingValueAt45p?.toFixed(2)}</strong>
        </div>
      </div>
    </div>
  )
}
