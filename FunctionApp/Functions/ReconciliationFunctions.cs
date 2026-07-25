using System;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;

namespace FinanceHubFunctions.Functions
{
    public class ReconciliationFunctions
    {
        private readonly ILogger<ReconciliationFunctions> _logger;
        private readonly IBankTransactionRepository? _bankTransactionRepository;
        private readonly IReconciliationRuleRepository? _ruleRepository;
        private readonly IReconciliationMatchRepository? _matchRepository;
        private readonly IInvoiceRepository? _invoiceRepository;
        private readonly IExpenseRepository? _expenseRepository;
        private readonly IDlaRepository? _dlaRepository;
        private readonly DeletionGuardService? _guard;

        public ReconciliationFunctions(
            ILogger<ReconciliationFunctions> logger,
            IBankTransactionRepository? bankTransactionRepository = null,
            IReconciliationRuleRepository? ruleRepository = null,
            IReconciliationMatchRepository? matchRepository = null,
            IInvoiceRepository? invoiceRepository = null,
            IExpenseRepository? expenseRepository = null,
            IDlaRepository? dlaRepository = null,
            DeletionGuardService? guard = null)
        {
            _logger = logger;
            _bankTransactionRepository = bankTransactionRepository;
            _ruleRepository = ruleRepository;
            _matchRepository = matchRepository;
            _invoiceRepository = invoiceRepository;
            _expenseRepository = expenseRepository;
            _dlaRepository = dlaRepository;
            _guard = guard;
        }

        private static string NormalizeMatchText(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;
            return new string(value
                .ToUpperInvariant()
                .Where(char.IsLetterOrDigit)
                .ToArray());
        }

        private static bool WithinDays(DateTime? left, DateTime? right, int days)
        {
            if (!left.HasValue || !right.HasValue) return false;
            return Math.Abs((left.Value.Date - right.Value.Date).TotalDays) <= days;
        }

        private async Task<bool> CreateMatchAndMarkAsync(int bankTransactionId, string relatedType, string relatedId, string notes)
        {
            if (_matchRepository == null || _bankTransactionRepository == null) return false;

            var created = await _matchRepository.CreateAsync(new ReconciliationMatch
            {
                BankTransactionId = bankTransactionId,
                RelatedType = relatedType,
                RelatedId = relatedId,
                MatchType = "Auto",
                Notes = notes,
                CreatedDate = DateTime.UtcNow
            });

            var transaction = await _bankTransactionRepository.GetByIdAsync(bankTransactionId);
            if (transaction != null)
            {
                transaction.IsReconciled = true;
                transaction.ReconciledOn = DateTime.UtcNow;
                transaction.ReconciledBy = "Auto";
                await _bankTransactionRepository.UpdateAsync(transaction);
            }

            return created != null;
        }

