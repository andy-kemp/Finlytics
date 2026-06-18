# Release Process

## Flow

1. Commit changes under `finlyticsv2/`.
2. Merge to the deployment branch.
3. Build and deploy dev.
4. Validate dev.
5. Promote the same revision to prod.

## Branch intent

- Use one branch for shared development work.
- Use GitHub environments or approvals for production promotion.
