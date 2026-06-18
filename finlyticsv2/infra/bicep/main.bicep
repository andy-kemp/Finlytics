targetScope = 'resourceGroup'

@description('Deployment environment name, for example dev or prod.')
@minLength(3)
param environmentName string

@description('Azure region for the deployment.')
param location string = resourceGroup().location

@description('Common prefix used for resource naming.')
@minLength(3)
param namePrefix string = 'finlytics'

@description('Static Web App SKU name.')
@allowed([
  'Free'
  'Standard'
])
param staticWebAppSku string = 'Free'

@description('Function App service plan SKU.')
param functionPlanSku string = 'Y1'

@description('SQL admin login name.')
param sqlAdminLogin string = 'finlyticsadmin'

@secure()
@description('SQL admin password. Provide via pipeline secret.')
param sqlAdminPassword string

@description('Optional Entra object ID for SQL AAD admin.')
param sqlAadAdminObjectId string = ''

@description('Optional Entra UPN/display name for SQL AAD admin login.')
param sqlAadAdminLogin string = ''

@description('SQL database auto-pause delay in minutes. Use -1 to disable auto-pause.')
param sqlAutoPauseDelay int = 60

@description('Minimum vCore capacity for serverless SQL database.')
param sqlMinCapacity int = 1

@description('Enable private endpoints for SQL, Storage, and Key Vault.')
param enablePrivateEndpoints bool = true

@description('Create the SQL AllowAzureServices firewall rule when not using private endpoints.')
param createSqlAllowAzureServicesRule bool = false

@description('Azure region for Static Web App. Must be a supported SWA region.')
@allowed([
  'centralus'
  'eastus2'
  'westus2'
  'westeurope'
  'eastasia'
])
param staticWebAppLocation string = 'westeurope'

var normalizedPrefix = toLower(replace(namePrefix, '-', ''))
var environmentToken = toLower(environmentName)
var appNameBase = '${normalizedPrefix}${environmentToken}'

var staticWebAppName = take('${appNameBase}swa', 40)
var functionAppName = take('${appNameBase}func', 60)
var sqlServerName = take('${appNameBase}sql', 63)
var sqlDatabaseName = take('${appNameBase}db', 128)
var keyVaultName = take('${appNameBase}kv', 24)
var storageAccountName = 'st${take(uniqueString(resourceGroup().id, appNameBase), 22)}'
var appInsightsName = take('${appNameBase}appi', 255)
var logAnalyticsName = take('${appNameBase}log', 63)
var functionPlanName = take('${appNameBase}plan', 40)
var vnetName = take('${appNameBase}vnet', 64)
var funcSubnetName = 'func-subnet'
var pePESubnetName = 'pe-subnet'
var storageSuffix = environment().suffixes.storage
var hasSqlAadAdmin = !empty(sqlAadAdminObjectId) && !empty(sqlAadAdminLogin)

// VNet for private endpoints and Function App integration (only when enablePrivateEndpoints = true)
resource vnet 'Microsoft.Network/virtualNetworks@2023-06-01' = if (enablePrivateEndpoints) {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: funcSubnetName
        properties: {
          addressPrefix: '10.0.1.0/24'
          delegations: [
            {
              name: 'delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
          serviceEndpoints: [
            {
              service: 'Microsoft.Sql'
            }
            {
              service: 'Microsoft.Storage'
            }
            {
              service: 'Microsoft.KeyVault'
            }
          ]
        }
      }
      {
        name: pePESubnetName
        properties: {
          addressPrefix: '10.0.2.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
          privateLinkServiceNetworkPolicies: 'Enabled'
        }
      }
    ]
  }
}

resource funcSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-06-01' existing = if (enablePrivateEndpoints) {
  name: funcSubnetName
  parent: vnet
}

resource peSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-06-01' existing = if (enablePrivateEndpoints) {
  name: pePESubnetName
  parent: vnet
}

// Storage Account with restricted access
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: enablePrivateEndpoints ? 'Disabled' : 'Enabled'
    networkAcls: enablePrivateEndpoints ? {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      virtualNetworkRules: [
        {
          id: funcSubnet.id
          action: 'Allow'
        }
      ]
    } : {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: {
        blob: {
          enabled: true
        }
        file: {
          enabled: true
        }
      }
    }
  }
}

