import { msalInstance, loginRequest } from '../auth/authConfig';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://financehub-func-kemponline.azurewebsites.net/api';

// In-flight token promise cache — if multiple calls fire simultaneously, they all
// share the same acquireTokenSilent promise instead of each making their own request.
// Cache expires 60s before the token's actual expiry so it's always fresh.
let _tokenCache = null; // { promise, expiresAt }

export async function getAuthHeaders() {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length === 0) {
        window.dispatchEvent(new CustomEvent('finlytics:authRequired'));
        throw new Error('No authenticated user');
    }

    const request = { scopes: ['User.Read'], account: accounts[0] };

    // Return cached token if still valid (with 60s buffer)
    const now = Date.now();
    if (_tokenCache && _tokenCache.expiresAt > now) {
        return _tokenCache.headers;
    }

    // First attempt: silent acquisition (uses cache, auto-refreshes if near expiry)
    try {
        const response = await msalInstance.acquireTokenSilent(request);
        const expiresAt = response.expiresOn
            ? new Date(response.expiresOn).getTime() - 60_000
            : now + 3_300_000; // default 55 min
        _tokenCache = {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${response.accessToken}` },
            expiresAt
        };
        return _tokenCache.headers;
    } catch (silentError) {
        console.warn('Silent token acquisition failed, retrying with force refresh...', silentError.message);
    }

    // Second attempt: force a round-trip to the token endpoint using the stored refresh token
    try {
        const response = await msalInstance.acquireTokenSilent({ ...request, forceRefresh: true });
        const expiresAt = response.expiresOn
            ? new Date(response.expiresOn).getTime() - 60_000
            : now + 3_300_000;
        _tokenCache = {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${response.accessToken}` },
            expiresAt
        };
        return _tokenCache.headers;
    } catch (refreshError) {
        _tokenCache = null;
        console.error('Token refresh failed, session expired:', refreshError.message);
        window.dispatchEvent(new CustomEvent('finlytics:authRequired'));
        throw new Error('Session expired. Please sign in again.');
    }
}

// SharePoint authentication removed - all endpoints now use regular API authentication

export async function generateCode(name, type) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/GenerateCode`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, type })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to generate code');
    }
    return response.json();
}

export async function markInvoicePaid(invoiceId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/MarkInvoicePaid`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ invoiceId })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to mark invoice as paid');
    }
    return response.json();
}

export async function getCustomers() {
    const headers = await getAuthHeaders();
    console.log('Calling GetCustomers API...');
    const response = await fetch(`${API_BASE}/GetCustomers`, { headers });
    console.log('GetCustomers response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetCustomers failed:', error);
        throw new Error(error.error || 'Failed to fetch customers');
    }
    const data = await response.json();
    console.log('GetCustomers data received:', data);
    // API already returns camelCase due to JsonNamingPolicy.CamelCase in Program.cs
    return data;
}

export async function createCustomer(customer) {
    const headers = await getAuthHeaders();
    console.log('Calling CreateCustomer API with data:', customer);
    const response = await fetch(`${API_BASE}/CreateCustomer`, {
        method: 'POST',
        headers,
        body: JSON.stringify(customer)
    });
    console.log('CreateCustomer response status:', response.status);
    const result = await response.json();
    console.log('CreateCustomer response data:', result);
    // API now returns the customer object directly, not {success: true}
    if (result.error || result.success === false) {
        throw new Error(result.error || 'Failed to create customer');
    }
    return result;
}

export async function updateCustomer(id, customer) {
    const headers = await getAuthHeaders();
    console.log(`Calling UpdateCustomer API for ID ${id} with data:`, customer);
    const response = await fetch(`${API_BASE}/UpdateCustomer/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(customer)
    });
    console.log('UpdateCustomer response status:', response.status);
    const result = await response.json();
    console.log('UpdateCustomer response data:', result);
    // API returns {success: true/false} for updates
    if (!result.success) {
        throw new Error(result.error || 'Failed to update customer');
    }
    return result;
}

export async function deleteCustomer(id) {
    const headers = await getAuthHeaders();
    console.log(`Calling DeleteCustomer API for ID ${id}`);
    const response = await fetch(`${API_BASE}/DeleteCustomer/${id}`, {
        method: 'DELETE',
        headers
    });
    console.log('DeleteCustomer response status:', response.status);
    
    if (!response.ok) {
        throw new Error(`Failed to delete customer: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('DeleteCustomer response data:', result);
    if (!result.success) {
        throw new Error(result.error || 'Failed to delete customer');
    }
    return result;
}

export async function getSuppliers() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/GetSuppliers`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch suppliers');
    }
    const data = await response.json();
    // API already returns camelCase due to JsonNamingPolicy.CamelCase
    return data;
}

export async function createSupplier(supplier) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/CreateSupplier`, {
        method: 'POST',
        headers,
        body: JSON.stringify(supplier)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to create supplier');
    }
    const result = await response.json();
    // API now returns the supplier object directly, not {success: true}
    if (result.error || result.success === false) {
        throw new Error(result.error || 'Failed to create supplier');
    }
    return result;
}

export async function updateSupplier(id, supplier) {
    const headers = await getAuthHeaders();
    console.log(`Calling UpdateSupplier API for ID ${id} with data:`, supplier);
    const response = await fetch(`${API_BASE}/UpdateSupplier/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(supplier)
    });
    console.log('UpdateSupplier response status:', response.status);
    const result = await response.json();
    console.log('UpdateSupplier response data:', result);
    if (!result.success) {
        throw new Error(result.error || 'Failed to update supplier');
    }
    return result;
}

export async function deleteSupplier(id) {
    const headers = await getAuthHeaders();
    console.log(`Calling DeleteSupplier API for ID ${id}`);
    const response = await fetch(`${API_BASE}/DeleteSupplier/${id}`, {
        method: 'DELETE',
        headers
    });
    console.log('DeleteSupplier response status:', response.status);
    
    if (!response.ok) {
        throw new Error(`Failed to delete supplier: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('DeleteSupplier response data:', result);
    if (!result.success) {
        throw new Error(result.error || 'Failed to delete supplier');
    }
    return result;
}

export async function getExpenses({ companyOnly = false } = {}) {
    console.log('getExpenses: Fetching expenses from API...');
    const headers = await getAuthHeaders();
    const qs = companyOnly ? '?companyOnly=true' : '';
    const response = await fetch(`${API_BASE}/expenses${qs}`, { headers });
    console.log('getExpenses: Response status:', response.status);
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('getExpenses: Error response:', error);
        throw new Error(error.error || 'Failed to fetch expenses');
    }
    
    const data = await response.json();
    console.log('getExpenses: Raw data received:', data);
    if (data && !Array.isArray(data) && typeof data === 'object' && data.error) {
        console.error('getExpenses: API returned error payload:', data.error);
        return [];
    }
    
    // Convert PascalCase properties to camelCase for JavaScript
    const convertedData = Array.isArray(data) ? data.map(expense => {
        // Log the first expense's supplier field for debugging
        if (data.indexOf(expense) === 0) {
            console.log('getExpenses: First expense raw:', expense);
            console.log('getExpenses: First expense Supplier field:', expense.Supplier);
            console.log('getExpenses: First expense SupplierFreeText field:', expense.SupplierFreeText);
            console.log('getExpenses: All properties of first expense:', Object.keys(expense));
        }
        
        return {
            id: expense.id ?? expense.Id,
            expenseId: expense.expenseId || expense.ExpenseId,
            supplier: expense.supplier || expense.Supplier || expense.SupplierFreeText,
            supplierFreeText: expense.supplierFreeText || expense.SupplierFreeText,
            reference: expense.reference || expense.Reference,
            category: expense.category || expense.Category,
            vatApplicability: expense.vatApplicability || expense.VATApplicability,
            vatIncluded: expense.vatIncluded !== undefined ? expense.vatIncluded : expense.VATIncluded,
            vatRate: expense.vatRate || expense.VATRate,
            amountNet: expense.amountNet || expense.AmountNet,
            vatAmount: expense.vatAmount || expense.VATAmount,
            amountGross: expense.amountGross || expense.AmountGross,
            entryDate: expense.entryDate || expense.EntryDate,
            datePaid: expense.datePaid || expense.DatePaid,
            paymentMethod: expense.paymentMethod || expense.PaymentMethod,
            taxYear: expense.taxYear || expense.TaxYear,
            financialYear: expense.financialYear || expense.FinancialYear,
            isDLA: expense.isDLA !== undefined ? expense.isDLA : expense.IsDLA,
            receiptUrl: expense.receiptUrl || expense.ReceiptUrl,
            attachments: expense.attachments || expense.Attachments,
            ctTag: expense.ctTag || expense.CtTag,
            notes: expense.notes || expense.Notes,
            hasMissingReceiptDeclaration: expense.hasMissingReceiptDeclaration || expense.HasMissingReceiptDeclaration || false,
            missingReceiptDeclarationRef: expense.missingReceiptDeclarationRef || expense.MissingReceiptDeclarationRef || null,
            approvalStatus: expense.approvalStatus || expense.ApprovalStatus || null,
            submittedByTeamMemberId: expense.submittedByTeamMemberId ?? expense.SubmittedByTeamMemberId ?? null
        };
    }) : [];
    
    console.log('getExpenses: Converted data:', convertedData);
    if (convertedData.length > 0) {
        console.log('getExpenses: First converted expense supplier:', convertedData[0].supplier);
    }
    return convertedData;
}

