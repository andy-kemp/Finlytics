# GBP Settlement Browser Authorization

`PATCH /api/expenses/{id}/gbp-settlement` uses an Anonymous HTTP trigger so browser bearer tokens reach the application guard. Anonymous is not anonymous access: `SettlementAuthService.ValidateRequest` must succeed before JSON parsing or any database lookup. Function keys (including `code` and `x-functions-key`) never authorize this endpoint.

## Environment Contract

| Setting | Value |
| --- | --- |
| `SettlementTenantId` | Required tenant GUID. For the existing browser tenant: `11016236-4dbc-43a6-8310-be803173fc43`. |
| `SettlementAudience` | Required dedicated settlement API application (client) ID GUID, matching the `aud` of its v2 access tokens. Not a scope URI, Microsoft Graph audience, or the existing browser application ID. |
| `SettlementAllowedObjectIds` | Required comma-separated tenant user object ID GUIDs (`oid`) for explicitly authorized company owners. Whitespace around IDs is accepted; empty or malformed entries invalidate the configuration. These are user object IDs, not application IDs or email addresses. |
| `SettlementRequiredScope` | Optional bare delegated scope name, default `Settlement.Write` when absent. Explicitly empty or whitespace-containing values are invalid. |

Missing or invalid required settings produce **503**, without metadata retrieval. Configuration is captured by the singleton; restart the worker after changing it. No credentials or owner IDs have been inferred or added to settings files.

Authorization is deliberately for the current single-company deployment. An allow-listed user can settle expenses in that company's database. This is not a tenant-to-company mapping or multi-company authorization model.

## Token Contract

The browser must send `Authorization: Bearer <access_token>`. Obtain the access token using the existing browser application ID `c5c042d4-48e3-4e28-ba5f-b9b01e82aa41` in the configured tenant, requesting the settlement API's exposed delegated scope:

```text
<settlement-api-application-ID-URI>/Settlement.Write
```

For an API using the default application ID URI, the scope is `api://<SettlementAudience>/Settlement.Write`. If `SettlementRequiredScope` is changed, replace the final scope name accordingly. The token's `scp` must contain that bare name as an exact, case-sensitive, space-delimited scope.

The guard accepts only signed **RS256**, unexpired v2 JWTs, with exactly one API audience, the pinned issuer `https://login.microsoftonline.com/<SettlementTenantId>/v2.0`, matching `tid`, `ver=2.0`, the required delegated `scp`, and an allow-listed `oid`. Lifetime validation has zero clock skew. Signing keys come from HTTPS tenant-specific OpenID metadata, managed and cached by IdentityModel. Unknown keys request metadata refresh and reject the current request.

Microsoft Graph access tokens, ID tokens, application-role-only tokens, and Function keys do not satisfy this contract. Existing Graph scopes or login success do not grant settlement access.

| Status | Meaning |
| --- | --- |
| 401 | Missing/malformed bearer header or invalid signature, issuer, audience, tenant, version, or lifetime. |
| 403 | Valid token without the required delegated scope or authorized owner object ID. |
| 503 | Missing/invalid settings or identity metadata unavailable/unusable. |

Errors retain their explicit HTTP status and have a JSON `error` property. No fallback to unauthenticated or key-based access is provided.

## Required Administrator Setup

Configured on 8 October 2026 in Andy Kemp Consulting Ltd:

- API application ID: `e11e81e7-3bdb-4ff3-b4c9-9113b600fb25`, single tenant, v2 access tokens.
- Delegated scope: `api://e11e81e7-3bdb-4ff3-b4c9-9113b600fb25/Settlement.Write`.
- Existing SPA preauthorized and granted only this API scope; existing Graph permissions retained.
- Owner object ID verified with `az ad signed-in-user show`: `f647124a-7747-4a80-aa75-bcc107c83cc8`.
- Four `Settlement*` validation settings saved on `financehub-func-kemponline`; no secret generated.
- Frontend build uses `VITE_SETTLEMENT_API_SCOPE` and a separate MSAL request/cache from Graph.

Code is not deployed yet. An authenticated production settlement request still needs
post-deployment verification with the owner's API access token. No financial records
were changed while configuring identity. Missing permission/configuration fails closed.

No tenant network calls, Azure operations, deployment, database migrations, or credentials are needed for these offline checks:

```sh
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/SettlementAuth/SettlementAuth.Tests.csproj
node --test FunctionApp/Tests/multicurrency-contract.test.mjs
/tmp/finlytics-dotnet/dotnet run --project FunctionApp/Tests/Multicurrency/Multicurrency.Tests.csproj
/tmp/finlytics-dotnet/dotnet build FunctionApp/FinanceHubFunctions.csproj
```

The auth harness uses synthetic tenant configuration, local RSA keys, and a fixed metadata provider. Its request body throws if authentication tries to read JSON. Do not start the actual Function host for these checks: existing startup code applies database migrations.