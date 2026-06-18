# Environment Matrix

| Environment | Resource Group | Domain | Database |
|---|---|---|---|
| Dev | `rg-finlytics-dev` | `dev.finlytics.co.uk` | Separate dev copy |
| Prod | `rg-finlytics-prod` | `app.finlytics.co.uk` | Separate live DB |

## Hosting stance

- Start with the smallest safe hosting tier.
- Avoid always-on overprovisioning.
- Right-size after usage is visible.
