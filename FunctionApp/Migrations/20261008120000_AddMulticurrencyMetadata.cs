using System;
using FinanceHubFunctions.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace FinanceHubFunctions.Migrations
{
    [DbContext(typeof(FinanceHubDbContext))]
    [Migration("20261008120000_AddMulticurrencyMetadata")]
    public partial class AddMulticurrencyMetadata : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var table in new[] { "Expenses", "DlaEntries" })
            {
                AddMissingColumn(migrationBuilder, table, "OriginalCurrency", "nvarchar(3)");
                foreach (var name in new[] { "OriginalAmountNet", "OriginalVatAmount", "OriginalAmountGross", "EstimatedGbpGross", "ActualGbpPaid" })
                    AddMissingColumn(migrationBuilder, table, name, "decimal(18,2)");
                AddMissingColumn(migrationBuilder, table, "ExchangeRateToGbp", "decimal(18,8)");
                AddMissingColumn(migrationBuilder, table, "ExchangeRateDate", "datetime2");
                AddMissingColumn(migrationBuilder, table, "ExchangeRateSource", "nvarchar(100)");
                AddMissingColumn(migrationBuilder, table, "SettlementDate", "datetime2");
                AddMissingColumn(migrationBuilder, table, "SettlementBankTransactionId", "int");
            }
            AddMissingColumn(migrationBuilder, "BankTransactions", "OriginalCurrency", "nvarchar(3)");
            AddMissingColumn(migrationBuilder, "BankTransactions", "OriginalAmount", "decimal(18,2)");
        }

        private static void AddMissingColumn(MigrationBuilder migrationBuilder, string table, string name, string type)
        {
            migrationBuilder.Sql($"IF COL_LENGTH(N'dbo.{table}', N'{name}') IS NULL ALTER TABLE [dbo].[{table}] ADD [{name}] {type} NULL;");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in new[] { "Expenses", "DlaEntries" })
            {
                foreach (var name in new[] { "OriginalCurrency", "OriginalAmountNet", "OriginalVatAmount", "OriginalAmountGross", "ExchangeRateToGbp", "ExchangeRateDate", "ExchangeRateSource", "EstimatedGbpGross", "ActualGbpPaid", "SettlementDate", "SettlementBankTransactionId" })
                    migrationBuilder.DropColumn(name: name, table: table);
            }
            migrationBuilder.DropColumn(name: "OriginalCurrency", table: "BankTransactions");
            migrationBuilder.DropColumn(name: "OriginalAmount", table: "BankTransactions");
        }
    }
}