# Finlytics v2 Deployment Flow

## Source of truth

All v2 deployment design lives under `finlyticsv2/`.

## Workflow shape

### Pull request validation

- Restore dependencies.
- Build the app.
- Run unit or smoke tests.
- Validate infrastructure templates.

### Dev deployment

- Trigger on merge to the main integration branch.
- Deploy infrastructure to `rg-finlytics-dev` first.
- Deploy the application to the dev environment.
- Run smoke tests against `dev.finlytics.co.uk`.

### Production deployment

- Promote the same approved revision.
- Deploy infrastructure changes if needed.
- Deploy the application to the production environment.
- Run post-deploy smoke checks against `app.finlytics.co.uk`.

## Promotion rule

- Dev must pass before production promotion.
- Production deploys should be gated by GitHub environment approval.

## Repo boundary note

- GitHub Actions workflow files must exist at the repository root in `.github/workflows` to execute.
- The canonical deployment design and supporting notes stay in this folder.