export async function createExpense(expense) {
    console.log('createExpense called with data:', expense);
    const headers = await getAuthHeaders();
    console.log('Auth headers obtained, making API call...');
    
    const response = await fetch(`${API_BASE}/expenses`, {
        method: 'POST',
        headers,
        body: JSON.stringify(expense)
    });
    
    console.log('API response status:', response.status);
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('API error response:', error);
        throw new Error(error.error || 'Failed to create expense');
    }
    
    const rawBody = await response.text();
    let result;
    try {
        result = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        result = rawBody;
    }

    const normalizedId =
        (typeof result === 'number' ? result : undefined)
        ?? (typeof result === 'string' && /^\d+$/.test(result.trim()) ? Number(result.trim()) : undefined)
        ?? result?.id
        ?? result?.Id
        ?? result?.expenseId
        ?? result?.ExpenseId
        ?? result?.data?.id
        ?? result?.data?.Id
        ?? result?.data?.expenseId
        ?? result?.data?.ExpenseId
        ?? result?.result?.id
        ?? result?.result?.Id;

    const normalizedResult = typeof result === 'object' && result !== null
        ? { ...result, id: normalizedId }
        : { success: true, id: normalizedId, raw: result };
    console.log('API success response:', normalizedResult);
    return normalizedResult;
}

function ensureExpenseId(expenseId, operation) {
    if (expenseId === undefined || expenseId === null || `${expenseId}`.trim() === '') {
        throw new Error(`Cannot ${operation}: missing expense ID`);
    }
}

export async function updateExpense(id, expense) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(expense)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to update expense');
    }
    return response.json();
}

export async function deleteExpense(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to delete expense');
    }
    return response.json();
}

export async function getCategories() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/categories`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch categories');
    }
    return response.json();
}

export async function getVATApplicabilities() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/vatapplicabilities`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch VAT applicabilities');
    }
    return response.json();
}

export async function getPaymentMethods() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/paymentmethods`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch payment methods');
    }
    return response.json();
}

export async function uploadReceipt(expenseId, file) {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length === 0) {
        throw new Error('No authenticated user');
    }

    const request = {
        scopes: ['User.Read'],
        account: accounts[0]
    };

    const tokenResponse = await msalInstance.acquireTokenSilent(request);
    
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/expenses/${expenseId}/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenResponse.accessToken}`
            // NO Content-Type - browser sets it automatically with boundary for multipart/form-data
        },
        body: formData
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to upload receipt');
    }
    return response.json();
}

export async function deleteAttachment(expenseId, fileName) {
    const headers = await getAuthHeaders();
    const encodedFileName = encodeURIComponent(fileName);
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/attachments/${encodedFileName}`, {
        method: 'DELETE',
        headers
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to delete attachment');
    }
    return response.json();
}

export async function getExpenseAttachments(expenseId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/attachments`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch attachments');
    }
    return response.json();
}

export async function getCompanySettings() {
    const headers = await getAuthHeaders();
    console.log('Calling GetCompanySettings API...');
    const response = await fetch(`${API_BASE}/GetCompanySettings`, { headers });
    console.log('GetCompanySettings response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetCompanySettings failed:', error);
        throw new Error(error.error || 'Failed to fetch company settings');
    }
    const data = await response.json();
    console.log('GetCompanySettings raw data from API:', data);
    if (data && typeof data === 'object' && data.error) {
        console.error('GetCompanySettings returned error payload:', data.error);
        return null;
    }
    
    // API already returns camelCase due to JsonNamingPolicy.CamelCase in Program.cs - just return it!
    console.log('Returning company settings with companyName:', data?.companyName);
    return data ?? null;
}

export async function testSmtpConfiguration(email) {
    const headers = await getAuthHeaders();
    console.log('Testing SMTP configuration...');
    const body = email ? JSON.stringify({ email }) : null;
    const response = await fetch(`${API_BASE}/TestSmtpConfiguration`, { 
        method: 'POST',
        headers,
        body
    });
    console.log('TestSmtpConfiguration response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('TestSmtpConfiguration failed:', error);
        throw new Error(error.error || 'Failed to send test email');
    }
    return response.json();
}

