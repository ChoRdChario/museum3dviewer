// gauth.module.js — GIS-only auth helper (no extra UI)
// Reads client_id from: window.__LM_CLIENT_ID or <meta name="google-signin-client_id"> or #locimyu-config script JSON.
// Exports: setupAuth, ensureToken, getAccessToken, getLastAuthError, onToken
// No DOM injection; you wire your own button and call setupAuth/ensureToken.

let _tokenClient = null;
let _accessToken = null;
let _lastErr = null;
let _scopes = 'https://www.googleapis.com/auth/spreadsheets';

function _readClientId() {
  try {
    if (window.__LM_CLIENT_ID && typeof window.__LM_CLIENT_ID === 'string') return window.__LM_CLIENT_ID;
    const m = document.querySelector("meta[name='google-signin-client_id']");
    if (m && m.content) return m.content.trim();
    // Fallback: inline JSON config (e.g., <script id="locimyu-config" type="application/json">)
    const cfgEl = document.getElementById('locimyu-config');
    if (cfgEl) {
      const json = JSON.parse(cfgEl.textContent || '{}');
      if (json.client_id) return String(json.client_id);
      if (json.gisClientId) return String(json.gisClientId);
    }
  } catch(e) {}
  return null;
}

function _ensureGisLoaded() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      return resolve();
    }
    // Lazy inject if missing
    const id = 'gis-sdk';
    if (document.getElementById(id)) {
      // wait for load event on existing
      const el = document.getElementById(id);
      el.addEventListener('load', () => resolve(), { once:true });
      el.addEventListener('error', () => reject(new Error('[gauth] GIS script failed to load')), { once:true });
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('[gauth] GIS script failed to load'));
    document.head.appendChild(s);
  });
}

export async function setupAuth(scopes=_scopes) {
  _scopes = scopes || _scopes;
  await _ensureGisLoaded();
  const client_id = _readClientId();
  if (!client_id) {
    console.warn('[gauth] client_id not found at load; waiting for runtime setup');
    throw new Error('[gauth] client_id not set');
  }
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id,
    scope: _scopes,
    prompt: '', // silent by default
    callback: (resp) => {
      if (resp && resp.access_token) {
        _accessToken = resp.access_token;
        _lastErr = null;
        window.dispatchEvent(new CustomEvent('gauth:token', { detail: { access_token: _accessToken } }));
      } else if (resp && resp.error) {
        _lastErr = resp;
        console.warn('[gauth] token error', resp);
      }
    }
  });
  window.dispatchEvent(new CustomEvent('gauth:ready', { detail: { client_id } }));
  return true;
}

export async function ensureToken(interactive=false) {
  if (!_tokenClient) await setupAuth(_scopes).catch(()=>{});
  if (!_tokenClient) throw new Error('[gauth] tokenClient not ready');
  return new Promise((resolve, reject) => {
    try {
      _tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      // Wait for callback to populate; also put a timeout fallback
      const t0 = Date.now();
      (function wait() {
        if (_accessToken) return resolve(_accessToken);
        if (Date.now() - t0 > 8000) return reject(_lastErr || new Error('[gauth] timeout acquiring token'));
        requestAnimationFrame(wait);
      })();
    } catch(e) {
      _lastErr = e;
      reject(e);
    }
  });
}

export function getAccessToken() {
  return _accessToken;
}

export function getLastAuthError() {
  return _lastErr;
}

// Utility: bind a button to interactive sign-in
export function bindSignInButton(selector) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!el) return false;
  el.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      await setupAuth();
      await ensureToken(true);
    } catch(e) {
      console.warn('[gauth] interactive sign-in failed', e);
    }
  }, { passive:false });
  return true;
}

// For modules that want a promise
export function onToken() {
  if (_accessToken) return Promise.resolve(_accessToken);
  return new Promise(resolve => {
    const fn = (e) => { window.removeEventListener('gauth:token', fn); resolve(e.detail.access_token); };
    window.addEventListener('gauth:token', fn);
  });
}
