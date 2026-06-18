# Finlytics v2 Security Hardening

## Overview

The Finlytics v2 infrastructure has been hardened with defense-in-depth networking controls, private endpoints, and restricted public access. This document outlines the security architecture, implementation details, and configuration options.

## Architecture Changes

### Virtual Network (VNet)

A dedicated VNet has been added to enable private networking and isolation:

```
VNet: finlyticsXXXXvnet (10.0.0.0/16)
├── func-subnet (10.0.1.0/24)
│   └── Service Endpoints: SQL, Storage, Key Vault
│   └── Delegations: Microsoft.Web/serverFarms
│
└── pe-subnet (10.0.2.0/24)
    └── Private Endpoints: SQL, Storage, Key Vault
```

#### Subnet Roles

- **func-subnet**: Hosts the Function App with VNet integration
  - Service endpoints enabled for Azure services (reduced latency, no public egress)
  - Delegated to `Microsoft.Web/serverFarms` for proper management
  
- **pe-subnet**: Dedicated to private endpoints
  - Private endpoint network policies disabled (required for PE creation)
  - No direct Function App resources here

### Private Endpoints (Conditional)

Private endpoints are enabled by default (`enablePrivateEndpoints = true` in bicepparam files) and provide:

1. **SQL Server Private Endpoint** → `privatelink.database.windows.net`
   - Function App connects to SQL via private IP (10.0.2.x/24)
   - Public access disabled on SQL Server when PEs enabled
   - Firewall rule removed (not needed with private endpoints)

2. **Storage Account Private Endpoint** → `privatelink.blob.core.windows.net`
   - Function App authenticates via managed identity (no shared keys)
   - Public network access disabled when PEs enabled
   - Network ACL: Deny by default, allow from func-subnet and AzureServices

3. **Key Vault Private Endpoint** → `privatelink.vaultcore.azure.net`
   - Function App retrieves secrets via private IP
   - Public access disabled when PEs enabled
   - RBAC-based access (Key Vault Secrets User role)

### Private DNS Zones

Automatic DNS resolution within VNet for private endpoints:

```
Storage:   privatelink.blob.core.windows.net  → 10.0.2.x
SQL:       privatelink.database.windows.net   → 10.0.2.x
KeyVault:  privatelink.vaultcore.azure.net    → 10.0.2.x
```

DNS zone virtual network links ensure Function App can resolve private endpoint IPs transparently.

## Network Security Model

### Data Flow

```
Static Web App (Public)
        ↓
    Gateway
        ↓
Function App (VNet-integrated, private backend connections)
        ├── [SQL via PE]      → SQL Server (private IP only)
        ├── [Storage via PE]  → Storage Account (private IP only)
        └── [KeyVault via PE] → Key Vault (private IP only)
```

### Public vs. Private Access

| Resource | Public Access | Private Access | Notes |
|----------|---------------|----------------|-------|
| Static Web App | Enabled | N/A | Frontend must be public |
| Function App | Disabled | Via VNet integration | Configured with HTTPSOnly |
| SQL Server | Disabled (PE) | Via PE in pe-subnet | No firewall rules needed |
| Storage Account | Disabled (PE) | Via PE + managed identity | Network ACL denies by default |
| Key Vault | Disabled (PE) | Via PE + RBAC | No shared access keys |

## Authentication & Authorization

### Managed Identity

- **Function App System-Assigned Identity**: Used for all backend service authentication
  - No secrets stored in app configuration
  - Automatic credential rotation by Azure platform

### RBAC Roles Assigned

```bicep
Function App → Storage Account: Storage Blob Data Contributor
Function App → Key Vault: Key Vault Secrets User
```

### Storage Account Security

- **Access**: Managed identity only (no shared keys)
- **Encryption**: Microsoft-managed keys by default (upgradeable to customer-managed)
- **Network**: Private endpoints + VNET service endpoints
- **Public Blob Access**: Disabled

### Key Vault Configuration

- **Access Model**: RBAC-only (not legacy vault access policies)
- **Soft Delete**: Enabled (30-day retention for deleted secrets)
- **Purge Protection**: Enabled (prevents permanent deletion within retention)
- **Network**: Private endpoints + firewall rules

## Deployment Configuration

### Dev Environment

```bicepparam
param enablePrivateEndpoints = true
param sqlAutoPauseDelay = 60        # Auto-pause after 60 min
param sqlMinCapacity = 1             # Starts at 1 vCore
param staticWebAppSku = 'Free'
```

**Cost Optimization**: Dev can disable private endpoints temporarily for faster iteration:
```bicepparam
param enablePrivateEndpoints = false
```
This removes VNet overhead but reduces isolation. **Not recommended for shared environments**.

### Prod Environment

```bicepparam
param enablePrivateEndpoints = true
param sqlAutoPauseDelay = -1         # No auto-pause
param sqlMinCapacity = 1
param staticWebAppSku = 'Standard'
```

