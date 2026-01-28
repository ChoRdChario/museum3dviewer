/*!
 * boot.share.cdn.js — Share-mode minimal auth boot
 *
 * Policy: Share safety is guaranteed by *not loading* write-capable modules.
 * This file only wires Sign-in and provides a cached access token getter.
 *
 * Scopes are READONLY.
 */

const LOG = (...a)=>console.log(...a);
const ERR = (...a)=>console.error(...a);

// READONLY scopes for Share Mode.
window.LM_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

function pickClientIdFromDOM(){
  try{
    const u = new URL(location.href);
    const fromUrl = u.searchParams.get("lm_client_id") || u.searchParams.get("client_id");
    if (fromUrl && fromUrl.trim()) {
      localStorage.setItem("LM_GIS_CLIENT_ID", fromUrl.trim());
      return fromUrl.trim();
    }
  }catch(_e){}

  const btn = document.querySelector("#auth-signin");
  if (btn && btn.dataset && btn.dataset.clientId && btn.dataset.clientId.trim()){
    const v = btn.dataset.clientId.trim();
    localStorage.setItem("LM_GIS_CLIENT_ID", v);
    return v;
  }

  const ls = localStorage.getItem("LM_GIS_CLIENT_ID");
  if (ls && ls.trim()) return ls.trim();

  if (typeof window.GIS_CLIENT_ID === "string" && window.GIS_CLIENT_ID.trim()) return window.GIS_CLIENT_ID.trim();
  if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID.trim()) return window.__LM_CLIENT_ID.trim();

  const m = document.querySelector('meta[name="google-signin-client_id"]');
  if (m && m.content && m.content.trim()) return m.content.trim();

  const mo = document.querySelector('meta[name="google-oauth-client_id"]');
  if (mo && mo.content && mo.content.trim()) return mo.content.trim();

  return null;
}
window.__LM_DEBUG = Object.assign(window.__LM_DEBUG||{}, { pickClientIdFromDOM_Share: pickClientIdFromDOM });

let _gisLoading=null, _gisReady=false;
async function loadGISOnce(){
  if (_gisReady) return;
  if (_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve,reject)=>{
    if (window.google && window.google.accounts && window.google.accounts.oauth2){
      _gisReady = true; resolve(); return;
    }
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";
    s.async=true; s.defer=true;
    s.onload=()=>{ _gisReady=true; resolve(); };
    s.onerror=(e)=>{ reject(e); };
    document.head.appendChild(s);
  });
  return _gisLoading;
}

