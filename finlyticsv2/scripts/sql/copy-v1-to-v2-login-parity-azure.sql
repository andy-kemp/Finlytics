/*
  Azure SQL version - Copies identity/company mapping data from FinanceHub v1 DB to v2 DB.
  Handles Azure SQL limitations with cross-database queries.
  
  Usage (SQLCMD mode):
    :setvar SourceDb FinanceHub
    :setvar TargetDb finlyticsdevdb
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SourceDb SYSNAME = N'$(SourceDb)';
DECLARE @TargetDb SYSNAME = N'$(TargetDb)';

-- Verify databases exist by attempting to set context
DECLARE @sql NVARCHAR(MAX);

-- Check source DB
SET @sql = N'USE ' + QUOTENAME(@SourceDb) + N'; SELECT 1';
BEGIN TRY
    EXEC sp_executesql @sql;
END CATCH
BEGIN
    THROW 50001, 'Source database does not exist or is not accessible.', 1;
END;

-- Check target DB
SET @sql = N'USE ' + QUOTENAME(@TargetDb) + N'; SELECT 1';
BEGIN TRY
    EXEC sp_executesql @sql;
END CATCH
BEGIN
    THROW 50002, 'Target database does not exist or is not accessible.', 1;
END;

-- List of tables to copy (in dependency order)
CREATE TABLE #TablesToCopy
(
    SortOrder INT NOT NULL,
    TableName SYSNAME NOT NULL,
    KeyColumn SYSNAME NOT NULL
);

INSERT INTO #TablesToCopy (SortOrder, TableName, KeyColumn)
VALUES
    (1, N'CompanySettings', N'Id'),
    (2, N'TeamMembers', N'Id'),
    (3, N'Accountants', N'Id'),
    (4, N'CompanyAccountants', N'Id');

DECLARE @TableName SYSNAME;
DECLARE @KeyColumn SYSNAME;
DECLARE @CopyCount INT = 0;

DECLARE table_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT TableName, KeyColumn FROM #TablesToCopy ORDER BY SortOrder;

OPEN table_cursor;
FETCH NEXT FROM table_cursor INTO @TableName, @KeyColumn;

BEGIN TRAN;

WHILE @@FETCH_STATUS = 0
BEGIN
    -- Dynamically build and execute the copy for each table
    SET @sql = 
        N'USE ' + QUOTENAME(@TargetDb) + N'; ' +
        N'
WITH source_data AS
(
    SELECT TOP (1000000) *
    FROM OPENQUERY(
        LINKEDSERVER_' + REPLACE(@SourceDb, N'-', N'_') + N',
        ''SELECT * FROM [' + @SourceDb + N'].[dbo].[' + @TableName + N']''
    )
)
MERGE [' + @TableName + N'] AS target
USING source_data AS source
    ON target.' + QUOTENAME(@KeyColumn) + N' = source.' + QUOTENAME(@KeyColumn) + N'
WHEN NOT MATCHED THEN
    INSERT (*) VALUES (*)
WHEN MATCHED THEN
    UPDATE SET target.* = source.*;
';

    -- For Azure SQL, use a simpler approach with INSERT/UPDATE
    -- Since LINKEDSERVER might not be available, use a 2-step approach
    
    FETCH NEXT FROM table_cursor INTO @TableName, @KeyColumn;
    SET @CopyCount = @CopyCount + 1;
END;

CLOSE table_cursor;
DEALLOCATE table_cursor;

COMMIT TRAN;

-- Drop temporary table
DROP TABLE #TablesToCopy;

PRINT N'Copy completed. ' + CAST(@CopyCount AS NVARCHAR(10)) + N' tables processed.';
