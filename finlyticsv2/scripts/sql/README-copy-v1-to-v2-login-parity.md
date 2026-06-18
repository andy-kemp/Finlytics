# Copy v1 Data to v2 for Login Parity

This copies the minimum relational data required so v2 can resolve the same user/company context as v1:

- `CompanySettings`
- `TeamMembers`
- `Accountants`
- `CompanyAccountants`

The SQL script is idempotent and safe to rerun.

## 1. Run from PowerShell

```powershell
$pwd = Read-Host "SQL admin password" -AsSecureString

.\finlyticsv2\scripts\sql\copy-v1-to-v2-login-parity.ps1 `
  -SqlServerName "<your-sql-server>.database.windows.net" `
  -SourceDb "<v1-db-name>" `
  -TargetDb "<v2-db-name>" `
  -SqlAdminUser "<sql-admin-login>" `
  -SqlAdminPassword $pwd
```

## 2. Verify in v2 API

After copy, sign in to v2 and call:

- `GET /api/my-context`

You should see company matches from `TeamMemberEmail` and/or `CompanySettingsEmail`.

## 3. Lock with immutable mapping

Once matched, persist immutable mapping:

- In UI: click `Persist immutable mapping`
- Or call `POST /api/my-context/link` with `{"companyId": <id>}`

After that, future lookups use immutable Entra identity first.
