#nullable enable
using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FinanceHubFunctions.Data;
using FinanceHubFunctions.Helpers;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace FinanceHubFunctions.Services
{
    public sealed class ApiAuthorizationMiddleware : IFunctionsWorkerMiddleware
    {
        public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
        {
            if (!context.FunctionDefinition.InputBindings.Values.Any(binding => binding.Type == "httpTrigger"))
            {
                await next(context);
                return;
            }
            var access = ApiAccessPolicy.For(context.FunctionDefinition.Name);
            if (access is ApiAccess.Public or ApiAccess.SelfAuthenticated)
            {
                await next(context);
                return;
            }

            var request = await context.GetHttpRequestDataAsync();
            if (request == null)
            {
                await next(context);
                return;
            }
            var owner = await context.InstanceServices.GetRequiredService<SettlementAuthService>().ValidateRequest(request);
            if (owner.IsAuthorized || (access == ApiAccess.OwnerOrTeamMember && await IsActiveTeamMember(context, request)))
            {
                await next(context);
                return;
            }

            context.GetLogger<ApiAuthorizationMiddleware>().LogWarning("Rejected {Function}: {Status}",
                context.FunctionDefinition.Name, (int)owner.StatusCode);
            var status = owner.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.ServiceUnavailable
                ? owner.StatusCode : HttpStatusCode.Unauthorized;
            var response = request.CreateResponse(status);
            await response.WriteAsJsonAsync(new { error = owner.Error ?? "Sign in to Finlytics to use this API" }, status);
            context.GetInvocationResult().Value = response;
        }

        private static async Task<bool> IsActiveTeamMember(FunctionContext context, HttpRequestData request)
        {
            var clerk = await context.InstanceServices.GetRequiredService<ClerkAuthService>().ValidateRequestAsync(request);
            if (clerk == null || string.IsNullOrEmpty(clerk.UserId)) return false;
            var members = context.InstanceServices.GetService<ITeamMemberRepository>();
            var member = members == null ? null : await members.GetByClerkUserIdAsync(clerk.UserId);
            return member?.Status == "Active";
        }
    }
}
