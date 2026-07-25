using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
        private readonly IDlaPaymentRepository? _dlaPaymentRepository;
        private readonly IBillRepository? _billRepository;
        private readonly DeletionGuardService? _guard;

        public ReconciliationFunctions(
            ILogger<ReconciliationFunctions> logger,
            IBankTransactionRepository? bankTransactionRepository = null,
            IReconciliationRuleRepository? ruleRepository = null,
            IReconciliationMatchRepository? matchRepository = null,
            IInvoiceRepository? invoiceRepository = null,
            IExpenseRepository? expenseRepository = null,
            IDlaRepository? dlaRepository = null,
            IDlaPaymentRepository? dlaPaymentRepository = null,
            IBillRepository? billRepository = null,
            DeletionGuardService? guard = null)
        {
            _logger = logger;
            _bankTransactionRepository = bankTransactionRepository;
            _ruleRepository = ruleRepository;
            _matchRepository = matchRepository;
            _invoiceRepository = invoiceRepository;
            _expenseRepository = expenseRepository;
            _dlaRepository = dlaRepository;
            _dlaPaymentRepository = dlaPaymentRepository;
            _billRepository = billRepository;
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

        private static decimal? AbsAmount(decimal? value)
        {
            return value.HasValue ? Math.Abs(value.Value) : null;
        }

        private static bool AmountMatches(decimal? left, decimal? right)
        {
            var l = AbsAmount(left);
            var r = AbsAmount(right);
            if (!l.HasValue || !r.HasValue) return false;
            return Math.Abs(l.Value - r.Value) < 0.01m;
        }

        private static bool AmountClose(decimal? left, decimal? right, decimal tolerance)
        {
            var l = AbsAmount(left);
            var r = AbsAmount(right);
            if (!l.HasValue || !r.HasValue) return false;
            return Math.Abs(l.Value - r.Value) <= tolerance;
        }

        private static bool IsDirectionIn(BankTransaction tx)
        {
            var d = (tx.Direction ?? string.Empty).Trim();
            return string.Equals(d, "In", StringComparison.OrdinalIgnoreCase)
                || string.Equals(d, "Credit", StringComparison.OrdinalIgnoreCase)
                || string.Equals(d, "Incoming", StringComparison.OrdinalIgnoreCase)
                || string.Equals(d, "MoneyIn", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsDirectionOut(BankTransaction tx)
        {
            var d = (tx.Direction ?? string.Empty).Trim();
            return string.Equals(d, "Out", StringComparison.OrdinalIgnoreCase)
                || string.Equals(d, "Debit", StringComparison.OrdinalIgnoreCase)
                || string.Equals(d, "Outgoing", StringComparison.OrdinalIgnoreCase)
                || string.Equals(d, "MoneyOut", StringComparison.OrdinalIgnoreCase);
        }

        private static int ScoreCandidate(BankTransaction tx, string combinedKey, decimal candidateAmount, string? candidatePrimaryRef, string? candidateSecondaryRef, DateTime? candidateDate)
        {
            var primaryKey = NormalizeMatchText(candidatePrimaryRef);
            var secondaryKey = NormalizeMatchText(candidateSecondaryRef);
            var primaryRefHit = !string.IsNullOrEmpty(primaryKey) && combinedKey.Contains(primaryKey, StringComparison.Ordinal);
            var secondaryRefHit = !string.IsNullOrEmpty(secondaryKey) && combinedKey.Contains(secondaryKey, StringComparison.Ordinal);

            var score = 0;
            if (AmountMatches(tx.Amount, candidateAmount))
            {
                score += 70; // exact amount remains the strongest signal
            }
            else if (AmountClose(tx.Amount, candidateAmount, 1.00m))
            {
                score += 50;
            }
            else if (AmountClose(tx.Amount, candidateAmount, 5.00m))
            {
                score += 35;
            }
            else if (primaryRefHit)
            {
                // Allow strong reference hits into preview even if amount differs.
                // User can confirm/reject before apply.
                score += 20;
            }

            if (score == 0) return 0;

            if (primaryRefHit)
            {
                score += 25;
            }

            if (secondaryRefHit)
            {
                score += 15;
            }

            if (WithinDays(tx.TransactionDate, candidateDate, 7))
            {
                score += 10;
            }
            else if (WithinDays(tx.TransactionDate, candidateDate, 30))
            {
                score += 5;
            }

            return score;
        }

        private List<AutoCandidate> BuildCandidates(BankTransaction tx, List<Invoice> invoices, List<Expense> expenses, List<DlaEntry> dlaEntries, List<DlaPayment> dlaPayments, List<Bill> bills)
        {
            var descriptionKey = NormalizeMatchText(tx.Description);
            var referenceKey = NormalizeMatchText(tx.Reference);
            var externalIdKey = NormalizeMatchText(tx.ExternalId);
            var merchantKey = NormalizeMatchText(tx.TrueLayerMerchantName ?? tx.MonzoMerchantName);
            var combinedKey = string.Concat(descriptionKey, referenceKey, externalIdKey, merchantKey);

            var candidates = new List<AutoCandidate>();
            var canMatchIn = IsDirectionIn(tx) || !IsDirectionOut(tx);
            var canMatchOut = IsDirectionOut(tx) || !IsDirectionIn(tx);

            if (canMatchIn)
            {
                foreach (var invoice in invoices)
                {
                    var score = ScoreCandidate(
                        tx,
                        combinedKey,
                        invoice.AmountGross,
                        invoice.InvoiceNumber,
                        invoice.POReference,
                        invoice.DatePaid ?? invoice.DateIssued);

                    if (score <= 0) continue;

                    if (string.Equals(invoice.Status, "Paid", StringComparison.OrdinalIgnoreCase))
                    {
                        score += 5;
                    }

                    candidates.Add(new AutoCandidate
                    {
                        RelatedType = "Invoice",
                        RelatedId = invoice.Id.ToString(),
                        Display = $"Invoice {invoice.InvoiceNumber} ({invoice.CustomerName})",
                        Notes = $"Matched invoice {invoice.InvoiceNumber}",
                        Score = score
                    });
                }
            }

            if (canMatchOut)
            {
                foreach (var payment in dlaPayments)
                {
                    var score = ScoreCandidate(
                        tx,
                        combinedKey,
                        payment.Amount,
                        payment.PaymentId ?? payment.DlaId,
                        payment.PaymentReference ?? payment.Director,
                        payment.PaymentDate);

                    if (score <= 0) continue;

                    candidates.Add(new AutoCandidate
                    {
                        RelatedType = "DLA-Payment",
                        RelatedId = payment.Id.ToString(),
                        Display = $"DLA Payment {payment.PaymentId} ({payment.DlaId})",
                        Notes = $"Matched DLA payment {payment.PaymentId ?? payment.DlaId}",
                        Score = score + 5
                    });
                }

                foreach (var dla in dlaEntries)
                {
                    var score = ScoreCandidate(
                        tx,
                        combinedKey,
                        dla.AmountGross,
                        dla.DlaId,
                        dla.Description,
                        dla.DatePaid ?? dla.EntryDate);

                    if (score <= 0) continue;

                    candidates.Add(new AutoCandidate
                    {
                        RelatedType = "DLA",
                        RelatedId = dla.Id.ToString(),
                        Display = $"DLA {dla.DlaId} ({dla.Director})",
                        Notes = $"Matched DLA {dla.DlaId}",
                        Score = score
                    });
                }

                foreach (var bill in bills)
                {
                    var billAmount = bill.AmountPaid > 0 ? bill.AmountPaid : bill.AmountGross;
                    var score = ScoreCandidate(
                        tx,
                        combinedKey,
                        billAmount,
                        bill.BillNumber,
                        bill.PaymentReference ?? bill.SupplierReference ?? bill.SupplierName,
                        bill.DatePaid ?? bill.DateIssued);

                    if (score <= 0) continue;

                    candidates.Add(new AutoCandidate
                    {
                        RelatedType = "Bill",
                        RelatedId = bill.Id.ToString(),
                        Display = $"Bill {bill.BillNumber} ({bill.SupplierName})",
                        Notes = $"Matched bill {bill.BillNumber}",
                        Score = score
                    });
                }

                foreach (var expense in expenses)
                {
                    var score = ScoreCandidate(
                        tx,
                        combinedKey,
                        expense.AmountGross ?? 0m,
                        expense.ExpenseId ?? expense.Reference,
                        expense.SupplierFreeText ?? expense.Supplier,
                        expense.DatePaid ?? expense.EntryDate);

                    if (score <= 0) continue;

                    var labelRef = expense.ExpenseId ?? expense.Reference ?? expense.Supplier ?? "(no ref)";
                    candidates.Add(new AutoCandidate
                    {
                        RelatedType = "Expense",
                        RelatedId = expense.Id.ToString(),
                        Display = $"Expense {labelRef}",
                        Notes = $"Matched expense {labelRef}",
                        Score = score
                    });
                }
            }

            return candidates
                .OrderByDescending(c => c.Score)
                .ThenBy(c => c.RelatedType)
                .ToList();
        }

        private object BuildPreviewResponse(List<BankTransaction> transactions, List<Invoice> invoices, List<Expense> expenses, List<DlaEntry> dlaEntries, List<DlaPayment> dlaPayments, List<Bill> bills)
        {
            var proposals = new List<object>();
            var unmatched = new List<object>();
            var ambiguous = 0;

            foreach (var tx in transactions)
            {
                var candidates = BuildCandidates(tx, invoices, expenses, dlaEntries, dlaPayments, bills);

                if (candidates.Count == 0)
                {
                    unmatched.Add(new
                    {
                        bankTransactionId = tx.Id,
                        date = tx.TransactionDate,
                        description = tx.Description,
                        amount = tx.Amount,
                        direction = tx.Direction
                    });
                    continue;
                }

                var top = candidates[0];
                var second = candidates.Count > 1 ? candidates[1] : null;
                var isAmbiguous = second != null && (top.Score - second.Score) <= 10;
                if (isAmbiguous) ambiguous++;

                proposals.Add(new
                {
                    bankTransactionId = tx.Id,
                    date = tx.TransactionDate,
                    description = tx.Description,
                    amount = tx.Amount,
                    direction = tx.Direction,
                    isAmbiguous,
                    recommended = new
                    {
                        relatedType = top.RelatedType,
                        relatedId = top.RelatedId,
                        display = top.Display,
                        notes = top.Notes,
                        score = top.Score
                    },
                    candidates = candidates.Select(c => new
                    {
                        relatedType = c.RelatedType,
                        relatedId = c.RelatedId,
                        display = c.Display,
                        notes = c.Notes,
                        score = c.Score
                    }).Take(6).ToList()
                });
            }

            return new
            {
                totalTransactions = transactions.Count,
                proposedCount = proposals.Count,
                ambiguousCount = ambiguous,
                unmatchedCount = unmatched.Count,
                proposals,
                unmatched,
                message = $"Found {proposals.Count} potential reconciliation(s); {ambiguous} need manual confirmation"
            };
        }

        private class AutoCandidate
        {
            public string RelatedType { get; set; } = string.Empty;
            public string RelatedId { get; set; } = string.Empty;
            public string Display { get; set; } = string.Empty;
            public string Notes { get; set; } = string.Empty;
            public int Score { get; set; }
        }

        private class AutoReconcileSelection
        {
            public int BankTransactionId { get; set; }
            public string? RelatedType { get; set; }
            public string? RelatedId { get; set; }
            public string? Notes { get; set; }
        }

        private class AutoReconcileApplyRequest
        {
            public AutoReconcileSelection[]? Proposals { get; set; }
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
            var dlaPayments = _dlaPaymentRepository != null ? await _dlaPaymentRepository.GetAllAsync() : new List<DlaPayment>();
            var bills = _billRepository != null ? (await _billRepository.GetAllAsync()).ToList() : new List<Bill>();

            var reconciled = 0;
            foreach (var tx in transactions)
            {
                var candidates = BuildCandidates(tx, invoices, expenses, dlaEntries, dlaPayments, bills);
                if (candidates.Count == 0) continue;

                var top = candidates[0];
                var second = candidates.Count > 1 ? candidates[1] : null;
                var isAmbiguous = second != null && (top.Score - second.Score) <= 10;
                if (isAmbiguous) continue;

                if (await CreateMatchAndMarkAsync(tx.Id, top.RelatedType, top.RelatedId, top.Notes))
                {
                    reconciled++;
                }
            }

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(new
            {
                reconciled,
                remaining = Math.Max(0, transactions.Count - reconciled),
                message = $"Auto-reconciled {reconciled} transaction(s) using high-confidence value matches"
            });
            return ok;
        }

        [Function("AutoReconcilePreview")]
        public async Task<HttpResponseData> AutoReconcilePreview(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "reconciliation/auto-match/preview")] HttpRequestData req)
        {
            if (_bankTransactionRepository == null || _invoiceRepository == null || _expenseRepository == null || _dlaRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Auto reconciliation services not available" });
                return response;
            }

            var transactions = (await _bankTransactionRepository.GetUnreconciledAsync()).ToList();
            var invoices = (await _invoiceRepository.GetAllAsync()).ToList();
            var expenses = (await _expenseRepository.GetAllAsync()).ToList();
            var dlaEntries = (await _dlaRepository.GetAllAsync()).ToList();
            var dlaPayments = _dlaPaymentRepository != null ? await _dlaPaymentRepository.GetAllAsync() : new List<DlaPayment>();
            var bills = _billRepository != null ? (await _billRepository.GetAllAsync()).ToList() : new List<Bill>();

            var preview = BuildPreviewResponse(transactions, invoices, expenses, dlaEntries, dlaPayments, bills);
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(preview);
            return ok;
        }

        [Function("ApplyAutoReconcile")]
        public async Task<HttpResponseData> ApplyAutoReconcile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "reconciliation/auto-match/apply")] HttpRequestData req)
        {
            if (_bankTransactionRepository == null || _matchRepository == null)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = "Auto reconciliation services not available" });
                return response;
            }

            var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var applyRequest = JsonSerializer.Deserialize<AutoReconcileApplyRequest>(requestBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            var selections = applyRequest?.Proposals ?? Array.Empty<AutoReconcileSelection>();

            if (selections.Length == 0)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "No proposals supplied" });
                return bad;
            }

            var applied = 0;
            var skipped = 0;

            foreach (var selection in selections)
            {
                if (selection.BankTransactionId <= 0 || string.IsNullOrWhiteSpace(selection.RelatedType) || string.IsNullOrWhiteSpace(selection.RelatedId))
                {
                    skipped++;
                    continue;
                }

                var tx = await _bankTransactionRepository.GetByIdAsync(selection.BankTransactionId);
                if (tx == null || tx.IsReconciled)
                {
                    skipped++;
                    continue;
                }

                var notes = string.IsNullOrWhiteSpace(selection.Notes) ? "Auto reconciliation (confirmed)" : selection.Notes;
                var ok = await CreateMatchAndMarkAsync(selection.BankTransactionId, selection.RelatedType, selection.RelatedId, notes);
                if (ok) applied++;
                else skipped++;
            }

            var responseOk = req.CreateResponse(HttpStatusCode.OK);
            await responseOk.WriteAsJsonAsync(new
            {
                applied,
                skipped,
                message = $"Applied {applied} reconciliation(s); skipped {skipped}"
            });
            return responseOk;
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