// --- OAuth state (CSRF mitigation) ---
// NOTE: token responses may or may not echo back `state`; we validate only when provided.
const _OAUTH_STATE_KEY = "lm_oauth_state_share";
function _makeOAuthState(len = 18) {
  try {
    const b = new Uint8Array(len);
    crypto.getRandomValues(b);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    // base64url (no padding)
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch (e) {
    // Fallback (not cryptographically strong, but better than nothing)
    return String(Math.random()).slice(2) + String(Date.now());
  }
}
function _issueOAuthState() {
  const st = _makeOAuthState();
  try { sessionStorage.setItem(_OAUTH_STATE_KEY, st); } catch (e) {}
  return st;
}
function _consumeOAuthState() {
  try {
    const st = sessionStorage.getItem(_OAUTH_STATE_KEY);
    sessionStorage.removeItem(_OAUTH_STATE_KEY);
    return st;
  } catch (e) { return null; }
}
// --- end OAuth state ---

let _tokClient=null, _tokInflight=null, _tokCache=null, _tokCacheExp=0;
let _pendingResolve=null, _pendingReject=null;

async function __lm_getAccessToken(){
  const now = Date.now();
  if (_tokCache && now < _tokCacheExp - 10_000) return _tokCache;

  await loadGISOnce();
  const clientId = pickClientIdFromDOM();
  if (!clientId) throw new Error("[auth/share] client_id not found. Provide meta[name='google-oauth-client_id'] or ?lm_client_id=...");

  if (!_tokClient){
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2){
      throw new Error("[auth/share] GIS not ready");
    }
    const oauthState = _issueOAuthState();
    _tokClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: (window.LM_SCOPES||[]).join(" "),
      state: oauthState,
      callback: (resp)=>{
        if (resp && resp.error){
          ERR("[auth/share] token error", resp);
          if (_pendingReject) _pendingReject(resp);
          _pendingResolve = _pendingReject = null;
          _tokInflight=null;
          window.dispatchEvent(new CustomEvent("lm:signin-error", { detail:{ error:resp, mode:"share" } }));
          return;
        }
        _tokCache = resp.access_token;
        // Keep conservative cache (Share sessions are lightweight)
        _tokCacheExp = Date.now() + 50*60*1000;
        if (_pendingResolve) _pendingResolve(resp.access_token);
        _pendingResolve = _pendingReject = null;
        window.dispatchEvent(new CustomEvent("lm:signin-ok", { detail:{ ok:true, mode:"share" } }));
      }
    });
  }

  if (_tokInflight) return _tokInflight;
  _tokInflight = new Promise((resolve, reject)=>{
    _pendingResolve = resolve; _pendingReject = reject;
    try{ _tokClient.requestAccessToken({ prompt: "" }); }
    catch(e){ _tokInflight=null; reject(e); }
  }).finally(()=>{ _tokInflight=null; });
  return _tokInflight;
}

window.__lm_getAccessToken = __lm_getAccessToken;

// Wire #auth-signin button (Share).
(function autoWireAuthButton(){
  const btn = document.querySelector("#auth-signin");
  if (!btn) return;
  if (btn.dataset && btn.dataset.lmAuthWiredShare) return;
  btn.dataset.lmAuthWiredShare = "1";
  btn.addEventListener("click", async (ev)=>{
    ev.preventDefault();
    try{
      await __lm_getAccessToken();
      LOG("[auth/share] signin ok (button)");
    }catch(e){
      ERR("[auth/share] signin failed", e);
      ERR("[auth/share] Provide client_id via meta[name='google-oauth-client_id'] or ?lm_client_id=... or localStorage.LM_GIS_CLIENT_ID");
    }
  }, { passive:false });
})();


// --- Authenticated fetch helpers (Share: GET-only) ---------------------------
window.__lm_fetchAuth = async function __lm_fetchAuth(url, init){
  init = init || {};
  const method = String(init.method || 'GET').toUpperCase();
  const SAFE = (method === 'GET' || method === 'HEAD' || method === 'OPTIONS');
  if (!SAFE){
    const e = new Error('[share] blocked non-GET in __lm_fetchAuth: ' + method);
    e.code = 'LM_SHARE_BLOCK';
    throw e;
  }
  const token = await window.__lm_getAccessToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, Object.assign({}, init, { method, headers }));
};

window.__lm_fetchJSONAuth = async function __lm_fetchJSONAuth(url, init){
  const res = await window.__lm_fetchAuth(url, init);
  const text = await res.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch(_e){ data = null; }
  if (!res.ok){
    const e = new Error('[share] HTTP ' + res.status + ' for ' + url);
    e.status = res.status;
    e.body = text;
    e.data = data;
    throw e;
  }
  return data;
};
// ---------------------------------------------------------------------------

// --- No-op persistence stubs (Share: never writes) --------------------------
// Some legacy orchestrators call persistence modules opportunistically.
// In Share we provide minimal stubs so UI interactions remain smooth.
if (!window.LM_MaterialsPersist) {
  window.LM_MaterialsPersist = {
    upsert: async function(){ return { skipped:true, mode:'share' }; },
    ensureHeaders: async function(){ return { skipped:true, mode:'share' }; },
    flush: async function(){ return { skipped:true, mode:'share' }; }
  };
}
// ---------------------------------------------------------------------------

LOG("[boot/share] ready (auth wired, readonly scopes)");
