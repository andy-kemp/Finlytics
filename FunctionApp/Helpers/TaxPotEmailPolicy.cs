#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Helpers
{
    public sealed record TaxPotComparison(string Name, decimal Balance, decimal Estimated)
    {
        public decimal Difference => decimal.Round(Balance - Math.Max(0, Estimated), 2, MidpointRounding.AwayFromZero);
        public string Suggestion => Difference > 0 ? $"Estimated surplus: withdraw {TaxPotEmailPolicy.Money(Difference)} to the main account"
            : Difference < 0 ? $"Top up by {TaxPotEmailPolicy.Money(-Difference)} from the main account" : "Pot matches the estimate";
    }

    public static class TaxPotEmailPolicy
    {
        public static string Money(decimal amount) => amount.ToString("C2", CultureInfo.GetCultureInfo("en-GB"));
        private static decimal Pennies(decimal amount) => decimal.Round(amount, 2, MidpointRounding.AwayFromZero);

        public static decimal CorporationTax(RecordedCashSources sources, CompanySettings settings, DateTime now)
        {
            var taxYear = now.Date < new DateTime(now.Year, 4, 6) ? now.Year - 1 : now.Year;
            var start = settings.CompanyInceptionDate ?? settings.IncorporationDate ?? new DateTime(taxYear, 4, 6);
            var income = sources.Invoices.Where(invoice => invoice.Status == "Paid" && invoice.DateIssued >= start).Sum(invoice => invoice.AmountNet)
                + sources.LedgerEntries.Where(entry => entry.EntryType == "Interest_Received" && entry.EffectiveDate >= start).Sum(entry => entry.Amount);
            var costs = sources.Expenses.Where(expense => !expense.IsDLA && expense.EntryDate >= start && expense.CtTag != "NonCT")
                .Sum(expense => expense.AmountNet ?? 0)
                + sources.DlaEntries.Where(entry => entry.Direction == "OwedToDirector" && entry.CtTag != "NonCT").Sum(entry => entry.AmountNet);
            var yearLedger = sources.LedgerEntries.Where(entry => entry.EffectiveDate >= new DateTime(taxYear, 4, 6)
                && entry.EffectiveDate < new DateTime(taxYear + 1, 4, 6)).ToList();
            if (sources.IncludePayroll) costs += yearLedger.Where(entry => entry.EntryType is "Salary" or "EmployerNI").Sum(entry => entry.Amount);
            var profit = income - costs;
            var estimate = profit <= 0 ? 0 : profit <= 50000 ? profit * 0.19m : profit >= 250000 ? profit * 0.25m
                : profit * 0.25m - ((250000 - profit) / 250000) * 0.06m * profit;
            return Pennies(Math.Max(0, estimate - yearLedger.Where(entry => entry.EntryType == "CorpTax_Paid").Sum(entry => entry.Amount)));
        }

        private static bool Blocked(string? category, string? currency, string? ctTag, bool trivial) =>
            currency?.ToUpperInvariant() is "EUR" or "USD" || (category ?? "").Contains("entertainment", StringComparison.OrdinalIgnoreCase)
            || string.Equals(category, "trivial benefit", StringComparison.OrdinalIgnoreCase) || trivial || ctTag == "NonCT";

        public static decimal UnfiledVat(RecordedCashSources sources, CompanySettings settings, IEnumerable<VatReturn> filedReturns, DateTime now)
        {
            var returns = filedReturns.ToList();
            var month = settings.VatQuarterStartMonth ?? 1;
            if (month is < 1 or > 12) throw new InvalidOperationException("VAT quarter start month is invalid");
            var current = new DateTime(now.Year, now.Month, 1).AddMonths(-((now.Month - month + 12) % 3));
            var lower = settings.VatEffectiveDate ?? settings.CompanyInceptionDate ?? settings.IncorporationDate;
            var quarters = Enumerable.Range(0, 40).Select(index => current.AddMonths(-index * 3))
                .Where(start => !lower.HasValue || start.AddMonths(3) > lower.Value.Date
                    || returns.Any(record => Math.Abs((record.QuarterStartDate.Date - start).TotalDays) < 1)).ToList();
            var inception = settings.IncorporationDate ?? settings.CompanyInceptionDate;
            decimal total = 0;
            foreach (var start in quarters)
            {
                if (returns.Any(record => record.QuarterStartDate.Date == start)) continue;
                var end = start.AddMonths(3);
                var first = (inception.HasValue && start <= inception.Value && end > inception.Value) || start == quarters.Min();
                bool Applies(DateTime? date)
                {
                    if (!date.HasValue) return false;
                    if (date >= start && date < end) return true;
                    if (!first || date >= start) return false;
                    return !inception.HasValue || date >= inception.Value.AddYears(-4);
                }
                var invoiceVat = sources.Invoices.Where(invoice =>
                {
                    if (settings.VatAccountingMethod != "invoice")
                        return invoice.Status == "Paid" && invoice.DatePaid >= start && invoice.DatePaid < end;
                    var preInception = inception.HasValue && invoice.DateIssued < inception.Value;
                    if (!preInception && invoice.DateIssued >= start && invoice.DateIssued < end) return true;
                    if (preInception && first) return true;
                    return first && invoice.DateIssued < start;
                }).Sum(invoice => invoice.VATAmount);
                var expenseVat = sources.Expenses.Where(expense => Applies(expense.EntryDate)
                    && !Blocked(expense.Category, expense.OriginalCurrency, expense.CtTag, expense.IsTrivialBenefit)).Sum(expense => expense.VATAmount ?? 0);
                var dlaVat = sources.DlaEntries.Where(entry => entry.Direction == "OwedToDirector" && Applies(entry.EntryDate)
                    && !Blocked(entry.Category, entry.OriginalCurrency, entry.CtTag, entry.IsTrivialBenefit)).Sum(entry => entry.VatAmount);
                total += invoiceVat - expenseVat - dlaVat;
            }
            return Pennies(total);
        }

        public static string Html(TaxPotComparison vat, TaxPotComparison ct, DateTime syncedAt, IReadOnlyList<string> warnings)
        {
            string Row(TaxPotComparison pot) => $"<tr><td>{WebUtility.HtmlEncode(pot.Name)}</td><td>{Money(pot.Balance)}</td><td>{Money(Math.Max(0, pot.Estimated))}</td><td>{WebUtility.HtmlEncode(pot.Suggestion)}</td></tr>";
            var warningHtml = string.Join("", warnings.Select(warning => $"<li>{WebUtility.HtmlEncode(warning)}</li>"));
            var surplus = Math.Max(0, vat.Difference) + Math.Max(0, ct.Difference);
            var shortfall = Math.Max(0, -vat.Difference) + Math.Max(0, -ct.Difference);
            return $"<h2>Daily VAT and Corporation Tax pot check</h2><p>Monzo balances checked at {syncedAt:dd MMM yyyy HH:mm} UTC.</p>"
                + "<table cellpadding=\"8\" cellspacing=\"0\" border=\"1\"><tr><th>Pot</th><th>Actual balance</th><th>Estimated amount due</th><th>Suggested action</th></tr>"
                + Row(vat) + Row(ct) + "</table>"
                + $"<p>Total estimated pot surplus: {Money(surplus)}. Total top-ups needed: {Money(shortfall)}.</p>"
                + (vat.Estimated < 0 ? $"<p>Estimated VAT reclaim: {Money(-vat.Estimated)}. This is not counted as received cash.</p>" : "")
                + "<p>Estimates use saved accounting records, not a final HMRC bill. Unrecorded payments may change the estimates. Browser-only manual VAT adjustments are not included. Check the dashboard before withdrawing; no money is moved automatically.</p>"
                + (warnings.Count > 0 ? "<h3>Bank sync warnings</h3><ul>" + warningHtml + "</ul>" : "")
                + "<p><a href=\"https://finhub.andykemp.cloud/\">Open Finlytics</a></p>";
        }
    }
}