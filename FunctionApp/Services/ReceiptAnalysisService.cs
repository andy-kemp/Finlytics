#nullable enable
using System;
using System.IO;
using System.Threading.Tasks;
using Azure;
using Azure.AI.FormRecognizer.DocumentAnalysis;
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using FinanceHubFunctions.Helpers;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Services
{
    public class ReceiptAnalysisService
    {
        private readonly ILogger<ReceiptAnalysisService> _logger;
        private DocumentAnalysisClient? _client;

        public ReceiptAnalysisService(ILogger<ReceiptAnalysisService> logger) => _logger = logger;

        private async Task<DocumentAnalysisClient?> Client()
        {
            if (_client != null) return _client;
            var endpoint = Environment.GetEnvironmentVariable("DocumentIntelligenceEndpoint");
            var apiKey = Environment.GetEnvironmentVariable("DocumentIntelligenceKey");
            var vault = Environment.GetEnvironmentVariable("KeyVaultUri");
            if ((string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(apiKey)) && !string.IsNullOrEmpty(vault))
            {
                try
                {
                    var secrets = new SecretClient(new Uri(vault), new DefaultAzureCredential());
                    if (string.IsNullOrEmpty(endpoint)) endpoint = (await secrets.GetSecretAsync("DocumentIntelligenceEndpoint")).Value.Value;
                    if (string.IsNullOrEmpty(apiKey)) apiKey = (await secrets.GetSecretAsync("DocumentIntelligenceKey")).Value.Value;
                }
                catch (Exception exception)
                {
                    _logger.LogWarning("Document Intelligence credentials unavailable from Key Vault: {Message}", exception.Message);
                }
            }
            if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(apiKey)) return null;
            return _client = new DocumentAnalysisClient(new Uri(endpoint), new AzureKeyCredential(apiKey));
        }

        public async Task<ReceiptAnalysis> AnalyzeAsync(byte[] content)
        {
            var client = await Client() ?? throw new InvalidOperationException("Document Intelligence is not configured");
            var invoice = await Read(client, "prebuilt-invoice", content, "VendorName", "InvoiceDate", "InvoiceTotal", "TotalTax", "InvoiceId");
            if (invoice.Total.HasValue && invoice.DocumentDate.HasValue && (invoice.Vendor?.Length ?? 0) > 2) return invoice;
            var receipt = await Read(client, "prebuilt-receipt", content, "MerchantName", "TransactionDate", "Total", "TotalTax", null);
            return new(
                (receipt.Vendor?.Length ?? 0) > 2 ? receipt.Vendor : invoice.Vendor ?? receipt.Vendor,
                receipt.DocumentDate ?? invoice.DocumentDate, receipt.Total ?? invoice.Total, receipt.Tax ?? invoice.Tax,
                receipt.Currency ?? invoice.Currency, invoice.Reference);
        }

        private static async Task<ReceiptAnalysis> Read(DocumentAnalysisClient client, string model, byte[] content,
            string vendorField, string dateField, string totalField, string taxField, string? referenceField)
        {
            using var stream = new MemoryStream(content);
            var operation = await client.AnalyzeDocumentAsync(WaitUntil.Completed, model, stream);
            if (operation.Value.Documents.Count == 0) return new(null, null, null, null, null, null);
            var fields = operation.Value.Documents[0].Fields;
            string? Text(string? name) => name != null && fields.TryGetValue(name, out var field) && field.FieldType == DocumentFieldType.String
                ? field.Value.AsString() : null;
            DateTime? Date(string name) => fields.TryGetValue(name, out var field) && field.FieldType == DocumentFieldType.Date
                ? field.Value.AsDate().Date : null;
            (decimal? Amount, string? Currency) Money(string name)
            {
                if (!fields.TryGetValue(name, out var field)) return (null, null);
                if (field.FieldType == DocumentFieldType.Currency)
                {
                    var value = field.Value.AsCurrency();
                    return ((decimal)value.Amount, string.IsNullOrWhiteSpace(value.Code) ? null : value.Code.Trim().ToUpperInvariant());
                }
                return field.FieldType == DocumentFieldType.Double ? ((decimal)field.Value.AsDouble(), null) : (null, null);
            }
            var total = Money(totalField);
            var tax = Money(taxField);
            if (!tax.Amount.HasValue && taxField == "TotalTax") tax = Money("Tax");
            return new(Text(vendorField), Date(dateField), total.Amount, tax.Amount, total.Currency ?? tax.Currency, Text(referenceField));
        }
    }
}
