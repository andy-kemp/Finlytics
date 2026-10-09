#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FinanceHubFunctions.Helpers;
using FinanceHubFunctions.Services;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace FinanceHubFunctions.Functions
{
    public sealed class ReceiptInboxFunctions
    {
        private const int AnalyseBatch = 10;
        private readonly SettlementAuthService _auth;
        private readonly ReceiptAnalysisService _analysis;
        private readonly BlobStorageService? _blobs;
        private readonly ILogger<ReceiptInboxFunctions> _logger;

        public ReceiptInboxFunctions(SettlementAuthService auth, ReceiptAnalysisService analysis, ILogger<ReceiptInboxFunctions> logger,
            BlobStorageService? blobs = null)
        {
            _auth = auth;
            _analysis = analysis;
            _logger = logger;
            _blobs = blobs;
        }

        internal static async Task<HttpResponseData> Json(HttpRequestData req, HttpStatusCode status, object value)
        {
            var response = req.CreateResponse(status);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            await response.WriteStringAsync(JsonSerializer.Serialize(value, CashBaselinePolicy.Json));
            return response;
        }

        private async Task<HttpResponseData?> Guard(HttpRequestData req)
        {
            var authorization = await _auth.ValidateRequest(req);
            if (!authorization.IsAuthorized) return await Json(req, authorization.StatusCode, new { error = authorization.Error });
            return _blobs == null ? await Json(req, HttpStatusCode.ServiceUnavailable, new { error = "Receipt storage is not configured" }) : null;
        }

        private async Task<ReceiptInboxItem> Analyse(string name, byte[] content, IDictionary<string, string> metadata, long size, DateTimeOffset? uploaded)
        {
            Dictionary<string, string> next;
            try
            {
                next = ReceiptInboxPolicy.WithAnalysis(metadata, await _analysis.AnalyzeAsync(content), null);
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Receipt analysis failed for {Name}", name);
                next = ReceiptInboxPolicy.WithAnalysis(metadata, null, exception is InvalidOperationException
                    ? exception.Message : "Receipt could not be read automatically");
            }
            await _blobs!.SetInboxMetadataAsync(name, next);
            return ReceiptInboxPolicy.Read(name, size, uploaded, next);
        }

        [Function("ListReceiptInbox")]
        public async Task<HttpResponseData> List(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "receipts/inbox")] HttpRequestData req)
        {
            var blocked = await Guard(req);
            if (blocked != null) return blocked;
            try
            {
                var items = await _blobs!.ListInboxReceiptsAsync();
                return await Json(req, HttpStatusCode.OK, items.Where(ReceiptInboxPolicy.IsOpen)
                    .OrderByDescending(item => item.UploadedAt).ToList());
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Error listing receipt inbox");
                return await Json(req, HttpStatusCode.ServiceUnavailable, new { error = "Receipt inbox is unavailable" });
            }
        }

        [Function("UploadReceiptInbox")]
        public async Task<HttpResponseData> Upload(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "receipts/inbox")] HttpRequestData req)
        {
            var blocked = await Guard(req);
            if (blocked != null) return blocked;
            var contentType = req.Headers.TryGetValues("Content-Type", out var values) ? string.Join(",", values) : "";
            if (!MediaTypeHeaderValue.TryParse(contentType, out var media) || !media.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase)
                || string.IsNullOrWhiteSpace(HeaderUtilities.RemoveQuotes(media.Boundary).Value))
                return await Json(req, HttpStatusCode.BadRequest, new { error = "Upload receipts as multipart/form-data" });

            var files = new List<(string Name, byte[] Content)>();
            try
            {
                var reader = new MultipartReader(HeaderUtilities.RemoveQuotes(media.Boundary).Value!, req.Body) { BodyLengthLimit = ReceiptInboxPolicy.MaxBytes };
                for (var section = await reader.ReadNextSectionAsync(); section != null; section = await reader.ReadNextSectionAsync())
                {
                    if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)) continue;
                    var fileName = disposition.FileNameStar.HasValue ? disposition.FileNameStar.Value : HeaderUtilities.RemoveQuotes(disposition.FileName).Value;
                    if (string.IsNullOrEmpty(fileName)) continue;
                    if (files.Count == ReceiptInboxPolicy.MaxFilesPerUpload)
                        return await Json(req, HttpStatusCode.BadRequest, new { error = $"Upload at most {ReceiptInboxPolicy.MaxFilesPerUpload} receipts at a time" });
                    using var buffer = new MemoryStream();
                    await section.Body.CopyToAsync(buffer);
                    var error = ReceiptInboxPolicy.ValidateUpload(fileName, buffer.Length);
                    if (error != null) return await Json(req, HttpStatusCode.BadRequest, new { error });
                    files.Add((fileName, buffer.ToArray()));
                }
            }
            catch (InvalidDataException)
            {
                return await Json(req, HttpStatusCode.BadRequest, new { error = "Each receipt must be 10 MB or smaller" });
            }
            if (files.Count == 0) return await Json(req, HttpStatusCode.BadRequest, new { error = "No receipt files were uploaded" });

            var results = new List<ReceiptInboxItem>();
            foreach (var (fileName, content) in files)
            {
                var now = DateTime.UtcNow;
                var name = ReceiptInboxPolicy.BlobName(now, Guid.NewGuid(), fileName);
                var metadata = ReceiptInboxPolicy.UploadMetadata(fileName);
                await _blobs!.UploadInboxReceiptAsync(name, content, ReceiptInboxPolicy.ContentTypeFor(fileName)!, metadata);
                results.Add(await Analyse(name, content, metadata, content.Length, now));
            }
            return await Json(req, HttpStatusCode.Created, results);
        }

        [Function("AnalyseReceiptInbox")]
        public async Task<HttpResponseData> AnalysePending(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "receipts/inbox/analyse")] HttpRequestData req)
        {
            var blocked = await Guard(req);
            if (blocked != null) return blocked;
            var pending = (await _blobs!.ListInboxReceiptsAsync()).Where(item => item.Status == "new").OrderBy(item => item.UploadedAt).ToList();
            var analysed = new List<ReceiptInboxItem>();
            foreach (var item in pending.Take(AnalyseBatch))
            {
                var download = await _blobs.DownloadInboxReceiptAsync(item.Name);
                if (download == null) continue;
                var metadata = new Dictionary<string, string>(download.Value.Metadata);
                if (!metadata.ContainsKey("originalname")) metadata["originalname"] = Uri.EscapeDataString(item.FileName);
                if (ReceiptInboxPolicy.ValidateUpload(item.FileName, download.Value.Content.LongLength) is { } error)
                {
                    var failed = ReceiptInboxPolicy.WithAnalysis(metadata, null, error);
                    await _blobs.SetInboxMetadataAsync(item.Name, failed);
                    analysed.Add(ReceiptInboxPolicy.Read(item.Name, item.Size, item.UploadedAt, failed));
                    continue;
                }
                analysed.Add(await Analyse(item.Name, download.Value.Content, metadata, item.Size, item.UploadedAt));
            }
            return await Json(req, HttpStatusCode.OK, new { analysed, remaining = Math.Max(0, pending.Count - AnalyseBatch) });
        }

        [Function("DismissReceiptInbox")]
        public async Task<HttpResponseData> Dismiss(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "receipts/inbox/dismiss")] HttpRequestData req)
        {
            var blocked = await Guard(req);
            if (blocked != null) return blocked;
            string? name;
            try
            {
                using var document = JsonDocument.Parse(await req.ReadAsStringAsync() ?? "");
                name = document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("name", out var value)
                    && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            }
            catch (JsonException) { name = null; }
            if (!ReceiptInboxPolicy.ValidBlobName(name)) return await Json(req, HttpStatusCode.BadRequest, new { error = "A receipt name is required" });
            var metadata = await _blobs!.GetInboxMetadataAsync(name!);
            if (metadata == null) return await Json(req, HttpStatusCode.NotFound, new { error = "Receipt not found" });
            if (!ReceiptInboxPolicy.IsOpen(ReceiptInboxPolicy.Read(name!, 0, null, metadata)))
                return await Json(req, HttpStatusCode.Conflict, new { error = "Receipt is already matched or dismissed" });
            await _blobs.SetInboxMetadataAsync(name!, ReceiptInboxPolicy.WithStatus(metadata, "dismissed"));
            return await Json(req, HttpStatusCode.OK, new { name, status = "dismissed" });
        }
    }
}
