using './main.bicep'

param environmentName = 'dev'
param location = 'westeurope'
param namePrefix = 'finlytics'
param staticWebAppSku = 'Free'
param functionPlanSku = 'Y1'
param sqlAdminLogin = 'finlyticsdevadmin'
param sqlAdminPassword = 'SET_BY_PIPELINE_SECRET'
param sqlAutoPauseDelay = 60
param sqlMinCapacity = 1
param enablePrivateEndpoints = false
param createSqlAllowAzureServicesRule = false
param staticWebAppLocation = 'westeurope'
