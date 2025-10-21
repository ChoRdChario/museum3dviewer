
// gauth.module.js — full file (LM runtime-injectable GIS auth)
// ===========================================================

let _clientId = null;
let _tokenClient = null;
let _accessToken = null;
let _expiresAt = 0;
let _lastAuthError = null;
let _gisLoaded = false;

const TOK_KEY = "__LM_TOK";
const EXP_KEY = "__LM_TOK_EXP";
const CID_META = "google-signin-client_id";

function _now() { return Math.floor(Date.now() / 1000); }

function _loadGIS() {
  return new Promise((resolve, reject) => {
    if (_gisLoaded || window.google?.accounts?.oauth2) {
      _gisLoaded = true;
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => { _gisLoaded = true; resolve(); };
    s.onerror = (e) => reject(new Error("[gauth] failed to load GIS"));
    document.head.appendChild(s);
  });
}

function _restoreToken() {
  try {
    const t = sessionStorage.getItem(TOK_KEY);
    const e = Number(sessionStorage.getItem(EXP_KEY) || 0);
    if (t && e > _now() + 30) {
      _accessToken = t;
      _expiresAt = e;
    }
  } catch {}
}

function _saveToken(tok, expiresInSec = 3600) {
  _accessToken = tok;
  _expiresAt = _now() + Math.max(60, Number(expiresInSec || 3600));
  try {
    sessionStorage.setItem(TOK_KEY, _accessToken);
    sessionStorage.setItem(EXP_KEY, String(_expiresAt));
  } catch {}
}

export function getLastAuthError() {
  return _lastAuthError;
}

export async function getAccessToken({interactiveIfNeeded=false} = {}) {
  // return cached if valid
  if (_accessToken && _expiresAt > _now() + 30) return _accessToken;
  // silent refresh if possible
  try {
    await ensureToken({prompt: "", allowInteractive:false});
    if (_accessToken) return _accessToken;
  } catch {}
  if (interactiveIfNeeded) {
    await ensureToken({prompt: "consent", allowInteractive:true});
    return _accessToken;
  }
  return null;
}

export async function signIn() {
  await ensureToken({prompt:"consent", allowInteractive:true});
  return _accessToken;
}

function _initTokenClientUnsafe() {
  if (!_clientId) throw new Error("[gauth] client_id not set");
  if (!_gisLoaded) throw new Error("[gauth] GIS not loaded");
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: _clientId,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: (resp) => {
      if (resp.error) {
        _lastAuthError = resp;
        console.warn("[gauth] token error:", resp);
        return;
      }
      _lastAuthError = null;
      _saveToken(resp.access_token, resp.expires_in);
      window.dispatchEvent(new CustomEvent("materials:token", {detail:{access_token: _accessToken}}));
    }
  });
}

export async function ensureToken({prompt="", allowInteractive=false} = {}) {
  _restoreToken();
  if (_accessToken && _expiresAt > _now() + 30) return _accessToken;

  if (!_clientId) {
    _lastAuthError = new Error("[gauth] client_id not set");
    throw _lastAuthError;
  }

  await _loadGIS();
  if (!_tokenClient) _initTokenClientUnsafe();

  return new Promise((resolve, reject) => {
    try {
      _tokenClient.requestAccessToken({prompt});
      // callback will set token; poll a little
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (_accessToken) { clearInterval(timer); resolve(_accessToken); }
        else if (tries > 40) { clearInterval(timer); reject(_lastAuthError || new Error("[gauth] token timeout")); }
      }, 100);
    } catch (e) {
      _lastAuthError = e;
      if (!allowInteractive) return reject(e);
      try {
        _tokenClient.requestAccessToken({prompt:"consent"});
      } catch(e2) {
        _lastAuthError = e2;
        reject(e2);
      }
    }
  });
}

export async function setupAuth() {
  // Detect client_id from window or meta
  if (!_clientId) {
    if (window.__LM_CLIENT_ID && typeof window.__LM_CLIENT_ID === "string") {
      _clientId = window.__LM_CLIENT_ID;
    } else {
      const meta = document.querySelector(`meta[name='${CID_META}']`);
      if (meta?.content) _clientId = meta.content.trim();
    }
  }
  if (!_clientId) {
    console.log("[gauth] client_id not found at load; waiting for runtime setup");
    // don't throw — allow runtime injection via window.__LM_auth.setupClientId
    return;
  }
  await _loadGIS();
  _initTokenClientUnsafe();
  // try silent
  try { await ensureToken({prompt:"", allowInteractive:false}); } catch {}
}

export function setupClientId(client_id) {
  if (typeof client_id !== "string" || client_id.length < 10) {
    _lastAuthError = new Error("[gauth] invalid client_id");
    console.warn(_lastAuthError.message);
    return;
  }
  _clientId = client_id;
  window.__LM_CLIENT_ID = client_id;
  _loadGIS().then(() => {
    _initTokenClientUnsafe();
    // Try silent fetch right away
    ensureToken({prompt:"", allowInteractive:false}).catch(()=>{});
  });
}

export function isSignedIn() {
  return !!(_accessToken && _expiresAt > _now()+30);
}

// Install runtime bridge
(function installRuntimeBridge(){
  window.__LM_auth = window.__LM_auth || {};
  Object.assign(window.__LM_auth, {
    setupClientId,
    setupAuth,
    getAccessToken,
    getLastAuthError,
    ensureToken,
    signIn,
    isSignedIn
  });
  // custom event hook
  window.addEventListener("materials:clientId", (ev) => {
    const cid = ev?.detail?.client_id;
    if (cid) setupClientId(cid);
  });
})();

// auto setup on import
setupAuth().catch(e=>{
  _lastAuthError = e;
  console.warn(e?.message || e);
});
