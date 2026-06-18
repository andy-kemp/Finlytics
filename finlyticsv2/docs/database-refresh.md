# Database Refresh Path

## Production

- Maintain one production database for v2.
- Treat it as the source of truth for live data.

## Development refresh

- Restore or clone production into a separate dev database.
- Apply any masking or cleanup required before developers use it.
- Never point dev workloads at the production database.

## Safety rule

- Back up before destructive changes.
- Validate the target database name and resource group before any restore or delete action.
