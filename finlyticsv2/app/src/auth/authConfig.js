import { PublicClientApplication } from "@azure/msal-browser";

export const msalConfig = {
    auth: {
        clientId: "c5c042d4-48e3-4e28-ba5f-b9b01e82aa41",
        authority: "https://login.microsoftonline.com/11016236-4dbc-43a6-8310-be803173fc43",
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
        navigateToLoginRequestUrl: false
    },
    cache: {
        cacheLocation: "localStorage",
        storeAuthStateInCookie: true
    },
    system: {
        allowRedirectInIframe: false,
        tokenRenewalOffsetSeconds: 300  // Refresh token 5 min before expiry
    }
};

export const loginRequest = {
    scopes: [
        "User.Read",
        "openid",
        "profile",
        "email"
    ]
};

export const sharePointRequest = {
    scopes: ["https://kempy.sharepoint.com/AllSites.FullControl"]
};

export const msalInstance = new PublicClientApplication(msalConfig);

