-- Add ConfirmationPdfUrl column to VatReturns table
-- Run this script on the target database to support VAT submission confirmation PDF uploads.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'VatReturns' AND COLUMN_NAME = 'ConfirmationPdfUrl'
)
BEGIN
    ALTER TABLE VatReturns ADD ConfirmationPdfUrl NVARCHAR(1000) NULL;
    PRINT 'Column ConfirmationPdfUrl added to VatReturns.';
END
ELSE
BEGIN
    PRINT 'Column ConfirmationPdfUrl already exists in VatReturns.';
END
