# Finlytics v2 Architecture

## Scope

This document defines the v2-only shape of the platform.

## Deployment boundaries

- Application code lives in `finlyticsv2/app`.
- Infrastructure definitions live in `finlyticsv2/infra`.
- Migration and rollout notes live in `finlyticsv2/docs`.
- Operational scripts live in `finlyticsv2/scripts`.

## Environment model

### Development

- Resource group: `rg-finlytics-dev`
- Domain: `dev.finlytics.co.uk`
- Database: separate dev database, refreshed from prod when needed

### Production

- Resource group: `rg-finlytics-prod`
- Domain: `app.finlytics.co.uk`
- Database: separate live production database

## Design constraints

- Do not share the production database with development.
- Keep the v1 FinanceHub deployment online during v2 buildout.
- Keep the v2 footprint lean until actual usage justifies scaling.

## Network Security

Finlytics v2 uses a hardened network architecture with:

- **VNet Isolation**: Dedicated virtual network (10.0.0.0/16) with service-specific subnets
- **Private Endpoints**: SQL, Storage, Key Vault connected via private IPs (no public exposure)
- **Service Endpoints**: Function App uses service endpoints for reduced latency within Azure
- **Managed Identity**: All service-to-service authentication via Azure AD managed identity
- **Network ACLs**: Restrictive default-deny policies on Storage and Key Vault

See [security-hardening.md](security-hardening.md) for detailed network topology, DNS resolution, and troubleshooting.
