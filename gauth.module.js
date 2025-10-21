
// gauth.module.js — GIS-based OAuth helper (full file, drop-in)
//
// Exports:
//   setupAuth, loadGIS, getClient, getAccessToken, ensureToken,
//   getLastAuthError, signIn, signOut, onAuthState
//
// Behavior:
// - Lazy-loads Google Identity Services (GIS) if needed
// - Manages an access token in sessionStorage (__LM_TOK)
// - Provides silent token acquisition first, falls back to interactive on signIn()
// - Not coupled to gapi.client; uses fetch in other modules
//
// Minimal host requirements:
// - Provide a Google OAuth Client ID via either:
//     window.__LM_CLIENT_ID  (preferred)
//   or <meta name="google-signin-client_id" content="...">
// - Optionally include in HTML:
//     <script src="https://accounts.google.com/gsi/client" async defer></script>

// -------------------- Internal state --------------------
let _gisLoaded = false;
let _tokenClient = null;
let _lastAuthError = null;
let _authListeners = []; // functions receiving ({ signedIn, access_token, expires_at })

// Retrieve token record from sessionStorage or window.__LM_OAUTH
function _readToken() {
  try {
    const s = sessionStorage.getItem("__LM_TOK");
    if (s) return JSON.parse(s);
  } catch (e) {}
  // Back-compat: also accept window.__LM_OAUTH if present
  if (typeof window !== "undefined" && window.__LM_OAUTH && window.__LM_OAUTH.access_token) {
    return {
      access_token: window.__LM_OAUTH.access_token,
      expires_at: window.__LM_OAUTH.expires_at || 0
    };
  }
  return null;
}

function _writeToken(tok) {
  try {
    if (tok) sessionStorage.setItem("__LM_TOK", JSON.stringify(tok));
    else sessionStorage.removeItem("__LM_TOK");
  } catch (e) {}
}

function _now() {
  return Math.floor(Date.now() / 1000);
}

function _isValidToken(tok) {
  if (!tok || !tok.access_token) return false;
  // 60s skew to be safe
  return typeof tok.expires_at === "number" ? tok.expires_at - 60 > _now() : true;
}

function _emitAuthState() {
  const tok = _readToken();
  const payload = {
    signedIn: _isValidToken(tok),
    access_token: tok && tok.access_token || null,
    expires_at: tok && tok.expires_at || 0
  };
  _authListeners.forEach(fn => { try { fn(payload); } catch (e) {} });
}

// -------------------- GIS loader --------------------
export function loadGIS() {
  return new Promise((resolve, reject) => {
    if (_gisLoaded && window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    const onReady = () => {
      _gisLoaded = true;
      resolve();
    };
    // If script tag already present, wait
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      _gisLoaded = true;
      resolve();
      return;
    }
    const existing = document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("GIS script failed to load")), { once: true });
      return;
    }
    // Inject script
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = onReady;
    s.onerror = () => reject(new Error("GIS script failed to load"));
    document.head.appendChild(s);
  });
}

// -------------------- Client init --------------------
function _getClientId() {
  if (typeof window !== "undefined" && window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
  const meta = document.querySelector('meta[name="google-signin-client_id"]');
  if (meta && meta.content) return meta.content.trim();
  return null;
}

function _initTokenClient(scopes) {
  if (_tokenClient) return _tokenClient;
  const clientId = _getClientId();
  if (!clientId) throw new Error("[gauth] client_id not set (window.__LM_CLIENT_ID or <meta name='google-signin-client_id'>)");
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    throw new Error("[gauth] GIS not loaded");
  }
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: scopes || "https://www.googleapis.com/auth/spreadsheets",
    prompt: "", // default silent; change per request
    callback: (resp) => {
      if (resp && resp.access_token) {
        // 3600s is common default; prefer resp.expires_in if provided
        const expiresIn = typeof resp.expires_in === "number" ? resp.expires_in : 3600;
        const tok = {
          access_token: resp.access_token,
          expires_at: _now() + expiresIn
        };
        _writeToken(tok);
        _lastAuthError = null;
        _emitAuthState();
      } else if (resp && resp.error) {
        _lastAuthError = resp.error_description || resp.error || "unknown_auth_error";
        _emitAuthState();
      }
    }
  });
  return _tokenClient;
}

