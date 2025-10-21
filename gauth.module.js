
// gauth.module.js — GIS token-only auth (no UI). Full file.
// Exports: setupAuth, ensureToken, signIn, getAccessToken, getLastAuthError
// This module DOES NOT render any Google sign-in button.

let _client = null;
let _accessToken = null;
let _lastErr = null;
let _initStarted = false;

const _log = (...a)=>console.log('[gauth]', ...a);
const _warn = (...a)=>console.warn('[gauth]', ...a);

/** Resolve client_id from (1) meta, (2) window.__LM_CLIENT_ID, (3) JSON config tag */
function _resolveClientId() {
  try {
    // 1) meta
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) return meta.content.trim();
  } catch {}
  try {
    // 2) global
    if (typeof window !== 'undefined' && window.__LM_CLIENT_ID) {
      return String(window.__LM_CLIENT_ID).trim();
    }
  } catch {}
  try {
    // 3) JSON config
    const cfg = document.getElementById('locimyu-config');
    if (cfg && cfg.textContent) {
      const j = JSON.parse(cfg.textContent);
      if (j && j.client_id) return String(j.client_id).trim();
    }
  } catch {}
  return null;
}

function _ensureGISLoaded() {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2?.initTokenClient) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
}

/** Initialize token client if possible. Safe to call multiple times. */
export async function setupAuth() {
  if (_client) return _client;
  if (_initStarted) return _client;
  _initStarted = true;

  await _ensureGISLoaded();
  const clientId = _resolveClientId();
  if (!clientId) {
    _warn('client_id not found at load; waiting for runtime setup');
    _initStarted = false;
    return null;
  }

  try {
    _client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      callback: (r) => {
        if (r && r.access_token) {
          _accessToken = r.access_token;
          _lastErr = null;
          _log('token granted');
        }
      }
    });
    _log('token client ready');
    return _client;
  } catch (e) {
    _lastErr = e;
    _warn('init fail', e);
    _client = null;
    _initStarted = false;
    return null;
  }
}

/** Return access token if we already have it */
export function getAccessToken() { return _accessToken || null; }
export function getLastAuthError() { return _lastErr || null; }

/** Ensure a token silently first; fall back to interactive prompt */
export async function ensureToken() {
  if (!_client) await setupAuth();
  if (!_client) throw new Error('[gauth] tokenClient not ready (no client_id?)');

  return new Promise((resolve, reject) => {
    try {
      _client.callback = (r) => {
        if (r && r.access_token) {
          _accessToken = r.access_token;
          _lastErr = null;
          resolve(r.access_token);
        } else {
          reject(new Error('[gauth] empty token response'));
        }
      };
      // Try silent first
      _client.requestAccessToken({ prompt: '' });
      // If silent fails, callback will not fire; set a timeout to retry interactively
      setTimeout(() => {
        if (!_accessToken) {
          _client.requestAccessToken({ prompt: 'consent' });
        }
      }, 500);
    } catch (e) {
      _lastErr = e;
      reject(e);
    }
  });
}

/** Explicit sign-in (interactive). */
export async function signIn() {
  if (!_client) await setupAuth();
  if (!_client) throw new Error('[gauth] tokenClient not ready (no client_id?)');
  return new Promise((resolve, reject) => {
    try {
      _client.callback = (r) => {
        if (r && r.access_token) {
          _accessToken = r.access_token;
          _lastErr = null;
          resolve(r.access_token);
        } else {
          reject(new Error('[gauth] empty token response'));
        }
      };
      _client.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      _lastErr = e;
      reject(e);
    }
  });
}