// Log Analytics
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// Key Vault with private endpoint support
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      name: 'standard'
      family: 'A'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    publicNetworkAccess: enablePrivateEndpoints ? 'Disabled' : 'Enabled'
    networkAcls: enablePrivateEndpoints ? {
      bypass: 'AzureServices'
      defaultAction: 'Deny'
      virtualNetworkRules: [
        {
          id: funcSubnet.id
        }
      ]
    } : {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

// Function App Plan
resource functionPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: functionPlanName
  location: location
  sku: {
    name: functionPlanSku
    tier: 'Dynamic'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

// Function App with VNet integration
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    keyVaultReferenceIdentity: 'SystemAssigned'
    virtualNetworkSubnetId: enablePrivateEndpoints ? funcSubnet.id : null
    siteConfig: {
      linuxFxVersion: 'DOTNET-ISOLATED|8.0'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'dotnet-isolated'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storage.name
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: enablePrivateEndpoints ? 'https://${storage.name}.blob.${storageSuffix}' : 'https://${storage.name}.blob.${storageSuffix}'
        }
        {
          name: 'AzureWebJobsStorage__queueServiceUri'
          value: enablePrivateEndpoints ? 'https://${storage.name}.queue.${storageSuffix}' : 'https://${storage.name}.queue.${storageSuffix}'
        }
        {
          name: 'AzureWebJobsStorage__tableServiceUri'
          value: enablePrivateEndpoints ? 'https://${storage.name}.table.${storageSuffix}' : 'https://${storage.name}.table.${storageSuffix}'
        }
        {
          name: 'KeyVaultUri'
          value: keyVault.properties.vaultUri
        }
        {
          name: 'SqlServerName'
          value: sqlServer.name
        }
        {
          name: 'SqlDatabaseName'
          value: sqlDatabase.name
        }
      ]
    }
  }
}

// Static Web App
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  sku: {
    name: staticWebAppSku
    tier: staticWebAppSku
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    publicNetworkAccess: 'Enabled'
  }
}

// SQL Server with restricted access
resource sqlServer 'Microsoft.Sql/servers@2022-05-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    publicNetworkAccess: enablePrivateEndpoints ? 'Disabled' : 'Enabled'
    minimalTlsVersion: '1.2'
  }
}

// SQL Firewall: Allow Azure services only (when using private endpoints, this is disabled anyway)
resource sqlAzureServicesFirewall 'Microsoft.Sql/servers/firewallRules@2022-05-01-preview' = if (!enablePrivateEndpoints && createSqlAllowAzureServicesRule) {
  name: 'AllowAzureServices'
  parent: sqlServer
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// SQL AAD Admin (if provided)
resource sqlAadAdmin 'Microsoft.Sql/servers/administrators@2022-05-01-preview' = if (hasSqlAadAdmin) {
  name: 'ActiveDirectory'
  parent: sqlServer
  properties: {
    administratorType: 'ActiveDirectory'
    login: sqlAadAdminLogin
    sid: sqlAadAdminObjectId
    tenantId: subscription().tenantId
  }
}

// SQL Database
resource sqlDatabase 'Microsoft.Sql/servers/databases@2022-05-01-preview' = {
  name: sqlDatabaseName
  parent: sqlServer
  location: location
  sku: {
    name: 'GP_S_Gen5_1'
    tier: 'GeneralPurpose'
    capacity: 1
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 34359738368
    autoPauseDelay: sqlAutoPauseDelay
    minCapacity: sqlMinCapacity
    zoneRedundant: false
    readScale: 'Disabled'
    requestedBackupStorageRedundancy: 'Local'
  }
}

// Private Endpoints (conditional)
resource storagePrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-06-01' = if (enablePrivateEndpoints) {
  name: '${storageAccountName}-pe'
  location: location
  properties: {
    subnet: {
      id: peSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'storage-connection'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-06-01' = if (enablePrivateEndpoints) {
  name: '${keyVaultName}-pe'
  location: location
  properties: {
    subnet: {
      id: peSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'keyvault-connection'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: [
            'vault'
          ]
        }
      }
    ]
  }
}

resource sqlPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-06-01' = if (enablePrivateEndpoints) {
  name: '${sqlServerName}-pe'
  location: location
  properties: {
    subnet: {
      id: peSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'sql-connection'
        properties: {
          privateLinkServiceId: sqlServer.id
          groupIds: [
            'sqlServer'
          ]
        }
      }
    ]
  }
}

// Private DNS Zones (conditional)
resource storageDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.blob.${storageSuffix}'
  location: 'global'
}

resource storageDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  name: '${storageAccountName}-link'
  parent: storageDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource kvDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
}

resource kvDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  name: '${keyVaultName}-link'
  parent: kvDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource sqlDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink${environment().suffixes.sqlServerHostname}'
  location: 'global'
}

resource sqlDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  name: '${sqlServerName}-link'
  parent: sqlDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

// RBAC: Key Vault Secrets User for Function App
resource keyVaultSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, 'key-vault-secrets-user')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// RBAC: Storage Blob Data Contributor for Function App
resource storageBlobContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, 'storage-blob-contributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output names object = {
  environmentName: environmentName
  location: location
  staticWebAppName: staticWebAppName
  functionAppName: functionAppName
  sqlServerName: sqlServerName
  sqlDatabaseName: sqlDatabaseName
  keyVaultName: keyVaultName
  storageAccountName: storageAccountName
  appInsightsName: appInsightsName
  vnetName: vnetName
}

output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
output functionAppDefaultHostname string = functionApp.properties.defaultHostName
output keyVaultUri string = keyVault.properties.vaultUri
output sqlServerFullyQualifiedDomainName string = sqlServer.properties.fullyQualifiedDomainName
output privateEndpointsEnabled bool = enablePrivateEndpoints
