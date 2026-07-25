using System;
using System.Net;
using System.Threading.Tasks;
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

        public VatReturnFunctions(
            ILogger<VatReturnFunctions> logger,
            IVatReturnRepository vatReturnRepository,
            DeletionGuardService guard,
            BlobStorageService? blobStorage = null)
        {
            _logger = logger;
            _vatReturnRepository = vatReturnRepository;
            _guard = guard;
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
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(returns);
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
                var existing = await _vatReturnRepository.GetByIdAsync(id);
                if (existing == null)
                {
                    return req.CreateResponse(HttpStatusCode.NotFound);
                }

                var updated = await req.ReadFromJsonAsync<VatReturn>();
                if (updated == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Invalid VAT return data");
                    return bad;
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

                var result = await _vatReturnRepository.UpdateAsync(existing);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
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

                var existing = await _vatReturnRepository.GetByIdAsync(id);
                if (existing == null)
                {
                    return req.CreateResponse(HttpStatusCode.NotFound);
                }

                await _vatReturnRepository.DeleteAsync(id);
                return req.CreateResponse(HttpStatusCode.NoContent);
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
