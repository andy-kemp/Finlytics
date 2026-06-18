import React, { useEffect, useState } from 'react';
import { getBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount, getBankTransactionsByAccount, createBankTransaction, getTrueLayerStatus, getTrueLayerAuthUrl, syncTrueLayerTransactions, disconnectTrueLayer, getGoCardlessInstitutions, connectBankGoCardless, syncGoCardlessTransactions, getGoCardlessBankStatus } from '../services/apiService';

const defaultAccount = {
    accountName: '',
    bankName: '',
    sortCode: '',
    accountNumber: '',
    currency: 'GBP',
    openingBalance: '',
    isActive: true,
    notes: ''
};

const defaultTransaction = {
    transactionDate: '',
    amount: '',
    description: '',
    reference: '',
    category: '',
    direction: 'Out'
};

export default function Banking() {
    const [accounts, setAccounts] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [showAccountForm, setShowAccountForm] = useState(false);
    const [showTransactionForm, setShowTransactionForm] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [accountForm, setAccountForm] = useState(defaultAccount);
    const [transactionForm, setTransactionForm] = useState(defaultTransaction);
    const [syncResult, setSyncResult] = useState(null);
    const [trueLayerStatus, setTrueLayerStatus] = useState(null);
    const [tlSyncing, setTlSyncing] = useState(false);
    const [gcInstitutions, setGcInstitutions] = useState([]);
    const [gcConnecting, setGcConnecting] = useState(false);
    const [gcSyncing, setGcSyncing] = useState(false);
    const [showGcPicker, setShowGcPicker] = useState(false);
    const [gcPickerAccountId, setGcPickerAccountId] = useState(null);

    useEffect(() => {
        loadAccounts();
        getTrueLayerStatus().then(setTrueLayerStatus).catch(() => setTrueLayerStatus({ connected: false }));

        // Handle redirect back from TrueLayer OAuth
        const params = new URLSearchParams(window.location.search);
        if (params.get('truelayer_connected') === 'true') {
            setSyncResult({ success: true, message: 'Bank connected via TrueLayer!' });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('truelayer_auth_pending');
            setTimeout(() => { getTrueLayerStatus().then(setTrueLayerStatus).catch(() => {}); loadAccounts(); }, 1500);
        } else if (params.get('truelayer_error')) {
            const errMsg = decodeURIComponent(params.get('truelayer_error'));
            setSyncResult({ success: false, message: `TrueLayer connection failed: ${errMsg}` });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('truelayer_auth_pending');
        }

        // Handle redirect back from GoCardless Bank Data OAuth
        if (params.get('gc_connected') === 'true') {
            setSyncResult({ success: true, message: 'Bank connected via GoCardless!' });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('gc_auth_pending');
            setTimeout(() => { loadAccounts(); }, 1500);
        } else if (params.get('gc_error')) {
            const errMsg = decodeURIComponent(params.get('gc_error'));
            setSyncResult({ success: false, message: `GoCardless connection failed: ${errMsg}` });
            window.history.replaceState({}, '', window.location.pathname);
            localStorage.removeItem('gc_auth_pending');
        }

        // PWA: when user switches back from browser after completing TrueLayer auth,
        // detect connection via visibilitychange / focus events
        const checkPendingAuth = async () => {
            if (!localStorage.getItem('truelayer_auth_pending')) return;
            try {
                const status = await getTrueLayerStatus();
                if (status?.connected) {
                    localStorage.removeItem('truelayer_auth_pending');
                    setTrueLayerStatus(status);
                    setSyncResult({ success: true, message: 'Bank connected via TrueLayer!' });
                    await loadAccounts();
                }
            } catch { /* ignore */ }
        };
        const onResume = () => { if (document.visibilityState === 'visible') checkPendingAuth(); };
        document.addEventListener('visibilitychange', onResume);
        window.addEventListener('focus', checkPendingAuth);

        // Also check immediately in case PWA was reopened from scratch
        checkPendingAuth();

        return () => {
            document.removeEventListener('visibilitychange', onResume);
            window.removeEventListener('focus', checkPendingAuth);
        };
    }, []);

    async function loadAccounts() {
        try {
            const data = await getBankAccounts();
            setAccounts(data);
            if (data.length > 0) {
                setSelectedAccount(data[0]);
                await loadTransactions(data[0].id);
            }
        } catch (error) {
            console.error('Error loading accounts:', error);
        } finally {
            setLoading(false);
        }
    }

    async function loadTransactions(accountId) {
        try {
            const data = await getBankTransactionsByAccount(accountId);
            setTransactions(data);
        } catch (error) {
            console.error('Error loading transactions:', error);
        }
    }

    const handleSelectAccount = async (account) => {
        setSelectedAccount(account);
        await loadTransactions(account.id);
    };

    const handleNewAccount = () => {
        setAccountForm(defaultAccount);
        setEditingAccount(null);
        setShowAccountForm(true);
    };

    const handleEditAccount = (account) => {
        setEditingAccount(account);
        setAccountForm({
            accountName: account.accountName || '',
            bankName: account.bankName || '',
            sortCode: account.sortCode || '',
            accountNumber: account.accountNumber || '',
            currency: account.currency || 'GBP',
            openingBalance: account.openingBalance ?? '',
            isActive: account.isActive !== false,
            notes: account.notes || ''
        });
        setShowAccountForm(true);
    };

    const handleSaveAccount = async (e) => {
        e.preventDefault();
        setProcessing(true);
        try {
            const payload = {
                ...accountForm,
                openingBalance: accountForm.openingBalance === '' ? null : Number(accountForm.openingBalance)
            };

            if (editingAccount) {
                await updateBankAccount(editingAccount.id, payload);
            } else {
                await createBankAccount(payload);
            }

            await loadAccounts();
            setShowAccountForm(false);
        } catch (error) {
            console.error('Error saving account:', error);
            alert('Failed to save account: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteAccount = async (account) => {
        if (!confirm(`Delete bank account "${account.accountName}"?`)) return;
        setProcessing(true);
        try {
            await deleteBankAccount(account.id);
            await loadAccounts();
        } catch (error) {
            console.error('Error deleting account:', error);
            alert('Failed to delete account: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleNewTransaction = () => {
        setTransactionForm(defaultTransaction);
        setShowTransactionForm(true);
    };

    const handleSaveTransaction = async (e) => {
        e.preventDefault();
        if (!selectedAccount) return;
        setProcessing(true);
        try {
            const payload = {
                ...transactionForm,
                bankAccountId: selectedAccount.id,
                amount: transactionForm.amount === '' ? null : Number(transactionForm.amount),
                transactionDate: transactionForm.transactionDate || null,
                source: 'Manual'
            };

            await createBankTransaction(payload);
            await loadTransactions(selectedAccount.id);
            setShowTransactionForm(false);
        } catch (error) {
            console.error('Error saving transaction:', error);
            alert('Failed to save transaction: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleTrueLayerConnect = async () => {
        try {
            const data = await getTrueLayerAuthUrl();
            // Set flag so when user returns (especially in PWA) we auto-check status
            localStorage.setItem('truelayer_auth_pending', Date.now().toString());
            window.location.href = data.authUrl;
        } catch (err) {
            setSyncResult({ success: false, message: 'Could not start TrueLayer connection: ' + err.message });
        }
    };

    const handleTrueLayerSync = async () => {
        setTlSyncing(true);
        setSyncResult(null);
        try {
            const result = await syncTrueLayerTransactions();
            setSyncResult({ success: true, message: result.message, imported: result.imported });
            getTrueLayerStatus().then(setTrueLayerStatus).catch(() => {});
            await loadAccounts();
            if (selectedAccount) await loadTransactions(selectedAccount.id);
        } catch (err) {
            setSyncResult({ success: false, message: err.message });
        } finally {
            setTlSyncing(false);
        }
    };

    const handleTrueLayerDisconnect = async () => {
        if (!confirm('Disconnect TrueLayer? Existing imported transactions will remain.')) return;
        try {
            await disconnectTrueLayer();
            setTrueLayerStatus({ connected: false });
            setSyncResult({ success: true, message: 'TrueLayer disconnected' });
            await loadAccounts();
        } catch (err) {
            setSyncResult({ success: false, message: err.message });
        }
    };

    // ── GoCardless Bank Data ──
    const handleGcConnectBank = async (bankAccountId) => {
        setGcPickerAccountId(bankAccountId);
        setShowGcPicker(true);
        if (gcInstitutions.length === 0) {
            try {
                const data = await getGoCardlessInstitutions();
                setGcInstitutions(data);
            } catch (err) {
                setSyncResult({ success: false, message: 'Could not load banks: ' + err.message });
                setShowGcPicker(false);
            }
        }
    };

    const handleGcSelectInstitution = async (institutionId) => {
        setGcConnecting(true);
        try {
            const data = await connectBankGoCardless(institutionId, gcPickerAccountId);
            localStorage.setItem('gc_auth_pending', Date.now().toString());
            window.location.href = data.authUrl;
        } catch (err) {
            setSyncResult({ success: false, message: 'GoCardless connection failed: ' + err.message });
        } finally {
            setGcConnecting(false);
            setShowGcPicker(false);
        }
    };

    const handleGcSync = async (bankAccountId) => {
        setGcSyncing(true);
        setSyncResult(null);
        try {
            const result = await syncGoCardlessTransactions(bankAccountId);
            setSyncResult({ success: true, message: result.message || `Synced ${result.imported || 0} transactions via GoCardless` });
            await loadAccounts();
            if (selectedAccount) await loadTransactions(selectedAccount.id);
        } catch (err) {
            setSyncResult({ success: false, message: err.message });
        } finally {
            setGcSyncing(false);
        }
    };

    return (
        <div className="content-container">
            <div className="section-header">
                <h2>Banking</h2>
                <button className="btn-primary" onClick={handleNewAccount} disabled={processing}>
                    + Add Bank Account
                </button>
            </div>

            {/* ── Open Banking Panel ── */}
            {trueLayerStatus && (
                <div style={{
                    background: trueLayerStatus.connected ? '#eff6ff' : '#fafafa',
                    border: `1px solid ${trueLayerStatus.connected ? '#bfdbfe' : '#e5e7eb'}`,
                    borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>🏛️</span>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: trueLayerStatus.connected ? '#1d4ed8' : '#374151' }}>
                                {trueLayerStatus.connected
                                    ? `✓ Open Banking Connected${trueLayerStatus.provider ? ` — ${trueLayerStatus.provider}` : ''} (${trueLayerStatus.accountCount} account${trueLayerStatus.accountCount !== 1 ? 's' : ''})`
                                    : 'Open Banking (TrueLayer)'}
                            </div>
                            {trueLayerStatus.connected && (
                                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                                    {trueLayerStatus.balance != null && (
                                        <span>Balance: <strong>£{parseFloat(trueLayerStatus.balance).toFixed(2)}</strong></span>
                                    )}
                                    {trueLayerStatus.lastSyncedAt && (
                                        <span style={{ marginLeft: 8 }}>· Last sync: {new Date(trueLayerStatus.lastSyncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    )}
                                    {trueLayerStatus.tokenExpired && (
                                        <span style={{ marginLeft: 8, color: '#dc2626', fontWeight: 600 }}>⚠ Token expired — reconnect below</span>
                                    )}
                                </div>
                            )}
                            {!trueLayerStatus.connected && (
                                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>
                                    Connect any UK bank account securely via Open Banking
                                </div>
                            )}
                        </div>
                    </div>
                    {!trueLayerStatus.connected && (
                        <button
                            onClick={handleTrueLayerConnect}
                            style={{
                                background: '#2563eb', color: '#fff', border: 'none',
                                borderRadius: 6, padding: '0.5rem 1.1rem',
                                fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer'
                            }}
                        >
                            🔗 Connect Bank
                        </button>
                    )}
                    {trueLayerStatus.connected && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button
                                onClick={handleTrueLayerSync}
                                disabled={tlSyncing}
                                style={{
                                    background: tlSyncing ? '#bfdbfe' : '#2563eb', color: '#fff',
                                    border: 'none', borderRadius: 6, padding: '0.45rem 1rem',
                                    fontWeight: 600, fontSize: '0.875rem', cursor: tlSyncing ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                                }}
                            >
                                {tlSyncing ? '⏳ Syncing…' : '🔄 Sync Transactions'}
                            </button>
                            <button
                                onClick={handleTrueLayerConnect}
                                style={{
                                    background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db',
                                    borderRadius: 6, padding: '0.45rem 0.85rem',
                                    fontWeight: 500, fontSize: '0.8rem', cursor: 'pointer'
                                }}
                            >
                                + Add Bank
                            </button>
                            <button
                                onClick={handleTrueLayerDisconnect}
                                style={{
                                    background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5',
                                    borderRadius: 6, padding: '0.45rem 0.85rem',
                                    fontWeight: 500, fontSize: '0.8rem', cursor: 'pointer'
                                }}
                            >
                                Disconnect
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── GoCardless Bank Institution Picker ── */}
            {showGcPicker && (
                <div style={{
                    background: '#f9fafb', border: '1px solid #e5e7eb',
                    borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Select your Bank (GoCardless)</h4>
                        <button onClick={() => setShowGcPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#6b7280' }}>✕</button>
                    </div>
                    {gcInstitutions.length === 0 ? (
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading banks...</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', maxHeight: 300, overflowY: 'auto' }}>
                            {gcInstitutions.map(inst => (
                                <button
                                    key={inst.id}
                                    onClick={() => handleGcSelectInstitution(inst.id)}
                                    disabled={gcConnecting}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        padding: '0.5rem 0.75rem', border: '1px solid #d1d5db',
                                        borderRadius: 8, background: '#fff', cursor: gcConnecting ? 'not-allowed' : 'pointer',
                                        fontSize: '0.8rem', fontWeight: 500, textAlign: 'left'
                                    }}
                                >
                                    {inst.logo && <img src={inst.logo} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />}
                                    {inst.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Sync / Connection Result Banner ── */}
            {syncResult && (
                <div style={{
                    background: syncResult.success ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${syncResult.success ? '#bbf7d0' : '#fca5a5'}`,
                    borderRadius: 8, padding: '0.6rem 1rem', marginBottom: '1rem',
                    color: syncResult.success ? '#15803d' : '#dc2626',
                    fontWeight: 500, fontSize: '0.875rem',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <span>{syncResult.success ? '✓' : '✗'} {syncResult.message}</span>
                    <button onClick={() => setSyncResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#6b7280' }}>✕</button>
                </div>
            )}

            {showAccountForm && (
                <div className="form-card">
                    <h3>{editingAccount ? 'Edit Bank Account' : 'New Bank Account'}</h3>
                    <form onSubmit={handleSaveAccount}>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Account Name</label>
                                <input value={accountForm.accountName} onChange={e => setAccountForm({ ...accountForm, accountName: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label>Bank Name</label>
                                <input value={accountForm.bankName} onChange={e => setAccountForm({ ...accountForm, bankName: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Sort Code</label>
                                <input value={accountForm.sortCode} onChange={e => setAccountForm({ ...accountForm, sortCode: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Account Number</label>
                                <input value={accountForm.accountNumber} onChange={e => setAccountForm({ ...accountForm, accountNumber: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Currency</label>
                                <input value={accountForm.currency} onChange={e => setAccountForm({ ...accountForm, currency: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Opening Balance</label>
                                <input type="number" step="0.01" value={accountForm.openingBalance} onChange={e => setAccountForm({ ...accountForm, openingBalance: e.target.value })} />
                            </div>
                            <div className="form-group full-width">
                                <label>Notes</label>
                                <textarea value={accountForm.notes} onChange={e => setAccountForm({ ...accountForm, notes: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-actions">
                            <button type="submit" className="btn-primary" disabled={processing}>Save</button>
                            <button type="button" className="btn-secondary" onClick={() => setShowAccountForm(false)}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="loading">Loading...</div>
            ) : (
                <div className="table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Account</th>
                                <th>Bank</th>
                                <th>Currency</th>
                                <th>Active</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map(account => (
                                <tr key={account.id}>
                                    <td>
                                        <button className="btn-link" onClick={() => handleSelectAccount(account)}>
                                            {account.accountName}
                                        </button>
                                    </td>
                                    <td>{account.bankName}</td>
                                    <td>{account.currency}</td>
                                    <td>{account.isActive ? 'Yes' : 'No'}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                            <button className="btn-secondary" onClick={() => handleEditAccount(account)}>Edit</button>
                                            <button className="btn-danger" onClick={() => handleDeleteAccount(account)}>Delete</button>
                                            {account.goCardlessConnected ? (
                                                <button
                                                    className="btn-secondary"
                                                    disabled={gcSyncing}
                                                    onClick={() => handleGcSync(account.id)}
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    {gcSyncing ? '⏳' : '🔄'} GC Sync
                                                </button>
                                            ) : (
                                                <button
                                                    className="btn-secondary"
                                                    onClick={() => handleGcConnectBank(account.id)}
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    🔗 Connect GC
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {selectedAccount && (
                <div style={{ marginTop: '2rem' }}>
                    <div className="section-header">
                        <h3>Transactions - {selectedAccount.accountName}</h3>
                        <button className="btn-primary" onClick={handleNewTransaction}>+ Add Transaction</button>
                    </div>

                    {showTransactionForm && (
                        <div className="form-card">
                            <h4>New Transaction</h4>
                            <form onSubmit={handleSaveTransaction}>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Date</label>
                                        <input type="date" value={transactionForm.transactionDate} onChange={e => setTransactionForm({ ...transactionForm, transactionDate: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Amount</label>
                                        <input type="number" step="0.01" value={transactionForm.amount} onChange={e => setTransactionForm({ ...transactionForm, amount: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Direction</label>
                                        <select value={transactionForm.direction} onChange={e => setTransactionForm({ ...transactionForm, direction: e.target.value })}>
                                            <option>In</option>
                                            <option>Out</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Description</label>
                                        <input value={transactionForm.description} onChange={e => setTransactionForm({ ...transactionForm, description: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Reference</label>
                                        <input value={transactionForm.reference} onChange={e => setTransactionForm({ ...transactionForm, reference: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label>Category</label>
                                        <input value={transactionForm.category} onChange={e => setTransactionForm({ ...transactionForm, category: e.target.value })} />
                                    </div>
                                </div>
                                <div className="form-actions">
                                    <button type="submit" className="btn-primary">Save</button>
                                    <button type="button" className="btn-secondary" onClick={() => setShowTransactionForm(false)}>Cancel</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Amount</th>
                                    <th>Direction</th>
                                    <th>Reconciled</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map(tx => (
                                    <tr key={tx.id}>
                                        <td>{tx.transactionDate ? tx.transactionDate.substring(0, 10) : ''}</td>
                                        <td>{tx.description}</td>
                                        <td>{tx.amount ? `£${tx.amount}` : ''}</td>
                                        <td>{tx.direction}</td>
                                        <td>{tx.isReconciled ? 'Yes' : 'No'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