// -------------------- Public API --------------------
export async function setupAuth(scopes) {
  await loadGIS();
  _initTokenClient(scopes);
  // try silent refresh once if no valid token
  const tok = _readToken();
  if (!_isValidToken(tok)) {
    try {
      await new Promise((resolve) => {
        const c = _initTokenClient(scopes);
        c.callback = (resp) => {
          if (resp && resp.access_token) {
            const expiresIn = typeof resp.expires_in === "number" ? resp.expires_in : 3600;
            _writeToken({ access_token: resp.access_token, expires_at: _now() + expiresIn });
            _lastAuthError = null;
          } else if (resp && resp.error) {
            _lastAuthError = resp.error_description || resp.error;
          }
          _emitAuthState();
          resolve();
        };
        c.requestAccessToken({ prompt: "" }); // silent
      });
    } catch (e) {
      _lastAuthError = String(e && e.message || e);
      _emitAuthState();
    }
  } else {
    _emitAuthState();
  }
  return true;
}

export function getClient() {
  return _tokenClient;
}

export function getLastAuthError() {
  return _lastAuthError;
}

export async function getAccessToken({ interactive = false, scopes } = {}) {
  // return cached if valid
  const tok = _readToken();
  if (_isValidToken(tok)) return tok.access_token;

  await loadGIS();
  const c = _initTokenClient(scopes);
  return new Promise((resolve, reject) => {
    c.callback = (resp) => {
      if (resp && resp.access_token) {
        const expiresIn = typeof resp.expires_in === "number" ? resp.expires_in : 3600;
        _writeToken({ access_token: resp.access_token, expires_at: _now() + expiresIn });
        _lastAuthError = null;
        _emitAuthState();
        resolve(resp.access_token);
      } else if (resp && resp.error) {
        _lastAuthError = resp.error_description || resp.error;
        _emitAuthState();
        reject(new Error(_lastAuthError));
      } else {
        _lastAuthError = "unknown_auth_error";
        _emitAuthState();
        reject(new Error(_lastAuthError));
      }
    };
    c.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

export async function ensureToken(opts = {}) {
  try {
    const t = await getAccessToken(opts);
    return t;
  } catch (e) {
    return null;
  }
}

export async function signIn(scopes) {
  await loadGIS();
  const c = _initTokenClient(scopes);
  return new Promise((resolve, reject) => {
    c.callback = (resp) => {
      if (resp && resp.access_token) {
        const expiresIn = typeof resp.expires_in === "number" ? resp.expires_in : 3600;
        _writeToken({ access_token: resp.access_token, expires_at: _now() + expiresIn });
        _lastAuthError = null;
        _emitAuthState();
        resolve(true);
      } else if (resp && resp.error) {
        _lastAuthError = resp.error_description || resp.error;
        _emitAuthState();
        reject(new Error(_lastAuthError));
      } else {
        _lastAuthError = "unknown_auth_error";
        _emitAuthState();
        reject(new Error(_lastAuthError));
      }
    };
    c.requestAccessToken({ prompt: "consent" });
  });
}

export function signOut() {
  _writeToken(null);
  if (typeof window !== "undefined" && window.__LM_OAUTH) {
    try { delete window.__LM_OAUTH.access_token; } catch (e) {}
  }
  _emitAuthState();
  return true;
}

export function onAuthState(fn) {
  if (typeof fn === "function") {
    _authListeners.push(fn);
    // Give current state immediately
    try { fn({ signedIn: _isValidToken(_readToken()), access_token: _readToken()?.access_token || null, expires_at: _readToken()?.expires_at || 0 }); } catch (e) {}
    return () => {
      _authListeners = _authListeners.filter(x => x !== fn);
    };
  }
  return () => {};
}

// Default export for convenience (optional for consumers)
const api = {
  setupAuth,
  loadGIS,
  getClient,
  getAccessToken,
  ensureToken,
  getLastAuthError,
  signIn,
  signOut,
  onAuthState
};

export default api;
