
// gauth.module.js — GIS auth (compat): accepts opts.clientId or opts.client_id; uses meta/window if needed; caches token; silent refresh.
let accessToken = null;
let tokenClient = null;
let lastError = null;

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly'
].join(' ');

function ensureGisScript(){
  return new Promise((resolve)=>{
    if (window.google?.accounts?.oauth2){ resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = ()=> resolve();
    s.onerror = ()=> resolve(); // fail-soft
    document.head.appendChild(s);
  });
}

function meta(name){
  try{ return document.querySelector(`meta[name="${name}"]`)?.content || null; }catch(_){ return null; }
}

/**
 * setupAuth(buttonEl, onSignedChange, opts)
 * - opts.clientId / opts.client_id / window.GIS_CLIENT_ID / <meta name="google-oauth-client_id">
 * - opts.scopes / opts.scope / window.GIS_SCOPES / DEFAULT_SCOPES
 */
export async function setupAuth(buttonEl, onSignedChange, opts = {}){
  await ensureGisScript();
  if (!window.google?.accounts?.oauth2){
    console.warn('[auth] GIS not available');
    return;
  }
  const clientId = opts.clientId || opts.client_id || window.GIS_CLIENT_ID || meta('google-oauth-client_id');
  if (!clientId){
    lastError = { error: 'missing_client_id' };
    console.error('[auth] Missing client_id');
    return;
  }
  const scope = opts.scope || opts.scopes || window.GIS_SCOPES || DEFAULT_SCOPES;

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope,
    include_granted_scopes: true,
    prompt: ''
  });
  tokenClient.callback = (resp)=>{
    if (resp?.access_token){
      accessToken = resp.access_token;
      lastError = null;
      onSignedChange?.(true);
    }else if(resp?.error){
      lastError = resp;
      onSignedChange?.(false);
    }
  };

  if (buttonEl){
    buttonEl.addEventListener('click', async ()=>{
      try{ await ensureToken({ interactive:true }); }
      catch(e){ console.warn('[auth] interactive failed', e); }
    });
  }
}

export function getLastAuthError(){ return lastError; }
export function getAccessToken(){ return accessToken; }

export async function ensureToken({ interactive=false } = {}){
  if (accessToken) return accessToken;
  if (!tokenClient){
    lastError = { error: 'token_client_uninitialized' };
    throw lastError;
  }
  // silent first
  try{
    await new Promise((resolve, reject)=>{
      tokenClient.callback = (resp)=> resp?.access_token ? (accessToken = resp.access_token, resolve(resp)) : reject(resp);
      tokenClient.requestAccessToken({ prompt: '' });
    });
    return accessToken;
  }catch(_){}
  if (!interactive) throw lastError || new Error('silent_failed');
  // interactive
  await new Promise((resolve, reject)=>{
    tokenClient.callback = (resp)=> resp?.access_token ? (accessToken = resp.access_token, resolve(resp)) : reject(resp);
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
  return accessToken;
}

// Expose for other modules
try{
  if (!window.ensureToken) window.ensureToken = ensureToken;
  if (!window.getAccessToken) window.getAccessToken = getAccessToken;
  if (!window.getLastAuthError) window.getLastAuthError = getLastAuthError;
}catch(_){}
