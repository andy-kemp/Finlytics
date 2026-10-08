SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @Columns TABLE (TableName sysname, ColumnName sysname, SqlType nvarchar(30));
INSERT INTO @Columns (TableName, ColumnName, SqlType)
SELECT Tables.TableName, Fields.ColumnName, Fields.SqlType
FROM (VALUES (N'Expenses'), (N'DlaEntries')) AS Tables(TableName)
CROSS JOIN (VALUES
    (N'OriginalCurrency', N'nvarchar(3)'),
    (N'OriginalAmountNet', N'decimal(18,2)'),
    (N'OriginalVatAmount', N'decimal(18,2)'),
    (N'OriginalAmountGross', N'decimal(18,2)'),
    (N'ExchangeRateToGbp', N'decimal(18,8)'),
    (N'ExchangeRateDate', N'datetime2'),
    (N'ExchangeRateSource', N'nvarchar(100)'),
    (N'EstimatedGbpGross', N'decimal(18,2)'),
    (N'ActualGbpPaid', N'decimal(18,2)'),
    (N'SettlementDate', N'datetime2'),
    (N'SettlementBankTransactionId', N'int')
) AS Fields(ColumnName, SqlType);
INSERT INTO @Columns VALUES
    (N'BankTransactions', N'OriginalCurrency', N'nvarchar(3)'),
    (N'BankTransactions', N'OriginalAmount', N'decimal(18,2)');

DECLARE @TableName sysname, @ColumnName sysname, @SqlType nvarchar(30), @Sql nvarchar(max);
DECLARE CurrencyColumns CURSOR LOCAL FAST_FORWARD FOR SELECT TableName, ColumnName, SqlType FROM @Columns;
OPEN CurrencyColumns;
FETCH NEXT FROM CurrencyColumns INTO @TableName, @ColumnName, @SqlType;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF COL_LENGTH(N'dbo.' + @TableName, @ColumnName) IS NULL
    BEGIN
        SET @Sql = N'ALTER TABLE [dbo].' + QUOTENAME(@TableName) + N' ADD ' + QUOTENAME(@ColumnName) + N' ' + @SqlType + N' NULL;';
        EXEC sys.sp_executesql @Sql;
    END;
    FETCH NEXT FROM CurrencyColumns INTO @TableName, @ColumnName, @SqlType;
END;
CLOSE CurrencyColumns;
DEALLOCATE CurrencyColumns;
COMMIT TRANSACTION;