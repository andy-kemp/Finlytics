import React from 'react';
import './BankAttentionPanel.css';

const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);

export default function BankAttentionPanel({ attention, error, onReview }) {
    const duplicates = Boolean(attention?.possibleDuplicatePayments.length);
    return <section className="bank-attention-panel" aria-label="Bank payments needing attention">
        <div className="bank-attention-header">
            <h3>Needs Attention{attention ? ` (${attention.missing.length})` : ''}</h3>
            {attention && !duplicates && <div className="bank-attention-totals">
                <span>Unrecorded money out <strong>{money(attention.moneyOut)}</strong></span>
                <span>Unrecorded money in <strong>{money(attention.moneyIn)}</strong></span>
            </div>}
        </div>
        {error ? <p role="alert">Bank payment review unavailable: {error}</p>
            : duplicates ? <div className="bank-attention-warning" role="alert">
                <span>Possible duplicate bank payments need review. Totals are unavailable.</span>
                <button className="btn-secondary" onClick={() => onReview?.(null)}>Review Bank Rows</button>
            </div>
                : attention?.missing.length === 0 ? <p className="bank-attention-empty">No unrecorded bank payments.</p> : null}
        {attention?.missing.length > 0 && <table className="bank-attention-table">
            <thead><tr><th>Date</th><th>Payment</th><th>Money Out</th><th>Money In</th><th>Action</th></tr></thead>
            <tbody>{attention.missing.map(transaction => <tr key={transaction.id}>
                <td data-label="Date">{String(transaction.transactionDate).slice(0, 10)}</td>
                <td data-label="Payment">{transaction.monzoMerchantName || transaction.description}</td>
                <td data-label="Money Out">{transaction.direction === 'Out' ? money(transaction.amount) : '-'}</td>
                <td data-label="Money In">{transaction.direction === 'In' ? money(transaction.amount) : '-'}</td>
                <td data-label="Action"><button className="btn-secondary" disabled={duplicates || !onReview}
                    onClick={() => onReview(transaction)}>{transaction.direction === 'Out' ? 'Record Expense' : 'Review Payment'}</button></td>
            </tr>)}</tbody>
        </table>}
    </section>;
}