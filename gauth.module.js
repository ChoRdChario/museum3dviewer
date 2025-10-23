// gauth.module.js — drop-in replacement (no auto-popup; user-gesture based)
//
// What changed vs your previous file?
// 1) setupAuth() no longer calls ensureToken() at load. This prevents popup blockers.
// 2) New global window.LM_triggerSignin() you can call from your existing "Sign in" UI.
// 3) getAccessToken() returns a token if alive; otherwise it throws Error('no_token') instead of
//    trying to open a popup by itself. The app should call LM_triggerSignin() once,
//    then retry getAccessToken().
// 4) We still support revoke() / signOut() as before.
//
// Keep the same client_id discovery and scope list you already used.

const W = window;
let _gisLoaded = false;
let _tokenClient = null;
let _accessToken = null;
let _tokenExp = 0;           // epoch ms
let _clientId = null;
let _lastError = null;

// --- scopes (unchanged) ---
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' ');

// Read client_id from <meta name="google-signin-client_id" content="...">
function _readClientIdFromDOM() {
  const m = document.querySelector('meta[name="google-signin-client_id"]');
  return (m && m.content) ? m.content.trim() : null;
}

function _tokenAlive() {
  return !!_accessToken && Date.now() < _tokenExp - 15_000; // 15s early
}

function _storeToken(resp) {
  // GIS returns {access_token, expires_in, ...}
  if (resp && resp.access_token) {
    _accessToken = resp.access_token;
    const ttl = Number(resp.expires_in || 0);
    _tokenExp = Date.now() + Math.max(5, ttl) * 1000;
  }
}

// Load Google Identity Services (once)
async function _loadGIS() {
  if (_gisLoaded) return;
  if (!('google' in window) || !google.accounts?.oauth2) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('gsi_load_failed'));
      document.head.appendChild(s);
    });
  }
  _gisLoaded = true;
}

function _initTokenClient() {
  if (_tokenClient) return;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: _clientId,
    scope: SCOPES,
    callback: (resp) => {
      if (resp && resp.access_token) {
        _storeToken(resp);
        document.dispatchEvent(new CustomEvent('materials:authstate', { detail: { ok: true } }));
      } else if (resp && resp.error) {
        _lastError = resp;
        document.dispatchEvent(new CustomEvent('materials:authstate', { detail: { ok: false, error: resp.error } }));
      }
    }
  });
}

// ---------- Public API ----------

// Initialize GIS + client id (no popup here)
export async function setupAuth() {
  try { await _loadGIS(); } catch (e) { _lastError = e; console.warn('[gauth] GIS load failed', e); return; }
  _clientId = _readClientIdFromDOM();
  if (_clientId) {
    try { _initTokenClient(); }
    catch (e) { _lastError = e; console.warn('[gauth] token client init err', e); }
  } else {
    console.warn('[gauth] client_id not found in <meta google-signin-client_id>');

  }
  // DO NOT call ensureToken() here — avoid popup at load
}

// Explicit user-gesture sign-in trigger.
// Call this from a click handler on your existing "Sign in" button.
// After this resolves (token arrives in callback), you can call getAccessToken().
export async function ensureAuthInteractive() {
  await _loadGIS();
  if (!_tokenClient) {
    _clientId = _clientId || _readClientIdFromDOM();
    if (!_clientId) throw new Error('client_id_missing');
    _initTokenClient();
  }
  // This MUST be invoked from a user gesture to avoid popup blocking.
  return new Promise((resolve, reject) => {
    try {
      _tokenClient.requestAccessToken({ prompt: 'consent' });
      // Resolve when token callback fires (we listen via once event)
      const onOk = (e) => { cleanup(); resolve(true); };
      const onNg = (e) => { cleanup(); reject(_lastError || new Error('auth_failed')); };
      function cleanup() {
        document.removeEventListener('materials:authstate', handler);
      }
      function handler(ev) { (ev?.detail?.ok ? onOk : onNg)(ev); }
      document.addEventListener('materials:authstate', handler, { once: true });
    } catch (e) {
      reject(e);
    }
  });
}

// For compatibility with your existing calls
export async function ensureToken() {
  if (_tokenAlive()) return _accessToken;
  // Do NOT open a popup here. Indicate that we need a user gesture.
  throw new Error('no_token');
}

export async function getAccessToken() {
  if (_tokenAlive()) return _accessToken;
  throw new Error('no_token');
}

export function getTokenExpiry() { return _tokenExp; }
export function getLastError() { return _lastError; }

export async function revoke() {
  if (!_accessToken) return;
  try {
    google.accounts.oauth2.revoke(_accessToken, () => {});
  } catch {}
  _accessToken = null; _tokenExp = 0;
}

export async function signOut() {
  await revoke();
}

// ------------- Convenience: bind to existing UI -------------
// If your page has an element with id="signin" or data-lm-signin,
// we'll automatically bind a click handler once (no UI changes otherwise).
(function autoBindSignin(){
  function bind(el){
    if (!el || el.__lm_bound) return;
    el.addEventListener('click', async (e) => {
      try { await ensureAuthInteractive(); }
      catch (err) { console.warn('[gauth] interactive signin failed', err); }
    }, { passive: true });
    el.__lm_bound = true;
  }
  const el1 = document.getElementById('signin');
  if (el1) bind(el1);
  document.querySelectorAll('[data-lm-signin]').forEach(bind);
})();

// For global access from inline onclick if needed
W.LM_triggerSignin = async function(){ try { await ensureAuthInteractive(); } catch(e){ console.warn(e); } };

// Initialize on load (no popup)
setupAuth().catch(()=>{});
