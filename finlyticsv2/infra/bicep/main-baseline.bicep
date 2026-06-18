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
var storageSuffix = environment().suffixes.storage
var hasSqlAadAdmin = !empty(sqlAadAdminObjectId) && !empty(sqlAadAdminLogin)

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
    allowSharedKeyAccess: true
    networkAcls: {
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

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

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
    publicNetworkAccess: 'Enabled'
  }
}

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
          name: 'AzureWebJobsStorage__accountName'
          value: storage.name
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: 'https://${storage.name}.blob.${storageSuffix}'
        }
        {
          name: 'AzureWebJobsStorage__queueServiceUri'
          value: 'https://${storage.name}.queue.${storageSuffix}'
        }
        {
          name: 'AzureWebJobsStorage__tableServiceUri'
          value: 'https://${storage.name}.table.${storageSuffix}'
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
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

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: staticWebAppSku
    tier: staticWebAppSku
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlServer 'Microsoft.Sql/servers@2022-05-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: '1.2'
  }
}

resource sqlAzureServicesFirewall 'Microsoft.Sql/servers/firewallRules@2022-05-01-preview' = {
  name: 'AllowAzureServices'
  parent: sqlServer
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

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

resource sqlAadOnly 'Microsoft.Sql/servers/azureADOnlyAuthentications@2022-05-01-preview' = if (hasSqlAadAdmin) {
  name: 'Default'
  parent: sqlServer
  properties: {
    azureADOnlyAuthentication: true
  }
  dependsOn: [
    sqlAadAdmin
  ]
}

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

resource keyVaultSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, 'key-vault-secrets-user')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
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
}

output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
output functionAppDefaultHostname string = functionApp.properties.defaultHostName
output keyVaultUri string = keyVault.properties.vaultUri
output sqlServerFullyQualifiedDomainName string = sqlServer.properties.fullyQualifiedDomainName
