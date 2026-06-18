# Hosting and Database Sizing

## Recommended starting point

| Environment | Frontend | Backend | SQL |
|---|---|---|---|
| Dev | Azure Static Web Apps Free | Azure Functions Flex Consumption | Azure SQL Database General Purpose serverless |
| Prod | Azure Static Web Apps Standard | Azure Functions Flex Consumption | Azure SQL Database General Purpose serverless |

## Why this is the baseline

- Lowest-cost safe setup for a new v2 build.
- Keeps the app serverless where possible.
- Lets compute scale up only when real usage appears.

## SQL guidance

- Start with serverless.
- Use auto-pause where production behavior allows it.
- Move to provisioned compute only if the workload becomes consistently busy.

## Scale-up triggers

- Frontend: need for SSR, private networking, or app-server features.
- Backend: cold starts hurt latency, or traffic becomes consistently high.
- SQL: sustained CPU pressure, frequent blocking, timeouts, or regular autogrowth.