export async function updateCompanySettings(settings) {
    console.log('updateCompanySettings called with:', settings);
    
    // Convert empty strings to null for numeric fields
    const converted = {
        CompanyName: settings.companyName,
        CompanyAddress: settings.companyAddress,
        CompanyPhone: settings.companyPhone,
        CompanyEmail: settings.companyEmail,
        Directors: settings.directors,
        InvoicesEmail: settings.invoicesEmail,
        QuotesEmail: settings.quotesEmail,
        PaymentsEmail: settings.paymentsEmail,
        CompanyRegistrationNumber: settings.companyRegistrationNumber,
        TaxRegistrationNumber: settings.taxRegistrationNumber,
        VatRegistrationNumber: settings.vatRegistrationNumber,
        BankName: settings.bankName,
        BankAccountNumber: settings.bankAccountNumber,
        BankSortCode: settings.bankSortCode,
        BankIBAN: settings.bankIBAN,
        BankSwiftCode: settings.bankSwiftCode,
        DefaultCurrency: settings.defaultCurrency,
        DefaultVATRate: settings.defaultVATRate,
        InvoicePrefix: settings.invoicePrefix,
        QuotePrefix: settings.quotePrefix,
        InvoiceTermsDays: settings.invoiceTermsDays,
        InvoiceFooterText: settings.invoiceFooterText,
        LogoUrl: settings.logoUrl,
        DocumentLogoUrl: settings.documentLogoUrl || null,
        EmailLogoUrl: settings.emailLogoUrl || null,
        CompanyInceptionDate: settings.companyInceptionDate ? new Date(settings.companyInceptionDate).toISOString() : null,
        FYStartMonth: settings.fyStartMonth ? parseInt(settings.fyStartMonth) : null,
        FYStartDay: settings.fyStartDay ? parseInt(settings.fyStartDay) : null,
        DirectorName: settings.directorName,
        DirectorSignature: settings.directorSignature,
        HasAuthorizedOfficer: settings.hasAuthorizedOfficer,
        AuthorizedOfficerName: settings.authorizedOfficerName,
        AuthorizedOfficerSignature: settings.authorizedOfficerSignature,
        Directors: settings.directors,
        SmtpServer: settings.smtpServer,
        SmtpPort: settings.smtpPort ? parseInt(settings.smtpPort, 10) : null,
        SmtpFromAddress: settings.smtpFromAddress,
        SmtpUsername: settings.smtpUsername,
        SmtpPassword: settings.smtpPassword,
        PsaApproved: settings.psaApproved ?? false,
        PsaContactName: settings.psaContactName || null,
        IncorporationDate: settings.incorporationDate ? new Date(settings.incorporationDate).toISOString() : null,
        VatQuarterStartMonth: settings.vatQuarterStartMonth ? parseInt(settings.vatQuarterStartMonth, 10) : null,
        Utr: settings.utr || null,
        AllowDataDeletion: settings.allowDataDeletion ?? false,
        AllowDividendDeletion: settings.allowDividendDeletion ?? false,
        HmrcGatewayUserId: settings.hmrcGatewayUserId || null,
        HmrcGatewayPassword: settings.hmrcGatewayPassword || null,
        VatAccountingMethod: settings.vatAccountingMethod || null
    };
    
    console.log('Sending to API:', converted);
    
    const headers = await getAuthHeaders();
    console.log('Calling UpdateCompanySettings API...');
    const response = await fetch(`${API_BASE}/UpdateCompanySettings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(converted)
    });
    console.log('UpdateCompanySettings response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('UpdateCompanySettings failed:', error);
        throw new Error(error.error || 'Failed to update company settings');
    }
    const data = await response.json();
    console.log('UpdateCompanySettings response data:', data);
    return data;
}

// Invoice API methods
export async function getInvoices() {
    const headers = await getAuthHeaders();
    console.log('Calling GetInvoices API...');
    const response = await fetch(`${API_BASE}/invoices`, { headers });
    console.log('GetInvoices response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetInvoices failed:', error);
        throw new Error(error.error || 'Failed to fetch invoices');
    }
    const data = await response.json();
    console.log('GetInvoices data received:', data);
    return data;
}

export async function getInvoice(id) {
    const headers = await getAuthHeaders();
    console.log('Calling GetInvoice API for ID:', id);
    const response = await fetch(`${API_BASE}/invoices/${id}`, { headers });
    console.log('GetInvoice response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetInvoice failed:', error);
        throw new Error(error.error || 'Failed to fetch invoice');
    }
    const data = await response.json();
    console.log('GetInvoice data received:', data);
    return data;
}

export async function createInvoice(invoice) {
    const headers = await getAuthHeaders();
    console.log('Calling CreateInvoice API with data:', invoice);
    const response = await fetch(`${API_BASE}/invoices`, {
        method: 'POST',
        headers,
        body: JSON.stringify(invoice)
    });
    console.log('CreateInvoice response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('CreateInvoice failed:', error);
        throw new Error(error.error || 'Failed to create invoice');
    }
    const data = await response.json();
    console.log('CreateInvoice response data:', data);
    return data;
}

export async function updateInvoice(id, invoice) {
    const headers = await getAuthHeaders();
    console.log('Calling UpdateInvoice API for ID:', id, 'with data:', invoice);
    const response = await fetch(`${API_BASE}/invoices/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(invoice)
    });
    console.log('UpdateInvoice response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('UpdateInvoice failed:', error);
        throw new Error(error.error || 'Failed to update invoice');
    }
    const data = await response.json();
    console.log('UpdateInvoice response data:', data);
    return data;
}

export async function deleteInvoice(id) {
    const headers = await getAuthHeaders();
    console.log('Calling DeleteInvoice API for ID:', id);
    const response = await fetch(`${API_BASE}/invoices/${id}`, {
        method: 'DELETE',
        headers
    });
    console.log('DeleteInvoice response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('DeleteInvoice failed:', error);
        throw new Error(error.error || 'Failed to delete invoice');
    }
    console.log('Invoice deleted successfully');
    return { success: true };
}

export async function getUnpaidInvoices() {
    const invoices = await getInvoices();
    return invoices.filter(inv => inv.status !== 'Paid');
}

export async function sendInvoiceReminder(invoiceId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/invoices/${invoiceId}/send-reminder`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
    if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        throw new Error(text || `Failed to send reminder (HTTP ${response.status})`);
    }
    return response.json();
}

export async function getNextInvoiceNumber() {
    const headers = await getAuthHeaders();
    console.log('Calling GetNextInvoiceNumber API...');
    const response = await fetch(`${API_BASE}/invoices/next-number`, { headers });
    console.log('GetNextInvoiceNumber response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetNextInvoiceNumber failed:', error);
        throw new Error(error.error || 'Failed to get next invoice number');
    }
    const data = await response.json();
    console.log('GetNextInvoiceNumber data received:', data);
    return data;
}

// Quote API methods
export async function getQuotes() {
    const headers = await getAuthHeaders();
    console.log('Calling GetQuotes API...');
    const response = await fetch(`${API_BASE}/quotes`, { headers });
    console.log('GetQuotes response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetQuotes failed:', error);
        throw new Error(error.error || 'Failed to fetch quotes');
    }
    const data = await response.json();
    console.log('GetQuotes data received:', data);
    return data;
}

export async function getQuote(id) {
    const headers = await getAuthHeaders();
    console.log('Calling GetQuote API for ID:', id);
    const response = await fetch(`${API_BASE}/quotes/${id}`, { headers });
    console.log('GetQuote response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetQuote failed:', error);
        throw new Error(error.error || 'Failed to fetch quote');
    }
    const data = await response.json();
    console.log('GetQuote data received:', data);
    return data;
}

export async function createQuote(quote) {
    const headers = await getAuthHeaders();
    console.log('Calling CreateQuote API with data:', quote);
    const response = await fetch(`${API_BASE}/quotes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(quote)
    });
    console.log('CreateQuote response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('CreateQuote failed:', error);
        throw new Error(error.error || 'Failed to create quote');
    }
    const data = await response.json();
    console.log('CreateQuote response data:', data);
    return data;
}

