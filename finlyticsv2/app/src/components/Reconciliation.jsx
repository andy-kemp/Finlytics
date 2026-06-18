import React, { useEffect, useState } from 'react';
import { getUnreconciledTransactions, createReconciliationMatch } from '../services/apiService';

export default function Reconciliation() {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

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

    return (
        <div className="content-container">
            <div className="section-header">
                <h2>Reconciliation</h2>
            </div>

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
