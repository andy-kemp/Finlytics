using System;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;

namespace FinanceHubFunctions.Services
{
    public class KeyVaultService
    {
        private readonly SecretClient _secretClient;

        public KeyVaultService()
        {
            // Get Key Vault URL from environment variables, but ignore empty values.
            var keyVaultUrl =
                FirstNonEmpty(
                    Environment.GetEnvironmentVariable("KEY_VAULT_URL"),
                    Environment.GetEnvironmentVariable("KeyVaultUrl"),
                    Environment.GetEnvironmentVariable("AZURE_KEY_VAULT_URL"))
                ?? "https://fh-kv-kemponline.vault.azure.net/";
            
            // Use Managed Identity in Azure, fallback to DefaultAzureCredential locally
            var isAzure = !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("WEBSITE_INSTANCE_ID"))
                || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("IDENTITY_ENDPOINT"))
                || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MSI_ENDPOINT"));
            TokenCredential credential;
            if (isAzure)
            {
                credential = new ManagedIdentityCredential();
            }
            else
            {
                credential = new DefaultAzureCredential();
            }
            _secretClient = new SecretClient(new Uri(keyVaultUrl), credential);
        }

        private static string? FirstNonEmpty(params string?[] values)
        {
            foreach (var value in values)
            {
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value;
                }
            }

            return null;
        }

        public async Task<string> GetSecretAsync(string secretName)
        {
            try
            {
                var secret = await _secretClient.GetSecretAsync(secretName);
                return secret.Value.Value;
            }
            catch (Exception ex)
            {
                throw new Exception($"Failed to retrieve secret '{secretName}' from Key Vault: {ex.Message}", ex);
            }
        }

        public async Task SetSecretAsync(string secretName, string secretValue)
        {
            try
            {
                await _secretClient.SetSecretAsync(secretName, secretValue);
            }
            catch (Exception ex)
            {
                throw new Exception($"Failed to set secret '{secretName}' in Key Vault: {ex.Message}", ex);
            }
        }

        public async Task<string?> GetSmtpPasswordAsync()
        {
            try
            {
                return await GetSecretAsync("SmtpPassword");
            }
            catch
            {
                // Return null if secret doesn't exist
                return null;
            }
        }

        public async Task SetSmtpPasswordAsync(string password)
        {
            await SetSecretAsync("SmtpPassword", password);
        }

        public async Task<string?> GetHmrcGatewayPasswordAsync()
        {
            try
            {
                return await GetSecretAsync("HmrcGatewayPassword");
            }
            catch
            {
                return null;
            }
        }

        public async Task SetHmrcGatewayPasswordAsync(string password)
        {
            await SetSecretAsync("HmrcGatewayPassword", password);
        }
    }
}
