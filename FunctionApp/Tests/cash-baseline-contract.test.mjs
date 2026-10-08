import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { calculateRecordedTradingCash } from '../../StaticWebApp/src/utils/cashCalculations.mjs';

const project = fileURLToPath(new URL('./CashBaseline/CashBaseline.Tests.csproj', import.meta.url));
const endpoint = readFileSync(new URL('../Functions/CashBaselineFunctions.cs', import.meta.url), 'utf8');
const generic = readFileSync(new URL('../Functions/CompanyLedgerFunctions.cs', import.meta.url), 'utf8');

test('authoritative C# snapshot matches unchanged JS recorded cash with payroll and legacy DLA fixtures', () => {
    const run = spawnSync(process.env.DOTNET_PATH || '/tmp/finlytics-dotnet/dotnet',
        ['run', '--no-build', '--project', project, '--', '--parity'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const fixtures = JSON.parse(run.stdout.trim());
    assert.equal(fixtures.length, 4);
    for (const fixture of fixtures) {
        const data = fixture.sources;
        const expected = calculateRecordedTradingCash({ ...data, includePayroll: data.payrollRuns.length > 0
            || Boolean(data.payrollSettings[0]?.employerPAYEReference), endDate: new Date('2026-10-08T12:00:00Z') });
        assert.equal(fixture.balance, expected.balance);
    }
});

test('endpoint route and audited transaction contracts remain explicit', () => {
    assert.equal((endpoint.match(/Route = "bank\/accounts\/\{id:int\}\/cash-baseline"/g) || []).length, 2);
    assert.match(endpoint, /IsolationLevel\.Serializable/);
    assert.match(endpoint, /CashBaselinePolicy\.Identical\(existing, request\)/);
    assert.match(endpoint, /CashBaselinePolicy\.Create\(id, request, sources, now\)/);
    assert.match(endpoint, /notes\.Length > 2000/);
    assert.ok(endpoint.indexOf('_auth.ValidateRequest(req)', endpoint.indexOf('CreateBankCashBaseline('))
        < endpoint.indexOf('req.ReadAsStringAsync()', endpoint.indexOf('CreateBankCashBaseline(')));
    assert.match(generic, /An audited cash baseline cannot be deleted/);
    assert.match(generic, /Cash baselines are reserved for the bank cash-baseline endpoint/);
});