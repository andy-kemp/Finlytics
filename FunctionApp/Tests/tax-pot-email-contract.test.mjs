import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getVatQuarterPeriods, getUnfiledVatBalance } from '../../StaticWebApp/src/utils/vatCalculations.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('daily digest runs only after a successful scheduled Monzo sync, not manual sync', () => {
    const source = read('Functions/MonzoFunctions.cs');
    const daily = source.slice(source.indexOf('[Function("MonzoDailySync")]'), source.indexOf('private async Task NotifyReconnect'));
    assert.ok(daily.indexOf('await _sync.Sync()') < daily.indexOf('await _taxPots.SendDaily(result)'));
    assert.ok(daily.includes('TimerTrigger("0 30 5,13,19 * * *")'));
    assert.ok(daily.includes('if (result.SyncedAtUtc.Hour == 5) await _taxPots.SendDaily(result)'));
    const manual = source.slice(source.indexOf('[Function("MonzoSync")]'), source.indexOf('[Function("MonzoDailySync")]'));
    assert.ok(!manual.includes('SendDaily'));
    assert.ok(read('Program.cs').includes('AddScoped<TaxPotNotificationService>'));
});

test('digest uses fresh balances, suppresses sync warnings and persists sent date only after SMTP success', () => {
    const source = read('Services/TaxPotNotificationService.cs');
    assert.ok(source.includes('sync.Warnings.Count > 0'));
    assert.ok(source.includes('sync.VatPot.Value') && source.includes('sync.CtPot.Value'));
    assert.ok(source.includes('await _monzo.TaxPotDigestSentOn() == day'));
    assert.ok(source.indexOf('if (!success) throw') < source.indexOf('SaveSecret("MonzoTaxPotDigestSentOn", day)'));
    assert.ok(source.includes('TaxPotDailyEmailEnabled') && source.includes('TaxPotNotificationEmail'));
    assert.ok(!source.includes('SaveChangesAsync') && !source.includes('/pots/deposit') && !source.includes('/pots/withdraw'));
});

test('server tax-pot VAT estimates agree with dashboard saved-record calculations', () => {
    const now = '2026-10-11T12:00:00Z';
    const settings = { incorporationDate: '2026-04-01', companyInceptionDate: '2026-04-01', vatQuarterStartMonth: 1, vatAccountingMethod: 'cash' };
    const sources = {
        invoices: [{ id: 1, status: 'Paid', dateIssued: '2026-10-01', datePaid: '2026-10-01', amountNet: 1000, vatAmount: 200 },
            { id: 2, status: 'Sent', dateIssued: '2026-09-01', amountNet: 200, vatAmount: 40 }],
        expenses: [{ entryDate: '2026-10-02', amountNet: 100, vatAmount: 20 },
            { entryDate: '2026-03-01', amountNet: 50, vatAmount: 10 },
            { entryDate: '2026-10-02', amountNet: 100, vatAmount: 20, category: 'Client Entertainment', ctTag: 'NonCT' },
            { entryDate: '2026-10-02', amountNet: 100, vatAmount: 20, originalCurrency: 'USD' }],
        dlaEntries: [{ dlaId: 'DLA-test', direction: 'OwedToDirector', entryDate: '2026-10-03', amountNet: 50, vatAmount: 10 }],
        ledgerEntries: [{ entryType: 'Interest_Received', amount: 10, effectiveDate: '2026-10-01' }]
    };
    const fixtures = [
        { sources, settings, filedReturns: [], now },
        { sources, settings: { ...settings, vatAccountingMethod: 'invoice' }, filedReturns: [], now },
        { sources, settings, filedReturns: [{ quarterStartDate: '2026-04-01', filedDate: '2026-07-01' }], now },
        { sources, settings: { ...settings, vatQuarterStartMonth: 2, vatEffectiveDate: '2026-08-01' }, filedReturns: [], now },
        { sources, settings, filedReturns: [{ quarterStartDate: '2026-10-01', filedDate: now }, { quarterStartDate: '2026-04-01', filedDate: '2026-07-01' }], now }
    ];
    const sdk = process.env.DOTNET_PATH || '/tmp/finlytics-dotnet/dotnet';
    const execution = spawnSync(sdk, ['run', '--project', fileURLToPath(new URL('MonzoSync/MonzoSync.Tests.csproj', import.meta.url)), '--', '--tax-parity'],
        { input: JSON.stringify(fixtures), encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    const results = JSON.parse(execution.stdout.trim());
    const OriginalDate = globalThis.Date;
    const oldTimezone = process.env.TZ;
    process.env.TZ = 'Europe/London';
    globalThis.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
    };
    try {
        fixtures.forEach((fixture, index) => {
            const vat = getUnfiledVatBalance({ quarters: getVatQuarterPeriods(fixture.settings.vatQuarterStartMonth, 40),
                ...fixture.sources, settings: fixture.settings, filedReturns: fixture.filedReturns });
            assert.equal(results[index].vat, Math.round(vat * 100) / 100, `VAT fixture ${index}`);
            assert.equal(results[index].ct, 144.40, `CT fixture ${index}`);
        });
    } finally {
        globalThis.Date = OriginalDate;
        if (oldTimezone == null) delete process.env.TZ; else process.env.TZ = oldTimezone;
    }
});