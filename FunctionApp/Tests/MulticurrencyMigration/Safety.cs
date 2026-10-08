using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Azure.Core;
using Azure.Identity;
using Microsoft.Data.SqlClient;

internal sealed record TestConnection(SqlConnectionStringBuilder Builder, bool AzureCli);

internal static class Safety
{
    internal static void ValidateDatabase(string database)
    {
        if (!Regex.IsMatch(database, @"\Afinlytics-fx-test-[a-z0-9][a-z0-9-]{0,80}\z", RegexOptions.CultureInvariant))
            throw new InvalidOperationException("Refusing database: exact lowercase finlytics-fx-test- prefix and a nonempty lowercase test suffix are required.");
    }

    internal static TestConnection Parse(string connectionString)
    {
        SqlConnectionStringBuilder builder;
        bool azureCli;
        try
        {
            var generic = new DbConnectionStringBuilder { ConnectionString = connectionString };
            azureCli = generic.TryGetValue("Authentication", out var mode) &&
                string.Equals(Convert.ToString(mode), "Active Directory Azure CLI", StringComparison.OrdinalIgnoreCase);
            if (azureCli) generic.Remove("Authentication");
            builder = new SqlConnectionStringBuilder(generic.ConnectionString);
        }
        catch { throw new InvalidOperationException("Invalid test connection string; value suppressed."); }
        ValidateDatabase(builder.InitialCatalog);
        if (string.IsNullOrWhiteSpace(builder.DataSource) || builder.AttachDBFilename.Length != 0 ||
            builder.FailoverPartner.Length != 0 || builder.UserInstance || builder.TrustServerCertificate ||
            builder.Encrypt == SqlConnectionEncryptOption.Optional)
            throw new InvalidOperationException("Require a server, encrypted verified TLS, no attached file, user instance, or failover partner.");
        if (azureCli && (builder.IntegratedSecurity || builder.UserID.Length != 0 || builder.Password.Length != 0))
            throw new InvalidOperationException("CLI authentication cannot be combined with SQL credentials or integrated security.");
        builder.Pooling = false;
        builder.ConnectTimeout = 30;
        builder.ApplicationName = "Finlytics isolated multicurrency validation";
        return new TestConnection(builder, azureCli);
    }

    internal static SqlConnection CreateConnection(TestConnection settings)
    {
        var connection = new SqlConnection(settings.Builder.ConnectionString);
        if (settings.AzureCli)
        {
            var credential = new AzureCliCredential();
            connection.AccessTokenCallback = async (_, cancellationToken) =>
            {
                var token = await credential.GetTokenAsync(new TokenRequestContext(["https://database.windows.net/.default"]), cancellationToken);
                return new SqlAuthenticationToken(token.Token, token.ExpiresOn);
            };
        }
        return connection;
    }

    internal static string ServerFingerprint(string server) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(server)))[..12];
}