export async function updateQuote(id, quote) {
    const headers = await getAuthHeaders();
    console.log('Calling UpdateQuote API for ID:', id, 'with data:', quote);
    const response = await fetch(`${API_BASE}/quotes/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(quote)
    });
    console.log('UpdateQuote response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('UpdateQuote failed:', error);
        throw new Error(error.error || 'Failed to update quote');
    }
    const data = await response.json();
    console.log('UpdateQuote response data:', data);
    return data;
}

export async function deleteQuote(id) {
    const headers = await getAuthHeaders();
    console.log('Calling DeleteQuote API for ID:', id);
    const response = await fetch(`${API_BASE}/quotes/${id}`, {
        method: 'DELETE',
        headers
    });
    console.log('DeleteQuote response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('DeleteQuote failed:', error);
        throw new Error(error.error || 'Failed to delete quote');
    }
    console.log('Quote deleted successfully');
    return { success: true };
}

export async function getNextQuoteNumber() {
    const headers = await getAuthHeaders();
    console.log('Calling GetNextQuoteNumber API...');
    const response = await fetch(`${API_BASE}/quotes/next-number`, { headers });
    console.log('GetNextQuoteNumber response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetNextQuoteNumber failed:', error);
        throw new Error(error.error || 'Failed to get next quote number');
    }
    const data = await response.json();
    console.log('GetNextQuoteNumber data received:', data);
    return data;
}

// ============================================
// COMPANY LEDGER API METHODS
// ============================================

export async function getDlaEntries() {
    const headers = await getAuthHeaders();
    console.log('Calling GetDlaEntries API...');
    const response = await fetch(`${API_BASE}/dla`, { headers });
    console.log('GetDlaEntries response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetDlaEntries failed:', error);
        throw new Error(error.error || 'Failed to load DLA entries');
    }
    const data = await response.json();
    console.log('GetDlaEntries data received:', data);
    return data;
}

export async function getTrivialBenefitSummary(taxYear) {
    const headers = await getAuthHeaders();
    const qs = taxYear ? `?taxYear=${encodeURIComponent(taxYear)}` : '';
    const response = await fetch(`${API_BASE}/trivialbenefits/summary${qs}`, { headers });
    if (!response.ok) throw new Error('Failed to load trivial benefit summary');
    return response.json();
}

export async function getDlaPayments(dlaId) {
    const headers = await getAuthHeaders();
    console.log('Calling GetDlaPayments API for:', dlaId);
    const response = await fetch(`${API_BASE}/dla/${dlaId}/payments`, { headers });
    console.log('GetDlaPayments response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetDlaPayments failed:', error);
        throw new Error(error.error || 'Failed to load DLA payments');
    }
    const data = await response.json();
    console.log('GetDlaPayments data received:', data);
    return data;
}

export async function getAllDlaPayments() {
    const headers = await getAuthHeaders();
    console.log('Calling GetAllDlaPayments API...');
    const response = await fetch(`${API_BASE}/dla/payments`, { headers });
    console.log('GetAllDlaPayments response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetAllDlaPayments failed:', error);
        throw new Error(error.error || 'Failed to load DLA payments');
    }
    const data = await response.json();
    console.log('GetAllDlaPayments data received:', data);
    return data;
}

export async function getCompanyLedger(periodKey) {
    const headers = await getAuthHeaders();
    console.log('Calling GetCompanyLedger API for period:', periodKey);
    const response = await fetch(`${API_BASE}/companyledger/${periodKey}`, { headers });
    console.log('GetCompanyLedger response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetCompanyLedger failed:', error);
        throw new Error(error.error || 'Failed to load company ledger entries');
    }
    const data = await response.json();
    console.log('GetCompanyLedger data received:', data);
    return data;
}

export async function createCompanyLedgerEntry(entry) {
    const headers = await getAuthHeaders();
    console.log('Calling CreateCompanyLedgerEntry API with data:', entry);
    const response = await fetch(`${API_BASE}/companyledger`, {
        method: 'POST',
        headers,
        body: JSON.stringify(entry)
    });
    console.log('CreateCompanyLedgerEntry response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('CreateCompanyLedgerEntry failed:', error);
        throw new Error(error.error || 'Failed to create company ledger entry');
    }
    const data = await response.json();
    console.log('CreateCompanyLedgerEntry response data:', data);
    return data;
}

export async function deleteCompanyLedgerEntry(id) {
    const headers = await getAuthHeaders();
    console.log('Calling DeleteCompanyLedgerEntry API for ID:', id);
    const response = await fetch(`${API_BASE}/companyledger/${id}`, {
        method: 'DELETE',
        headers
    });
    console.log('DeleteCompanyLedgerEntry response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('DeleteCompanyLedgerEntry failed:', error);
        throw new Error(error.error || 'Failed to delete company ledger entry');
    }
    console.log('Company ledger entry deleted successfully');
    return { success: true };
}

export async function getYtdAggregates() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/ytd-aggregates`, { headers });
    if (!response.ok) throw new Error('Failed to load YTD aggregates');
    return response.json();
}

export async function getCompanyAggregates(periodKey) {
    const headers = await getAuthHeaders();
    console.log('Calling GetCompanyAggregates API for period:', periodKey);
    const response = await fetch(`${API_BASE}/companyledger/${periodKey}/aggregates`, { headers });
    console.log('GetCompanyAggregates response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetCompanyAggregates failed:', error);
        throw new Error(error.error || 'Failed to load company aggregates');
    }
    const data = await response.json();
    console.log('GetCompanyAggregates data received:', data);
    return data;
}

export async function getCompanyOverview(periodKey) {
    const headers = await getAuthHeaders();
    console.log('Calling GetCompanyOverview API for period:', periodKey);
    const response = await fetch(`${API_BASE}/companyledger/${periodKey}/overview`, { headers });
    console.log('GetCompanyOverview response status:', response.status);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('GetCompanyOverview failed:', error);
        throw new Error(error.error || 'Failed to load company overview');
    }
    const data = await response.json();
    console.log('GetCompanyOverview data received:', data);
    return data;
}

// Shareholders
export async function getShareholders() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/shareholders`, { headers });
    if (!response.ok) throw new Error('Failed to load shareholders');
    return response.json();
}

export async function getShareholderById(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/shareholders/${id}`, { headers });
    if (!response.ok) throw new Error('Failed to load shareholder');
    return response.json();
}

export async function createShareholder(shareholder) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/shareholders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(shareholder)
    });
    if (!response.ok) throw new Error('Failed to create shareholder');
    return response.json();
}

export async function updateShareholder(id, shareholder) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/shareholders/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(shareholder)
    });
    if (!response.ok) throw new Error('Failed to update shareholder');
    return response.json();
}

export async function deleteShareholder(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/shareholders/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to delete shareholder');
}

// Employees
export async function getEmployees() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/employees`, { headers });
    if (!response.ok) throw new Error('Failed to load employees');
    return response.json();
}

// ─── Team Management / Employee Expense Portal ───────────────
export async function inviteTeamMember(data) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/invite`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Failed to send invite' }));
        throw new Error(err.error || 'Failed to send invite');
    }
    return response.json();
}

export async function getTeamMembers() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/members`, { headers });
    if (!response.ok) throw new Error('Failed to load team members');
    return response.json();
}

export async function updateTeamMember(id, updates) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/members/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error('Failed to update team member');
    return response.json();
}

export async function deleteTeamMember(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/members/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to remove team member');
}

export async function getTeamApprovals() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/approvals`, { headers });
    if (!response.ok) throw new Error('Failed to load approvals');
    return response.json();
}

export async function getTeamApprovalHistory() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/approvals/history`, { headers });
    if (!response.ok) throw new Error('Failed to load approval history');
    return response.json();
}

export async function approveItem(type, id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/approvals/${type}/${id}/approve`, {
        method: 'POST',
        headers
    });
    if (!response.ok) throw new Error(`Failed to approve ${type}`);
    return response.json();
}

export async function rejectItem(type, id, reason) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/approvals/${type}/${id}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason })
    });
    if (!response.ok) throw new Error(`Failed to reject ${type}`);
    return response.json();
}

export async function batchApproveItems(expenseIds = [], mileageIds = []) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/team/approvals/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expenseIds, mileageIds })
    });
    if (!response.ok) throw new Error('Failed to batch approve');
    return response.json();
}

    export async function getNextEmployeeNumber() {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE}/employees/next-number`, { headers });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to get next employee number' }));
            throw new Error(error.error || 'Failed to get next employee number');
        }
        return response.json();
    }

export async function getEmployeeById(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/employees/${id}`, { headers });
    if (!response.ok) throw new Error('Failed to load employee');
    return response.json();
}

export async function createEmployee(employee) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/employees`, {
        method: 'POST',
        headers,
        body: JSON.stringify(employee)
    });
    if (!response.ok) throw new Error('Failed to create employee');
    return response.json();
}

export async function updateEmployee(id, employee) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/employees/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(employee)
    });
    if (!response.ok) throw new Error('Failed to update employee');
    return response.json();
}

export async function deleteEmployee(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/employees/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to delete employee');
}

// Share Classes
export async function getShareClasses() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/shareclasses`, { headers });
    if (!response.ok) throw new Error('Failed to load share classes');
    return response.json();
}

// Company Documents
export async function getCompanyDocuments() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/companydocuments`, { headers });
    if (!response.ok) throw new Error('Failed to load documents');
    return response.json();
}

export async function uploadDocument(file, metadata) {
    const headers = await getAuthHeaders();
    delete headers['Content-Type']; // Let browser set it for multipart/form-data
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', metadata.documentType);
    
    // Optional metadata fields
    if (metadata.personName) formData.append('personName', metadata.personName);
    if (metadata.personTitle) formData.append('personTitle', metadata.personTitle);
    if (metadata.isActive !== undefined) formData.append('isActive', metadata.isActive);
    if (metadata.relatedEntity) formData.append('relatedEntity', metadata.relatedEntity);
    if (metadata.documentDate) formData.append('documentDate', metadata.documentDate);
    if (metadata.expiryDate) formData.append('expiryDate', metadata.expiryDate);
    if (metadata.notes) formData.append('notes', metadata.notes);

    const response = await fetch(`${API_BASE}/companydocuments/upload`, {
        method: 'POST',
        headers,
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const safeText = typeof errorText === 'string' ? errorText : '';
        const message = safeText.trim() ? safeText : 'Failed to upload document';
        throw new Error(message);
    }
    return response.json();
}

function normalizeBlobName(blobNameOrUrl) {
    if (!blobNameOrUrl) return '';
    if (typeof blobNameOrUrl !== 'string') return '';
    if (!blobNameOrUrl.startsWith('http')) return blobNameOrUrl;

    try {
        const url = new URL(blobNameOrUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length <= 1) return '';
        return parts.slice(1).join('/');
    } catch {
        return '';
    }
}

export async function deleteDocument(blobNameOrUrl) {
    const blobName = normalizeBlobName(blobNameOrUrl);
    if (!blobName) {
        throw new Error('Missing blob name for delete');
    }
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/companydocuments?blobName=${encodeURIComponent(blobName)}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete document: ${errorText}`);
    }
    return true;
}

