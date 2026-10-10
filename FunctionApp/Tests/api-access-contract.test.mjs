import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const policy = read('../Helpers/ApiAccessPolicy.cs');
const listed = name => [...policy.matchAll(new RegExp(`${name} = new\\(StringComparer\\.Ordinal\\)\\s*\\{([^}]*)\\}`, 'g'))]
    .flatMap(match => [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]));
const functions = readdirSync(new URL('../Functions/', import.meta.url)).filter(file => file.endsWith('.cs'))
    .flatMap(file => {
        const source = read(`../Functions/${file}`);
        return [...source.matchAll(/\[Function\("([^"]+)"\)\][\s\S]*?(?:Route = "([^"]*)"|\[TimerTrigger|\[BlobTrigger|\[QueueTrigger)/g)]
            .map(match => ({ name: match[1], route: match[2] ?? null, file, source }));
    });
const http = functions.filter(fn => fn.route !== null);
const publicNames = listed('Public');
const selfAuthenticated = listed('SelfAuthenticated');

test('every allowlisted function exists and is an HTTP function', () => {
    const names = new Set(http.map(fn => fn.name));
    for (const name of [...publicNames, ...selfAuthenticated, 'AnalyzeInvoice']) assert.ok(names.has(name), `${name} missing`);
});

test('only callbacks, signed webhooks and health probes are public', () => {
    for (const name of publicNames) {
        const fn = http.find(item => item.name === name);
        assert.match(fn.route, /(callback|webhooks|health)$/, `${name} is not a callback/webhook/health route`);
    }
    assert.match(read('../Functions/GoCardlessFunctions.cs'), /if \(string\.IsNullOrEmpty\(signature\)\)[\s\S]{0,200}Unauthorized/);
});

test('self-authenticated portal functions call Clerk validation and owner admin routes stay protected', () => {
    for (const name of selfAuthenticated) {
        const fn = http.find(item => item.name === name);
        const body = fn.source.slice(fn.source.indexOf(`[Function("${name}")]`)).split('[Function(')[1];
        assert.match(body, /AuthenticateEmployee\(req\)|ValidateAccountantAsync\(req|_clerkAuth\.ValidateRequestAsync\(req\)/, `${name} does not authenticate`);
    }
    for (const name of ['AccountantInvite', 'AccountantListLinked', 'AccountantRevoke', 'DeleteAllCustomersAndSuppliers', 'MonzoSync', 'GetExpenses'])
        assert.ok(!publicNames.includes(name) && !selfAuthenticated.includes(name), `${name} must require the owner token`);
    assert.ok(http.filter(fn => /^(employee|accountant)\//.test(fn.route) && !['accountant/invite', 'accountant/linked', 'accountant/{id}/revoke'].includes(fn.route))
        .every(fn => selfAuthenticated.includes(fn.name)), 'a portal route is not on the self-authenticated list');
});

test('middleware is registered and fails closed for everything else', () => {
    assert.match(read('../Program.cs'), /builder\.UseMiddleware<ApiAuthorizationMiddleware>\(\)/);
    const middleware = read('../Services/ApiAuthorizationMiddleware.cs');
    assert.match(middleware, /SettlementAuthService>\(\)\.ValidateRequest\(request\)/);
    assert.match(middleware, /GetInvocationResult\(\)\.Value = response/);
    assert.match(policy, /: ApiAccess\.Owner;/);
    assert.ok(http.length > 250);
});
