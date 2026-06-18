import React, { useState, useEffect, lazy, Suspense } from 'react';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { msalInstance, loginRequest } from './auth/authConfig';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import MobileHome from './components/MobileHome';
import FinlyticsLogo from './components/FinlyticsLogo';
import ExportModal from './components/ExportModal';
import './styles/App.css';

// Lazy-load all tabs — only parsed/downloaded when first visited
const Customers     = lazy(() => import('./components/Customers'));
const Suppliers     = lazy(() => import('./components/Suppliers'));
const Invoices      = lazy(() => import('./components/Invoices'));
const Quotes        = lazy(() => import('./components/Quotes'));
const Expenses      = lazy(() => import('./components/Expenses'));
const VatReturns    = lazy(() => import('./components/VatReturns'));
const Banking       = lazy(() => import('./components/Banking'));
const Reconciliation = lazy(() => import('./components/Reconciliation'));
const DLA           = lazy(() => import('./components/DLA'));
const CompanyLedger = lazy(() => import('./components/CompanyLedger'));
const Shareholders  = lazy(() => import('./components/Shareholders'));
const Employees     = lazy(() => import('./components/Employees'));
const Payroll       = lazy(() => import('./components/Payroll'));
const Assets        = lazy(() => import('./components/Assets'));
const Subscriptions = lazy(() => import('./components/Subscriptions'));
const Reports       = lazy(() => import('./components/Reports'));
const CompanyDocuments = lazy(() => import('./components/CompanyDocuments'));
const Settings      = lazy(() => import('./components/Settings'));
const MileageTrips  = lazy(() => import('./components/MileageTrips'));
const P11D          = lazy(() => import('./components/P11D'));
const Dividends     = lazy(() => import('./components/Dividends'));
const CreditNotes   = lazy(() => import('./components/CreditNotes'));
const TeamManagement = lazy(() => import('./components/TeamManagement'));
const RecurringInvoices = lazy(() => import('./components/RecurringInvoices'));
const CategorizationRules = lazy(() => import('./components/CategorizationRules'));
const GoCardlessPayments = lazy(() => import('./components/GoCardlessPayments'));
const Bills = lazy(() => import('./components/Bills'));

const API_BASE = import.meta.env.VITE_API_BASE || 'https://financehub-func-kemponline.azurewebsites.net/api';

// Fire the health ping immediately on script load — don't wait for MSAL init.
// This starts the cold-start process as early as possible.
fetch(`${API_BASE}/health`, { method: 'GET' }).catch(() => {});

// Pre-warm both the function host again and the MSAL token cache
function warmupFunctionHost() {
    fetch(`${API_BASE}/health`, { method: 'GET' }).catch(() => {});
    import('./auth/authConfig').then(({ msalInstance, loginRequest }) => {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            msalInstance.acquireTokenSilent({ scopes: loginRequest.scopes || ['User.Read'], account: accounts[0] }).catch(() => {});
        }
    }).catch(() => {});
}

const TabLoader = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', opacity: 0.5 }}>
        Loading…
    </div>
);

function App() {
    return (
        <MsalProvider instance={msalInstance}>
            <MainContent />
        </MsalProvider>
    );
}

