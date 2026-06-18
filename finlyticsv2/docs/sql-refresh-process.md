# Dev Database Refresh Process

## Purpose

Refresh the development database from production safely and repeatably.

## Process

1. Confirm the target is the dev database in `rg-finlytics-dev`.
2. Take a backup or export of the production database.
3. Restore or copy that snapshot into the dev database.
4. Apply any masking, cleanup, or reset scripts.
5. Verify the dev app can connect and run smoke tests.

## Safety checks

- Confirm the subscription before running any Azure SQL command.
- Confirm the resource group before any restore or delete.
- Never point the dev app at the production database.

## Refresh options

- Same server or same subscription: use a direct database copy where appropriate.
- Cross-server or cross-subscription: use export/import or a restore-based approach.

## Post-refresh steps

- Rebuild caches if needed.
- Re-seed dev-only data.
- Reset any test accounts, auth settings, or email integrations.
