// gauth.module.js
// Minimal GIS token management. Does NOT render any button.
// Exports: setupAuth, ensureToken, signIn, getAccessToken, getLastAuthError

let _tokenClient = null;
let _accessToken = null;
let _lastErr = null;
let _clientId = null;
let _gisLoaded = false;

function _log(...args){ console.log('[gauth]', ...args); }
function _warn(...args){ console.warn('[gauth]', ...args); }

function _readClientIdFromDOM(){
  // 1) <meta name="google-signin-client_id" content="...">
  const meta = document.querySelector("meta[name='google-signin-client_id']");
  if (meta?.content) return meta.content.trim();

  // 2) window.__LM_CLIENT_ID
  if (typeof window.__LM_CLIENT_ID === 'string' && window.__LM_CLIENT_ID.trim()) {
    return window.__LM_CLIENT_ID.trim();
  }

  // 3) <script id="locimyu-config" type="application/json">{ client_id: "..." }</script>
  const cfgEl = document.getElementById('locimyu-config');
  if (cfgEl) {
    try {
      const cfg = JSON.parse(cfgEl.textContent || '{}');
      if (typeof cfg.client_id === 'string' && cfg.client_id.trim()) {
        return cfg.client_id.trim();
      }
    } catch(e){/* ignore */}
  }
  return null;
}

function _injectGisScript(){
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2){ _gisLoaded = true; return resolve(); }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => { _gisLoaded = true; resolve(); };
    s.onerror = () => { _warn('failed to load GIS client'); resolve(); };
    document.head.appendChild(s);
  });
}

export async function setupAuth(){
  _clientId = _readClientIdFromDOM();
  if(!_clientId){
    _warn('client_id not found at load; waiting for runtime setup');
    // allow later calls to retry when client id becomes available
  }
  await _injectGisScript();
  if (_clientId && window.google?.accounts?.oauth2){
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: _clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      callback: (resp) => {
        if (resp && resp.access_token){
          _accessToken = resp.access_token;
          _lastErr = null;
        } else if (resp && resp.error){
          _lastErr = resp.error;
          _accessToken = null;
        }
      }
    });
    _log('token client ready');
  } else {
    _warn('tokenClient not ready (no client_id?)');
  }
}

export function getAccessToken(){ return _accessToken; }
export function getLastAuthError(){ return _lastErr; }

export async function ensureToken({interactive=true} = {}){
  if(!_tokenClient){
    // try to recover if client id appeared later
    if(!_clientId){
      _clientId = _readClientIdFromDOM();
      if (_clientId && _gisLoaded){
        await setupAuth();
      }
    }
  }
  if(!_tokenClient) throw new Error('[gauth] tokenClient not ready (no client_id?)');

  return new Promise((resolve, reject) => {
    try{
      _tokenClient.callback = (resp) => {
        if (resp?.access_token){
          _accessToken = resp.access_token;
          _lastErr = null;
          resolve(_accessToken);
        } else {
          _lastErr = resp?.error || 'unknown_error';
          reject(new Error('[gauth] token rejected: ' + _lastErr));
        }
      };
      _tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    }catch(e){ _lastErr = String(e); reject(e); }
  });
}

export async function signIn(){
  return ensureToken({interactive:true});
}
