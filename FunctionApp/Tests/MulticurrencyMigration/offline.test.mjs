import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('MulticurrencyMigration.csproj', import.meta.url));
const sdk = '/tmp/finlytics-dotnet/dotnet';
function run(args, connection) {
    const env = { ...process.env };
    delete env.FINLYTICS_MIGRATION_TEST_CONNECTION;
    if (connection !== undefined) env.FINLYTICS_MIGRATION_TEST_CONNECTION = connection;
    const result = spawnSync(sdk, ['run', '--no-build', '--project', project, '--', ...args], { env, encoding: 'utf8' });
    assert.ifError(result.error);
    return { ...result, output: result.stdout + result.stderr };
}

test('offline contracts never connect, even with a supplied connection', () => {
    const result = run(['--offline'], 'Server=must-not-connect.invalid;Database=Finlytics;Password=DO_NOT_LOG_THIS');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Offline contracts passed: 24 nullable columns/);
    assert.match(result.output, /No database connection opened/);
    assert.doesNotMatch(result.output, /DO_NOT_LOG_THIS|must-not-connect|Connected to guarded/);
});

test('default invocation remains offline', () => {
    const result = run([], 'Server=must-not-connect.invalid;Database=Finlytics');
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /No database connection opened/);
});

test('execute without environment reports a skip with exit 2', () => {
    const result = run(['--execute']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /No FINLYTICS_MIGRATION_TEST_CONNECTION supplied/);
    assert.match(result.output, /not a database test pass/);
});

test('production-named database is rejected without opening a connection or leaking values', () => {
    const result = run(['--execute', '--cleanup'], 'Server=must-not-connect.invalid;Database=Finlytics;User ID=private-user;Password=DO_NOT_LOG_THIS;Encrypt=true');
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Validation failed/);
    assert.doesNotMatch(result.output, /DO_NOT_LOG_THIS|private-user|must-not-connect|Connected to guarded/);
});

test('offline and execute cannot be combined', () => {
    const result = run(['--offline', '--execute']);
    assert.equal(result.status, 1, result.output);
    assert.doesNotMatch(result.output, /Connected to guarded/);
});