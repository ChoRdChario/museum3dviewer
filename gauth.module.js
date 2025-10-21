// gauth.module.js — GIS auth helper (ESM, no UI injection)
// Exposes: setupAuth, ensureToken, getAccessToken, getLastAuthError, signIn, bindSignInButton, onToken

let _gisLoaded = false;
let _gisLoading = null;
let _tokenClient = null;
let _lastError = null;
let _accessToken = null;
let _scopes = 'https://www.googleapis.com/auth/spreadsheets';

function readClientIdFromMeta() {
  const meta = document.querySelector("meta[name='google-signin-client_id']");
  return meta?.content?.trim() || '';
}
function readClientIdFromConfigScript() {
  const el = document.getElementById('locimyu-config');
  if (!el) return '';
  try {
    const json = JSON.parse(el.textContent || '{}');
    return (json.client_id || json.clientId || '').trim();
  } catch { return ''; }
}
function getClientId() {
  return (window.__LM_CLIENT_ID?.trim?.() || readClientIdFromMeta() || readClientIdFromConfigScript() || '');
}

function ensureWindowStore() {
  if (!window.__LM_OAUTH) window.__LM_OAUTH = {};
  return window.__LM_OAUTH;
}

function loadGIS() {
  if (_gisLoaded) return Promise.resolve();
  if (_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[src^='https://accounts.google.com/gsi/client']");
    if (existing) {
      existing.addEventListener('load', () => { _gisLoaded = true; resolve(); }, {once:true});
      existing.addEventListener('error', e => reject(e), {once:true});
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => { _gisLoaded = true; resolve(); };
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
  return _gisLoading;
}

export async function setupAuth(scopes = _scopes) {
  _scopes = scopes || _scopes;
  ensureWindowStore();
  const client_id = getClientId();
  if (!client_id) {
    console.warn('[gauth] client_id not found at load; waiting for runtime setup');
    return false;
  }
  await loadGIS();
  // eslint-disable-next-line no-undef
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id,
    scope: _scopes,
    callback: (resp) => {
      if (resp && resp.access_token) {
        _accessToken = resp.access_token;
        window.__LM_OAUTH.access_token = _accessToken;
        window.dispatchEvent(new CustomEvent('gauth:token', { detail: { access_token: _accessToken } }));
      } else if (resp && resp.error) {
        _lastError = resp.error;
        window.dispatchEvent(new CustomEvent('gauth:error', { detail: resp }));
      }
    },
  });
  return true;
}

export async function ensureToken(interactive = false) {
  await setupAuth();
  if (!_tokenClient) {
    throw new Error('[gauth] tokenClient not ready (no client_id?)');
  }
  _lastError = null;
  return new Promise((resolve, reject) => {
    const onToken = (e) => { cleanup(); resolve(e.detail.access_token); };
    const onErr = (e) => { cleanup(); reject(e.detail || new Error('gauth error')); };
    const cleanup = () => {
      window.removeEventListener('gauth:token', onToken);
      window.removeEventListener('gauth:error', onErr);
    };
    window.addEventListener('gauth:token', onToken, { once: true });
    window.addEventListener('gauth:error', onErr, { once: true });
    try {
      // eslint-disable-next-line no-undef
      _tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

export async function signIn() {
  // Backward-compat wrapper expected by boot.esm.cdn.js
  return ensureToken(true);
}

export function getAccessToken() {
  return _accessToken || window.__LM_OAUTH?.access_token || null;
}

export function getLastAuthError() {
  return _lastError;
}

export function onToken() {
  if (getAccessToken()) return Promise.resolve(getAccessToken());
  return new Promise((resolve) => {
    const h = (e) => {
      window.removeEventListener('gauth:token', h);
      resolve(e.detail.access_token);
    };
    window.addEventListener('gauth:token', h, { once: true });
  });
}

export function bindSignInButton(selectorList = ['#signin','[data-role=\"signin\"]','.g-signin','#google-signin']) {
  const selector = Array.isArray(selectorList) ? selectorList.join(',') : String(selectorList || '');
  if (!selector) return false;
  const btn = document.querySelector(selector);
  if (!btn) { console.warn('[gauth] sign-in button not found'); return false; }
  if (btn.__lm_bound) return true;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await ensureToken(true); } catch (err) { console.warn('[gauth] sign-in failed', err); }
  });
  btn.__lm_bound = true;
  return true;
}

// For consumers that expect a default export (harmless)
export default {
  setupAuth, ensureToken, signIn, getAccessToken, getLastAuthError, bindSignInButton, onToken,
};
