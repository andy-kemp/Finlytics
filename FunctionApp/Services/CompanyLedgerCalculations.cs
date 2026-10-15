using System;
using FinanceHubFunctions.Models;

namespace FinanceHubFunctions.Services
{
    /// <summary>
    /// Pure calculation functions for Company Ledger financial computations.
    /// All functions are stateless and testable.
    /// </summary>
    public static class CompanyLedgerCalculations
    {
        /// <summary>
        /// Calculates Profit Before Tax: TradingProfit - SalaryGross - EmployerNI
        /// </summary>
        public static decimal CalcProfitBeforeTax(decimal tradingProfit, decimal salaryGross, decimal employerNI)
        {
            return tradingProfit - salaryGross - employerNI;
        }

        /// <summary>
        /// Calculates Corporation Tax estimate using UK parametric rates with marginal relief.
        /// </summary>
        public static decimal CalcCorporationTaxEstimate(decimal pbt, TaxConfig config)
        {
            if (pbt <= 0) return 0;

            // Below lower limit: use small profits rate
            if (pbt <= config.LimitLower)
            {
                return pbt * config.SmallProfitsRate;
            }

            // Above upper limit: use main rate
            if (pbt >= config.LimitUpper)
            {
                return pbt * config.MainRate;
            }

            // Between limits: apply marginal relief
            var marginalRelief = CalcMarginalRelief(pbt, config);
            var taxAtMainRate = pbt * config.MainRate;
            return taxAtMainRate - marginalRelief;
        }

        /// <summary>
        /// Calculates UK marginal relief for profits between lower and upper limits.
        /// Relief = F × (Upper Limit − Profits), where the standard fraction F makes the tax
        /// continuous at the lower limit (3/200 for 19%/25% with £50k/£250k limits).
        /// Assumes no exempt distributions (augmented profits = taxable profits).
        /// </summary>
        public static decimal CalcMarginalRelief(decimal pbt, TaxConfig config)
        {
            if (pbt <= config.LimitLower || pbt >= config.LimitUpper) return 0;

            var standardFraction = config.LimitLower * (config.MainRate - config.SmallProfitsRate)
                / (config.LimitUpper - config.LimitLower);

            return standardFraction * (config.LimitUpper - pbt);
        }

        /// <summary>
        /// Calculates Available for Dividends: PBT - CorporationTax
        /// </summary>
        public static decimal CalcAvailableForDividends(decimal pbt, decimal corpTaxEstimate)
        {
            return pbt - corpTaxEstimate;
        }

        /// <summary>
        /// Calculates VAT Pot from Trading Ledger (OutputVAT - InputVAT)
        /// </summary>
        public static decimal CalcVatPot(decimal outputVat, decimal inputVat)
        {
            return outputVat - inputVat;
        }

        /// <summary>
        /// Calculates Free Cash After Pots: BankBalance - VATPot - CorpTaxPot
        /// </summary>
        public static decimal CalcFreeCashAfterPots(decimal bankBalance, decimal vatPot, decimal corpTaxReserved)
        {
            return bankBalance - vatPot - corpTaxReserved;
        }

        /// <summary>
        /// Calculates Director's Loan Account net balance: DLA_In - DLA_Out
        /// </summary>
        public static decimal CalcDlaBalance(decimal dlaIn, decimal dlaOut)
        {
            return dlaIn - dlaOut;
        }

        /// <summary>
        /// Generates Company Overview from aggregated data
        /// </summary>
        public static CompanyOverview GenerateCompanyOverview(
            decimal tradingProfit,
            CompanyAggregates aggregates,
            decimal outputVat,
            decimal inputVat,
            decimal bankBalance,
            TaxConfig taxConfig)
        {
            var pbt = CalcProfitBeforeTax(tradingProfit, aggregates.SalaryGross, aggregates.EmployerNI);
            var corpTaxEstimate = CalcCorporationTaxEstimate(pbt, taxConfig);
            var availableForDividends = CalcAvailableForDividends(pbt, corpTaxEstimate);
            var vatPot = CalcVatPot(outputVat, inputVat);
            var freeCash = CalcFreeCashAfterPots(bankBalance, vatPot, aggregates.CorpTaxReserved);
            var dlaBalance = CalcDlaBalance(
                aggregates.DlaNet > 0 ? aggregates.DlaNet : 0,
                aggregates.DlaNet < 0 ? Math.Abs(aggregates.DlaNet) : 0
            );

            return new CompanyOverview
            {
                TradingProfit = tradingProfit,
                SalaryGross = aggregates.SalaryGross,
                EmployerNI = aggregates.EmployerNI,
                ProfitBeforeTax = pbt,
                CorporationTaxEstimate = corpTaxEstimate,
                AvailableForDividends = availableForDividends,
                VatPot = vatPot,
                CorpTaxPot = aggregates.CorpTaxReserved,
                BankBalance = bankBalance,
                FreeCashAfterPots = freeCash,
                DlaBalance = dlaBalance
            };
        }
    }
}
