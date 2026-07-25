import React, { useEffect, useState } from 'react';
import {
    getUnreconciledTransactions,
    createReconciliationMatch,
    previewAutoReconcileTransactions,
    applyAutoReconcileTransactions
} from '../services/apiService';

export default function Reconciliation() {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [message, setMessage] = useState(null);
    const [preview, setPreview] = useState(null);
    const [selectedMatches, setSelectedMatches] = useState({});

    useEffect(() => {
        loadTransactions();
    }, []);

    async function loadTransactions() {
        try {
            const data = await getUnreconciledTransactions();
            setTransactions(data);
        } catch (error) {
            console.error('Error loading unreconciled transactions:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleReconcile(tx) {
        const relatedType = prompt('Match type (Invoice/Expense/Transfer/Payroll/Other):', 'Expense');
        if (!relatedType) return;
        const relatedId = prompt('Related ID (optional):', '');
        const notes = prompt('Notes (optional):', '');

        setProcessing(true);
        try {
            await createReconciliationMatch({
                bankTransactionId: tx.id,
                relatedType,
                relatedId,
                matchType: 'Manual',
                notes
            });
            await loadTransactions();
        } catch (error) {
            console.error('Error reconciling transaction:', error);
            alert('Failed to reconcile: ' + error.message);
        } finally {
            setProcessing(false);
        }
    }

    async function handleAutoReconcilePreview() {
        setProcessing(true);
        setMessage(null);
        try {
            const result = await previewAutoReconcileTransactions();
            const defaults = {};
            (result.proposals || []).forEach((proposal) => {
                if (proposal.recommended) {
                    defaults[proposal.bankTransactionId] = `${proposal.recommended.relatedType}:${proposal.recommended.relatedId}`;
                }
            });
            setSelectedMatches(defaults);
            setPreview(result);
            setMessage({
                ok: true,
                text: result.message || `Found ${result.proposedCount || 0} potential matches`
            });
        } catch (error) {
            console.error('Error auto reconciling transactions:', error);
            setMessage({ ok: false, text: `Failed to build auto-reconcile preview: ${error.message}` });
        } finally {
            setProcessing(false);
        }
    }

    function getProposalByTxId(txId) {
        if (!preview || !preview.proposals) return null;
        return preview.proposals.find((item) => item.bankTransactionId === txId) || null;
    }

    function handleMatchSelection(txId, value) {
        setSelectedMatches((prev) => ({ ...prev, [txId]: value }));
    }

    async function handleApplyPreview() {
        if (!preview || !preview.proposals || preview.proposals.length === 0) {
            return;
        }

        const proposalsToApply = preview.proposals
            .map((proposal) => {
                const selected = selectedMatches[proposal.bankTransactionId];
                if (!selected) return null;

                const [relatedType, relatedId] = selected.split(':');
                const chosen = (proposal.candidates || []).find((c) => c.relatedType === relatedType && String(c.relatedId) === String(relatedId));
                if (!chosen) return null;

                return {
                    bankTransactionId: proposal.bankTransactionId,
                    relatedType: chosen.relatedType,
                    relatedId: String(chosen.relatedId),
                    notes: chosen.notes
                };
            })
            .filter(Boolean);

        if (proposalsToApply.length === 0) {
            alert('No matches selected to apply.');
            return;
        }

        const confirmed = window.confirm(`Apply ${proposalsToApply.length} proposed reconciliation(s)?`);
        if (!confirmed) return;

        setProcessing(true);
        setMessage(null);
        try {
            const result = await applyAutoReconcileTransactions(proposalsToApply);
            setMessage({ ok: true, text: result.message || `Applied ${result.applied || 0} reconciliation(s)` });
            setPreview(null);
            setSelectedMatches({});
            await loadTransactions();
        } catch (error) {
            console.error('Error applying auto reconcile preview:', error);
            setMessage({ ok: false, text: `Failed to apply auto reconciliation: ${error.message}` });
        } finally {
            setProcessing(false);
        }
    }

    return (
        <div className="content-container">
            <div className="section-header">
                <h2>Reconciliation</h2>
                <button className="btn-secondary" onClick={handleAutoReconcilePreview} disabled={processing || loading}>
                    Auto Reconcile (Preview)
                </button>
            </div>

            {message && (
                <div style={{
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    borderRadius: 8,
                    border: `1px solid ${message.ok ? '#bbf7d0' : '#fca5a5'}`,
                    background: message.ok ? '#f0fdf4' : '#fef2f2',
                    color: message.ok ? '#15803d' : '#dc2626',
                    fontWeight: 500
                }}>
                    {message.ok ? '[OK]' : '[ERR]'} {message.text}
                </div>
            )}

            {preview && (
                <div style={{
                    marginBottom: '1rem',
                    padding: '1rem',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc'
                }}>
                    <div style={{ marginBottom: '0.75rem' }}>
                        <strong>Preview summary:</strong> {preview.proposedCount || 0} proposed, {preview.ambiguousCount || 0} ambiguous, {preview.unmatchedCount || 0} unmatched
                    </div>

                    {(preview.proposals || []).length > 0 ? (
                        <div className="table-container" style={{ marginBottom: '0.75rem' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Description</th>
                                        <th>Amount</th>
                                        <th>Suggested Match</th>
                                        <th>Confidence</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.proposals.map((proposal) => {
                                        const selected = selectedMatches[proposal.bankTransactionId] || '';
                                        const chosen = getProposalByTxId(proposal.bankTransactionId)?.candidates?.find(
                                            (c) => `${c.relatedType}:${c.relatedId}` === selected
                                        );

                                        return (
                                            <tr key={proposal.bankTransactionId}>
                                                <td>{proposal.date ? proposal.date.substring(0, 10) : ''}</td>
                                                <td>{proposal.description}</td>
                                                <td>{proposal.amount ? `GBP ${proposal.amount}` : ''}</td>
                                                <td>
                                                    <select
                                                        value={selected}
                                                        onChange={(e) => handleMatchSelection(proposal.bankTransactionId, e.target.value)}
                                                        disabled={processing}
                                                        style={{ minWidth: 320 }}
                                                    >
                                                        <option value="">Do not apply</option>
                                                        {(proposal.candidates || []).map((candidate) => (
                                                            <option
                                                                key={`${proposal.bankTransactionId}-${candidate.relatedType}-${candidate.relatedId}`}
                                                                value={`${candidate.relatedType}:${candidate.relatedId}`}
                                                            >
                                                                {candidate.display} (score {candidate.score})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td>
                                                    {proposal.isAmbiguous ? 'Ambiguous' : 'High'}
                                                    {chosen ? ` / score ${chosen.score}` : ''}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div style={{ marginBottom: '0.75rem' }}>No proposed matches found.</div>
                    )}

                    {(preview.unmatched || []).length > 0 && (
                        <div style={{ marginBottom: '0.75rem', fontSize: '0.95rem', color: '#475569' }}>
                            Unmatched transactions will remain unreconciled and can be handled manually.
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn-primary" onClick={handleApplyPreview} disabled={processing}>
                            Confirm and Apply
                        </button>
                        <button
                            className="btn-secondary"
                            onClick={() => {
                                setPreview(null);
                                setSelectedMatches({});
                            }}
                            disabled={processing}
                        >
                            Cancel Preview
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="loading">Loading...</div>
            ) : (
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Description</th>
                                <th>Amount</th>
                                <th>Direction</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.map(tx => (
                                <tr key={tx.id}>
                                    <td>{tx.transactionDate ? tx.transactionDate.substring(0, 10) : ''}</td>
                                    <td>{tx.description}</td>
                                    <td>{tx.amount ? `£${tx.amount}` : ''}</td>
                                    <td>{tx.direction}</td>
                                    <td>
                                        <button className="btn-primary" onClick={() => handleReconcile(tx)} disabled={processing}>
                                            Reconcile
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
