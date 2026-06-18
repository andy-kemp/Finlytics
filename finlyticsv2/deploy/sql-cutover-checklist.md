# SQL Cutover Checklist

## Before cutover

- Production database exists and is healthy.
- App config points to the v2 production database.
- Dev refresh path is tested.
- Backup is available.

## During cutover

- Freeze schema changes.
- Apply the final migration if required.
- Switch the app connection string to the production database.
- Run smoke tests.

## After cutover

- Monitor errors and latency.
- Keep rollback data available for the agreed window.
- Archive the cutover notes.
