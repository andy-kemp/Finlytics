# Deploy Function App
$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configFile = Join-Path $scriptRoot "..\finance-hub-config.ini"
$fallbackConfigFile = Join-Path $scriptRoot "..\Archive-SharePoint\finance-hub-config.ini"
$jsonConfigFile = Join-Path $scriptRoot "..\deployment-config-kemponline.json"

function Get-IniContent {
    param([string]$Path)
    $ini = @{}
    if (-not (Test-Path $Path)) { return $ini }
    $section = $null
    switch -regex -file $Path {
        '^\s*\[(.+)\]\s*$' {
            $section = $matches[1]
            if (-not $ini.ContainsKey($section)) { $ini[$section] = @{} }
        }
        '^\s*([^=]+?)\s*=\s*(.*)$' {
            if (-not $section) { $section = "Default"; if (-not $ini.ContainsKey($section)) { $ini[$section] = @{} } }
            $name = $matches[1].Trim()
            $value = $matches[2]
            $ini[$section][$name] = $value
        }
    }
    return $ini
}

$config = $null
if (Test-Path $jsonConfigFile) {
    $json = Get-Content -Raw -Path $jsonConfigFile | ConvertFrom-Json
    if ($null -ne $json -and $null -ne $json.ResourceGroup -and $null -ne $json.Resources.FunctionApp) {
        $config = @{
            Azure = @{
                ResourceGroup = $json.ResourceGroup
                FunctionAppName = $json.Resources.FunctionApp
                StorageAccountName = $json.Resources.StorageAccount
            }
            FunctionApp = @{
                FunctionAppUrl = "https://$($json.Resources.FunctionApp).azurewebsites.net"
            }
        }
    }
}

if ($null -eq $config) {
    $config = Get-IniContent -Path $configFile
    if (-not $config.ContainsKey('Azure') -or -not $config['Azure'].ContainsKey('ResourceGroup') -or -not $config['Azure'].ContainsKey('FunctionAppName')) {
        $config = Get-IniContent -Path $fallbackConfigFile
    }
}

if (-not $config.ContainsKey('Azure') -or -not $config['Azure'].ContainsKey('ResourceGroup') -or -not $config['Azure'].ContainsKey('FunctionAppName')) {
    Write-Host "✗ Missing deployment config for Function App (ResourceGroup/FunctionAppName)" -ForegroundColor Red
    exit 1
}

$resourceGroup = $config['Azure']['ResourceGroup']
$functionAppName = $config['Azure']['FunctionAppName']
$storageAccount = $config['Azure']['StorageAccountName']

Write-Host "Deploying Function App: $functionAppName..." -ForegroundColor Yellow

# Build the Function App
Write-Host "Building Function App..." -ForegroundColor Gray
dotnet build --configuration Release

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Build failed" -ForegroundColor Red
    exit 1
}

# Publish to folder
Write-Host "Publishing Function App..." -ForegroundColor Gray
dotnet publish --configuration Release --output ./publish

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Publish failed" -ForegroundColor Red
    exit 1
}

# Create deployment package
Write-Host "Creating deployment package..." -ForegroundColor Gray
Compress-Archive -Path ./publish/* -DestinationPath ./deploy.zip -Force

# Deploy to Azure
Write-Host "Deploying to Azure Function App..." -ForegroundColor Gray
az functionapp deployment source config-zip `
  --resource-group $resourceGroup `
  --name $functionAppName `
  --src ./deploy.zip

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Function App deployed successfully" -ForegroundColor Green
} else {
    Write-Host "✗ Function App deployment failed" -ForegroundColor Red
    exit 1
}

# Clean up
Remove-Item ./publish -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item ./deploy.zip -Force -ErrorAction SilentlyContinue

Write-Host ""
if ($config.ContainsKey('FunctionApp') -and $config['FunctionApp'].ContainsKey('FunctionAppUrl')) {
    Write-Host "Function App URL: $($config['FunctionApp']['FunctionAppUrl'])" -ForegroundColor Cyan
}
Write-Host ""
