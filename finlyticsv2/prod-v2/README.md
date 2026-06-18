# Finlytics Production V2

This folder is the canonical home for the **new Finlytics production environment**.

It is intentionally separated from legacy production artifacts in the repository root (for example `deployment-config-prod.json`), which reference the old production setup.

## Purpose

- Keep new production (`finlytics` V2) metadata in one place.
- Avoid mixing old and new production deployment contexts.
- Make future automation and handover safer and clearer.

## Current Scope

- `resources.json`: resource inventory for the new production environment.

## Notes

- Legacy production config files remain unchanged for traceability and rollback history.
- New production operational changes should be recorded in this folder first.
