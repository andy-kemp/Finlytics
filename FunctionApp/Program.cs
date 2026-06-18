﻿#nullable enable
using System;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Services;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults(builder =>
    {
        builder.Services.Configure<JsonSerializerOptions>(options =>
        {
            options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        });
    })
    .ConfigureServices((context, services) =>
    {
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();

        // Get connection string from Key Vault or configuration
        var keyVaultUri = context.Configuration["KeyVaultUri"]
            ?? context.Configuration["KEY_VAULT_URL"]
            ?? Environment.GetEnvironmentVariable("KEY_VAULT_URL");
        string? connectionString = null;

        if (!string.IsNullOrEmpty(keyVaultUri))
        {
            try
            {
                // Running in Azure - get from Key Vault (async via Task.Run to avoid blocking host startup)
                var credential = new DefaultAzureCredential();
                var secretClient = new SecretClient(new Uri(keyVaultUri), credential);
                var secret = Task.Run(() => secretClient.GetSecretAsync("SqlConnectionString")).GetAwaiter().GetResult();
                connectionString = secret.Value.Value;

                // Load Monzo secrets into environment variables
                try
                {
                    var monzoToken = Task.Run(() => secretClient.GetSecretAsync("MonzoAccessToken")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("MonzoAccessToken", monzoToken.Value.Value);
                    var monzoAccountId = Task.Run(() => secretClient.GetSecretAsync("MonzoAccountId")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("MonzoAccountId", monzoAccountId.Value.Value);
                }
                catch (Exception monzoEx)
                {
                    Console.WriteLine($"Monzo token/account not found in Key Vault (optional): {monzoEx.Message}");
                }
                try
                {
                    var monzoClientId = Task.Run(() => secretClient.GetSecretAsync("MonzoClientId")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("MonzoClientId", monzoClientId.Value.Value);
                    var monzoClientSecret = Task.Run(() => secretClient.GetSecretAsync("MonzoClientSecret")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("MonzoClientSecret", monzoClientSecret.Value.Value);
                }
                catch (Exception monzoEx)
                {
                    Console.WriteLine($"Monzo OAuth credentials not found in Key Vault (optional): {monzoEx.Message}");
                }

                // Load TrueLayer secrets into environment variables
                try
                {
                    var tlClientId = Task.Run(() => secretClient.GetSecretAsync("TrueLayerClientId")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("TrueLayerClientId", tlClientId.Value.Value);
                    var tlClientSecret = Task.Run(() => secretClient.GetSecretAsync("TrueLayerClientSecret")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("TrueLayerClientSecret", tlClientSecret.Value.Value);
                }
                catch (Exception tlEx)
                {
                    Console.WriteLine($"TrueLayer OAuth credentials not found in Key Vault (optional): {tlEx.Message}");
                }
                try
                {
                    var tlAccessToken = Task.Run(() => secretClient.GetSecretAsync("TrueLayerAccessToken")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("TrueLayerAccessToken", tlAccessToken.Value.Value);
                    var tlRefreshToken = Task.Run(() => secretClient.GetSecretAsync("TrueLayerRefreshToken")).GetAwaiter().GetResult();
                    Environment.SetEnvironmentVariable("TrueLayerRefreshToken", tlRefreshToken.Value.Value);
                }
                catch (Exception tlEx)
                {
                    Console.WriteLine($"TrueLayer tokens not found in Key Vault (optional): {tlEx.Message}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error retrieving connection string from Key Vault: {ex.Message}");
            }
        }

        // Fallback to local configuration if Key Vault fails or not configured
        if (string.IsNullOrEmpty(connectionString))
        {
            connectionString = context.Configuration.GetConnectionString("FinanceHubDb");
        }

        if (!string.IsNullOrEmpty(connectionString))
        {
            // Register DbContext per-invocation (no pooling) to avoid stale change-tracker state across Azure Function invocations
            services.AddDbContext<FinanceHubDbContext>(options =>
            {
                options.UseSqlServer(connectionString, sqlOptions =>
                {
                    sqlOptions.EnableRetryOnFailure(
                        maxRetryCount: 3,
                        maxRetryDelay: TimeSpan.FromSeconds(5),
                        errorNumbersToAdd: null);
                });
            });

            // Register repository services
            services.AddScoped<ICustomerRepository, CustomerRepository>();
            services.AddScoped<ISupplierRepository, SupplierRepository>();
            services.AddScoped<IInvoiceRepository, InvoiceRepository>();
            services.AddScoped<IExpenseRepository, ExpenseRepository>();
            services.AddScoped<IDlaRepository, DlaRepository>();
            services.AddScoped<IDlaPaymentRepository, DlaPaymentRepository>();
            services.AddScoped<IQuoteRepository, QuoteRepository>();
            services.AddScoped<ICompanyLedgerRepository, CompanyLedgerRepository>();
            services.AddScoped<IShareholderRepository, ShareholderRepository>();
            services.AddScoped<ICompanySettingsRepository, CompanySettingsRepository>();
            services.AddScoped<IEmployeeRepository, EmployeeRepository>();
            services.AddScoped<IAssetRepository, AssetRepository>();
            services.AddScoped<ISubscriptionRepository, SubscriptionRepository>();
            services.AddScoped<IBankAccountRepository, BankAccountRepository>();
            services.AddScoped<IBankTransactionRepository, BankTransactionRepository>();
            services.AddScoped<IReconciliationRuleRepository, ReconciliationRuleRepository>();
            services.AddScoped<IReconciliationMatchRepository, ReconciliationMatchRepository>();
            services.AddScoped<IPayrollRunRepository, PayrollRunRepository>();
            services.AddScoped<IPayslipRepository, PayslipRepository>();
            services.AddScoped<IPayrollSettingsRepository, PayrollSettingsRepository>();
            services.AddScoped<IVatReturnRepository, VatReturnRepository>();
            services.AddScoped<IMileageTripRepository, MileageTripRepository>();
            services.AddScoped<IMileageClaimRepository, MileageClaimRepository>();
            services.AddScoped<IMissingReceiptDeclarationRepository, MissingReceiptDeclarationRepository>();
            services.AddScoped<IExpenseAuditEventRepository, ExpenseAuditEventRepository>();
            services.AddScoped<ICreditNoteRepository, CreditNoteRepository>();
            services.AddScoped<ITeamMemberRepository, TeamMemberRepository>();
            services.AddScoped<IAccountantRepository, AccountantRepository>();
            services.AddScoped<ICompanyAccountantRepository, CompanyAccountantRepository>();
            services.AddScoped<IRecurringInvoiceTemplateRepository, RecurringInvoiceTemplateRepository>();
            services.AddScoped<ICategorizationRuleRepository, CategorizationRuleRepository>();
            services.AddScoped<IGoCardlessMandateRepository, GoCardlessMandateRepository>();
            services.AddScoped<IGoCardlessPaymentRepository, GoCardlessPaymentRepository>();
            services.AddScoped<IBillRepository, BillRepository>();
        }
        else
        {
            Console.WriteLine("WARNING: No database connection string configured. Database functionality will not be available.");
        }

        // Register services
        services.AddHttpClient(); // enables IHttpClientFactory (used by HmrcService)
        services.AddScoped<SharePointService>();
        services.AddScoped<KeyVaultService>();
        services.AddScoped<DeletionGuardService>();
        services.AddScoped<EmailService>();
        services.AddScoped<HmrcService>();
        services.AddScoped<FpsService>();
                services.AddScoped<EpsService>();
        services.AddScoped<MissingReceiptDeclarationPdfService>();
        services.AddScoped<CreditNotePdfService>();
        services.AddSingleton<ClerkAuthService>();
        var storageConnectionString = context.Configuration["AzureWebJobsStorage"];
        var storageBlobServiceUri = context.Configuration["AzureWebJobsStorage__blobServiceUri"];
        if (!string.IsNullOrEmpty(storageConnectionString))
        {
            services.AddSingleton(new BlobStorageService(storageConnectionString));
        }
        else if (!string.IsNullOrEmpty(storageBlobServiceUri))
        {
            services.AddSingleton(new BlobStorageService(new Uri(storageBlobServiceUri), new DefaultAzureCredential()));
        }
    })
    .Build();

// Run database migrations on startup
using (var scope = host.Services.CreateScope())
{
    try
    {
        var dbContext = scope.ServiceProvider.GetService<FinanceHubDbContext>();
        if (dbContext != null)
        {
            dbContext.Database.Migrate();
            Console.WriteLine("Database migrations applied successfully");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error applying migrations: {ex.Message}");
        // Don't fail startup - database might not be ready yet
    }
}

host.Run();