#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace FinanceHubFunctions.Helpers
{
    public sealed record ReceiptAnalysis(string? Vendor, DateTime? DocumentDate, decimal? Total, decimal? Tax, string? Currency, string? Reference);

    public sealed record ReceiptInboxItem(string Name, string FileName, long Size, DateTimeOffset? UploadedAt, string Status,
        string? Vendor, string? DocumentDate, decimal? Total, decimal? Tax, string? Currency, string? Reference, int? ExpenseId, string? Error);

    public static class ReceiptInboxPolicy
    {
        public const string Container = "receipt-inbox";
        public const long MaxBytes = 10 * 1024 * 1024;
        public const int MaxFilesPerUpload = 20;
        public static readonly string[] Statuses = { "new", "analysed", "failed", "matched", "dismissed" };
        private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = "application/pdf", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png",
            [".heic"] = "image/heic", [".heif"] = "image/heif", [".tif"] = "image/tiff", [".tiff"] = "image/tiff"
        };

        public static string? ContentTypeFor(string fileName) =>
            ContentTypes.TryGetValue(Path.GetExtension(fileName ?? ""), out var type) ? type : null;

        public static string? ValidateUpload(string? fileName, long length)
        {
            if (string.IsNullOrWhiteSpace(fileName) || fileName.Length > 255) return "Each receipt needs a file name of at most 255 characters";
            if (ContentTypeFor(fileName) == null) return $"{SafeName(fileName)}: only PDF, JPEG, PNG, HEIC or TIFF receipts are accepted";
            if (length <= 0 || length > MaxBytes) return $"{SafeName(fileName)}: receipts must be between 1 byte and 10 MB";
            return null;
        }

        public static string SafeName(string fileName)
        {
            var name = Path.GetFileName(fileName.Replace('\\', '/'));
            var builder = new StringBuilder();
            foreach (var character in name)
                builder.Append(char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or '_' ? character : '-');
            var safe = builder.ToString().Trim('-', '.');
            if (safe.Length == 0) safe = "receipt";
            return safe.Length <= 80 ? safe : safe[^80..];
        }

        public static string BlobName(DateTime now, Guid id, string fileName) =>
            $"{now:yyyy-MM}/{id:N}-{SafeName(fileName)}";

        public static bool ValidBlobName(string? name) => !string.IsNullOrWhiteSpace(name) && name.Length <= 1024
            && !name.StartsWith('/') && !name.Split('/').Any(part => part is "" or "." or "..");

        private static string Encode(string value) => Uri.EscapeDataString(value.Length > 200 ? value[..200] : value);
        private static string? Decode(IDictionary<string, string> metadata, string key) =>
            metadata.TryGetValue(key, out var value) && !string.IsNullOrEmpty(value) ? Uri.UnescapeDataString(value) : null;
        private static decimal? Money(string? value) =>
            decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) ? amount : null;

        public static Dictionary<string, string> UploadMetadata(string originalName) => new()
        {
            ["status"] = "new", ["originalname"] = Encode(Path.GetFileName(originalName.Replace('\\', '/')))
        };

        public static Dictionary<string, string> WithAnalysis(IDictionary<string, string> metadata, ReceiptAnalysis? analysis, string? error)
        {
            var next = metadata.Where(pair => pair.Key is "originalname").ToDictionary(pair => pair.Key, pair => pair.Value);
            if (error != null)
            {
                next["status"] = "failed";
                next["error"] = Encode(error);
                return next;
            }
            next["status"] = "analysed";
            if (!string.IsNullOrWhiteSpace(analysis?.Vendor)) next["vendor"] = Encode(analysis.Vendor.Trim());
            if (analysis?.DocumentDate != null) next["documentdate"] = analysis.DocumentDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (analysis?.Total != null) next["total"] = decimal.Round(analysis.Total.Value, 2).ToString(CultureInfo.InvariantCulture);
            if (analysis?.Tax != null) next["tax"] = decimal.Round(analysis.Tax.Value, 2).ToString(CultureInfo.InvariantCulture);
            if (!string.IsNullOrWhiteSpace(analysis?.Currency)) next["currency"] = Encode(analysis.Currency.Trim().ToUpperInvariant());
            if (!string.IsNullOrWhiteSpace(analysis?.Reference)) next["reference"] = Encode(analysis.Reference.Trim());
            return next;
        }

        public static Dictionary<string, string> WithStatus(IDictionary<string, string> metadata, string status, int? expenseId = null)
        {
            if (!Statuses.Contains(status)) throw new ArgumentException("Unknown receipt status", nameof(status));
            var next = new Dictionary<string, string>(metadata) { ["status"] = status };
            if (expenseId.HasValue) next["expenseid"] = expenseId.Value.ToString(CultureInfo.InvariantCulture);
            return next;
        }

        public static ReceiptInboxItem Read(string name, long size, DateTimeOffset? uploadedAt, IDictionary<string, string>? metadata)
        {
            var values = new Dictionary<string, string>(metadata ?? new Dictionary<string, string>(), StringComparer.OrdinalIgnoreCase);
            var status = Decode(values, "status");
            return new(name, Decode(values, "originalname") ?? Path.GetFileName(name), size, uploadedAt,
                status != null && Statuses.Contains(status) ? status : "new",
                Decode(values, "vendor"), Decode(values, "documentdate"), Money(Decode(values, "total")), Money(Decode(values, "tax")),
                Decode(values, "currency"), Decode(values, "reference"),
                int.TryParse(Decode(values, "expenseid"), NumberStyles.None, CultureInfo.InvariantCulture, out var expenseId) ? expenseId : null,
                Decode(values, "error"));
        }

        public static bool IsOpen(ReceiptInboxItem item) => item.Status is "new" or "analysed" or "failed";
    }
}