        [Function("GetUnreconciledTransactions")]
        public async Task<HttpResponseData> GetUnreconciledTransactions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "reconciliation/unreconciled")] HttpRequestData req)
        {
            if (_bankTransactionRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Bank transaction repository not available" });
                return response;
            }

            var transactions = await _bankTransactionRepository.GetUnreconciledAsync();
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(transactions);
            return ok;
        }

        [Function("CreateReconciliationMatch")]
        public async Task<HttpResponseData> CreateReconciliationMatch(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "reconciliation/match")] HttpRequestData req)
        {
            if (_matchRepository == null || _bankTransactionRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Reconciliation services not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var match = JsonSerializer.Deserialize<ReconciliationMatch>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (match == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid reconciliation match payload" });
                return bad;
            }

            match.CreatedDate = DateTime.UtcNow;
            var created = await _matchRepository.CreateAsync(match);

            var transaction = await _bankTransactionRepository.GetByIdAsync(match.BankTransactionId);
            if (transaction != null)
            {
                transaction.IsReconciled = true;
                transaction.ReconciledOn = DateTime.UtcNow;
                await _bankTransactionRepository.UpdateAsync(transaction);
            }

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(created);
            return ok;
        }

        [Function("AutoReconcileTransactions")]
        public async Task<HttpResponseData> AutoReconcileTransactions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "reconciliation/auto-match")] HttpRequestData req)
        {
            if (_bankTransactionRepository == null || _matchRepository == null || _invoiceRepository == null || _expenseRepository == null || _dlaRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Auto reconciliation services not available" });
                return response;
            }

            var transactions = (await _bankTransactionRepository.GetUnreconciledAsync()).ToList();
            var invoices = (await _invoiceRepository.GetAllAsync()).ToList();
            var expenses = (await _expenseRepository.GetAllAsync()).ToList();
            var dlaEntries = (await _dlaRepository.GetAllAsync()).ToList();

            var reconciled = 0;

            foreach (var tx in transactions)
            {
                var descriptionKey = NormalizeMatchText(tx.Description);
                var referenceKey = NormalizeMatchText(tx.Reference);
                var combinedKey = string.Concat(descriptionKey, referenceKey);

                if (string.IsNullOrEmpty(combinedKey))
                {
                    continue;
                }

                var matchedInvoice = invoices.FirstOrDefault(invoice =>
                {
                    if (!string.Equals(invoice.Status, "Paid", StringComparison.OrdinalIgnoreCase)) return false;
                    if (!string.Equals(tx.Direction, "In", StringComparison.OrdinalIgnoreCase)) return false;
                    var invoiceNumberKey = NormalizeMatchText(invoice.InvoiceNumber);
                    var poReferenceKey = NormalizeMatchText(invoice.POReference);
                    var amountMatches = tx.Amount.HasValue && tx.Amount.Value == invoice.AmountGross;
                    return amountMatches && (
                        (!string.IsNullOrEmpty(invoiceNumberKey) && combinedKey.Contains(invoiceNumberKey, StringComparison.Ordinal)) ||
                        (!string.IsNullOrEmpty(poReferenceKey) && combinedKey.Contains(poReferenceKey, StringComparison.Ordinal))
                    );
                });

                if (matchedInvoice != null)
                {
                    if (await CreateMatchAndMarkAsync(tx.Id, "Invoice", matchedInvoice.Id.ToString(), $"Matched invoice {matchedInvoice.InvoiceNumber}"))
                    {
                        reconciled++;
                        continue;
                    }
                }

                var matchedDla = dlaEntries.FirstOrDefault(dla =>
                {
                    if (!string.Equals(tx.Direction, "Out", StringComparison.OrdinalIgnoreCase)) return false;
                    var dlaIdKey = NormalizeMatchText(dla.DlaId);
                    var amountMatches = tx.Amount.HasValue && tx.Amount.Value == dla.AmountGross;
                    return amountMatches && !string.IsNullOrEmpty(dlaIdKey) && combinedKey.Contains(dlaIdKey, StringComparison.Ordinal);
                });

                if (matchedDla != null)
                {
                    if (await CreateMatchAndMarkAsync(tx.Id, "DLA", matchedDla.Id.ToString(), $"Matched DLA {matchedDla.DlaId}"))
                    {
                        reconciled++;
                        continue;
                    }
                }

                var matchedExpense = expenses.FirstOrDefault(expense =>
                {
                    if (!string.Equals(tx.Direction, "Out", StringComparison.OrdinalIgnoreCase)) return false;
                    if (!expense.AmountGross.HasValue || !tx.Amount.HasValue || expense.AmountGross.Value != tx.Amount.Value) return false;

                    var expenseIdKey = NormalizeMatchText(expense.ExpenseId);
                    var expenseRefKey = NormalizeMatchText(expense.Reference);
                    var supplierKey = NormalizeMatchText(expense.SupplierFreeText ?? expense.Supplier);

                    var referenceMatch =
                        (!string.IsNullOrEmpty(expenseIdKey) && combinedKey.Contains(expenseIdKey, StringComparison.Ordinal)) ||
                        (!string.IsNullOrEmpty(expenseRefKey) && combinedKey.Contains(expenseRefKey, StringComparison.Ordinal)) ||
                        (!string.IsNullOrEmpty(supplierKey) && combinedKey.Contains(supplierKey, StringComparison.Ordinal));

                    return referenceMatch && (WithinDays(tx.TransactionDate, expense.EntryDate, 14) || WithinDays(tx.TransactionDate, expense.DatePaid, 14));
                });

                if (matchedExpense != null)
                {
                    if (await CreateMatchAndMarkAsync(tx.Id, "Expense", matchedExpense.Id.ToString(), $"Matched expense {matchedExpense.ExpenseId ?? matchedExpense.Reference ?? matchedExpense.Supplier}"))
                    {
                        reconciled++;
                    }
                }
            }

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(new
            {
                reconciled,
                remaining = Math.Max(0, transactions.Count - reconciled),
                message = $"Auto-reconciled {reconciled} transaction(s)"
            });
            return ok;
        }

        [Function("GetReconciliationRules")]
        public async Task<HttpResponseData> GetReconciliationRules(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "reconciliation/rules")] HttpRequestData req)
        {
            if (_ruleRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Rule repository not available" });
                return response;
            }

            var rules = await _ruleRepository.GetAllAsync();
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(rules);
            return ok;
        }

        [Function("CreateReconciliationRule")]
        public async Task<HttpResponseData> CreateReconciliationRule(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "reconciliation/rules")] HttpRequestData req)
        {
            if (_ruleRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Rule repository not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var rule = JsonSerializer.Deserialize<ReconciliationRule>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (rule == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid rule payload" });
                return bad;
            }

            rule.CreatedDate = DateTime.UtcNow;
            rule.ModifiedDate = DateTime.UtcNow;
            var created = await _ruleRepository.CreateAsync(rule);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(created);
            return ok;
        }

        [Function("UpdateReconciliationRule")]
        public async Task<HttpResponseData> UpdateReconciliationRule(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "reconciliation/rules/{id:int}")] HttpRequestData req,
            int id)
        {
            if (_ruleRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Rule repository not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var rule = JsonSerializer.Deserialize<ReconciliationRule>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (rule == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid rule payload" });
                return bad;
            }

            rule.Id = id;
            rule.ModifiedDate = DateTime.UtcNow;
            var updated = await _ruleRepository.UpdateAsync(rule);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(updated);
            return ok;
        }

        [Function("DeleteReconciliationRule")]
        public async Task<HttpResponseData> DeleteReconciliationRule(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "reconciliation/rules/{id:int}")] HttpRequestData req,
            int id)
        {
            if (_ruleRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Rule repository not available" });
                return response;
            }

            if (_guard != null)
            {
                var blocked = await _guard.GuardAsync(req, "reconciliation rule");
                if (blocked != null) return blocked;
            }

            await _ruleRepository.DeleteAsync(id);
            return req.CreateResponse(HttpStatusCode.OK);
        }
    }
}
