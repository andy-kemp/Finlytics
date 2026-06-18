import React from 'react';

const ICONS = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
};

export default function Toast({ toast, onClose }) {
    if (!toast) return null;

    return (
        <div className={`toast-notification toast-${toast.type || 'success'}`}>
            <span className="toast-icon">{ICONS[toast.type] || ICONS.success}</span>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={onClose} title="Dismiss">✕</button>
        </div>
    );
}
