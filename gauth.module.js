
// gauth.module.js — GIS auth helper (runtime client_id injectable)
// Public API (named exports):
//   setupAuth(), getAccessToken(), ensureToken(), getLastAuthError(), signIn(), signOut(), onAuthState()
// Side-channel (no HTML edits required):
//   window.__LM_auth.setupClientId('<YOUR_WEB_CLIENT_ID>')  // will init + silent request
//
// This file is designed to avoid hard failures when client_id is missing at load time.
// It defers initialization until a client_id is provided via:
//   1) window.__LM_CLIENT_ID
//   2) <meta name="google-signin-client_id" content="...">
//   3) runtime: window.__LM_auth.setupClientId('...')
//   4) runtime event: window.dispatchEvent(new CustomEvent('materials:clientId', {detail:{client_id:'...'}}))
//
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const STORAGE_KEY = '__LM_TOK';
const SKEW_SEC = 60;

let _googleLoaded = false;
let _gisLoading = null;
let _tokenClient = null;
let _lastError = null;
let _clientId = null;

function _nowSec() { return Math.floor(Date.now() / 1000); }

function _readClientIdFromDOM() {
  if (typeof window !== 'undefined' && window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
  const meta = document.querySelector('meta[name="google-signin-client_id"]');
  if (meta && meta.content) return meta.content.trim();
  return null;
}

function _loadGIS() {
  if (_googleLoaded) return Promise.resolve();
  if (_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => { _googleLoaded = true; resolve(); };
    s.onerror = (e) => reject(new Error('[gauth] failed to load GIS script'));
    document.head.appendChild(s);
  });
  return _gisLoading;
}

function _saveToken(tok) {
  try {
    const expSec = _nowSec() + (tok.expires_in ? Number(tok.expires_in) : 3600);
    const data = { access_token: tok.access_token, expires_at: expSec };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function _getStoredToken() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.access_token) return null;
    if ((_nowSec() + SKEW_SEC) >= (obj.expires_at || 0)) return null;
    return obj;
  } catch { return null; }
}

function _initTokenClient() {
  if (!_clientId) _clientId = _readClientIdFromDOM();
  if (!_clientId) throw new Error("[gauth] client_id not set (window.__LM_CLIENT_ID or <meta name='google-signin-client_id'> or __LM_auth.setupClientId())");
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: _clientId,
    scope: SCOPE,
    callback: (resp) => {
      if (resp && resp.access_token) {
        _lastError = null;
        _saveToken(resp);
        _dispatchAuthState(true);
      } else if (resp && resp.error) {
        _lastError = resp.error;
        _dispatchAuthState(false);
      }
    }
  });
  return _tokenClient;
}

function _dispatchAuthState(authed) {
  try {
    window.dispatchEvent(new CustomEvent('materials:auth', { detail: { authed } }));
  } catch {}
}

export async function setupAuth() {
  // Non-fatal if client id missing: we attach listeners and exit gracefully.
  try {
    await _loadGIS();
  } catch (e) {
    _lastError = e;
    console.warn('[gauth] GIS load failed', e);
    return;
  }
  _clientId = _readClientIdFromDOM();
  if (_clientId) {
    try {
      _initTokenClient();
      // try silent
      await ensureToken({ prompt: '' });
    } catch (e) {
      // do not throw; allow late client id injection
      _lastError = e;
      console.warn('[gauth] init/silent err (non-fatal)', e);
    }
  } else {
    console.warn('[gauth] client_id not found at load; waiting for runtime setup');
  }

  // react to runtime clientId via event
  window.addEventListener('materials:clientId', (ev) => {
    const id = ev?.detail?.client_id;
    if (!id) return;
    __LM_auth.setupClientId(id);
  });
}

export function getLastAuthError() { return _lastError; }

export async function getAccessToken() {
  const alive = _getStoredToken();
  if (alive) return alive.access_token;
  await ensureToken({ prompt: '' });
  const after = _getStoredToken();
  return after ? after.access_token : null;
}

export async function ensureToken(opts = {}) {
  await _loadGIS();
  if (!_tokenClient) _initTokenClient();
  const alive = _getStoredToken();
  if (alive) return alive.access_token;
  return new Promise((resolve, reject) => {
    try {
      _tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          _saveToken(resp);
          _lastError = null;
          _dispatchAuthState(true);
          resolve(resp.access_token);
        } else {
          _lastError = resp?.error || 'unknown_error';
          _dispatchAuthState(false);
          reject(new Error(_lastError));
        }
      };
      _tokenClient.requestAccessToken({ prompt: opts.prompt ?? '' });
    } catch (e) {
      _lastError = e;
      reject(e);
    }
  });
}

export async function signIn() {
  await _loadGIS();
  if (!_tokenClient) _initTokenClient();
  return ensureToken({ prompt: 'consent' });
}

export function signOut() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  _dispatchAuthState(false);
}

// optional: listenable auth state
let _authListeners = new Set();
export function onAuthState(cb) {
  if (typeof cb === 'function') {
    _authListeners.add(cb);
    // immediate ping
    const alive = !!_getStoredToken();
    try { cb(alive); } catch {}
  }
  return () => _authListeners.delete(cb);
}

// bridge DOM event -> listeners
window.addEventListener('materials:auth', (e) => {
  const authed = !!e?.detail?.authed;
  _authListeners.forEach(fn => { try { fn(authed); } catch {} });
});

// ---- runtime helper to avoid HTML edits ----
function setupClientId(id) {
  if (!id || typeof id !== 'string') {
    console.warn('[gauth] setupClientId: invalid id'); return;
  }
  _clientId = id;
  if (!_googleLoaded) {
    _loadGIS().then(() => {
      try { _initTokenClient(); ensureToken({ prompt: '' }); } catch (e) { console.warn(e); }
    });
  } else {
    try { _initTokenClient(); ensureToken({ prompt: '' }); } catch (e) { console.warn(e); }
  }
}

window.__LM_auth = Object.assign(window.__LM_auth || {}, {
  setupClientId,
  signIn,
  signOut,
  getAccessToken,
  ensureToken,
  getLastAuthError,
});

export default {
  setupAuth,
  getAccessToken,
  ensureToken,
  getLastAuthError,
  signIn,
  signOut,
  onAuthState,
};
