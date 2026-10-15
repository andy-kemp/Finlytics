using System;
using System.Collections.Generic;
using System.Linq;

namespace FinanceHubFunctions.Services
{
    /// <summary>
    /// PAYE / Class 1 NI rates for one tax year (6 April to 5 April).
    /// Bands are on cumulative taxable income (after the tax-code allowance); NI thresholds are monthly.
    /// Source: GOV.UK "Rates and thresholds for employers" for each year.
    /// </summary>
    internal sealed record PayrollTaxYearRates(
        int StartYear,
        (decimal UpTo, decimal Rate)[] EnglandBands,
        (decimal UpTo, decimal Rate)[] ScottishBands,
        decimal LowerEarningsLimitMonthly,
        decimal PrimaryThresholdMonthly,
        decimal UpperEarningsLimitMonthly,
        decimal SecondaryThresholdMonthly,
        decimal EmployeeMainRate,
        decimal EmployeeUpperRate,
        decimal EmployerRate);

    /// <summary>
    /// Shared static helpers for payroll calculations — used by both the HTTP
    /// PayrollFunctions and the PayrollSchedulerFunction timer trigger.
    /// Rates are looked up per tax year; a year without rates fails loudly instead of using stale figures.
    /// </summary>
    internal static class PayrollCalculations
    {
        private static readonly (decimal, decimal)[] EnglandBands2025To2027 =
            { (37700m, 0.20m), (125140m, 0.40m), (decimal.MaxValue, 0.45m) };

        private static readonly Dictionary<int, PayrollTaxYearRates> Rates = new()
        {
            [2025] = new(2025,
                EnglandBands2025To2027,
                new[] { (2827m, 0.19m), (14921m, 0.20m), (31092m, 0.21m), (62430m, 0.42m), (125140m, 0.45m), (decimal.MaxValue, 0.48m) },
                LowerEarningsLimitMonthly: 542m, PrimaryThresholdMonthly: 1048m, UpperEarningsLimitMonthly: 4189m,
                SecondaryThresholdMonthly: 417m, EmployeeMainRate: 0.08m, EmployeeUpperRate: 0.02m, EmployerRate: 0.15m),
            [2026] = new(2026,
                EnglandBands2025To2027,
                new[] { (3967m, 0.19m), (16956m, 0.20m), (31092m, 0.21m), (62430m, 0.42m), (125140m, 0.45m), (decimal.MaxValue, 0.48m) },
                LowerEarningsLimitMonthly: 559m, PrimaryThresholdMonthly: 1048m, UpperEarningsLimitMonthly: 4189m,
                SecondaryThresholdMonthly: 417m, EmployeeMainRate: 0.08m, EmployeeUpperRate: 0.02m, EmployerRate: 0.15m)
        };

        /// <summary>Rates for the tax year containing <paramref name="payDate"/>.</summary>
        public static PayrollTaxYearRates RatesFor(DateTime payDate) => RatesFor(GetTaxYear(payDate));

        /// <summary>Rates for a tax year string such as "2026-27".</summary>
        public static PayrollTaxYearRates RatesFor(string? taxYear)
        {
            if (int.TryParse(taxYear?.Split('-')[0], out var startYear) && Rates.TryGetValue(startYear, out var rates)) return rates;
            throw new InvalidOperationException(
                $"Payroll rates for tax year {taxYear} are not configured. Add them to PayrollCalculations before running payroll.");
        }

        // ── Tax year / month helpers ──────────────────────────────────────────

        /// <summary>Returns HMRC tax month 1–12 for a given pay date (tax year starts 6 April).</summary>
        public static int GetTaxMonth(DateTime payDate)
        {
            int month = payDate.Month;
            if (payDate.Day < 6) month--;
            if (month <= 0) month += 12;
            return ((month - 4 + 12) % 12) + 1;
        }

        /// <summary>Returns the tax year string e.g. "2025-26" for a given pay date.</summary>
        public static string GetTaxYear(DateTime payDate)
        {
            int start = (payDate.Month > 4 || (payDate.Month == 4 && payDate.Day >= 6))
                ? payDate.Year : payDate.Year - 1;
            return $"{start}-{(start + 1).ToString().Substring(2)}";
        }

        // ── Tax code parsing ─────────────────────────────────────────────────

        /// <summary>Parses annual free-pay allowance from a tax code.
        /// Handles English, Scottish (S prefix), Welsh (C prefix) and K codes.
        /// Returns decimal.MaxValue for NT (no tax). Returns 0 for flat-rate codes.</summary>
        public static decimal ParseTaxCodeAllowance(string? taxCode)
        {
            if (string.IsNullOrEmpty(taxCode)) return 12570m;
            var code = taxCode.Trim().ToUpperInvariant();

            // Fixed-rate / special codes — no personal allowance arithmetic
            if (code is "BR" or "SBR" or "CBR" or "D0" or "D1" or "D2" or "SD0" or "SD1" or "SD2" or "SD3" or "0T") return 0m;
            if (code == "NT") return decimal.MaxValue; // No tax at all

            // Strip regional prefix (S = Scottish, C = Welsh)
            if (code.StartsWith("S") || code.StartsWith("C")) code = code.Substring(1);

            // K code = negative allowance (reduces free pay, adds to taxable income)
            bool isKCode = code.StartsWith("K");
            if (isKCode) code = code.Substring(1);

            // Extract leading digits before any letter suffix (L, T, M, N, W1, M1, X)
            var digits = new string(code.TakeWhile(char.IsDigit).ToArray());
            if (!int.TryParse(digits, out int codeNum)) return 12570m;

            decimal allowance = codeNum * 10m;
            return isKCode ? -allowance : allowance;
        }

