using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace FinlyticsV2.Api.Functions;

public sealed class Health
{
    private readonly ILogger<Health> _logger;

    public Health(ILogger<Health> logger)
    {
        _logger = logger;
    }

    [Function("Health")]
    public async Task<HttpResponseData> RunAsync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequestData request)
    {
        _logger.LogInformation("Health check requested at {UtcNow}", DateTimeOffset.UtcNow);

        var response = request.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");

        var payload = new
        {
            status = "ok",
            service = "finlyticsv2-api",
            timestampUtc = DateTimeOffset.UtcNow
        };

        await response.WriteStringAsync(JsonSerializer.Serialize(payload));
        return response;
    }
}
