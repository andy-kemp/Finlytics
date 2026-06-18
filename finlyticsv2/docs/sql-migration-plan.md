# SQL Migration Plan

## Goal

Move Finlytics v2 onto its own database while keeping FinanceHub v1 unchanged.

## Core rule

- Never share one live database between v1 and v2.
- Production and development each get their own database.

## Recommended migration path

### Phase 1: Prepare the target schema

- Create the v2 production database.
- Apply the baseline schema into that database.
- Add indexes, constraints, and seed data after the core tables exist.

### Phase 2: Load initial data

- Migrate only the data needed for v2 launch.
- Avoid carrying forward stale or v1-only records unless they are required.
- Validate row counts and key business entities after import.

### Phase 3: Validate against the app

- Connect the v2 app to the v2 database.
- Run smoke tests on the key workflows.
- Check that reads, writes, and reporting behave as expected.

### Phase 4: Cut over

- Keep v1 live until v2 is verified.
- Switch the v2 production app to the v2 production database only after approval.
- Retain a rollback window before removing anything old.

## Rollback stance

- If a deploy fails, revert the app version first.
- Do not delete backups until the cutover window has closed.
