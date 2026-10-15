using FinanceHubFunctions.Models;
using FinanceHubFunctions.Services;

var config = new TaxConfig();
void Check(decimal actual, decimal expected, string name)
{
    if (decimal.Round(actual, 2) != expected) throw new Exception($"{name}: expected {expected}, got {actual}");
    Console.WriteLine("PASS " + name);
}

// HMRC: CT = 25% × P − 3/200 × (£250,000 − P) for £50k < P < £250k
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(0m, config), 0m, "no tax on zero profit");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(-1000m, config), 0m, "no tax on a loss");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(40000m, config), 7600m, "small profits rate");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(50000m, config), 9500m, "lower limit");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(60000m, config), 12150m, "marginal relief at 60k");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(100000m, config), 22750m, "marginal relief at 100k");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(150000m, config), 36000m, "marginal relief at 150k");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(250000m, config), 62500m, "upper limit");
Check(CompanyLedgerCalculations.CalcCorporationTaxEstimate(300000m, config), 75000m, "main rate");
Check(CompanyLedgerCalculations.CalcMarginalRelief(100000m, config), 2250m, "relief = 3/200 x (U - P)");
