using System;
using System.Data;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    public class GbpSettlementFunctions
    {
        private readonly FinanceHubDbContext _db;
        private readonly ILogger<GbpSettlementFunctions> _logger;
        private readonly SettlementAuthService _auth;

        public GbpSettlementFunctions(FinanceHubDbContext db, ILogger<GbpSettlementFunctions> logger,
            SettlementAuthService auth)
        {
            _db = db;
            _logger = logger;
            _auth = auth;
        }

        [Function("PatchExpenseGbpSettlement")]
        public async Task<HttpResponseData> PatchExpenseGbpSettlement(
            [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "expenses/{id:int}/gbp-settlement")] HttpRequestData req,
            int id)
        {
            async Task<HttpResponseData> Error(HttpStatusCode status, string message)
            {
                var response = req.CreateResponse(status);
                await response.WriteAsJsonAsync(new { error = message }, status);
                return response;
            }

            var authorization = await _auth.ValidateRequest(req);
            if (!authorization.IsAuthorized)
                return await Error(authorization.StatusCode, authorization.Error!);

            var body = await req.ReadAsStringAsync();
            if (!ForeignCurrencyHelper.TryRead<GbpSettlementRequest>(body, out var request, out var parseError))
                return await Error(HttpStatusCode.BadRequest, parseError!);
            using var document = JsonDocument.Parse(body!);
            var allowed = new[] { "actualGbpPaid", "settlementDate", "settlementBankTransactionId" };
            var names = document.RootElement.EnumerateObject().Select(property => property.Name).ToList();
            if (names.Any(name => !allowed.Contains(name, StringComparer.OrdinalIgnoreCase))
                || names.Distinct(StringComparer.OrdinalIgnoreCase).Count() != names.Count)
                return await Error(HttpStatusCode.BadRequest, "Only actualGbpPaid, settlementDate and settlementBankTransactionId are accepted");

            try
            {
                return await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    _db.ChangeTracker.Clear();
                    await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                    var expense = await _db.Expenses.SingleOrDefaultAsync(record => record.Id == id);
                    if (expense == null) return await Error(HttpStatusCode.NotFound, "Expense not found");
                    var validationError = GbpSettlementPolicy.Validate(expense, request!, expense.IsDLA == true);
                    if (validationError != null) return await Error(HttpStatusCode.BadRequest, validationError);
                    if (GbpSettlementPolicy.Conflicts(expense, request!))
                        return await Error(HttpStatusCode.Conflict, "Expense already has a different confirmed settlement");

                    if (request!.SettlementBankTransactionId.HasValue)
                    {
                        var bankId = request.SettlementBankTransactionId.Value;
                        var bank = await _db.BankTransactions.SingleOrDefaultAsync(record => record.Id == bankId);
                        var account = bank == null ? null : await _db.BankAccounts.SingleOrDefaultAsync(record => record.Id == bank.BankAccountId);
                        validationError = GbpSettlementPolicy.ValidateBank(expense, request, bank, account);
                        if (validationError != null) return await Error(HttpStatusCode.BadRequest, validationError);
                        if (await _db.Expenses.AnyAsync(record => record.Id != id && record.SettlementBankTransactionId == bankId)
                            || await _db.DlaEntries.AnyAsync(record => record.SettlementBankTransactionId == bankId))
                            return await Error(HttpStatusCode.Conflict, "Bank transaction is already linked to another expense or DLA entry");
                    }

                    expense.ActualGbpPaid = request!.ActualGbpPaid;
                    expense.SettlementDate = request.SettlementDate!.Value.Date;
                    expense.SettlementBankTransactionId = request.SettlementBankTransactionId;
                    await _db.SaveChangesAsync();
                    await transaction.CommitAsync();
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    await response.WriteAsJsonAsync(new
                    {
                        expense.Id,
                        expense.ActualGbpPaid,
                        expense.SettlementDate,
                        expense.SettlementBankTransactionId
                    });
                    return response;
                });
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Error confirming GBP settlement for expense {Id}", id);
                return await Error(HttpStatusCode.ServiceUnavailable, "Settlement could not be confirmed; retry the same request");
            }
        }
    }
}