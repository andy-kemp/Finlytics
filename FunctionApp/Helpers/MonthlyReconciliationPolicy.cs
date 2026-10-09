#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed record MonthlyReconciliationAction(string? ExternalId, string? Action, string? RelatedType, string? RelatedId,
        string? Supplier, string? Category, string? CtTag, decimal? VatAmount, string? ReceiptBlob);

    public sealed record MonthlyReconciliationRequest(int? BankAccountId, List<MonthlyReconciliationAction>? Actions);

    public static class MonthlyReconciliationPolicy
    {
        public const string Actor = "Monthly reconciliation";
        public const string ReceiptPending = "Receipt pending upload - match from receipt inbox or upload original invoice";
        public const int MaxActions = 200;
        public static readonly string[] LinkTypes = { "Invoice", "Expense", "DLA-Payment", "CompanyLedger" };
        public static readonly string[] CtTags = { "Revenue", "Capital", "NonCT" };
        public static readonly string[] CashLedgerTypes = { "Dividend_Paid", "CorpTax_Paid", "VAT_Paid", "VAT_Reclaim", "DLA_Payment", "DLA_Out", "DLA_In", "Salary", "PAYE" };

        public static string? Validate(MonthlyReconciliationRequest request)
        {
            if (request.BankAccountId is not > 0) return "bankAccountId is required";
            var actions = request.Actions;
            if (actions == null || actions.Count == 0 || actions.Count > MaxActions) return $"Between 1 and {MaxActions} actions are required";
            if (actions.Any(action => string.IsNullOrWhiteSpace(action.ExternalId) || action.ExternalId.Length > 100))
                return "Each action needs the statement transaction ID";
            if (actions.Select(action => action.ExternalId).Distinct(StringComparer.Ordinal).Count() != actions.Count)
                return "Each statement transaction can only appear once";
            var receipts = actions.Where(action => action.ReceiptBlob != null).Select(action => action.ReceiptBlob).ToList();
            if (receipts.Distinct(StringComparer.Ordinal).Count() != receipts.Count) return "Each inbox receipt can only be used once";
            foreach (var action in actions)
            {
                if (action.Action == "link")
                {
                    if (!LinkTypes.Contains(action.RelatedType) || !int.TryParse(action.RelatedId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0)
                        return "Links need a supported record type and ID";
                    if (action.Supplier != null || action.Category != null || action.CtTag != null || action.VatAmount != null || action.ReceiptBlob != null)
                        return "Links cannot carry expense fields";
                }
                else if (action.Action == "createExpense")
                {
                    if (action.RelatedType != null || action.RelatedId != null) return "New expenses cannot reference another record";
                    if (string.IsNullOrWhiteSpace(action.Supplier) || action.Supplier.Trim().Length > 255) return "Expenses need a supplier (max 255 characters)";
                    if (string.IsNullOrWhiteSpace(action.Category) || action.Category.Trim().Length > 100) return "Expenses need a category (max 100 characters)";
                    if (!CtTags.Contains(action.CtTag)) return "ctTag must be Revenue, Capital or NonCT";
                    if (action.VatAmount is < 0 || (action.VatAmount.HasValue && decimal.Round(action.VatAmount.Value, 2) != action.VatAmount.Value))
                        return "vatAmount must be a non-negative whole-penny amount";
                    if (action.ReceiptBlob != null && !ReceiptInboxPolicy.ValidBlobName(action.ReceiptBlob)) return "Invalid inbox receipt";
                }
                else return "action must be link or createExpense";
            }
            return null;
        }

        public static string? ValidateVat(BankTransaction bank, decimal? vat)
        {
            if (vat is not > 0) return null;
            if (IsForeign(bank)) return "VAT cannot be claimed on a foreign-currency card payment from the bank amount; record it from a UK VAT invoice";
            return vat.Value > decimal.Round((bank.Amount ?? 0) / 6m, 2, MidpointRounding.AwayFromZero)
                ? "VAT cannot exceed one sixth of the amount paid (20% VAT-inclusive)" : null;
        }

        public static bool IsForeign(BankTransaction bank) => bank.OriginalCurrency is "EUR" or "USD" && bank.OriginalAmount is not null and not 0;

        public static string ExpenseCode(string externalId)
        {
            var clean = Regex.Replace(externalId, "[^A-Za-z0-9]", "");
            return "BANK-" + (clean.Length > 15 ? clean[^15..] : clean);
        }

        public static string TaxYear(DateTime date)
        {
            var start = date.Month < 4 || (date.Month == 4 && date.Day < 6) ? date.Year - 1 : date.Year;
            return $"{start}/{(start + 1) % 100:D2}";
        }

        public static string FinancialYear(DateTime date, CompanySettings? settings)
        {
            if (settings?.FYStartMonth == null || settings.FYStartDay == null) return TaxYear(date);
            var start = date.Month < settings.FYStartMonth || (date.Month == settings.FYStartMonth && date.Day < settings.FYStartDay)
                ? date.Year - 1 : date.Year;
            return $"{start}/{(start + 1) % 100:D2}";
        }

        public static Expense BuildExpense(BankTransaction bank, MonthlyReconciliationAction action, Supplier? supplier, CompanySettings? settings)
        {
            var date = bank.TransactionDate!.Value.Date;
            var gross = decimal.Round(bank.Amount ?? 0, 2);
            var vat = action.VatAmount ?? 0m;
            var foreign = IsForeign(bank);
            var original = foreign ? Math.Abs(bank.OriginalAmount!.Value) : (decimal?)null;
            var supplierName = action.Supplier!.Trim();
            return new Expense
            {
                ExpenseId = ExpenseCode(bank.ExternalId ?? bank.MonzoTransactionId!),
                Supplier = supplier?.Name ?? supplierName,
                SupplierFreeText = supplier == null ? supplierName : null,
                Reference = bank.ExternalId ?? bank.MonzoTransactionId,
                Category = action.Category!.Trim(),
                CtTag = action.CtTag,
                AmountGross = gross, VATAmount = vat, AmountNet = gross - vat,
                VATIncluded = vat > 0, VATApplicability = vat > 0 ? "Standard" : "Outside Scope", VATRate = vat > 0 ? 20 : 0,
                IsDLA = false, DatePaid = date, EntryDate = date,
                PaymentMethod = Regex.IsMatch(bank.Description ?? "", "card payment", RegexOptions.IgnoreCase) ? "Card" : "Bank Transfer",
                OriginalCurrency = foreign ? bank.OriginalCurrency : null,
                OriginalAmountGross = original, OriginalAmountNet = original, OriginalVatAmount = foreign ? 0 : null,
                ExchangeRateToGbp = foreign ? decimal.Round(gross / original!.Value, 8) : null,
                ExchangeRateDate = foreign ? date : null,
                ExchangeRateSource = foreign ? "Actual bank settlement" : null,
                EstimatedGbpGross = foreign ? gross : null,
                ActualGbpPaid = gross, SettlementDate = date, SettlementBankTransactionId = bank.Id,
                NoReceiptReason = action.ReceiptBlob == null ? ReceiptPending : null,
                TaxYear = TaxYear(date), FinancialYear = FinancialYear(date, settings),
                Notes = $"Created by monthly bank reconciliation from statement transaction {bank.ExternalId ?? bank.MonzoTransactionId} ({bank.Description})."
                    + (foreign ? $" Paid {bank.OriginalCurrency} {original:0.00}; no UK VAT claimed." : "")
            };
        }

        public static decimal? RelatedAmount(string type, object record) => record switch
        {
            Invoice invoice when type == "Invoice" => invoice.AmountGross,
            Expense expense when type == "Expense" => expense.ActualGbpPaid ?? expense.AmountGross,
            DlaPayment payment when type == "DLA-Payment" => payment.Amount,
            CompanyLedgerEntry entry when type == "CompanyLedger" => entry.Amount,
            _ => null
        };
    }
}
