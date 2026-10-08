using System;
using System.Data;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FinanceHubFunctions.Helpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using FinanceHubFunctions.Models;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Services;

namespace FinanceHubFunctions.Functions
{
    public class VatReturnFunctions
    {
        private readonly ILogger<VatReturnFunctions> _logger;
        private readonly IVatReturnRepository _vatReturnRepository;
        private readonly DeletionGuardService _guard;
        private readonly BlobStorageService? _blobStorage;
        private readonly FinanceHubDbContext _db;

        public VatReturnFunctions(
            ILogger<VatReturnFunctions> logger,
            IVatReturnRepository vatReturnRepository,
            DeletionGuardService guard,
            FinanceHubDbContext db,
            BlobStorageService? blobStorage = null)
        {
            _logger = logger;
            _vatReturnRepository = vatReturnRepository;
            _guard = guard;
            _db = db;
            _blobStorage = blobStorage;
        }

        [Function("GetVatReturns")]
        public async Task<HttpResponseData> GetVatReturns(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "vat-returns")] HttpRequestData req)
        {
            _logger.LogInformation("Getting all VAT returns");
            try
            {
                var returns = await _vatReturnRepository.GetAllAsync();
                var settlements = await _db.CompanyLedger.AsNoTracking()
                    .Where(entry => entry.Notes != null && entry.Notes.Contains("[VAT-RETURN:"))
                    .Select(entry => new CompanyLedgerEntry
                    {
                        Id = entry.Id,
                        EntryType = entry.EntryType,
                        Amount = entry.Amount,
                        EffectiveDate = entry.EffectiveDate,
                        Notes = entry.Notes
                    })
                    .ToListAsync();
                var byReturn = settlements.ToLookup(entry => VatSettlementPolicy.LinkedReturnId(entry.Notes));
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(returns.Select(record =>
                    VatSettlementPolicy.Project(record, byReturn[record.Id].SingleOrDefault())), HttpStatusCode.OK);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting VAT returns");
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteStringAsync($"Error: {ex.Message}");
                return error;
            }
        }

        [Function("CreateVatReturn")]
        public async Task<HttpResponseData> CreateVatReturn(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "vat-returns")] HttpRequestData req)
        {
            _logger.LogInformation("Creating VAT return");
            try
            {
                var vatReturn = await req.ReadFromJsonAsync<VatReturn>();
                if (vatReturn == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Invalid VAT return data");
                    return bad;
                }

                vatReturn.Status = "Filed";
                vatReturn.CreatedDate = DateTime.UtcNow;
                vatReturn.ModifiedDate = DateTime.UtcNow;

                var created = await _vatReturnRepository.CreateAsync(vatReturn);
                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(created);
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating VAT return");
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteStringAsync($"Error: {ex.Message}");
                return error;
            }
        }

        [Function("UpdateVatReturn")]
        public async Task<HttpResponseData> UpdateVatReturn(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "vat-returns/{id}")] HttpRequestData req,
            int id)
        {
            _logger.LogInformation("Updating VAT return {Id}", id);
            try
            {
                var body = await req.ReadAsStringAsync();
                if (!ForeignCurrencyHelper.TryRead<VatReturn>(body, out var updated, out var parseError))
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { error = parseError }, HttpStatusCode.BadRequest);
                    return bad;
                }

                return await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    _db.ChangeTracker.Clear();
                    await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                    var existing = await _db.VatReturns.SingleOrDefaultAsync(record => record.Id == id);
                    if (existing == null) return req.CreateResponse(HttpStatusCode.NotFound);
                    ForeignCurrencyHelper.PreserveOmitted(updated!, existing, body!);
                    var marker = VatSettlementPolicy.Marker(id);
                    if (VatSettlementPolicy.ChangesFiledFigures(existing, updated!)
                        && await _db.CompanyLedger.AnyAsync(entry => entry.Notes != null && entry.Notes.Contains(marker)))
                    {
                        var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                        await conflict.WriteAsJsonAsync(new { error = "Settled VAT return dates and filed VAT figures cannot be changed" }, HttpStatusCode.Conflict);
                        return conflict;
                    }
                    existing.QuarterLabel = updated.QuarterLabel;
                    existing.MonthsLabel = updated.MonthsLabel;
                    existing.QuarterStartDate = updated.QuarterStartDate;
                    existing.QuarterEndDate = updated.QuarterEndDate;
                    existing.VatIn = updated.VatIn;
                    existing.VatOut = updated.VatOut;
                    existing.VatOwed = updated.VatOwed;
                    existing.FiledDate = updated.FiledDate;
                    existing.Reference = updated.Reference;
                    existing.Notes = updated.Notes;
                    if (!string.IsNullOrEmpty(updated.ConfirmationPdfUrl))
                        existing.ConfirmationPdfUrl = updated.ConfirmationPdfUrl;
                    existing.ModifiedDate = DateTime.UtcNow;

                    await _db.SaveChangesAsync();
                    await transaction.CommitAsync();
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    await response.WriteAsJsonAsync(existing, HttpStatusCode.OK);
                    return response;
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating VAT return {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteStringAsync($"Error: {ex.Message}");
                return error;
            }
        }

        [Function("DeleteVatReturn")]
        public async Task<HttpResponseData> DeleteVatReturn(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "vat-returns/{id}")] HttpRequestData req,
            int id)
        {
            _logger.LogInformation("Deleting VAT return {Id}", id);
            try
            {
                var blocked = await _guard.GuardAsync(req, "VAT return");
                if (blocked != null) return blocked;

                return await _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    _db.ChangeTracker.Clear();
                    await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                    var existing = await _db.VatReturns.SingleOrDefaultAsync(record => record.Id == id);
                    if (existing == null)
                    {
                        return req.CreateResponse(HttpStatusCode.NotFound);
                    }

                    var marker = VatSettlementPolicy.Marker(id);
                    if (await _db.CompanyLedger.AnyAsync(entry => entry.Notes != null && entry.Notes.Contains(marker)))
                    {
                        var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                        await conflict.WriteAsJsonAsync(new { error = "A settled VAT return cannot be deleted" }, HttpStatusCode.Conflict);
                        return conflict;
                    }
                    _db.VatReturns.Remove(existing);
                    await _db.SaveChangesAsync();
                    await transaction.CommitAsync();
                    return req.CreateResponse(HttpStatusCode.NoContent);
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting VAT return {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteStringAsync($"Error: {ex.Message}");
                return error;
            }
        }

        [Function("UploadVatConfirmation")]
        public async Task<HttpResponseData> UploadVatConfirmation(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "vat-returns/{id}/confirmation-pdf")] HttpRequestData req,
            int id)
        {
            _logger.LogInformation("Uploading confirmation PDF for VAT return {Id}", id);
            try
            {
                if (_blobStorage == null)
                {
                    var cfg = req.CreateResponse(HttpStatusCode.ServiceUnavailable);
                    await cfg.WriteStringAsync("Blob storage is not configured");
                    return cfg;
                }

                var existing = await _vatReturnRepository.GetByIdAsync(id);
                if (existing == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                // Read raw binary body
                using var ms = new System.IO.MemoryStream();
                await req.Body.CopyToAsync(ms);
                var fileBytes = ms.ToArray();

                if (fileBytes.Length == 0)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("No file content received");
                    return bad;
                }

                // Filename sent via custom header
                string fileName = "confirmation.pdf";
                if (req.Headers.TryGetValues("X-File-Name", out var fnValues))
                    fileName = System.Net.WebUtility.HtmlDecode(string.Join("", fnValues));

                var blobUrl = await _blobStorage.UploadVatConfirmationAsync(id, existing.QuarterLabel, fileBytes, fileName);

                existing.ConfirmationPdfUrl = blobUrl;
                existing.ModifiedDate = DateTime.UtcNow;
                var result = await _vatReturnRepository.UpdateAsync(existing);

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { confirmationPdfUrl = blobUrl, vatReturn = result });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error uploading confirmation PDF for VAT return {Id}", id);
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteStringAsync($"Error: {ex.Message}");
                return error;
            }
        }
    }
}