export async function downloadDocument(blobName) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/companydocuments/download?blobName=${encodeURIComponent(blobName)}`, {
        method: 'GET',
        headers
    });
    if (!response.ok) throw new Error('Failed to download document');
    return response.blob();
}

export async function downloadDocumentPdf(blobName) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/companydocuments/view-pdf?blobName=${encodeURIComponent(blobName)}`, {
        method: 'GET',
        headers
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const safeText = typeof errorText === 'string' ? errorText : '';
        const message = safeText.trim() ? safeText : 'Failed to render PDF';
        throw new Error(message);
    }
    return response.blob();
}

export async function sendShareholderCertificateEmail(shareholderId, email) {
    const headers = await getAuthHeaders();
    const payload = email ? { email } : {};
    const response = await fetch(`${API_BASE}/shareholders/${shareholderId}/certificate/email`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const safeText = typeof errorText === 'string' ? errorText : '';
        const message = safeText.trim() ? safeText : 'Failed to email share certificate';
        throw new Error(message);
    }
    return response.json();
}

export async function getShareCertificateHtml(shareholderId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/shareholders/${shareholderId}/certificate`, { headers });
    if (!response.ok) throw new Error('Failed to load share certificate');
    return response.text();
}

// Admin auth & security settings
function getAdminToken() {
    return localStorage.getItem('financehub_admin_token');
}

function setAdminToken(token) {
    if (token) {
        localStorage.setItem('financehub_admin_token', token);
    } else {
        localStorage.removeItem('financehub_admin_token');
    }
}

function getAdminHeaders() {
    const token = getAdminToken();
    if (!token) {
        throw new Error('Admin not authenticated');
    }
    return {
        'Content-Type': 'application/json',
        'X-Admin-Token': token
    };
}

export async function adminLogin(credentials) {
    const response = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = data.error || 'Admin login failed';
        const requiresMfaSetup = data.requiresMfaSetup === true;
        const err = new Error(error);
        err.requiresMfaSetup = requiresMfaSetup;
        throw err;
    }
    if (data.token) {
        setAdminToken(data.token);
    }
    return data;
}

export async function adminMfaSetup(payload) {
    const response = await fetch(`${API_BASE}/admin/mfa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'MFA setup failed' }));
        throw new Error(error.error || 'MFA setup failed');
    }
    return response.json();
}

export async function adminMfaVerify(code) {
    const headers = getAdminHeaders();
    const response = await fetch(`${API_BASE}/admin/mfa/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'MFA verification failed' }));
        throw new Error(error.error || 'MFA verification failed');
    }
    return response.json();
}

export async function adminChangePassword(payload) {
    const headers = getAdminHeaders();
    const response = await fetch(`${API_BASE}/admin/change-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Password change failed' }));
        throw new Error(error.error || 'Password change failed');
    }
    return response.json();
}

export async function getFinanceHubSettings() {
    const headers = getAdminHeaders();
    const response = await fetch(`${API_BASE}/settings/financehub`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to load security settings' }));
        throw new Error(error.error || 'Failed to load security settings');
    }
    return response.json();
}

export async function updateFinanceHubSettings(payload) {
    const headers = getAdminHeaders();
    const response = await fetch(`${API_BASE}/settings/financehub`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update security settings' }));
        throw new Error(error.error || 'Failed to update security settings');
    }
    return response.json();
}

// Banking
export async function getBankAccounts() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bank/accounts`, { headers });
    if (!response.ok) throw new Error('Failed to load bank accounts');
    return response.json();
}

export async function createBankAccount(account) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bank/accounts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(account)
    });
    if (!response.ok) throw new Error('Failed to create bank account');
    return response.json();
}

export async function updateBankAccount(id, account) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bank/accounts/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(account)
    });
    if (!response.ok) throw new Error('Failed to update bank account');
    return response.json();
}

export async function deleteBankAccount(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bank/accounts/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to delete bank account');
    return response.text();
}

export async function getBankTransactionsByAccount(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bank/accounts/${id}/transactions`, { headers });
    if (!response.ok) throw new Error('Failed to load bank transactions');
    return response.json();
}

export async function createBankTransaction(transaction) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bank/transactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(transaction)
    });
    if (!response.ok) throw new Error('Failed to create transaction');
    return response.json();
}

export async function importBankTransactions(transactions) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bank/transactions/import`, {
        method: 'POST',
        headers,
        body: JSON.stringify(transactions)
    });
    if (!response.ok) throw new Error('Failed to import transactions');
    return response.json();
}

// Reconciliation
export async function getUnreconciledTransactions() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/unreconciled`, { headers });
    if (!response.ok) throw new Error('Failed to load unreconciled transactions');
    return response.json();
}

export async function createReconciliationMatch(match) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/match`, {
        method: 'POST',
        headers,
        body: JSON.stringify(match)
    });
    if (!response.ok) throw new Error('Failed to reconcile transaction');
    return response.json();
}

export async function autoReconcileTransactions() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/auto-match`, {
        method: 'POST',
        headers
    });
    if (!response.ok) throw new Error('Failed to auto reconcile transactions');
    return response.json();
}

export async function previewAutoReconcileTransactions() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/auto-match/preview`, {
        method: 'POST',
        headers
    });
    if (!response.ok) throw new Error('Failed to preview auto reconciliation');
    return response.json();
}

export async function applyAutoReconcileTransactions(proposals) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/auto-match/apply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ proposals })
    });
    if (!response.ok) throw new Error('Failed to apply auto reconciliation');
    return response.json();
}

export async function getReconciliationRules() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/rules`, { headers });
    if (!response.ok) throw new Error('Failed to load rules');
    return response.json();
}

export async function createReconciliationRule(rule) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rule)
    });
    if (!response.ok) throw new Error('Failed to create rule');
    return response.json();
}

export async function updateReconciliationRule(id, rule) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/rules/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(rule)
    });
    if (!response.ok) throw new Error('Failed to update rule');
    return response.json();
}

export async function deleteReconciliationRule(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reconciliation/rules/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to delete rule');
    return response.text();
}

// Payroll
export async function getPayrollRuns() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs`, { headers });
    if (!response.ok) throw new Error('Failed to load payroll runs');
    return response.json();
}

export async function createPayrollRun(payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Failed to create payroll run');
    return response.json();
}

export async function updatePayrollRun(id, payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Failed to update payroll run');
    return response.json();
}

export async function deletePayrollRun(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to delete payroll run');
    return response.text();
}

export async function getPayslipsByRun(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${id}/payslips`, { headers });
    if (!response.ok) throw new Error('Failed to load payslips');
    return response.json();
}

export async function createPayslip(runId, payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${runId}/payslips`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Failed to create payslip');
    return response.json();
}

export async function updatePayslip(id, payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/payslips/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Failed to update payslip');
    return response.json();
}

export async function deletePayslip(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/payslips/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to delete payslip');
    return response.text();
}

export async function getPayrollSettings() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/settings`, { headers });
    if (!response.ok) throw new Error('Failed to load payroll settings');
    return response.json();
}

export async function updatePayrollSettings(payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/settings`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Failed to update payroll settings');
    return response.json();
}

export async function emailP11D(payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bik/email-p11d`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to send P11D email');
    }
    return response.json();
}

