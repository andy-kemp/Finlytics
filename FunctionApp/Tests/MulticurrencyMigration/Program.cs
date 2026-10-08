try
{
    if (args.Any(argument => argument is not ("--offline" or "--execute" or "--cleanup")) ||
        (args.Contains("--offline") && args.Contains("--execute")) ||
        (args.Contains("--cleanup") && !args.Contains("--execute")))
        throw new InvalidOperationException("Usage: --offline (default), or --execute [--cleanup].");
    Contract.RunOffline();
    if (!args.Contains("--execute"))
    {
        Console.WriteLine("Offline checks passed. No database connection opened. Use --execute explicitly for SQL validation.");
        return 0;
    }
    var connectionString = Environment.GetEnvironmentVariable("FINLYTICS_MIGRATION_TEST_CONNECTION");
    if (string.IsNullOrWhiteSpace(connectionString))
    {
        Console.WriteLine("No FINLYTICS_MIGRATION_TEST_CONNECTION supplied. Database validation skipped; not a database test pass.");
        return 2;
    }
    await DatabaseChecks.RunAsync(Safety.Parse(connectionString), args.Contains("--cleanup"));
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Validation failed ({exception.GetType().Name}). Connection strings, SQL error messages and credentials are suppressed.");
    return 1;
}