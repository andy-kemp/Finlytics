param(
    [Parameter(Mandatory = $true)]
    [string]$SqlServerName,

    [Parameter(Mandatory = $true)]
    [string]$SourceDb,

    [Parameter(Mandatory = $true)]
    [string]$TargetDb,

    [Parameter(Mandatory = $true)]
    [string]$SqlAdminUser,

    [Parameter(Mandatory = $true)]
    [SecureString]$SqlAdminPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'copy-v1-to-v2-login-parity.sql'
if (-not (Test-Path $scriptPath)) {
    throw "Migration script not found at $scriptPath"
}

$plainPwdPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SqlAdminPassword)
try {
    $plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($plainPwdPtr)

    $command = @(
        'sqlcmd',
        '-S', "tcp:$SqlServerName,1433",
        '-d', 'master',
        '-U', $SqlAdminUser,
        '-P', $plainPwd,
        '-b',
        '-v', "SourceDb=$SourceDb", "TargetDb=$TargetDb",
        '-i', $scriptPath
    )

    Write-Host "Running login parity copy from '$SourceDb' to '$TargetDb' on server '$SqlServerName'..."
    & $command[0] $command[1..($command.Count - 1)]

    if ($LASTEXITCODE -ne 0) {
        throw "sqlcmd exited with code $LASTEXITCODE"
    }

    Write-Host 'Copy completed successfully.'
}
finally {
    if ($plainPwdPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($plainPwdPtr)
    }
}