export async function downloadP11DPDF(recipientName, taxYear) {
    const headers = await getAuthHeaders();
    const response = await fetch(
        `${API_BASE}/bik/p11d-pdf?recipientName=${encodeURIComponent(recipientName)}&taxYear=${encodeURIComponent(taxYear)}`,
        { headers }
    );
    if (!response.ok) throw new Error('Failed to generate P11D PDF');
    return response.blob();
}

export async function generatePayrollRun(payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate payroll run');
    }
    return response.json();
}

export async function postPayrollRun(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${id}/post`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to post payroll run');
    }
    return response.json();
}

export async function submitFps(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${id}/fps`, {
        method: 'POST',
        headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message || data.error || 'FPS submission failed');
    }
    return data;
}

export async function submitEpsNoPayment(taxYear, fromTaxMonth, toTaxMonth) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/eps/no-payment`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear, fromTaxMonth, toTaxMonth })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'EPS submission failed');
    return data;
}

export async function submitEpsYearEnd(taxYear) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/eps/year-end`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'EPS year-end submission failed');
    return data;
}

export async function calculatePayslip(payload) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/calculate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Failed to calculate payslip');
    return response.json();
}

export async function getBacsRows(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${id}/bacs/rows`, { headers });
    if (!response.ok) throw new Error('Failed to load BACS data');
    return response.json();
}

export async function downloadBacsCsv(id, payDate) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/payroll/runs/${id}/bacs`, { headers });
    if (!response.ok) throw new Error('Failed to generate BACS export');
    const blob = await response.blob();
    const month = payDate ? payDate.substring(0, 7) : id;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BACS-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function getAssets() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/assets`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to load assets' }));
        throw new Error(error.error || 'Failed to load assets');
    }
    return response.json();
}

export async function getNextAssetId() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/assets/next-id`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to get next asset ID' }));
        throw new Error(error.error || 'Failed to get next asset ID');
    }
    return response.json();
}

export async function createAsset(asset) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/assets`, {
        method: 'POST',
        headers,
        body: JSON.stringify(asset)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create asset' }));
        throw new Error(error.error || 'Failed to create asset');
    }
    return response.json();
}

export async function updateAsset(id, asset) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/assets/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(asset)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update asset' }));
        throw new Error(error.error || 'Failed to update asset');
    }
    return response.json();
}

export async function deleteAsset(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/assets/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to delete asset' }));
        throw new Error(error.error || 'Failed to delete asset');
    }
    return response.text();
}

export async function uploadAssetInvoice(assetId, file) {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length === 0) throw new Error('No authenticated user');
    const tokenResponse = await msalInstance.acquireTokenSilent({ scopes: ['User.Read'], account: accounts[0] });
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/assets/${assetId}/invoice`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenResponse.accessToken}` },
        body: formData
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to upload invoice');
    }
    return response.json();
}

export async function getSubscriptions() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/subscriptions`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to load subscriptions' }));
        throw new Error(error.error || 'Failed to load subscriptions');
    }
    return response.json();
}

export async function getNextSubscriptionId() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/subscriptions/next-id`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to get next subscription ID' }));
        throw new Error(error.error || 'Failed to get next subscription ID');
    }
    return response.json();
}

export async function getExpiringSubscriptions(days) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/subscriptions/expiring/${days}`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to load expiring subscriptions' }));
        throw new Error(error.error || 'Failed to load expiring subscriptions');
    }
    return response.json();
}

export async function createSubscription(subscription) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/subscriptions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(subscription)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create subscription' }));
        throw new Error(error.error || 'Failed to create subscription');
    }
    return response.json();
}

export async function updateSubscription(id, subscription) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/subscriptions/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(subscription)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update subscription' }));
        throw new Error(error.error || 'Failed to update subscription');
    }
    return response.json();
}

export async function deleteSubscription(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/subscriptions/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to delete subscription' }));
        throw new Error(error.error || 'Failed to delete subscription');
    }
    return response.text();
}

// ── VAT Returns ──────────────────────────────────────────────────────────────

export async function getVatReturns() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/vat-returns`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch VAT returns');
    }
    return response.json();
}

export async function createVatReturn(vatReturn) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/vat-returns`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            QuarterLabel: vatReturn.quarterLabel,
            MonthsLabel: vatReturn.monthsLabel,
            QuarterStartDate: vatReturn.quarterStartDate,
            QuarterEndDate: vatReturn.quarterEndDate,
            VatIn: vatReturn.vatIn,
            VatOut: vatReturn.vatOut,
            VatOwed: vatReturn.vatOwed,
            FiledDate: vatReturn.filedDate || new Date().toISOString(),
            Reference: vatReturn.reference || null,
            Notes: vatReturn.notes || null,
            Status: 'Filed'
        })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to create VAT return');
    }
    return response.json();
}

export async function updateVatReturn(id, vatReturn) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/vat-returns/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
            QuarterLabel: vatReturn.quarterLabel,
            MonthsLabel: vatReturn.monthsLabel,
            QuarterStartDate: vatReturn.quarterStartDate,
            QuarterEndDate: vatReturn.quarterEndDate,
            VatIn: vatReturn.vatIn,
            VatOut: vatReturn.vatOut,
            VatOwed: vatReturn.vatOwed,
            FiledDate: vatReturn.filedDate,
            Reference: vatReturn.reference || null,
            Notes: vatReturn.notes || null,
            Status: 'Filed'
        })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to update VAT return');
    }
    return response.json();
}

export async function deleteVatReturn(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/vat-returns/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to delete VAT return');
    }
    return response.text();
}

export async function uploadVatConfirmationPdf(id, file) {
    const headers = await getAuthHeaders();
    // Send as raw binary with filename in header (avoids multipart complexity)
    headers['Content-Type'] = 'application/pdf';
    headers['X-File-Name'] = encodeURIComponent(file.name);
    const response = await fetch(`${API_BASE}/vat-returns/${id}/confirmation-pdf`, {
        method: 'POST',
        headers,
        body: file
    });
    if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        throw new Error(text || 'Failed to upload confirmation PDF');
    }
    return response.json();
}
// ── Invoice OCR ───────────────────────────────────────────────────────────────
// Returns: { configured, found, vendor, invoiceDate, invoiceRef, lines[] }
// Lines: { description, amountNet, vatAmount, amountGross }
export async function analyzeInvoice(file) {
    const headers = await getAuthHeaders();
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/analyze-invoice`, {
        method: 'POST',
        headers: { Authorization: headers.Authorization }, // no Content-Type — let browser set multipart boundary
        body: formData
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to analyse invoice');
    }
    return response.json();
}

// ── HMRC MTD ─────────────────────────────────────────────────────────────────

/** Returns { connected: true/false } */
export async function getHmrcStatus() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/hmrc/status`, { headers });
    return response.json();
}

/**
 * Returns { url } — the HMRC OAuth authorization URL.
 * swaUrl is the base URL of the SWA so HMRC can redirect back after auth.
 */
export async function getHmrcAuthUrl(swaUrl) {
    const headers = await getAuthHeaders();
    const response = await fetch(
        `${API_BASE}/hmrc/authorize?swaUrl=${encodeURIComponent(swaUrl)}`,
        { headers }
    );
    return response.json();
}

/** Removes stored HMRC tokens — disconnects from MTD */
export async function disconnectHmrc() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/hmrc/token`, { method: 'DELETE', headers });
    return response.json();
}

/** Fetches open VAT obligations from HMRC for your VRN */
export async function getHmrcVatObligations() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/hmrc/vat/obligations`, { headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to fetch VAT obligations');
    }
    return response.json();
}

/**
 * Submits a VAT return directly to HMRC MTD.
 * submission shape:
 *   periodKey, vatDueSales, vatDueAcquisitions, totalVatDue,
 *   vatReclaimedCurrPeriod, netVatDue,
 *   totalValueSalesExVAT, totalValuePurchasesExVAT,
 *   totalValueGoodsSuppliedExVAT, totalAcquisitionsExVAT, finalised
 */