function MainContent() {
    const { instance } = useMsal();
    const isMobileDevice = () => window.innerWidth <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const [view, setView] = useState(() => isMobileDevice() ? 'mobile-home' : 'dashboard');
    const [viewOptions, setViewOptions] = useState({});
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(null);
    const [initialized, setInitialized] = useState(false);
    const [showExport, setShowExport] = useState(false);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const userMenuRef = React.useRef(null);

    useEffect(() => {
        if (initialized) return;

        const initAuth = async () => {
            try {
                console.log('Initializing MSAL...');
                await instance.initialize();
                console.log('MSAL initialized, handling redirect...');
                
                const response = await instance.handleRedirectPromise();
                
                if (response) {
                    console.log('Login successful:', response.account);
                    instance.setActiveAccount(response.account);
                    setIsAuthenticated(true);
                    warmupFunctionHost();
                } else {
                    // Check if user is already logged in
                    const accounts = instance.getAllAccounts();
                    console.log('Found accounts:', accounts.length);
                    
                    if (accounts.length > 0) {
                        instance.setActiveAccount(accounts[0]);
                        console.log('User already authenticated');
                        setIsAuthenticated(true);
                        warmupFunctionHost();
                    } else {
                        console.log('No authenticated user found');
                        setIsAuthenticated(false);
                    }
                }
            } catch (error) {
                console.error('Auth error:', error);
                setIsAuthenticated(false);
            } finally {
                setInitialized(true);
            }
        };
        
        initAuth();
    }, [instance, initialized]);

    // Proactively refresh the token when app comes back to the foreground after being idle
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                const accounts = instance.getAllAccounts();
                if (accounts.length > 0) {
                    try {
                        await instance.acquireTokenSilent({
                            scopes: ['User.Read'],
                            account: accounts[0]
                        });
                        setSessionExpired(false); // Clear any stale expired state
                    } catch (err) {
                        // Token genuinely expired — show re-auth overlay
                        console.warn('Foreground token refresh failed:', err.message);
                        setSessionExpired(true);
                    }
                }
            }
        };

        // Show the session expired overlay when any API call fires this event
        const handleAuthRequired = () => setSessionExpired(true);

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('finlytics:authRequired', handleAuthRequired);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('finlytics:authRequired', handleAuthRequired);
        };
    }, [instance]);

    useEffect(() => {
        const handler = (e) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const account = instance.getActiveAccount();
    const userName = account?.name || account?.username || 'User';
    const userInitials = userName.split(' ').filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join('');

    const [profilePhotoUrl, setProfilePhotoUrl] = React.useState(null);
    React.useEffect(() => {
        if (!isAuthenticated) return;
        const fetchPhoto = async () => {
            try {
                const acc = instance.getActiveAccount();
                if (!acc) return;
                const tokenResp = await instance.acquireTokenSilent({ scopes: ['User.Read'], account: acc });
                const photoResp = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
                    headers: { Authorization: `Bearer ${tokenResp.accessToken}` }
                });
                if (photoResp.ok) {
                    const blob = await photoResp.blob();
                    setProfilePhotoUrl(URL.createObjectURL(blob));
                }
            } catch { /* no photo available */ }
        };
        fetchPhoto();
    }, [isAuthenticated, instance]);

    const handleNavigate = (newView, options = {}) => {
        setView(newView);
        setViewOptions(options);
        setSidebarOpen(false); // Close sidebar on mobile after navigation
    };

    const handleLogout = async () => {
        try {
            await instance.logoutRedirect({
                postLogoutRedirectUri: window.location.origin
            });
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    // Show loading while initializing
    if (isAuthenticated === null) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <div>Loading...</div>
            </div>
        );
    }

    // Show login if not authenticated
    if (isAuthenticated === false) {
        return <Login />;
    }

    return (
        <div className="app-container">
            {/* Mobile Header with Hamburger */}
            <div className="mobile-header">
                <button 
                    className="hamburger-btn" 
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    aria-label="Toggle menu"
                >
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
                <div className="mobile-header-content">
                    <h1>Finlytics</h1>
                </div>
            </div>

            {/* Overlay for mobile */}
            {sidebarOpen && (
                <div 
                    className="sidebar-overlay" 
                    onClick={() => setSidebarOpen(false)}
                ></div>
            )}

            <nav className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
                <div className="sidebar-header">
                    <FinlyticsLogo />
                </div>
                <ul className="nav-menu">
                    <li className="nav-group-label">Overview</li>
                    <li onClick={() => handleNavigate('dashboard')} className={view === 'dashboard' ? 'active' : ''}>
                        📊 Dashboard
                    </li>

                    <li className="nav-group-label">Sales &amp; Income</li>
                    <li onClick={() => handleNavigate('customers')} className={view === 'customers' ? 'active' : ''}>
                        👥 Customers
                    </li>
                    <li onClick={() => handleNavigate('suppliers')} className={view === 'suppliers' ? 'active' : ''}>
                        💼 Payees
                    </li>
                    <li onClick={() => handleNavigate('invoices')} className={view === 'invoices' ? 'active' : ''}>
                        🧾 Invoices
                    </li>
                    <li onClick={() => handleNavigate('quotes')} className={view === 'quotes' ? 'active' : ''}>
                        📄 Quotes
                    </li>
                    <li onClick={() => handleNavigate('creditnotes')} className={view === 'creditnotes' ? 'active' : ''}>
                        🔴 Credit Notes
                    </li>
                    <li onClick={() => handleNavigate('recurring-invoices')} className={view === 'recurring-invoices' ? 'active' : ''}>
                        🔁 Recurring Invoices
                    </li>

                    <li className="nav-group-label">Expenses &amp; Finance</li>
                    <li onClick={() => handleNavigate('bills')} className={view === 'bills' ? 'active' : ''}>
                        📋 Bills / AP
                    </li>
                    <li onClick={() => handleNavigate('expenses')} className={view === 'expenses' ? 'active' : ''}>
                        💳 Expenses
                    </li>
                    <li onClick={() => handleNavigate('mileage')} className={view === 'mileage' ? 'active' : ''}>
                        🚗 Mileage
                    </li>
                    <li onClick={() => handleNavigate('banking')} className={view === 'banking' ? 'active' : ''}>
                        🏦 Banking
                    </li>
                    <li onClick={() => handleNavigate('gocardless')} className={view === 'gocardless' ? 'active' : ''}>
                        💳 GoCardless
                    </li>
                    <li onClick={() => handleNavigate('reconciliation')} className={view === 'reconciliation' ? 'active' : ''}>
                        ✅ Reconciliation
                    </li>
                    <li onClick={() => handleNavigate('categorization-rules')} className={view === 'categorization-rules' ? 'active' : ''}>
                        🏷️ Auto-Categorise
                    </li>
                    <li onClick={() => handleNavigate('vatreturns')} className={view === 'vatreturns' ? 'active' : ''}>
                        📋 VAT Returns
                    </li>

                    <li className="nav-group-label">People &amp; Payroll</li>
                    <li onClick={() => handleNavigate('shareholders')} className={view === 'shareholders' ? 'active' : ''}>
                        📈 Shareholders
                    </li>
                    <li onClick={() => handleNavigate('employees')} className={view === 'employees' ? 'active' : ''}>
                        👔 Employees
                    </li>
                    <li onClick={() => handleNavigate('payroll')} className={view === 'payroll' ? 'active' : ''}>
                        💷 Payroll
                    </li>
                    <li onClick={() => handleNavigate('p11d')} className={view === 'p11d' ? 'active' : ''}>
                        🏥 P11D / BIK
                    </li>
                    <li onClick={() => handleNavigate('dividends')} className={view === 'dividends' ? 'active' : ''}>
                        💸 Dividends
                    </li>
                    <li onClick={() => handleNavigate('dla')} className={view === 'dla' ? 'active' : ''}>
                        🤝 Director Loan Account
                    </li>
                    <li onClick={() => handleNavigate('companyledger')} className={view === 'companyledger' ? 'active' : ''}>
                        📒 Company Ledger
                    </li>
                    <li onClick={() => handleNavigate('team')} className={view === 'team' ? 'active' : ''}>
                        👥 Team Expenses
                    </li>

                    <li className="nav-group-label">Assets &amp; Reporting</li>
                    <li onClick={() => handleNavigate('assets')} className={view === 'assets' ? 'active' : ''}>
                        🧰 Assets
                    </li>
                    <li onClick={() => handleNavigate('subscriptions')} className={view === 'subscriptions' ? 'active' : ''}>
                        🔄 Subscriptions
                    </li>
                    <li onClick={() => handleNavigate('reports')} className={view === 'reports' ? 'active' : ''}>
                        📊 Reports
                    </li>
                    <li onClick={() => handleNavigate('documents')} className={view === 'documents' ? 'active' : ''}>
                        📁 Documents
                    </li>
                </ul>

            </nav>
            {showExport && <ExportModal onClose={() => setShowExport(false)} />}
            {/* Bottom Navigation — mobile only, rendered via CSS */}
            <nav className="bottom-nav">
                <button
                    className={`bottom-nav-item ${view === 'mobile-home' ? 'active' : ''}`}
                    onClick={() => handleNavigate('mobile-home')}
                >
                    <span>🏠</span>
                    <span>Home</span>
                </button>
                <button
                    className={`bottom-nav-item ${view === 'expenses' ? 'active' : ''}`}
                    onClick={() => handleNavigate('expenses')}
                >
                    <span>📸</span>
                    <span>Capture</span>
                </button>
                <button
                    className={`bottom-nav-item ${view === 'dla' ? 'active' : ''}`}
                    onClick={() => handleNavigate('dla')}
                >
                    <span>🤝</span>
                    <span>DLA</span>
                </button>
                <button
                    className={`bottom-nav-item ${view === 'mileage' ? 'active' : ''}`}
                    onClick={() => handleNavigate('mileage')}
                >
                    <span>🚗</span>
                    <span>Mileage</span>
                </button>
                <button
                    className={`bottom-nav-item ${sidebarOpen ? 'active' : ''}`}
                    onClick={() => setSidebarOpen(true)}
                >
                    <span>☰</span>
                    <span>More</span>
                </button>
            </nav>

            {/* Session Expired Overlay — shown when idle too long and token cannot be refreshed silently */}
            {sessionExpired && (
                <div className="session-expired-overlay">
                    <div className="session-expired-card">
                        <div className="session-expired-logo-wrap">
                            <FinlyticsLogo size={80} />
                        </div>
                        <h2>Session Expired</h2>
                        <p>You've been away for a while. Please sign in again to continue.</p>
                        <button
                            className="btn-primary"
                            onClick={() => instance.loginRedirect({ ...loginRequest, redirectUri: window.location.origin })}
                        >
                            Sign In Again
                        </button>
                    </div>
                </div>
            )}

            <div className="content-wrapper">
                {/* Top header bar — user profile at top right */}
                <header className="app-header">
                    <div className="header-user" ref={userMenuRef}>
                        <button className="header-user-btn" onClick={() => setShowUserMenu(m => !m)}>
                            <span className="header-user-name">{userName}</span>
                            <div className="user-avatar">
                                {profilePhotoUrl
                                    ? <img src={profilePhotoUrl} alt={userInitials} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                                    : (userInitials || '?')
                                }
                            </div>
                        </button>
                        {showUserMenu && (
                            <div className="header-menu-dropdown">
                                <button className="user-menu-item" onClick={() => { handleNavigate('settings'); setShowUserMenu(false); }}>⚙️ Settings</button>
                                <button className="user-menu-item" onClick={() => { setShowExport(true); setSidebarOpen(false); setShowUserMenu(false); }}>📤 Export Data</button>
                                <div className="user-menu-divider" />
                                <button className="user-menu-item user-menu-logout" onClick={handleLogout}>🚪 Sign Out</button>
                            </div>
                        )}
                    </div>
                </header>
                <main className="content">
                <Suspense fallback={<TabLoader />}>
                {view === 'mobile-home' && <MobileHome onNavigate={handleNavigate} />}
                {view === 'dashboard' && <Dashboard onNavigate={handleNavigate} />}
                {view === 'customers' && <Customers />}
                {view === 'suppliers' && <Suppliers />}
                {view === 'invoices' && <Invoices />}
                {view === 'quotes' && <Quotes />}
                {view === 'creditnotes' && <CreditNotes />}
                {view === 'recurring-invoices' && <RecurringInvoices />}
                {view === 'bills' && <Bills />}
                {view === 'expenses' && <Expenses openNew={viewOptions.openNew} />}
                {view === 'vatreturns' && <VatReturns />}
                {view === 'banking' && <Banking />}
                {view === 'gocardless' && <GoCardlessPayments />}
                {view === 'reconciliation' && <Reconciliation />}
                {view === 'categorization-rules' && <CategorizationRules />}
                {view === 'dla' && <DLA openNew={viewOptions.openNew} />}
                {view === 'mileage' && <MileageTrips openNew={viewOptions.openNew} />}
                {view === 'companyledger' && <CompanyLedger />}
                {view === 'shareholders' && <Shareholders />}
                {view === 'employees' && <Employees />}
                {view === 'team' && <TeamManagement />}
                {view === 'payroll' && <Payroll />}
                {view === 'p11d' && <P11D />}
                {view === 'dividends' && <Dividends />}
                {view === 'assets' && <Assets />}
                {view === 'subscriptions' && <Subscriptions />}
                {view === 'reports' && <Reports />}
                {view === 'documents' && <CompanyDocuments />}
                {view === 'settings' && <Settings />}
                </Suspense>
            </main>
            </div>
        </div>
    );
}

export default App;