Private endpoints are always enabled in production.

## Monitoring & Diagnostics

### Network Monitoring

- **NSG Flow Logs**: Optional (add to production hardening phase)
- **VNet Diagnostics**: Azure Firewall integration available
- **Private Endpoint Metrics**: CPU, memory, connection count

### Application Insights Integration

All Function App requests flow through Application Insights:
- HTTP request tracing
- Dependency tracking (SQL, Storage, Key Vault calls)
- Exception and failure analysis

Log Analytics workspace retains 30 days of logs by default.

## Troubleshooting

### Private Endpoint DNS Resolution Issues

**Symptom**: Function App cannot resolve service endpoints

**Diagnosis**:
```powershell
# From Function App, test DNS resolution
nslookup finlyticsdevdb.database.windows.net
# Should resolve to 10.0.2.x (private IP)
```

**Resolution**:
- Verify private DNS zone link to VNet
- Check Function App has network integration enabled
- Confirm subnet has private endpoint policies disabled

### Storage Access Denied

**Symptom**: `AzureWebJobsStorage` connection failures

**Diagnosis**:
```powershell
# Verify managed identity role assignment
az role assignment list --assignee <function-app-principal-id> \
  --scope <storage-account-id>
```

**Resolution**:
- Re-run Bicep template (role assignments must be idempotent)
- Check storage account network ACL allows pe-subnet
- Verify app settings use managed identity (`__credential: managedidentity`)

### SQL Connection Timeout

**Symptom**: SQL connection timeouts despite firewall rules

**Diagnosis**:
- Verify Function App is in func-subnet (has SQL service endpoint)
- Confirm SQL private endpoint exists and is active
- Check private DNS zone resolves SQL FQDN to 10.0.2.x

**Resolution**:
- Add SQL server firewall rule for func-subnet service endpoint (temporary)
- Verify `SqlServerName` and connection string app settings are correct

## Migration Path: Baseline → Hardened

### Phase 1: Deploy Baseline (No Hardening)
```bicepparam
param enablePrivateEndpoints = false
```
This replicates the original main-baseline.bicep behavior.

### Phase 2: Enable Private Endpoints
```bicepparam
param enablePrivateEndpoints = true
```
VNet is created, but resources remain accessible via both public and private paths during transition.

### Phase 3: Restrict Public Access (Manual)
After confirming private connectivity works:
- SQL: Remove public firewall rules
- Storage: Disable public network access
- Key Vault: Disable public access

This is currently **automatic** when `enablePrivateEndpoints = true`.

## Cost Implications

### Private Endpoint Costs (Hourly + Data Processing)

- **Private Endpoints**: ~$0.007/endpoint/hour (3 × $0.21/day = **$6.30/month**)
- **Private DNS Zones**: ~$0.50/month each (3 zones = **$1.50/month**)
- **Total PE Overhead**: ~**$7.80/month**

### Savings from Tighter Security

- **No public exposure**: Reduced DDoS surface area
- **Reduced egress costs**: Private endpoints avoid public egress charges
- **Compliance alignment**: Meets PII/SOX/ISO requirements for network isolation

**Net Impact**: +$8/month for 3-tier production-grade security.

## Security Recommendations

### Immediate (Included in v2 Hardened)
- ✅ VNet isolation with service endpoints
- ✅ Private endpoints for SQL, Storage, Key Vault
- ✅ Managed identity authentication (no shared keys)
- ✅ RBAC-based access control
- ✅ Purge protection on Key Vault

### Phase 2 (Optional Add-ons)
- [ ] Azure Firewall with UDR for advanced DDoS/threat protection
- [ ] NSG rules to restrict VNet traffic patterns
- [ ] Service Principal for additional app-to-service authentication
- [ ] Log Analytics alert rules for suspicious activity

### Phase 3 (Compliance Hardening)
- [ ] Customer-managed encryption keys (SQL, Storage)
- [ ] Regulatory compliance scanning (CIS, SOC 2)
- [ ] Network threat detection (Azure Sentinel)
- [ ] Audit logging to immutable storage

## References

- [Azure Private Endpoints](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview)
- [Azure Functions VNet Integration](https://learn.microsoft.com/en-us/azure/azure-functions/functions-networking-options)
- [SQL Database Private Link](https://learn.microsoft.com/en-us/azure/azure-sql/database/private-endpoint-overview)
- [Managed Identities for Azure Resources](https://learn.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/overview)

## Summary

The Finlytics v2 hardened infrastructure provides defense-in-depth network security with:

- **Isolation**: VNet + private subnets for internal traffic only
- **Encryption**: TLS 1.2+ for all connections (public paths removed when PEs enabled)
- **Authentication**: Managed identity + RBAC (no shared credentials)
- **Compliance**: SOC 2 / ISO 27001 aligned controls
- **Cost**: +$8/month for enterprise-grade security

The implementation is **production-ready** and can be deployed immediately via GitHub Actions workflows.
