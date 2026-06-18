import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCompanySettings, updateCompanySettings, testSmtpConfiguration, adminLogin, adminMfaSetup, adminMfaVerify, adminChangePassword, getFinanceHubSettings, updateFinanceHubSettings, getPayrollSettings, updatePayrollSettings, inviteAccountant, getLinkedAccountants, revokeAccountant } from '../services/apiService';
import Toast from './Toast';
import './Settings.css';

const Settings = () => {
    const [activeTab, setActiveTab] = useState('company');
    const [settings, setSettings] = useState({
        companyName: '',
        companyAddress: '',
        companyPhone: '',
        companyEmail: '',
        invoicesEmail: '',
        quotesEmail: '',
        paymentsEmail: '',
        companyRegistrationNumber: '',
        taxRegistrationNumber: '',
        vatRegistrationNumber: '',
        bankName: '',
        bankAccountNumber: '',
        bankSortCode: '',
        bankIBAN: '',
        bankSwiftCode: '',
        defaultCurrency: 'GBP',
        defaultVATRate: '20',
        invoicePrefix: 'INV',
        quotePrefix: 'QUO',
        invoiceTermsDays: '30',
        invoiceFooterText: '',
        logoUrl: '',
        documentLogoUrl: '',
        emailLogoUrl: '',
        companyInceptionDate: '',
        // incorporationDate removed - companyInceptionDate is used everywhere
        fyStartMonth: '',
        fyStartDay: '',
        directors: '',
        smtpServer: '',
        smtpPort: '',
        smtpFromAddress: '',
        smtpUsername: '',
        smtpPassword: '',
        directorName: '',
        directorSignature: '',
        hasAuthorizedOfficer: false,
        authorizedOfficerName: '',
        authorizedOfficerSignature: '',
        psaApproved: false,
        psaContactName: '',
        vatQuarterStartMonth: '',
        vatEffectiveDate: '',
        vatAccountingMethod: 'cash',
        utr: '',
        allowDataDeletion: false,
        allowDividendDeletion: false,
        hmrcGatewayUserId: '',
        hmrcGatewayPassword: '',
    });
    const [securitySettings, setSecuritySettings] = useState({
        authenticationType: 'Local',
        ssoEnabled: false,
        requireMfa: true,
        allowPasskeys: true,
        mfaProvider: 'TOTP',
        passkeyProvider: 'WebAuthn',
        azureAdTenantId: '',
        azureAdClientId: '',
        azureAdClientSecret: '',
        azureAdRedirectUri: ''
    });
    const [adminAuth, setAdminAuth] = useState({
        username: '',
        password: '',
        mfaCode: ''
    });
    const [passwordChange, setPasswordChange] = useState({
        currentPassword: '',
        newPassword: ''
    });
    const [mustChangePassword, setMustChangePassword] = useState(false);
    const [adminLoggedIn, setAdminLoggedIn] = useState(false);
    const [adminMessage, setAdminMessage] = useState('');
    const [mfaSetup, setMfaSetup] = useState({
        secret: '',
        otpauthUri: '',
        code: ''
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [toast, setToast] = useState(null);
    const [payrollSettingsForm, setPayrollSettingsForm] = useState(null);
    const [payrollSaving, setPayrollSaving] = useState(false);
    const [accountants, setAccountants] = useState([]);
    const [accountantsLoading, setAccountantsLoading] = useState(false);
    const [inviteForm, setInviteForm] = useState({ email: '', name: '', firmName: '' });
    const [inviting, setInviting] = useState(false);
    const [lastInviteResult, setLastInviteResult] = useState(null);

    const showToast = useCallback((msg, type = 'success') => {
        setToast({ message: msg, type });
        setTimeout(() => setToast(null), 3500);
    }, []);
    
    const directorCanvasRef = useRef(null);
    const officerCanvasRef = useRef(null);
    const [isDrawingDirector, setIsDrawingDirector] = useState(false);
    const [isDrawingOfficer, setIsDrawingOfficer] = useState(false);

    const buildAutoInvoiceFooterText = (data) => {
        if (!data) return '';

        const parts = [];
        const regNumber = data.companyRegistrationNumber?.trim();
        const vatNumber = data.vatRegistrationNumber?.trim();
        const address = data.companyAddress?.trim();

        let companyLocation = 'England and Wales';
        if (regNumber && regNumber.toUpperCase().startsWith('SC')) {
            companyLocation = 'Scotland';
        }

        if (data.companyName) {
            parts.push(`${data.companyName} is a company registered in ${companyLocation}`);
            if (regNumber) {
                parts.push(`under company number ${regNumber}`);
            }
        }

        if (vatNumber) {
            parts.push(`VAT registration number: ${vatNumber}`);
        }

        if (address) {
            parts.push(`Registered office: ${address}`);
        }

        if (parts.length === 0) return '';
        return `${parts.join('. ')}.`;
    };

    useEffect(() => {
        loadSettings();
        loadPayrollSettings();
    }, []);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const data = await getCompanySettings();
            console.log('Loaded company settings from API:', data);
            if (data) {
                // Directly use the data from API, don't merge with defaults
                const loadedSettings = {
                    companyName: data.companyName || '',
                    companyAddress: data.companyAddress || '',
                    companyPhone: data.companyPhone || '',
                    companyEmail: data.companyEmail || '',
                    invoicesEmail: data.invoicesEmail || '',
                    quotesEmail: data.quotesEmail || '',
                    paymentsEmail: data.paymentsEmail || '',
                    companyRegistrationNumber: data.companyRegistrationNumber || '',
                    taxRegistrationNumber: data.taxRegistrationNumber || '',
                    utr: data.utr || '',
                    vatRegistrationNumber: data.vatRegistrationNumber || '',
                    bankName: data.bankName || '',
                    bankAccountNumber: data.bankAccountNumber || '',
                    bankSortCode: data.bankSortCode || '',
                    bankIBAN: data.bankIBAN || '',
                    bankSwiftCode: data.bankSwiftCode || '',
                    defaultCurrency: data.defaultCurrency || 'GBP',
                    defaultVATRate: data.defaultVATRate || '20',
                    invoicePrefix: data.invoicePrefix || 'INV',
                    quotePrefix: data.quotePrefix || 'QUO',
                    invoiceTermsDays: data.invoiceTermsDays || '30',
                    invoiceFooterText: data.invoiceFooterText || '',
                    logoUrl: data.logoUrl || '',
                    documentLogoUrl: data.documentLogoUrl || '',
                    emailLogoUrl: data.emailLogoUrl || '',
                    companyInceptionDate: data.companyInceptionDate || '',
                    fyStartMonth: data.fyStartMonth || '',
                    fyStartDay: data.fyStartDay || '',
                    smtpServer: data.smtpServer || '',
                    smtpPort: data.smtpPort || '',
                    smtpFromAddress: data.smtpFromAddress || '',
                    smtpUsername: data.smtpUsername || '',
                    smtpPassword: '',
                    directorName: data.directorName || '',
                    directorSignature: data.directorSignature || '',
                    hasAuthorizedOfficer: data.hasAuthorizedOfficer || false,
                    authorizedOfficerName: data.authorizedOfficerName || '',
                    authorizedOfficerSignature: data.authorizedOfficerSignature || '',
                    directors: data.directors || '',
                    psaApproved: data.psaApproved || false,
                    psaContactName: data.psaContactName || '',
                    vatQuarterStartMonth: data.vatQuarterStartMonth || '',
                    vatEffectiveDate: data.vatEffectiveDate ? data.vatEffectiveDate.substring(0, 10) : '',
                    vatAccountingMethod: data.vatAccountingMethod || 'cash',
                    allowDataDeletion: data.allowDataDeletion || false,
                    allowDividendDeletion: data.allowDividendDeletion || false,
                    hmrcGatewayUserId: data.hmrcGatewayUserId || '',
                    hmrcGatewayPassword: data.hmrcGatewayPassword || '',
                };
                console.log('Settings to display:', loadedSettings);
                setSettings(loadedSettings);
                
                // Load signatures onto canvases
                setTimeout(() => {
                    if (directorCanvasRef.current && data.directorSignature) {
                        const ctx = directorCanvasRef.current.getContext('2d');
                        const img = new Image();
                        img.onload = () => ctx.drawImage(img, 0, 0);
                        img.src = data.directorSignature;
                    }
                    if (officerCanvasRef.current && data.authorizedOfficerSignature) {
                        const ctx = officerCanvasRef.current.getContext('2d');
                        const img = new Image();
                        img.onload = () => ctx.drawImage(img, 0, 0);
                        img.src = data.authorizedOfficerSignature;
                    }
                }, 100);
            }
        } catch (error) {
            console.error('Error loading company settings:', error);
            showToast('Failed to load company settings', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadSecuritySettings = async () => {
        try {
            const data = await getFinanceHubSettings();
            setSecuritySettings({
                authenticationType: data.authenticationType || 'Local',
                ssoEnabled: data.ssoEnabled ?? false,
                requireMfa: data.requireMfa ?? true,
                allowPasskeys: data.allowPasskeys ?? true,
                mfaProvider: data.mfaProvider || 'TOTP',
                passkeyProvider: data.passkeyProvider || 'WebAuthn',
                azureAdTenantId: data.azureAdTenantId || '',
                azureAdClientId: data.azureAdClientId || '',
                azureAdClientSecret: data.azureAdClientSecret || '',
                azureAdRedirectUri: data.azureAdRedirectUri || ''
            });
        } catch (error) {
            console.error('Error loading security settings:', error);
            setAdminMessage(error.message || 'Failed to load security settings');
        }
    };

    const loadPayrollSettings = async () => {
        try {
            const data = await getPayrollSettings();
            setPayrollSettingsForm(data);
        } catch (err) { console.error('Error loading payroll settings:', err); }
    };

    const handlePayrollSave = async () => {
        setPayrollSaving(true);
        try {
            const updated = await updatePayrollSettings(payrollSettingsForm);
            setPayrollSettingsForm(updated);
            showToast('Payroll settings saved!');
        } catch (err) {
            showToast('Failed to save payroll settings: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setPayrollSaving(false);
        }
    };

    const loadAccountants = async () => {
        setAccountantsLoading(true);
        try {
            const data = await getLinkedAccountants();
            setAccountants(Array.isArray(data) ? data : []);
        } catch (err) {
            showToast('Failed to load accountants: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setAccountantsLoading(false);
        }
    };

    const handleInviteAccountant = async () => {
        if (!inviteForm.email) return;
        setInviting(true);
        setLastInviteResult(null);
        try {
            const result = await inviteAccountant(inviteForm);
            if (result.emailSent) {
                showToast(`Invitation emailed to ${inviteForm.email}`);
            } else {
                showToast('Invitation created but email could not be sent — share the link manually.', 'warning');
            }
            setLastInviteResult(result);
            setInviteForm({ email: '', name: '', firmName: '' });
            await loadAccountants();
        } catch (err) {
            showToast(err.message || 'Failed to send invitation', 'error');
        } finally {
            setInviting(false);
        }
    };

    const handleRevokeAccountant = async (linkId) => {
        if (!window.confirm('Are you sure you want to revoke this accountant\'s access?')) return;
        try {
            await revokeAccountant(linkId);
            showToast('Accountant access revoked');
            await loadAccountants();
        } catch (err) {
            showToast(err.message || 'Failed to revoke access', 'error');
        }
    };

    const handleAdminAuthChange = (e) => {
        const { name, value } = e.target;
        setAdminAuth(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSecurityChange = (e) => {
        const { name, value, type, checked } = e.target;
        setSecuritySettings(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleAdminLogin = async () => {
        try {
            setAdminMessage('');
            const result = await adminLogin({
                username: adminAuth.username,
                password: adminAuth.password,
                mfaCode: adminAuth.mfaCode || undefined
            });
            setAdminLoggedIn(true);
            setMustChangePassword(result?.mustChangePassword === true);
            setAdminMessage('Admin login successful');
            if (result?.requireMfa && !adminAuth.mfaCode) {
                setAdminMessage('MFA required. Please enter your MFA code and sign in again.');
            }
            await loadSecuritySettings();
        } catch (error) {
            if (error.requiresMfaSetup) {
                setAdminMessage('MFA setup required. Click "Setup MFA" to continue.');
            } else {
                setAdminMessage(error.message || 'Admin login failed');
            }
        }
    };

    const handleMfaSetup = async () => {
        try {
            setAdminMessage('');
            const result = await adminMfaSetup({
                username: adminAuth.username,
                password: adminAuth.password
            });
            setMfaSetup({
                secret: result.secret || '',
                otpauthUri: result.otpauthUri || '',
                code: ''
            });
            setAdminMessage('MFA secret generated. Add it to your authenticator app and verify.');
        } catch (error) {
            setAdminMessage(error.message || 'MFA setup failed');
        }
    };

    const handleMfaVerify = async () => {
        try {
            setAdminMessage('');
            await adminMfaVerify(mfaSetup.code);
            setAdminMessage('MFA verified. Please sign in again with your MFA code.');
        } catch (error) {
            setAdminMessage(error.message || 'MFA verification failed');
        }
    };

    const handleSecuritySave = async () => {
        try {
            setSaving(true);
            await updateFinanceHubSettings(securitySettings);
            setAdminMessage('Security settings updated');
            await loadSecuritySettings();
        } catch (error) {
            setAdminMessage(error.message || 'Failed to update security settings');
        } finally {
            setSaving(false);
        }
    };

    const handlePasswordChange = async () => {
        try {
            setAdminMessage('');
            await adminChangePassword(passwordChange);
            setMustChangePassword(false);
            setPasswordChange({ currentPassword: '', newPassword: '' });
            setAdminMessage('Password updated');
        } catch (error) {
            setAdminMessage(error.message || 'Failed to change password');
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleCheckboxChange = (e) => {
        const { name, checked } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: checked
        }));
    };

    // Signature canvas functions with touch support
    const getCoordinates = (e, canvasRef) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        
        // Handle touch events
        if (e.touches && e.touches.length > 0) {
            const touch = e.touches[0];
            return {
                x: touch.clientX - rect.left,
                y: touch.clientY - rect.top
            };
        }
        
        // Handle mouse events
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const startDrawing = (canvasRef, setDrawing) => (e) => {
        if (!canvasRef.current) return;
        e.preventDefault(); // Prevent scrolling on touch
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        setDrawing(true);
        ctx.beginPath();
        const coords = getCoordinates(e, canvasRef);
        ctx.moveTo(coords.x, coords.y);
    };

    const draw = (canvasRef, isDrawing) => (e) => {
        if (!isDrawing || !canvasRef.current) return;
        e.preventDefault(); // Prevent scrolling on touch
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const coords = getCoordinates(e, canvasRef);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
    };

    const stopDrawing = (setDrawing) => (e) => {
        e.preventDefault();
        setDrawing(false);
    };

    const clearSignature = (canvasRef, signatureField) => () => {
        if (!canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setSettings(prev => ({ ...prev, [signatureField]: '' }));
    };

    const saveSignature = (canvasRef, signatureField) => async () => {
        if (!canvasRef.current) return;
        const dataUrl = canvasRef.current.toDataURL('image/png');
        console.log(`Saving ${signatureField}, length: ${dataUrl.length}`);
        setSettings(prev => ({ ...prev, [signatureField]: dataUrl }));

        try {
            setSaving(true);
            await updateCompanySettings({
                [signatureField]: dataUrl,
                directorName: settings.directorName || undefined,
                authorizedOfficerName: settings.authorizedOfficerName || undefined,
                hasAuthorizedOfficer: settings.hasAuthorizedOfficer
            });
            await loadSettings();
            showToast('Signature saved and synced to the server.');
        } catch (error) {
            console.error('Error saving signature:', error);
            showToast('Signature saved locally, but failed to sync. Click Save Settings to retry.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleTestEmail = async () => {
        try {
            setTesting(true);
            const defaultEmail = settings.companyEmail || settings.smtpFromAddress || '';
            const email = window.prompt('Send test email to:', defaultEmail) || '';
            const result = await testSmtpConfiguration(email.trim() || undefined);
            const toEmail = result?.toEmail || email || defaultEmail || 'your inbox';
            showToast(`Test email sent to ${toEmail}! Check your inbox.`);
        } catch (error) {
            console.error('Test email failed:', error);
            showToast(`Test email failed: ${error.message}`, 'error');
        } finally {
            setTesting(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            console.log('Submitting company settings - Director signature length:', settings.directorSignature?.length || 0);
            console.log('Submitting company settings - Officer signature length:', settings.authorizedOfficerSignature?.length || 0);
            const result = await updateCompanySettings(settings);
            console.log('Update result:', result);
            showToast('Settings saved successfully!');
            await loadSettings(); // Reload to get saved signatures
        } catch (error) {
            console.error('Error saving company settings:', error);
            showToast('Failed to save settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <div className="loading-text">Loading company settings...</div>
            </div>
        );
    }

    return (
        <div className="settings">
            <Toast toast={toast} onClose={() => setToast(null)} />
            <div className="page-header">
                <h1>⚙️ Settings</h1>
            </div>

            <div className="tabs">
                <button 
                    className={`tab ${activeTab === 'company' ? 'active' : ''}`}
                    onClick={() => setActiveTab('company')}
                >
                    � Company
                </button>
                <button 
                    className={`tab ${activeTab === 'hmrc' ? 'active' : ''}`}
                    onClick={() => setActiveTab('hmrc')}
                >
                    🏛️ HMRC
                </button>
                <button 
                    className={`tab ${activeTab === 'banking' ? 'active' : ''}`}
                    onClick={() => setActiveTab('banking')}
                >
                    🏦 Banking
                </button>
                <button 
                    className={`tab ${activeTab === 'email' ? 'active' : ''}`}
                    onClick={() => setActiveTab('email')}
                >
                    📧 Email
                </button>
                <button 
                    className={`tab ${activeTab === 'signatures' ? 'active' : ''}`}
                    onClick={() => setActiveTab('signatures')}
                >
                    ✍️ Signatures
                </button>
                <button 
                    className={`tab ${activeTab === 'payroll' ? 'active' : ''}`}
                    onClick={() => setActiveTab('payroll')}
                >
                    💷 Payroll
                </button>
                <button 
                    className={`tab ${activeTab === 'security' ? 'active' : ''}`}
                    onClick={() => setActiveTab('security')}
                >
                    🔐 Security
                </button>
                <button 
                    className={`tab ${activeTab === 'accountants' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('accountants'); loadAccountants(); }}
                >
                    👤 Accountants
                </button>
            </div>

            <form onSubmit={handleSubmit} className="entity-form">
                {activeTab === 'company' && (
                    <>
                <h2>Company Information</h2>
                <div className="form-row">
                    <div className="form-group">
                        <label>Company Inception / Incorporation Date</label>
                        <input
                            type="date"
                            name="companyInceptionDate"
                            value={settings.companyInceptionDate ? new Date(settings.companyInceptionDate).toISOString().split('T')[0] : ''}
                            onChange={handleChange}
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>The date your company was established. Also used by DLA to classify pre/post-incorporation costs and as the default Financial Year start.</small>
                    </div>
                    <div className="form-group" />
                </div>

                <h3 style={{marginTop: '2rem', marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem'}}>Financial Year Settings</h3>
                <div style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#e7f3ff', borderRadius: '4px', fontSize: '0.9rem'}}>
                    <strong>ℹ️ Note:</strong> If left blank, your FY will default to your Company Inception Date above. Only fill these in if your FY starts on a different date (e.g., UK tax year: April 6).
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>FY Start Month (1-12) - Optional</label>
                        <input
                            type="number"
                            name="fyStartMonth"
                            min="1"
                            max="12"
                            value={settings.fyStartMonth || ''}
                            onChange={handleChange}
                            placeholder="Leave blank to use inception date"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Override FY start month (1=Jan, 4=Apr, etc.)</small>
                    </div>
                    <div className="form-group">
                        <label>FY Start Day (1-31) - Optional</label>
                        <input
                            type="number"
                            name="fyStartDay"
                            min="1"
                            max="31"
                            value={settings.fyStartDay || ''}
                            onChange={handleChange}
                            placeholder="Leave blank to use inception date"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Override FY start day of month</small>
                    </div>
                </div>

                <h2 style={{marginTop: '2rem'}}>Company Details</h2>
                <div className="form-row">
                    <div className="form-group">
                        <label>Company Name *</label>
                        <input
                            type="text"
                            name="companyName"
                            value={settings.companyName}
                            onChange={handleChange}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>Registration Number</label>
                        <input
                            type="text"
                            name="companyRegistrationNumber"
                            value={settings.companyRegistrationNumber}
                            onChange={handleChange}
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Company Address</label>
                        <textarea
                            name="companyAddress"
                            value={settings.companyAddress}
                            onChange={handleChange}
                            rows="3"
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Phone</label>
                        <input
                            type="tel"
                            name="companyPhone"
                            value={settings.companyPhone}
                            onChange={handleChange}
                        />
                    </div>
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            name="companyEmail"
                            value={settings.companyEmail}
                            onChange={handleChange}
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group full-width">
                        <label>Directors</label>
                        <input
                            type="text"
                            name="directors"
                            value={settings.directors}
                            onChange={handleChange}
                            placeholder="e.g., Andrew Kemp, Jane Smith, John Doe"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Comma-separated list of director names for DLA entries</small>
                    </div>
                </div>

                <h2 style={{marginTop: '2rem'}}>PAYE Settlement Agreement (PSA)</h2>
                <div style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fff3cd', borderRadius: '4px', fontSize: '0.9rem'}}>
                    <strong>📋 PSA:</strong> A PSA allows you to make one annual payment to HMRC to cover all tax and National Insurance due on minor, irregular or impracticable expenses or benefits for employees (e.g. Staff Entertainment above £150/head).
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                            <input
                                type="checkbox"
                                name="psaApproved"
                                checked={settings.psaApproved || false}
                                onChange={handleCheckboxChange}
                            />
                            <span>PSA Approved by HMRC</span>
                        </label>
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Check this once HMRC has approved your PSA arrangement — a PSA card will appear on the Dashboard</small>
                    </div>
                    {settings.psaApproved && (
                        <div className="form-group">
                            <label>PSA Reference / Contact Name</label>
                            <input
                                type="text"
                                name="psaContactName"
                                value={settings.psaContactName || ''}
                                onChange={handleChange}
                                placeholder="e.g., HMRC reference or contact name"
                            />
                        </div>
                    )}
                </div>

                <h2 style={{marginTop: '2rem'}}>Compliance &amp; Audit</h2>
                <div style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f8d7da', borderRadius: '4px', fontSize: '0.9rem', border: '1px solid #f5c2c7'}}>
                    <strong>🔒 Data Deletion Lock:</strong> By default, all record deletion is <strong>disabled</strong> for production safety. Enable 'Allow Data Deletion' below to permit deletion of any record. This is the master switch — leave it OFF in production to prevent accidental data loss.
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                            <input
                                type="checkbox"
                                name="allowDataDeletion"
                                checked={settings.allowDataDeletion || false}
                                onChange={handleCheckboxChange}
                            />
                            <span style={{fontWeight: '600', color: (settings.allowDataDeletion ? '#dc3545' : '#198754')}}>Allow Data Deletion {settings.allowDataDeletion ? '(⚠️ ENABLED — records can be deleted)' : '(🔒 LOCKED — no records can be deleted)'}</span>
                        </label>
                        <small style={{color: '#666', fontSize: '0.85rem'}}>⚠️ Master switch. When OFF, all delete operations across the entire system are blocked. Keep OFF in production. When ON, deletion is permitted for all record types (subject to individual guards below).</small>
                    </div>
                </div>
                <div style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fff3cd', borderRadius: '4px', fontSize: '0.9rem'}}>
                    <strong>⚖️ HMRC Compliance:</strong> Dividend records are subject to HMRC audit. By default, finalised dividends cannot be deleted to maintain a complete audit trail. Draft dividends can always be deleted. Enable deletion of finalised dividends only for testing or correction purposes.
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                            <input
                                type="checkbox"
                                name="allowDividendDeletion"
                                checked={settings.allowDividendDeletion || false}
                                onChange={handleCheckboxChange}
                            />
                            <span>Allow Finalised Dividend Deletion</span>
                        </label>
                        <small style={{color: '#666', fontSize: '0.85rem'}}>⚠️ When enabled, finalised dividends can be deleted. Draft dividends can always be deleted without this setting. Disable in production for HMRC compliance.</small>
                    </div>
                </div>

                <h2>Shared Mailboxes</h2>
                <div className="form-row">
                    <div className="form-group">
                        <label>Invoices Mailbox</label>
                        <input
                            type="email"
                            name="invoicesEmail"
                            value={settings.invoicesEmail}
                            onChange={handleChange}
                            placeholder="invoices@domain.com"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Email address for sending invoices</small>
                    </div>
                    <div className="form-group">
                        <label>Quotes Mailbox</label>
                        <input
                            type="email"
                            name="quotesEmail"
                            value={settings.quotesEmail}
                            onChange={handleChange}
                            placeholder="quotes@domain.com"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Email address for sending quotes</small>
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Payments Mailbox</label>
                        <input
                            type="email"
                            name="paymentsEmail"
                            value={settings.paymentsEmail}
                            onChange={handleChange}
                            placeholder="payments@domain.com"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Contact email for payment queries</small>
                    </div>
                </div>

                <h2>Invoice & Quote Settings</h2>
                <div className="form-row">
                    <div className="form-group">
                        <label>Invoice Prefix</label>
                        <input
                            type="text"
                            name="invoicePrefix"
                            value={settings.invoicePrefix}
                            onChange={handleChange}
                            placeholder="INV"
                        />
                    </div>
                    <div className="form-group">
                        <label>Quote Prefix</label>
                        <input
                            type="text"
                            name="quotePrefix"
                            value={settings.quotePrefix}
                            onChange={handleChange}
                            placeholder="QUO"
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Default VAT Rate (%)</label>
                        <input
                            type="number"
                            name="defaultVATRate"
                            value={settings.defaultVATRate}
                            onChange={handleChange}
                            min="0"
                            max="100"
                        />
                    </div>
                    <div className="form-group">
                        <label>Invoice Payment Terms (Days)</label>
                        <input
                            type="number"
                            name="invoiceTermsDays"
                            value={settings.invoiceTermsDays}
                            onChange={handleChange}
                            min="0"
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Invoice Footer Text (Auto-Generated)</label>
                        <textarea
                            name="invoiceFooterText"
                            value={buildAutoInvoiceFooterText(settings)}
                            readOnly
                            rows="3"
                            placeholder="Auto-generated from company registration, VAT, and address"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Generated from Company Name, Registration Number, VAT, and Address.</small>
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Company Logo URL</label>
                        <input
                            type="url"
                            name="logoUrl"
                            value={settings.logoUrl}
                            onChange={handleChange}
                            placeholder="https://..."
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Default logo — used when document/email logos are not set. Auto-updated when uploading a logo in Company Documents.</small>
                    </div>
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>Document Logo URL (PDFs)</label>
                        <input
                            type="url"
                            name="documentLogoUrl"
                            value={settings.documentLogoUrl}
                            onChange={handleChange}
                            placeholder="https://... (leave blank to use default logo)"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Used on invoices, quotes, credit notes, payslips, and other PDF documents.</small>
                    </div>
                    <div className="form-group">
                        <label>Email Logo URL</label>
                        <input
                            type="url"
                            name="emailLogoUrl"
                            value={settings.emailLogoUrl}
                            onChange={handleChange}
                            placeholder="https://... (leave blank to use default logo)"
                        />
                        <small style={{color: '#666', fontSize: '0.85rem'}}>Used in the header of email templates (invoice, quote, payment emails, etc.).</small>
                    </div>
                </div>
                    </>
                )}

                {activeTab === 'email' && (
                    <>
                        <h2>SMTP Configuration</h2>
                        <div style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#e7f3ff', borderRadius: '4px', fontSize: '0.9rem'}}>
                            <strong>ℹ️ Note:</strong> Invoices will be sent from <strong>{settings.invoicesEmail || 'Invoices Email'}</strong>, 
                            Quotes from <strong>{settings.quotesEmail || 'Quotes Email'}</strong>. 
                            Other emails will use the SMTP From Address below.
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>SMTP Server *</label>
                                <input
                                    type="text"
                                    name="smtpServer"
                                    value={settings.smtpServer}
                                    onChange={handleChange}
                                    placeholder="mail.smtp2go.com"
                                    required
                                />
                                <small>Your SMTP mail server hostname</small>
                            </div>
                            <div className="form-group">
                                <label>SMTP Port *</label>
                                <input
                                    type="number"
                                    name="smtpPort"
                                    value={settings.smtpPort}
                                    onChange={handleChange}
                                    placeholder="2525"
                                    required
                                />
                                <small>Common ports: 2525, 587, 465</small>
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>SMTP From Address (Default)</label>
                                <input
                                    type="email"
                                    name="smtpFromAddress"
                                    value={settings.smtpFromAddress}
                                    onChange={handleChange}
                                    placeholder="noreply@company.com"
                                />
                                <small>Used for system emails and notifications</small>
                            </div>
                            <div className="form-group">
                                <label>SMTP Username</label>
                                <input
                                    type="text"
                                    name="smtpUsername"
                                    value={settings.smtpUsername}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>SMTP Password</label>
                                <input
                                    type="password"
                                    name="smtpPassword"
                                    value={settings.smtpPassword}
                                    onChange={handleChange}
                                    placeholder="Leave blank to keep existing"
                                />
                                <small>🔐 Stored securely in Azure Key Vault</small>
                            </div>
                        </div>

                        <div style={{marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
                            <h3 style={{marginTop: 0}}>Test Email Configuration</h3>
                            <p style={{color: '#666', marginBottom: '1rem'}}>Send a test email to verify your SMTP settings are working correctly.</p>
                            <button
                                type="button"
                                onClick={handleTestEmail}
                                disabled={testing || !settings.smtpServer || !settings.smtpPort || !settings.smtpFromAddress || !settings.smtpUsername}
                                style={{padding: '0.75rem 1.5rem', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem'}}
                            >
                                {testing ? 'Sending Test Email...' : '📧 Send Test Email'}
                            </button>
                            {(!settings.smtpServer || !settings.smtpPort || !settings.smtpFromAddress || !settings.smtpUsername) && (
                                <p style={{color: '#dc3545', marginTop: '0.5rem', fontSize: '0.9rem'}}>
                                    Please configure all SMTP settings before testing
                                </p>
                            )}
                        </div>
                    </>
                )}

                {activeTab === 'signatures' && (
                    <>
                        <h2>Digital Signatures</h2>
                        <p style={{color: '#666', marginBottom: '1rem'}}>Draw signatures below. These will be used on invoices, quotes, and company documents.</p>
                        
                        <h3 style={{marginTop: '2rem', marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem'}}>Director Signature</h3>
                        <div className="form-group">
                            <label>Director Name *</label>
                            <input
                                type="text"
                                name="directorName"
                                value={settings.directorName}
                                onChange={handleChange}
                                placeholder="e.g., John Smith"
                                required
                            />
                            <small>This name will appear alongside the signature on documents</small>
                        </div>
                        <div className="form-group" style={{marginBottom: '2rem'}}>
                            <label>Director Signature *</label>
                            <div style={{border: '1px solid #ddd', borderRadius: '4px', padding: '0.5rem', backgroundColor: '#fff'}}>
                                <canvas
                                    ref={directorCanvasRef}
                                    width={400}
                                    height={150}
                                    style={{border: '1px dashed #ccc', cursor: 'crosshair', display: 'block', width: '100%', maxWidth: '400px', touchAction: 'none'}}
                                    onMouseDown={startDrawing(directorCanvasRef, setIsDrawingDirector)}
                                    onMouseMove={draw(directorCanvasRef, isDrawingDirector)}
                                    onMouseUp={stopDrawing(setIsDrawingDirector)}
                                    onMouseLeave={stopDrawing(setIsDrawingDirector)}
                                    onTouchStart={startDrawing(directorCanvasRef, setIsDrawingDirector)}
                                    onTouchMove={draw(directorCanvasRef, isDrawingDirector)}
                                    onTouchEnd={stopDrawing(setIsDrawingDirector)}
                                />
                                <div style={{marginTop: '0.5rem', display: 'flex', gap: '0.5rem'}}>
                                    <button
                                        type="button"
                                        onClick={clearSignature(directorCanvasRef, 'directorSignature')}
                                        style={{padding: '0.5rem 1rem', fontSize: '0.9rem'}}
                                    >
                                        Clear
                                    </button>
                                    <button
                                        type="button"
                                        onClick={saveSignature(directorCanvasRef, 'directorSignature')}
                                        style={{padding: '0.5rem 1rem', fontSize: '0.9rem', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                                    >
                                        Save Signature
                                    </button>
                                </div>
                            </div>
                        </div>

                        <h3 style={{marginTop: '2rem', marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem'}}>Authorized Officer (Optional)</h3>
                        <div className="form-group">
                            <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                <input
                                    type="checkbox"
                                    name="hasAuthorizedOfficer"
                                    checked={settings.hasAuthorizedOfficer}
                                    onChange={handleCheckboxChange}
                                />
                                <span>Company has an Authorized Officer</span>
                            </label>
                            <small style={{display: 'block', marginTop: '0.25rem', color: '#666'}}>
                                If unchecked, the Director signature will be used for all documents
                            </small>
                        </div>

                        {settings.hasAuthorizedOfficer && (
                            <>
                                <div className="form-group">
                                    <label>Authorized Officer Name *</label>
                                    <input
                                        type="text"
                                        name="authorizedOfficerName"
                                        value={settings.authorizedOfficerName}
                                        onChange={handleChange}
                                        placeholder="e.g., Jane Doe"
                                        required={settings.hasAuthorizedOfficer}
                                    />
                                    <small>This name will appear alongside the signature on documents</small>
                                </div>
                                <div className="form-group" style={{marginBottom: '2rem'}}>
                                    <label>Authorized Officer Signature *</label>
                                    <div style={{border: '1px solid #ddd', borderRadius: '4px', padding: '0.5rem', backgroundColor: '#fff'}}>
                                        <canvas
                                            ref={officerCanvasRef}
                                            width={400}
                                            height={150}
                                            style={{border: '1px dashed #ccc', cursor: 'crosshair', display: 'block', width: '100%', maxWidth: '400px', touchAction: 'none'}}
                                            onMouseDown={startDrawing(officerCanvasRef, setIsDrawingOfficer)}
                                            onMouseMove={draw(officerCanvasRef, isDrawingOfficer)}
                                            onMouseUp={stopDrawing(setIsDrawingOfficer)}
                                            onMouseLeave={stopDrawing(setIsDrawingOfficer)}
                                            onTouchStart={startDrawing(officerCanvasRef, setIsDrawingOfficer)}
                                            onTouchMove={draw(officerCanvasRef, isDrawingOfficer)}
                                            onTouchEnd={stopDrawing(setIsDrawingOfficer)}
                                        />
                                        <div style={{marginTop: '0.5rem', display: 'flex', gap: '0.5rem'}}>
                                            <button
                                                type="button"
                                                onClick={clearSignature(officerCanvasRef, 'authorizedOfficerSignature')}
                                                style={{padding: '0.5rem 1rem', fontSize: '0.9rem'}}
                                            >
                                                Clear
                                            </button>
                                            <button
                                                type="button"
                                                onClick={saveSignature(officerCanvasRef, 'authorizedOfficerSignature')}
                                                style={{padding: '0.5rem 1rem', fontSize: '0.9rem', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                                            >
                                                Save Signature
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </>
                )}

                {activeTab === 'security' && (
                    <>
                        <h2>Security & SSO</h2>
                        <p style={{color: '#666', marginBottom: '1rem'}}>
                            Configure SSO and security defaults. MFA is enabled by default. Passkeys are supported through Entra SSO.
                        </p>

                        {!adminLoggedIn && (
                            <div style={{marginBottom: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '6px'}}>
                                <h3>Admin Login</h3>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Username</label>
                                        <input
                                            type="text"
                                            name="username"
                                            value={adminAuth.username}
                                            onChange={handleAdminAuthChange}
                                            placeholder="admin"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Password</label>
                                        <input
                                            type="password"
                                            name="password"
                                            value={adminAuth.password}
                                            onChange={handleAdminAuthChange}
                                            placeholder="Enter admin password"
                                        />
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>MFA Code (if enabled)</label>
                                        <input
                                            type="text"
                                            name="mfaCode"
                                            value={adminAuth.mfaCode}
                                            onChange={handleAdminAuthChange}
                                            placeholder="123456"
                                        />
                                    </div>
                                </div>
                                <div style={{display: 'flex', gap: '0.75rem', marginTop: '0.5rem'}}>
                                    <button type="button" className="btn-primary" onClick={handleAdminLogin}>
                                        Sign In
                                    </button>
                                    <button type="button" className="btn-secondary" onClick={handleMfaSetup}>
                                        Setup MFA
                                    </button>
                                </div>
                                {adminMessage && (
                                    <div style={{marginTop: '0.75rem', color: '#555'}}>{adminMessage}</div>
                                )}

                                {mfaSetup.secret && (
                                    <div style={{marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f8f9fa', borderRadius: '6px'}}>
                                        <div style={{fontWeight: 600}}>MFA Secret</div>
                                        <div style={{fontFamily: 'monospace', wordBreak: 'break-all'}}>{mfaSetup.secret}</div>
                                        <div style={{marginTop: '0.5rem'}}>
                                            <label>Verify Code</label>
                                            <input
                                                type="text"
                                                value={mfaSetup.code}
                                                onChange={(e) => setMfaSetup(prev => ({ ...prev, code: e.target.value }))}
                                                placeholder="123456"
                                            />
                                            <button type="button" className="btn-secondary" style={{marginLeft: '0.5rem'}} onClick={handleMfaVerify}>
                                                Verify MFA
                                            </button>
                                        </div>
                                        {mfaSetup.otpauthUri && (
                                            <div style={{marginTop: '0.5rem', fontSize: '0.85rem', color: '#666'}}>
                                                OTP URI: {mfaSetup.otpauthUri}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {adminLoggedIn && (
                            <>
                                {mustChangePassword && (
                                    <div style={{marginBottom: '1.5rem', padding: '1rem', border: '1px solid #f0ad4e', borderRadius: '6px', backgroundColor: '#fff8e1'}}>
                                        <h3>Change Admin Password</h3>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Current Password</label>
                                                <input
                                                    type="password"
                                                    value={passwordChange.currentPassword}
                                                    onChange={(e) => setPasswordChange(prev => ({ ...prev, currentPassword: e.target.value }))}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>New Password</label>
                                                <input
                                                    type="password"
                                                    value={passwordChange.newPassword}
                                                    onChange={(e) => setPasswordChange(prev => ({ ...prev, newPassword: e.target.value }))}
                                                />
                                            </div>
                                        </div>
                                        <button type="button" className="btn-primary" onClick={handlePasswordChange}>
                                            Update Password
                                        </button>
                                    </div>
                                )}

                                <h3>Authentication Mode</h3>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Authentication Type</label>
                                        <select name="authenticationType" value={securitySettings.authenticationType} onChange={handleSecurityChange}>
                                            <option value="Local">Local (Admin Login)</option>
                                            <option value="AzureAD">Azure AD (Entra SSO)</option>
                                            <option value="SAML">SAML</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                        <input
                                            type="checkbox"
                                            name="ssoEnabled"
                                            checked={securitySettings.ssoEnabled}
                                            onChange={handleSecurityChange}
                                        />
                                        <label>Enable SSO</label>
                                    </div>
                                </div>

                                <h3>MFA & Passkeys</h3>
                                <div className="form-row">
                                    <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                        <input
                                            type="checkbox"
                                            name="requireMfa"
                                            checked={securitySettings.requireMfa}
                                            onChange={handleSecurityChange}
                                        />
                                        <label>Require MFA (Local Admin)</label>
                                    </div>
                                    <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                        <input
                                            type="checkbox"
                                            name="allowPasskeys"
                                            checked={securitySettings.allowPasskeys}
                                            onChange={handleSecurityChange}
                                        />
                                        <label>Allow Passkeys (Entra SSO)</label>
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>MFA Provider</label>
                                        <select name="mfaProvider" value={securitySettings.mfaProvider} onChange={handleSecurityChange}>
                                            <option value="TOTP">TOTP</option>
                                            <option value="Email">Email</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Passkey Provider</label>
                                        <select name="passkeyProvider" value={securitySettings.passkeyProvider} onChange={handleSecurityChange}>
                                            <option value="WebAuthn">WebAuthn</option>
                                        </select>
                                    </div>
                                </div>

                                <h3>Azure AD (Entra) Configuration</h3>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Tenant ID</label>
                                        <input type="text" name="azureAdTenantId" value={securitySettings.azureAdTenantId} onChange={handleSecurityChange} />
                                    </div>
                                    <div className="form-group">
                                        <label>Client ID</label>
                                        <input type="text" name="azureAdClientId" value={securitySettings.azureAdClientId} onChange={handleSecurityChange} />
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Client Secret</label>
                                        <input type="password" name="azureAdClientSecret" value={securitySettings.azureAdClientSecret} onChange={handleSecurityChange} />
                                    </div>
                                    <div className="form-group">
                                        <label>Redirect URI</label>
                                        <input type="text" name="azureAdRedirectUri" value={securitySettings.azureAdRedirectUri} onChange={handleSecurityChange} />
                                    </div>
                                </div>

                                <div style={{marginTop: '1rem', display: 'flex', gap: '0.75rem'}}>
                                    <button type="button" className="btn-primary" onClick={handleSecuritySave} disabled={saving}>
                                        {saving ? 'Saving...' : 'Save Security Settings'}
                                    </button>
                                    {adminMessage && (
                                        <div style={{alignSelf: 'center', color: '#555'}}>{adminMessage}</div>
                                    )}
                                </div>
                            </>
                        )}
                    </>
                )}

                {activeTab === 'hmrc' && (
                    <>
                        <h2>🏛️ HMRC Credentials &amp; Tax</h2>
                        <div style={{marginBottom: '1.5rem', padding: '0.75rem', backgroundColor: '#e7f3ff', borderRadius: '4px', fontSize: '0.9rem'}}>
                            <strong>ℹ️ Shared Credentials:</strong> Your HMRC Government Gateway User ID and password are used by both <strong>VAT MTD submissions</strong> and <strong>Payroll RTI (FPS/EPS)</strong>. Enter them once here and they are stored securely in Azure Key Vault — never in the database.
                        </div>

                        <h3 style={{marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem'}}>Government Gateway Credentials</h3>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Government Gateway User ID</label>
                                <input
                                    type="text"
                                    name="hmrcGatewayUserId"
                                    value={settings.hmrcGatewayUserId || ''}
                                    onChange={handleChange}
                                    placeholder="12-digit Gateway User ID"
                                    autoComplete="off"
                                />
                                <small style={{color: '#666', fontSize: '0.85rem'}}>Your HMRC Online Services login ID — used for VAT MTD and Payroll RTI submissions</small>
                            </div>
                            <div className="form-group">
                                <label>Government Gateway Password</label>
                                <input
                                    type="password"
                                    name="hmrcGatewayPassword"
                                    value={settings.hmrcGatewayPassword || ''}
                                    onChange={handleChange}
                                    placeholder="Stored securely in Key Vault"
                                    autoComplete="new-password"
                                />
                                <small style={{color: '#666', fontSize: '0.85rem'}}>⚠️ Stored in Azure Key Vault — not in the database. Leave blank to keep existing password.</small>
                            </div>
                        </div>

                        <h3 style={{marginTop: '2rem', marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem'}}>Tax References</h3>
                        <div className="form-row">
                            <div className="form-group">
                                <label>UTR — Unique Taxpayer Reference</label>
                                <input
                                    type="text"
                                    name="utr"
                                    value={settings.utr || ''}
                                    onChange={handleChange}
                                    placeholder="e.g. 1234567890"
                                />
                                <small style={{color: '#666', fontSize: '0.85rem'}}>10-digit HMRC reference for your company's Corporation Tax</small>
                            </div>
                            <div className="form-group">
                                <label>VAT Registration Number</label>
                                <input
                                    type="text"
                                    name="vatRegistrationNumber"
                                    value={settings.vatRegistrationNumber || ''}
                                    onChange={handleChange}
                                    placeholder="GB 123 4567 89"
                                />
                                <small style={{color: '#666', fontSize: '0.85rem'}}>Shown on invoices and VAT returns</small>
                            </div>
                        </div>

                        <h3 style={{marginTop: '2rem', marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem'}}>VAT Settings</h3>
                        <div style={{marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fff8e1', borderRadius: '4px', fontSize: '0.9rem'}}>
                            <strong>📋 VAT Quarter Stagger:</strong> HMRC assigns businesses to one of three VAT quarter cycles based on when you registered. Pick the month your first quarter starts — this determines all four quarters for the year.
                            <ul style={{margin: '0.5rem 0 0 1rem', padding: 0}}>
                                <li><strong>January</strong> → Q1 Jan/Feb/Mar · Q2 Apr/May/Jun · Q3 Jul/Aug/Sep · Q4 Oct/Nov/Dec</li>
                                <li><strong>February</strong> → Q1 Feb/Mar/Apr · Q2 May/Jun/Jul · Q3 Aug/Sep/Oct · Q4 Nov/Dec/Jan</li>
                                <li><strong>March</strong> → Q1 Mar/Apr/May · Q2 Jun/Jul/Aug · Q3 Sep/Oct/Nov · Q4 Dec/Jan/Feb</li>
                            </ul>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>VAT Quarter Stagger Month</label>
                                <select
                                    name="vatQuarterStartMonth"
                                    value={settings.vatQuarterStartMonth || ''}
                                    onChange={handleChange}
                                >
                                    <option value="">— Select your VAT stagger —</option>
                                    <option value="1">January  (Q1 Jan/Feb/Mar · Q2 Apr · Q3 Jul · Q4 Oct)</option>
                                    <option value="2">February (Q1 Feb/Mar/Apr · Q2 May · Q3 Aug · Q4 Nov)</option>
                                    <option value="3">March    (Q1 Mar/Apr/May · Q2 Jun · Q3 Sep · Q4 Dec)</option>
                                </select>
                                <small style={{color: '#666', fontSize: '0.85rem'}}>Used by the VAT Returns page and the dashboard VAT tracker</small>
                            </div>
                            <div className="form-group">
                                <label>VAT Effective Date</label>
                                <input
                                    type="date"
                                    name="vatEffectiveDate"
                                    value={settings.vatEffectiveDate || ''}
                                    onChange={handleChange}
                                />
                                <small style={{color: '#666', fontSize: '0.85rem'}}>When your VAT registration became effective — quarters before this date won't trigger filing reminders</small>
                            </div>
                            <div className="form-group">
                                <label>VAT Accounting Method</label>
                                <select
                                    name="vatAccountingMethod"
                                    value={settings.vatAccountingMethod || 'invoice'}
                                    onChange={handleChange}
                                >
                                    <option value="invoice">Invoice (Standard) — VAT counted when invoice is raised</option>
                                    <option value="cash">Cash Accounting — VAT counted when payment is received</option>
                                </select>
                                <small style={{color: '#666', fontSize: '0.85rem'}}>UK Cash Accounting Scheme available for turnover under £1.35m. Invoices only count once marked Paid.</small>
                            </div>
                        </div>

                        <div style={{marginTop: '1.5rem'}}>
                            <button type="submit" className="btn-primary" disabled={saving}>
                                {saving ? 'Saving...' : '💾 Save HMRC Settings'}
                            </button>
                        </div>
                    </>
                )}

                {activeTab === 'banking' && (
                    <>
                        <h2>🏦 Banking Details</h2>
                        <p style={{color: '#666', marginBottom: '1.5rem'}}>
                            Your company bank account details — shown on invoices and used for payment references.
                        </p>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Bank Name</label>
                                <input
                                    type="text"
                                    name="bankName"
                                    value={settings.bankName || ''}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>Bank Account Number</label>
                                <input
                                    type="text"
                                    name="bankAccountNumber"
                                    value={settings.bankAccountNumber || ''}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Sort Code</label>
                                <input
                                    type="text"
                                    name="bankSortCode"
                                    value={settings.bankSortCode || ''}
                                    onChange={handleChange}
                                    placeholder="00-00-00"
                                />
                            </div>
                            <div className="form-group">
                                <label>Default Currency</label>
                                <select
                                    name="defaultCurrency"
                                    value={settings.defaultCurrency || 'GBP'}
                                    onChange={handleChange}
                                >
                                    <option value="GBP">GBP (£)</option>
                                    <option value="USD">USD ($)</option>
                                    <option value="EUR">EUR (€)</option>
                                </select>
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>IBAN</label>
                                <input
                                    type="text"
                                    name="bankIBAN"
                                    value={settings.bankIBAN || ''}
                                    onChange={handleChange}
                                    placeholder="International Bank Account Number"
                                />
                            </div>
                            <div className="form-group">
                                <label>SWIFT/BIC</label>
                                <input
                                    type="text"
                                    name="bankSwiftCode"
                                    value={settings.bankSwiftCode || ''}
                                    onChange={handleChange}
                                    placeholder="Bank Identifier Code"
                                />
                            </div>
                        </div>

                        <div style={{marginTop: '1.5rem'}}>
                            <button type="submit" className="btn-primary" disabled={saving}>
                                {saving ? 'Saving...' : '💾 Save Banking Details'}
                            </button>
                        </div>

                        {/* ── GoCardless Configuration ── */}
                        <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
                            <h3>💳 GoCardless Configuration</h3>
                            <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                Direct Debit mandates, payments &amp; open-banking bank feeds. Configure your GoCardless API keys below.
                                Fees: 1% + 20p capped at £2 per transaction.
                            </p>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Access Token (Payments API)</label>
                                    <input
                                        type="password"
                                        name="goCardlessAccessToken"
                                        value={settings.goCardlessAccessToken || ''}
                                        onChange={handleChange}
                                        placeholder="live_..."
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Webhook Secret</label>
                                    <input
                                        type="password"
                                        name="goCardlessWebhookSecret"
                                        value={settings.goCardlessWebhookSecret || ''}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Bank Data — Secret ID</label>
                                    <input
                                        type="password"
                                        name="goCardlessSecretId"
                                        value={settings.goCardlessSecretId || ''}
                                        onChange={handleChange}
                                        placeholder="Bank Account Data API secret ID"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Bank Data — Secret Key</label>
                                    <input
                                        type="password"
                                        name="goCardlessSecretKey"
                                        value={settings.goCardlessSecretKey || ''}
                                        onChange={handleChange}
                                        placeholder="Bank Account Data API secret key"
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            name="goCardlessSandbox"
                                            checked={settings.goCardlessSandbox ?? true}
                                            onChange={e => handleChange({ target: { name: 'goCardlessSandbox', value: e.target.checked } })}
                                        />
                                        Sandbox Mode
                                    </label>
                                    <small style={{ color: '#666', fontSize: '0.8rem' }}>Use GoCardless sandbox environment for testing</small>
                                </div>
                                <div className="form-group">
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            name="goCardlessBankDataEnabled"
                                            checked={settings.goCardlessBankDataEnabled ?? false}
                                            onChange={e => handleChange({ target: { name: 'goCardlessBankDataEnabled', value: e.target.checked } })}
                                        />
                                        Enable Bank Data (Open Banking)
                                    </label>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            name="goCardlessPaymentsEnabled"
                                            checked={settings.goCardlessPaymentsEnabled ?? false}
                                            onChange={e => handleChange({ target: { name: 'goCardlessPaymentsEnabled', value: e.target.checked } })}
                                        />
                                        Enable Payments (DD + Instant Bank Pay)
                                    </label>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {activeTab !== 'security' && activeTab !== 'hmrc' && activeTab !== 'banking' && activeTab !== 'payroll' && (
                    <button type="submit" className="btn-primary" disabled={saving}>
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                )}
            </form>

            {/* ── Payroll Tab (outside main form — uses its own save) ── */}
            {activeTab === 'payroll' && payrollSettingsForm && (
                <div className="entity-form">
                    <h2>⚙ PAYE Settings</h2>

                    {/* ── HMRC References ── */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                                      color: '#6b7280', marginBottom: '0.75rem', paddingBottom: '0.4rem',
                                      borderBottom: '1px solid #e5e7eb' }}>
                            🏛 HMRC References
                        </div>
                        <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.875rem', backgroundColor: '#e7f3ff', borderRadius: '4px', fontSize: '0.85rem', color: '#1e40af' }}>
                            🔑 <strong>Government Gateway User ID &amp; Password</strong> are configured in the <strong>HMRC tab</strong> above — they are shared between Payroll RTI and VAT MTD submissions.
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Employer PAYE Reference</label>
                                <input placeholder="123/AB12345"
                                    value={payrollSettingsForm.employerPAYEReference ?? ''}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, employerPAYEReference: e.target.value })} />
                                <small style={{ color: '#6b7280' }}>e.g. 123/AB12345</small>
                            </div>
                            <div className="form-group">
                                <label>Accounts Office Reference</label>
                                <input placeholder="123PA12345678"
                                    value={payrollSettingsForm.accountsOfficeReference ?? ''}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, accountsOfficeReference: e.target.value })} />
                                <small style={{ color: '#6b7280' }}>e.g. 123PA12345678 — used on BACS payments to HMRC</small>
                            </div>
                        </div>
                    </div>

                    {/* ── Pay & Tax Defaults ── */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                                      color: '#6b7280', marginBottom: '0.75rem', paddingBottom: '0.4rem',
                                      borderBottom: '1px solid #e5e7eb' }}>
                            💷 Pay &amp; Tax Defaults
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Default Tax Code</label>
                                <input placeholder="1257L"
                                    value={payrollSettingsForm.defaultTaxCode ?? '1257L'}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, defaultTaxCode: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Default NI Category</label>
                                <select value={payrollSettingsForm.defaultNiCategory ?? 'A'}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, defaultNiCategory: e.target.value })}>
                                    <option value="A">A – Standard rate</option>
                                    <option value="B">B – Married women's reduced rate</option>
                                    <option value="C">C – Over state pension age</option>
                                    <option value="H">H – Apprentice under 25</option>
                                    <option value="M">M – Under 21</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Pay Day of Month</label>
                                <input type="number" min="1" max="28"
                                    value={payrollSettingsForm.payDayOfMonth ?? 25}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, payDayOfMonth: parseInt(e.target.value) || 25 })} />
                                <small style={{ color: '#6b7280' }}>{payrollSettingsForm.payDayOfMonth ?? 25}th of each month</small>
                            </div>
                            <div className="form-group">
                                <label>Employment Allowance</label>
                                <select value={payrollSettingsForm.employmentAllowanceEligible ? 'true' : 'false'}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, employmentAllowanceEligible: e.target.value === 'true' })}>
                                    <option value="false">Not eligible (sole director)</option>
                                    <option value="true">Eligible</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* ── Email & Pension ── */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                                      color: '#6b7280', marginBottom: '0.75rem', paddingBottom: '0.4rem',
                                      borderBottom: '1px solid #e5e7eb' }}>
                            📧 Email &amp; Pension
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Payroll Email Address</label>
                                <input type="email" placeholder="payroll@example.com"
                                    value={payrollSettingsForm.payrollEmail ?? ''}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, payrollEmail: e.target.value })} />
                                <small style={{ color: '#6b7280' }}>From address for payslips, P11D forms and payroll emails</small>
                            </div>
                            <div className="form-group">
                                <label>Pension Provider</label>
                                <input placeholder="e.g. Nest, The People's Pension"
                                    value={payrollSettingsForm.pensionProvider ?? ''}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, pensionProvider: e.target.value })} />
                                <small style={{ color: '#6b7280' }}>Shown on payslips for reference</small>
                            </div>
                        </div>
                    </div>

                    {/* ── Auto-Schedule ── */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                                      color: '#6b7280', marginBottom: '0.75rem', paddingBottom: '0.4rem',
                                      borderBottom: '1px solid #e5e7eb' }}>
                            ⏰ Auto-Schedule
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
                                            background: payrollSettingsForm.autoRunEnabled ? '#f0fdf4' : '#f8f9fa',
                                            border: `1px solid ${payrollSettingsForm.autoRunEnabled ? '#bbf7d0' : '#dee2e6'}`,
                                            borderRadius: '0.375rem', padding: '0.4rem 0.875rem', fontSize: '0.875rem',
                                            fontWeight: 500, userSelect: 'none' }}>
                                <input type="checkbox"
                                    checked={!!payrollSettingsForm.autoRunEnabled}
                                    onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, autoRunEnabled: e.target.checked })} />
                                {payrollSettingsForm.autoRunEnabled ? '✅ Auto-run enabled' : 'Auto-run disabled'}
                            </label>
                            {!payrollSettingsForm.autoRunEnabled && (
                                <span style={{ color: '#6b7280', fontSize: '0.82em' }}>
                                    Timer runs daily at 07:00 UTC — generates a payroll run N days before pay day
                                </span>
                            )}
                        </div>

                        {payrollSettingsForm.autoRunEnabled && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem',
                                          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem',
                                          padding: '1rem' }}>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label>Days before pay day to auto-generate</label>
                                    <input type="number" min="0" max="28"
                                        value={payrollSettingsForm.autoRunDaysBefore ?? 7}
                                        onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, autoRunDaysBefore: parseInt(e.target.value) || 7 })} />
                                    <small style={{ color: '#166534' }}>
                                        Pay day: {payrollSettingsForm.payDayOfMonth ?? 25}th → auto-run on the{' '}
                                        <strong>{Math.max(1, (payrollSettingsForm.payDayOfMonth ?? 25) - (payrollSettingsForm.autoRunDaysBefore ?? 7))}th</strong>
                                    </small>
                                </div>
                                <div className="form-group" style={{ margin: 0 }}>
                                    <label>After generating, automatically…</label>
                                    <select value={payrollSettingsForm.autoPostImmediately ? 'post' : 'draft'}
                                        onChange={e => setPayrollSettingsForm({ ...payrollSettingsForm, autoPostImmediately: e.target.value === 'post' })}>
                                        <option value="draft">Create draft only — I'll review &amp; post manually</option>
                                        <option value="post">Post immediately — create ledger entries automatically</option>
                                    </select>
                                    {payrollSettingsForm.autoPostImmediately && (
                                        <small style={{ color: '#856404' }}>
                                            ⚠ Payslip emails are not sent during auto-post. Send manually from the runs table.
                                        </small>
                                    )}
                                </div>
                                {payrollSettingsForm.autoRunLastTriggered && (
                                    <div style={{ gridColumn: '1 / -1', fontSize: '0.8em', color: '#166534' }}>
                                        Last auto-triggered: <strong>{new Date(payrollSettingsForm.autoRunLastTriggered).toLocaleString('en-GB')}</strong>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="form-actions">
                        <button className="btn-primary" onClick={handlePayrollSave} disabled={payrollSaving}>
                            {payrollSaving ? 'Saving…' : '💾 Save Payroll Settings'}
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'payroll' && !payrollSettingsForm && (
                <div className="entity-form">
                    <p style={{ color: '#888' }}>Loading payroll settings…</p>
                </div>
            )}

            {activeTab === 'accountants' && (
                <div className="entity-form">
                    <h2>Accountant Access</h2>
                    <p style={{ color: '#666', marginBottom: '1.5rem' }}>
                        Invite external accountants to view your company's financial data through the <a href="https://icy-water-0e4886b03.4.azurestaticapps.net" target="_blank" rel="noopener noreferrer">Accountant Portal</a>.
                    </p>

                    <div style={{ background: '#f9fafb', padding: '1.25rem', borderRadius: '8px', border: '1px solid #e5e7eb', marginBottom: '2rem' }}>
                        <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Invite Accountant</h3>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Email *</label>
                                <input
                                    type="email"
                                    value={inviteForm.email}
                                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="accountant@firm.co.uk"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={inviteForm.name}
                                    onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="Jane Smith"
                                />
                            </div>
                            <div className="form-group">
                                <label>Firm</label>
                                <input
                                    type="text"
                                    value={inviteForm.firmName}
                                    onChange={e => setInviteForm(f => ({ ...f, firmName: e.target.value }))}
                                    placeholder="Smith & Co Accountants"
                                />
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn-primary"
                            disabled={inviting || !inviteForm.email}
                            onClick={handleInviteAccountant}
                            style={{ marginTop: '0.5rem' }}
                        >
                            {inviting ? 'Sending…' : '📨 Send Invitation'}
                        </button>

                        {lastInviteResult && lastInviteResult.inviteLink && (
                            <div style={{
                                marginTop: '1rem',
                                padding: '0.75rem 1rem',
                                borderRadius: '6px',
                                background: lastInviteResult.emailSent ? '#dcfce7' : '#fef3c7',
                                border: `1px solid ${lastInviteResult.emailSent ? '#bbf7d0' : '#fde68a'}`,
                                fontSize: '0.85rem'
                            }}>
                                <strong>{lastInviteResult.emailSent ? 'Email sent!' : 'Share this invite link manually:'}</strong>
                                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        readOnly
                                        value={lastInviteResult.inviteLink}
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff' }}
                                        onClick={e => e.target.select()}
                                    />
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        style={{ fontSize: '0.8rem', padding: '6px 12px', whiteSpace: 'nowrap' }}
                                        onClick={() => {
                                            navigator.clipboard.writeText(lastInviteResult.inviteLink);
                                            showToast('Invite link copied!');
                                        }}
                                    >
                                        📋 Copy
                                    </button>
                                </div>
                                {!lastInviteResult.emailSent && lastInviteResult.emailError && (
                                    <p style={{ marginTop: '0.5rem', color: '#92400e', fontSize: '0.8rem' }}>
                                        Email error: {lastInviteResult.emailError}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Linked Accountants</h3>
                    {accountantsLoading ? (
                        <p style={{ color: '#888' }}>Loading…</p>
                    ) : accountants.length === 0 ? (
                        <p style={{ color: '#888' }}>No accountants linked yet. Use the form above to send an invitation.</p>
                    ) : (
                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>Email</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>Name</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>Firm</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>Status</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>Access</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>Invited</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>Accepted</th>
                                    <th style={{ padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {accountants.map(a => (
                                    <tr key={a.id}>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>{a.email}</td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>{a.name || '—'}</td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>{a.firmName || '—'}</td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>
                                            <span style={{
                                                padding: '2px 8px',
                                                borderRadius: '12px',
                                                fontSize: '0.8rem',
                                                fontWeight: 500,
                                                background: a.status === 'Active' ? '#dcfce7' : a.status === 'Invited' ? '#fef9c3' : '#fee2e2',
                                                color: a.status === 'Active' ? '#166534' : a.status === 'Invited' ? '#854d0e' : '#991b1b'
                                            }}>
                                                {a.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.85rem', color: '#666' }}>
                                            {a.accessLevel || 'ReadOnly'}
                                        </td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.85rem', color: '#666' }}>
                                            {a.invitedAt ? new Date(a.invitedAt).toLocaleDateString('en-GB') : '—'}
                                        </td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0', fontSize: '0.85rem', color: '#666' }}>
                                            {a.acceptedAt ? new Date(a.acceptedAt).toLocaleDateString('en-GB') : '—'}
                                        </td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>
                                            {a.status !== 'Revoked' && (
                                                <button
                                                    type="button"
                                                    className="btn-danger"
                                                    style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                                                    onClick={() => handleRevokeAccountant(a.id)}
                                                >
                                                    Revoke
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};

export default Settings;
