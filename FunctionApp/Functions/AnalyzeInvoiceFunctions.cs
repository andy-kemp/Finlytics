using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Azure;
using Azure.AI.FormRecognizer.DocumentAnalysis;
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Functions
{
    public class AnalyzeInvoiceFunctions
    {
        private readonly ILogger<AnalyzeInvoiceFunctions> _logger;

        public AnalyzeInvoiceFunctions(ILogger<AnalyzeInvoiceFunctions> logger)
        {
            _logger = logger;
        }

        [Function("AnalyzeInvoice")]
        public async Task<HttpResponseData> AnalyzeInvoice(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "analyze-invoice")] HttpRequestData req)
        {
            _logger.LogInformation("AnalyzeInvoice triggered");

            try
            {
                // Get Document Intelligence credentials from environment / Key Vault
                var endpoint = Environment.GetEnvironmentVariable("DocumentIntelligenceEndpoint");
                var apiKey   = Environment.GetEnvironmentVariable("DocumentIntelligenceKey");

                // Fallback: try Key Vault
                if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(apiKey))
                {
                    var kvUri = Environment.GetEnvironmentVariable("KeyVaultUri");
                    if (!string.IsNullOrEmpty(kvUri))
                    {
                        try
                        {
                            var cred = new DefaultAzureCredential();
                            var kv   = new SecretClient(new Uri(kvUri), cred);
                            if (string.IsNullOrEmpty(endpoint))
                                endpoint = (await kv.GetSecretAsync("DocumentIntelligenceEndpoint")).Value.Value;
                            if (string.IsNullOrEmpty(apiKey))
                                apiKey = (await kv.GetSecretAsync("DocumentIntelligenceKey")).Value.Value;
                        }
                        catch (Exception kvEx)
                        {
                            _logger.LogWarning("Could not load Document Intelligence credentials from Key Vault: {Msg}", kvEx.Message);
                        }
                    }
                }

                if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(apiKey))
                {
                    // OCR not configured – return a clear flag so the UI can degrade gracefully
                    var notConfigured = req.CreateResponse(HttpStatusCode.OK);
                    await notConfigured.WriteAsJsonAsync(new { configured = false, error = "Document Intelligence not configured" });
                    return notConfigured;
                }

                // Read the uploaded file from multipart body
                var contentType = req.Headers.TryGetValues("Content-Type", out var ctValues)
                    ? string.Join(",", ctValues) : "";

                byte[] fileBytes;
                string? mimeType = null;

                if (contentType.Contains("multipart/form-data", StringComparison.OrdinalIgnoreCase))
                {
                    var boundary = MultipartRequestHelper.GetBoundary(contentType);
                    var reader   = new MultipartReader(boundary, req.Body);
                    var section  = await reader.ReadNextSectionAsync();

                    if (section == null)
                    {
                        var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                        await bad.WriteStringAsync("No file in request");
                        return bad;
                    }

                    using var ms = new MemoryStream();
                    await section.Body.CopyToAsync(ms);
                    fileBytes = ms.ToArray();

                    // Detect mime from extension in Content-Disposition
                    var disposition = section.Headers != null &&
                                      section.Headers.ContainsKey("Content-Disposition")
                        ? section.Headers["Content-Disposition"].ToString() : "";
                    if (disposition.Contains(".pdf", StringComparison.OrdinalIgnoreCase))
                        mimeType = "application/pdf";
                    else if (disposition.Contains(".png", StringComparison.OrdinalIgnoreCase))
                        mimeType = "image/png";
                    else
                        mimeType = "image/jpeg";
                }
                else
                {
                    // Raw body
                    using var ms = new MemoryStream();
                    await req.Body.CopyToAsync(ms);
                    fileBytes = ms.ToArray();
                    mimeType  = contentType.Split(';')[0].Trim();
                }

                if (fileBytes.Length == 0)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Empty file");
                    return bad;
                }

                // Analyse with Azure Document Intelligence prebuilt-invoice model
                var client   = new DocumentAnalysisClient(new Uri(endpoint), new AzureKeyCredential(apiKey));
                using var stream = new MemoryStream(fileBytes);
                var operation = await client.AnalyzeDocumentAsync(WaitUntil.Completed, "prebuilt-invoice", stream);
                var result    = operation.Value;

                if (result.Documents.Count == 0)
                {
                    var empty = req.CreateResponse(HttpStatusCode.OK);
                    await empty.WriteAsJsonAsync(new { configured = true, found = false });
                    return empty;
                }

                var doc = result.Documents[0];

                // Extract top-level fields from invoice model
                var vendor       = GetStringField(doc, "VendorName");
                var invoiceDate  = GetDateField(doc, "InvoiceDate");
                var invoiceId    = GetStringField(doc, "InvoiceId");
                var subTotal     = GetAmountField(doc, "SubTotal");
                var totalTax     = GetAmountField(doc, "TotalTax");
                var invoiceTotal = GetAmountField(doc, "InvoiceTotal");
                var currency = GetCurrencyCode(doc);

                // Extract line items from invoice model
                var lines = new List<InvoiceLineItem>();
                if (doc.Fields.TryGetValue("Items", out var itemsField) &&
                    itemsField.FieldType == DocumentFieldType.List)
                {
                    foreach (var item in itemsField.Value.AsList())
                    {
                        if (item.FieldType != DocumentFieldType.Dictionary) continue;
                        var d = item.Value.AsDictionary();

                        var desc  = GetStringFromDict(d, "Description");
                        var qty   = GetDecimalFromDict(d, "Quantity") ?? 1m;
                        var unit  = GetAmountFromDict(d, "UnitPrice");
                        var tax   = GetAmountFromDict(d, "Tax");
                        var total = GetAmountFromDict(d, "Amount");

                        decimal? gross = total;
                        decimal? vatAmt = tax;
                        decimal? net = null;

                        if (gross.HasValue && vatAmt.HasValue)
                            net = gross - vatAmt;
                        else if (gross.HasValue)
                        {
                            net = currency == "GBP" ? Math.Round(gross.Value / 1.2m, 2) : gross.Value;
                            vatAmt = gross.Value - net;
                        }
                        else if (unit.HasValue)
                        {
                            gross = Math.Round(unit.Value * qty, 2);
                            net   = currency == "GBP" ? Math.Round(gross.Value / 1.2m, 2) : gross.Value;
                            vatAmt = gross.Value - net;
                        }

                        if (!string.IsNullOrWhiteSpace(desc) || gross.HasValue)
                        {
                            lines.Add(new InvoiceLineItem
                            {
                                Description = desc ?? "",
                                AmountNet   = net ?? 0m,
                                VatAmount   = vatAmt ?? 0m,
                                AmountGross = gross ?? 0m
                            });
                        }
                    }
                }

                // ── Fallback: try prebuilt-receipt when invoice results are weak ──────
                // Retail POS receipts (Apple Store, Amazon, etc.) use a receipt layout
                // that the invoice model cannot reliably extract. The receipt model uses
                // different field names: MerchantName, TransactionDate, Price/TotalPrice.
                // Also treat single-char vendor ("A" from Apple logo) or all-blank descriptions
                // as weak — the invoice model has misread a receipt layout.
                bool invoiceIsWeak = string.IsNullOrEmpty(vendor)
                                     || (vendor != null && vendor.Length <= 2)
                                     || !invoiceDate.HasValue
                                     || lines.Count == 0
                                     || lines.All(l => l.AmountGross == 0m)
                                     || (lines.Count > 0 && lines.All(l => string.IsNullOrWhiteSpace(l.Description)));
                if (invoiceIsWeak)
                {
                    try
                    {
                        // Create a fresh stream from the original bytes — the SDK closes the stream after use
                        using var receiptStream = new MemoryStream(fileBytes);
                        var receiptOp = await client.AnalyzeDocumentAsync(
                            WaitUntil.Completed, "prebuilt-receipt", receiptStream);

                        if (receiptOp.Value.Documents.Count > 0)
                        {
                            var rdoc      = receiptOp.Value.Documents[0];
                            var rVendor   = GetStringField(rdoc, "MerchantName");
                            var rDate     = GetDateField(rdoc, "TransactionDate");
                            var rTotal    = GetAmountField(rdoc, "Total");
                            // receipt model uses TotalTax; older versions may use Tax
                            var rTax      = GetAmountField(rdoc, "TotalTax") ?? GetAmountField(rdoc, "Tax");
                            var rSubtotal = GetAmountField(rdoc, "Subtotal");
                            var receiptCurrency = GetCurrencyCode(rdoc) ?? currency;

                            // Effective VAT rate from document totals (e.g. 23.33 / 116.62 = 0.2)
                            decimal? vatRate = (rTax.HasValue && rSubtotal.HasValue && rSubtotal.Value > 0)
                                ? rTax.Value / rSubtotal.Value : null;

                            var rLines = new List<InvoiceLineItem>();
                            if (rdoc.Fields.TryGetValue("Items", out var rItemsField) &&
                                rItemsField.FieldType == DocumentFieldType.List)
                            {
                                foreach (var rItem in rItemsField.Value.AsList())
                                {
                                    if (rItem.FieldType != DocumentFieldType.Dictionary) continue;
                                    var rd = rItem.Value.AsDictionary();

                                    // Receipt items use "Name" or "Description"
                                    var rDesc      = GetStringFromDict(rd, "Name") ?? GetStringFromDict(rd, "Description") ?? "";
                                    var rQty       = GetDecimalFromDict(rd, "Quantity") ?? 1m;
                                    var rUnitPrice = GetAmountFromDict(rd, "Price");      // typically NET (VAT-exclusive) on UK receipts
                                    var rItemTax   = GetAmountFromDict(rd, "Tax");
                                    var rItemTotal = GetAmountFromDict(rd, "TotalPrice"); // line gross total

                                    decimal? rGross, rVat, rNet;

                                    if (rUnitPrice.HasValue && rItemTotal.HasValue && rItemTotal.Value > rUnitPrice.Value * rQty + 0.01m)
                                    {
                                        // Price = net unit price, TotalPrice = gross line total (VAT-inclusive)
                                        rNet   = Math.Round(rUnitPrice.Value * rQty, 2);
                                        rGross = rItemTotal.Value;
                                        rVat   = rGross - rNet;
                                    }
                                    else if (rItemTotal.HasValue && rItemTax.HasValue)
                                    {
                                        rGross = rItemTotal.Value;
                                        rVat   = rItemTax.Value;
                                        rNet   = rGross - rVat;
                                    }
                                    else if (rItemTotal.HasValue)
                                    {
                                        rGross = rItemTotal.Value;
                                        rVat   = vatRate.HasValue
                                            ? Math.Round(rGross.Value * vatRate.Value / (1m + vatRate.Value), 2)
                                            : receiptCurrency == "GBP" ? Math.Round(rGross.Value / 6m, 2) : 0m;
                                        rNet   = rGross - rVat;
                                    }
                                    else if (rUnitPrice.HasValue)
                                    {
                                        // On UK receipts the displayed unit price is typically VAT-inclusive (gross).
                                        // Treat Price as gross and derive net/vat from document-level VAT rate.
                                        rGross = Math.Round(rUnitPrice.Value * rQty, 2);
                                        rVat   = vatRate.HasValue
                                            ? Math.Round(rGross.Value * vatRate.Value / (1m + vatRate.Value), 2)
                                            : receiptCurrency == "GBP" ? Math.Round(rGross.Value / 6m, 2) : 0m;
                                        rNet   = rGross - rVat;
                                    }
                                    else { rGross = null; rVat = null; rNet = null; }

                                    if (!string.IsNullOrWhiteSpace(rDesc) || rGross.HasValue)
                                    {
                                        rLines.Add(new InvoiceLineItem
                                        {
                                            Description = rDesc,
                                            AmountNet   = Math.Round(rNet   ?? 0m, 2),
                                            VatAmount   = Math.Round(rVat   ?? 0m, 2),
                                            AmountGross = Math.Round(rGross ?? 0m, 2)
                                        });
                                    }
                                }
                            }

                            // For a single-item receipt, ensure line totals match document totals
                            // (guards against the model reading "VAT Ex. Price" instead of "Total")
                            if (rLines.Count == 1 && rTotal.HasValue && rTax.HasValue
                                && Math.Abs(rLines[0].AmountGross - rTotal.Value) > 0.02m)
                            {
                                rLines[0] = new InvoiceLineItem
                                {
                                    Description = rLines[0].Description,
                                    AmountNet   = Math.Round(rTotal.Value - rTax.Value, 2),
                                    VatAmount   = Math.Round(rTax.Value, 2),
                                    AmountGross = Math.Round(rTotal.Value, 2)
                                };
                            }

                            // For multi-item receipts: if sum of gross lines doesn't match document total,
                            // redistribute VAT proportionally using the document-level VAT rate
                            if (rLines.Count > 1 && rTotal.HasValue && rTax.HasValue && rTotal.Value > 0)
                            {
                                var sumGross = rLines.Sum(l => l.AmountGross);
                                if (sumGross > 0 && Math.Abs(sumGross - rTotal.Value) > 0.05m)
                                {
                                    var scale = rTotal.Value / sumGross;
                                    var vRate = vatRate ?? (receiptCurrency == "GBP" ? 1m / 6m : 0m);
                                    rLines = rLines.Select(l => {
                                        var g = Math.Round(l.AmountGross * scale, 2);
                                        var v = Math.Round(g * vRate / (1m + vRate), 2);
                                        return new InvoiceLineItem
                                        {
                                            Description = l.Description,
                                            AmountGross = g,
                                            VatAmount   = v,
                                            AmountNet   = g - v
                                        };
                                    }).ToList();
                                }
                            }

                            // If all items lack price data but we have a document total,
                            // distribute the total evenly across the items
                            if (rLines.Count > 0 && rLines.All(l => l.AmountGross == 0m) && rTotal.HasValue && rTotal.Value > 0)
                            {
                                var perItem = Math.Round(rTotal.Value / rLines.Count, 2);
                                var docVatRate = vatRate ?? (rTax.HasValue && rTotal.HasValue && rTotal.Value > 0
                                    ? rTax.Value / rTotal.Value : receiptCurrency == "GBP" ? 1m / 6m : 0m);
                                rLines = rLines.Select((l, i) => {
                                    var g = (i == rLines.Count - 1)
                                        ? rTotal.Value - perItem * (rLines.Count - 1) // last item gets remainder
                                        : perItem;
                                    var v = Math.Round(g * docVatRate / (1m + docVatRate), 2);
                                    return new InvoiceLineItem { Description = l.Description, AmountGross = g, VatAmount = v, AmountNet = g - v };
                                }).ToList();
                            }

                            // Merge: receipt data supersedes weak invoice data
                            currency = receiptCurrency;
                            if (!string.IsNullOrEmpty(rVendor)) vendor = rVendor;
                            if (rDate.HasValue)  invoiceDate  = rDate;
                            if (rLines.Count > 0) lines        = rLines;
                            if (!subTotal.HasValue)     subTotal     = rSubtotal;
                            if (!totalTax.HasValue)     totalTax     = rTax;
                            if (!invoiceTotal.HasValue) invoiceTotal = rTotal;
                        }
                    }
                    catch (Exception receiptEx)
                    {
                        _logger.LogWarning("Receipt model fallback failed: {Msg}", receiptEx.Message);
                    }
                }

                // If still no lines, synthesise a single line from document-level totals
                if (lines.Count == 0 && (subTotal.HasValue || invoiceTotal.HasValue))
                {
                    var gross = invoiceTotal ?? (subTotal.HasValue && totalTax.HasValue ? subTotal + totalTax : subTotal);
                    var tax   = totalTax.HasValue ? totalTax : (gross.HasValue && currency == "GBP" ? Math.Round(gross.Value - Math.Round(gross.Value / 1.2m, 2), 2) : 0m);
                    var net   = (gross ?? 0m) - (tax ?? 0m);

                    lines.Add(new InvoiceLineItem
                    {
                        Description = vendor != null ? $"{vendor} receipt" : "Receipt total",
                        AmountNet   = Math.Round(net,         2),
                        VatAmount   = Math.Round(tax ?? 0m,   2),
                        AmountGross = Math.Round(gross ?? 0m, 2)
                    });
                }

                var payload = new
                {
                    configured  = true,
                    found       = true,
                    vendor      = vendor,
                    invoiceDate = invoiceDate?.ToString("yyyy-MM-dd"),
                    invoiceRef  = invoiceId,
                    currency    = currency,
                    lines       = lines
                };

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(payload);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error analysing invoice");
                var errResp = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errResp.WriteAsJsonAsync(new { configured = true, found = false, error = ex.Message });
                return errResp;
            }
        }

        // ── Field helpers ──────────────────────────────────────────────────────

        private static string? GetStringField(AnalyzedDocument doc, string name)
        {
            if (doc.Fields.TryGetValue(name, out var f) && f.FieldType == DocumentFieldType.String)
                return f.Value.AsString();
            return null;
        }

        private static string? GetCurrencyCode(AnalyzedDocument doc)
        {
            foreach (var name in new[] { "InvoiceTotal", "Total", "SubTotal", "Subtotal", "TotalTax", "Tax" })
            {
                if (!doc.Fields.TryGetValue(name, out var field) || field.FieldType != DocumentFieldType.Currency) continue;
                var code = field.Value.AsCurrency().Code;
                if (!string.IsNullOrWhiteSpace(code)) return code.Trim().ToUpperInvariant();
            }
            return FindCurrencyCode(doc.Fields.Values);
        }

        private static string? FindCurrencyCode(IEnumerable<DocumentField> fields)
        {
            foreach (var field in fields)
            {
                string? code = null;
                if (field.FieldType == DocumentFieldType.Currency) code = field.Value.AsCurrency().Code;
                else if (field.FieldType == DocumentFieldType.Dictionary) code = FindCurrencyCode(field.Value.AsDictionary().Values);
                else if (field.FieldType == DocumentFieldType.List) code = FindCurrencyCode(field.Value.AsList());
                if (!string.IsNullOrWhiteSpace(code)) return code.Trim().ToUpperInvariant();
            }
            return null;
        }

        private static DateTimeOffset? GetDateField(AnalyzedDocument doc, string name)
        {
            if (doc.Fields.TryGetValue(name, out var f) && f.FieldType == DocumentFieldType.Date)
                return f.Value.AsDate();
            return null;
        }

        private static decimal? GetAmountField(AnalyzedDocument doc, string name)
        {
            if (!doc.Fields.TryGetValue(name, out var f)) return null;
            if (f.FieldType == DocumentFieldType.Currency)
                return (decimal)f.Value.AsCurrency().Amount;
            if (f.FieldType == DocumentFieldType.Double)
                return (decimal)f.Value.AsDouble();
            return null;
        }

        private static string? GetStringFromDict(IReadOnlyDictionary<string, DocumentField> d, string name)
        {
            if (d.TryGetValue(name, out var f) && f.FieldType == DocumentFieldType.String)
                return f.Value.AsString();
            return null;
        }

        private static decimal? GetDecimalFromDict(IReadOnlyDictionary<string, DocumentField> d, string name)
        {
            if (d.TryGetValue(name, out var f) && f.FieldType == DocumentFieldType.Double)
                return (decimal)f.Value.AsDouble();
            return null;
        }

        private static decimal? GetAmountFromDict(IReadOnlyDictionary<string, DocumentField> d, string name)
        {
            if (!d.TryGetValue(name, out var f)) return null;
            if (f.FieldType == DocumentFieldType.Currency)
                return (decimal)f.Value.AsCurrency().Amount;
            if (f.FieldType == DocumentFieldType.Double)
                return (decimal)f.Value.AsDouble();
            if (f.FieldType == DocumentFieldType.String && decimal.TryParse(f.Value.AsString(), out var parsed))
                return parsed;
            return null;
        }
    }

    // ── Helper for multipart boundary ─────────────────────────────────────────

    internal static class MultipartRequestHelper
    {
        public static string GetBoundary(string contentType)
        {
            var parts = contentType.Split(';');
            foreach (var part in parts)
            {
                var trimmed = part.Trim();
                if (trimmed.StartsWith("boundary=", StringComparison.OrdinalIgnoreCase))
                    return trimmed.Substring("boundary=".Length).Trim('"');
            }
            throw new InvalidOperationException("Missing content-type boundary");
        }
    }

    // ── Return DTO ────────────────────────────────────────────────────────────

    public class InvoiceLineItem
    {
        [JsonPropertyName("description")]
        public string Description { get; set; } = "";
        [JsonPropertyName("amountNet")]
        public decimal AmountNet { get; set; }
        [JsonPropertyName("vatAmount")]
        public decimal VatAmount { get; set; }
        [JsonPropertyName("amountGross")]
        public decimal AmountGross { get; set; }
    }
}
