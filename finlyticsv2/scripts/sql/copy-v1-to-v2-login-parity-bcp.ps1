param(
    [Parameter(Mandatory = $false)]
    [string]$SourceDbServer = "(localdb)\mssqllocaldb",

    [Parameter(Mandatory = $true)]
    [string]$TargetDbServer,

    [Parameter(Mandatory = $true)]
    [string]$SourceDb,

    [Parameter(Mandatory = $true)]
    [string]$TargetDb,

    [Parameter(Mandatory = $false)]
    [string]$SqlAdminUser,

    [Parameter(Mandatory = $false)]
    [SecureString]$SqlAdminPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "Starting login parity copy from '$SourceDb' ($SourceDbServer) to '$TargetDb' ($TargetDbServer)..."

# Tables to copy in order (dependency order)
$tables = @('CompanySettings', 'TeamMembers', 'Accountants', 'CompanyAccountants')
$tempFolder = Join-Path ([System.IO.Path]::GetTempPath()) 'finlytics-copy-temp'

if (-not (Test-Path $tempFolder)) {
    New-Item -ItemType Directory -Path $tempFolder | Out-Null
}

# Build credentials for target server if provided
$targetCredArgs = @()
if ($SqlAdminUser -and $SqlAdminPassword) {
    $plainPwdPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SqlAdminPassword)
    try {
        $plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($plainPwdPtr)
        $targetCredArgs = @('-U', $SqlAdminUser, '-P', $plainPwd)
    }
    finally {
        if ($plainPwdPtr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($plainPwdPtr)
        }
    }
}

    foreach ($tableName in $tables) {
        Write-Host "Copying table: $tableName..."

        $dataFile = Join-Path $tempFolder "$tableName.bcp"

        # Export from source database (local)
        Write-Host "  - Exporting from $SourceDb.$tableName (local)..."
        $bcpExportCmd = @(
            'bcp',
            "$SourceDb.dbo.$tableName",
            'out',
            $dataFile,
            '-S', $SourceDbServer,
            '-c',
            '-T'
        )
        & $bcpExportCmd[0] $bcpExportCmd[1..($bcpExportCmd.Count - 1)]
        if ($LASTEXITCODE -ne 0) {
            throw "BCP export failed for $tableName"
        }

        # Import into target database (Azure)
        Write-Host "  - Importing into $TargetDb.$tableName (Azure)..."
        $bcpImportCmd = @(
            'bcp',
            "dbo.$tableName",
            'in',
            $dataFile,
            '-S', $TargetDbServer,
            '-d', $TargetDb
        ) + $targetCredArgs + @('-c')
        
        & $bcpImportCmd[0] $bcpImportCmd[1..($bcpImportCmd.Count - 1)]
        if ($LASTEXITCODE -ne 0) {
            throw "BCP import failed for $tableName"
        }

        Remove-Item $dataFile -Force
    }

    Write-Host 'Copy completed successfully.'
    Remove-Item $tempFolder -Force -Recurse