export async function submitVatReturnToHmrc(submission) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/hmrc/vat/submit`, {
        method: 'POST',
        headers,
        body: JSON.stringify(submission)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to submit VAT return to HMRC');
    }
    return response.json();
}
/**
 * Retrieves a previously submitted VAT return from HMRC by period key.
 * Used to verify that a sandbox or production submission was received.
 */
export async function viewHmrcVatReturn(periodKey) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/hmrc/vat/return/${encodeURIComponent(periodKey)}`, { headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to retrieve VAT return from HMRC');
    }
    return response.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Mileage
// ─────────────────────────────────────────────────────────────────────────────

export async function getMileageTrips({ taxYear, director, status } = {}) {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (taxYear)  params.set('taxYear',  taxYear);
    if (director) params.set('director', director);
    if (status)   params.set('status',   status);
    const qs = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE}/mileage/trips${qs}`, { headers });
    if (!response.ok) throw new Error('Failed to load mileage trips');
    return response.json();
}

export async function createMileageTrip(trip) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/mileage/trips`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(trip)
    });
    if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(err || 'Failed to create mileage trip');
    }
    return response.json();
}

export async function updateMileageTrip(id, trip) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/mileage/trips/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(trip)
    });
    if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(err || 'Failed to update mileage trip');
    }
    return response.json();
}

export async function deleteMileageTrip(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/mileage/trips/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(err || 'Failed to delete mileage trip');
    }
}

export async function getMileageSummary({ taxYear, director } = {}) {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (taxYear)  params.set('taxYear',  taxYear);
    if (director) params.set('director', director);
    const qs = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE}/mileage/summary${qs}`, { headers });
    if (!response.ok) throw new Error('Failed to load mileage summary');
    return response.json();
}

export async function getMileageClaims({ director, taxYear } = {}) {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (director) params.set('director', director);
    if (taxYear)  params.set('taxYear',  taxYear);
    const qs = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE}/mileage/claims${qs}`, { headers });
    if (!response.ok) throw new Error('Failed to load mileage claims');
    return response.json();
}

export async function generateMileageClaim({ director, periodStart, periodEnd, notes, taxYear }) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/mileage/claims/generate`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ director, periodStart, periodEnd, notes, taxYear })
    });
    if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(err || 'Failed to generate mileage claim');
    }
    return response.json();
}

export async function submitMileageClaim(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/mileage/claims/${id}/submit`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(err || 'Failed to submit mileage claim');
    }
    return response.json();
}

export async function markMileageClaimPaid(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/mileage/claims/${id}/paid`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.text().catch(() => 'Unknown error');
        throw new Error(err || 'Failed to mark mileage claim as paid');
    }
    return response.json();
}

// ─── Dividends ───────────────────────────────────────────────────────────────

export async function getDividends() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dividends`, { headers });
    if (!response.ok) throw new Error('Failed to load dividends');
    return response.json();
}

export async function getDividendById(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dividends/${id}`, { headers });
    if (!response.ok) throw new Error('Failed to load dividend');
    return response.json();
}

export async function createDividend(dividend) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dividends`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(dividend)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create dividend');
    }
    return response.json();
}

export async function updateDividend(id, dividend) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dividends/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(dividend)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update dividend');
    }
    return response.json();
}

export async function deleteDividend(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dividends/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err.error || 'Failed to delete dividend');
        error.status = response.status;
        throw error;
    }
}

export async function finaliseDividend(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dividends/${id}/finalise`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to finalise dividend');
    }
    return response.json();
}

export function getDividendMinutesPdfUrl(id) {
    return `${API_BASE}/dividends/${id}/minutes-pdf`;
}

export function getDividendVoucherPdfUrl(id, allocationId) {
    return `${API_BASE}/dividends/${id}/voucher-pdf/${allocationId}`;
}

export async function emailDividendVoucher(id, allocationId, email) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dividends/${id}/email-voucher/${allocationId}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to email voucher');
    }
    return response.json();
}

// ── Missing Receipt Declarations ──────────────────────────────────────────────

export async function getMissingReceiptDeclaration(expenseId) {
    ensureExpenseId(expenseId, 'get declaration');
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/declaration`, { headers });
    if (response.status === 404) return null;
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to get declaration');
    }
    return response.json();
}

export async function createMissingReceiptDeclaration(expenseId, data) {
    ensureExpenseId(expenseId, 'create declaration');
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/declaration`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create declaration');
    }
    return response.json();
}

export async function finaliseMissingReceiptDeclaration(expenseId) {
    ensureExpenseId(expenseId, 'finalise declaration');
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/declaration/finalise`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}'
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to finalise declaration');
    }
    return response.json();
}

export async function voidMissingReceiptDeclaration(expenseId, reason) {
    ensureExpenseId(expenseId, 'void declaration');
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/declaration/void`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to void declaration');
    }
    return response.json();
}

export async function getExpenseAuditEvents(expenseId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/audit`, { headers });
    if (!response.ok) return [];
    return response.json();
}

export function getDeclarationPdfUrl(expenseId) {
    return `${API_BASE}/expenses/${expenseId}/declaration/pdf`;
}

// ── DLA Missing Receipt Declaration ──────────────────────────────────────

export async function getDlaDeclaration(dlaId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dla/${dlaId}/declaration`, { headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to get DLA declaration');
    return response.json();
}

export async function createDlaDeclaration(dlaId, data) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dla/${dlaId}/declaration`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create DLA declaration');
    }
    return response.json();
}

export async function finaliseDlaDeclaration(dlaId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dla/${dlaId}/declaration/finalise`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to finalise DLA declaration');
    }
    return response.json();
}

export async function voidDlaDeclaration(dlaId, reason) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dla/${dlaId}/declaration/void`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to void DLA declaration');
    }
    return response.json();
}

// ── Accountant Management ──────────────────────────────────────────────────

export async function inviteAccountant({ email, name, firmName }) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/accountant/invite`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, firmName })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to invite accountant');
    }
    return response.json();
}

export async function getLinkedAccountants() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/accountant/linked`, { headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch linked accountants');
    }
    return response.json();
}

export async function revokeAccountant(linkId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/accountant/${linkId}/revoke`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to revoke accountant access');
    }
    return response.json();
}

export function getDlaDeclarationPdfUrl(dlaId) {
    return `${API_BASE}/dla/${dlaId}/declaration/pdf`;
}

export async function patchExpenseNoReceiptReason(expenseId, reason) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/expenses/${expenseId}/no-receipt-reason`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save no-receipt reason');
    }
    return response.json();
}

export async function patchDlaNoReceiptReason(dlaId, reason) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/dla/${dlaId}/no-receipt-reason`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save no-receipt reason');
    }
    return response.json();
}

// ─── Credit Notes ────────────────────────────────────────────────────────────

// ─── Recurring Invoice Templates ─────────────────────────────────────────────

export async function getRecurringInvoiceTemplates() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/recurring-invoices`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch recurring invoice templates');
    }
    return response.json();
}

export async function getRecurringInvoiceTemplate(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/recurring-invoices/${id}`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch recurring invoice template');
    }
    return response.json();
}

export async function createRecurringInvoiceTemplate(template) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/recurring-invoices`, {
        method: 'POST',
        headers,
        body: JSON.stringify(template)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to create recurring invoice template');
    }
    return response.json();
}

export async function updateRecurringInvoiceTemplate(id, template) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/recurring-invoices/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(template)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to update recurring invoice template');
    }
    return response.json();
}

export async function deleteRecurringInvoiceTemplate(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/recurring-invoices/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to delete recurring invoice template');
    }
    return { success: true };
}

// ─── Categorization Rules ────────────────────────────────────────────────────

export async function getCategorizationRules() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/categorization-rules`, { headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch categorization rules');
    }
    return response.json();
}

export async function createCategorizationRule(rule) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/categorization-rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rule)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to create categorization rule');
    }
    return response.json();
}

export async function updateCategorizationRule(id, rule) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/categorization-rules/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(rule)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to update categorization rule');
    }
    return response.json();
}

export async function deleteCategorizationRule(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/categorization-rules/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to delete categorization rule');
    }
    return { success: true };
}

// ─── GoCardless ──────────────────────────────────────────────────────────────

export async function getGoCardlessInstitutions(country = 'GB') {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/institutions?country=${country}`, { headers });
    if (!response.ok) throw new Error('Failed to load institutions');
    return response.json();
}

