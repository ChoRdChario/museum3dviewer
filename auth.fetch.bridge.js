
// auth.fetch.bridge.js
// Single source of truth: window.__lm_fetchJSONAuth
// Dynamically imports gauth.module.js and exposes a fetch wrapper with Bearer token.
// Usage: import('./auth.fetch.bridge.js').then(m=>m.default()).then(fetchAuth=>fetchAuth(url, opts))

import './persist.guard.js';
const READY_EVENT = "lm:auth-bridge-ready";

async function getToken() {
  // Lazy import to avoid hard dependency order
  const g = await import('./gauth.module.js');
  if (typeof g.getAccessToken !== 'function') {
    throw new Error('[auth.bridge] getAccessToken not found');
  }
  const tok = await g.getAccessToken();
  if (!tok) throw new Error('[auth.bridge] token missing');
  return tok;
}

function installFetchOnce() {
  if (window.__lm_fetchJSONAuth) return window.__lm_fetchJSONAuth;

  async function __lm_fetchJSONAuth(url, { method='GET', headers={}, body, json, rawResponse=false } = {}){
    // view mode: block all persistence writes centrally
    window.__lm_persistGuard?.assertAllowed(method, url);
    const token = await getToken();
    const h = new Headers(headers || {});
    h.set('Authorization', `Bearer ${token}`);
    if (!rawResponse) h.set('Accept', 'application/json');

    let payload = body;
    if (json !== undefined) {
      h.set('Content-Type', 'application/json');
      payload = JSON.stringify(json);
    }
    const res = await fetch(url, { method, headers: h, body: payload });
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status}  :: ${text}`);
    }
    return rawResponse ? res : res.json();
  }

  window.__lm_fetchJSONAuth = __lm_fetchJSONAuth;
  // fire a ready event for listeners
  document.dispatchEvent(new CustomEvent(READY_EVENT));
  console.log('[auth.bridge] ready');
  return window.__lm_fetchJSONAuth;
}

export default function ensureAuthBridge(){
  return installFetchOnce();
}