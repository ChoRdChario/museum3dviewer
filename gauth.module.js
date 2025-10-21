
/**
 * gauth.module.js — GIS OAuth helper (no DOM injection)
 * - Reads client_id from: window.__LM_CLIENT_ID, <meta name="google-signin-client_id">,
 *   <script id="locimyu-config" type="application/json">, or window.locimyuConfig
 * - Loads GIS if necessary
 * - Exports: setupAuth, ensureToken, getAccessToken, getLastAuthError, bindSignInButton, signIn (compat)
 * - Does NOT create any buttons; only binds to existing one(s)
 */
const GIS_SRC = "https://accounts.google.com/gsi/client";

let _clientId = null;
let _tokenClient = null;
let _lastError = null;
let _gisLoaded = false;
let _readyPromise = null;

function _log(...args){ try{ console.log("[gauth]", ...args);}catch{} }
function _warn(...args){ try{ console.warn("[gauth]", ...args);}catch{} }

function _readClientIdFromDOM(){
  if (typeof window !== "undefined"){
    if (window.__LM_CLIENT_ID && typeof window.__LM_CLIENT_ID === "string"){
      return window.__LM_CLIENT_ID.trim();
    }
    const meta = document.querySelector("meta[name='google-signin-client_id']");
    if (meta && meta.content) return meta.content.trim();
    // JSON config script
    const cfgEl = document.getElementById("locimyu-config");
    if (cfgEl){
      try{
        const j = JSON.parse(cfgEl.textContent || cfgEl.innerText || "{}");
        if (j.client_id) return String(j.client_id).trim();
      }catch{ /* ignore */ }
    }
    if (window.locimyuConfig && window.locimyuConfig.client_id){
      return String(window.locimyuConfig.client_id).trim();
    }
  }
  return null;
}

function _ensureGIS(){
  if (_gisLoaded) return Promise.resolve();
  if (typeof window === "undefined") return Promise.reject(new Error("[gauth] window missing"));
  if (window.google && window.google.accounts && window.google.accounts.oauth2){
    _gisLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject)=>{
    const id = "__gauth_gis";
    if (document.getElementById(id)){
      // already loading
      const check = ()=>{
        if (window.google?.accounts?.oauth2){ _gisLoaded = true; resolve(); }
        else setTimeout(check, 50);
      };
      return check();
    }
    const s = document.createElement("script");
    s.id = id;
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = ()=>{ _gisLoaded = true; resolve(); };
    s.onerror = (e)=> reject(new Error("[gauth] failed to load GIS"));
    document.head.appendChild(s);
  });
}

function _initTokenClient(){
  if (_tokenClient) return _tokenClient;
  _clientId = _clientId || _readClientIdFromDOM();
  if (!_clientId){
    _warn("client_id not found at load; waiting for runtime setup");
    return null;
  }
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2){ _lastError = new Error("[gauth] GIS not loaded"); return null; }
  _tokenClient = oauth2.initTokenClient({
    client_id: _clientId,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: (resp)=>{
      if (resp && resp.access_token){
        window.__LM_OAUTH = Object.assign(window.__LM_OAUTH||{}, {
          access_token: resp.access_token,
          expires_in: Date.now() + (Number(resp.expires_in||0)*1000)
        });
        window.dispatchEvent(new CustomEvent("gauth:token", {detail: resp}));
      }else if (resp && resp.error){
        _lastError = new Error(String(resp.error));
        _warn("token error", resp.error);
      }
    }
  });
  window.dispatchEvent(new CustomEvent("gauth:ready", {detail:{client_id:_clientId}}));
  return _tokenClient;
}

/**
 * Public: ensure the auth system is ready. Returns a promise that resolves when ready.
 */
export function setupAuth(){
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async ()=>{
    await _ensureGIS();
    // small wait loop for client_id from DOM (up to 3s)
    const t0 = Date.now();
    while(!_clientId){
      _clientId = _readClientIdFromDOM();
      if (_clientId) break;
      if (Date.now() - t0 > 3000) break;
      await new Promise(r=>setTimeout(r,100));
    }
    const ok = _initTokenClient();
    if (!ok) throw new Error("[gauth] tokenClient not ready (no client_id?)");
  })();
  return _readyPromise;
}

export function getLastAuthError(){ return _lastError; }
export function getAccessToken(){ return window.__LM_OAUTH?.access_token || null; }

export async function ensureToken(interactive=false){
  await setupAuth();
  const tok = getAccessToken();
  const notExpired = tok && window.__LM_OAUTH?.expires_in && window.__LM_OAUTH.expires_in - Date.now() > 30000;
  if (tok && notExpired) return tok;
  return new Promise((resolve, reject)=>{
    try{
      _tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
      const check=()=>{
        const t = getAccessToken();
        if (t) return resolve(t);
        setTimeout(check, 50);
      };
      check();
    }catch(e){
      _lastError = e;
      reject(e);
    }
  });
}

/**
 * Compatibility helper: signIn() -> ensureToken(true)
 */
export async function signIn(){
  try{
    const t = await ensureToken(true);
    return t;
  }catch(e){
    _warn("signIn failed", e?.message||e);
    throw e;
  }
}

/**
 * Bind existing sign-in buttons (does not insert DOM).
 */
export function bindSignInButton(sel = "#signin, [data-role='signin'], .g-signin, #google-signin"){
  const btn = document.querySelector(sel);
  if (!btn) return false;
  btn.addEventListener("click", async (ev)=>{
    ev.preventDefault();
    try{
      await signIn();
    }catch(e){
      _warn("bindSignInButton click failed", e?.message||e);
    }
  }, { once:false });
  return true;
}

// default export for older import styles
export default { setupAuth, ensureToken, getAccessToken, getLastAuthError, bindSignInButton, signIn };
