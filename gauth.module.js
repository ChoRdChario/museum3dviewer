
/*! gauth.module.js — robust GIS auth with silent refresh & token caching */
let _token = null;       // { access_token, expires_at }
let _client = null;
let _lastErr = null;

// Scopes required for rename/write operations
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

// Utility: now in seconds
const nowSec = ()=> Math.floor(Date.now()/1000);

// Initialize token client once
export function setupAuth({ client_id }){
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2){
    _lastErr = new Error('Google Identity Services not loaded');
    console.warn('[auth] GIS script missing');
    return;
  }
  if (_client) return;
  _client = window.google.accounts.oauth2.initTokenClient({
    client_id,
    scope: SCOPES,
    callback: (resp)=>{
      if (resp && resp.access_token){
        const ttl = resp.expires_in ? Number(resp.expires_in) : 3300; // ~55m
        _token = {
          access_token: resp.access_token,
          expires_at: nowSec() + ttl - 30 // 30s early
        };
        _lastErr = null;
      }else if(resp && resp.error){
        _lastErr = new Error(resp.error);
        console.warn('[auth] token error', resp.error);
      }
    }
  });
}

// Public: last error (optional)
export function getLastAuthError(){ return _lastErr; }

// Public: synchronous getter (may be null)
export function getAccessToken(){ return _token && _token.access_token || null; }

// Internal: request a token (silent if possible)
function requestToken({interactive=false}={}){
  return new Promise((resolve,reject)=>{
    if(!_client){ reject(new Error('token client not initialized')); return; }
    const opts = { prompt: interactive ? 'consent' : '' };
    _client.callback = (resp)=>{
      if (resp && resp.access_token){
        const ttl = resp.expires_in ? Number(resp.expires_in) : 3300;
        _token = { access_token: resp.access_token, expires_at: nowSec()+ttl-30 };
        _lastErr = null;
        resolve(_token.access_token);
      }else{
        const err = new Error(resp && resp.error || 'token_failed');
        _lastErr = err;
        reject(err);
      }
    };
    try{
      _client.requestAccessToken(opts);
    }catch(e){
      _lastErr = e;
      reject(e);
    }
  });
}

// Public: ensure token (awaitable). Tries silent first, then interactive if allowed.
export async function ensureToken({interactive=true}={}){
  // Token valid?
  if (_token && _token.access_token && _token.expires_at && _token.expires_at > nowSec()){
    return _token.access_token;
  }
  // Try silent refresh
  try{
    return await requestToken({interactive:false});
  }catch(e){
    if(!interactive) throw e;
  }
  // Fallback: interactive prompt
  return await requestToken({interactive:true});
}

// --- Global bridges so other modules can use them even without ESM import ---
try{
  if (!window.ensureToken) window.ensureToken = ensureToken;
  if (!window.getAccessToken) window.getAccessToken = getAccessToken;
  if (!window.getLastAuthError) window.getLastAuthError = getLastAuthError;
}catch(_){}
