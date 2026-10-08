import React from 'react';

export default function BankImportPreview({ preview, processing, onConfirm, onCancel }) {
    const money = value => value == null ? 'Not supplied' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: preview.currency || 'GBP' }).format(value);
    const { statement, newTransactions, duplicates, rejected, fileName, comparisons = [] } = preview;
    const canImport = newTransactions.length > 0 && rejected.length === 0 && statement.balanceErrors.length === 0;
    return (
        <section aria-label="CSV import preview" style={{ marginBottom: '1rem', borderTop: '1px solid #cbd5e1', paddingTop: '1rem' }}>
            <h4 style={{ margin: '0 0 0.75rem', overflowWrap: 'anywhere' }}>{fileName}</h4>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', margin: '0 0 1rem' }}>
                {[
                    ['Transactions', statement.count], ['New / Duplicate', `${newTransactions.length} / ${duplicates.length}`],
                    ['Opening balance', money(statement.opening)], ['Statement balance', money(statement.closing)],
                    ['Money in', money(statement.incoming)], ['Money out', money(statement.outgoing)],
                    ['Net pot transfers', money(statement.potMovement)], ['Cash excluding pot transfers', money(statement.externalNet)],
                    ['Balance discrepancies', statement.balanceErrors.length], ['Rejected rows', rejected.length],
                    ['Missing app payments', preview.comparisonError ? 'Not checked' : comparisons.filter(row => row.status === 'Missing app payment').length],
                    ['App payments absent from statement', preview.unmatchedPayments?.length ?? 'Not checked']
                ].map(([label, value]) => <div key={label}><dt style={{ color: '#64748b', fontSize: '0.8rem' }}>{label}</dt><dd style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>{value}</dd></div>)}
            </dl>
            {preview.comparisonError && <p role="alert" style={{ color: '#b91c1c' }}>App comparison unavailable: {preview.comparisonError}</p>}
            {rejected.length > 0 && <ul role="alert">{rejected.map(row => <li key={row.row}>Row {row.row}: {row.reason}</li>)}</ul>}
            {statement.balanceErrors.length > 0 && <ul role="alert">{statement.balanceErrors.map((row, index) => <li key={index}>{row.date}: balance difference {money(row.difference)}</li>)}</ul>}
            <div className="table-container" style={{ maxHeight: 360, overflow: 'auto', marginBottom: '0.75rem' }}>
                <table className="data-table">
                    <thead><tr><th>Date</th><th>Description / Reference</th><th>Amount</th><th>Balance</th><th>Import</th><th>App Payment</th></tr></thead>
                    <tbody>{preview.transactions.map((transaction, index) => {
                        const comparison = comparisons[index];
                        return <tr key={`${transaction.externalId || index}-${index}`}>
                            <td style={{ whiteSpace: 'nowrap' }}>{transaction.transactionDate.substring(0, 10)}</td>
                            <td style={{ minWidth: 180, maxWidth: 360, overflowWrap: 'anywhere' }}>{transaction.description}<div style={{ color: '#64748b' }}>{transaction.reference}</div></td>
                            <td style={{ whiteSpace: 'nowrap' }}>{money(transaction.direction === 'Out' ? -transaction.amount : transaction.amount)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{money(transaction.balance)}</td>
                            <td>{duplicates.includes(transaction) ? 'Duplicate' : 'New'}</td>
                            <td style={{ minWidth: 180 }}>{transaction.category === 'Internal Transfer' ? 'Internal pot transfer' : comparison?.status || 'Not checked'}
                                {comparison?.candidates?.map(candidate => <div key={candidate.key} style={{ fontSize: '0.8rem' }}>{candidate.label}</div>)}
                            </td>
                        </tr>;
                    })}</tbody>
                </table>
            </div>
            {preview.unmatchedPayments?.length > 0 && <details style={{ marginBottom: '0.75rem' }}>
                <summary>App payments absent from statement ({preview.unmatchedPayments.length})</summary>
                <ul>{preview.unmatchedPayments.map(payment => <li key={payment.key}>{payment.date.substring(0, 10)}: {payment.label} ({money(payment.amount / 100)})</li>)}</ul>
            </details>}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="btn-primary" onClick={onConfirm} disabled={processing || !canImport}>{processing ? 'Importing...' : `Import ${newTransactions.length} New Transactions`}</button>
                <button className="btn-secondary" onClick={onCancel} disabled={processing}>Cancel</button>
            </div>
        </section>
    );
}