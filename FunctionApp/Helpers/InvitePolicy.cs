#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace FinanceHubFunctions.Helpers
{
    public enum InviteCheck { Ok, Expired, EmailMismatch, EmailUnverified }

    /// <summary>Rules for accepting team-member and accountant invite links.</summary>
    public static class InvitePolicy
    {
        public static readonly TimeSpan Lifetime = TimeSpan.FromDays(14);

        /// <param name="signedInEmails">Verified emails of the signed-in user; empty when unknown.</param>
        public static InviteCheck Check(DateTime invitedAtUtc, string? invitedEmail, IReadOnlyCollection<string> signedInEmails, DateTime nowUtc)
        {
            if (nowUtc - invitedAtUtc > Lifetime) return InviteCheck.Expired;
            if (string.IsNullOrWhiteSpace(invitedEmail)) return InviteCheck.Ok;
            if (signedInEmails.Count == 0) return InviteCheck.EmailUnverified;
            return signedInEmails.Any(email => string.Equals(email.Trim(), invitedEmail.Trim(), StringComparison.OrdinalIgnoreCase))
                ? InviteCheck.Ok
                : InviteCheck.EmailMismatch;
        }

        public static string Message(InviteCheck check) => check switch
        {
            InviteCheck.Expired => "This invite has expired. Ask for a new invite.",
            InviteCheck.EmailMismatch => "This invite was sent to a different email address. Sign in with the invited email.",
            _ => "Invalid or expired invite"
        };
    }
}
