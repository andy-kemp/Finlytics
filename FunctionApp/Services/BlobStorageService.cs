#nullable enable
using Azure.Core;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace FinanceHubFunctions.Services
{
    public class BlobStorageService
    {
        private readonly BlobServiceClient _blobServiceClient;
        private const string ExpenseReceiptsContainer = "expense-receipts";
        private const string InvoicePdfsContainer = "invoice-pdfs";
        private const string QuotePdfsContainer = "quote-pdfs";
        private const string CompanyDocumentsContainer = "company-documents";

        public BlobStorageService(string connectionString)
        {
            _blobServiceClient = new BlobServiceClient(connectionString);
        }

        public BlobStorageService(Uri blobServiceUri, TokenCredential credential)
        {
            _blobServiceClient = new BlobServiceClient(blobServiceUri, credential);
        }

        public async Task<string> UploadReceiptAsync(int expenseId, string expenseCode, byte[] fileContent, string fileName)
        {
            // Get or create container
            var containerClient = _blobServiceClient.GetBlobContainerClient(ExpenseReceiptsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            // Generate blob name: ExpenseCode/filename (e.g., MIC001-2026-001/receipt.pdf)
            var blobName = $"{expenseCode}/{fileName}";
            var blobClient = containerClient.GetBlobClient(blobName);

            // Upload with metadata
            using var stream = new MemoryStream(fileContent);
            var metadata = new Dictionary<string, string>
            {
                { "ExpenseId", expenseId.ToString() },
                { "ExpenseCode", expenseCode },
                { "DocumentType", "Receipt" },
                { "UploadDate", DateTime.UtcNow.ToString("O") }
            };

            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = metadata,
                HttpHeaders = new BlobHttpHeaders
                {
                    ContentType = GetContentType(fileName)
                }
            });

            return blobClient.Uri.ToString();
        }

        public async Task<string> UploadInvoicePdfAsync(string invoiceNumber, byte[] pdfContent, string customerCode = null, string customerName = null, DateTime? invoiceDate = null)
        {
            // Use company-documents container for all PDFs
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            // Generate blob name: INV-ESK001-2026-487.pdf
            var blobName = customerCode != null 
                ? $"{invoiceNumber}.pdf" 
                : $"{invoiceNumber}.pdf"; // Fallback if no customer code
            var blobClient = containerClient.GetBlobClient(blobName);

            // Upload PDF
            using var stream = new MemoryStream(pdfContent);
            var date = invoiceDate ?? DateTime.UtcNow;
            var metadata = new Dictionary<string, string>
            {
                { "DocumentType", "Invoice PDF" },
                { "InvoiceNumber", invoiceNumber },
                { "OriginalFileName", blobName },
                { "GeneratedDate", DateTime.UtcNow.ToString("O") },
                { "DocumentDate", date.ToString("O") },
                { "Year", date.Year.ToString() },
                { "Month", date.Month.ToString() },
                { "IsActive", "true" }
            };

            if (!string.IsNullOrEmpty(customerCode))
            {
                metadata["CustomerCode"] = customerCode;
            }
            
            if (!string.IsNullOrEmpty(customerName))
            {
                metadata["CustomerName"] = customerName;
            }

            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = metadata,
                HttpHeaders = new BlobHttpHeaders
                {
                    ContentType = "application/pdf"
                }
            });

            return blobClient.Uri.ToString();
        }

        /// <summary>Downloads an invoice PDF from the company-documents container by invoice number.</summary>
        public async Task<byte[]> DownloadInvoicePdfAsync(string invoiceNumber)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            var blobClient = containerClient.GetBlobClient($"{invoiceNumber}.pdf");
            if (!await blobClient.ExistsAsync())
                return null;
            using var ms = new MemoryStream();
            var download = await blobClient.DownloadAsync();
            await download.Value.Content.CopyToAsync(ms);
            return ms.ToArray();
        }

        public async Task<string> UploadQuotePdfAsync(string quoteNumber, byte[] pdfContent, string customerCode = null, string customerName = null, DateTime? quoteDate = null)
        {
            // Use company-documents container for all PDFs
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            // Generate blob name: QUO-ESK001-2026-642.pdf
            var blobName = customerCode != null 
                ? $"{quoteNumber}.pdf" 
                : $"{quoteNumber}.pdf"; // Fallback if no customer code
            var blobClient = containerClient.GetBlobClient(blobName);

            // Upload PDF
            using var stream = new MemoryStream(pdfContent);
            var date = quoteDate ?? DateTime.UtcNow;
            var metadata = new Dictionary<string, string>
            {
                { "DocumentType", "Quote PDF" },
                { "QuoteNumber", quoteNumber },
                { "OriginalFileName", blobName },
                { "GeneratedDate", DateTime.UtcNow.ToString("O") },
                { "DocumentDate", date.ToString("O") },
                { "Year", date.Year.ToString() },
                { "Month", date.Month.ToString() },
                { "IsActive", "true" }
            };

            if (!string.IsNullOrEmpty(customerCode))
            {
                metadata["CustomerCode"] = customerCode;
            }
            
            if (!string.IsNullOrEmpty(customerName))
            {
                metadata["CustomerName"] = customerName;
            }

            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = metadata,
                HttpHeaders = new BlobHttpHeaders
                {
                    ContentType = "application/pdf"
                }
            });

            return blobClient.Uri.ToString();
        }

        public async Task<string> UploadCreditNotePdfAsync(string creditNoteNumber, byte[] pdfContent, string customerName = null, DateTime? issueDate = null)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            var blobName = $"creditnotes/{creditNoteNumber}.pdf";
            var blobClient = containerClient.GetBlobClient(blobName);

            using var stream = new MemoryStream(pdfContent);
            var date = issueDate ?? DateTime.UtcNow;
            var metadata = new Dictionary<string, string>
            {
                { "DocumentType", "Credit Note PDF" },
                { "CreditNoteNumber", creditNoteNumber },
                { "OriginalFileName", blobName },
                { "GeneratedDate", DateTime.UtcNow.ToString("O") },
                { "DocumentDate", date.ToString("O") },
                { "Year", date.Year.ToString() },
                { "Month", date.Month.ToString() },
                { "IsActive", "true" }
            };

            if (!string.IsNullOrEmpty(customerName))
                metadata["CustomerName"] = customerName;

            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = metadata,
                HttpHeaders = new BlobHttpHeaders { ContentType = "application/pdf" }
            });

            return blobClient.Uri.ToString();
        }

        public async Task<List<ExpenseReceiptInfo>> GetReceiptsAsync(int expenseId, string expenseCode)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(ExpenseReceiptsContainer);
            
            if (!await containerClient.ExistsAsync())
                return new List<ExpenseReceiptInfo>();

            var receipts = new List<ExpenseReceiptInfo>();
            var prefix = $"{expenseCode}/";

            await foreach (var blobItem in containerClient.GetBlobsAsync(prefix: prefix))
            {
                var blobClient = containerClient.GetBlobClient(blobItem.Name);
                var properties = await blobClient.GetPropertiesAsync();

                receipts.Add(new ExpenseReceiptInfo
                {
                    FileName = Path.GetFileName(blobItem.Name),
                    BlobName = blobItem.Name,
                    Url = blobClient.Uri.ToString(),
                    SizeInBytes = blobItem.Properties.ContentLength ?? 0,
                    UploadDate = properties.Value.CreatedOn.DateTime,
                    ContentType = properties.Value.ContentType
                });
            }

            return receipts;
        }

        public async Task<(byte[] Content, string ContentType, string FileName)> DownloadReceiptAsync(string blobName)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(ExpenseReceiptsContainer);
            var blobClient = containerClient.GetBlobClient(blobName);

            var download = await blobClient.DownloadAsync();
            using var memoryStream = new MemoryStream();
            await download.Value.Content.CopyToAsync(memoryStream);

            var properties = await blobClient.GetPropertiesAsync();

            return (
                memoryStream.ToArray(),
                properties.Value.ContentType,
                Path.GetFileName(blobName)
            );
        }

        public async Task DeleteReceiptAsync(string blobName)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(ExpenseReceiptsContainer);
            var blobClient = containerClient.GetBlobClient(blobName);
            await blobClient.DeleteIfExistsAsync();
        }

        public async Task<string> UploadMissingReceiptDeclarationPdfAsync(int expenseId, string declarationId, byte[] pdfContent)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(ExpenseReceiptsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            // Store alongside receipts: e.g. EXP-20260315-001/MRD-20260315-001.pdf
            var blobName = $"declarations/{declarationId}.pdf";
            var blobClient = containerClient.GetBlobClient(blobName);
            await blobClient.DeleteIfExistsAsync();

            using var stream = new MemoryStream(pdfContent);
            var metadata = new Dictionary<string, string>
            {
                { "ExpenseId", expenseId.ToString() },
                { "DeclarationId", declarationId },
                { "DocumentType", "MissingReceiptDeclaration" },
                { "GeneratedDate", DateTime.UtcNow.ToString("O") }
            };

            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = metadata,
                HttpHeaders = new BlobHttpHeaders { ContentType = "application/pdf" }
            });

            return blobName;
        }

        public async Task<byte[]> DownloadMissingReceiptDeclarationPdfAsync(string declarationId)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(ExpenseReceiptsContainer);
            var blobClient = containerClient.GetBlobClient($"declarations/{declarationId}.pdf");
            if (!await blobClient.ExistsAsync()) return null;
            using var ms = new MemoryStream();
            var download = await blobClient.DownloadAsync();
            await download.Value.Content.CopyToAsync(ms);
            return ms.ToArray();
        }

        public async Task<string> UploadAssetInvoiceAsync(int assetId, string assetCode, byte[] fileContent, string fileName)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            var blobName = $"assets/{assetCode}/{fileName}";
            var blobClient = containerClient.GetBlobClient(blobName);

            // Allow re-upload by deleting any existing blob at this path
            await blobClient.DeleteIfExistsAsync();

            using var stream = new MemoryStream(fileContent);
            var metadata = new Dictionary<string, string>
            {
                { "AssetId", assetId.ToString() },
                { "AssetCode", assetCode },
                { "DocumentType", "AssetInvoice" },
                { "UploadDate", DateTime.UtcNow.ToString("O") }
            };

            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = metadata,
                HttpHeaders = new BlobHttpHeaders { ContentType = GetContentType(fileName) }
            });

            return blobClient.Uri.ToString();
        }

        private const string VatConfirmationsContainer = "vat-confirmations";

        public async Task<string> UploadVatConfirmationAsync(int vatReturnId, string quarterLabel, byte[] fileContent, string fileName)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(VatConfirmationsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            var timestamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
            var sanitized = string.Join("_", fileName.Split(Path.GetInvalidFileNameChars()));
            var safeQuarter = string.Join("-", quarterLabel.Split(Path.GetInvalidFileNameChars())).Replace(" ", "-").Replace("/", "-");
            var blobName = $"{safeQuarter}/{timestamp}_{sanitized}";
            var blobClient = containerClient.GetBlobClient(blobName);

            using var stream = new MemoryStream(fileContent);
            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = new Dictionary<string, string>
                {
                    { "VatReturnId", vatReturnId.ToString() },
                    { "QuarterLabel", quarterLabel },
                    { "OriginalFileName", fileName },
                    { "UploadDate", DateTime.UtcNow.ToString("O") }
                },
                HttpHeaders = new BlobHttpHeaders { ContentType = GetContentType(fileName) }
            });

            return blobClient.Uri.ToString();
        }

        private string GetContentType(string fileName)
        {
            var extension = Path.GetExtension(fileName).ToLowerInvariant();
            return extension switch
            {
                ".pdf" => "application/pdf",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".gif" => "image/gif",
                ".bmp" => "image/bmp",
                ".tiff" or ".tif" => "image/tiff",
                ".webp" => "image/webp",
                _ => "application/octet-stream"
            };
        }

        // Company Documents methods
        public async Task<string> UploadCompanyDocumentAsync(string fileName, byte[] fileContent, string documentType, 
            string? personName = null, string? personTitle = null, bool isActive = false, string? relatedEntity = null,
            DateTime? documentDate = null, DateTime? expiryDate = null, string? notes = null)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            await containerClient.CreateIfNotExistsAsync(PublicAccessType.None);

            // Generate unique blob name with timestamp to avoid conflicts
            var timestamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
            var sanitizedFileName = string.Join("_", fileName.Split(Path.GetInvalidFileNameChars()));
            var blobName = $"{documentType}/{timestamp}_{sanitizedFileName}";
            var blobClient = containerClient.GetBlobClient(blobName);

            using var stream = new MemoryStream(fileContent);
            var metadata = new Dictionary<string, string>
            {
                { "DocumentType", documentType },
                { "OriginalFileName", fileName },
                { "UploadDate", DateTime.UtcNow.ToString("O") },
                { "IsActive", isActive.ToString() }
            };

            if (!string.IsNullOrEmpty(personName)) metadata["PersonName"] = personName;
            if (!string.IsNullOrEmpty(personTitle)) metadata["PersonTitle"] = personTitle;
            if (!string.IsNullOrEmpty(relatedEntity)) metadata["RelatedEntity"] = relatedEntity;
            if (documentDate.HasValue) metadata["DocumentDate"] = documentDate.Value.ToString("O");
            if (expiryDate.HasValue) metadata["ExpiryDate"] = expiryDate.Value.ToString("O");
            if (!string.IsNullOrEmpty(notes)) metadata["Notes"] = notes;

            await blobClient.UploadAsync(stream, new BlobUploadOptions
            {
                Metadata = metadata,
                HttpHeaders = new BlobHttpHeaders
                {
                    ContentType = GetContentType(fileName)
                }
            });

            return blobClient.Uri.ToString();
        }

        public async Task<List<CompanyDocumentInfo>> GetCompanyDocumentsAsync()
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            
            if (!await containerClient.ExistsAsync())
                return new List<CompanyDocumentInfo>();

            var documents = new List<CompanyDocumentInfo>();

            await foreach (var blobItem in containerClient.GetBlobsAsync(BlobTraits.Metadata))
            {
                var blobClient = containerClient.GetBlobClient(blobItem.Name);
                var properties = await blobClient.GetPropertiesAsync();
                var metadata = properties.Value.Metadata;

                documents.Add(new CompanyDocumentInfo
                {
                    BlobName = blobItem.Name,
                    FileName = metadata.ContainsKey("OriginalFileName") ? metadata["OriginalFileName"] : Path.GetFileName(blobItem.Name),
                    Url = blobClient.Uri.ToString(),
                    DocumentType = metadata.ContainsKey("DocumentType") ? metadata["DocumentType"] : "Unknown",
                    PersonName = metadata.ContainsKey("PersonName") ? metadata["PersonName"] : null,
                    PersonTitle = metadata.ContainsKey("PersonTitle") ? metadata["PersonTitle"] : null,
                    IsActive = metadata.ContainsKey("IsActive") && bool.TryParse(metadata["IsActive"], out var active) && active,
                    RelatedEntity = metadata.ContainsKey("RelatedEntity") ? metadata["RelatedEntity"] : null,
                    DocumentDate = metadata.ContainsKey("DocumentDate") && DateTime.TryParse(metadata["DocumentDate"], out var docDate) ? docDate : null,
                    ExpiryDate = metadata.ContainsKey("ExpiryDate") && DateTime.TryParse(metadata["ExpiryDate"], out var expDate) ? expDate : null,
                    Notes = metadata.ContainsKey("Notes") ? metadata["Notes"] : null,
                    SizeInBytes = blobItem.Properties.ContentLength ?? 0,
                    UploadDate = properties.Value.CreatedOn.DateTime,
                    ContentType = properties.Value.ContentType,
                    CustomerName = metadata.ContainsKey("CustomerName") ? metadata["CustomerName"] : null,
                    CustomerCode = metadata.ContainsKey("CustomerCode") ? metadata["CustomerCode"] : null
                });
            }

            return documents.OrderByDescending(d => d.UploadDate).ToList();
        }

        public async Task<(byte[] Content, string ContentType, string FileName)> DownloadCompanyDocumentAsync(string blobName)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            var blobClient = containerClient.GetBlobClient(blobName);

            var download = await blobClient.DownloadAsync();
            using var memoryStream = new MemoryStream();
            await download.Value.Content.CopyToAsync(memoryStream);

            var properties = await blobClient.GetPropertiesAsync();
            var fileName = properties.Value.Metadata.ContainsKey("OriginalFileName") 
                ? properties.Value.Metadata["OriginalFileName"] 
                : Path.GetFileName(blobName);

            return (
                memoryStream.ToArray(),
                properties.Value.ContentType,
                fileName
            );
        }

        public async Task DeleteCompanyDocumentAsync(string blobName)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            var blobClient = containerClient.GetBlobClient(blobName);
            await blobClient.DeleteIfExistsAsync();
        }

        public async Task UpdateCompanyDocumentMetadataAsync(string blobName, string? documentType = null,
            string? personName = null, string? personTitle = null, bool? isActive = null, string? relatedEntity = null,
            DateTime? documentDate = null, DateTime? expiryDate = null, string? notes = null)
        {
            var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
            var blobClient = containerClient.GetBlobClient(blobName);

            var properties = await blobClient.GetPropertiesAsync();
            var metadata = new Dictionary<string, string>(properties.Value.Metadata);

            if (!string.IsNullOrEmpty(documentType)) metadata["DocumentType"] = documentType;
            if (!string.IsNullOrEmpty(personName)) metadata["PersonName"] = personName;
            if (!string.IsNullOrEmpty(personTitle)) metadata["PersonTitle"] = personTitle;
            if (isActive.HasValue) metadata["IsActive"] = isActive.Value.ToString();
            if (!string.IsNullOrEmpty(relatedEntity)) metadata["RelatedEntity"] = relatedEntity;
            if (documentDate.HasValue) metadata["DocumentDate"] = documentDate.Value.ToString("O");
            if (expiryDate.HasValue) metadata["ExpiryDate"] = expiryDate.Value.ToString("O");
            if (!string.IsNullOrEmpty(notes)) metadata["Notes"] = notes;

            await blobClient.SetMetadataAsync(metadata);
        }

        /// <summary>
        /// Gets logo bytes from a specific blob URL (used for DocumentLogoUrl/EmailLogoUrl).
        /// Extracts the blob path from the URL and downloads from the same storage account.
        /// </summary>
        public async Task<(byte[]? Bytes, string? ContentType)> GetLogoBytesFromUrlAsync(string logoUrl)
        {
            try
            {
                // The URL is a blob storage URL — extract container and blob path
                var uri = new Uri(logoUrl);
                var pathSegments = uri.AbsolutePath.TrimStart('/').Split('/', 2);
                if (pathSegments.Length < 2)
                    return (null, null);

                var containerName = Uri.UnescapeDataString(pathSegments[0]);
                var blobPath = Uri.UnescapeDataString(pathSegments[1]);

                var containerClient = _blobServiceClient.GetBlobContainerClient(containerName);
                var blobClient = containerClient.GetBlobClient(blobPath);

                if (!await blobClient.ExistsAsync())
                    return (null, null);

                var downloadResult = await blobClient.DownloadContentAsync();
                var properties = await blobClient.GetPropertiesAsync();
                return (downloadResult.Value.Content.ToArray(), properties.Value.ContentType);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error loading logo from URL {logoUrl}: {ex.Message}");
                return (null, null);
            }
        }

        /// <summary>
        /// Gets the active company logo directly from blob storage with authentication
        /// Returns tuple of (bytes, contentType)
        /// </summary>
        public async Task<(byte[]? Bytes, string? ContentType)> GetLogoAsync(int companyId)
        {
            try
            {
                var containerClient = _blobServiceClient.GetBlobContainerClient(CompanyDocumentsContainer);
                
                // Check if container exists
                if (!await containerClient.ExistsAsync())
                {
                    Console.WriteLine($"Container {CompanyDocumentsContainer} does not exist");
                    return (null, null);
                }
                
                Console.WriteLine($"Searching for logo with prefix: company{companyId}/");

                bool IsActive(IDictionary<string, string> metadata)
                {
                    if (!metadata.TryGetValue("IsActive", out var isActiveValue))
                        return true;
                    return string.Equals(isActiveValue, "true", StringComparison.OrdinalIgnoreCase);
                }

                bool IsLogoCandidate(IDictionary<string, string> metadata, string blobName)
                {
                    if (metadata.TryGetValue("DocumentType", out var docType) &&
                        docType.IndexOf("logo", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return true;
                    }

                    return blobName.IndexOf("logo", StringComparison.OrdinalIgnoreCase) >= 0;
                }

                await foreach (var blobItem in containerClient.GetBlobsAsync(traits: BlobTraits.Metadata, prefix: $"company{companyId}/"))
                {
                    Console.WriteLine($"Found blob: {blobItem.Name}, Metadata: {string.Join(", ", blobItem.Metadata.Select(m => $"{m.Key}={m.Value}"))}");

                    if (IsLogoCandidate(blobItem.Metadata, blobItem.Name) && IsActive(blobItem.Metadata))
                    {
                        var blobClient = containerClient.GetBlobClient(blobItem.Name);
                        var downloadResult = await blobClient.DownloadContentAsync();
                        var properties = await blobClient.GetPropertiesAsync();
                        var contentType = properties.Value.ContentType;
                        
                        Console.WriteLine($"Successfully loaded logo: {blobItem.Name}, ContentType: {contentType}, Size: {downloadResult.Value.Content.ToArray().Length} bytes");
                        return (downloadResult.Value.Content.ToArray(), contentType);
                    }
                }
                
                Console.WriteLine($"No active logo found for company {companyId} in prefix. Scanning all blobs for logo...");

                await foreach (var blobItem in containerClient.GetBlobsAsync(traits: BlobTraits.Metadata))
                {
                    if (!IsLogoCandidate(blobItem.Metadata, blobItem.Name) || !IsActive(blobItem.Metadata))
                        continue;

                    Console.WriteLine($"Fallback logo candidate: {blobItem.Name}, Metadata: {string.Join(", ", blobItem.Metadata.Select(m => $"{m.Key}={m.Value}"))}");

                    var blobClient = containerClient.GetBlobClient(blobItem.Name);
                    var downloadResult = await blobClient.DownloadContentAsync();
                    var properties = await blobClient.GetPropertiesAsync();
                    var contentType = properties.Value.ContentType;

                    Console.WriteLine($"Successfully loaded fallback logo: {blobItem.Name}, ContentType: {contentType}, Size: {downloadResult.Value.Content.ToArray().Length} bytes");
                    return (downloadResult.Value.Content.ToArray(), contentType);
                }

                Console.WriteLine($"No active logo found for company {companyId}");
                return (null, null);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error loading logo for company {companyId}: {ex.Message}");
                // Logo failed to load - continue without it
                return (null, null);
            }
        }

        /// <summary>
        /// Gets the active company logo as base64 data URL for email embedding
        /// </summary>
        public async Task<string?> GetLogoBase64Async(int companyId)
        {
            var (logoBytes, contentType) = await GetLogoAsync(companyId);
            if (logoBytes == null || logoBytes.Length == 0)
                return null;

            // Default to PNG if content type not available
            var mimeType = contentType ?? "image/png";
            var base64 = Convert.ToBase64String(logoBytes);
            return $"data:{mimeType};base64,{base64}";
        }
    }

    public class ExpenseReceiptInfo
    {
        public string FileName { get; set; } = "";
        public string BlobName { get; set; } = "";
        public string Url { get; set; } = "";
        public long SizeInBytes { get; set; }
        public DateTime UploadDate { get; set; }
        public string ContentType { get; set; } = "";
    }

    public class CompanyDocumentInfo
    {
        public string BlobName { get; set; } = "";
        public string FileName { get; set; } = "";
        public string Url { get; set; } = "";
        public string DocumentType { get; set; } = "";
        public string? PersonName { get; set; }
        public string? PersonTitle { get; set; }
        public bool IsActive { get; set; }
        public string? RelatedEntity { get; set; }
        public DateTime? DocumentDate { get; set; }
        public DateTime? ExpiryDate { get; set; }
        public string? Notes { get; set; }
        public long SizeInBytes { get; set; }
        public DateTime UploadDate { get; set; }
        public string ContentType { get; set; } = "";
        public string? CustomerName { get; set; }
        public string? CustomerCode { get; set; }
    }
}
