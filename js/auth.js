// OAuth 2.0 "authorization code" + PKCE, entirely in the browser.
// The refresh token is kept in the screen's localStorage: after the first
// sign-in, access tokens are renewed without any interaction.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

const REFRESH_TOKEN_KEY = 'pooya-calendar.refresh-token';
const PENDING_LOGIN_KEY = 'pooya-calendar.pending-login';
const EXPIRY_MARGIN_MS = 60_000;

export class AuthError extends Error {
  // reason: disconnected | expired | denied | scope | config | insecure | failed
  constructor(reason) {
    super(`Google authentication: ${reason}`);
    this.name = 'AuthError';
    this.reason = reason;
  }
}

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable (private browsing) */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* same */ }
  },
};

function base64Url(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// Must match one of the OAuth client's "Authorized redirect URIs" exactly.
function defaultRedirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function createAuth({ clientId, clientSecret, redirectUri = defaultRedirectUri() }) {
  let accessToken = null;
  let expiresAt = 0;
  let refreshing = null;

  function keepAccessToken(data) {
    accessToken = data.access_token;
    expiresAt = Date.now() + data.expires_in * 1000;
  }

  async function requestToken(fields) {
    // Google requires the client_secret for a "Web application" client, even with PKCE.
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (data.error === 'invalid_grant') throw new AuthError('expired');
    if (data.error === 'invalid_client' || data.error === 'unauthorized_client') throw new AuthError('config');
    throw new Error(`Token exchange refused (${response.status} ${data.error ?? ''})`.trim());
  }

  async function refresh() {
    const refreshToken = storage.get(REFRESH_TOKEN_KEY);
    if (!refreshToken) throw new AuthError('disconnected');
    try {
      keepAccessToken(await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken }));
      return accessToken;
    } catch (error) {
      if (error instanceof AuthError && error.reason === 'expired') storage.remove(REFRESH_TOKEN_KEY);
      throw error;
    }
  }

  return {
    isConnected() {
      return Boolean(storage.get(REFRESH_TOKEN_KEY));
    },

    async login() {
      if (!globalThis.crypto?.subtle) throw new AuthError('insecure');
      const verifier = randomString(48);
      const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const state = randomString(16);
      sessionStorage.setItem(PENDING_LOGIN_KEY, JSON.stringify({ verifier, state }));

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      });
      location.assign(`${AUTH_ENDPOINT}?${params}`);
    },

    // Finishes the sign-in when Google redirects back. Returns false if the URL holds no OAuth response.
    async completeLogin() {
      const params = new URLSearchParams(location.search);
      if (!params.has('code') && !params.has('error')) return false;

      const pending = JSON.parse(sessionStorage.getItem(PENDING_LOGIN_KEY) ?? 'null');
      sessionStorage.removeItem(PENDING_LOGIN_KEY);
      history.replaceState(null, '', redirectUri);

      if (params.has('error')) throw new AuthError(params.get('error') === 'access_denied' ? 'denied' : 'failed');
      if (!pending || pending.state !== params.get('state')) throw new AuthError('failed');

      let data;
      try {
        data = await requestToken({
          grant_type: 'authorization_code',
          code: params.get('code'),
          code_verifier: pending.verifier,
          redirect_uri: redirectUri,
        });
      } catch (error) {
        // Here invalid_grant means a reused or stale code, not an expired connection.
        if (error instanceof AuthError && error.reason === 'expired') throw new AuthError('failed');
        throw error;
      }
      if (!data.scope?.split(' ').includes(SCOPE)) throw new AuthError('scope');
      if (!data.refresh_token) throw new AuthError('failed');

      storage.set(REFRESH_TOKEN_KEY, data.refresh_token);
      keepAccessToken(data);
      return true;
    },

    async getAccessToken() {
      if (accessToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS) return accessToken;
      refreshing ??= refresh().finally(() => { refreshing = null; });
      return refreshing;
    },

    invalidateAccessToken() {
      accessToken = null;
    },

    async logout() {
      const refreshToken = storage.get(REFRESH_TOKEN_KEY);
      storage.remove(REFRESH_TOKEN_KEY);
      accessToken = null;
      if (!refreshToken) return;
      try {
        await fetch(REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        });
      } catch { /* offline: the local token is removed anyway */ }
    },
  };
}
