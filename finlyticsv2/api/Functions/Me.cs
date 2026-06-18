using System.Net;
using System.Text.Json;
using FinlyticsV2.Api.Helpers;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace FinlyticsV2.Api.Functions;

public sealed class Me
{
    private readonly ILogger<Me> _logger;

    public Me(ILogger<Me> logger)
    {
        _logger = logger;
    }

    [Function("Me")]
    public async Task<HttpResponseData> RunAsync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me")] HttpRequestData request)
    {
        var token = AuthHelper.GetAccessToken(request);
        if (string.IsNullOrWhiteSpace(token))
        {
            var unauthorized = request.CreateResponse(HttpStatusCode.Unauthorized);
            await unauthorized.WriteStringAsync(JsonSerializer.Serialize(new { error = "Authorization header missing" }));
            return unauthorized;
        }

        var claims = AuthHelper.ExtractJwtClaims(token);
        var immutableUserId = AuthHelper.ResolveImmutableUserId(claims);
        var preferredLogin = AuthHelper.ResolvePreferredLogin(claims);

        _logger.LogInformation("Resolved user claims for immutable user id {ImmutableUserId}", immutableUserId ?? "unknown");

        var ok = request.CreateResponse(HttpStatusCode.OK);
        ok.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await ok.WriteStringAsync(JsonSerializer.Serialize(new
        {
            authenticated = true,
            user = new
            {
                immutableUserId,
                objectId = claims["oid"],
                tenantId = claims["tid"],
                username = preferredLogin,
                email = claims["email"] ?? claims["preferred_username"],
                displayName = claims["name"],
                aliases = new
                {
                    preferredUsername = claims["preferred_username"],
                    upn = claims["upn"],
                    email = claims["email"],
                    uniqueName = claims["unique_name"],
                }
            }
        }));

        return ok;
    }
}
