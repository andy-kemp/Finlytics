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

$plainPwdPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SqlAdminPassword)
try {
    $plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($plainPwdPtr)

    Write-Host "Starting login parity copy from '$SourceDb' to '$TargetDb'..."

    # Tables to copy in order
    $tables = @(
        @{ Name = 'CompanySettings'; Key = 'Id' },
        @{ Name = 'TeamMembers'; Key = 'Id' },
        @{ Name = 'Accountants'; Key = 'Id' },
        @{ Name = 'CompanyAccountants'; Key = 'Id' }
    )

    foreach ($table in $tables) {
        $tableName = $table.Name
        $keyColumn = $table.Key

        Write-Host "Copying table: $tableName..."

        # SQL to perform the MERGE across databases
        $copySql = @"
USE [$TargetDb];

-- Disable any identity inserts or constraints if needed
IF OBJECT_ID('[dbo].[$tableName]') IS NOT NULL
BEGIN
    -- Insert or update data from source database
    -- Using INSERT/UPDATE with explicit column matching
    
    DECLARE @RecordsCopied INT = 0;
    
    MERGE [dbo].[$tableName] AS target
    USING (
        SELECT *
        FROM OPENROWSET(
            'SQLNCLI',
            'Server=$SqlServerName;Database=$SourceDb;UID=$SqlAdminUser;PWD=$plainPwd;',
            'SELECT * FROM [dbo].[$tableName]'
        )
    ) AS source
    ON target.[$keyColumn] = source.[$keyColumn]
    WHEN NOT MATCHED THEN
        INSERT (*) 
        VALUES (*)
    WHEN MATCHED THEN
        UPDATE SET target.* = source.*;
        
    SET @RecordsCopied = @@ROWCOUNT;
    PRINT CONCAT('Copied/updated ', @RecordsCopied, ' records in $tableName');
END;
"@

        # Execute the copy
        $command = @(
            'sqlcmd',
            '-S', "tcp:$SqlServerName,1433",
            '-U', $SqlAdminUser,
            '-P', $plainPwd,
            '-b',
            '-Q', $copySql
        )

        & $command[0] $command[1..($command.Count - 1)] 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to copy table $tableName. Exit code: $LASTEXITCODE"
        }
    }

    Write-Host 'Copy completed successfully.'
}
catch {
    Write-Error "Error during copy: $_"
    throw
}
finally {
    if ($plainPwdPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($plainPwdPtr)
    }
}
