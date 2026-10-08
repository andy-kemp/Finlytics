using System;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    public class RecurringExpenseFunction
    {
        private readonly ILogger _logger;
        private readonly IExpenseRepository _expenseRepository;

        public RecurringExpenseFunction(
            ILoggerFactory loggerFactory,
            IExpenseRepository expenseRepository)
        {
            _logger = loggerFactory.CreateLogger<RecurringExpenseFunction>();
            _expenseRepository = expenseRepository;
        }

        /// <summary>
        /// Timer-triggered function: runs daily at 07:00 UTC.
        /// For every recurring expense whose RecurringNextDate is today or in the past,
        /// creates a new expense record and advances RecurringNextDate to the next period.
        /// </summary>
        [Function("ProcessRecurringExpenses")]
        public async Task RunAsync([TimerTrigger("0 0 7 * * *")] TimerInfo myTimer)
        {
            _logger.LogInformation($"RecurringExpenseFunction timer fired at {DateTime.UtcNow:o}");

            var dueExpenses = await _expenseRepository.GetDueRecurringAsync();
            int created = 0;
            int failed = 0;

            foreach (var template in dueExpenses)
            {
                try
                {
                    if (template.OriginalCurrency == "EUR" || template.OriginalCurrency == "USD")
                    {
                        _logger.LogWarning("Foreign recurring expense {Id} requires a fresh invoice-date exchange rate and confirmation; generation skipped", template.Id);
                        continue;
                    }
                    // Calculate the new entry date and financial year
                    var today = DateTime.UtcNow.Date;
                    var entryDate = template.RecurringNextDate?.Date ?? today;

                    // Work out the financial year for the new record
                    var fy = CalculateFinancialYear(entryDate);

                    // Build the new expense (same values, fresh dates)
                    var newExpense = new Expense
                    {
                        Supplier = template.Supplier,
                        SupplierFreeText = template.SupplierFreeText,
                        Reference = template.Reference,
                        Category = template.Category,
                        VATApplicability = template.VATApplicability,
                        VATIncluded = template.VATIncluded,
                        VATRate = template.VATRate,
                        AmountNet = template.AmountNet,
                        VATAmount = template.VATAmount,
                        AmountGross = template.AmountGross,
                        OriginalCurrency = "GBP",
                        EntryDate = entryDate,
                        DatePaid = null,
                        PaymentMethod = template.PaymentMethod,
                        Notes = $"[Auto-generated recurring expense] {template.Notes}".Trim(),
                        TaxYear = template.TaxYear,
                        FinancialYear = fy,
                        IsDLA = false,
                        CtTag = template.CtTag,
                        IsTrivialBenefit = false,
                        // Not recurring itself — it's the generated instance
                        IsRecurring = false,
                        RecurringFrequency = null,
                        RecurringNextDate = null
                    };

                    await _expenseRepository.CreateAsync(newExpense);
                    created++;

                    _logger.LogInformation($"Created recurring expense instance for '{template.Supplier}' (template ID {template.Id}) dated {entryDate:yyyy-MM-dd}.");

                    // Advance the template's next due date
                    template.RecurringNextDate = AdvanceNextDate(entryDate, template.RecurringFrequency);
                    await _expenseRepository.UpdateAsync(template);

                    _logger.LogInformation($"Template ID {template.Id} next due date advanced to {template.RecurringNextDate:yyyy-MM-dd}.");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"Error processing recurring expense template ID {template.Id}");
                    failed++;
                }
            }

            _logger.LogInformation($"RecurringExpense run complete. Created: {created}, Failed: {failed}.");
        }

        private static DateTime AdvanceNextDate(DateTime current, string frequency)
        {
            return frequency?.ToLowerInvariant() switch
            {
                "monthly" => current.AddMonths(1),
                "quarterly" => current.AddMonths(3),
                "annual" => current.AddYears(1),
                _ => current.AddMonths(1) // default monthly
            };
        }

        private static string CalculateFinancialYear(DateTime date)
        {
            // UK financial year: April 6 → April 5 next year
            var startYear = date.Month < 4 || (date.Month == 4 && date.Day <= 5)
                ? date.Year - 1
                : date.Year;
            return $"{startYear}/{(startYear + 1) % 100:D2}";
        }
    }
}
