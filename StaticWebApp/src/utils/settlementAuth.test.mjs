import assert from 'node:assert/strict';
import test from 'node:test';
import { settlementScope, getSettlementHeaders } from './settlementAuth.mjs';

const scope = 'api://12345678-1234-1234-1234-123456789012/Settlement.Write';

test('settlement requests dedicated API access token, never Graph scope', async () => {
    const account = { homeAccountId: 'owner' };
    const headers = await getSettlementHeaders({ acquireTokenSilent: async request => {
        assert.deepEqual(request.scopes, [scope]);
        assert.equal(request.account, account);
        return { accessToken: 'api-token' };
    } }, scope, account);
    assert.equal(headers.Authorization, 'Bearer api-token');
    assert.throws(() => settlementScope('User.Read'));
    assert.throws(() => settlementScope(''));
});

test('consent uses popup only for interaction-required errors', async () => {
    const instance = {
        acquireTokenSilent: async () => { throw { errorCode: 'consent_required' }; },
        acquireTokenPopup: async request => { assert.deepEqual(request.scopes, [scope]); return { accessToken: 'consented' }; }
    };
    assert.equal((await getSettlementHeaders(instance, scope, {})).Authorization, 'Bearer consented');
    await assert.rejects(() => getSettlementHeaders(instance, scope, null));
    instance.acquireTokenSilent = async () => { throw new Error('network unavailable'); };
    await assert.rejects(() => getSettlementHeaders(instance, scope, {}), /network unavailable/);
});