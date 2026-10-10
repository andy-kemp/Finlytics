using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    public class GoCardlessFunctions
    {
        private readonly ILogger<GoCardlessFunctions> _logger;
        private readonly IBankAccountRepository _bankAccountRepository;
        private readonly IBankTransactionRepository _bankTransactionRepository;
        private readonly ICategorizationRuleRepository _categorizationRuleRepository;
        private readonly IInvoiceRepository _invoiceRepository;
        private readonly ICustomerRepository _customerRepository;
        private readonly IGoCardlessMandateRepository _mandateRepository;
        private readonly IGoCardlessPaymentRepository _paymentRepository;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly FinanceHubDbContext _dbContext;

        // GoCardless Bank Account Data API (ex-Nordigen)
        private const string BankDataBaseUrl = "https://bankaccountdata.gocardless.com/api/v2";
        // GoCardless Payments API
        private const string PaymentsBaseUrlSandbox = "https://api-sandbox.gocardless.com";
        private const string PaymentsBaseUrlLive = "https://api.gocardless.com";
        private const string RedirectUri = "https://financehub-func-kemponline.azurewebsites.net/api/gocardless/bank-callback";
        private const string FrontendBankingUrl = "https://finhub.andykemp.cloud/banking";

        public GoCardlessFunctions(
            ILogger<GoCardlessFunctions> logger,
            IBankAccountRepository bankAccountRepository,
            IBankTransactionRepository bankTransactionRepository,
            ICategorizationRuleRepository categorizationRuleRepository,
            IInvoiceRepository invoiceRepository,
            ICustomerRepository customerRepository,
            IGoCardlessMandateRepository mandateRepository,
            IGoCardlessPaymentRepository paymentRepository,
            IHttpClientFactory httpClientFactory,
            FinanceHubDbContext dbContext)
        {
            _logger = logger;
            _bankAccountRepository = bankAccountRepository;
            _bankTransactionRepository = bankTransactionRepository;
            _categorizationRuleRepository = categorizationRuleRepository;
            _invoiceRepository = invoiceRepository;
            _customerRepository = customerRepository;
            _mandateRepository = mandateRepository;
            _paymentRepository = paymentRepository;
            _httpClientFactory = httpClientFactory;
            _dbContext = dbContext;
        }

        private string PaymentsBaseUrl =>
            (Environment.GetEnvironmentVariable("GoCardlessSandbox") ?? "true").Equals("true", StringComparison.OrdinalIgnoreCase)
                ? PaymentsBaseUrlSandbox
                : PaymentsBaseUrlLive;

        // ═══════════════════════════════════════════════════════════════════════════
        //  BANK ACCOUNT DATA (ex-Nordigen) — Open Banking bank feeds
        // ═══════════════════════════════════════════════════════════════════════════

        /// <summary>
        /// GET /api/gocardless/institutions?country=GB
        /// Lists available banks the user can connect to.
        /// </summary>
        [Function("GoCardlessListInstitutions")]
        public async Task<HttpResponseData> ListInstitutions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/institutions")] HttpRequestData req)
        {
            try
            {
                var country = req.Url.Query?.Contains("country=") == true
                    ? req.Url.Query.Split("country=")[1].Split('&')[0]
                    : "GB";

                var token = await GetBankDataTokenAsync();
                if (token == null)
                {
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "GoCardless Bank Data not configured. Set GoCardlessSecretId and GoCardlessSecretKey." });
                    return err;
                }

                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                var resp = await client.GetAsync($"{BankDataBaseUrl}/institutions/?country={country}");

                if (!resp.IsSuccessStatusCode)
                {
                    var err = req.CreateResponse(resp.StatusCode);
                    await err.WriteStringAsync(await resp.Content.ReadAsStringAsync());
                    return err;
                }

                var json = await resp.Content.ReadAsStringAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add("Content-Type", "application/json");
                await response.WriteStringAsync(json);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error listing GoCardless institutions");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        /// <summary>
        /// POST /api/gocardless/connect-bank
        /// Body: { "institutionId": "MONZO_MONZGB2L" }
        /// Creates a requisition (bank connection) and returns the redirect URL for the user to authorise.
        /// </summary>
        [Function("GoCardlessConnectBank")]
        public async Task<HttpResponseData> ConnectBank(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "gocardless/connect-bank")] HttpRequestData req)
        {
            try
            {
                var body = await JsonDocument.ParseAsync(req.Body);
                var institutionId = body.RootElement.GetProperty("institutionId").GetString();

                var token = await GetBankDataTokenAsync();
                if (token == null)
                {
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "GoCardless Bank Data not configured" });
                    return err;
                }

                // Create end-user agreement (90 days access, 90 days history)
                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

                var agreementPayload = JsonSerializer.Serialize(new
                {
                    institution_id = institutionId,
                    max_historical_days = 90,
                    access_valid_for_days = 90,
                    access_scope = new[] { "balances", "details", "transactions" }
                });

                var agreementResp = await client.PostAsync(
                    $"{BankDataBaseUrl}/agreements/enduser/",
                    new StringContent(agreementPayload, Encoding.UTF8, "application/json"));

                string? agreementId = null;
                if (agreementResp.IsSuccessStatusCode)
                {
                    var agreementJson = await agreementResp.Content.ReadAsStringAsync();
                    using var agreementDoc = JsonDocument.Parse(agreementJson);
                    agreementId = agreementDoc.RootElement.GetProperty("id").GetString();
                }

                // Create requisition
                var requisitionPayload = JsonSerializer.Serialize(new
                {
                    redirect = RedirectUri,
                    institution_id = institutionId,
                    agreement = agreementId,
                    user_language = "EN"
                });

                var requisitionResp = await client.PostAsync(
                    $"{BankDataBaseUrl}/requisitions/",
                    new StringContent(requisitionPayload, Encoding.UTF8, "application/json"));

                if (!requisitionResp.IsSuccessStatusCode)
                {
                    var detail = await requisitionResp.Content.ReadAsStringAsync();
                    _logger.LogError("GoCardless requisition creation failed: {Detail}", detail);
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Failed to create bank connection", detail });
                    return err;
                }

                var reqJson = await requisitionResp.Content.ReadAsStringAsync();
                using var reqDoc = JsonDocument.Parse(reqJson);
                var requisitionId = reqDoc.RootElement.GetProperty("id").GetString();
                var link = reqDoc.RootElement.GetProperty("link").GetString();

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { requisitionId, authUrl = link });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating GoCardless bank connection");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        /// <summary>
        /// GET /api/gocardless/bank-callback?ref=xxx
        /// Redirect callback after user authorises bank connection.
        /// Fetches account details and creates BankAccount records.
        /// </summary>
        [Function("GoCardlessBankCallback")]
        public async Task<HttpResponseData> BankCallback(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/bank-callback")] HttpRequestData req)
        {
            try
            {
                var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(req.Url.Query);
                var requisitionId = query.TryGetValue("ref", out var r) ? r.ToString() : null;

                if (string.IsNullOrEmpty(requisitionId))
                {
                    var errResp = req.CreateResponse(HttpStatusCode.Redirect);
                    errResp.Headers.Add("Location", $"{FrontendBankingUrl}?gc_error=missing_ref");
                    return errResp;
                }

                var token = await GetBankDataTokenAsync();
                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

                // Get requisition details (includes linked account IDs)
                var reqResp = await client.GetAsync($"{BankDataBaseUrl}/requisitions/{requisitionId}/");
                if (!reqResp.IsSuccessStatusCode)
                {
                    var errResp = req.CreateResponse(HttpStatusCode.Redirect);
                    errResp.Headers.Add("Location", $"{FrontendBankingUrl}?gc_error=requisition_not_found");
                    return errResp;
                }

                var reqJson = await reqResp.Content.ReadAsStringAsync();
                using var reqDoc = JsonDocument.Parse(reqJson);
                var institutionId = reqDoc.RootElement.TryGetProperty("institution_id", out var inst) ? inst.GetString() : null;
                var accounts = reqDoc.RootElement.GetProperty("accounts");
                var existingAccounts = await _bankAccountRepository.GetAllAsync();

                foreach (var accountId in accounts.EnumerateArray())
                {
                    var gcAccountId = accountId.GetString()!;

                    // Check if already linked
                    var existing = existingAccounts.FirstOrDefault(a => a.GoCardlessAccountId == gcAccountId);
                    if (existing != null)
                    {
                        existing.GoCardlessConnected = true;
                        existing.GoCardlessRequisitionId = requisitionId;
                        existing.GoCardlessLastSyncedAt = DateTime.UtcNow;
                        existing.ModifiedDate = DateTime.UtcNow;
                        await _bankAccountRepository.UpdateAsync(existing);
                        continue;
                    }

                    // Fetch account details
                    var detailResp = await client.GetAsync($"{BankDataBaseUrl}/accounts/{gcAccountId}/details/");
                    string? ownerName = null, iban = null, sortCode = null, accNumber = null, currency = "GBP";
                    if (detailResp.IsSuccessStatusCode)
                    {
                        var detailJson = await detailResp.Content.ReadAsStringAsync();
                        using var detailDoc = JsonDocument.Parse(detailJson);
                        if (detailDoc.RootElement.TryGetProperty("account", out var acc))
                        {
                            ownerName = acc.TryGetProperty("ownerName", out var on) ? on.GetString() : null;
                            iban = acc.TryGetProperty("iban", out var ib) ? ib.GetString() : null;
                            currency = acc.TryGetProperty("currency", out var cur) ? cur.GetString() ?? "GBP" : "GBP";
                            // UK accounts: extract sort code and account number from IBAN
                            if (iban != null && iban.StartsWith("GB") && iban.Length >= 22)
                            {
                                sortCode = iban.Substring(8, 6);
                                accNumber = iban.Substring(14, 8);
                            }
                        }
                    }

                    await _bankAccountRepository.CreateAsync(new BankAccount
                    {
                        AccountName = ownerName ?? "Bank Account",
                        BankName = institutionId ?? "Unknown",
                        SortCode = sortCode,
                        AccountNumber = accNumber,
                        Currency = currency,
                        IsActive = true,
                        GoCardlessAccountId = gcAccountId,
                        GoCardlessRequisitionId = requisitionId,
                        GoCardlessConnected = true,
                        GoCardlessInstitutionId = institutionId,
                        GoCardlessLastSyncedAt = DateTime.UtcNow,
                        CreatedDate = DateTime.UtcNow,
                        ModifiedDate = DateTime.UtcNow
                    });
                }

                var response = req.CreateResponse(HttpStatusCode.Redirect);
                response.Headers.Add("Location", $"{FrontendBankingUrl}?gc_connected=true");
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "GoCardless bank callback error");
                var errResp = req.CreateResponse(HttpStatusCode.Redirect);
                errResp.Headers.Add("Location", $"{FrontendBankingUrl}?gc_error={Uri.EscapeDataString(ex.Message)}");
                return errResp;
            }
        }

        /// <summary>
        /// POST /api/gocardless/sync — Sync transactions from GoCardless Bank Account Data
        /// </summary>
        [Function("GoCardlessSyncTransactions")]
        public async Task<HttpResponseData> SyncTransactions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "gocardless/sync")] HttpRequestData req)
        {
            var token = await GetBankDataTokenAsync();
            if (token == null)
            {
                var err = req.CreateResponse(HttpStatusCode.BadRequest);
                await err.WriteAsJsonAsync(new { error = "GoCardless Bank Data not configured" });
                return err;
            }

            var accounts = (await _bankAccountRepository.GetAllAsync())
                .Where(a => a.GoCardlessConnected && !string.IsNullOrEmpty(a.GoCardlessAccountId))
                .ToList();

            if (accounts.Count == 0)
            {
                var err = req.CreateResponse(HttpStatusCode.BadRequest);
                await err.WriteAsJsonAsync(new { error = "No GoCardless-connected bank accounts found" });
                return err;
            }

            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            int totalImported = 0;
            int totalSkipped = 0;
            var from = DateTime.UtcNow.AddDays(-90).ToString("yyyy-MM-dd");
            var to = DateTime.UtcNow.ToString("yyyy-MM-dd");

            foreach (var account in accounts)
            {
                try
                {
                    var url = $"{BankDataBaseUrl}/accounts/{account.GoCardlessAccountId}/transactions/?date_from={from}&date_to={to}";
                    var txResp = await client.GetAsync(url);
                    if (!txResp.IsSuccessStatusCode)
                    {
                        _logger.LogWarning("GoCardless transaction fetch failed for {AccountId}: {Status}",
                            account.GoCardlessAccountId, txResp.StatusCode);
                        continue;
                    }

                    var txJson = await txResp.Content.ReadAsStringAsync();
                    using var txDoc = JsonDocument.Parse(txJson);

                    if (!txDoc.RootElement.TryGetProperty("transactions", out var txRoot)) continue;
                    if (!txRoot.TryGetProperty("booked", out var booked)) continue;

                    // Get existing external IDs to deduplicate
                    var existingTxns = await _bankTransactionRepository.GetByAccountIdAsync(account.Id);
                    var existingIds = new HashSet<string>(
                        existingTxns
                            .Where(t => !string.IsNullOrEmpty(t.ExternalId))
                            .Select(t => t.ExternalId!));

                    var newTransactions = new List<BankTransaction>();
                    foreach (var tx in booked.EnumerateArray())
                    {
                        var txId = tx.TryGetProperty("transactionId", out var tid) ? tid.GetString() : null;
                        var internalTxId = tx.TryGetProperty("internalTransactionId", out var itid) ? itid.GetString() : null;
                        var externalId = txId ?? internalTxId ?? Guid.NewGuid().ToString();

                        if (existingIds.Contains(externalId))
                        {
                            totalSkipped++;
                            continue;
                        }

                        var amountStr = tx.TryGetProperty("transactionAmount", out var ta)
                            ? (ta.TryGetProperty("amount", out var amt) ? amt.GetString() : null)
                            : null;
                        var amount = decimal.TryParse(amountStr, out var parsed) ? parsed : 0m;

                        var description = tx.TryGetProperty("remittanceInformationUnstructured", out var desc)
                            ? desc.GetString()
                            : (tx.TryGetProperty("additionalInformation", out var ai) ? ai.GetString() : null);

                        var merchant = tx.TryGetProperty("creditorName", out var cn) ? cn.GetString()
                            : (tx.TryGetProperty("debtorName", out var dn) ? dn.GetString() : null);

                        var dateStr = tx.TryGetProperty("bookingDate", out var bd) ? bd.GetString() : null;
                        DateTime? txDate = DateTime.TryParse(dateStr, out var d) ? d : null;

                        var balanceAfter = tx.TryGetProperty("balanceAfterTransaction", out var bat)
                            ? (bat.TryGetProperty("balanceAmount", out var ba)
                                ? (ba.TryGetProperty("amount", out var baAmt) ? decimal.TryParse(baAmt.GetString(), out var bp) ? bp : (decimal?)null : null)
                                : null)
                            : null;

                        newTransactions.Add(new BankTransaction
                        {
                            BankAccountId = account.Id,
                            TransactionDate = txDate,
                            Amount = Math.Abs(amount),
                            Description = description,
                            Reference = txId,
                            Direction = amount >= 0 ? "In" : "Out",
                            Balance = balanceAfter,
                            ExternalId = externalId,
                            Source = "GoCardless",
                            TrueLayerMerchantName = merchant, // Reuse merchant field
                            CreatedDate = DateTime.UtcNow,
                            ModifiedDate = DateTime.UtcNow
                        });
                    }

                    if (newTransactions.Count > 0)
                    {
                        // Auto-categorise
                        var catRules = (await _categorizationRuleRepository.GetActiveAsync()).ToList();
                        if (catRules.Any())
                        {
                            foreach (var tx in newTransactions)
                            {
                                if (string.IsNullOrEmpty(tx.Category))
                                {
                                    var matched = CategorizationFunctions.ApplyRulesToTransaction(tx, catRules);
                                    if (matched != null) tx.Category = matched;
                                }
                            }
                        }

                        await _bankTransactionRepository.CreateManyAsync(newTransactions);
                        totalImported += newTransactions.Count;
                    }

                    account.GoCardlessLastSyncedAt = DateTime.UtcNow;
                    account.ModifiedDate = DateTime.UtcNow;
                    await _bankAccountRepository.UpdateAsync(account);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error syncing GoCardless account {AccountId}", account.GoCardlessAccountId);
                }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                success = true,
                imported = totalImported,
                skipped = totalSkipped,
                message = $"Synced {totalImported} new transactions ({totalSkipped} already existed)"
            });
            return response;
        }

        /// <summary>
        /// GET /api/gocardless/bank-status — Check GoCardless Bank Data connection status
        /// </summary>
        [Function("GoCardlessBankStatus")]
        public async Task<HttpResponseData> BankStatus(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/bank-status")] HttpRequestData req)
        {
            var accounts = (await _bankAccountRepository.GetAllAsync())
                .Where(a => a.GoCardlessConnected)
                .ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                connected = accounts.Count > 0,
                accountCount = accounts.Count,
                accounts = accounts.Select(a => new
                {
                    a.Id,
                    a.AccountName,
                    a.BankName,
                    a.GoCardlessInstitutionId,
                    a.GoCardlessLastSyncedAt
                })
            });
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        //  DIRECT DEBIT MANDATES — Authorise recurring collections from customers
        // ═══════════════════════════════════════════════════════════════════════════

        /// <summary>
        /// POST /api/gocardless/mandates/create
        /// Body: { "customerId": "C001", "customerName": "Acme Ltd", "email": "billing@acme.com" }
        /// Creates a GoCardless billing request flow (hosted mandate setup page).
        /// Returns a URL for the customer to complete Direct Debit setup.
        /// </summary>
        [Function("GoCardlessCreateMandate")]
        public async Task<HttpResponseData> CreateMandate(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "gocardless/mandates/create")] HttpRequestData req)
        {
            try
            {
                var body = await JsonDocument.ParseAsync(req.Body);
                var customerId = body.RootElement.GetProperty("customerId").GetString();
                var customerName = body.RootElement.TryGetProperty("customerName", out var cn) ? cn.GetString() : "";
                var email = body.RootElement.TryGetProperty("email", out var em) ? em.GetString() : "";

                var accessToken = Environment.GetEnvironmentVariable("GoCardlessAccessToken");
                if (string.IsNullOrEmpty(accessToken))
                {
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "GoCardless Payments not configured. Set GoCardlessAccessToken." });
                    return err;
                }

                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                client.DefaultRequestHeaders.Add("GoCardless-Version", "2015-07-06");

                // Step 1: Create a customer in GoCardless
                var customerPayload = JsonSerializer.Serialize(new
                {
                    customers = new { email, company_name = customerName }
                });
                var custResp = await client.PostAsync(
                    $"{PaymentsBaseUrl}/customers",
                    new StringContent(customerPayload, Encoding.UTF8, "application/json"));

                string? gcCustomerId = null;
                if (custResp.IsSuccessStatusCode)
                {
                    var custJson = await custResp.Content.ReadAsStringAsync();
                    using var custDoc = JsonDocument.Parse(custJson);
                    gcCustomerId = custDoc.RootElement.GetProperty("customers").GetProperty("id").GetString();
                }
                else
                {
                    var detail = await custResp.Content.ReadAsStringAsync();
                    _logger.LogError("GoCardless customer creation failed: {Detail}", detail);
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Failed to create GoCardless customer", detail });
                    return err;
                }

                // Step 2: Create a billing request flow (hosted mandate page)
                var brPayload = JsonSerializer.Serialize(new
                {
                    billing_requests = new
                    {
                        mandate_request = new { scheme = "bacs" },
                        links = new { customer = gcCustomerId }
                    }
                });
                var brResp = await client.PostAsync(
                    $"{PaymentsBaseUrl}/billing_requests",
                    new StringContent(brPayload, Encoding.UTF8, "application/json"));

                if (!brResp.IsSuccessStatusCode)
                {
                    var detail = await brResp.Content.ReadAsStringAsync();
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Failed to create billing request", detail });
                    return err;
                }

                var brJson = await brResp.Content.ReadAsStringAsync();
                using var brDoc = JsonDocument.Parse(brJson);
                var billingRequestId = brDoc.RootElement.GetProperty("billing_requests").GetProperty("id").GetString();

                // Step 3: Create a billing request flow (generates the hosted URL)
                var flowPayload = JsonSerializer.Serialize(new
                {
                    billing_request_flows = new
                    {
                        redirect_uri = $"https://financehub-func-kemponline.azurewebsites.net/api/gocardless/mandate-callback?customerId={customerId}",
                        exit_uri = FrontendBankingUrl,
                        links = new { billing_request = billingRequestId }
                    }
                });
                var flowResp = await client.PostAsync(
                    $"{PaymentsBaseUrl}/billing_request_flows",
                    new StringContent(flowPayload, Encoding.UTF8, "application/json"));

                if (!flowResp.IsSuccessStatusCode)
                {
                    var detail = await flowResp.Content.ReadAsStringAsync();
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Failed to create billing request flow", detail });
                    return err;
                }

                var flowJson = await flowResp.Content.ReadAsStringAsync();
                using var flowDoc = JsonDocument.Parse(flowJson);
                var authoriseUrl = flowDoc.RootElement.GetProperty("billing_request_flows").GetProperty("authorisation_url").GetString();

                // Save tracking record
                await _mandateRepository.CreateAsync(new GoCardlessMandate
                {
                    CustomerId = customerId,
                    CustomerName = customerName,
                    GoCardlessCustomerId = gcCustomerId,
                    Status = "pending_submission",
                    Scheme = "bacs",
                    CreatedDate = DateTime.UtcNow
                });

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    authoriseUrl,
                    gcCustomerId,
                    billingRequestId,
                    message = "Send this URL to your customer to set up Direct Debit"
                });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating GoCardless mandate");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        /// <summary>
        /// GET /api/gocardless/mandate-callback — After customer completes DD setup
        /// </summary>
        [Function("GoCardlessMandateCallback")]
        public async Task<HttpResponseData> MandateCallback(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/mandate-callback")] HttpRequestData req)
        {
            try
            {
                var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(req.Url.Query);
                var customerId = query.TryGetValue("customerId", out var cid) ? cid.ToString() : null;

                // The mandate is now created — we'll pick up the exact mandate ID via webhook
                // For now, redirect back to the app with success
                var response = req.CreateResponse(HttpStatusCode.Redirect);
                response.Headers.Add("Location",
                    $"{FrontendBankingUrl}?gc_mandate_created=true&customerId={customerId}");
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "GoCardless mandate callback error");
                var errResp = req.CreateResponse(HttpStatusCode.Redirect);
                errResp.Headers.Add("Location", $"{FrontendBankingUrl}?gc_error={Uri.EscapeDataString(ex.Message)}");
                return errResp;
            }
        }

        /// <summary>
        /// GET /api/gocardless/mandates — List all mandates
        /// </summary>
        [Function("GoCardlessListMandates")]
        public async Task<HttpResponseData> ListMandates(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/mandates")] HttpRequestData req)
        {
            var mandates = await _mandateRepository.GetAllAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(mandates);
            return response;
        }

        /// <summary>
        /// GET /api/gocardless/mandates/{customerId}/status — Get mandate status for a customer
        /// </summary>
        [Function("GoCardlessGetMandateStatus")]
        public async Task<HttpResponseData> GetMandateStatus(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/mandates/{customerId}/status")] HttpRequestData req,
            string customerId)
        {
            var mandate = (await _mandateRepository.GetByCustomerIdAsync(customerId))
                .OrderByDescending(m => m.CreatedDate)
                .FirstOrDefault();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                hasMandate = mandate != null && mandate.Status == "active",
                mandate
            });
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        //  PAYMENTS — Collect money from customers via Direct Debit
        // ═══════════════════════════════════════════════════════════════════════════

        /// <summary>
        /// POST /api/gocardless/payments/collect
        /// Body: { "invoiceId": 123 }
        /// Collects payment for an invoice using the customer's active mandate.
        /// </summary>
        [Function("GoCardlessCollectPayment")]
        public async Task<HttpResponseData> CollectPayment(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "gocardless/payments/collect")] HttpRequestData req)
        {
            try
            {
                var body = await JsonDocument.ParseAsync(req.Body);
                var invoiceId = body.RootElement.GetProperty("invoiceId").GetInt32();

                var invoice = await _invoiceRepository.GetByIdAsync(invoiceId);
                if (invoice == null)
                {
                    var err = req.CreateResponse(HttpStatusCode.NotFound);
                    await err.WriteAsJsonAsync(new { error = "Invoice not found" });
                    return err;
                }

                if (invoice.Status == "Paid")
                {
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Invoice already paid" });
                    return err;
                }

                // Find active mandate for this customer
                var mandates = await _mandateRepository.GetByCustomerIdAsync(invoice.CustomerId ?? "");
                var activeMandate = mandates.FirstOrDefault(m => m.Status == "active");

                if (activeMandate == null || string.IsNullOrEmpty(activeMandate.GoCardlessMandateId))
                {
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "No active Direct Debit mandate for this customer. Set up a mandate first." });
                    return err;
                }

                var accessToken = Environment.GetEnvironmentVariable("GoCardlessAccessToken");
                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                client.DefaultRequestHeaders.Add("GoCardless-Version", "2015-07-06");

                // GoCardless expects amount in pence
                var amountInPence = (int)(invoice.AmountGross * 100);
                var paymentPayload = JsonSerializer.Serialize(new
                {
                    payments = new
                    {
                        amount = amountInPence,
                        currency = "GBP",
                        description = $"Invoice {invoice.InvoiceNumber}",
                        metadata = new { invoice_id = invoice.Id.ToString(), invoice_number = invoice.InvoiceNumber },
                        links = new { mandate = activeMandate.GoCardlessMandateId }
                    }
                });

                var payResp = await client.PostAsync(
                    $"{PaymentsBaseUrl}/payments",
                    new StringContent(paymentPayload, Encoding.UTF8, "application/json"));

                if (!payResp.IsSuccessStatusCode)
                {
                    var detail = await payResp.Content.ReadAsStringAsync();
                    _logger.LogError("GoCardless payment creation failed: {Detail}", detail);
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Payment collection failed", detail });
                    return err;
                }

                var payJson = await payResp.Content.ReadAsStringAsync();
                using var payDoc = JsonDocument.Parse(payJson);
                var payment = payDoc.RootElement.GetProperty("payments");
                var gcPaymentId = payment.GetProperty("id").GetString();
                var chargeDate = payment.TryGetProperty("charge_date", out var cd) ? cd.GetString() : null;
                var status = payment.GetProperty("status").GetString();

                // Track the payment
                await _paymentRepository.CreateAsync(new GoCardlessPayment
                {
                    InvoiceId = invoice.Id,
                    InvoiceNumber = invoice.InvoiceNumber,
                    GoCardlessPaymentId = gcPaymentId,
                    GoCardlessMandateId = activeMandate.GoCardlessMandateId,
                    Amount = invoice.AmountGross,
                    Currency = "GBP",
                    Description = $"Invoice {invoice.InvoiceNumber}",
                    Status = status,
                    ChargeDate = DateTime.TryParse(chargeDate, out var cdParsed) ? cdParsed : null,
                    CreatedDate = DateTime.UtcNow
                });

                // Update invoice with GoCardless payment reference
                invoice.GoCardlessPaymentId = gcPaymentId;
                invoice.GoCardlessMandateId = activeMandate.GoCardlessMandateId;
                await _invoiceRepository.UpdateAsync(invoice);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    success = true,
                    paymentId = gcPaymentId,
                    status,
                    chargeDate,
                    message = $"Payment of £{invoice.AmountGross:F2} will be collected on {chargeDate}"
                });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error collecting GoCardless payment");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        /// <summary>
        /// POST /api/gocardless/payments/create-link
        /// Body: { "invoiceId": 123 }
        /// Creates an Instant Bank Pay link for a one-off invoice payment (no mandate needed).
        /// </summary>
        [Function("GoCardlessCreatePaymentLink")]
        public async Task<HttpResponseData> CreatePaymentLink(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "gocardless/payments/create-link")] HttpRequestData req)
        {
            try
            {
                var body = await JsonDocument.ParseAsync(req.Body);
                var invoiceId = body.RootElement.GetProperty("invoiceId").GetInt32();

                var invoice = await _invoiceRepository.GetByIdAsync(invoiceId);
                if (invoice == null)
                {
                    var err = req.CreateResponse(HttpStatusCode.NotFound);
                    await err.WriteAsJsonAsync(new { error = "Invoice not found" });
                    return err;
                }

                var accessToken = Environment.GetEnvironmentVariable("GoCardlessAccessToken");
                if (string.IsNullOrEmpty(accessToken))
                {
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "GoCardless Payments not configured" });
                    return err;
                }

                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                client.DefaultRequestHeaders.Add("GoCardless-Version", "2015-07-06");

                // Create a billing request for instant bank pay
                var amountInPence = (int)(invoice.AmountGross * 100);
                var brPayload = JsonSerializer.Serialize(new
                {
                    billing_requests = new
                    {
                        payment_request = new
                        {
                            description = $"Invoice {invoice.InvoiceNumber} - {invoice.CustomerName}",
                            amount = amountInPence,
                            currency = "GBP",
                            metadata = new { invoice_id = invoice.Id.ToString(), invoice_number = invoice.InvoiceNumber }
                        }
                    }
                });

                var brResp = await client.PostAsync(
                    $"{PaymentsBaseUrl}/billing_requests",
                    new StringContent(brPayload, Encoding.UTF8, "application/json"));

                if (!brResp.IsSuccessStatusCode)
                {
                    var detail = await brResp.Content.ReadAsStringAsync();
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Failed to create payment link", detail });
                    return err;
                }

                var brJson = await brResp.Content.ReadAsStringAsync();
                using var brDoc = JsonDocument.Parse(brJson);
                var billingRequestId = brDoc.RootElement.GetProperty("billing_requests").GetProperty("id").GetString();

                // Create flow for hosted payment page
                var flowPayload = JsonSerializer.Serialize(new
                {
                    billing_request_flows = new
                    {
                        redirect_uri = $"https://financehub-func-kemponline.azurewebsites.net/api/gocardless/payment-callback?invoiceId={invoiceId}",
                        exit_uri = FrontendBankingUrl,
                        links = new { billing_request = billingRequestId },
                        show_redirect_buttons = true
                    }
                });

                var flowResp = await client.PostAsync(
                    $"{PaymentsBaseUrl}/billing_request_flows",
                    new StringContent(flowPayload, Encoding.UTF8, "application/json"));

                if (!flowResp.IsSuccessStatusCode)
                {
                    var detail = await flowResp.Content.ReadAsStringAsync();
                    var err = req.CreateResponse(HttpStatusCode.BadRequest);
                    await err.WriteAsJsonAsync(new { error = "Failed to create payment flow", detail });
                    return err;
                }

                var flowJson = await flowResp.Content.ReadAsStringAsync();
                using var flowDoc = JsonDocument.Parse(flowJson);
                var payUrl = flowDoc.RootElement.GetProperty("billing_request_flows").GetProperty("authorisation_url").GetString();

                // Store the payment link on the invoice
                invoice.PaymentLink = payUrl;
                await _invoiceRepository.UpdateAsync(invoice);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    paymentLink = payUrl,
                    billingRequestId,
                    message = "Payment link generated — include in invoice email or share directly"
                });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating GoCardless payment link");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteAsJsonAsync(new { error = ex.Message });
                return err;
            }
        }

        /// <summary>
        /// GET /api/gocardless/payment-callback — After customer completes one-off payment
        /// </summary>
        [Function("GoCardlessPaymentCallback")]
        public async Task<HttpResponseData> PaymentCallback(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/payment-callback")] HttpRequestData req)
        {
            var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(req.Url.Query);
            var invoiceIdStr = query.TryGetValue("invoiceId", out var iid) ? iid.ToString() : null;

            var response = req.CreateResponse(HttpStatusCode.Redirect);
            response.Headers.Add("Location",
                $"https://finhub.andykemp.cloud/?view=invoices&gc_payment_initiated=true&invoiceId={invoiceIdStr}");
            return response;
        }

        /// <summary>
        /// GET /api/gocardless/payments — List all GoCardless payments
        /// </summary>
        [Function("GoCardlessListPayments")]
        public async Task<HttpResponseData> ListPayments(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gocardless/payments")] HttpRequestData req)
        {
            var payments = await _paymentRepository.GetAllAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(payments);
            return response;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        //  WEBHOOKS — GoCardless notifies us of mandate/payment status changes
        // ═══════════════════════════════════════════════════════════════════════════

        /// <summary>
        /// POST /api/gocardless/webhooks — GoCardless webhook endpoint
        /// Handles: mandate status changes, payment confirmations/failures
        /// </summary>
        [Function("GoCardlessWebhook")]
        public async Task<HttpResponseData> HandleWebhook(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "gocardless/webhooks")] HttpRequestData req)
        {
            try
            {
                var webhookSecret = Environment.GetEnvironmentVariable("GoCardlessWebhookSecret");
                if (string.IsNullOrEmpty(webhookSecret))
                {
                    _logger.LogWarning("GoCardless webhook received but no webhook secret configured");
                    return req.CreateResponse(HttpStatusCode.OK);
                }

                // Verify webhook signature
                var signature = req.Headers.TryGetValues("Webhook-Signature", out var sigValues)
                    ? sigValues.FirstOrDefault() : null;
                var bodyString = await new StreamReader(req.Body).ReadToEndAsync();

                if (string.IsNullOrEmpty(signature))
                {
                    _logger.LogWarning("GoCardless webhook rejected: missing signature");
                    return req.CreateResponse(HttpStatusCode.Unauthorized);
                }

                using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(webhookSecret)))
                {
                    var computed = BitConverter.ToString(hmac.ComputeHash(Encoding.UTF8.GetBytes(bodyString)))
                        .Replace("-", "").ToLowerInvariant();
                    if (!CryptographicOperations.FixedTimeEquals(
                        Encoding.UTF8.GetBytes(computed),
                        Encoding.UTF8.GetBytes(signature)))
                    {
                        _logger.LogWarning("GoCardless webhook signature mismatch");
                        return req.CreateResponse(HttpStatusCode.Unauthorized);
                    }
                }

                using var doc = JsonDocument.Parse(bodyString);
                if (!doc.RootElement.TryGetProperty("events", out var events)) 
                {
                    return req.CreateResponse(HttpStatusCode.OK);
                }

                foreach (var evt in events.EnumerateArray())
                {
                    var resourceType = evt.TryGetProperty("resource_type", out var rt) ? rt.GetString() : null;
                    var action = evt.TryGetProperty("action", out var act) ? act.GetString() : null;
                    var links = evt.TryGetProperty("links", out var lnk) ? lnk : default;

                    _logger.LogInformation("GoCardless webhook: {ResourceType}.{Action}", resourceType, action);

                    switch (resourceType)
                    {
                        case "mandates":
                            await HandleMandateEvent(action, links);
                            break;
                        case "payments":
                            await HandlePaymentEvent(action, links);
                            break;
                    }
                }

                return req.CreateResponse(HttpStatusCode.OK);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing GoCardless webhook");
                // Return 200 to prevent GoCardless from retrying
                return req.CreateResponse(HttpStatusCode.OK);
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════
        //  PRIVATE HELPERS
        // ═══════════════════════════════════════════════════════════════════════════

        private async Task HandleMandateEvent(string? action, JsonElement links)
        {
            var mandateId = links.TryGetProperty("mandate", out var mid) ? mid.GetString() : null;
            if (string.IsNullOrEmpty(mandateId)) return;

            var mandate = await _mandateRepository.GetByGoCardlessMandateIdAsync(mandateId);
            if (mandate == null)
            {
                // Could be a new mandate from a billing request — find by GC customer ID
                var gcCustomerId = links.TryGetProperty("customer", out var cust) ? cust.GetString() : null;
                if (!string.IsNullOrEmpty(gcCustomerId))
                {
                    var mandates = await _mandateRepository.GetAllAsync();
                    mandate = mandates
                        .Where(m => m.GoCardlessCustomerId == gcCustomerId && string.IsNullOrEmpty(m.GoCardlessMandateId))
                        .OrderByDescending(m => m.CreatedDate)
                        .FirstOrDefault();

                    if (mandate != null)
                    {
                        mandate.GoCardlessMandateId = mandateId;
                    }
                }
            }

            if (mandate == null) return;

            switch (action)
            {
                case "created":
                case "submitted":
                case "active":
                    mandate.Status = action;
                    if (action == "active") mandate.ActivatedDate = DateTime.UtcNow;
                    break;
                case "failed":
                case "cancelled":
                case "expired":
                    mandate.Status = action;
                    mandate.CancelledDate = DateTime.UtcNow;
                    break;
            }

            await _mandateRepository.UpdateAsync(mandate);

            // Also update the customer record
            if (!string.IsNullOrEmpty(mandate.CustomerId))
            {
                var customer = await _customerRepository.GetByIdAsync(mandate.CustomerId);
                if (customer != null)
                {
                    customer.GoCardlessMandateId = mandateId;
                    customer.GoCardlessCustomerId = mandate.GoCardlessCustomerId;
                    customer.GoCardlessMandateStatus = mandate.Status;
                    await _customerRepository.UpdateAsync(customer);
                }
            }
        }

        private async Task HandlePaymentEvent(string? action, JsonElement links)
        {
            var paymentId = links.TryGetProperty("payment", out var pid) ? pid.GetString() : null;
            if (string.IsNullOrEmpty(paymentId)) return;

            var payment = await _paymentRepository.GetByGoCardlessPaymentIdAsync(paymentId);
            if (payment == null) return;

            payment.Status = action;

            switch (action)
            {
                case "confirmed":
                case "paid_out":
                    payment.PaidOutDate = DateTime.UtcNow;
                    // Auto-mark invoice as paid
                    if (payment.InvoiceId.HasValue)
                    {
                        var invoice = await _invoiceRepository.GetByIdAsync(payment.InvoiceId.Value);
                        if (invoice != null && invoice.Status != "Paid")
                        {
                            invoice.Status = "Paid";
                            invoice.DatePaid = DateTime.UtcNow;
                            await _invoiceRepository.UpdateAsync(invoice);
                            _logger.LogInformation("Invoice {InvoiceNumber} auto-marked as Paid via GoCardless webhook",
                                invoice.InvoiceNumber);
                        }
                    }
                    break;
                case "failed":
                case "cancelled":
                    var failDetail = links.TryGetProperty("cause", out var cause) ? cause.GetString() : action;
                    payment.FailureReason = failDetail;
                    break;
            }

            await _paymentRepository.UpdateAsync(payment);
        }

        /// <summary>
        /// Obtains a short-lived access token for the GoCardless Bank Account Data API.
        /// Uses the SecretId/SecretKey pair (Nordigen-style auth).
        /// </summary>
        private async Task<string?> GetBankDataTokenAsync()
        {
            var secretId = Environment.GetEnvironmentVariable("GoCardlessSecretId");
            var secretKey = Environment.GetEnvironmentVariable("GoCardlessSecretKey");
            if (string.IsNullOrEmpty(secretId) || string.IsNullOrEmpty(secretKey))
                return null;

            var client = _httpClientFactory.CreateClient();
            var payload = JsonSerializer.Serialize(new { secret_id = secretId, secret_key = secretKey });
            var resp = await client.PostAsync(
                $"{BankDataBaseUrl}/token/new/",
                new StringContent(payload, Encoding.UTF8, "application/json"));

            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("GoCardless Bank Data token request failed: {Status}", resp.StatusCode);
                return null;
            }

            var json = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.GetProperty("access").GetString();
        }
    }
}