export async function connectBankGoCardless(institutionId, bankAccountId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/connect-bank`, {
        method: 'POST', headers,
        body: JSON.stringify({ institutionId, bankAccountId })
    });
    if (!response.ok) throw new Error('Failed to initiate bank connection');
    return response.json();
}

export async function syncGoCardlessTransactions(bankAccountId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/sync`, {
        method: 'POST', headers,
        body: JSON.stringify({ bankAccountId })
    });
    if (!response.ok) throw new Error('Failed to sync transactions');
    return response.json();
}

export async function getGoCardlessBankStatus(bankAccountId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/bank-status?bankAccountId=${bankAccountId}`, { headers });
    if (!response.ok) throw new Error('Failed to get bank status');
    return response.json();
}

export async function createGoCardlessMandate(customerId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/mandates/create`, {
        method: 'POST', headers,
        body: JSON.stringify({ customerId })
    });
    if (!response.ok) throw new Error('Failed to create mandate');
    return response.json();
}

export async function getGoCardlessMandates() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/mandates`, { headers });
    if (!response.ok) throw new Error('Failed to load mandates');
    return response.json();
}

export async function getGoCardlessMandateStatus(customerId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/mandates/${customerId}/status`, { headers });
    if (!response.ok) throw new Error('Failed to get mandate status');
    return response.json();
}

export async function collectGoCardlessPayment(invoiceId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/payments/collect`, {
        method: 'POST', headers,
        body: JSON.stringify({ invoiceId })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to collect payment');
    }
    return response.json();
}

export async function createGoCardlessPaymentLink(invoiceId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/payments/create-link`, {
        method: 'POST', headers,
        body: JSON.stringify({ invoiceId })
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to create payment link');
    }
    return response.json();
}

export async function getGoCardlessPayments() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/gocardless/payments`, { headers });
    if (!response.ok) throw new Error('Failed to load payments');
    return response.json();
}

export async function applyCategorizationRules() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/categorization-rules/apply`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to apply categorization rules');
    }
    return response.json();
}

export async function getCreditNotes() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/creditnotes`, { headers });
    if (!response.ok) throw new Error('Failed to fetch credit notes');
    return response.json();
}

export async function getCreditNote(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/creditnotes/${id}`, { headers });
    if (!response.ok) throw new Error('Failed to fetch credit note');
    return response.json();
}

export async function getCreditNotesByCustomer(customerId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/customers/${customerId}/creditnotes`, { headers });
    if (!response.ok) throw new Error('Failed to fetch credit notes for customer');
    return response.json();
}

export async function createCreditNote(data) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/creditnotes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create credit note');
    }
    return response.json();
}

export async function sendCreditNoteEmail(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/creditnotes/${id}/send`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to send credit note email');
    }
    return response.json();
}

export async function applyCreditNote(id, invoiceId) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/creditnotes/${id}/apply`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoiceId ?? null })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to apply credit note');
    }
    return response.json();
}

export async function voidCreditNote(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/creditnotes/${id}/void`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to void credit note');
    }
    return response.json();
}

export async function deleteCreditNote(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/creditnotes/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete credit note');
    }
}

export function getCreditNotePdfUrl(id) {
    return `${API_BASE}/creditnotes/${id}/pdf`;
}

// ── Monzo ─────────────────────────────────────────────────────────────────────
export async function getMonzoStatus() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/monzo/status`, { headers });
    if (!response.ok) throw new Error('Failed to get Monzo status');
    return response.json();
}

export async function getMonzoAuthUrl() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/monzo/auth`, { headers });
    if (!response.ok) throw new Error('Failed to get Monzo auth URL');
    return response.json(); // { authUrl }
}

export async function getMonzoBalance() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/monzo/balance`, { headers });
    if (!response.ok) throw new Error('Failed to get Monzo balance');
    return response.json();
}

// ═══════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════

export async function getProfitAndLoss(financialYear) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reports/profit-and-loss/${financialYear}`, { headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch Profit & Loss report');
    }
    return response.json();
}

export async function getBalanceSheet(financialYear) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reports/balance-sheet/${financialYear}`, { headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch Balance Sheet');
    }
    return response.json();
}

export async function getAgedDebtors() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/reports/aged-debtors`, { headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch Aged Debtors report');
    }
    return response.json();
}

export async function getAuditTrail(params = {}) {
    const headers = await getAuthHeaders();
    const query = new URLSearchParams();
    if (params.entityType) query.append('entityType', params.entityType);
    if (params.action) query.append('action', params.action);
    if (params.from) query.append('from', params.from);
    if (params.to) query.append('to', params.to);
    if (params.limit) query.append('limit', params.limit);
    const qs = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`${API_BASE}/reports/audit-trail${qs}`, { headers });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch Audit Trail');
    }
    return response.json();
}

export async function syncMonzoTransactions(since = null) {
    const headers = await getAuthHeaders();
    const body = since ? JSON.stringify({ since }) : null;
    const response = await fetch(`${API_BASE}/monzo/sync`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Monzo sync failed');
    }
    return response.json();
}

// ── TrueLayer ─────────────────────────────────────────────────────────────────
export async function getTrueLayerStatus() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/truelayer/status`, { headers });
    if (!response.ok) throw new Error('Failed to get TrueLayer status');
    return response.json();
}

export async function getTrueLayerAuthUrl() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/truelayer/auth`, { headers });
    if (!response.ok) throw new Error('Failed to get TrueLayer auth URL');
    return response.json(); // { authUrl }
}

export async function syncTrueLayerTransactions() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/truelayer/sync`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'TrueLayer sync failed');
    }
    return response.json();
}

export async function disconnectTrueLayer() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/truelayer/disconnect`, {
        method: 'POST',
        headers
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to disconnect TrueLayer');
    }
    return response.json();
}

// ── BILLS / ACCOUNTS PAYABLE ─────────────────────────────────────────────────

export async function getBills() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills`, { headers });
    if (!response.ok) throw new Error('Failed to fetch bills');
    return response.json();
}

export async function getBill(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills/${id}`, { headers });
    if (!response.ok) throw new Error('Failed to fetch bill');
    return response.json();
}

export async function createBill(bill) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(bill)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create bill');
    }
    return response.json();
}

export async function updateBill(id, bill) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(bill)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update bill');
    }
    return response.json();
}

export async function deleteBill(id) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills/${id}`, {
        method: 'DELETE',
        headers
    });
    if (!response.ok) throw new Error('Failed to delete bill');
}

export async function approveBill(id, approvedBy) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills/${id}/approve`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy })
    });
    if (!response.ok) throw new Error('Failed to approve bill');
    return response.json();
}

export async function payBill(id, paymentDetails) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills/${id}/pay`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentDetails)
    });
    if (!response.ok) throw new Error('Failed to record payment');
    return response.json();
}

export async function getNextBillNumber() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills/next-number`, { headers });
    if (!response.ok) throw new Error('Failed to get next bill number');
    return response.json();
}

export async function getBillsSummary() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/bills/summary`, { headers });
    if (!response.ok) throw new Error('Failed to fetch bills summary');
    return response.json();
}

// ── Invoice Email & Quick Invoice ──

export async function sendInvoiceEmail(id, email) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/invoices/${id}/email`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(email ? { email } : {})
    });
    if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        throw new Error(text || `Failed to send invoice email (HTTP ${response.status})`);
    }
    return response.json();
}

export async function getLineItemDescriptions() {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/lineitem-descriptions`, { headers });
    if (!response.ok) return [];
    return response.json();
}

export async function quickInvoice({ customerId, days, description, rate, vatRate, sendEmail }) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/invoices/quick`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, days, description, rate, vatRate, sendEmail })
    });
    if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        throw new Error(text || `Quick invoice failed (HTTP ${response.status})`);
    }
    return response.json();
}
