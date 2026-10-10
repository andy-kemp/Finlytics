#nullable enable
using System;
using System.Collections.Generic;

namespace FinanceHubFunctions.Helpers
{
    public enum ApiAccess { Owner, Public, SelfAuthenticated, OwnerOrTeamMember }

    public static class ApiAccessPolicy
    {
        // Browser redirects, signed webhooks and health probes cannot carry an owner token.
        private static readonly HashSet<string> Public = new(StringComparer.Ordinal)
        {
            "Health", "CleanupHealth", "MonzoCallback", "TrueLayerCallback", "HmrcCallback",
            "GoCardlessBankCallback", "GoCardlessMandateCallback", "GoCardlessPaymentCallback", "GoCardlessWebhook"
        };

        // Employee and accountant portal functions validate Clerk tokens themselves.
        private static readonly HashSet<string> SelfAuthenticated = new(StringComparer.Ordinal)
        {
            "EmployeeGetProfile", "EmployeeListExpenses", "EmployeeCreateExpense", "EmployeeUpdateExpense",
            "EmployeeDeleteExpense", "EmployeeUploadReceipt", "EmployeeListMileage", "EmployeeCreateMileage",
            "EmployeeMileageTracker", "EmployeeAcceptInvite",
            "AccountantAcceptInvite", "AccountantGetProfile", "AccountantListCompanies", "AccountantCompanySummary",
            "AccountantCompanyLedger", "AccountantCompanyExpenses", "AccountantCompanyInvoices",
            "AccountantCompanyDividends", "AccountantCompanyPayroll", "AccountantCompanyDla",
            "AccountantCompanyVatReturns", "AccountantCompanySettings"
        };

        public static ApiAccess For(string functionName) =>
            Public.Contains(functionName) ? ApiAccess.Public
            : SelfAuthenticated.Contains(functionName) ? ApiAccess.SelfAuthenticated
            : functionName == "AnalyzeInvoice" ? ApiAccess.OwnerOrTeamMember
            : ApiAccess.Owner;
    }
}
