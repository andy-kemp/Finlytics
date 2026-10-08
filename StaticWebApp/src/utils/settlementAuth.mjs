export function settlementScope(value) {
    const scope = String(value || '').trim();
    if (!/^api:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/Settlement\.Write$/i.test(scope)) {
        throw new Error('Configure the Finlytics API Settlement.Write scope before confirming bank settlements.');
    }
    return scope;
}

export async function getSettlementHeaders(instance, scope, account) {
    const verifiedScope = settlementScope(scope);
    if (!account) throw new Error('Sign in before confirming bank settlements.');
    const request = { scopes: [verifiedScope], account };
    let response;
    try {
        response = await instance.acquireTokenSilent(request);
    } catch (error) {
        if (error.name !== 'InteractionRequiredAuthError' && !['interaction_required', 'consent_required', 'login_required'].includes(error.errorCode)) throw error;
        response = await instance.acquireTokenPopup(request);
    }
    if (!response.accessToken) throw new Error('Settlement access token was not returned.');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${response.accessToken}` };
}