using FinanceHubFunctions.Services;

void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}
void Equal(decimal actual, decimal expected, string name)
{
    if (actual != expected) throw new Exception($"{name}: expected {expected}, got {actual}");
    Console.WriteLine("PASS " + name);
}

var y2526 = PayrollCalculations.RatesFor(new DateTime(2026, 4, 5));
var y2627 = PayrollCalculations.RatesFor(new DateTime(2026, 4, 6));

// GOV.UK "Rates and thresholds for employers" 2025-26 and 2026-27
Equal(y2526.LowerEarningsLimitMonthly, 542m, "2025-26 LEL is £542/month");
Equal(y2627.LowerEarningsLimitMonthly, 559m, "2026-27 LEL is £559/month");
Equal(y2526.ScottishBands[1].UpTo, 14921m, "2025-26 Scottish basic band ends at £14,921");
Equal(y2627.ScottishBands[0].UpTo, 3967m, "2026-27 Scottish starter band ends at £3,967");
Equal(y2627.ScottishBands[4].UpTo, 125140m, "Scottish top rate starts above £125,140");
Check(Throws(() => PayrollCalculations.RatesFor("2027-28")), "missing tax year fails loudly");

// NI on £3,000/month
Equal(PayrollCalculations.CalcEmployeeNI(3000m, "A", y2627), 156.16m, "employee NI 8% above £1,048");
Equal(PayrollCalculations.CalcEmployerNI(3000m, "A", y2627), 387.45m, "employer NI 15% above £417");
Equal(PayrollCalculations.CalcEmployeeNI(3000m, "C", y2627), 0m, "category C employee pays no NI");
Equal(PayrollCalculations.CalcEmployerNI(3000m, "C", y2627), 387.45m, "employer still pays NI for category C");

// Income tax, month 1, £3,000, 1257L
Equal(PayrollCalculations.CalcTax(0, 0, 3000m, "1257L", 1, y2627), 390.50m, "England basic rate month 1");
Equal(PayrollCalculations.CalcTax(0, 0, 3000m, "S1257L", 1, y2627), 392.59m, "Scotland 2026-27 bands month 1");

// Cumulative bands are pro-rated per month, so a £60k salary is taxed evenly
decimal ytdGross = 0, ytdTax = 0;
for (var month = 1; month <= 12; month++)
{
    var tax = PayrollCalculations.CalcTax(ytdGross, ytdTax, 5000m, "1257L", month, y2627);
    if (month == 1) Equal(tax, 952.67m, "higher-rate tax applies from month 1");
    ytdGross += 5000m;
    ytdTax += tax;
}
Equal(ytdTax, 11432m, "£60,000 salary: annual PAYE equals the annual liability");

static bool Throws(Action action)
{
    try { action(); return false; }
    catch (InvalidOperationException) { return true; }
}
