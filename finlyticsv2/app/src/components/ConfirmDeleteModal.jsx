import React from 'react';

/**
 * ConfirmDeleteModal — reusable delete confirmation modal.
 *
 * Props:
 *   isOpen       {bool}     — whether to show the modal
 *   title        {string}   — modal heading
 *   message      {string}   — body message
 *   itemLabels   {string[]} — optional list of item names being deleted (shown in scrollable list)
 *   onConfirm    {fn}       — called when user clicks Delete
 *   onCancel     {fn}       — called when user clicks Cancel or backdrop
 */
export default function ConfirmDeleteModal({ isOpen, title, message, itemLabels = [], onConfirm, onCancel }) {
    if (!isOpen) return null;

    return (
        <div
            onClick={onCancel}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                zIndex: 10000, display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: '1rem'
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: '#fff', borderRadius: 12,
                    boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
                    maxWidth: 500, width: '100%', overflow: 'hidden',
                    animation: 'fadeInScale 0.18s ease'
                }}
            >
                {/* Header */}
                <div style={{
                    background: 'linear-gradient(135deg, #dc3545 0%, #b02a37 100%)',
                    color: '#fff', padding: '1rem 1.25rem',
                    display: 'flex', alignItems: 'center', gap: '0.75rem'
                }}>
                    <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>🗑️</span>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, flex: 1 }}>
                        {title || 'Confirm Delete'}
                    </h3>
                    <button
                        onClick={onCancel}
                        style={{
                            background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%',
                            width: 28, height: 28, cursor: 'pointer', color: '#fff',
                            fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.25rem' }}>
                    <p style={{ margin: '0 0 1rem', color: '#374151', lineHeight: 1.6, fontSize: '0.97rem' }}>
                        {message}
                    </p>

                    {itemLabels.length > 0 && (
                        <div style={{
                            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                            padding: '0.6rem 0.75rem', maxHeight: 180, overflowY: 'auto',
                            marginBottom: '1rem'
                        }}>
                            {itemLabels.map((label, i) => (
                                <div
                                    key={i}
                                    style={{
                                        padding: '0.25rem 0', fontSize: '0.875rem', color: '#7f1d1d',
                                        borderBottom: i < itemLabels.length - 1 ? '1px solid #fee2e2' : 'none',
                                        display: 'flex', alignItems: 'center', gap: '0.4rem'
                                    }}
                                >
                                    <span style={{ color: '#dc3545', fontWeight: 700 }}>•</span>
                                    {label}
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{
                        background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6,
                        padding: '0.5rem 0.75rem', fontSize: '0.83rem', color: '#92400e',
                        display: 'flex', alignItems: 'center', gap: '0.4rem'
                    }}>
                        <span>⚠️</span>
                        <span>This action <strong>cannot be undone</strong>.</span>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '0 1.25rem 1.25rem', display: 'flex',
                    justifyContent: 'flex-end', gap: '0.75rem'
                }}>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: '0.5rem 1.25rem', borderRadius: 6, border: '1px solid #d1d5db',
                            background: '#fff', cursor: 'pointer', fontSize: '0.9rem',
                            fontWeight: 500, color: '#374151', transition: 'background 0.15s'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        style={{
                            padding: '0.5rem 1.5rem', borderRadius: 6, border: 'none',
                            background: 'linear-gradient(135deg, #dc3545 0%, #b02a37 100%)',
                            color: '#fff', cursor: 'pointer', fontSize: '0.9rem',
                            fontWeight: 700, boxShadow: '0 2px 8px rgba(220,53,69,0.35)'
                        }}
                    >
                        🗑️ Delete
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeInScale {
                    from { opacity: 0; transform: scale(0.93); }
                    to   { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
}
