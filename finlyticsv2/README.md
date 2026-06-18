# Finlytics v2

Finlytics v2 is the new isolated build of the FinanceHub platform.

## Principles

- Keep FinanceHub v1 untouched.
- Keep all v2 app, infra, docs, and rollout material under this folder.
- Use separate dev and prod resources.
- Prefer low-cost defaults first, then scale based on real usage.

## Proposed folder layout

```text
finlyticsv2/
  api/
  app/
  deploy/
  docs/
  infra/
  scripts/
```

## Notes

- GitHub Actions workflow files must still live in `.github/workflows` at the repository root to run in GitHub.
- All v2 workflow notes, deployment logic, and supporting assets should still reference this folder only.

## Current scaffold

- `app/` contains the v2 frontend starter.
- `api/` contains the Azure Functions starter.
- `infra/bicep/` contains the infrastructure naming and parameter skeleton.

## Current target

- Prod subscription: M365
- Prod resource group: `rg-finlytics-prod`
- Dev resource group: `rg-finlytics-dev`
- Primary domains: `app.finlytics.co.uk` and `dev.finlytics.co.uk`
