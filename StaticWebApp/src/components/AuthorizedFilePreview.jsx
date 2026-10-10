import React, { useEffect, useState } from 'react';
import { apiLinkProps, fetchApiBlob } from '../services/apiService';

export default function AuthorizedFilePreview({ url, fileName }) {
    const [objectUrl, setObjectUrl] = useState(null);
    const [failed, setFailed] = useState(false);
    const isPdf = fileName?.toLowerCase().endsWith('.pdf');

    useEffect(() => {
        let created = null;
        let cancelled = false;
        setObjectUrl(null);
        setFailed(false);
        fetchApiBlob(url)
            .then(blob => {
                if (cancelled) return;
                created = URL.createObjectURL(blob);
                setObjectUrl(created);
            })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => {
            cancelled = true;
            if (created) URL.revokeObjectURL(created);
        };
    }, [url]);

    return <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>📎 {fileName}</span>
            <a {...apiLinkProps(url)} style={{ fontSize: '0.78rem', color: '#0d6efd' }}>Open in new tab ↗</a>
        </div>
        {failed ? <div style={{ fontSize: '0.85rem', color: '#b91c1c' }}>Preview unavailable</div>
            : !objectUrl ? <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>Loading…</div>
            : isPdf ? <iframe src={objectUrl} title={fileName} style={{ width: '100%', height: 420, border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6 }} />
            : <img src={objectUrl} alt={fileName} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', display: 'block', cursor: 'zoom-in' }}
                onClick={() => window.open(objectUrl, '_blank')} />}
    </div>;
}