        /// <summary>Returns true if the tax code uses Scottish income tax rates (S prefix).</summary>
        public static bool IsScottishTaxCode(string? taxCode)
        {
            if (string.IsNullOrEmpty(taxCode)) return false;
            return taxCode.Trim().ToUpperInvariant().StartsWith("S") && taxCode.Trim().Length > 1;
        }

        // ── National Insurance ────────────────────────────────────────────────

        /// <summary>Employee Class 1 NI for a monthly pay period. Category C (over State Pension age) pays nil.</summary>
        public static decimal CalcEmployeeNI(decimal grossPay, string? niCategory, PayrollTaxYearRates rates)
        {
            if (niCategory == "C") return 0m;
            var pt = rates.PrimaryThresholdMonthly;
            var uel = rates.UpperEarningsLimitMonthly;
            if (grossPay <= pt) return 0m;
            decimal ni = grossPay <= uel
                ? (grossPay - pt) * rates.EmployeeMainRate
                : (uel - pt) * rates.EmployeeMainRate + (grossPay - uel) * rates.EmployeeUpperRate;
            return Math.Round(ni, 2);
        }

        /// <summary>Employer Class 1 NI for a monthly pay period. Employers still pay for category C employees.</summary>
        public static decimal CalcEmployerNI(decimal grossPay, string? niCategory, PayrollTaxYearRates rates)
        {
            var st = rates.SecondaryThresholdMonthly;
            if (grossPay <= st) return 0m;
            return Math.Round((grossPay - st) * rates.EmployerRate, 2);
        }

        // ── Income tax (cumulative method) ────────────────────────────────────

        /// <summary>Calculates income tax due this period using the cumulative method.
        /// Supports English/Welsh codes and Scottish (S prefix). Also handles flat-rate
        /// emergency codes: BR, D0, D1, SBR, SD0-SD3, NT, 0T.</summary>
        public static decimal CalcTax(
            decimal ytdGrossBefore, decimal ytdTaxBefore,
            decimal grossThisPeriod, string? taxCode, int taxMonth, PayrollTaxYearRates rates)
        {
            var upper = (taxCode ?? "1257L").Trim().ToUpperInvariant();

            // Flat-rate emergency codes (non-cumulative)
            if (upper is "BR" or "CBR" or "SBR") return Math.Round(grossThisPeriod * 0.20m, 2);
            if (upper == "D0")  return Math.Round(grossThisPeriod * 0.40m, 2);
            if (upper == "D1")  return Math.Round(grossThisPeriod * 0.45m, 2);
            if (upper == "SD0") return Math.Round(grossThisPeriod * 0.21m, 2);
            if (upper == "SD1") return Math.Round(grossThisPeriod * 0.42m, 2);
            if (upper == "SD2") return Math.Round(grossThisPeriod * 0.45m, 2);
            if (upper == "SD3") return Math.Round(grossThisPeriod * 0.48m, 2);
            if (upper == "NT")  return 0m;

            bool    isScottish = IsScottishTaxCode(taxCode);
            decimal allowance  = ParseTaxCodeAllowance(taxCode);
            if (allowance == decimal.MaxValue) return 0m; // NT

            decimal cumulativeFreePay = (allowance / 12m) * taxMonth;
            decimal newYtdGross       = ytdGrossBefore + grossThisPeriod;
            decimal taxable           = Math.Max(0m, newYtdGross - cumulativeFreePay);

            // Bands are applied cumulatively: taxMonth/12 of each annual band to date
            decimal newTotalTax = TaxOnTaxable(taxable, isScottish ? rates.ScottishBands : rates.EnglandBands, taxMonth / 12m);

            return Math.Round(Math.Max(0m, Math.Round(newTotalTax, 2) - ytdTaxBefore), 2);
        }

        /// <summary>Tax on taxable income across the bands, each scaled by <paramref name="bandFraction"/>.</summary>
        public static decimal TaxOnTaxable(decimal taxable, (decimal UpTo, decimal Rate)[] bands, decimal bandFraction = 1m)
        {
            if (taxable <= 0) return 0m;
            decimal tax = 0m, lower = 0m;
            foreach (var (upTo, rate) in bands)
            {
                var top = upTo == decimal.MaxValue ? decimal.MaxValue : upTo * bandFraction;
                if (taxable <= top) return tax + (taxable - lower) * rate;
                tax += (top - lower) * rate;
                lower = top;
            }
            return tax;
        }
    }
}
