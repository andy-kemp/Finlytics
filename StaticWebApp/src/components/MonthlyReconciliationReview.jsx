import React from 'react';
import { defaultCtTag } from '../utils/monthlyReconciliation.mjs';

const gbp = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
const KIND_LABELS = { review: 'Needs manual review', blocked: 'Before cash baseline', done: 'Already reconciled', internal: 'Pot transfer' };

export default function MonthlyReconciliationReview({ proposals, categories, processing, canApply, onChange, onApply }) {
    const actionable = proposals.filter(proposal => proposal.kind === 'link' || proposal.kind === 'expense');
    const selected = actionable.filter(proposal => proposal.selected);
    const others = proposals.filter(proposal => proposal.kind in KIND_LABELS && proposal.kind !== 'internal' && proposal.kind !== 'done');
    const update = (index, change) => onChange(proposals.map(proposal => proposal.index === index ? { ...proposal, ...change } : proposal));
    const count = kind => proposals.filter(proposal => proposal.kind === kind).length;
    const withReceipt = actionable.filter(proposal => proposal.kind === 'expense' && proposal.receipt).length;
    const categoryOptions = categories.length ? categories : ['Other'];

    return <section aria-label="Monthly reconciliation review" style={{ marginBottom: '1rem', borderTop: '1px solid #cbd5e1', paddingTop: '1rem' }}>
        <h4 style={{ margin: '0 0 0.5rem' }}>Monthly Reconciliation</h4>
        <p style={{ margin: '0 0 0.75rem', color: '#475569' }}>
            {count('link')} to link to existing records · {count('expense')} new expenses ({withReceipt} with an inbox receipt, {count('expense') - withReceipt} receipt pending)
            · {count('internal')} pot transfers · {count('done')} already reconciled · {others.length} need your review
        </p>
        {actionable.length > 0 && <div className="table-container" style={{ maxHeight: 420, overflow: 'auto', marginBottom: '0.75rem' }}>
            <table className="data-table">
                <thead><tr><th><input type="checkbox" aria-label="Select all" checked={selected.length === actionable.length}
                    onChange={event => onChange(proposals.map(proposal => actionable.includes(proposal) ? { ...proposal, selected: event.target.checked } : proposal))} /></th>
                    <th>Date</th><th>Statement</th><th>Amount</th><th>Proposal</th><th>Supplier</th><th>Category</th><th>VAT</th></tr></thead>
                <tbody>{actionable.map(proposal => {
                    const { transaction } = proposal;
                    const expense = proposal.kind === 'expense';
                    const foreign = transaction.originalCurrency && transaction.originalCurrency !== 'GBP';
                    return <tr key={proposal.index}>
                        <td><input type="checkbox" aria-label={`Apply ${transaction.description}`} checked={proposal.selected}
                            onChange={event => update(proposal.index, { selected: event.target.checked })} /></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{transaction.transactionDate.substring(0, 10)}</td>
                        <td style={{ minWidth: 160, maxWidth: 260, overflowWrap: 'anywhere' }}>{transaction.description}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{gbp(transaction.direction === 'Out' ? -transaction.amount : transaction.amount)}
                            {foreign && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{transaction.originalCurrency} {Math.abs(transaction.originalAmount).toFixed(2)}</div>}</td>
                        <td style={{ minWidth: 170 }}>{expense
                            ? proposal.receipt
                                ? <span>New expense with receipt<div style={{ fontSize: '0.8rem', color: '#64748b', overflowWrap: 'anywhere' }}>{proposal.receipt.fileName}{proposal.receipt.documentDate ? ` (${proposal.receipt.documentDate})` : ''}</div></span>
                                : 'New expense - receipt pending'
                            : <span>Link to {proposal.label}</span>}</td>
                        <td>{expense && <input aria-label="Supplier" value={proposal.supplier} maxLength={255} style={{ minWidth: 140 }}
                            onChange={event => update(proposal.index, { supplier: event.target.value })} />}</td>
                        <td>{expense && <select aria-label="Category" value={proposal.category}
                            onChange={event => update(proposal.index, { category: event.target.value, ctTag: defaultCtTag(event.target.value) })}>
                            {categoryOptions.map(category => <option key={category} value={category}>{category}</option>)}
                        </select>}</td>
                        <td>{expense && <input aria-label="VAT" type="number" min="0" step="0.01" value={proposal.vatAmount} disabled={!!foreign}
                            title={foreign ? 'No UK VAT is claimed on foreign-currency card payments' : 'VAT shown on the receipt (max 1/6 of the amount)'}
                            style={{ width: 90 }} onChange={event => update(proposal.index, { vatAmount: event.target.value })} />}</td>
                    </tr>;
                })}</tbody>
            </table>
        </div>}
        {others.length > 0 && <details style={{ marginBottom: '0.75rem' }}>
            <summary>Rows that need your review ({others.length})</summary>
            <ul>{others.map(proposal => <li key={proposal.index}>{proposal.transaction.transactionDate.substring(0, 10)} {proposal.transaction.description}
                {' '}({gbp(proposal.transaction.direction === 'Out' ? -proposal.transaction.amount : proposal.transaction.amount)}): {proposal.reason || KIND_LABELS[proposal.kind]}</li>)}</ul>
        </details>}
        <button type="button" className="btn-primary" disabled={processing || !canApply || selected.length === 0} onClick={onApply}
            title={!canApply ? 'Resolve rejected rows or balance discrepancies first' : undefined}>
            {processing ? 'Applying...' : `Apply ${selected.length} Selected`}
        </button>
    </section>;
}
