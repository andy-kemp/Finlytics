/*
  Copies identity/company mapping data from FinanceHub v1 DB to v2 DB.
  Designed to be safe to re-run.

  Usage (SQLCMD mode):
    :setvar SourceDb FinanceHubV1
    :setvar TargetDb FinanceHubV2
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SourceDb SYSNAME = N'$(SourceDb)';
DECLARE @TargetDb SYSNAME = N'$(TargetDb)';

IF DB_ID(@SourceDb) IS NULL
    THROW 50001, 'Source database does not exist.', 1;

IF DB_ID(@TargetDb) IS NULL
    THROW 50002, 'Target database does not exist.', 1;

DECLARE @tables TABLE
(
    SortOrder INT NOT NULL,
    TableName SYSNAME NOT NULL,
    KeyColumn SYSNAME NOT NULL
);

INSERT INTO @tables (SortOrder, TableName, KeyColumn)
VALUES
    (1, N'CompanySettings', N'Id'),
    (2, N'TeamMembers', N'Id'),
    (3, N'Accountants', N'Id'),
    (4, N'CompanyAccountants', N'Id');

BEGIN TRAN;

DECLARE
    @TableName SYSNAME,
    @KeyColumn SYSNAME,
    @identityCol SYSNAME,
    @sourceObjId INT,
    @targetObjId INT,
    @columnList NVARCHAR(MAX),
    @insertValues NVARCHAR(MAX),
    @updateSet NVARCHAR(MAX),
    @sql NVARCHAR(MAX);

DECLARE table_cursor CURSOR FAST_FORWARD FOR
    SELECT TableName, KeyColumn
    FROM @tables
    ORDER BY SortOrder;

OPEN table_cursor;
FETCH NEXT FROM table_cursor INTO @TableName, @KeyColumn;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sourceObjId = OBJECT_ID(QUOTENAME(@SourceDb) + N'.dbo.' + QUOTENAME(@TableName));
    SET @targetObjId = OBJECT_ID(QUOTENAME(@TargetDb) + N'.dbo.' + QUOTENAME(@TableName));

    IF @sourceObjId IS NULL
        THROW 50010, 'Source table missing.', 1;

    IF @targetObjId IS NULL
        THROW 50011, 'Target table missing.', 1;

    SELECT @identityCol = c.name
    FROM sys.identity_columns c
    WHERE c.object_id = @targetObjId;

    ;WITH common_cols AS
    (
        SELECT c_t.name, c_t.column_id
        FROM sys.columns c_t
        INNER JOIN sys.columns c_s
            ON c_s.name = c_t.name
           AND c_s.object_id = @sourceObjId
        WHERE c_t.object_id = @targetObjId
          AND c_t.is_computed = 0
          AND c_t.system_type_id <> 189 -- rowversion/timestamp
    )
    SELECT
        @columnList = STRING_AGG(QUOTENAME(name), N', ') WITHIN GROUP (ORDER BY column_id),
        @insertValues = STRING_AGG(N's.' + QUOTENAME(name), N', ') WITHIN GROUP (ORDER BY column_id)
    FROM common_cols;

    ;WITH up_cols AS
    (
        SELECT c_t.name, c_t.column_id
        FROM sys.columns c_t
        INNER JOIN sys.columns c_s
            ON c_s.name = c_t.name
           AND c_s.object_id = @sourceObjId
        WHERE c_t.object_id = @targetObjId
          AND c_t.is_computed = 0
          AND c_t.system_type_id <> 189
          AND c_t.name <> @KeyColumn
          AND (ISNULL(@identityCol, N'') = N'' OR c_t.name <> @identityCol)
    )
    SELECT @updateSet = STRING_AGG(N't.' + QUOTENAME(name) + N' = s.' + QUOTENAME(name), N', ') WITHIN GROUP (ORDER BY column_id)
    FROM up_cols;

    IF @columnList IS NULL OR LEN(@columnList) = 0
        THROW 50012, 'No common columns found between source and target table.', 1;

    SET @sql = N'';

    IF @identityCol IS NOT NULL
    BEGIN
        SET @sql += N'SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.' + QUOTENAME(@TableName) + N' ON;' + CHAR(10);
    END;

    SET @sql += N'
MERGE ' + QUOTENAME(@TargetDb) + N'.dbo.' + QUOTENAME(@TableName) + N' AS t
USING (
    SELECT ' + @columnList + N'
    FROM ' + QUOTENAME(@SourceDb) + N'.dbo.' + QUOTENAME(@TableName) + N'
) AS s
ON t.' + QUOTENAME(@KeyColumn) + N' = s.' + QUOTENAME(@KeyColumn) + N'
' + CASE WHEN @updateSet IS NOT NULL AND LEN(@updateSet) > 0
         THEN N'WHEN MATCHED THEN UPDATE SET ' + @updateSet + CHAR(10)
         ELSE N'' END +
N'WHEN NOT MATCHED BY TARGET THEN
    INSERT (' + @columnList + N')
    VALUES (' + @insertValues + N');
';

    IF @identityCol IS NOT NULL
    BEGIN
        SET @sql += N'SET IDENTITY_INSERT ' + QUOTENAME(@TargetDb) + N'.dbo.' + QUOTENAME(@TableName) + N' OFF;' + CHAR(10);
    END;

    EXEC sp_executesql @sql;

    FETCH NEXT FROM table_cursor INTO @TableName, @KeyColumn;
END;

CLOSE table_cursor;
DEALLOCATE table_cursor;

COMMIT;

SELECT
    (SELECT COUNT(1) FROM [$(SourceDb)].dbo.CompanySettings) AS SourceCompanySettings,
    (SELECT COUNT(1) FROM [$(TargetDb)].dbo.CompanySettings) AS TargetCompanySettings,
    (SELECT COUNT(1) FROM [$(SourceDb)].dbo.TeamMembers) AS SourceTeamMembers,
    (SELECT COUNT(1) FROM [$(TargetDb)].dbo.TeamMembers) AS TargetTeamMembers,
    (SELECT COUNT(1) FROM [$(SourceDb)].dbo.Accountants) AS SourceAccountants,
    (SELECT COUNT(1) FROM [$(TargetDb)].dbo.Accountants) AS TargetAccountants,
    (SELECT COUNT(1) FROM [$(SourceDb)].dbo.CompanyAccountants) AS SourceCompanyAccountants,
    (SELECT COUNT(1) FROM [$(TargetDb)].dbo.CompanyAccountants) AS TargetCompanyAccountants;
