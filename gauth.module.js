/* gauth.module.js — full module (named exports) */
/* Minimal GIS-based token helper for Google Sheets REST (fetch direct)
   - No auto popups on page load
   - Keeps token in sessionStorage.__LM_TOK
   - Exports:
       getAccessToken, getLastAuthError, ensureToken, signIn, signOut,
       onAuthState, getClient, loadGIS
*/

const TOK_KEY = '__LM_TOK';
let _tokenClient = null;
let _lastError = null;
let _listeners = new Set();
let _inflight = null;

/** Notify subscribers */
function _emit() {
  for (const fn of _listeners) {
    try { fn(getAccessToken()); } catch {}
  }
}

/** Read client_id from window or <meta> */
function _getClientId() {
  if (window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
  if (window.__LM_OAUTH?.client_id) return window.__LM_OAUTH.client_id;
  const meta = document.querySelector('meta[name="google-signin-client_id"]');
  if (meta?.content) return meta.content.trim();
  return null;
}

/** Persist & read tokens */
function _loadSaved() {
  try {
    const raw = sessionStorage.getItem(TOK_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.access_token) return null;
    return obj;
  } catch { return null; }
}
function _save(tok) {
  if (tok) {
    sessionStorage.setItem(TOK_KEY, JSON.stringify(tok));
  } else {
    sessionStorage.removeItem(TOK_KEY);
  }
  _emit();
}

/** Check expiry (allow small clock skew) */
function _isExpired(tok) {
  if (!tok?.access_token) return true;
  const now = Date.now();
  const exp = Number(tok.expires_at || 0);
  // If expires_at missing, treat as not expired for safety (some flows don't provide it).
  if (!exp) return false;
  return now >= (exp - 10_000); // 10s skew
}

/** Load GIS script once */
export async function loadGIS() {
  if (window.google?.accounts?.oauth2) return;
  await new Promise((resolve, reject) => {
    const id = 'gis-sdk';
    if (document.getElementById(id)) {
      // If script tag exists, wait a tick
      return setTimeout(resolve, 0);
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load GIS client'));
    document.head.appendChild(s);
  });
}

/** Create or return the GIS token client */
export async function getClient(scopes = 'https://www.googleapis.com/auth/spreadsheets') {
  await loadGIS();
  const client_id = _getClientId();
  if (!client_id) {
    _lastError = 'Missing Google OAuth client_id. Set window.__LM_CLIENT_ID or <meta name="google-signin-client_id">.';
    throw new Error(_lastError);
  }
  if (_tokenClient) return _tokenClient;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id,
    scope: scopes,
    callback: (resp) => {
      if (resp?.error) {
        _lastError = resp.error;
        return;
      }
      if (resp?.access_token) {
        // expires_in seconds → expires_at ms
        const now = Date.now();
        const expires_at = resp.expires_in ? now + Number(resp.expires_in) * 1000 : 0;
        _save({ access_token: resp.access_token, expires_at });
        _lastError = null;
      }
    }
  });
  return _tokenClient;
}

/** Ensure a valid token exists; interactive=false won't popup */
export async function ensureToken({ interactive = false, scopes = 'https://www.googleapis.com/auth/spreadsheets' } = {}) {
  // Coalesce concurrent calls
  if (_inflight) { return _inflight; }
  _inflight = (async () => {
    // 1) Prefer already-saved token
    let tok = _loadSaved();
    if (!tok?.access_token && window.__LM_OAUTH?.access_token) {
      // Allow host page to pre-inject
      tok = { access_token: window.__LM_OAUTH.access_token, expires_at: window.__LM_OAUTH.expires_at || 0 };
      _save(tok);
    }
    if (tok && !_isExpired(tok)) return tok;

    // 2) Try silent refresh via GIS
    const client = await getClient(scopes);
    await new Promise((resolve) => {
      try {
        client.requestAccessToken({ prompt: '' });
        // callback will store token; wait a short time
        setTimeout(resolve, 50);
      } catch (e) {
        _lastError = String(e?.message || e);
        resolve();
      }
    });
    tok = _loadSaved();
    if (tok && !_isExpired(tok)) return tok;

    // 3) If still missing/expired and interactive allowed, show consent
    if (interactive) {
      await new Promise((resolve) => {
        try {
          client.requestAccessToken({ prompt: 'consent' });
          setTimeout(resolve, 50);
        } catch (e) {
          _lastError = String(e?.message || e);
          resolve();
        }
      });
      tok = _loadSaved();
      if (tok && !_isExpired(tok)) return tok;
    }

    // 4) Failed
    return null;
  })();
  try {
    const r = await _inflight;
    return r;
  } finally {
    _inflight = null;
  }
}

/** Return access_token string or null (no popup) */
export function getAccessToken() {
  const tok = _loadSaved();
  if (tok && !_isExpired(tok)) return tok.access_token;
  return null;
}

/** Return last auth error message (string|null) */
export function getLastAuthError() {
  return _lastError;
}

/** Force interactive sign-in (may show consent) */
export async function signIn(scopes = 'https://www.googleapis.com/auth/spreadsheets') {
  const tok = await ensureToken({ interactive: true, scopes });
  return !!(tok && tok.access_token);
}

/** Revoke & clear token */
export async function signOut() {
  const tok = _loadSaved();
  _save(null);
  try {
    if (window.google?.accounts?.oauth2?.revoke && tok?.access_token) {
      await new Promise((resolve) => {
        window.google.accounts.oauth2.revoke(tok.access_token, () => resolve());
      });
    }
  } catch {}
  _lastError = null;
  return true;
}

/** Subscribe to token changes. Returns unsubscribe fn. */
export function onAuthState(fn) {
  if (typeof fn === 'function') {
    _listeners.add(fn);
    // Emit current once
    try { fn(getAccessToken()); } catch {}
    return () => _listeners.delete(fn);
  }
  return () => {};
}

// Expose for debugging (optional)
if (!window.__LM_AUTH_DEBUG__) {
  window.__LM_AUTH_DEBUG__ = {
    getAccessToken, getLastAuthError, ensureToken, signIn, signOut, onAuthState, getClient, loadGIS
  };
}
