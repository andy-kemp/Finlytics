import React, { useEffect, useState } from 'react';
import {
    getPayrollRuns, updatePayrollRun, deletePayrollRun,
    getPayslipsByRun,
    getPayrollSettings,
    generatePayrollRun, postPayrollRun, submitFps,
    submitEpsNoPayment, submitEpsYearEnd,
    downloadBacsCsv, getBacsRows
} from '../services/apiService';

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// HMRC tax month 1=April…12=March — convert to calendar month name
const taxMonthName = (tm) => MONTHS[(tm + 2) % 12];

const fmt  = (v) => (v != null ? `£${parseFloat(v).toFixed(2)}` : '£0.00');
const fmtD = (d) => (d ? d.substring(0, 10) : '—');

// Calculate tax month purely in JS for the preview panel
function jsGetTaxMonth(payDay, month, year) {
    const day = payDay || 25;
    let m = month;
    if (day < 6) m--;
    if (m <= 0) m += 12;
    return ((m - 4 + 12) % 12) + 1;
}
function jsGetTaxYear(payDay, month, year) {
    const day = payDay || 25;
    const start = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
    return `${start}-${String(start + 1).slice(-2)}`;
}

export default function Payroll() {
    const [runs, setRuns]               = useState([]);
    const [selectedRun, setSelectedRun] = useState(null);
    const [payslips, setPayslips]       = useState([]);
    const [settings, setSettings]       = useState(null);
    const [loading, setLoading]         = useState(true);
    const [processing, setProcessing]   = useState(false);
    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const [showPostModal, setShowPostModal] = useState(false);
    const [postModalRun, setPostModalRun]   = useState(null);
    const [postResult, setPostResult]       = useState(null); // null = confirm screen, object = success screen
    const [showFpsModal, setShowFpsModal]   = useState(false);
    const [fpsModalRun, setFpsModalRun]     = useState(null);
    const [showBacsModal, setShowBacsModal] = useState(false);
    const [bacsModalRun, setBacsModalRun]   = useState(null);
    const [bacsRows, setBacsRows]           = useState([]);
    const [showEpsModal, setShowEpsModal]   = useState(false);
    const [epsModalType, setEpsModalType]   = useState(null); // 'no-payment' | 'year-end'
    const [epsForm, setEpsForm]             = useState({ taxYear: '', fromTaxMonth: 1, toTaxMonth: 1 });
    const [generateForm, setGenerateForm] = useState({
        month: new Date().getMonth() + 1,
        year:  new Date().getFullYear()
    });
    const [generateError, setGenerateError] = useState('');

    useEffect(() => {
        Promise.all([loadRuns(), loadSettings()]).finally(() => setLoading(false));
    }, []);

    async function loadRuns() {
        try { setRuns(await getPayrollRuns()); }
        catch (err) { console.error('Error loading runs:', err); }
    }

    async function loadSettings() {
        try {
            const data = await getPayrollSettings();
            setSettings(data);
        } catch (err) { console.error('Error loading settings:', err); }
    }

    async function loadPayslips(runId) {
        try { setPayslips(await getPayslipsByRun(runId)); }
        catch (err) { console.error('Error loading payslips:', err); }
    }

    const handleSelectRun = async (run) => {
        if (selectedRun?.id === run.id) {
            setSelectedRun(null);
            setPayslips([]);
            return;
        }
        setSelectedRun(run);
        await loadPayslips(run.id);
    };

    const handleGenerate = async (e) => {
        e.preventDefault();
        setProcessing(true);
        setGenerateError('');
        try {
            const result = await generatePayrollRun(generateForm);
            await loadRuns();
            setShowGenerateModal(false);
            setSelectedRun(result.run);
            setPayslips(result.payslips ?? []);
        } catch (err) {
            setGenerateError(err.message || 'Failed to generate');
        } finally { setProcessing(false); }
    };

    const handlePost = (run) => {
        setPostModalRun(run);
        setPostResult(null);
        setShowPostModal(true);
    };

    const handleConfirmPost = async () => {
        setProcessing(true);
        try {
            const result = await postPayrollRun(postModalRun.id);
            await loadRuns();
            setSelectedRun(result.run ?? postModalRun);
            const emailCount  = result.emailResults?.filter(r => r.success)?.length ?? 0;
            const emailFailed = result.emailResults?.filter(r => !r.success)?.length ?? 0;
            const ledgerCount = result.ledgerEntries?.length ?? 0;
            setPostResult({ emailCount, emailFailed, ledgerCount, emailResults: result.emailResults ?? [] });
        } catch (err) {
            setPostResult({ error: err.message });
        } finally { setProcessing(false); }
    };

    const handleDelete = async (run) => {
        if (run.status === 'Posted') {
            if (!window.confirm(
                `⚠️ VOID POSTED PAYROLL RUN\n\n` +
                `This will permanently delete payroll run #${run.id} (${taxMonthName(run.taxMonth)} ${run.taxYear}) ` +
                `and REVERSE all company ledger entries created when it was posted (salary, NI, PAYE).\n\n` +
                `Only do this if this was a test run or was posted in error.\n\nContinue?`
            )) return;
        } else {
            if (!window.confirm('Delete this draft payroll run?')) return;
        }
        setProcessing(true);
        try {
            await deletePayrollRun(run.id);
            if (selectedRun?.id === run.id) { setSelectedRun(null); setPayslips([]); }
            await loadRuns();
        } catch (err) { alert('Failed to delete: ' + err.message); }
        finally { setProcessing(false); }
    };

    const handleSubmitFps = (run) => {
        setFpsModalRun(run);
        setShowFpsModal(true);
    };

    const handleDownloadBacs = async (run) => {
        try {
            setProcessing(true);
            const data = await getBacsRows(run.id);
            setBacsRows(data.rows ?? []);
            setBacsModalRun(run);
            setShowBacsModal(true);
        } catch (err) {
            alert(`❌ BACS export failed:\n\n${err.message}`);
        } finally {
            setProcessing(false);
        }
    };

    const handleBacsCsvDownload = async () => {
        try {
            await downloadBacsCsv(bacsModalRun.id, bacsModalRun.payDate);
        } catch (err) {
            alert(`❌ Download failed:\n\n${err.message}`);
        }
    };

    const handleConfirmFps = async () => {
        setShowFpsModal(false);
        setProcessing(true);
        try {
            const result = await submitFps(fpsModalRun.id);
            await loadRuns();
            if (result.success) {
                alert(`✅ FPS submitted to HMRC!\n\n${result.message ?? ''}\n\nCorrelation ID: ${result.correlationId ?? 'N/A'}`);                
            } else {
                alert(`❌ FPS submission failed:\n\n${result.message ?? 'Unknown error'}`);
            }
        } catch (err) {
            alert(`❌ FPS error:\n\n${err.message}`);
        } finally { setProcessing(false); }
    };

    const handleOpenEpsNoPayment = () => {
        // Default to current tax year and month
        const now = new Date();
        const calMonth = now.getMonth() + 1;
        const taxYearStart = calMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;
        const taxYear = `${taxYearStart}-${String(taxYearStart + 1).slice(-2)}`;
        const taxMonth = ((calMonth - 4 + 12) % 12) + 1;
        setEpsForm({ taxYear, fromTaxMonth: taxMonth, toTaxMonth: taxMonth });
        setEpsModalType('no-payment');
        setShowEpsModal(true);
    };

    const handleOpenEpsYearEnd = () => {
        const now = new Date();
        const calMonth = now.getMonth() + 1;
        const taxYearStart = calMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;
        setEpsForm({ taxYear: `${taxYearStart}-${String(taxYearStart + 1).slice(-2)}`, fromTaxMonth: 1, toTaxMonth: 1 });
        setEpsModalType('year-end');
        setShowEpsModal(true);
    };

    const handleConfirmEps = async () => {
        setShowEpsModal(false);
        setProcessing(true);
        try {
            let result;
            if (epsModalType === 'no-payment') {
                result = await submitEpsNoPayment(epsForm.taxYear, epsForm.fromTaxMonth, epsForm.toTaxMonth);
            } else {
                result = await submitEpsYearEnd(epsForm.taxYear);
            }
            if (result.success) {
                alert(`✅ EPS submitted to HMRC!\n\n${result.message ?? ''}\n\nCorrelation ID: ${result.correlationId ?? 'N/A'}`);
            } else {
                alert(`❌ EPS submission failed:\n\n${result.message ?? 'Unknown error'}`);
            }
        } catch (err) {
            alert(`❌ EPS error:\n\n${err.message}`);
        } finally { setProcessing(false); }
    };

    // PAYE liability — most recent posted run not yet marked paid
    const latestPostedRun = [...runs].sort((a, b) => (b.taxMonth ?? 0) - (a.taxMonth ?? 0))
                                     .find(r => r.status === 'Posted');
    const payeOwed = parseFloat(latestPostedRun?.totalEmployerNi ?? 0);
    const payeDue  = latestPostedRun ? (() => {
        const d = new Date(latestPostedRun.payDate);
        d.setMonth(d.getMonth() + 1); d.setDate(22);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    })() : null;

    const payDay = settings?.payDayOfMonth ?? 25;
    const previewTaxMonth = jsGetTaxMonth(payDay, generateForm.month, generateForm.year);
    const previewTaxYear  = jsGetTaxYear(payDay, generateForm.month, generateForm.year);

    if (loading) return <div className="loading">Loading Payroll…</div>;

    return (
        <div className="content-container">

            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="section-header">
                <h2>Payroll</h2>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn-secondary" onClick={handleOpenEpsNoPayment} disabled={processing}
                        title="Notify HMRC no employees were paid in a period">
                        📋 No Payment EPS
                    </button>
                    <button className="btn-secondary" onClick={handleOpenEpsYearEnd} disabled={processing}
                        title="Submit year-end final EPS after last payroll of the tax year">
                        🏁 Year-End EPS
                    </button>
                    <button className="btn-primary"
                        onClick={() => { setShowGenerateModal(true); setGenerateError(''); }}>
                        ▶ Run Payroll
                    </button>
                </div>
            </div>

            {/* ── PAYE Liability Banner ───────────────────────────────── */}
            {payeOwed > 0 && (
                <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '0.5rem',
                              padding: '0.875rem 1.125rem', marginBottom: '1rem', display: 'flex',
                              justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <strong>⚠ HMRC PAYE Liability</strong>
                        <span style={{ marginLeft: '1rem' }}>
                            Employer NI due: <strong style={{ fontSize: '1.05em' }}>{fmt(payeOwed)}</strong>
                            {payeDue && <> — pay HMRC by <strong>{payeDue}</strong></>}
                        </span>
                    </div>
                    <div style={{ fontSize: '0.8em', color: '#856404' }}>
                        AOR: {settings?.accountsOfficeReference ?? <em>not set</em>}
                    </div>
                </div>
            )}

            {/* ── 2025-26 Rates Info ──────────────────────────────────── */}
            <div style={{ background: '#e8f4fd', border: '1px solid #bee3f8', borderRadius: '0.5rem',
                          padding: '0.6rem 1rem', marginBottom: '1.25rem', fontSize: '0.82em', color: '#31708f' }}>
                <strong>2025-26 Rates:</strong>&nbsp;
                Employer NI 15% above £416.67/mo (£5,000/yr secondary threshold) ·
                Employee NI 8% above £1,047.50/mo ·
                1257L tax code → £0 tax on salary ≤ £12,570/yr ·
                Pay HMRC by 22nd of following month (electronic)
            </div>

            {/* ── Payroll Runs Table ──────────────────────────────────── */}
            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Tax Year</th>
                            <th>Month</th>
                            <th>Pay Date</th>
                            <th>Gross</th>
                            <th>Tax</th>
                            <th>Employee NI</th>
                            <th style={{ color: '#856404' }}>Employer NI ⚠</th>
                            <th>Net Pay</th>
                            <th>Status</th>
                            <th>FPS</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {runs.length === 0 && (
                            <tr>
                                <td colSpan="11" style={{ textAlign: 'center', color: '#888', padding: '2rem' }}>
                                    No payroll runs yet — click <strong>▶ Run Payroll</strong> to generate your first run.
                                </td>
                            </tr>
                        )}
                        {runs.map(run => (
                            <tr key={run.id}
                                onClick={() => handleSelectRun(run)}
                                style={{ cursor: 'pointer',
                                         background: selectedRun?.id === run.id ? '#f0f7ff' : undefined }}>
                                <td>{run.taxYear ?? '—'}</td>
                                <td>{run.taxMonth ? taxMonthName(run.taxMonth) : fmtD(run.payDate)}</td>
                                <td>{fmtD(run.payDate)}</td>
                                <td>{fmt(run.totalGross)}</td>
                                <td>{fmt(run.totalTax)}</td>
                                <td>{fmt(run.totalEmployeeNi)}</td>
                                <td style={{ fontWeight: 600, color: '#856404' }}>{fmt(run.totalEmployerNi)}</td>
                                <td>{fmt(run.totalNetPay)}</td>
                                <td>
                                    <span className={`badge ${run.status === 'Posted' ? 'badge-success' : 'badge-warning'}`}>
                                        {run.status}
                                    </span>
                                </td>
                                <td>
                                    <span className={`badge ${run.fpsStatus === 'Submitted' ? 'badge-success' : 'badge-info'}`}>
                                        {run.fpsStatus ?? 'Pending'}
                                    </span>
                                </td>
                                <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                                    {run.status === 'Draft' && (
                                        <>
                                            <button className="btn-primary btn-sm"
                                                style={{ marginRight: '0.25rem' }}
                                                onClick={() => handlePost(run)}
                                                disabled={processing}>Post</button>
                                            <button className="btn-danger btn-sm"
                                                onClick={() => handleDelete(run)}
                                                disabled={processing}>Delete</button>
                                        </>
                                    )}
                                    {run.status === 'Posted' && (
                                        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'nowrap', alignItems: 'center' }}>
                                            <button className="btn-secondary btn-sm"
                                                onClick={() => handleSubmitFps(run)}
                                                disabled={processing}
                                                title={run.fpsStatus === 'Submitted' ? 'Re-submit FPS to HMRC (live — real Government Gateway credentials required)' : 'Submit FPS to HMRC (live — real Government Gateway credentials required)'}>
                                                📤 {run.fpsStatus === 'Submitted' ? 'Re-submit FPS' : 'Submit FPS'}
                                            </button>
                                            <button className="btn-secondary btn-sm"
                                                onClick={() => handleDownloadBacs(run)}
                                                disabled={processing}
                                                title="Download BACS payment file — upload to your bank for bulk payroll payments">
                                                💳 BACS
                                            </button>
                                            <button className="btn-danger btn-sm"
                                                onClick={() => handleDelete(run)}
                                                disabled={processing}
                                                title="Void this run — reverses all ledger entries">
                                                🗑 Void
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── Payslip Detail ──────────────────────────────────────── */}
            {selectedRun && (
                <div style={{ marginTop: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ margin: 0 }}>
                            Payslip — {selectedRun.taxYear} · {selectedRun.taxMonth ? taxMonthName(selectedRun.taxMonth) : ''}
                            &nbsp;<span style={{ fontSize: '0.8em', color: '#666', fontWeight: 400 }}>
                                Pay Date: {fmtD(selectedRun.payDate)}
                            </span>
                        </h3>
                        <button className="btn-secondary btn-sm"
                            onClick={() => { setSelectedRun(null); setPayslips([]); }}
                            style={{ whiteSpace: 'nowrap' }}>✕ Close</button>
                    </div>

                    {payslips.length === 0 && (
                        <p style={{ color: '#888' }}>No payslips found for this run.</p>
                    )}

                    {payslips.map(slip => (
                        <div key={slip.id} className="form-card" style={{ marginBottom: '1.25rem' }}>

                            {/* ── Header row ── */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '2px solid #0f2a4a' }}>
                                <div>
                                    <h4 style={{ margin: 0, fontSize: '1.05rem' }}>{slip.employeeName ?? `Employee #${slip.employeeId}`}</h4>
                                    <div style={{ color: '#6b7280', fontSize: '0.8em', marginTop: '0.2rem' }}>
                                        NI: <strong>{slip.niNumber ?? '—'}</strong>
                                        &nbsp;&middot;&nbsp;Tax Code: <strong>{slip.taxCode ?? '—'}</strong>
                                        &nbsp;&middot;&nbsp;NI Cat: <strong>{slip.niCategory ?? 'A'}</strong>
                                        {slip.directorsNiMethod === 'AP' && <>&nbsp;&middot;&nbsp;<span style={{ color: '#0066cc' }}>Director (per-period NI)</span></>}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '0.8em', color: '#888' }}>
                                    <div>Tax Year {slip.taxYear} &middot; Month {slip.taxMonth}</div>
                                    <div style={{ fontSize: '0.95em', color: '#0f2a4a', fontWeight: 600 }}>Pay Date: {fmtD(selectedRun?.payDate)}</div>
                                </div>
                            </div>

                            {/* ── Earnings / Deductions two columns ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.875rem' }}>
                                {/* Earnings */}
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f2a4a', borderBottom: '2px solid #0f2a4a', paddingBottom: '4px', marginBottom: '0.4rem' }}>Earnings</div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                                        <tbody>
                                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                                                <td style={{ padding: '5px 4px' }}>Basic Pay</td>
                                                <td style={{ padding: '5px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(slip.grossPay)}</td>
                                            </tr>
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ borderTop: '2px solid #d1d5db', background: '#f8f9fa' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 700 }}>Total Earnings</td>
                                                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700 }}>{fmt(slip.grossPay)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* Deductions */}
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f2a4a', borderBottom: '2px solid #0f2a4a', paddingBottom: '4px', marginBottom: '0.4rem' }}>Deductions</div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                                        <tbody>
                                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                                                <td style={{ padding: '5px 4px' }}>Income Tax (Code {slip.taxCode ?? '1257L'})</td>
                                                <td style={{ padding: '5px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(slip.tax)}</td>
                                            </tr>
                                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                                                <td style={{ padding: '5px 4px' }}>National Insurance (Cat {slip.niCategory ?? 'A'})</td>
                                                <td style={{ padding: '5px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(slip.nationalInsurance)}</td>
                                            </tr>
                                            {(slip.pension > 0) && (
                                                <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                                                    <td style={{ padding: '5px 4px' }}>Pension</td>
                                                    <td style={{ padding: '5px 4px', textAlign: 'right' }}>{fmt(slip.pension)}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ borderTop: '2px solid #d1d5db', background: '#f8f9fa' }}>
                                                <td style={{ padding: '6px 4px', fontWeight: 700 }}>Total Deductions</td>
                                                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700 }}>
                                                    {fmt((slip.tax ?? 0) + (slip.nationalInsurance ?? 0) + (slip.pension ?? 0))}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            {/* ── Net Pay + Payment Method ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.875rem' }}>
                                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', padding: '0.75rem 1rem' }}>
                                    <div style={{ fontSize: '0.75em', color: '#6b7280', marginBottom: '0.2rem' }}>Net Pay (Amount Paid)</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#166534' }}>{fmt(slip.netPay)}</div>
                                </div>
                                <div style={{ background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: '0.375rem', padding: '0.75rem 1rem' }}>
                                    <div style={{ fontSize: '0.75em', color: '#6b7280', marginBottom: '0.2rem' }}>Payment Method</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#374151' }}>BACS</div>
                                    <div style={{ fontSize: '0.78em', color: '#6b7280', marginTop: '4px' }}>Annual Salary: <strong>£{((slip.grossPay ?? 0) * 12).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong></div>
                                </div>
                            </div>

                            {/* ── YTD Running Totals ── */}
                            <div style={{ marginBottom: '0.875rem' }}>
                                <div style={{ fontWeight: 700, fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f2a4a', borderBottom: '2px solid #0f2a4a', paddingBottom: '4px', marginBottom: '0.4rem' }}>Tax Year to Date — Running Totals</div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' }}>
                                    <thead>
                                        <tr style={{ background: '#f3f4f6' }}>
                                            <th style={{ padding: '5px 6px', textAlign: 'left', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>YTD Gross Pay</th>
                                            <th style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>YTD Income Tax</th>
                                            <th style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>YTD Employee NI</th>
                                            <th style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>YTD Employer NI</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td style={{ padding: '6px 6px', fontWeight: 600 }}>{fmt(slip.ytdGross)}</td>
                                            <td style={{ padding: '6px 6px', textAlign: 'right' }}>{fmt(slip.ytdTax)}</td>
                                            <td style={{ padding: '6px 6px', textAlign: 'right' }}>{fmt(slip.ytdEmployeeNi)}</td>
                                            <td style={{ padding: '6px 6px', textAlign: 'right' }}>{fmt(slip.ytdEmployerNi)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* ── Employer Contributions ── */}
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#92400e', borderBottom: '2px solid #fbbf24', paddingBottom: '4px', marginBottom: '0.4rem' }}>Employer's Contributions (Company Cost — Not Deducted From Employee)</div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' }}>
                                    <thead>
                                        <tr style={{ background: '#fef3c7' }}>
                                            <th style={{ padding: '5px 6px', textAlign: 'left', fontWeight: 600, color: '#92400e', borderBottom: '1px solid #fde68a' }}>Description</th>
                                            <th style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, color: '#92400e', borderBottom: '1px solid #fde68a' }}>This Period</th>
                                            <th style={{ padding: '5px 6px', textAlign: 'left', fontWeight: 600, color: '#92400e', borderBottom: '1px solid #fde68a' }}>Due</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr style={{ borderBottom: '1px solid #fef3c7' }}>
                                            <td style={{ padding: '5px 6px', color: '#78350f' }}>Employer National Insurance (Cat {slip.niCategory ?? 'A'})</td>
                                            <td style={{ padding: '5px 6px', textAlign: 'right', color: '#78350f', fontWeight: 600 }}>{fmt(slip.employerNi)}</td>
                                            <td style={{ padding: '5px 6px', color: '#a07000', fontSize: '0.9em' }}>HMRC by 22nd of following month</td>
                                        </tr>
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: '#fef3c7', borderTop: '2px solid #fbbf24' }}>
                                            <td style={{ padding: '6px 6px', fontWeight: 700, color: '#92400e' }}>Total Employer Cost This Period</td>
                                            <td style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 700, color: '#92400e' }}>{fmt((slip.grossPay ?? 0) + (slip.employerNi ?? 0))}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                                <div style={{ fontSize: '0.78em', color: '#888', marginTop: '0.4rem' }}>
                                    Pay HMRC ref: <strong>{settings?.accountsOfficeReference ?? 'AOR not set'}</strong> &middot; Sort code 08-32-10 &middot; Account 12001039
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── BACS Payment Modal ─────────────────────────────────────── */}
            {showBacsModal && bacsModalRun && (
                <div className="modal-overlay" onClick={() => setShowBacsModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}
                         style={{ maxWidth: '780px', width: '95vw' }}>
                        <div className="modal-header">
                            <h3>💳 BACS Payment File — {taxMonthName(bacsModalRun.taxMonth)} {bacsModalRun.taxYear}</h3>
                            <button className="btn-close" onClick={() => setShowBacsModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ margin: '0 0 0.75rem', color: '#555', fontSize: '0.9em' }}>
                                Review the payments below, then download the CSV to upload to your bank's bulk payment portal.
                            </p>

                            {/* Missing bank details warning */}
                            {bacsRows.filter(r => !r.isHmrc && !r.hasBankDetails).length > 0 && (
                                <div style={{ background: '#fff8e1', border: '1px solid #fbbf24', borderRadius: '0.375rem', padding: '0.6rem 0.875rem', marginBottom: '0.75rem', fontSize: '0.875em', color: '#856404' }}>
                                    ⚠ <strong>{bacsRows.filter(r => !r.isHmrc && !r.hasBankDetails).length} employee(s)</strong> have no bank details — their rows are included but will need to be completed before submitting.
                                </div>
                            )}

                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em', marginBottom: '1rem' }}>
                                <thead>
                                    <tr style={{ background: '#0f2a4a', color: '#fff' }}>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Name</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Sort Code</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Account Number</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>Amount</th>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Reference</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bacsRows.filter(r => !r.isHmrc).map((row, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', background: !row.hasBankDetails ? '#fff8e1' : undefined }}>
                                            <td style={{ padding: '7px 10px', fontWeight: 600 }}>{row.name}</td>
                                            <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>
                                                {row.sortCode || <span style={{ color: '#e57373' }}>missing</span>}
                                            </td>
                                            <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>
                                                {row.accountNumber || <span style={{ color: '#e57373' }}>missing</span>}
                                            </td>
                                            <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#166534' }}>£{parseFloat(row.amount).toFixed(2)}</td>
                                            <td style={{ padding: '7px 10px', color: '#6b7280' }}>{row.reference}</td>
                                        </tr>
                                    ))}
                                    {/* HMRC row */}
                                    {bacsRows.filter(r => r.isHmrc).map((row, i) => (
                                        <tr key={`hmrc-${i}`} style={{ borderBottom: '1px solid #fde68a', background: '#fef3c7' }}>
                                            <td style={{ padding: '7px 10px', fontWeight: 700, color: '#92400e' }}>🏛 {row.name}</td>
                                            <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#78350f' }}>{row.sortCode}</td>
                                            <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#78350f' }}>{row.accountNumber}</td>
                                            <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#92400e' }}>£{parseFloat(row.amount).toFixed(2)}</td>
                                            <td style={{ padding: '7px 10px', color: '#a07000', fontSize: '0.9em' }}>{row.reference}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ background: '#f3f4f6', fontWeight: 700, borderTop: '2px solid #d1d5db' }}>
                                        <td colSpan={3} style={{ padding: '8px 10px' }}>Total</td>
                                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                            £{bacsRows.reduce((s, r) => s + parseFloat(r.amount ?? 0), 0).toFixed(2)}
                                        </td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>

                            <div style={{ fontSize: '0.8em', color: '#888', marginBottom: '1rem' }}>
                                🏛 HMRC row: sort code <strong>08-32-10</strong>, account <strong>12001039</strong> — PAYE + Employee NI + Employer NI combined. Pay by <strong>22nd of the following month</strong>.
                            </div>
                        </div>
                        <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" onClick={() => setShowBacsModal(false)}>Close</button>
                            <button className="btn-primary" onClick={handleBacsCsvDownload}>⬇ Download CSV</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── EPS Modal ──────────────────────────────────────────────── */}
            {showEpsModal && (
                <div className="modal-overlay" onClick={() => setShowEpsModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}
                         style={{ maxWidth: '460px' }}>
                        <div className="modal-header">
                            <h3>{epsModalType === 'year-end' ? '🏁 Year-End EPS' : '📋 No Payment EPS'}</h3>
                            <button className="btn-close" onClick={() => setShowEpsModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {epsModalType === 'year-end' ? (
                                <>
                                    <p style={{ marginTop: 0 }}>
                                        Submit the <strong>final EPS</strong> for the tax year after your last FPS.
                                        Must be sent by <strong>19 April</strong>.
                                    </p>
                                    <div className="form-group" style={{ marginTop: '1rem' }}>
                                        <label>Tax Year</label>
                                        <select value={epsForm.taxYear}
                                            onChange={e => setEpsForm({ ...epsForm, taxYear: e.target.value })}>
                                            {['2024-25','2025-26','2026-27'].map(y =>
                                                <option key={y} value={y}>{y}</option>)}
                                        </select>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p style={{ marginTop: 0 }}>
                                        Notify HMRC that <strong>no employees were paid</strong> in this period.
                                    </p>
                                    <div className="form-grid" style={{ marginTop: '1rem' }}>
                                        <div className="form-group">
                                            <label>Tax Year</label>
                                            <select value={epsForm.taxYear}
                                                onChange={e => setEpsForm({ ...epsForm, taxYear: e.target.value })}>
                                                {['2024-25','2025-26','2026-27'].map(y =>
                                                    <option key={y} value={y}>{y}</option>)}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>From Tax Month</label>
                                            <select value={epsForm.fromTaxMonth}
                                                onChange={e => setEpsForm({ ...epsForm, fromTaxMonth: parseInt(e.target.value) })}>
                                                {Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1} — {taxMonthName(i+1)}</option>)}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>To Tax Month</label>
                                            <select value={epsForm.toTaxMonth}
                                                onChange={e => setEpsForm({ ...epsForm, toTaxMonth: parseInt(e.target.value) })}>
                                                {Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1} — {taxMonthName(i+1)}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="modal-preview-box" style={{ marginTop: '1rem', borderColor: '#17a2b8', background: '#e8f7fa', color: '#0c5460' }}>
                                <div>ℹ️ This sends to the <strong>live HMRC transaction engine</strong></div>
                                <div style={{ marginTop: '0.3rem', fontSize: '0.85em' }}>Requires real Government Gateway credentials in Azure App Settings</div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={() => setShowEpsModal(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleConfirmEps} disabled={processing}>
                                {epsModalType === 'year-end' ? '🏁 Submit Year-End EPS' : '📋 Submit No Payment EPS'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Post Payroll Modal ─────────────────────────────────── */}
            {showPostModal && postModalRun && (
                <div className="modal-overlay" onClick={() => { if (!processing) { setShowPostModal(false); setPostResult(null); } }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>

                        {/* ── Confirm screen ── */}
                        {!postResult && (
                            <>
                                <div className="modal-header">
                                    <h3>📤 Post Payroll Run</h3>
                                    <button className="btn-close" onClick={() => setShowPostModal(false)}>✕</button>
                                </div>
                                <div className="modal-body">
                                    <p style={{ marginTop: 0, fontSize: '1.05em' }}>
                                        Post payroll for{' '}
                                        <strong>{taxMonthName(postModalRun.taxMonth)} {postModalRun.taxYear}</strong>?
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                                            <span style={{ fontSize: '1.1em' }}>📊</span>
                                            <div>
                                                <strong>Ledger entries</strong>
                                                <div style={{ color: '#555', fontSize: '0.875em' }}>Creates Salary, Employee NI and Employer NI entries in the company ledger, plus a PAYE liability entry</div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                                            <span style={{ fontSize: '1.1em' }}>📧</span>
                                            <div>
                                                <strong>Payslip emails</strong>
                                                <div style={{ color: '#555', fontSize: '0.875em' }}>Sends a payslip PDF to each employee and a payroll summary to you</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="modal-preview-box" style={{ borderColor: '#ffc107', background: '#fff8e1', color: '#856404' }}>
                                        <strong>⚠ This cannot be undone</strong> — use <em>Void</em> afterwards only if this was a test or error
                                    </div>
                                    <div style={{ marginTop: '1rem', background: '#f8f9fa', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.875em', color: '#374151' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Gross pay</span><strong>{fmt(postModalRun.totalGross)}</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Employee NI</span><strong>{fmt(postModalRun.totalEmployeeNi)}</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#856404' }}><span>Employer NI (your cost)</span><strong>{fmt(postModalRun.totalEmployerNi)}</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Income tax (PAYE)</span><strong>{fmt(postModalRun.totalTax)}</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e5e7eb', marginTop: '0.4rem', paddingTop: '0.4rem', fontWeight: 700 }}><span>Net pay to employees</span><strong>{fmt(postModalRun.totalNetPay)}</strong></div>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button className="btn-secondary" onClick={() => setShowPostModal(false)}>Cancel</button>
                                    <button className="btn-primary" onClick={handleConfirmPost} disabled={processing}>
                                        {processing ? '⏳ Posting…' : '📤 Post Payroll'}
                                    </button>
                                </div>
                            </>
                        )}

                        {/* ── Result screen ── */}
                        {postResult && (
                            <>
                                <div className="modal-header">
                                    <h3>{postResult.error ? '❌ Post Failed' : '✅ Payroll Posted'}</h3>
                                    <button className="btn-close" onClick={() => { setShowPostModal(false); setPostResult(null); }}>✕</button>
                                </div>
                                <div className="modal-body">
                                    {postResult.error ? (
                                        <div style={{ color: '#dc3545', background: '#fff5f5', borderRadius: '0.375rem', padding: '0.75rem 1rem' }}>
                                            {postResult.error}
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.625rem 0.875rem', background: '#f0fdf4', borderRadius: '0.375rem', border: '1px solid #bbf7d0' }}>
                                                    <span style={{ fontSize: '1.3em' }}>📊</span>
                                                    <div><strong>{postResult.ledgerCount}</strong> ledger entr{postResult.ledgerCount === 1 ? 'y' : 'ies'} created</div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.625rem 0.875rem', background: postResult.emailFailed > 0 ? '#fff8e1' : '#f0fdf4', borderRadius: '0.375rem', border: `1px solid ${postResult.emailFailed > 0 ? '#ffc107' : '#bbf7d0'}` }}>
                                                    <span style={{ fontSize: '1.3em' }}>📧</span>
                                                    <div>
                                                        <strong>{postResult.emailCount}</strong> payslip email{postResult.emailCount === 1 ? '' : 's'} sent
                                                        {postResult.emailFailed > 0 && <span style={{ color: '#856404', marginLeft: '0.5rem' }}>({postResult.emailFailed} failed)</span>}
                                                    </div>
                                                </div>
                                                {postResult.emailFailed > 0 && (
                                                    <div style={{ fontSize: '0.8em', color: '#555', paddingLeft: '0.25rem' }}>
                                                        {postResult.emailResults.filter(r => !r.success).map((r, i) => (
                                                            <div key={i}>⚠ {r.employee} ({r.email}) — {r.error}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div className="modal-footer">
                                    <button className="btn-primary" onClick={() => { setShowPostModal(false); setPostResult(null); }}>Done</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── FPS Confirm Modal ───────────────────────────────────── */}
            {showFpsModal && fpsModalRun && (
                <div className="modal-overlay" onClick={() => setShowFpsModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}
                         style={{ maxWidth: '460px' }}>
                        <div className="modal-header">
                            <h3>📤 Submit FPS to HMRC</h3>
                            <button className="btn-close" onClick={() => setShowFpsModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginTop: 0 }}>
                                Submit Full Payment Submission for{' '}
                                <strong>{taxMonthName(fpsModalRun.taxMonth)} {fpsModalRun.taxYear}</strong>?
                            </p>
                            <div className="modal-preview-box" style={{ borderColor: '#dc3545', background: '#fff5f5', color: '#721c24' }}>
                                <div>🚨 <strong>Live production submission</strong> — HMRC decommissioned their RTI sandbox</div>
                                <div style={{ marginTop: '0.4rem', fontSize: '0.85em' }}>
                                    This submits a <strong>real FPS</strong> to HMRC. Requires real Government Gateway credentials
                                    (<code>HmrcGatewayUserId</code> + <code>HmrcGatewayPassword</code>) in Azure App Settings.
                                    Without them, the submission will fail harmlessly before reaching HMRC.
                                </div>
                            </div>
                            {fpsModalRun.fpsStatus === 'Submitted' && (
                                <p style={{ marginTop: '0.75rem', marginBottom: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                                    ℹ️ This run has already been submitted — this will be a re-submission.
                                </p>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn-secondary" onClick={() => setShowFpsModal(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleConfirmFps} disabled={processing}>
                                📤 {fpsModalRun.fpsStatus === 'Submitted' ? 'Re-submit FPS' : 'Submit FPS'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Generate Modal ──────────────────────────────────────── */}
            {showGenerateModal && (
                <div className="modal-overlay" onClick={() => setShowGenerateModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}
                         style={{ maxWidth: '420px' }}>
                        <div className="modal-header">
                            <h3>Generate Payroll Run</h3>
                            <button className="btn-close" onClick={() => setShowGenerateModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleGenerate}>
                            <div className="modal-body">
                                <p style={{ color: '#555', marginTop: 0, marginBottom: '1rem' }}>
                                    Calculates payroll for all <strong>active employees</strong> based on their annual salary.
                                    Pay date will be the <strong>{payDay}th</strong>.
                                </p>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Month</label>
                                        <select value={generateForm.month}
                                            onChange={e => setGenerateForm({ ...generateForm, month: parseInt(e.target.value) })}>
                                            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Year</label>
                                        <select value={generateForm.year}
                                            onChange={e => setGenerateForm({ ...generateForm, year: parseInt(e.target.value) })}>
                                            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                                        </select>
                                    </div>
                                </div>
                                {/* Preview */}
                                <div className="modal-preview-box">
                                    <div>Pay Date: <strong>{generateForm.year}-{String(generateForm.month).padStart(2,'0')}-{String(payDay).padStart(2,'0')}</strong></div>
                                    <div>HMRC Tax Month: <strong>{previewTaxMonth}</strong></div>
                                    <div>Tax Year: <strong>{previewTaxYear}</strong></div>
                                </div>
                                {generateError && (
                                    <div style={{ color: '#dc3545', marginTop: '0.75rem', fontSize: '0.9em',
                                                  background: '#fff5f5', borderRadius: '0.25rem', padding: '0.5rem 0.75rem' }}>
                                        ⚠ {generateError}
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button className="btn-secondary" type="button"
                                    onClick={() => setShowGenerateModal(false)}>Cancel</button>
                                <button className="btn-primary" type="submit" disabled={processing}>
                                    {processing ? 'Generating…' : '▶ Generate'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
