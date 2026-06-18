using './main.bicep'

param environmentName = 'prod'
param location = 'westeurope'
param namePrefix = 'finlytics'
param staticWebAppSku = 'Standard'
param functionPlanSku = 'Y1'
param sqlAdminLogin = 'finlyticsprodadmin'
param sqlAdminPassword = 'SET_BY_PIPELINE_SECRET'
param sqlAutoPauseDelay = -1
param sqlMinCapacity = 1
param enablePrivateEndpoints = false
param createSqlAllowAzureServicesRule = false
param staticWebAppLocation = 'westeurope'
