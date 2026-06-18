using System.Net;
using System.Text.Json;
using FinlyticsV2.Api.Helpers;
using FinlyticsV2.Api.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace FinlyticsV2.Api.Functions;

public sealed class MyContext
{
    private readonly ILogger<MyContext> _logger;
    private readonly UserContextService _userContextService;

    public MyContext(ILogger<MyContext> logger, UserContextService userContextService)
    {
        _logger = logger;
        _userContextService = userContextService;
    }

    [Function("GetMyContext")]
    public async Task<HttpResponseData> GetMyContextAsync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "my-context")] HttpRequestData request)
    {
        var token = AuthHelper.GetAccessToken(request);
        if (string.IsNullOrWhiteSpace(token))
        {
            var unauthorized = request.CreateResponse(HttpStatusCode.Unauthorized);
            await unauthorized.WriteAsJsonAsync(new { error = "Authorization header missing" });
            return unauthorized;
        }

        var claims = AuthHelper.ExtractJwtClaims(token);
        var immutableUserId = AuthHelper.ResolveImmutableUserId(claims);
        var tenantId = claims.GetValueOrDefault("tid");
        var aliases = new[]
        {
            claims.GetValueOrDefault("preferred_username"),
            claims.GetValueOrDefault("upn"),
            claims.GetValueOrDefault("email"),
            claims.GetValueOrDefault("unique_name"),
        }
        .Where(v => !string.IsNullOrWhiteSpace(v))
        .Select(v => v!.Trim().ToLowerInvariant())
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();

        var result = await _userContextService.ResolveAsync(immutableUserId, tenantId, aliases, request.FunctionContext.CancellationToken);
        if (!string.IsNullOrWhiteSpace(result.Error))
        {
            _logger.LogWarning("Could not resolve user context: {Reason}", result.Error);
            var bad = request.CreateResponse(HttpStatusCode.InternalServerError);
            await bad.WriteAsJsonAsync(new { error = result.Error });
            return bad;
        }

        var ok = request.CreateResponse(HttpStatusCode.OK);
        await ok.WriteAsJsonAsync(new
        {
            authenticated = true,
            user = new
            {
                immutableUserId,
                tenantId,
                aliases,
            },
            primaryCompanyId = result.PrimaryCompanyId,
            companies = result.Companies,
        });
        return ok;
    }

    [Function("LinkMyContext")]
    public async Task<HttpResponseData> LinkMyContextAsync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "my-context/link")] HttpRequestData request)
    {
        var token = AuthHelper.GetAccessToken(request);
        if (string.IsNullOrWhiteSpace(token))
        {
            var unauthorized = request.CreateResponse(HttpStatusCode.Unauthorized);
            await unauthorized.WriteAsJsonAsync(new { error = "Authorization header missing" });
            return unauthorized;
        }

        var claims = AuthHelper.ExtractJwtClaims(token);
        var immutableUserId = AuthHelper.ResolveImmutableUserId(claims);
        if (string.IsNullOrWhiteSpace(immutableUserId))
        {
            var badClaims = request.CreateResponse(HttpStatusCode.BadRequest);
            await badClaims.WriteAsJsonAsync(new { error = "Token does not contain an immutable user id claim (oid/sub)." });
            return badClaims;
        }

        LinkMyContextRequest? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync<LinkMyContextRequest>(request.Body, cancellationToken: request.FunctionContext.CancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Invalid my-context link payload");
            var badJson = request.CreateResponse(HttpStatusCode.BadRequest);
            await badJson.WriteAsJsonAsync(new { error = "Invalid JSON body." });
            return badJson;
        }

        if (body is null || body.CompanyId <= 0)
        {
            var bad = request.CreateResponse(HttpStatusCode.BadRequest);
            await bad.WriteAsJsonAsync(new { error = "companyId must be provided and greater than zero." });
            return bad;
        }

        var tenantId = claims.GetValueOrDefault("tid");
        var error = await _userContextService.UpsertImmutableMappingAsync(
            immutableUserId,
            tenantId,
            body.CompanyId,
            request.FunctionContext.CancellationToken);

        if (!string.IsNullOrWhiteSpace(error))
        {
            var fail = request.CreateResponse(HttpStatusCode.InternalServerError);
            await fail.WriteAsJsonAsync(new { error });
            return fail;
        }

        var ok = request.CreateResponse(HttpStatusCode.OK);
        await ok.WriteAsJsonAsync(new
        {
            success = true,
            immutableUserId,
            tenantId,
            companyId = body.CompanyId,
            message = "Immutable user-to-company mapping saved."
        });
        return ok;
    }

    private sealed class LinkMyContextRequest
    {
        public int CompanyId { get; set; }
    }
}
