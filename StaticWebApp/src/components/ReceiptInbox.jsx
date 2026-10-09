import React, { useEffect, useRef, useState } from 'react';
import { analyseReceiptInbox, dismissInboxReceipt, getReceiptInbox, uploadReceiptsToInbox } from '../services/apiService';

const money = (value, currency) => {
    if (value == null) return '—';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(value); }
    catch { return `${currency} ${Number(value).toFixed(2)}`; }
};
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.heif,.tif,.tiff';

export default function ReceiptInbox({ onChange }) {
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const [dragging, setDragging] = useState(false);
    const input = useRef(null);

    const load = async () => {
        const next = await getReceiptInbox();
        setItems(next);
        onChange?.(next);
    };

    useEffect(() => {
        load().catch(error => setMessage({ error: true, text: error.message }));
    }, []);

    const run = async (action, success) => {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        try {
            const result = await action();
            await load();
            setMessage({ error: false, text: success(result) });
        } catch (error) {
            setMessage({ error: true, text: error.message });
        } finally {
            setBusy(false);
        }
    };

    const upload = files => {
        if (!files?.length) return;
        run(() => uploadReceiptsToInbox(files), result => `${result.length} receipt(s) added; ${result.filter(item => item.status === 'failed').length} could not be read automatically`);
    };

    return <section className="form-card" aria-label="Receipt inbox" style={{ marginBottom: '1rem' }}>
        <div className="section-header" style={{ marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>Receipt Inbox ({items.length} unmatched)</h4>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input ref={input} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
                    onChange={event => { upload(event.target.files); event.target.value = ''; }} />
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>Upload Receipts</button>
                <button type="button" className="btn-secondary" disabled={busy}
                    title="Read receipts added directly to the receipt-inbox storage container"
                    onClick={() => run(analyseReceiptInbox, result => `${result.analysed.length} stored receipt(s) read${result.remaining ? `; ${result.remaining} still waiting` : ''}`)}>
                    Read Storage Uploads
                </button>
            </div>
        </div>
        <div onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files); }}
            style={{ border: `2px dashed ${dragging ? '#2563eb' : '#cbd5e1'}`, borderRadius: 8, padding: '0.75rem', textAlign: 'center', color: '#64748b', marginBottom: '0.75rem' }}>
            {busy ? 'Working...' : 'Drop receipts here (PDF or photos, up to 20 at a time). They are matched to card payments when you import the monthly statement.'}
        </div>
        {message && <div role={message.error ? 'alert' : 'status'} style={{ color: message.error ? '#b91c1c' : '#15803d', marginBottom: '0.5rem', overflowWrap: 'anywhere' }}>{message.text}</div>}
        {items.length > 0 && <div className="table-container" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="data-table">
                <thead><tr><th>File</th><th>Supplier</th><th>Date</th><th>Total</th><th>VAT</th><th>Status</th><th></th></tr></thead>
                <tbody>{items.map(item => <tr key={item.name}>
                    <td style={{ maxWidth: 220, overflowWrap: 'anywhere' }}>{item.fileName}</td>
                    <td>{item.vendor || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.documentDate || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{money(item.total, item.currency)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{money(item.tax, item.currency)}</td>
                    <td title={item.error || undefined}>{item.status === 'new' ? 'Not read yet' : item.status === 'failed' ? 'Unreadable' : 'Ready'}</td>
                    <td><button type="button" className="btn-secondary" disabled={busy}
                        onClick={() => window.confirm(`Remove ${item.fileName} from the inbox? The file is kept in storage.`)
                            && run(() => dismissInboxReceipt(item.name), () => `${item.fileName} dismissed`)}>Dismiss</button></td>
                </tr>)}</tbody>
            </table>
        </div>}
    </section>;
}
