using Microsoft.Data.SqlClient;

namespace FinlyticsV2.Api.Services;

public sealed class UserContextService
{
    public async Task<UserContextResult> ResolveAsync(
        string? immutableUserId,
        string? tenantId,
        IReadOnlyList<string> aliases,
        CancellationToken cancellationToken = default)
    {
        var connectionString = Environment.GetEnvironmentVariable("SqlConnectionString");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new UserContextResult
            {
                Error = "SqlConnectionString is not configured for API runtime.",
            };
        }

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        var companies = new List<UserCompanyMatch>();

        if (!string.IsNullOrWhiteSpace(immutableUserId) && await MappingTableExistsAsync(connection, cancellationToken))
        {
            companies.AddRange(await ResolveFromImmutableMappingAsync(connection, immutableUserId!, tenantId, cancellationToken));
        }

        if (companies.Count == 0 && aliases.Count > 0)
        {
            companies.AddRange(await ResolveFromEmailFallbackAsync(connection, aliases, cancellationToken));
        }

        var distinct = companies
            .GroupBy(c => c.CompanyId)
            .Select(g => g.First())
            .OrderBy(c => c.CompanyName)
            .ToList();

        return new UserContextResult
        {
            Companies = distinct,
            PrimaryCompanyId = distinct.FirstOrDefault()?.CompanyId,
        };
    }

    public async Task<string?> UpsertImmutableMappingAsync(
        string immutableUserId,
        string? tenantId,
        int companyId,
        CancellationToken cancellationToken = default)
    {
        var connectionString = Environment.GetEnvironmentVariable("SqlConnectionString");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return "SqlConnectionString is not configured for API runtime.";
        }

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        await EnsureMappingTableAsync(connection, cancellationToken);

        const string sql = @"
MERGE UserCompanyMappings AS target
USING (SELECT @ImmutableUserId AS ImmutableUserId, @TenantId AS TenantId, @CompanyId AS CompanyId) AS source
ON target.ImmutableUserId = source.ImmutableUserId
   AND ((target.TenantId = source.TenantId) OR (target.TenantId IS NULL AND source.TenantId IS NULL))
   AND target.CompanyId = source.CompanyId
WHEN MATCHED THEN
  UPDATE SET IsActive = 1, UpdatedAtUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (ImmutableUserId, TenantId, CompanyId, IsActive, CreatedAtUtc, UpdatedAtUtc)
  VALUES (source.ImmutableUserId, source.TenantId, source.CompanyId, 1, SYSUTCDATETIME(), SYSUTCDATETIME());";

        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@ImmutableUserId", immutableUserId);
        command.Parameters.AddWithValue("@TenantId", (object?)tenantId ?? DBNull.Value);
        command.Parameters.AddWithValue("@CompanyId", companyId);

        await command.ExecuteNonQueryAsync(cancellationToken);
        return null;
    }

    private static async Task<bool> MappingTableExistsAsync(SqlConnection connection, CancellationToken cancellationToken)
    {
        const string sql = @"
SELECT 1
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserCompanyMappings';";

        await using var cmd = new SqlCommand(sql, connection);
        var result = await cmd.ExecuteScalarAsync(cancellationToken);
        return result is not null;
    }

    private static async Task EnsureMappingTableAsync(SqlConnection connection, CancellationToken cancellationToken)
    {
        const string sql = @"
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'UserCompanyMappings')
BEGIN
    CREATE TABLE dbo.UserCompanyMappings
    (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        ImmutableUserId NVARCHAR(200) NOT NULL,
        TenantId NVARCHAR(100) NULL,
        CompanyId INT NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_UserCompanyMappings_IsActive DEFAULT(1),
        CreatedAtUtc DATETIME2 NOT NULL,
        UpdatedAtUtc DATETIME2 NOT NULL
    );

    CREATE UNIQUE INDEX UX_UserCompanyMappings_UserTenantCompany
        ON dbo.UserCompanyMappings(ImmutableUserId, TenantId, CompanyId);
END";

        await using var cmd = new SqlCommand(sql, connection);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<List<UserCompanyMatch>> ResolveFromImmutableMappingAsync(
        SqlConnection connection,
        string immutableUserId,
        string? tenantId,
        CancellationToken cancellationToken)
    {
        const string sql = @"
SELECT DISTINCT m.CompanyId, cs.CompanyName, CAST('ImmutableMapping' AS NVARCHAR(64)) AS MatchSource
FROM dbo.UserCompanyMappings m
LEFT JOIN dbo.CompanySettings cs ON cs.Id = m.CompanyId
WHERE m.IsActive = 1
  AND m.ImmutableUserId = @ImmutableUserId
  AND (@TenantId IS NULL OR m.TenantId IS NULL OR m.TenantId = @TenantId);";

        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@ImmutableUserId", immutableUserId);
        command.Parameters.AddWithValue("@TenantId", (object?)tenantId ?? DBNull.Value);

        var results = new List<UserCompanyMatch>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new UserCompanyMatch
            {
                CompanyId = reader.GetInt32(0),
                CompanyName = reader.IsDBNull(1) ? null : reader.GetString(1),
                MatchSource = reader.GetString(2),
            });
        }

        return results;
    }

    private static async Task<List<UserCompanyMatch>> ResolveFromEmailFallbackAsync(
        SqlConnection connection,
        IReadOnlyList<string> aliases,
        CancellationToken cancellationToken)
    {
        var sqlParams = new List<string>();
        await using var command = new SqlCommand();
        command.Connection = connection;

        for (var i = 0; i < aliases.Count; i++)
        {
            var param = $"@email{i}";
            sqlParams.Add(param);
            command.Parameters.AddWithValue(param, aliases[i]);
        }

        var inClause = string.Join(",", sqlParams);
        command.CommandText = $@"
SELECT DISTINCT tm.CompanyId, cs.CompanyName, CAST('TeamMemberEmail' AS NVARCHAR(64)) AS MatchSource
FROM dbo.TeamMembers tm
LEFT JOIN dbo.CompanySettings cs ON cs.Id = tm.CompanyId
WHERE LOWER(tm.Email) IN ({inClause})

UNION

SELECT DISTINCT cs.Id AS CompanyId, cs.CompanyName, CAST('CompanySettingsEmail' AS NVARCHAR(64)) AS MatchSource
FROM dbo.CompanySettings cs
WHERE LOWER(ISNULL(cs.Email, '')) IN ({inClause})
   OR LOWER(ISNULL(cs.CompanyEmail, '')) IN ({inClause});";

        var results = new List<UserCompanyMatch>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new UserCompanyMatch
            {
                CompanyId = reader.GetInt32(0),
                CompanyName = reader.IsDBNull(1) ? null : reader.GetString(1),
                MatchSource = reader.GetString(2),
            });
        }

        return results;
    }
}

public sealed class UserContextResult
{
    public int? PrimaryCompanyId { get; set; }
    public List<UserCompanyMatch> Companies { get; set; } = new();
    public string? Error { get; set; }
}

public sealed class UserCompanyMatch
{
    public int CompanyId { get; set; }
    public string? CompanyName { get; set; }
    public string MatchSource { get; set; } = string.Empty;
}
