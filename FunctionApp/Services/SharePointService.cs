using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Services
{
    public class SharePointService
    {
        private readonly string _siteUrl;
        private readonly string _tenantId;
        private readonly string _clientId;
        private readonly string _certThumbprint;
        private readonly ILogger _logger;
        private static readonly HttpClient _httpClient = new HttpClient();

        public SharePointService(IConfiguration configuration, ILogger<SharePointService> logger)
        {
            _siteUrl = configuration["SharePoint:SiteUrl"] ?? configuration["SharePointSiteUrl"] ?? "https://kempy.sharepoint.com/sites/AKFinancehubV2";
            _tenantId = configuration["TenantId"] ?? "";
            _clientId = configuration["ClientId"] ?? "";
            _certThumbprint = configuration["CertificateThumbprint"] ?? "";
            _logger = logger;
        }
        
        public async Task<string> GetAppOnlyToken()
        {
            // Get app-only token using Managed Identity - much simpler and more secure!
            // Extract SharePoint domain from site URL
            var uri = new Uri(_siteUrl);
            var sharePointDomain = $"{uri.Scheme}://{uri.Host}";
            
            Console.WriteLine($"GetAppOnlyToken: Using Managed Identity to get token for {sharePointDomain}");
            
            try
            {
                // ManagedIdentityCredential automatically works in Azure Functions
                var credential = new ManagedIdentityCredential();
                var token = await credential.GetTokenAsync(new Azure.Core.TokenRequestContext(new[] { $"{sharePointDomain}/.default" }));
                
                Console.WriteLine($"GetAppOnlyToken: Managed Identity token acquired successfully");
                return token.Token;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"GetAppOnlyToken: Managed Identity failed: {ex.Message}");
                
                // Fallback to certificate authentication if Managed Identity fails
                if (string.IsNullOrEmpty(_tenantId) || string.IsNullOrEmpty(_clientId) || string.IsNullOrEmpty(_certThumbprint))
                {
                    throw new Exception($"Both Managed Identity and Certificate authentication failed. MI Error: {ex.Message}");
                }
                
                Console.WriteLine($"GetAppOnlyToken: Trying certificate fallback, thumbprint = {_certThumbprint}");
                
                // Get certificate from certificate store
                using (var store = new X509Store(StoreName.My, StoreLocation.CurrentUser))
                {
                    store.Open(OpenFlags.ReadOnly);
                    var certs = store.Certificates.Find(X509FindType.FindByThumbprint, _certThumbprint, false);
                    
                    if (certs.Count == 0)
                    {
                        // Try LocalMachine if not found in CurrentUser
                        store.Close();
                        using (var machineStore = new X509Store(StoreName.My, StoreLocation.LocalMachine))
                        {
                            machineStore.Open(OpenFlags.ReadOnly);
                            certs = machineStore.Certificates.Find(X509FindType.FindByThumbprint, _certThumbprint, false);
                            if (certs.Count == 0)
                            {
                                throw new Exception($"Certificate with thumbprint {_certThumbprint} not found. MI also failed: {ex.Message}");
                            }
                        }
                    }
                    
                    var cert = certs[0];
                    Console.WriteLine($"GetAppOnlyToken: Certificate found, subject = {cert.Subject}");
                    
                    // Use Azure.Identity to get token with certificate
                    var credential = new ClientCertificateCredential(_tenantId, _clientId, cert);
                    var token = await credential.GetTokenAsync(new Azure.Core.TokenRequestContext(new[] { $"{sharePointDomain}/.default" }));
                    
                    Console.WriteLine($"GetAppOnlyToken: Certificate token acquired successfully");
                    return token.Token;
                }
            }
        }

        private async Task<string> GetListItemEntityType(string listTitle, string token)
        {
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('{listTitle}')?$select=ListItemEntityTypeFullName";
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to get list entity type: {response.StatusCode}");
            }

            var responseBody = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseBody);
            return jsonDoc.RootElement.GetProperty("d").GetProperty("ListItemEntityTypeFullName").GetString();
        }

        private async Task<string> GetFormDigest(string accessToken)
        {
            var digestRequest = new HttpRequestMessage(HttpMethod.Post, $"{_siteUrl}/_api/contextinfo");
            digestRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            digestRequest.Headers.Add("Accept", "application/json;odata=verbose");
            
            var digestResponse = await _httpClient.SendAsync(digestRequest);
            
            if (!digestResponse.IsSuccessStatusCode)
            {
                var errorBody = await digestResponse.Content.ReadAsStringAsync();
                throw new Exception($"Form digest request failed with status {digestResponse.StatusCode}. Response body: {errorBody}");
            }
            
            var digestJson = await digestResponse.Content.ReadAsStringAsync();
            Console.WriteLine($"GetFormDigest: Raw response = {digestJson}");
            
            var doc = JsonDocument.Parse(digestJson);
            
            // Safely navigate the response structure
            if (!doc.RootElement.TryGetProperty("d", out var dProp))
            {
                var availableProps = string.Join(", ", doc.RootElement.EnumerateObject().Select(p => p.Name));
                throw new Exception($"Form digest response missing 'd' property. Available properties: {availableProps}. Full response: {digestJson}");
            }
            
            if (!dProp.TryGetProperty("GetContextWebInformation", out var contextProp))
            {
                var availableProps = string.Join(", ", dProp.EnumerateObject().Select(p => p.Name));
                throw new Exception($"Form digest response missing 'GetContextWebInformation' property. Available properties in 'd': {availableProps}");
            }
            
            if (!contextProp.TryGetProperty("FormDigestValue", out var digestProp))
            {
                var availableProps = string.Join(", ", contextProp.EnumerateObject().Select(p => p.Name));
                throw new Exception($"Form digest response missing 'FormDigestValue' property. Available properties in 'GetContextWebInformation': {availableProps}");
            }
            
            var digestValue = digestProp.GetString();
            Console.WriteLine($"GetFormDigest: Successfully obtained digest");
            return digestValue;
        }

        private async Task<T> GetFromSharePoint<T>(string endpoint, string accessToken)
        {
            var requestUrl = $"{_siteUrl}/_api/web/{endpoint}";
            Console.WriteLine($"GetFromSharePoint: URL = {requestUrl}");
            
            var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            Console.WriteLine($"GetFromSharePoint: Status = {response.StatusCode}");
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"GetFromSharePoint: Raw JSON = {json}");
            
            var result = JsonSerializer.Deserialize<T>(json);
            Console.WriteLine($"GetFromSharePoint: Deserialized successfully");
            return result;
        }

        // Helper to extract string from potentially complex SharePoint fields
        private string GetStringValue(JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.String)
                return element.GetString();
            if (element.ValueKind == JsonValueKind.Number)
                return element.ToString();
            if (element.ValueKind == JsonValueKind.Object)
            {
                // For URL fields, extract the Url property
                if (element.TryGetProperty("Url", out var urlProp))
                    return urlProp.GetString();
                // For Note fields or other objects, try __deferred or just return null
                if (element.TryGetProperty("__deferred", out var _))
                    return null;
            }
            return null;
        }

        private async Task PostToSharePoint(string endpoint, object data, string accessToken)
        {
            var requestUrl = $"{_siteUrl}/_api/web/{endpoint}";
            Console.WriteLine($"PostToSharePoint: URL = {requestUrl}");
            Console.WriteLine($"PostToSharePoint: Data = {JsonSerializer.Serialize(data)}");
            
            var request = new HttpRequestMessage(HttpMethod.Post, requestUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Content = new StringContent(
                JsonSerializer.Serialize(data), 
                Encoding.UTF8, 
                "application/json");
            request.Content.Headers.ContentType.Parameters.Add(new System.Net.Http.Headers.NameValueHeaderValue("odata", "verbose"));

            var digestValue = await GetFormDigest(accessToken);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            Console.WriteLine($"PostToSharePoint: Response status = {response.StatusCode}");
            
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"PostToSharePoint: Error response body = {errorBody}");
                throw new Exception($"POST failed with status {response.StatusCode}: {errorBody}");
            }
            
            var responseBody = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"PostToSharePoint: Success response = {responseBody}");
        }

        private async Task MergeToSharePoint(string endpoint, object data, string accessToken)
        {
            var requestUrl = $"{_siteUrl}/_api/web/{endpoint}";
            Console.WriteLine($"MergeToSharePoint: URL = {requestUrl}");
            Console.WriteLine($"MergeToSharePoint: Switching to app-only authentication for write operation...");
            
            // CRITICAL: Use app-only token instead of user token for write operations
            string writeToken;
            bool usingAppToken = false;
            try
            {
                writeToken = await GetAppOnlyToken();
                usingAppToken = true;
                Console.WriteLine($"MergeToSharePoint: App-only token acquired successfully (length: {writeToken.Length})");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"MergeToSharePoint: Failed to get app-only token: {ex.Message}. Falling back to user token.");
                writeToken = accessToken;
                usingAppToken = false;
            }
            
            Console.WriteLine($"MergeToSharePoint: Using {(usingAppToken ? "APP-ONLY" : "USER")} token for update");
            
            // Extract list name and item ID from endpoint
            var listMatch = System.Text.RegularExpressions.Regex.Match(endpoint, @"lists/getbytitle\('([^']+)'\)/items\((\d+)\)");
            
            if (listMatch.Success)
            {
                var listTitle = listMatch.Groups[1].Value;
                var itemId = listMatch.Groups[2].Value;
                
                // Use validateUpdateListItem which is more lenient with JSON structure
                Console.WriteLine($"MergeToSharePoint: Using validateUpdateListItem for list '{listTitle}', item {itemId}");
                
                // Convert data to clean dictionary with string values
                var dataDict = data as Dictionary<string, object> ?? new Dictionary<string, object>();
                var fieldValues = new List<Dictionary<string, object>>();
                
                foreach (var kvp in dataDict)
                {
                    if (kvp.Value != null)
                    {
                        string fieldValue;
                        // Convert all values to strings - SharePoint handles type conversion
                        if (kvp.Value is JsonElement jsonElement)
                        {
                            fieldValue = jsonElement.GetRawText().Trim('"');
                        }
                        else if (kvp.Value is DateTime dateTime)
                        {
                            // Format DateTime for SharePoint - use US format that SharePoint expects
                            // SharePoint's validateUpdateListItem wants format like "2/23/2012 2:25 PM"
                            fieldValue = dateTime.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
                        }
                        else
                        {
                            fieldValue = kvp.Value.ToString() ?? "";
                        }
                        
                        fieldValues.Add(new Dictionary<string, object>
                        {
                            { "FieldName", kvp.Key },
                            { "FieldValue", fieldValue }
                        });
                    }
                }
                
                var payload = new Dictionary<string, object>
                {
                    { "formValues", fieldValues },
                    { "bNewDocumentUpdate", false }
                };
                
                var jsonData = JsonSerializer.Serialize(payload);
                Console.WriteLine($"MergeToSharePoint: Data to send = {jsonData}");
                
                // Change endpoint to use validateUpdateListItem
                var validateUrl = $"{_siteUrl}/_api/web/lists/getbytitle('{listTitle}')/items({itemId})/validateUpdateListItem";
                Console.WriteLine($"MergeToSharePoint: URL = {validateUrl}");
                
                var request = new HttpRequestMessage(HttpMethod.Post, validateUrl);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", writeToken);
                request.Headers.Add("Accept", "application/json");
                
                request.Content = new StringContent(jsonData, Encoding.UTF8, "application/json");
                
                var digestValue = await GetFormDigest(writeToken);
                request.Headers.Add("X-RequestDigest", digestValue);
                
                Console.WriteLine($"MergeToSharePoint: Sending request...");
                var response = await _httpClient.SendAsync(request);
                var responseBody = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"MergeToSharePoint: Response status = {response.StatusCode}");
                Console.WriteLine($"MergeToSharePoint: Response body = {responseBody}");
                
                if (!response.IsSuccessStatusCode)
                {
                    var errorDetail = $"MERGE failed with status {response.StatusCode}. Response: {responseBody}";
                    Console.WriteLine($"MergeToSharePoint: ERROR - {errorDetail}");
                    throw new Exception(errorDetail);
                }
                
                Console.WriteLine("MergeToSharePoint: MERGE succeeded");
                
                // Verify the data was saved
                Console.WriteLine("MergeToSharePoint: VERIFYING data was saved...");
                await Task.Delay(500);
                
                var verifyUrl = requestUrl;
                var verifyRequest = new HttpRequestMessage(HttpMethod.Get, verifyUrl);
                verifyRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", writeToken);
                verifyRequest.Headers.Add("Accept", "application/json;odata=nometadata");
                var verifyResponse = await _httpClient.SendAsync(verifyRequest);
                var verifyBody = await verifyResponse.Content.ReadAsStringAsync();
                Console.WriteLine($"MergeToSharePoint: VERIFICATION = {verifyBody}");
            }
            else
            {
                // Fallback
                throw new Exception($"Endpoint format not recognized: {endpoint}");
            }
        }

        public async Task<List<Customer>> GetCustomers(string accessToken)
        {
            var result = await GetFromSharePoint<JsonElement>("lists/getbytitle('Customers')/items", accessToken);
            var customers = new List<Customer>();
            
            foreach (var item in result.GetProperty("d").GetProperty("results").EnumerateArray())
            {
                customers.Add(new Customer
                {
                    Id = item.GetProperty("Id").ToString(),
                    CustomerCode = item.TryGetProperty("CustomerCode", out JsonElement customerCode) ? customerCode.GetString() : string.Empty,
                    Code = item.TryGetProperty("CustomerCode", out JsonElement code) ? code.GetString() : string.Empty,
                    Name = item.TryGetProperty("Title", out JsonElement title) ? title.GetString() : string.Empty,
                    Email = item.TryGetProperty("Email", out JsonElement email) ? email.GetString() : string.Empty,
                    Phone = item.TryGetProperty("Phone", out JsonElement phone) ? phone.GetString() : string.Empty,
                    BillingEmail = item.TryGetProperty("BillingEmail", out JsonElement billingEmail) ? billingEmail.GetString() : string.Empty,
                    BillingAddress = item.TryGetProperty("BillingAddress", out JsonElement billingAddress) ? billingAddress.GetString() : string.Empty,
                    DefaultDayRate = item.TryGetProperty("DefaultDayRate", out JsonElement dayRate) ? dayRate.ToString() : string.Empty,
                    DefaultHourlyRate = item.TryGetProperty("DefaultHourlyRate", out JsonElement hourlyRate) ? hourlyRate.ToString() : string.Empty,
                    DefaultVATRate = item.TryGetProperty("DefaultVATRate", out JsonElement vatRate) && vatRate.ValueKind == JsonValueKind.Number ? (int?)vatRate.GetInt32() : null,
                    IsVATRegistered = item.TryGetProperty("IsVATRegistered", out JsonElement isVat) && isVat.ValueKind == JsonValueKind.True
                });
            }
            
            return customers;
        }

        public async Task<bool> CreateCustomer(Customer customer, string accessToken)
        {
            Console.WriteLine($"CreateCustomer: Creating customer {customer.Name}");
            Console.WriteLine($"CreateCustomer: Customer data = {JsonSerializer.Serialize(customer)}");
            
            // Use app-only token for write operations
            var writeToken = await GetAppOnlyToken() ?? accessToken;
            Console.WriteLine($"CreateCustomer: Using {(writeToken == accessToken ? "USER" : "APP-ONLY")} token");
            
            // Build the data payload - use CustomerCode if provided, otherwise Code
            var code = !string.IsNullOrEmpty(customer.CustomerCode) ? customer.CustomerCode : customer.Code;
            
            var data = new Dictionary<string, object>
            {
                { "Title", customer.Name ?? "" },
                { "CustomerCode", code ?? "" }  // SharePoint field is CustomerCode, not Code
            };
            
            // Add optional fields if they have values
            if (!string.IsNullOrEmpty(customer.Email))
                data["Email"] = customer.Email;
            if (!string.IsNullOrEmpty(customer.BillingEmail))
                data["BillingEmail"] = customer.BillingEmail;
            if (!string.IsNullOrEmpty(customer.Phone))
                data["Phone"] = customer.Phone;
            if (!string.IsNullOrEmpty(customer.Address))
                data["Address"] = customer.Address;
            if (!string.IsNullOrEmpty(customer.BillingAddress))
                data["BillingAddress"] = customer.BillingAddress;
            if (!string.IsNullOrEmpty(customer.DefaultDayRate))
                data["DefaultDayRate"] = customer.DefaultDayRate;
            if (!string.IsNullOrEmpty(customer.DefaultHourlyRate))
                data["DefaultHourlyRate"] = customer.DefaultHourlyRate;
            if (customer.DefaultVATRate.HasValue)
                data["DefaultVATRate"] = customer.DefaultVATRate.Value.ToString();
            
            data["IsVATRegistered"] = customer.IsVATRegistered;
            
            var jsonData = JsonSerializer.Serialize(data);
            Console.WriteLine($"CreateCustomer: Data to send = {jsonData}");
            
            var requestUrl = $"{_siteUrl}/_api/web/lists/getbytitle('Customers')/items";
            var request = new HttpRequestMessage(HttpMethod.Post, requestUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", writeToken);
            request.Headers.Add("Accept", "application/json");
            request.Content = new StringContent(jsonData, Encoding.UTF8, "application/json");

            var digestValue = await GetFormDigest(writeToken);
            request.Headers.Add("X-RequestDigest", digestValue);

            Console.WriteLine($"CreateCustomer: Sending request to {requestUrl}");
            var response = await _httpClient.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"CreateCustomer: Response status = {response.StatusCode}");
            Console.WriteLine($"CreateCustomer: Response body = {responseBody}");
            
            if (!response.IsSuccessStatusCode)
            {
                var errorDetail = $"Create failed with status {response.StatusCode}. Response: {responseBody}";
                Console.WriteLine($"CreateCustomer: ERROR - {errorDetail}");
                throw new Exception(errorDetail);
            }
            
            Console.WriteLine("CreateCustomer: Customer created successfully");
            return true;
        }

        public async Task<bool> UpdateCustomer(string customerId, Customer customer, string accessToken)
        {
            Console.WriteLine($"UpdateCustomer: Updating customer ID {customerId}");
            Console.WriteLine($"UpdateCustomer: Customer data = {JsonSerializer.Serialize(customer)}");
            
            // Use app-only token for write operations
            var writeToken = await GetAppOnlyToken() ?? accessToken;
            Console.WriteLine($"UpdateCustomer: Using {(writeToken == accessToken ? "USER" : "APP-ONLY")} token");
            
            var data = new Dictionary<string, object>();
            
            // Add all fields that can be updated
            if (!string.IsNullOrEmpty(customer.Name))
                data["Title"] = customer.Name;
            if (!string.IsNullOrEmpty(customer.Email))
                data["Email"] = customer.Email;
            if (!string.IsNullOrEmpty(customer.BillingEmail))
                data["BillingEmail"] = customer.BillingEmail;
            if (!string.IsNullOrEmpty(customer.Phone))
                data["Phone"] = customer.Phone;
            if (!string.IsNullOrEmpty(customer.Address))
                data["Address"] = customer.Address;
            if (!string.IsNullOrEmpty(customer.BillingAddress))
                data["BillingAddress"] = customer.BillingAddress;
            if (!string.IsNullOrEmpty(customer.DefaultDayRate))
                data["DefaultDayRate"] = customer.DefaultDayRate;
            if (!string.IsNullOrEmpty(customer.DefaultHourlyRate))
                data["DefaultHourlyRate"] = customer.DefaultHourlyRate;
            if (customer.DefaultVATRate.HasValue)
                data["DefaultVATRate"] = customer.DefaultVATRate.Value.ToString();
            
            data["IsVATRegistered"] = customer.IsVATRegistered;
            
            var jsonData = JsonSerializer.Serialize(data);
            Console.WriteLine($"UpdateCustomer: Data to send = {jsonData}");
            
            var requestUrl = $"{_siteUrl}/_api/web/lists/getbytitle('Customers')/items({customerId})";
            var request = new HttpRequestMessage(new HttpMethod("MERGE"), requestUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", writeToken);
            request.Headers.Add("Accept", "application/json");
            request.Headers.Add("IF-MATCH", "*");
            request.Content = new StringContent(jsonData, Encoding.UTF8, "application/json");

            var digestValue = await GetFormDigest(writeToken);
            request.Headers.Add("X-RequestDigest", digestValue);

            Console.WriteLine($"UpdateCustomer: Sending MERGE request to {requestUrl}");
            var response = await _httpClient.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"UpdateCustomer: Response status = {response.StatusCode}");
            Console.WriteLine($"UpdateCustomer: Response body = {responseBody}");
            
            if (!response.IsSuccessStatusCode)
            {
                var errorDetail = $"Update failed with status {response.StatusCode}. Response: {responseBody}";
                Console.WriteLine($"UpdateCustomer: ERROR - {errorDetail}");
                throw new Exception(errorDetail);
            }
            
            Console.WriteLine("UpdateCustomer: Customer updated successfully");
            return true;
        }

        public async Task<List<Supplier>> GetSuppliers(string accessToken)
        {
            Console.WriteLine("GetSuppliers: Starting query for suppliers...");

            // Prefer app-only token for read operations
            var appToken = await GetAppOnlyToken();
            var tokenToUse = string.IsNullOrEmpty(appToken) ? accessToken : appToken;
            Console.WriteLine($"GetSuppliers: Using {(tokenToUse == accessToken ? "USER" : "APP-ONLY")} token");

            var endpoint = "lists/getbytitle('Payees')/items";
            Console.WriteLine($"GetSuppliers: Endpoint = {endpoint}");

            var result = await GetFromSharePoint<JsonElement>(endpoint, tokenToUse);
            var suppliers = new List<Supplier>();

            if (!result.TryGetProperty("d", out var dProp) || !dProp.TryGetProperty("results", out var results))
            {
                Console.WriteLine("GetSuppliers: No results in response");
                return suppliers;
            }

            foreach (var item in results.EnumerateArray())
            {
                suppliers.Add(new Supplier
                {
                    Id = item.GetProperty("Id").ToString(),
                    SupplierCode = item.TryGetProperty("SupplierCode", out JsonElement supplierCode) ? supplierCode.GetString() : string.Empty,
                    Code = item.TryGetProperty("SupplierCode", out JsonElement code) ? code.GetString() : string.Empty,
                    Name = item.TryGetProperty("Title", out JsonElement title) ? title.GetString() : string.Empty,
                    Email = item.TryGetProperty("SupplierEmail", out JsonElement email) ? email.GetString() : string.Empty,
                    Category = item.TryGetProperty("SupplierCategory", out JsonElement category) ? category.GetString() : string.Empty,
                    DefaultVATRate = item.TryGetProperty("DefaultVATRate", out JsonElement vatRate) && vatRate.ValueKind == JsonValueKind.Number ? (int?)vatRate.GetInt32() : null,
                    // New Payees fields
                    PayeeType = item.TryGetProperty("PayeeType", out JsonElement payeeType) ? payeeType.GetString() : string.Empty,
                    IsActive = item.TryGetProperty("IsActive", out JsonElement isActive) && isActive.ValueKind == JsonValueKind.True,
                    OnHold = item.TryGetProperty("OnHold", out JsonElement onHold) && onHold.ValueKind == JsonValueKind.True,
                    PrimaryContact = item.TryGetProperty("PrimaryContact", out JsonElement primaryContact) ? primaryContact.GetString() : string.Empty,
                    RemittanceEmail = item.TryGetProperty("RemittanceEmail", out JsonElement remittanceEmail) ? remittanceEmail.GetString() : string.Empty,
                    Phone = item.TryGetProperty("Phone", out JsonElement phone) ? phone.GetString() : string.Empty,
                    PaymentMethod = item.TryGetProperty("PaymentMethod", out JsonElement paymentMethod) ? paymentMethod.GetString() : string.Empty,
                    PaymentTerms = item.TryGetProperty("PaymentTerms", out JsonElement paymentTerms) ? paymentTerms.GetString() : string.Empty,
                    Currency = item.TryGetProperty("Currency", out JsonElement currency) ? currency.GetString() : string.Empty,
                    VATRegistration = item.TryGetProperty("VATRegistration", out JsonElement vatReg) ? vatReg.GetString() : string.Empty,
                    AccountNumber = item.TryGetProperty("AccountNumber", out JsonElement accountNumber) ? accountNumber.GetString() : string.Empty,
                    SortCode = item.TryGetProperty("SortCode", out JsonElement sortCode) ? sortCode.GetString() : string.Empty,
                    IBAN = item.TryGetProperty("IBAN", out JsonElement iban) ? iban.GetString() : string.Empty
                });
            }

            Console.WriteLine($"GetSuppliers: Returning {suppliers.Count} suppliers");
            return suppliers;
        }

        public async Task<bool> CreateSupplier(Supplier supplier, string accessToken)
        {
            Console.WriteLine($"CreateSupplier: Creating supplier {supplier.Name}");
            Console.WriteLine($"CreateSupplier: Supplier data = {JsonSerializer.Serialize(supplier)}");
            
            // Use app-only token for write operations
            var writeToken = await GetAppOnlyToken() ?? accessToken;
            Console.WriteLine($"CreateSupplier: Using {(writeToken == accessToken ? "USER" : "APP-ONLY")} token");
            
            // Build the data payload - use SupplierCode if provided, otherwise Code
            var code = !string.IsNullOrEmpty(supplier.SupplierCode) ? supplier.SupplierCode : supplier.Code;
            
            var data = new Dictionary<string, object>
            {
                { "Title", supplier.Name ?? "" },
                { "SupplierCode", code ?? "" }
            };
            
            // Add optional fields if they have values
            if (!string.IsNullOrEmpty(supplier.Email))
                data["SupplierEmail"] = supplier.Email;
            if (!string.IsNullOrEmpty(supplier.Category))
                data["SupplierCategory"] = supplier.Category;
            if (supplier.DefaultVATRate.HasValue)
                data["DefaultVATRate"] = supplier.DefaultVATRate.Value.ToString();
            
            var jsonData = JsonSerializer.Serialize(data);
            Console.WriteLine($"CreateSupplier: Data to send = {jsonData}");
            
            var requestUrl = $"{_siteUrl}/_api/web/lists/getbytitle('Payees')/items";
            var request = new HttpRequestMessage(HttpMethod.Post, requestUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", writeToken);
            request.Headers.Add("Accept", "application/json");
            request.Content = new StringContent(jsonData, Encoding.UTF8, "application/json");

            var digestValue = await GetFormDigest(writeToken);
            request.Headers.Add("X-RequestDigest", digestValue);

            Console.WriteLine($"CreateSupplier: Sending request to {requestUrl}");
            var response = await _httpClient.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"CreateSupplier: Response status = {response.StatusCode}");
            Console.WriteLine($"CreateSupplier: Response body = {responseBody}");
            
            if (!response.IsSuccessStatusCode)
            {
                var errorDetail = $"Create failed with status {response.StatusCode}. Response: {responseBody}";
                Console.WriteLine($"CreateSupplier: ERROR - {errorDetail}");
                throw new Exception(errorDetail);
            }
            
            Console.WriteLine("CreateSupplier: Supplier created successfully");
            return true;
        }

        public async Task<bool> UpdateSupplier(string supplierId, Supplier supplier, string accessToken)
        {
            Console.WriteLine($"UpdateSupplier: Updating supplier ID {supplierId}");
            Console.WriteLine($"UpdateSupplier: Supplier data = {JsonSerializer.Serialize(supplier)}");
            
            // Use app-only token for write operations
            var writeToken = await GetAppOnlyToken() ?? accessToken;
            Console.WriteLine($"UpdateSupplier: Using {(writeToken == accessToken ? "USER" : "APP-ONLY")} token");
            
            var data = new Dictionary<string, object>();
            
            // Add all fields that can be updated
            if (!string.IsNullOrEmpty(supplier.Name))
                data["Title"] = supplier.Name;
            if (!string.IsNullOrEmpty(supplier.Email))
                data["SupplierEmail"] = supplier.Email;
            if (!string.IsNullOrEmpty(supplier.Category))
                data["SupplierCategory"] = supplier.Category;
            if (supplier.DefaultVATRate.HasValue)
                data["DefaultVATRate"] = supplier.DefaultVATRate.Value.ToString();
            
            // New Payees fields
            if (!string.IsNullOrEmpty(supplier.PayeeType))
                data["PayeeType"] = supplier.PayeeType;
            data["IsActive"] = supplier.IsActive;
            data["OnHold"] = supplier.OnHold;
            if (!string.IsNullOrEmpty(supplier.PrimaryContact))
                data["PrimaryContact"] = supplier.PrimaryContact;
            if (!string.IsNullOrEmpty(supplier.RemittanceEmail))
                data["RemittanceEmail"] = supplier.RemittanceEmail;
            if (!string.IsNullOrEmpty(supplier.Phone))
                data["Phone"] = supplier.Phone;
            if (!string.IsNullOrEmpty(supplier.PaymentMethod))
                data["PaymentMethod"] = supplier.PaymentMethod;
            if (!string.IsNullOrEmpty(supplier.PaymentTerms))
                data["PaymentTerms"] = supplier.PaymentTerms;
            if (!string.IsNullOrEmpty(supplier.Currency))
                data["Currency"] = supplier.Currency;
            if (!string.IsNullOrEmpty(supplier.VATRegistration))
                data["VATRegistration"] = supplier.VATRegistration;
            if (!string.IsNullOrEmpty(supplier.AccountNumber))
                data["AccountNumber"] = supplier.AccountNumber;
            if (!string.IsNullOrEmpty(supplier.SortCode))
                data["SortCode"] = supplier.SortCode;
            if (!string.IsNullOrEmpty(supplier.IBAN))
                data["IBAN"] = supplier.IBAN;
            
            var jsonData = JsonSerializer.Serialize(data);
            Console.WriteLine($"UpdateSupplier: Data to send = {jsonData}");
            
            var requestUrl = $"{_siteUrl}/_api/web/lists/getbytitle('Payees')/items({supplierId})";
            var request = new HttpRequestMessage(new HttpMethod("MERGE"), requestUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", writeToken);
            request.Headers.Add("Accept", "application/json");
            request.Headers.Add("IF-MATCH", "*");
            request.Content = new StringContent(jsonData, Encoding.UTF8, "application/json");

            var digestValue = await GetFormDigest(writeToken);
            request.Headers.Add("X-RequestDigest", digestValue);

            Console.WriteLine($"UpdateSupplier: Sending MERGE request to {requestUrl}");
            var response = await _httpClient.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"UpdateSupplier: Response status = {response.StatusCode}");
            Console.WriteLine($"UpdateSupplier: Response body = {responseBody}");
            
            if (!response.IsSuccessStatusCode)
            {
                var errorDetail = $"Update failed with status {response.StatusCode}. Response: {responseBody}";
                Console.WriteLine($"UpdateSupplier: ERROR - {errorDetail}");
                throw new Exception(errorDetail);
            }
            
            Console.WriteLine("UpdateSupplier: Supplier updated successfully");
            return true;
        }

        public async Task<CompanySettings> GetCompanySettings(string accessToken)
        {
            try
            {
                // Use direct HTTP call like GetInvoicesAsync - include ALL fields that exist in SharePoint list
                var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Company Settings')/items?$top=1";
                Console.WriteLine($"GetCompanySettings: Calling endpoint: {endpoint}");
                
                var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                request.Headers.Add("Accept", "application/json;odata=verbose");

                var response = await _httpClient.SendAsync(request);
                var content = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"GetCompanySettings: Response Status = {response.StatusCode}");
                
                if (!response.IsSuccessStatusCode)
                {
                    Console.WriteLine($"GetCompanySettings: ERROR - {content}");
                    throw new Exception($"Failed to get company settings: {response.StatusCode} - {content}");
                }

                var jsonDoc = JsonDocument.Parse(content);
                var results = jsonDoc.RootElement.GetProperty("d").GetProperty("results");
                
                if (results.GetArrayLength() == 0)
                {
                    Console.WriteLine("GetCompanySettings: No items found in Company Settings list");
                    return new CompanySettings();
                }

                var item = results[0];
                Console.WriteLine($"GetCompanySettings: Found item");
                
                // Helper to extract string from potentially complex fields
                string GetStringValue(JsonElement element)
                {
                    if (element.ValueKind == JsonValueKind.String)
                        return element.GetString();
                    if (element.ValueKind == JsonValueKind.Number)
                        return element.ToString();
                    if (element.ValueKind == JsonValueKind.Object)
                    {
                        // For URL fields, extract the Url property
                        if (element.TryGetProperty("Url", out var urlProp))
                            return urlProp.GetString();
                    }
                    return null;
                }
                
                var settings = new CompanySettings
                {
                    CompanyName = item.TryGetProperty("BusinessName", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString() : null,
                    CompanyAddress = item.TryGetProperty("RegisteredAddress", out var addr) && addr.ValueKind == JsonValueKind.String ? addr.GetString() : null,
                    CompanyPhone = item.TryGetProperty("InvoicingPhone", out var phone) && phone.ValueKind == JsonValueKind.String ? phone.GetString() : null,
                    CompanyEmail = item.TryGetProperty("InvoicingEmail", out var email) && email.ValueKind == JsonValueKind.String ? email.GetString() : null,
                    InvoicesEmail = item.TryGetProperty("InvoicesEmail", out var invoicesEmail) && invoicesEmail.ValueKind == JsonValueKind.String ? invoicesEmail.GetString() : null,
                    QuotesEmail = item.TryGetProperty("QuotesEmail", out var quotesEmail) && quotesEmail.ValueKind == JsonValueKind.String ? quotesEmail.GetString() : null,
                    PaymentsEmail = item.TryGetProperty("PaymentsEmail", out var paymentsEmail) && paymentsEmail.ValueKind == JsonValueKind.String ? paymentsEmail.GetString() : null,
                    CompanyRegistrationNumber = item.TryGetProperty("CompanyRegNo", out var regNo) && regNo.ValueKind == JsonValueKind.String ? regNo.GetString() : null,
                    TaxRegistrationNumber = item.TryGetProperty("CompanyRegNo", out var taxNo) && taxNo.ValueKind == JsonValueKind.String ? taxNo.GetString() : null,
                    VatRegistrationNumber = item.TryGetProperty("VATRegNo", out var vatNo) && vatNo.ValueKind == JsonValueKind.String ? vatNo.GetString() : null,
                    BankName = item.TryGetProperty("BankAccountName", out var bank) && bank.ValueKind == JsonValueKind.String ? bank.GetString() : null,
                    BankAccountNumber = item.TryGetProperty("BankAccountNumber", out var acct) && acct.ValueKind == JsonValueKind.String ? acct.GetString() : null,
                    BankSortCode = item.TryGetProperty("BankSortCode", out var sort) && sort.ValueKind == JsonValueKind.String ? sort.GetString() : null,
                    BankIBAN = item.TryGetProperty("BankIBAN", out var iban) && iban.ValueKind == JsonValueKind.String ? iban.GetString() : null,
                    BankSwiftCode = item.TryGetProperty("BankSWIFT", out var swift) && swift.ValueKind == JsonValueKind.String ? swift.GetString() : null,
                    DefaultCurrency = item.TryGetProperty("BaseCurrency", out var curr) && curr.ValueKind == JsonValueKind.String ? curr.GetString() : null,
                    CurrencySymbol = item.TryGetProperty("CurrencySymbol", out var currSymbol) && currSymbol.ValueKind == JsonValueKind.String ? currSymbol.GetString() : null,
                    DefaultVATRate = item.TryGetProperty("DefaultVATRate", out var rate) && rate.ValueKind == JsonValueKind.Number ? rate.GetInt32().ToString() : null,
                    InvoicePrefix = item.TryGetProperty("InvoicePrefix", out var prefix) && prefix.ValueKind == JsonValueKind.String ? prefix.GetString() : null,
                    QuotePrefix = item.TryGetProperty("QuotePrefix", out var qPrefix) && qPrefix.ValueKind == JsonValueKind.String ? qPrefix.GetString() : null,
                    InvoiceTermsDays = item.TryGetProperty("PaymentTermsDays", out var days) && days.ValueKind == JsonValueKind.Number ? days.GetInt32().ToString() : null,
                    InvoiceFooterText = item.TryGetProperty("InvoiceFooterText", out var footer) && footer.ValueKind == JsonValueKind.String ? footer.GetString() : null,
                    LogoUrl = item.TryGetProperty("LogoUrl", out var logo) ? GetStringValue(logo) : null,
                    CompanyInceptionDate = item.TryGetProperty("CompanyInceptionDate", out var inceptionDate) && inceptionDate.ValueKind == JsonValueKind.String ? DateTime.Parse(inceptionDate.GetString()) : null,
                    FYStartMonth = item.TryGetProperty("FYStartMonth", out var fyMonth) && fyMonth.ValueKind == JsonValueKind.Number ? fyMonth.GetInt32() : null,
                    FYStartDay = item.TryGetProperty("FYStartDay", out var fyDay) && fyDay.ValueKind == JsonValueKind.Number ? fyDay.GetInt32() : null,
                    SmtpServer = item.TryGetProperty("SmtpServer", out var smtpServer) && smtpServer.ValueKind == JsonValueKind.String ? smtpServer.GetString() : null,
                    SmtpPort = item.TryGetProperty("SmtpPort", out var smtpPort) && smtpPort.ValueKind == JsonValueKind.Number ? smtpPort.GetInt32() : (int?)null,
                    SmtpFromAddress = item.TryGetProperty("SmtpFromAddress", out var smtpFrom) && smtpFrom.ValueKind == JsonValueKind.String ? smtpFrom.GetString() : null,
                    SmtpUsername = item.TryGetProperty("SmtpUsername", out var smtpUser) && smtpUser.ValueKind == JsonValueKind.String ? smtpUser.GetString() : null,
                    DirectorName = item.TryGetProperty("DirectorName", out var dirName) && dirName.ValueKind == JsonValueKind.String ? dirName.GetString() : null,
                    DirectorSignature = item.TryGetProperty("DirectorSignature", out var dirSig) && dirSig.ValueKind == JsonValueKind.String ? dirSig.GetString() : null,
                    HasAuthorizedOfficer = item.TryGetProperty("HasAuthorizedOfficer", out var hasOfficer) && hasOfficer.ValueKind == JsonValueKind.True ? true : (hasOfficer.ValueKind == JsonValueKind.False ? false : (bool?)null),
                    AuthorizedOfficerName = item.TryGetProperty("AuthorizedOfficerName", out var officerName) && officerName.ValueKind == JsonValueKind.String ? officerName.GetString() : null,
                    AuthorizedOfficerSignature = item.TryGetProperty("AuthorizedOfficerSignature", out var officerSig) && officerSig.ValueKind == JsonValueKind.String ? officerSig.GetString() : null
                };
                
                Console.WriteLine($"GetCompanySettings: Mapped CompanyName={settings.CompanyName}, CompanyAddress={settings.CompanyAddress}, VATRate={settings.DefaultVATRate}");
                Console.WriteLine($"GetCompanySettings: Director={settings.DirectorName}, HasOfficer={settings.HasAuthorizedOfficer}, OfficerName={settings.AuthorizedOfficerName}");
                Console.WriteLine($"GetCompanySettings: DirectorSignature length={settings.DirectorSignature?.Length ?? 0}, OfficerSignature length={settings.AuthorizedOfficerSignature?.Length ?? 0}");
                return settings;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"GetCompanySettings ERROR: {ex.Message}");
                throw new Exception($"Failed to get company settings: {ex.Message}", ex);
            }
        }

        public async Task<Dictionary<string, object>> UpdateCompanySettings(CompanySettings settings, string accessToken)
        {
            var diagnostics = new Dictionary<string, object>();
            
            try
            {
                Console.WriteLine("UpdateCompanySettings: Starting update process");
                diagnostics["stage"] = "GetListItems";
                
                JsonElement result;
                string rawJson = "";
                try
                {
                    result = await GetFromSharePoint<JsonElement>("lists/getbytitle('Company Settings')/items", accessToken);
                    Console.WriteLine($"UpdateCompanySettings: GetFromSharePoint returned successfully");
                    diagnostics["getItemsSuccess"] = true;
                }
                catch (System.Text.Json.JsonException jsonEx)
                {
                    throw new Exception($"JSON parsing error: {jsonEx.Message}. Raw JSON might be logged above.", jsonEx);
                }
                catch (Exception ex)
                {
                    throw new Exception($"GetFromSharePoint failed: {ex.Message}", ex);
                }
                
                // Safely navigate the response structure with detailed error messages
                if (!result.TryGetProperty("d", out var dProp))
                {
                    var availableProps = string.Join(", ", result.EnumerateObject().Select(p => p.Name));
                    throw new Exception($"Response missing 'd' property. Available properties: {availableProps}");
                }
                
                if (!dProp.TryGetProperty("results", out var results))
                {
                    var availableProps = string.Join(", ", dProp.EnumerateObject().Select(p => p.Name));
                    throw new Exception($"Response 'd' property missing 'results' property. Available properties in 'd': {availableProps}");
                }
                
                Console.WriteLine($"UpdateCompanySettings: Found {results.GetArrayLength()} items");
                
                // Log the incoming settings object
                Console.WriteLine("UpdateCompanySettings: Incoming settings object:");
                Console.WriteLine($"  CompanyName: {settings.CompanyName ?? "NULL"}");
                Console.WriteLine($"  CompanyPhone: {settings.CompanyPhone ?? "NULL"}");
                Console.WriteLine($"  DefaultVATRate: {settings.DefaultVATRate ?? "NULL"}");
                Console.WriteLine($"  InvoiceTermsDays: {settings.InvoiceTermsDays ?? "NULL"}");
                Console.WriteLine($"  CompanyInceptionDate: {(settings.CompanyInceptionDate.HasValue ? settings.CompanyInceptionDate.Value.ToString("O") : "NULL")}");
                Console.WriteLine($"  FYStartMonth: {(settings.FYStartMonth.HasValue ? settings.FYStartMonth.Value.ToString() : "NULL")}");
                Console.WriteLine($"  FYStartDay: {(settings.FYStartDay.HasValue ? settings.FYStartDay.Value.ToString() : "NULL")}");
                
                // Data without metadata (for MERGE operations)
                // Note: Don't update Title field in MERGE - it's the item identifier
                // Only include fields that have non-null values to avoid overwriting existing data
                var allFields = new Dictionary<string, object?>
                {
                    ["BusinessName"] = settings.CompanyName,
                    ["TradingName"] = settings.CompanyName,
                    ["RegisteredAddress"] = settings.CompanyAddress,
                    ["InvoicingPhone"] = settings.CompanyPhone,
                    ["InvoicingEmail"] = settings.CompanyEmail,
                    ["InvoicesEmail"] = settings.InvoicesEmail,
                    ["QuotesEmail"] = settings.QuotesEmail,
                    ["PaymentsEmail"] = settings.PaymentsEmail,
                    ["CompanyRegNo"] = settings.CompanyRegistrationNumber,
                    ["VATRegNo"] = settings.VatRegistrationNumber,
                    ["BankAccountName"] = settings.BankName,
                    ["BankAccountNumber"] = settings.BankAccountNumber,
                    ["BankSortCode"] = settings.BankSortCode,
                    ["BankIBAN"] = settings.BankIBAN,
                    ["BankSWIFT"] = settings.BankSwiftCode,
                    ["BaseCurrency"] = settings.DefaultCurrency,
                    ["CurrencySymbol"] = settings.CurrencySymbol,
                    ["DefaultVATRate"] = settings.DefaultVATRate, // Keep as string, SharePoint will convert
                    ["InvoicePrefix"] = settings.InvoicePrefix,
                    ["QuotePrefix"] = settings.QuotePrefix,
                    ["PaymentTermsDays"] = settings.InvoiceTermsDays, // Keep as string, SharePoint will convert
                    ["InvoiceFooterText"] = settings.InvoiceFooterText,
                    ["LogoUrl"] = settings.LogoUrl,
                    ["CompanyInceptionDate"] = settings.CompanyInceptionDate,
                    ["FYStartMonth"] = settings.FYStartMonth,
                    ["FYStartDay"] = settings.FYStartDay,
                    ["SmtpServer"] = settings.SmtpServer,
                    ["SmtpPort"] = settings.SmtpPort,
                    ["SmtpFromAddress"] = settings.SmtpFromAddress,
                    ["SmtpUsername"] = settings.SmtpUsername,
                    ["DirectorName"] = settings.DirectorName,
                    ["DirectorSignature"] = settings.DirectorSignature,
                    ["HasAuthorizedOfficer"] = settings.HasAuthorizedOfficer,
                    ["AuthorizedOfficerName"] = settings.AuthorizedOfficerName,
                    ["AuthorizedOfficerSignature"] = settings.AuthorizedOfficerSignature
                };
                
                // Only filter out NULL values - empty strings are valid (they mean "clear this field")
                Console.WriteLine("UpdateCompanySettings: All fields before filtering:");
                foreach (var kvp in allFields)
                {
                    var valueType = kvp.Value?.GetType().Name ?? "null";
                    var valueStr = kvp.Value == null ? "NULL" : $"'{kvp.Value}' (type: {valueType})";
                    Console.WriteLine($"  {kvp.Key} = {valueStr}");
                }
                
                // Simple filter: only exclude actual nulls, keep everything else including empty strings
                var updateData = allFields
                    .Where(kvp => kvp.Value != null)
                    .ToDictionary(kvp => kvp.Key, kvp => kvp.Value!);
                
                Console.WriteLine($"UpdateCompanySettings: Filtered updateData has {updateData.Count} fields:");
                foreach (var kvp in updateData)
                {
                    Console.WriteLine($"  {kvp.Key} = '{kvp.Value}'");
                }

                if (results.GetArrayLength() == 0)
                {
                    Console.WriteLine("UpdateCompanySettings: Creating new item (POST)");
                    // For POST, we need metadata and should provide defaults for empty fields
                    var createData = new Dictionary<string, object>
                    {
                        ["__metadata"] = new { type = "SP.Data.CompanySettingsListItem" },
                        ["Title"] = "Default",
                        ["BusinessName"] = settings.CompanyName ?? "Your Business",
                        ["TradingName"] = settings.CompanyName ?? "Your Business",
                        ["RegisteredAddress"] = settings.CompanyAddress ?? "",
                        ["InvoicingPhone"] = settings.CompanyPhone ?? "",
                        ["InvoicingEmail"] = settings.CompanyEmail ?? "",
                        ["CompanyRegNo"] = settings.CompanyRegistrationNumber ?? "",
                        ["VATRegNo"] = settings.VatRegistrationNumber ?? "",
                        ["BankAccountName"] = settings.BankName ?? "",
                        ["BankAccountNumber"] = settings.BankAccountNumber ?? "",
                        ["BankSortCode"] = settings.BankSortCode ?? "",
                        ["BaseCurrency"] = settings.DefaultCurrency ?? "GBP",
                        ["CurrencySymbol"] = settings.CurrencySymbol ?? "£",
                        ["DefaultVATRate"] = int.TryParse(settings.DefaultVATRate, out int createRate) ? createRate : 20,
                        ["InvoicePrefix"] = settings.InvoicePrefix ?? "INV",
                        ["QuotePrefix"] = settings.QuotePrefix ?? "QUO",
                        ["PaymentTermsDays"] = int.TryParse(settings.InvoiceTermsDays, out int createDays) ? createDays : 14,
                        ["InvoiceFooterText"] = settings.InvoiceFooterText ?? "",
                        ["LogoUrl"] = settings.LogoUrl ?? "",
                        ["CompanyInceptionDate"] = settings.CompanyInceptionDate,
                        ["FYStartMonth"] = settings.FYStartMonth,
                        ["FYStartDay"] = settings.FYStartDay
                    };
                    Console.WriteLine($"UpdateCompanySettings: Data to create: {JsonSerializer.Serialize(createData)}");
                    await PostToSharePoint("lists/getbytitle('Company Settings')/items", createData, accessToken);
                }
                else
                {
                    var firstItem = results[0];
                    Console.WriteLine($"UpdateCompanySettings: First item raw JSON: {firstItem}");
                    
                    // Try different possible property names for the ID
                    int itemId;
                    if (firstItem.TryGetProperty("ID", out var idProp))
                    {
                        itemId = idProp.GetInt32();
                    }
                    else if (firstItem.TryGetProperty("Id", out var idProp2))
                    {
                        itemId = idProp2.GetInt32();
                    }
                    else if (firstItem.TryGetProperty("id", out var idProp3))
                    {
                        itemId = idProp3.GetInt32();
                    }
                    else
                    {
                        var availableProps = string.Join(", ", firstItem.EnumerateObject().Select(p => p.Name));
                        throw new Exception($"Could not find ID property in item. Available properties: {availableProps}");
                    }
                    
                    Console.WriteLine($"UpdateCompanySettings: Updating existing item ID {itemId} (MERGE)");
                    Console.WriteLine($"UpdateCompanySettings: Data to update: {JsonSerializer.Serialize(updateData)}");
                    diagnostics["itemId"] = itemId;
                    diagnostics["updateMethod"] = "MERGE";
                    diagnostics["fieldCount"] = updateData.Count;
                    
                    // For MERGE, we don't need metadata
                    await MergeToSharePoint($"lists/getbytitle('Company Settings')/items({itemId})", updateData, accessToken);
                }
                
                Console.WriteLine("UpdateCompanySettings: Update completed successfully");
                diagnostics["completed"] = true;
                return diagnostics;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"UpdateCompanySettings: Error - {ex.Message}");
                Console.WriteLine($"UpdateCompanySettings: Stack trace - {ex.StackTrace}");
                diagnostics["error"] = ex.Message;
                throw;
            }
        }

        // ===========================
        // Expense Operations
        // ===========================
        private async Task<string> GenerateNextExpenseId(string supplierCode, string accessToken)
        {
            try
            {
                var now = DateTime.Now;
                var yearMonth = now.ToString("yyyy-MM");
                var prefix = $"EXP-{supplierCode}-{yearMonth}";
                
                // Get all expenses for this supplier and month
                var endpoint = $"web/lists/getbytitle('Expenses')/items?$filter=startswith(Title,'{prefix}')&$select=Title&$top=1000";
                var result = await GetFromSharePoint<JsonElement>(endpoint, accessToken);
                
                var maxSequence = 0;
                if (result.TryGetProperty("d", out var dProp) && dProp.TryGetProperty("results", out var items))
                {
                    foreach (var item in items.EnumerateArray())
                    {
                        if (item.TryGetProperty("Title", out var title))
                        {
                            var titleStr = GetStringValue(title);
                            if (!string.IsNullOrEmpty(titleStr) && titleStr.StartsWith(prefix))
                            {
                                // Extract sequence number (last 3 digits)
                                var parts = titleStr.Split('-');
                                if (parts.Length >= 5 && int.TryParse(parts[4], out var seq))
                                {
                                    maxSequence = Math.Max(maxSequence, seq);
                                }
                            }
                        }
                    }
                }
                
                var nextSequence = maxSequence + 1;
                return $"{prefix}-{nextSequence:D3}";
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error generating expense ID: {ex.Message}");
                // Fallback to simple timestamp-based ID
                return $"EXP-{supplierCode}-{DateTime.Now:yyyyMMdd-HHmmss}";
            }
        }

        public async Task<List<Expense>> GetExpenses(string accessToken)
        {
            try 
            {
                Console.WriteLine("GetExpenses: Starting query for expenses...");
                Console.WriteLine("GetExpenses: Using app-only token instead of user token for read operations");
                
                // Use app-only token for read operations - managed identity has correct permissions
                var appToken = await GetAppOnlyToken();
                Console.WriteLine($"GetExpenses: App token acquired (length: {appToken.Length})");
                
                // Get fields including EntryDate, Supplier lookup, and expand AttachmentFiles for attachments
                var endpoint = $"lists/getbytitle('Expenses')/items?$filter=EntryType eq 'Expense'&$select=Id,Title,Supplier/Title,Supplier/Id,SupplierFreeText,CustomerPORef,Category,VATApplicability,AmountNet,VATAmount,AmountGross,EntryDate,PaymentMethod,TaxYear,FinancialYear,IsDLA,Notes&$expand=Supplier,AttachmentFiles&$top=5000";
                Console.WriteLine($"GetExpenses: Endpoint = {endpoint}");
                
                var result = await GetFromSharePoint<JsonElement>(endpoint, appToken);
                Console.WriteLine("GetExpenses: Query succeeded!");
                
                if (!result.TryGetProperty("d", out var dProp) || !dProp.TryGetProperty("results", out var results))
                {
                    Console.WriteLine("GetExpenses: No results in response");
                    return new List<Expense>();
                }

                Console.WriteLine($"GetExpenses: Found {results.GetArrayLength()} items");
                
                var expenses = new List<Expense>();
                foreach (var item in results.EnumerateArray())
                {
                    // Extract attachment URLs
                    var attachments = new List<string>();
                    if (item.TryGetProperty("AttachmentFiles", out var attachmentFiles) && 
                        attachmentFiles.ValueKind == JsonValueKind.Object &&
                        attachmentFiles.TryGetProperty("results", out var attachResults))
                    {
                        foreach (var attachment in attachResults.EnumerateArray())
                        {
                            if (attachment.TryGetProperty("ServerRelativeUrl", out var url))
                            {
                                var relativeUrl = url.GetString();
                                // ServerRelativeUrl already includes the full site path, so just use tenant URL
                                var tenantUrl = new Uri(_siteUrl).GetLeftPart(UriPartial.Authority);
                                var fullUrl = $"{tenantUrl}{relativeUrl}";
                                attachments.Add(fullUrl);
                            }
                        }
                    }
                    
                    // Extract supplier name from lookup field or fallback to free text
                    string supplierName = null;
                    if (item.TryGetProperty("Supplier", out var supplierLookup) && supplierLookup.ValueKind == JsonValueKind.Object)
                    {
                        if (supplierLookup.TryGetProperty("Title", out var supplierTitle))
                        {
                            supplierName = GetStringValue(supplierTitle);
                        }
                    }
                    if (string.IsNullOrEmpty(supplierName) && item.TryGetProperty("SupplierFreeText", out var supplierFree))
                    {
                        supplierName = GetStringValue(supplierFree);
                    }
                    
                    var expense = new Expense
                    {
                        Id = item.GetProperty("Id").GetInt32(),
                        ExpenseId = GetStringValue(item.GetProperty("Title")),
                        Supplier = supplierName,
                        SupplierFreeText = item.TryGetProperty("SupplierFreeText", out var supplierFreeText) ? GetStringValue(supplierFreeText) : null,
                        Reference = item.TryGetProperty("CustomerPORef", out var custRef) ? GetStringValue(custRef) : null,
                        Category = item.TryGetProperty("Category", out var cat) ? GetStringValue(cat) : null,
                        VATApplicability = item.TryGetProperty("VATApplicability", out var vatApp) ? GetStringValue(vatApp) : null,
                        VATIncluded = true,
                        VATRate = null,
                        AmountNet = item.TryGetProperty("AmountNet", out var net) && net.ValueKind == JsonValueKind.Number ? net.GetDecimal() : null,
                        VATAmount = item.TryGetProperty("VATAmount", out var vat) && vat.ValueKind == JsonValueKind.Number ? vat.GetDecimal() : null,
                        AmountGross = item.TryGetProperty("AmountGross", out var gross) && gross.ValueKind == JsonValueKind.Number ? gross.GetDecimal() : null,
                        EntryDate = item.TryGetProperty("EntryDate", out var entryDate) && entryDate.ValueKind == JsonValueKind.String ? DateTime.Parse(entryDate.GetString()!) : null,
                        DatePaid = null,
                        PaymentMethod = item.TryGetProperty("PaymentMethod", out var payMethod) ? GetStringValue(payMethod) : null,
                        TaxYear = item.TryGetProperty("TaxYear", out var taxYr) ? GetStringValue(taxYr) : null,
                        FinancialYear = item.TryGetProperty("FinancialYear", out var finYr) ? GetStringValue(finYr) : null,
                        IsDLA = item.TryGetProperty("IsDLA", out var isDLA) ? isDLA.GetBoolean() : false,
                        ReceiptUrl = attachments.Count > 0 ? attachments[0] : null,
                        Attachments = attachments,
                        Notes = item.TryGetProperty("Notes", out var notes) ? GetStringValue(notes) : null
                    };
                    expenses.Add(expense);
                }

                Console.WriteLine($"GetExpenses: Returning {expenses.Count} expenses");
                return expenses;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"GetExpenses: Exception caught - {ex.Message}");
                Console.WriteLine($"GetExpenses: Stack trace - {ex.StackTrace}");
                throw;
            }
        }

        public async Task<int> CreateExpense(Expense expense, string accessToken, string supplierLookupId = null)
        {
            var token = await GetAppOnlyToken();
            
            // Get supplier code for expense ID generation
            string supplierCode = "UNKN";
            if (!string.IsNullOrEmpty(supplierLookupId))
            {
                var suppliers = await GetSuppliers(accessToken);
                var supplier = suppliers.FirstOrDefault(s => s.Id == supplierLookupId);
                if (supplier != null && !string.IsNullOrEmpty(supplier.SupplierCode))
                {
                    supplierCode = supplier.SupplierCode;
                }
            }
            
            // Generate unique expense ID with supplier code
            var expenseId = await GenerateNextExpenseId(supplierCode, accessToken);
            
            var data = new Dictionary<string, object>
            {
                ["Title"] = expenseId,
                ["EntryType"] = "Expense",
                ["EntryDate"] = expense.DatePaid?.ToString("yyyy-MM-ddTHH:mm:ssZ") ?? DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["CustomerPORef"] = expense.Reference ?? "",
                ["Category"] = expense.Category ?? "Other",
                ["VATApplicability"] = expense.VATApplicability ?? "Standard",
                ["VATIncluded"] = expense.VATIncluded,
                ["VATRate"] = expense.VATRate ?? 20,
                ["AmountNet"] = expense.AmountNet ?? 0,
                ["VATAmount"] = expense.VATAmount ?? 0,
                ["AmountGross"] = expense.AmountGross ?? 0,
                ["PaymentMethod"] = expense.PaymentMethod ?? "Bank",
                ["Paid"] = true,
                ["DatePaid"] = expense.DatePaid?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["TaxYear"] = expense.TaxYear ?? "",
                ["FinancialYear"] = expense.FinancialYear ?? "",
                ["IsDLA"] = expense.IsDLA,
                ["Notes"] = expense.Notes ?? ""
            };

            if (!string.IsNullOrEmpty(supplierLookupId))
            {
                data["SupplierId"] = supplierLookupId;
            }
            else if (!string.IsNullOrEmpty(expense.SupplierFreeText))
            {
                data["SupplierFreeText"] = expense.SupplierFreeText;
            }
            else if (!string.IsNullOrEmpty(expense.Supplier))
            {
                data["SupplierFreeText"] = expense.Supplier;
            }

            if (!string.IsNullOrEmpty(expense.ReceiptUrl))
            {
                data["RelatedDocument"] = new { Url = expense.ReceiptUrl, Description = "Receipt" };
            }

            var request = new HttpRequestMessage(HttpMethod.Post, $"{_siteUrl}/_api/web/lists/getbytitle('Expenses')/items");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Content = new StringContent(JsonSerializer.Serialize(data), Encoding.UTF8, "application/json");

            var response = await _httpClient.SendAsync(request);
            var responseContent = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to create expense in Ledger: {response.StatusCode} - {responseContent}");
            }

            var doc = JsonDocument.Parse(responseContent);
            return doc.RootElement.GetProperty("Id").GetInt32();
        }

        public async Task<string?> GetExpenseId(int ledgerItemId, string accessToken)
        {
            try
            {
                var endpoint = $"web/lists/getbytitle('Expenses')/items({ledgerItemId})?$select=Title";
                var result = await GetFromSharePoint<JsonElement>(endpoint, accessToken);
                
                if (result.TryGetProperty("d", out var dProp) && dProp.TryGetProperty("Title", out var title))
                {
                    return GetStringValue(title);
                }
                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error getting expense ID: {ex.Message}");
                return null;
            }
        }

        public async Task<bool> UpdateExpense(int id, Expense expense, string accessToken, string supplierLookupId = null)
        {
            var token = await GetAppOnlyToken();
            var data = new Dictionary<string, object>
            {
                ["EntryDate"] = expense.DatePaid?.ToString("yyyy-MM-ddTHH:mm:ssZ") ?? DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["CustomerPORef"] = expense.Reference ?? "",
                ["Category"] = expense.Category ?? "Other",
                ["VATApplicability"] = expense.VATApplicability ?? "Standard",
                ["VATIncluded"] = expense.VATIncluded,
                ["VATRate"] = expense.VATRate ?? 20,
                ["AmountNet"] = expense.AmountNet ?? 0,
                ["VATAmount"] = expense.VATAmount ?? 0,
                ["AmountGross"] = expense.AmountGross ?? 0,
                ["PaymentMethod"] = expense.PaymentMethod ?? "Bank",
                ["Paid"] = true,
                ["DatePaid"] = expense.DatePaid?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["TaxYear"] = expense.TaxYear ?? "",
                ["FinancialYear"] = expense.FinancialYear ?? "",
                ["IsDLA"] = expense.IsDLA,
                ["Notes"] = expense.Notes ?? ""
            };

            if (!string.IsNullOrEmpty(supplierLookupId))
            {
                data["SupplierId"] = supplierLookupId;
            }
            else if (!string.IsNullOrEmpty(expense.SupplierFreeText))
            {
                data["SupplierFreeText"] = expense.SupplierFreeText;
            }
            else if (!string.IsNullOrEmpty(expense.Supplier))
            {
                data["SupplierFreeText"] = expense.Supplier;
            }

            if (!string.IsNullOrEmpty(expense.ReceiptUrl))
            {
                data["RelatedDocument"] = new { Url = expense.ReceiptUrl, Description = "Receipt" };
            }

            var request = new HttpRequestMessage(HttpMethod.Patch, $"{_siteUrl}/_api/web/lists/getbytitle('Expenses')/items({id})");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.Add("IF-MATCH", "*");
            request.Content = new StringContent(JsonSerializer.Serialize(data), Encoding.UTF8, "application/json");

            var response = await _httpClient.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                var responseContent = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to update expense: {response.StatusCode} - {responseContent}");
            }

            return true;
        }

        public async Task<List<string>> GetCategories(string accessToken)
        {
            // Return predefined categories from SharePoint list field definition
            // These match the choices defined in the provisioning script
            var predefinedCategories = new List<string>
            {
                "Sales",
                "Equipment",
                "Software",
                "Cloud Services",
                "Fuel",
                "Travel",
                "Insurance",
                "Professional Fees",
                "Subsistence",
                "Client Entertainment",
                "Client Gifts",
                "Staff Entertainment",
                "Staff Entertainment (PSA)",
                "Other"
            };

            return predefinedCategories;
        }

        public async Task<List<string>> GetVATApplicabilities(string accessToken)
        {
            // Return predefined VAT Applicability choices from SharePoint list field definition
            var predefinedChoices = new List<string>
            {
                "Standard",
                "Reduced",
                "Zero-rated",
                "Exempt",
                "Outside Scope",
                "Reverse Charge"
            };

            return predefinedChoices;
        }

        public async Task<List<string>> GetPaymentMethods(string accessToken)
        {
            // Return predefined Payment Method choices from SharePoint list field definition
            var predefinedChoices = new List<string>
            {
                "Bank",
                "Card",
                "Cash",
                "DLA",
                "Other"
            };

            return predefinedChoices;
        }

        public async Task<bool> UploadReceiptAttachment(int itemId, byte[] fileContent, string fileName, string accessToken)
        {
            Console.WriteLine($"UploadReceiptAttachment: Starting upload for item {itemId}, file: {fileName}");
            
            var token = await GetAppOnlyToken();
            Console.WriteLine($"UploadReceiptAttachment: Got app-only token (length: {token?.Length})");
            
            // Get the expense ID directly using app token
            var getExpenseEndpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Expenses')/items({itemId})?$select=Title";
            var getRequest = new HttpRequestMessage(HttpMethod.Get, getExpenseEndpoint);
            getRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            getRequest.Headers.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
            
            var getResponse = await _httpClient.SendAsync(getRequest);
            if (getResponse.IsSuccessStatusCode)
            {
                var getContent = await getResponse.Content.ReadAsStringAsync();
                var getJson = JsonDocument.Parse(getContent);
                if (getJson.RootElement.TryGetProperty("d", out var dProp) && dProp.TryGetProperty("Title", out var title))
                {
                    var expenseId = GetStringValue(title);
                    Console.WriteLine($"UploadReceiptAttachment: Expense ID = {expenseId}");
                    
                    if (!string.IsNullOrEmpty(expenseId))
                    {
                        var extension = Path.GetExtension(fileName);
                        fileName = $"{expenseId}-Receipt{extension}";
                        Console.WriteLine($"UploadReceiptAttachment: Renamed file to: {fileName}");
                    }
                }
            }
            
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Expenses')/items({itemId})/AttachmentFiles/add(FileName='{Uri.EscapeDataString(fileName)}')";
            Console.WriteLine($"UploadReceiptAttachment: Endpoint = {endpoint}");

            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new ByteArrayContent(fileContent);

            Console.WriteLine($"UploadReceiptAttachment: Sending request with {fileContent.Length} bytes");
            var response = await _httpClient.SendAsync(request);
            var responseContent = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"UploadReceiptAttachment: Response status = {response.StatusCode}");
            Console.WriteLine($"UploadReceiptAttachment: Response body = {responseContent}");

            if (!response.IsSuccessStatusCode)
            {
                var errorMsg = $"Failed to upload attachment: {response.StatusCode} - {responseContent}";
                Console.WriteLine($"UploadReceiptAttachment: ERROR - {errorMsg}");
                throw new Exception(errorMsg);
            }

            Console.WriteLine("UploadReceiptAttachment: Upload successful");
            return true;
        }

        public async Task<List<string>> GetExpenseAttachments(int itemId, string accessToken)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"web/lists/getbytitle('Expenses')/items({itemId})/AttachmentFiles";
            
            try
            {
                var result = await GetFromSharePoint<JsonElement>(endpoint, accessToken);
                
                if (!result.TryGetProperty("d", out var dProp) || !dProp.TryGetProperty("results", out var results))
                {
                    return new List<string>();
                }

                var attachments = new List<string>();
                foreach (var item in results.EnumerateArray())
                {
                    if (item.TryGetProperty("ServerRelativeUrl", out var url))
                    {
                        attachments.Add(url.GetString());
                    }
                }

                return attachments;
            }
            catch
            {
                return new List<string>();
            }
        }

        public async Task<bool> EnableListAttachments(string listTitle)
        {
            try
            {
                Console.WriteLine($"EnableListAttachments: Enabling attachments for list '{listTitle}'");
                
                var token = await GetAppOnlyToken();
                Console.WriteLine($"EnableListAttachments: Got app-only token (length: {token?.Length})");

                var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('{listTitle}')";
                Console.WriteLine($"EnableListAttachments: Endpoint = {endpoint}");

                var data = new Dictionary<string, object>
                {
                    ["EnableAttachments"] = true
                };

                var request = new HttpRequestMessage(HttpMethod.Patch, endpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                request.Headers.Add("IF-MATCH", "*");
                request.Headers.Add("X-HTTP-Method", "MERGE");
                request.Content = new StringContent(
                    JsonSerializer.Serialize(data),
                    Encoding.UTF8,
                    "application/json"
                );

                Console.WriteLine($"EnableListAttachments: Sending PATCH request...");
                var response = await _httpClient.SendAsync(request);
                var responseContent = await response.Content.ReadAsStringAsync();
                
                Console.WriteLine($"EnableListAttachments: Response status = {response.StatusCode}");
                Console.WriteLine($"EnableListAttachments: Response body = {responseContent}");

                if (!response.IsSuccessStatusCode)
                {
                    var errorMsg = $"Failed to enable attachments: {response.StatusCode} - {responseContent}";
                    Console.WriteLine($"EnableListAttachments: ERROR - {errorMsg}");
                    throw new Exception(errorMsg);
                }

                Console.WriteLine("EnableListAttachments: Attachments enabled successfully");
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"EnableListAttachments: Exception - {ex.Message}");
                throw;
            }
        }

        public async Task<bool> DeleteAttachment(int itemId, string fileName)
        {
            try
            {
                Console.WriteLine($"DeleteAttachment: Deleting attachment '{fileName}' from item {itemId}");
                
                var token = await GetAppOnlyToken();
                var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Expenses')/items({itemId})/AttachmentFiles('{Uri.EscapeDataString(fileName)}')";
                Console.WriteLine($"DeleteAttachment: Endpoint = {endpoint}");

                var request = new HttpRequestMessage(HttpMethod.Delete, endpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                request.Headers.Add("IF-MATCH", "*");

                var response = await _httpClient.SendAsync(request);
                Console.WriteLine($"DeleteAttachment: Response status = {response.StatusCode}");

                if (!response.IsSuccessStatusCode)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    throw new Exception($"Failed to delete attachment: {response.StatusCode} - {responseContent}");
                }

                Console.WriteLine("DeleteAttachment: Attachment deleted successfully");
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"DeleteAttachment: Exception - {ex.Message}");
                throw;
            }
        }

        // ==================== Invoice Methods ====================
        
        public async Task<List<Invoice>> GetInvoicesAsync()
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Invoices')/items?$select=Id,InvoiceNumber,InvCustomer/Title,InvCustomer/Id,InvCustomerId,POReference,InvDateIssued,DueDate,InvDatePaid,InvStatus,InvAmountNet,DiscountPercent,DiscountAmount,DiscountNote,InvVATAmount,InvAmountGross,TaxYear,FinancialYear,LineItemsJSON&$expand=InvCustomer";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to get invoices: {response.StatusCode} - {content}");
            }

            var jsonDoc = JsonDocument.Parse(content);
            var results = jsonDoc.RootElement.GetProperty("d").GetProperty("results");
            
            var invoices = new List<Invoice>();
            foreach (var item in results.EnumerateArray())
            {
                var invoice = new Invoice
                {
                    Id = item.TryGetProperty("Id", out var id) ? id.GetInt32() : 0,
                    InvoiceNumber = item.TryGetProperty("InvoiceNumber", out var invNum) ? invNum.GetString() : string.Empty,
                    BillingEmail = null, // Retrieved from customer when needed
                    POReference = item.TryGetProperty("POReference", out var po) && po.ValueKind == JsonValueKind.String ? po.GetString() : null,
                    DateIssued = item.TryGetProperty("InvDateIssued", out var dateIssued) && dateIssued.ValueKind == JsonValueKind.String 
                        ? DateTime.Parse(dateIssued.GetString()) : DateTime.Now,
                    DueDate = item.TryGetProperty("DueDate", out var dueDate) && dueDate.ValueKind == JsonValueKind.String 
                        ? DateTime.Parse(dueDate.GetString()) : null,
                    DatePaid = item.TryGetProperty("InvDatePaid", out var datePaid) && datePaid.ValueKind == JsonValueKind.String 
                        ? DateTime.Parse(datePaid.GetString()) : null,
                    Status = item.TryGetProperty("InvStatus", out var status) && status.ValueKind == JsonValueKind.String ? status.GetString() : "Draft",
                    AmountNet = item.TryGetProperty("InvAmountNet", out var net) && net.ValueKind == JsonValueKind.Number 
                        ? net.GetDecimal() : 0,
                    DiscountPercent = item.TryGetProperty("DiscountPercent", out var discPct) && discPct.ValueKind == JsonValueKind.Number 
                        ? discPct.GetDecimal() : null,
                    DiscountAmount = item.TryGetProperty("DiscountAmount", out var discAmt) && discAmt.ValueKind == JsonValueKind.Number 
                        ? discAmt.GetDecimal() : null,
                    DiscountNote = item.TryGetProperty("DiscountNote", out var discNote) ? discNote.GetString() : null,
                    VATAmount = item.TryGetProperty("InvVATAmount", out var vat) && vat.ValueKind == JsonValueKind.Number 
                        ? vat.GetDecimal() : 0,
                    AmountGross = item.TryGetProperty("InvAmountGross", out var gross) && gross.ValueKind == JsonValueKind.Number 
                        ? gross.GetDecimal() : 0,
                    TaxYear = item.TryGetProperty("TaxYear", out var taxYear) && taxYear.ValueKind == JsonValueKind.Number ? taxYear.GetInt32() : null,
                    FinancialYear = item.TryGetProperty("FinancialYear", out var fy) ? fy.GetString() : null
                };

                // Get Customer ID from lookup
                if (item.TryGetProperty("InvCustomerId", out var custId))
                {
                    invoice.CustomerId = custId.GetInt32().ToString();
                }
                
                // Get Customer Name from expanded lookup
                if (item.TryGetProperty("InvCustomer", out var customer) && customer.ValueKind == JsonValueKind.Object)
                {
                    if (customer.TryGetProperty("Title", out var custName))
                    {
                        invoice.CustomerName = custName.GetString();
                    }
                }

                // Parse line items from JSON
                if (item.TryGetProperty("LineItemsJSON", out var lineItemsJson) && lineItemsJson.ValueKind == JsonValueKind.String)
                {
                    var lineItemsStr = lineItemsJson.GetString();
                    if (!string.IsNullOrEmpty(lineItemsStr))
                    {
                        invoice.LineItems = JsonSerializer.Deserialize<List<InvoiceLine>>(lineItemsStr);
                    }
                }

                invoices.Add(invoice);
            }

            return invoices;
        }

        public async Task<Invoice> GetInvoiceByIdAsync(int id)
        {
            var invoices = await GetInvoicesAsync();
            return invoices.FirstOrDefault(i => i.Id == id);
        }

        public async Task<Customer> GetCustomerByIdAsync(int id)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Customers')/items({id})";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to get customer: {response.StatusCode} - {content}");
            }

            var jsonDoc = JsonDocument.Parse(content);
            var item = jsonDoc.RootElement.GetProperty("d");
            
            return new Customer
            {
                Id = item.TryGetProperty("Id", out var custId) ? custId.GetInt32().ToString() : string.Empty,
                CustomerName = item.TryGetProperty("Title", out var title) ? title.GetString() : string.Empty,
                Name = item.TryGetProperty("Title", out var name) ? name.GetString() : string.Empty,
                CustomerCode = item.TryGetProperty("CustomerCode", out var code) ? code.GetString() : string.Empty,
                Email = item.TryGetProperty("Email", out var email) ? email.GetString() : string.Empty,
                BillingEmail = item.TryGetProperty("BillingEmail", out var billEmail) ? billEmail.GetString() : null,
                BillingAddress = item.TryGetProperty("BillingAddress", out var billAddr) ? billAddr.GetString() : null,
                IsVATRegistered = item.TryGetProperty("IsVATRegistered", out var vatReg) && vatReg.ValueKind == JsonValueKind.True,
                DefaultVATRate = item.TryGetProperty("DefaultVATRate", out var vatRate) && vatRate.ValueKind == JsonValueKind.Number 
                    ? vatRate.GetInt32() : null
            };
        }

        public async Task<Invoice> CreateInvoiceAsync(Invoice invoice)
        {
            var token = await GetAppOnlyToken();
            
            // Serialize line items to JSON
            var lineItemsJson = JsonSerializer.Serialize(invoice.LineItems);
            
            // Calculate DueDate if not set (30 days from issue date)
            if (!invoice.DueDate.HasValue)
            {
                invoice.DueDate = invoice.DateIssued.AddDays(30);
            }

            // Get the correct entity type name from SharePoint
            var entityType = await GetListItemEntityType("Invoices", token);
            _logger.LogInformation($"Retrieved entity type for Invoices list: {entityType}");

            int? spCustomerId = null;
            if (!string.IsNullOrWhiteSpace(invoice.CustomerId) && int.TryParse(invoice.CustomerId, out var parsedCustomerId))
            {
                spCustomerId = parsedCustomerId;
            }

            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = entityType },
                ["Title"] = invoice.InvoiceNumber, // Use InvoiceNumber as Title (unique and required)
                ["InvoiceNumber"] = invoice.InvoiceNumber,
                ["InvCustomerId"] = spCustomerId,
                ["POReference"] = invoice.POReference,
                ["InvDateIssued"] = invoice.DateIssued.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["DueDate"] = invoice.DueDate?.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["InvStatus"] = invoice.Status,
                ["InvAmountNet"] = invoice.AmountNet,
                ["DiscountPercent"] = invoice.DiscountPercent,
                ["DiscountAmount"] = invoice.DiscountAmount,
                ["DiscountNote"] = invoice.DiscountNote,
                ["InvVATAmount"] = invoice.VATAmount,
                ["InvAmountGross"] = invoice.AmountGross,
                ["TaxYear"] = invoice.TaxYear?.ToString() ?? string.Empty,
                ["FinancialYear"] = invoice.FinancialYear,
                ["LineItemsJSON"] = lineItemsJson
            };

            // POST the new invoice
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Invoices')/items";
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Content = new StringContent(
                JsonSerializer.Serialize(data), 
                Encoding.UTF8, 
                "application/json");
            request.Content.Headers.ContentType.Parameters.Add(new System.Net.Http.Headers.NameValueHeaderValue("odata", "verbose"));

            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to create invoice: {response.StatusCode} - {errorBody}");
            }
            
            var responseBody = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseBody);
            var result = jsonDoc.RootElement.GetProperty("d");
            invoice.Id = result.GetProperty("Id").GetInt32();
            
            return invoice;
        }

        public async Task UpdateInvoiceAsync(Invoice invoice)
        {
            var token = await GetAppOnlyToken();
            
            // Serialize line items to JSON
            var lineItemsJson = JsonSerializer.Serialize(invoice.LineItems);
            
            int? spCustomerId = null;
            if (!string.IsNullOrWhiteSpace(invoice.CustomerId) && int.TryParse(invoice.CustomerId, out var parsedCustomerId))
            {
                spCustomerId = parsedCustomerId;
            }

            var data = new Dictionary<string, object>
            {
                ["Title"] = invoice.InvoiceNumber, // Use InvoiceNumber as Title (unique and required)
                ["InvoiceNumber"] = invoice.InvoiceNumber,
                ["InvCustomerId"] = spCustomerId,
                ["POReference"] = invoice.POReference,
                ["InvDateIssued"] = invoice.DateIssued.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["InvStatus"] = invoice.Status,
                ["InvAmountNet"] = invoice.AmountNet,
                ["DiscountPercent"] = invoice.DiscountPercent,
                ["DiscountAmount"] = invoice.DiscountAmount,
                ["DiscountNote"] = invoice.DiscountNote,
                ["InvVATAmount"] = invoice.VATAmount,
                ["InvAmountGross"] = invoice.AmountGross,
                ["TaxYear"] = invoice.TaxYear?.ToString() ?? string.Empty,
                ["FinancialYear"] = invoice.FinancialYear,
                ["LineItemsJSON"] = lineItemsJson
            };
            
            // Only add DueDate if it has a value
            if (invoice.DueDate.HasValue)
            {
                data["DueDate"] = invoice.DueDate.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            }
            
            // Only add DatePaid if it has a value
            if (invoice.DatePaid.HasValue)
            {
                data["InvDatePaid"] = invoice.DatePaid.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            }

            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Invoices')/items({invoice.Id})";
            await MergeToSharePoint(endpoint, data, token);
        }

        public async Task DeleteInvoiceAsync(int id)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Invoices')/items({id})";
            
            var request = new HttpRequestMessage(HttpMethod.Delete, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "DELETE");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to delete invoice: {response.StatusCode} - {content}");
            }
        }

        public async Task AttachPdfToInvoiceAsync(int invoiceId, string fileName, byte[] pdfBytes)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Invoices')/items({invoiceId})/AttachmentFiles/add(FileName='{Uri.EscapeDataString(fileName)}')";
            
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new ByteArrayContent(pdfBytes);
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to attach PDF: {response.StatusCode} - {content}");
            }
        }

        public async Task SendInvoiceEmailAsync(Invoice invoice, Customer customer, CompanySettings company, byte[] pdfBytes)
        {
            _logger.LogInformation($"Sending invoice email for {invoice.InvoiceNumber} to {customer.BillingEmail ?? customer.Email}");

            try
            {
                // Use Microsoft Graph to send email
                var credential = new ManagedIdentityCredential();
                var graphClient = new Microsoft.Graph.GraphServiceClient(credential);

                var recipientEmail = customer.BillingEmail ?? customer.Email;
                if (string.IsNullOrEmpty(recipientEmail))
                {
                    throw new Exception("Customer does not have a billing email or email address");
                }

                var message = new Microsoft.Graph.Models.Message
                {
                    Subject = $"Invoice {invoice.InvoiceNumber} from {company.CompanyName}",
                    Body = new Microsoft.Graph.Models.ItemBody
                    {
                        ContentType = Microsoft.Graph.Models.BodyType.Html,
                        Content = $@"
                            <p>Dear {customer.CustomerName},</p>
                            <p>Please find attached invoice {invoice.InvoiceNumber} for £{invoice.AmountGross:F2}.</p>
                            <p><strong>Invoice Details:</strong></p>
                            <ul>
                                <li>Invoice Number: {invoice.InvoiceNumber}</li>
                                <li>Date Issued: {invoice.DateIssued:dd/MM/yyyy}</li>
                                <li>Due Date: {invoice.DueDate:dd/MM/yyyy}</li>
                                <li>Amount: £{invoice.AmountGross:F2}</li>
                            </ul>
                            {(!string.IsNullOrEmpty(company.PaymentsEmail) ? $"<p>For payment queries, please contact: <a href='mailto:{company.PaymentsEmail}'>{company.PaymentsEmail}</a></p>" : "")}
                            <p>Best regards,<br/>{company.CompanyName}</p>
                        "
                    },
                    ToRecipients = new List<Microsoft.Graph.Models.Recipient>
                    {
                        new Microsoft.Graph.Models.Recipient
                        {
                            EmailAddress = new Microsoft.Graph.Models.EmailAddress
                            {
                                Address = recipientEmail,
                                Name = customer.CustomerName
                            }
                        }
                    },
                    Attachments = new List<Microsoft.Graph.Models.Attachment>
                    {
                        new Microsoft.Graph.Models.FileAttachment
                        {
                            Name = $"{invoice.InvoiceNumber}.pdf",
                            ContentBytes = pdfBytes,
                            ContentType = "application/pdf"
                        }
                    }
                };

                // Send from the company's invoices email or main email
                var fromEmail = company.InvoicesEmail ?? company.Email ?? company.CompanyEmail;
                if (string.IsNullOrEmpty(fromEmail))
                {
                    throw new Exception("Company does not have an invoices email or company email configured");
                }

                _logger.LogInformation($"Attempting to send email from: {fromEmail} to: {recipientEmail}");

                try
                {
                    await graphClient.Users[fromEmail].SendMail.PostAsync(new Microsoft.Graph.Users.Item.SendMail.SendMailPostRequestBody
                    {
                        Message = message,
                        SaveToSentItems = true
                    });

                    _logger.LogInformation($"Invoice email sent successfully to {recipientEmail}");
                }
                catch (Microsoft.Graph.Models.ODataErrors.ODataError odataError)
                {
                    _logger.LogError($"Graph API error sending email: {odataError.Error?.Code} - {odataError.Error?.Message}");
                    throw new Exception($"Failed to send email: {odataError.Error?.Message}. Ensure Managed Identity has Mail.Send permission for mailbox {fromEmail}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error sending invoice email: {ex.Message}");
                throw;
            }
        }

        public async Task<string> GetNextInvoiceNumberAsync()
        {
            var token = await GetAppOnlyToken();
            var settings = await GetCompanySettings(token);
            var currentNumber = settings.NextInvoiceNumber ?? 1;
            var prefix = settings.InvoicePrefix ?? "INV";
            
            var nextNumber = $"{prefix}{currentNumber:D4}";
            
            // Update next invoice number in settings
            settings.NextInvoiceNumber = currentNumber + 1;
            await UpdateCompanySettings(settings, token);
            
            return nextNumber;
        }

        // ==============================================
        // Quote Methods
        // ==============================================

        public async Task<List<Quote>> GetQuotesAsync()
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Quotes')/items?$select=Id,QuoteNumber,QuoteCustomer/Title,QuoteCustomer/Id,QuoteCustomerId,QuoteDateIssued,QuoteValidUntil,QuoteStatus,QuoteAmountNet,QuoteDiscountPercent,QuoteDiscountAmount,QuoteDiscountNote,QuoteVATAmount,QuoteAmountGross,TaxYear,FinancialYear,LineItemsJSON&$expand=QuoteCustomer";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to get quotes: {response.StatusCode} - {content}");
            }

            var jsonDoc = JsonDocument.Parse(content);
            var results = jsonDoc.RootElement.GetProperty("d").GetProperty("results");
            
            var quotes = new List<Quote>();
            foreach (var item in results.EnumerateArray())
            {
                var quote = ParseQuoteFromJson(item);
                quotes.Add(quote);
            }

            return quotes;
        }

        public async Task<Quote> GetQuoteByIdAsync(int id)
        {
            var quotes = await GetQuotesAsync();
            return quotes.FirstOrDefault(q => q.Id == id);
        }

        private Quote ParseQuoteFromJson(JsonElement item)
        {
            var quote = new Quote
            {
                Id = item.TryGetProperty("Id", out var id) ? id.GetInt32() : 0,
                QuoteNumber = item.TryGetProperty("QuoteNumber", out var quoteNum) ? quoteNum.GetString() : string.Empty,
                BillingEmail = null, // Retrieved from customer record when needed
                DateIssued = item.TryGetProperty("QuoteDateIssued", out var dateIssued) && dateIssued.ValueKind == JsonValueKind.String 
                    ? DateTime.Parse(dateIssued.GetString()) : DateTime.Now,
                ValidUntil = item.TryGetProperty("QuoteValidUntil", out var validUntil) && validUntil.ValueKind == JsonValueKind.String 
                    ? DateTime.Parse(validUntil.GetString()) : null,
                Status = item.TryGetProperty("QuoteStatus", out var status) ? status.GetString() : "Draft",
                AmountNet = item.TryGetProperty("QuoteAmountNet", out var net) && net.ValueKind == JsonValueKind.Number 
                    ? net.GetDecimal() : 0,
                DiscountPercent = item.TryGetProperty("QuoteDiscountPercent", out var discPct) && discPct.ValueKind == JsonValueKind.Number 
                    ? discPct.GetDecimal() : null,
                DiscountAmount = item.TryGetProperty("QuoteDiscountAmount", out var discAmt) && discAmt.ValueKind == JsonValueKind.Number 
                    ? discAmt.GetDecimal() : null,
                DiscountNote = item.TryGetProperty("QuoteDiscountNote", out var discNote) ? discNote.GetString() : null,
                VATAmount = item.TryGetProperty("QuoteVATAmount", out var vat) && vat.ValueKind == JsonValueKind.Number 
                    ? vat.GetDecimal() : 0,
                AmountGross = item.TryGetProperty("QuoteAmountGross", out var gross) && gross.ValueKind == JsonValueKind.Number 
                    ? gross.GetDecimal() : 0,
                TaxYear = item.TryGetProperty("TaxYear", out var taxYear) && taxYear.ValueKind == JsonValueKind.Number 
                    ? taxYear.GetInt32() : 0,
                FinancialYear = item.TryGetProperty("FinancialYear", out var finYear) ? finYear.GetString() : null,
                LinkedInvoiceId = null // Will be set via separate method when converting quote to invoice
            };

            // Get Customer ID from lookup (QuoteCustomerId is the ID field for QuoteCustomer lookup)
            if (item.TryGetProperty("QuoteCustomerId", out var custId))
            {
                if (custId.ValueKind == JsonValueKind.Number)
                {
                    quote.CustomerId = custId.GetInt32().ToString();
                }
                else if (custId.ValueKind == JsonValueKind.String)
                {
                    quote.CustomerId = custId.GetString();
                }
            }
            
            // Get Customer Name from expanded lookup
            if (item.TryGetProperty("QuoteCustomer", out var custLookup) && custLookup.ValueKind == JsonValueKind.Object)
            {
                if (custLookup.TryGetProperty("Title", out var custName))
                {
                    quote.CustomerName = custName.GetString();
                }
            }

            // LinkedInvoiceId - field doesn't exist in SharePoint, will be set via separate method when converting quote to invoice
            quote.LinkedInvoiceId = null;

            // Parse line items from JSON
            if (item.TryGetProperty("LineItemsJSON", out var lineItemsJson) && lineItemsJson.ValueKind == JsonValueKind.String)
            {
                var lineItemsStr = lineItemsJson.GetString();
                if (!string.IsNullOrEmpty(lineItemsStr))
                {
                    quote.LineItems = JsonSerializer.Deserialize<List<QuoteLine>>(lineItemsStr);
                }
            }

            return quote;
        }

        public async Task<Quote> CreateQuoteAsync(Quote quote)
        {
            var token = await GetAppOnlyToken();
            
            // Serialize line items to JSON
            var lineItemsJson = JsonSerializer.Serialize(quote.LineItems);
            
            // Calculate ValidUntil if not set (30 days from issue date)
            if (!quote.ValidUntil.HasValue)
            {
                quote.ValidUntil = quote.DateIssued.AddDays(30);
            }

            // Get the correct entity type name from SharePoint
            var entityType = await GetListItemEntityType("Quotes", token);
            _logger.LogInformation($"Retrieved entity type for Quotes list: {entityType}");

            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = entityType },
                ["Title"] = quote.QuoteNumber,
                ["QuoteNumber"] = quote.QuoteNumber,
                ["QuoteCustomerId"] = quote.CustomerId,
                ["QuoteDateIssued"] = quote.DateIssued.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["QuoteValidUntil"] = quote.ValidUntil?.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["QuoteStatus"] = quote.Status,
                ["QuoteAmountNet"] = quote.AmountNet,
                ["QuoteDiscountPercent"] = quote.DiscountPercent ?? 0,
                ["QuoteDiscountAmount"] = quote.DiscountAmount ?? 0,
                ["QuoteDiscountNote"] = quote.DiscountNote ?? string.Empty,
                ["QuoteVATAmount"] = quote.VATAmount,
                ["QuoteAmountGross"] = quote.AmountGross,
                ["TaxYear"] = quote.TaxYear.ToString(),
                ["FinancialYear"] = quote.FinancialYear ?? string.Empty,
                ["LineItemsJSON"] = lineItemsJson
            };

            // POST the new quote
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Quotes')/items";
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Content = new StringContent(
                JsonSerializer.Serialize(data), 
                Encoding.UTF8, 
                "application/json");
            request.Content.Headers.ContentType.Parameters.Add(new System.Net.Http.Headers.NameValueHeaderValue("odata", "verbose"));

            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to create quote: {response.StatusCode} - {errorBody}");
            }
            
            var responseBody = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseBody);
            var result = jsonDoc.RootElement.GetProperty("d");
            quote.Id = result.GetProperty("Id").GetInt32();
            
            return quote;
        }

        public async Task UpdateQuoteAsync(Quote quote)
        {
            var token = await GetAppOnlyToken();
            
            // Serialize line items to JSON
            var lineItemsJson = JsonSerializer.Serialize(quote.LineItems);
            
            var data = new Dictionary<string, object>
            {
                ["Title"] = quote.QuoteNumber,
                ["QuoteNumber"] = quote.QuoteNumber,
                ["QuoteCustomerId"] = quote.CustomerId,
                ["QuoteDateIssued"] = quote.DateIssued.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["QuoteValidUntil"] = quote.ValidUntil?.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["QuoteStatus"] = quote.Status,
                ["QuoteAmountNet"] = quote.AmountNet,
                ["QuoteDiscountPercent"] = quote.DiscountPercent ?? 0,
                ["QuoteDiscountAmount"] = quote.DiscountAmount ?? 0,
                ["QuoteDiscountNote"] = quote.DiscountNote ?? string.Empty,
                ["QuoteVATAmount"] = quote.VATAmount,
                ["QuoteAmountGross"] = quote.AmountGross,
                ["TaxYear"] = quote.TaxYear.ToString(),
                ["FinancialYear"] = quote.FinancialYear ?? string.Empty,
                ["LineItemsJSON"] = lineItemsJson
            };

            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Quotes')/items({quote.Id})";
            await MergeToSharePoint(endpoint, data, token);
        }

        public async Task DeleteQuoteAsync(int id)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Quotes')/items({id})";
            
            var request = new HttpRequestMessage(HttpMethod.Delete, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "DELETE");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to delete quote: {response.StatusCode} - {content}");
            }
        }

        public async Task AttachPdfToQuoteAsync(int quoteId, string fileName, byte[] pdfBytes)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Quotes')/items({quoteId})/AttachmentFiles/add(FileName='{Uri.EscapeDataString(fileName)}')";
            
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new ByteArrayContent(pdfBytes);
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to attach PDF: {response.StatusCode} - {content}");
            }
        }

        public async Task<string> GetNextQuoteNumberAsync()
        {
            var token = await GetAppOnlyToken();
            
            // Get all quotes to find the highest number for today
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Quotes')/items?$select=QuoteNumber&$orderby=Created desc&$top=100";
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            var today = DateTime.Now.ToString("yyyyMMdd");
            var prefix = $"QUO-{today}-";
            var maxNumber = 0;

            if (response.IsSuccessStatusCode)
            {
                var jsonDoc = JsonDocument.Parse(content);
                var results = jsonDoc.RootElement.GetProperty("d").GetProperty("results");
                
                foreach (var item in results.EnumerateArray())
                {
                    if (item.TryGetProperty("QuoteNumber", out var quoteNumProp))
                    {
                        var quoteNum = quoteNumProp.GetString();
                        if (!string.IsNullOrEmpty(quoteNum) && quoteNum.StartsWith(prefix))
                        {
                            var numPart = quoteNum.Substring(prefix.Length);
                            if (int.TryParse(numPart, out var num))
                            {
                                maxNumber = Math.Max(maxNumber, num);
                            }
                        }
                    }
                }
            }

            var nextNumber = $"{prefix}{(maxNumber + 1):D3}";
            return nextNumber;
        }

        // ============= Company Ledger Methods =============

        public async Task<List<CompanyLedgerEntry>> GetCompanyLedgerAsync(string periodKey)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('CompanyLedger')/items?$filter=PeriodKey eq '{periodKey}'&$select=ID,Title,CompanyEntryType,Amount,EffectiveDate,Notes,PeriodKey,TaxYear,FinancialYear";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to get company ledger entries: {response.StatusCode} - {content}");
            }

            var jsonDoc = JsonDocument.Parse(content);
            var results = jsonDoc.RootElement.GetProperty("d").GetProperty("results");
            
            var entries = new List<CompanyLedgerEntry>();
            foreach (var item in results.EnumerateArray())
            {
                var entry = new CompanyLedgerEntry
                {
                    Id = item.TryGetProperty("ID", out var id) ? id.GetInt32() : 0,
                    Title = item.TryGetProperty("Title", out var title) ? title.GetString() : string.Empty,
                    EntryType = item.TryGetProperty("CompanyEntryType", out var entryType) ? entryType.GetString() : string.Empty,
                    Amount = item.TryGetProperty("Amount", out var amount) && amount.ValueKind == JsonValueKind.Number 
                        ? amount.GetDecimal() : 0,
                    EffectiveDate = item.TryGetProperty("EffectiveDate", out var effDate) && effDate.ValueKind == JsonValueKind.String 
                        ? DateTime.Parse(effDate.GetString()) : DateTime.Now,
                    Notes = item.TryGetProperty("Notes", out var notes) ? notes.GetString() : null,
                    PeriodKey = item.TryGetProperty("PeriodKey", out var pk) ? pk.GetString() : string.Empty,
                    TaxYear = item.TryGetProperty("TaxYear", out var ty) && ty.ValueKind == JsonValueKind.Number 
                        ? ty.GetInt32() : DateTime.Now.Year,
                    FinancialYear = item.TryGetProperty("FinancialYear", out var fy) ? fy.GetString() : null
                };
                entries.Add(entry);
            }

            return entries;
        }

        public async Task<CompanyLedgerEntry> CreateCompanyLedgerEntryAsync(CompanyLedgerEntry entry)
        {
            var token = await GetAppOnlyToken();
            
            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = "SP.Data.CompanyLedgerListItem" },
                ["Title"] = entry.Title ?? entry.EntryType,
                ["CompanyEntryType"] = entry.EntryType,
                ["Amount"] = entry.Amount,
                ["EffectiveDate"] = entry.EffectiveDate.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                ["Notes"] = entry.Notes,
                ["PeriodKey"] = entry.PeriodKey,
                ["TaxYear"] = entry.TaxYear,
                ["FinancialYear"] = entry.FinancialYear
            };

            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('CompanyLedger')/items";
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Content = new StringContent(
                JsonSerializer.Serialize(data), 
                Encoding.UTF8, 
                "application/json");
            request.Content.Headers.ContentType.Parameters.Add(new System.Net.Http.Headers.NameValueHeaderValue("odata", "verbose"));

            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to create company ledger entry: {response.StatusCode} - {errorBody}");
            }
            
            var responseBody = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseBody);
            var result = jsonDoc.RootElement.GetProperty("d");
            entry.Id = result.GetProperty("ID").GetInt32();
            
            return entry;
        }

        public async Task<CompanyAggregates> GetCompanyAggregatesAsync(string periodKey)
        {
            var entries = await GetCompanyLedgerAsync(periodKey);
            
            var aggregates = new CompanyAggregates();
            
            foreach (var entry in entries)
            {
                switch (entry.EntryType)
                {
                    case "Salary":
                        aggregates.SalaryGross += entry.Amount;
                        break;
                    case "EmployeeNI":
                        aggregates.EmployeeNI += entry.Amount;
                        break;
                    case "EmployerNI":
                        aggregates.EmployerNI += entry.Amount;
                        break;
                    case "PAYE":
                        aggregates.PayeRemitted += entry.Amount;
                        break;
                    case "CorpTax_Reserve":
                        aggregates.CorpTaxReserved += entry.Amount;
                        break;
                    case "CorpTax_Paid":
                        aggregates.CorpTaxPaid += entry.Amount;
                        break;
                    case "Dividend_Declared":
                        aggregates.DividendsDeclared += entry.Amount;
                        break;
                    case "Dividend_Paid":
                        aggregates.DividendsPaid += entry.Amount;
                        break;
                    case "DLA_In":
                        aggregates.DlaNet += entry.Amount;
                        break;
                    case "DLA_Out":
                        aggregates.DlaNet -= entry.Amount;
                        break;
                }
            }
            
            return aggregates;
        }

        public async Task DeleteCompanyLedgerEntryAsync(int id)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('CompanyLedger')/items({id})";
            
            var request = new HttpRequestMessage(HttpMethod.Delete, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "DELETE");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to delete company ledger entry: {response.StatusCode} - {content}");
            }
        }

        // ======================
        // SHAREHOLDERS
        // ======================
        public async Task<List<Shareholder>> GetShareholdersAsync()
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Shareholders')/items?$select=ID,Title,ShareholderType,ShareClass/Id,ShareClass/Title,IsActive,SharesOwned,ShareCertificateNumber,DateOfIssue,Email,Address,Notes&$expand=ShareClass&$top=5000";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to get shareholders: {response.StatusCode} - {content}");
            }

            var json = await response.Content.ReadAsStringAsync();
            var data = JsonDocument.Parse(json);
            var items = data.RootElement.GetProperty("d").GetProperty("results");

            var shareholders = new List<Shareholder>();
            foreach (var item in items.EnumerateArray())
            {
                shareholders.Add(ParseShareholderFromJson(item));
            }

            return shareholders;
        }

        public async Task<Shareholder> GetShareholderByIdAsync(int id)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Shareholders')/items({id})?$select=ID,Title,ShareholderType,ShareClass/Id,ShareClass/Title,IsActive,SharesOwned,ShareCertificateNumber,DateOfIssue,Email,Address,Notes&$expand=ShareClass";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var json = await response.Content.ReadAsStringAsync();
            var data = JsonDocument.Parse(json);
            var item = data.RootElement.GetProperty("d");

            return ParseShareholderFromJson(item);
        }

        private Shareholder ParseShareholderFromJson(JsonElement item)
        {
            return new Shareholder
            {
                Id = item.GetProperty("ID").GetInt32(),
                Name = item.TryGetProperty("Title", out var title) ? title.GetString() : null,
                ShareholderType = item.TryGetProperty("ShareholderType", out var type) ? type.GetString() : null,
                ShareClassId = item.TryGetProperty("ShareClass", out var shareClass) && shareClass.ValueKind == JsonValueKind.Object
                    ? shareClass.TryGetProperty("Id", out var scId) ? scId.GetInt32() : (int?)null
                    : null,
                ShareClassName = item.TryGetProperty("ShareClass", out var sc) && sc.ValueKind == JsonValueKind.Object
                    ? sc.TryGetProperty("Title", out var scTitle) ? scTitle.GetString() : null
                    : null,
                IsActive = item.TryGetProperty("IsActive", out var isActive) ? isActive.GetBoolean() : true,
                SharesOwned = item.TryGetProperty("SharesOwned", out var shares) ? shares.GetInt32() : 0,
                ShareCertificateNumber = item.TryGetProperty("ShareCertificateNumber", out var certNo) ? certNo.GetString() : null,
                DateOfIssue = item.TryGetProperty("DateOfIssue", out var doi) && doi.ValueKind != JsonValueKind.Null
                    ? DateTime.Parse(doi.GetString())
                    : null,
                Email = item.TryGetProperty("Email", out var email) ? email.GetString() : null,
                Address = item.TryGetProperty("Address", out var address) ? address.GetString() : null,
                Notes = item.TryGetProperty("Notes", out var notes) ? notes.GetString() : null
            };
        }

        public async Task<Shareholder> CreateShareholderAsync(Shareholder shareholder)
        {
            var token = await GetAppOnlyToken();
            
            // Auto-generate certificate number if not provided
            if (string.IsNullOrEmpty(shareholder.ShareCertificateNumber))
            {
                // Get all existing shareholders to find the next certificate number
                var existingShareholders = await GetShareholdersAsync();
                var maxCertNumber = 0;
                
                foreach (var sh in existingShareholders)
                {
                    if (!string.IsNullOrEmpty(sh.ShareCertificateNumber) && sh.ShareCertificateNumber.StartsWith("SC-"))
                    {
                        var parts = sh.ShareCertificateNumber.Split('-');
                        if (parts.Length == 3 && int.TryParse(parts[2], out var num))
                        {
                            maxCertNumber = Math.Max(maxCertNumber, num);
                        }
                    }
                }
                
                var year = DateTime.UtcNow.Year;
                shareholder.ShareCertificateNumber = $"SC-{year}-{(maxCertNumber + 1):D3}";
            }
            
            // Get the correct entity type name from SharePoint
            var entityType = await GetListItemEntityType("Shareholders", token);
            _logger.LogInformation($"Retrieved entity type for Shareholders list: {entityType}");
            
            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = entityType },
                ["Title"] = shareholder.Name,
                ["ShareholderType"] = shareholder.ShareholderType,
                ["IsActive"] = shareholder.IsActive,
                ["SharesOwned"] = shareholder.SharesOwned,
                ["ShareCertificateNumber"] = shareholder.ShareCertificateNumber ?? string.Empty,
                ["Email"] = shareholder.Email ?? string.Empty,
                ["Address"] = shareholder.Address ?? string.Empty,
                ["Notes"] = shareholder.Notes ?? string.Empty
            };

            if (shareholder.ShareClassId.HasValue && shareholder.ShareClassId.Value > 0)
            {
                data["ShareClassId"] = shareholder.ShareClassId.Value;
            }

            if (shareholder.DateOfIssue.HasValue)
            {
                data["DateOfIssue"] = shareholder.DateOfIssue.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            }

            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Shareholders')/items";
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Content = new StringContent(
                JsonSerializer.Serialize(data), 
                Encoding.UTF8, 
                "application/json");
            request.Content.Headers.ContentType.Parameters.Add(new System.Net.Http.Headers.NameValueHeaderValue("odata", "verbose"));

            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to create shareholder: {response.StatusCode} - {errorBody}");
            }

            var responseBody = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseBody);
            var result = jsonDoc.RootElement.GetProperty("d");
            shareholder.Id = result.GetProperty("Id").GetInt32();

            return await GetShareholderByIdAsync(shareholder.Id);
        }

        public async Task UpdateShareholderAsync(Shareholder shareholder)
        {
            var token = await GetAppOnlyToken();
            
            // Get the correct entity type name from SharePoint
            var entityType = await GetListItemEntityType("Shareholders", token);
            
            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = entityType },
                ["Title"] = shareholder.Name,
                ["ShareholderType"] = shareholder.ShareholderType,
                ["IsActive"] = shareholder.IsActive,
                ["SharesOwned"] = shareholder.SharesOwned,
                ["ShareCertificateNumber"] = shareholder.ShareCertificateNumber ?? string.Empty,
                ["Email"] = shareholder.Email ?? string.Empty,
                ["Address"] = shareholder.Address ?? string.Empty,
                ["Notes"] = shareholder.Notes ?? string.Empty
            };

            if (shareholder.ShareClassId.HasValue && shareholder.ShareClassId.Value > 0)
            {
                data["ShareClassId"] = shareholder.ShareClassId.Value;
            }

            if (shareholder.DateOfIssue.HasValue)
            {
                data["DateOfIssue"] = shareholder.DateOfIssue.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            }

            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Shareholders')/items({shareholder.Id})";
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "MERGE");
            
            var jsonContent = JsonSerializer.Serialize(data);
            request.Content = new StringContent(jsonContent, System.Text.Encoding.UTF8, "application/json");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to update shareholder: {response.StatusCode} - {content}");
            }
        }

        public async Task DeleteShareholderAsync(int id)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Shareholders')/items({id})";
            
            var request = new HttpRequestMessage(HttpMethod.Delete, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "DELETE");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to delete shareholder: {response.StatusCode} - {content}");
            }
        }

        // ======================
        // SHARE CLASSES
        // ======================
        public async Task<List<ShareClass>> GetShareClassesAsync()
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('ShareClasses')/items?$select=ID,Title,DisplayName,VotingRights,DividendPolicyNote,IsActive,Notes&$top=5000";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to get share classes: {response.StatusCode} - {content}");
            }

            var json = await response.Content.ReadAsStringAsync();
            var data = JsonDocument.Parse(json);
            var items = data.RootElement.GetProperty("d").GetProperty("results");

            var shareClasses = new List<ShareClass>();
            foreach (var item in items.EnumerateArray())
            {
                shareClasses.Add(new ShareClass
                {
                    Id = item.GetProperty("ID").GetInt32(),
                    Name = item.TryGetProperty("Title", out var title) ? title.GetString() : null,
                    DisplayName = item.TryGetProperty("DisplayName", out var displayName) ? displayName.GetString() : null,
                    VotingRights = item.TryGetProperty("VotingRights", out var votingRights) ? votingRights.GetString() : null,
                    DividendPolicyNote = item.TryGetProperty("DividendPolicyNote", out var dividendNote) ? dividendNote.GetString() : null,
                    IsActive = item.TryGetProperty("IsActive", out var isActive) ? isActive.GetBoolean() : true,
                    Notes = item.TryGetProperty("Notes", out var notes) ? notes.GetString() : null
                });
            }

            if (shareClasses.Count == 0)
            {
                _logger.LogWarning("ShareClasses list is empty. Seeding default A/B ordinary share classes.");
                shareClasses = await EnsureDefaultShareClassesAsync(token);
            }

            return shareClasses;
        }

        private async Task<List<ShareClass>> EnsureDefaultShareClassesAsync(string token)
        {
            var defaults = new List<ShareClass>
            {
                new ShareClass
                {
                    Name = "A",
                    DisplayName = "A Ordinary Shares",
                    VotingRights = "1 vote per share",
                    DividendPolicyNote = "Standard dividend rights",
                    IsActive = true,
                    Notes = "Default share class"
                },
                new ShareClass
                {
                    Name = "B",
                    DisplayName = "B Ordinary Shares",
                    VotingRights = "1 vote per share",
                    DividendPolicyNote = "Standard dividend rights",
                    IsActive = true,
                    Notes = "Default share class"
                }
            };

            var created = new List<ShareClass>();
            foreach (var shareClass in defaults)
            {
                var result = await CreateShareClassAsync(token, shareClass);
                created.Add(result);
            }

            return created;
        }

        private async Task<ShareClass> CreateShareClassAsync(string token, ShareClass shareClass)
        {
            var entityType = await GetListItemEntityType("ShareClasses", token);
            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = entityType },
                ["Title"] = shareClass.Name ?? string.Empty,
                ["DisplayName"] = shareClass.DisplayName ?? string.Empty,
                ["VotingRights"] = shareClass.VotingRights ?? string.Empty,
                ["DividendPolicyNote"] = shareClass.DividendPolicyNote ?? string.Empty,
                ["IsActive"] = shareClass.IsActive,
                ["Notes"] = shareClass.Notes ?? string.Empty
            };

            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('ShareClasses')/items";
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Content = new StringContent(
                JsonSerializer.Serialize(data),
                Encoding.UTF8,
                "application/json");
            request.Content.Headers.ContentType.Parameters.Add(new System.Net.Http.Headers.NameValueHeaderValue("odata", "verbose"));

            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to create share class: {response.StatusCode} - {errorBody}");
            }

            var responseBody = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseBody);
            var result = jsonDoc.RootElement.GetProperty("d");

            return new ShareClass
            {
                Id = result.GetProperty("Id").GetInt32(),
                Name = result.TryGetProperty("Title", out var title) ? title.GetString() : shareClass.Name,
                DisplayName = result.TryGetProperty("DisplayName", out var displayName) ? displayName.GetString() : shareClass.DisplayName,
                VotingRights = shareClass.VotingRights,
                DividendPolicyNote = shareClass.DividendPolicyNote,
                IsActive = shareClass.IsActive,
                Notes = shareClass.Notes
            };
        }

        // ==============================================
        // Company Documents Methods
        // ==============================================

        public async Task<List<CompanyDocument>> GetCompanyDocumentsAsync()
        {
            var token = await GetAppOnlyToken();
            // Query the document library items with all metadata fields
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Company Documents')/items?$select=Id,FileLeafRef,File/Length,File/TimeCreated,File/TimeLastModified,File/ServerRelativeUrl,DocumentType,PersonName,PersonTitle,IsActive,RelatedEntity,DocumentDate,ExpiryDate,DocNotes&$expand=File";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to get company documents: {response.StatusCode} - {content}");
            }

            var jsonDoc = JsonDocument.Parse(content);
            var results = jsonDoc.RootElement.GetProperty("d").GetProperty("results");
            
            var documents = new List<CompanyDocument>();
            foreach (var item in results.EnumerateArray())
            {
                if (item.TryGetProperty("File", out var file) && file.ValueKind != JsonValueKind.Null)
                {
                    var serverRelativeUrl = file.GetProperty("ServerRelativeUrl").GetString() ?? string.Empty;
                    // Extract base URL (just the hostname) since ServerRelativeUrl is already a full path
                    var siteUri = new Uri(_siteUrl);
                    var baseUrl = $"{siteUri.Scheme}://{siteUri.Host}";
                    
                    var doc = new CompanyDocument
                    {
                        Name = item.GetProperty("FileLeafRef").GetString() ?? string.Empty,
                        Size = file.TryGetProperty("Length", out var length) && length.ValueKind == JsonValueKind.Number 
                            ? length.GetInt64() : 0,
                        TimeCreated = file.TryGetProperty("TimeCreated", out var created) 
                            ? DateTime.Parse(created.GetString()!) : DateTime.MinValue,
                        TimeModified = file.TryGetProperty("TimeLastModified", out var modified) 
                            ? DateTime.Parse(modified.GetString()!) : DateTime.MinValue,
                        Url = $"{baseUrl}{serverRelativeUrl}",
                        ServerRelativeUrl = serverRelativeUrl,
                        DocumentType = item.TryGetProperty("DocumentType", out var docType) && docType.ValueKind == JsonValueKind.String
                            ? docType.GetString() : null,
                        PersonName = item.TryGetProperty("PersonName", out var personName) && personName.ValueKind == JsonValueKind.String
                            ? personName.GetString() : null,
                        PersonTitle = item.TryGetProperty("PersonTitle", out var personTitle) && personTitle.ValueKind == JsonValueKind.String
                            ? personTitle.GetString() : null,
                        IsActive = item.TryGetProperty("IsActive", out var isActive) && isActive.ValueKind == JsonValueKind.True,
                        RelatedEntity = item.TryGetProperty("RelatedEntity", out var relatedEntity) && relatedEntity.ValueKind == JsonValueKind.String
                            ? relatedEntity.GetString() : null,
                        DocumentDate = item.TryGetProperty("DocumentDate", out var docDate) && docDate.ValueKind == JsonValueKind.String
                            ? DateTime.Parse(docDate.GetString()!) : null,
                        ExpiryDate = item.TryGetProperty("ExpiryDate", out var expDate) && expDate.ValueKind == JsonValueKind.String
                            ? DateTime.Parse(expDate.GetString()!) : null,
                        Notes = item.TryGetProperty("DocNotes", out var notes) && notes.ValueKind == JsonValueKind.String
                            ? notes.GetString() : null
                    };

                    documents.Add(doc);
                }
            }

            return documents;
        }

        public async Task<CompanyDocument> UploadCompanyDocumentAsync(string fileName, byte[] fileContent, string documentType, string personName = null, string personTitle = null, bool isActive = false, string relatedEntity = null, DateTime? documentDate = null, DateTime? expiryDate = null, string notes = null)
        {
            var token = await GetAppOnlyToken();
            
            // Upload file to library
            var uploadEndpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Company Documents')/RootFolder/Files/Add(url='{Uri.EscapeDataString(fileName)}',overwrite=true)";
            
            var uploadRequest = new HttpRequestMessage(HttpMethod.Post, uploadEndpoint);
            uploadRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            uploadRequest.Headers.Add("Accept", "application/json;odata=verbose");
            uploadRequest.Content = new ByteArrayContent(fileContent);
            
            var digestValue = await GetFormDigest(token);
            uploadRequest.Headers.Add("X-RequestDigest", digestValue);

            var uploadResponse = await _httpClient.SendAsync(uploadRequest);
            var uploadContent = await uploadResponse.Content.ReadAsStringAsync();
            
            if (!uploadResponse.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to upload document: {uploadResponse.StatusCode} - {uploadContent}");
            }

            // Parse response to get file details
            var jsonDoc = JsonDocument.Parse(uploadContent);
            var fileResult = jsonDoc.RootElement.GetProperty("d");
            var serverRelativeUrl = fileResult.GetProperty("ServerRelativeUrl").GetString();
            
            // SharePoint may return Length as either string or number
            long fileLength;
            var lengthProp = fileResult.GetProperty("Length");
            if (lengthProp.ValueKind == JsonValueKind.String)
            {
                fileLength = long.Parse(lengthProp.GetString()!);
            }
            else
            {
                fileLength = lengthProp.GetInt64();
            }

            // Update list item with comprehensive metadata
            var listItemEndpoint = $"{_siteUrl}/_api/web/GetFileByServerRelativeUrl('{Uri.EscapeDataString(serverRelativeUrl!)}')/ListItemAllFields";
            var updateRequest = new HttpRequestMessage(HttpMethod.Post, listItemEndpoint);
            updateRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            updateRequest.Headers.Add("Accept", "application/json;odata=verbose");
            updateRequest.Headers.Add("X-RequestDigest", digestValue);
            updateRequest.Headers.Add("X-HTTP-Method", "MERGE");
            updateRequest.Headers.Add("IF-MATCH", "*");
            
            var updateData = new Dictionary<string, object>
            {
                ["DocumentType"] = documentType
            };
            
            if (!string.IsNullOrEmpty(personName))
                updateData["PersonName"] = personName;
            if (!string.IsNullOrEmpty(personTitle))
                updateData["PersonTitle"] = personTitle;
            if (isActive)
                updateData["IsActive"] = true;
            if (!string.IsNullOrEmpty(relatedEntity))
                updateData["RelatedEntity"] = relatedEntity;
            if (documentDate.HasValue)
                updateData["DocumentDate"] = documentDate.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            if (expiryDate.HasValue)
                updateData["ExpiryDate"] = expiryDate.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            if (!string.IsNullOrEmpty(notes))
                updateData["DocNotes"] = notes;
            
            updateRequest.Content = new StringContent(
                JsonSerializer.Serialize(updateData),
                Encoding.UTF8,
                "application/json");

            var updateResponse = await _httpClient.SendAsync(updateRequest);
            if (!updateResponse.IsSuccessStatusCode)
            {
                var errorContent = await updateResponse.Content.ReadAsStringAsync();
                _logger.LogWarning($"Failed to update document metadata: {updateResponse.StatusCode} - {errorContent}");
            }

            // Extract base URL (just the hostname) since ServerRelativeUrl is already a full path
            var siteUri = new Uri(_siteUrl);
            var baseUrl = $"{siteUri.Scheme}://{siteUri.Host}";

            return new CompanyDocument
            {
                Name = fileName,
                Size = fileLength,
                TimeCreated = DateTime.UtcNow,
                TimeModified = DateTime.UtcNow,
                Url = $"{baseUrl}{serverRelativeUrl}",
                ServerRelativeUrl = serverRelativeUrl!,
                DocumentType = documentType,
                PersonName = personName,
                PersonTitle = personTitle,
                IsActive = isActive,
                RelatedEntity = relatedEntity,
                DocumentDate = documentDate,
                ExpiryDate = expiryDate,
                Notes = notes
            };
        }

        public async Task<bool> DeleteCompanyDocumentAsync(string serverRelativeUrl)
        {
            var token = await GetAppOnlyToken();
            
            // The serverRelativeUrl is already the full path from SharePoint
            var deleteEndpoint = $"{_siteUrl}/_api/web/GetFileByServerRelativeUrl('{Uri.EscapeDataString(serverRelativeUrl)}')";
            
            _logger.LogInformation($"Attempting to delete file at URL: {serverRelativeUrl}");
            
            var request = new HttpRequestMessage(HttpMethod.Delete, deleteEndpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "DELETE");
            
            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                _logger.LogError($"Failed to delete document {serverRelativeUrl}: {response.StatusCode} - {content}");
                throw new Exception($"Failed to delete document: {response.StatusCode} - {content}");
            }
            
            _logger.LogInformation($"Successfully deleted document: {serverRelativeUrl}");
            return true;
        }

        public async Task<byte[]> DownloadCompanyDocumentAsync(string serverRelativeUrl)
        {
            var token = await GetAppOnlyToken();
            
            // The serverRelativeUrl is already the full path from SharePoint
            var downloadEndpoint = $"{_siteUrl}/_api/web/GetFileByServerRelativeUrl('{Uri.EscapeDataString(serverRelativeUrl)}')/$value";
            
            _logger.LogInformation($"Attempting to download file from: {serverRelativeUrl}");
            
            var request = new HttpRequestMessage(HttpMethod.Get, downloadEndpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                _logger.LogError($"Failed to download document {serverRelativeUrl}: {response.StatusCode} - {content}");
                throw new Exception($"Failed to download document: {response.StatusCode} - {content}");
            }
            
            _logger.LogInformation($"Successfully downloaded document: {serverRelativeUrl}");
            return await response.Content.ReadAsByteArrayAsync();
        }

        public async Task<bool> UpdateCompanyDocumentMetadataAsync(
            string serverRelativeUrl,
            string? documentType,
            string? personName,
            string? personTitle,
            bool isActive,
            string? relatedEntity,
            DateTime? documentDate,
            DateTime? expiryDate,
            string? notes)
        {
            var token = await GetAppOnlyToken();
            var digestValue = await GetFormDigest(token);

            // Update list item with metadata
            var listItemEndpoint = $"{_siteUrl}/_api/web/GetFileByServerRelativeUrl('{Uri.EscapeDataString(serverRelativeUrl)}')/ListItemAllFields";
            var updateRequest = new HttpRequestMessage(HttpMethod.Post, listItemEndpoint);
            updateRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            updateRequest.Headers.Add("Accept", "application/json;odata=verbose");
            updateRequest.Headers.Add("X-RequestDigest", digestValue);
            updateRequest.Headers.Add("X-HTTP-Method", "MERGE");
            updateRequest.Headers.Add("IF-MATCH", "*");
            
            var updateData = new Dictionary<string, object>();
            
            if (!string.IsNullOrEmpty(documentType))
                updateData["DocumentType"] = documentType;
            if (!string.IsNullOrEmpty(personName))
                updateData["PersonName"] = personName;
            if (!string.IsNullOrEmpty(personTitle))
                updateData["PersonTitle"] = personTitle;
            updateData["IsActive"] = isActive;
            if (!string.IsNullOrEmpty(relatedEntity))
                updateData["RelatedEntity"] = relatedEntity;
            if (documentDate.HasValue)
                updateData["DocumentDate"] = documentDate.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            if (expiryDate.HasValue)
                updateData["ExpiryDate"] = expiryDate.Value.ToString("M/d/yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            if (!string.IsNullOrEmpty(notes))
                updateData["DocNotes"] = notes;
            
            updateRequest.Content = new StringContent(
                JsonSerializer.Serialize(updateData),
                Encoding.UTF8,
                "application/json");

            var updateResponse = await _httpClient.SendAsync(updateRequest);
            if (!updateResponse.IsSuccessStatusCode)
            {
                var errorContent = await updateResponse.Content.ReadAsStringAsync();
                _logger.LogError($"Failed to update document metadata: {updateResponse.StatusCode} - {errorContent}");
                throw new Exception($"Failed to update document metadata: {updateResponse.StatusCode}");
            }

            _logger.LogInformation($"Successfully updated metadata for: {serverRelativeUrl}");
            return true;
        }

        // Employee methods
        public async Task<List<Employee>> GetEmployeesAsync()
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Employees')/items?$select=Id,EmployeeNumber,Title,Email,NationalInsuranceNumber,TaxCode,AnnualSalary,PaymentSchedule,StartDate,BankAccountName,BankAccountNumber,BankSortCode,Address,PhoneNumber,IsActive,Notes";
            
            var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to get employees: {response.StatusCode} - {content}");
            }

            var jsonDoc = JsonDocument.Parse(content);
            var results = jsonDoc.RootElement.GetProperty("d").GetProperty("results");
            
            var employees = new List<Employee>();
            foreach (var item in results.EnumerateArray())
            {
                var employee = new Employee
                {
                    Id = item.GetProperty("Id").GetInt32(),
                    EmployeeNumber = item.TryGetProperty("EmployeeNumber", out var empNum) && empNum.ValueKind == JsonValueKind.String ? empNum.GetString() : null,
                    Name = item.TryGetProperty("Title", out var title) && title.ValueKind == JsonValueKind.String ? title.GetString() : null,
                    Email = item.TryGetProperty("Email", out var email) && email.ValueKind == JsonValueKind.String ? email.GetString() : null,
                    NationalInsuranceNumber = item.TryGetProperty("NationalInsuranceNumber", out var ni) && ni.ValueKind == JsonValueKind.String ? ni.GetString() : null,
                    TaxCode = item.TryGetProperty("TaxCode", out var tax) && tax.ValueKind == JsonValueKind.String ? tax.GetString() : null,
                    AnnualSalary = item.TryGetProperty("AnnualSalary", out var salary) && salary.ValueKind == JsonValueKind.Number ? (decimal?)salary.GetDouble() : null,
                    PaymentSchedule = item.TryGetProperty("PaymentSchedule", out var schedule) && schedule.ValueKind == JsonValueKind.String ? schedule.GetString() : null,
                    StartDate = item.TryGetProperty("StartDate", out var start) && start.ValueKind == JsonValueKind.String ? start.GetString() : null,
                    BankAccountName = item.TryGetProperty("BankAccountName", out var bankName) && bankName.ValueKind == JsonValueKind.String ? bankName.GetString() : null,
                    BankAccountNumber = item.TryGetProperty("BankAccountNumber", out var bankNum) && bankNum.ValueKind == JsonValueKind.String ? bankNum.GetString() : null,
                    BankSortCode = item.TryGetProperty("BankSortCode", out var sortCode) && sortCode.ValueKind == JsonValueKind.String ? sortCode.GetString() : null,
                    Address = item.TryGetProperty("Address", out var addr) && addr.ValueKind == JsonValueKind.String ? addr.GetString() : null,
                    PhoneNumber = item.TryGetProperty("PhoneNumber", out var phone) && phone.ValueKind == JsonValueKind.String ? phone.GetString() : null,
                    IsActive = item.TryGetProperty("IsActive", out var active) && active.ValueKind == JsonValueKind.True,
                    Notes = item.TryGetProperty("Notes", out var notes) && notes.ValueKind == JsonValueKind.String ? notes.GetString() : null
                };

                employees.Add(employee);
            }

            return employees;
        }

        public async Task<Employee> CreateEmployeeAsync(Employee employee)
        {
            var token = await GetAppOnlyToken();
            
            // Auto-generate employee number if not provided
            if (string.IsNullOrEmpty(employee.EmployeeNumber))
            {
                var existingEmployees = await GetEmployeesAsync();
                var maxEmpNumber = 0;
                
                foreach (var emp in existingEmployees)
                {
                    if (!string.IsNullOrEmpty(emp.EmployeeNumber) && emp.EmployeeNumber.StartsWith("EMP-"))
                    {
                        var parts = emp.EmployeeNumber.Split('-');
                        if (parts.Length == 2 && int.TryParse(parts[1], out var num))
                        {
                            maxEmpNumber = Math.Max(maxEmpNumber, num);
                        }
                    }
                }
                
                employee.EmployeeNumber = $"EMP-{(maxEmpNumber + 1):D3}";
            }
            
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Employees')/items";
            
            // Get entity type dynamically (following Quote pattern)
            var entityType = await GetListItemEntityType("Employees", token);
            
            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = entityType },
                ["Title"] = employee.Name ?? string.Empty,
                ["EmployeeNumber"] = employee.EmployeeNumber,
                ["Email"] = employee.Email ?? string.Empty,
                ["NationalInsuranceNumber"] = employee.NationalInsuranceNumber ?? string.Empty,
                ["TaxCode"] = employee.TaxCode ?? string.Empty,
                ["AnnualSalary"] = employee.AnnualSalary ?? 0,
                ["PaymentSchedule"] = employee.PaymentSchedule ?? "Monthly",
                ["StartDate"] = employee.StartDate ?? DateTime.UtcNow.ToString("yyyy-MM-dd"),
                ["BankAccountName"] = employee.BankAccountName ?? string.Empty,
                ["BankAccountNumber"] = employee.BankAccountNumber ?? string.Empty,
                ["BankSortCode"] = employee.BankSortCode ?? string.Empty,
                ["Address"] = employee.Address ?? string.Empty,
                ["PhoneNumber"] = employee.PhoneNumber ?? string.Empty,
                ["IsActive"] = employee.IsActive,
                ["Notes"] = employee.Notes ?? string.Empty
            };

            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Content = new StringContent(JsonSerializer.Serialize(data), Encoding.UTF8, "application/json");
            
            // CRITICAL: Add odata parameter and FormDigest (following Quote pattern)
            request.Content.Headers.ContentType!.Parameters.Add(new NameValueHeaderValue("odata", "verbose"));
            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            
            if (!response.IsSuccessStatusCode)
            {
                throw new Exception($"Failed to create employee: {response.StatusCode} - {content}");
            }

            var jsonDoc = JsonDocument.Parse(content);
            var id = jsonDoc.RootElement.GetProperty("d").GetProperty("Id").GetInt32();
            employee.Id = id;

            return employee;
        }

        public async Task<Employee> UpdateEmployeeAsync(int id, Employee employee)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Employees')/items({id})";
            
            // Get entity type dynamically
            var entityType = await GetListItemEntityType("Employees", token);
            
            var data = new Dictionary<string, object>
            {
                ["__metadata"] = new { type = entityType },
                ["Title"] = employee.Name ?? string.Empty,
                ["EmployeeNumber"] = employee.EmployeeNumber ?? string.Empty,
                ["Email"] = employee.Email ?? string.Empty,
                ["NationalInsuranceNumber"] = employee.NationalInsuranceNumber ?? string.Empty,
                ["TaxCode"] = employee.TaxCode ?? string.Empty,
                ["AnnualSalary"] = employee.AnnualSalary ?? 0,
                ["PaymentSchedule"] = employee.PaymentSchedule ?? "Monthly",
                ["StartDate"] = employee.StartDate ?? DateTime.UtcNow.ToString("yyyy-MM-dd"),
                ["BankAccountName"] = employee.BankAccountName ?? string.Empty,
                ["BankAccountNumber"] = employee.BankAccountNumber ?? string.Empty,
                ["BankSortCode"] = employee.BankSortCode ?? string.Empty,
                ["Address"] = employee.Address ?? string.Empty,
                ["PhoneNumber"] = employee.PhoneNumber ?? string.Empty,
                ["IsActive"] = employee.IsActive,
                ["Notes"] = employee.Notes ?? string.Empty
            };

            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("Accept", "application/json;odata=verbose");
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "MERGE");
            request.Content = new StringContent(JsonSerializer.Serialize(data), Encoding.UTF8, "application/json");
            request.Content.Headers.ContentType!.Parameters.Add(new NameValueHeaderValue("odata", "verbose"));
            
            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to update employee: {response.StatusCode} - {content}");
            }

            employee.Id = id;
            return employee;
        }

        public async Task DeleteEmployeeAsync(int id)
        {
            var token = await GetAppOnlyToken();
            var endpoint = $"{_siteUrl}/_api/web/lists/getbytitle('Employees')/items({id})";
            
            var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("IF-MATCH", "*");
            request.Headers.Add("X-HTTP-Method", "DELETE");
            
            var digestValue = await GetFormDigest(token);
            request.Headers.Add("X-RequestDigest", digestValue);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                throw new Exception($"Failed to delete employee: {response.StatusCode} - {content}");
            }
        }
    }

    // Company Document model
    public class CompanyDocument
    {
        public string Name { get; set; } = string.Empty;
        public long Size { get; set; }
        public DateTime TimeCreated { get; set; }
        public DateTime TimeModified { get; set; }
        public string Url { get; set; } = string.Empty;
        public string ServerRelativeUrl { get; set; } = string.Empty;
        public string? DocumentType { get; set; }
        public string? PersonName { get; set; }
        public string? PersonTitle { get; set; }
        public bool IsActive { get; set; }
        public string? RelatedEntity { get; set; }
        public DateTime? DocumentDate { get; set; }
        public DateTime? ExpiryDate { get; set; }
        public string? Notes { get; set; }
    }
}
