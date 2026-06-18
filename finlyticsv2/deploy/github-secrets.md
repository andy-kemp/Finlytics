# GitHub Secrets for Finlytics v2

Configure these repository or environment secrets before running deploy workflows.

## Required for both environments

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Use environment-specific values in GitHub Environments:

- `development` environment should point at the dev subscription context.
- `production` environment should point at the production subscription context.

## SQL password secrets

- `FINLYTICSV2_SQL_ADMIN_PASSWORD_DEV`
- `FINLYTICSV2_SQL_ADMIN_PASSWORD_PROD`

These are passed into Bicep as secure parameters.

## Workflow files

- `.github/workflows/finlyticsv2-validate.yml`
- `.github/workflows/finlyticsv2-deploy-dev.yml`
- `.github/workflows/finlyticsv2-deploy-prod.yml`

## First deployment order

1. Run validation workflow.
2. Run dev deploy workflow.
3. Verify API health endpoint and UI.
4. Run prod deploy workflow only after dev verification.
