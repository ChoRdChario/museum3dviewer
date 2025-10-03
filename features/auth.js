
// features/auth.js (v6.6.4-fix3)
const API_KEY = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' ');

let gapiReady = false;
let gisReady = false;
let inflightTokenPromise = null;

function log(...a){ console.log('[auth]', ...a); }
function err(...a){ console.error('[auth]', ...a); }
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function addScript({id, src, async=true, defer=true, nonce}){
  return new Promise((resolve, reject)=>{
    if (document.getElementById(id)) return resolve(true);
    const s = document.createElement('script');
    s.id=id; s.src=src; s.async=async; s.defer=defer; if(nonce) s.nonce=nonce;
    s.onload=()=>resolve(true); s.onerror=()=>reject(new Error('failed to load '+src));
    document.head.appendChild(s);
  });
}
async function loadWithRetry(what, fn, {tries=3, baseDelay=350}={}){
  let last;
  for (let i=0;i<tries;i++){
    try{ await fn(); log(what,'loaded'); return; }
    catch(e){ last=e; err(what,'load failed',e); await sleep(baseDelay*(i+1)); }
  }
  throw last || new Error(what+' not loaded');
}

async function initGis(){
  if (gisReady) return;
  await addScript({ id:'gsi', src:'https://accounts.google.com/gsi/client' });
  if (!window.google?.accounts?.oauth2) throw new Error('GIS not present');
  gisReady = true;
}
async function loadGapiClient(){
  if (gapiReady) return;
  await addScript({ id:'gapi', src:'https://apis.google.com/js/api.js' });
  if (!window.gapi) throw new Error('gapi not present');
  await new Promise((resolve, reject)=>{
    try{ gapi.load('client', { callback: resolve, onerror: ()=>reject(new Error('gapi.load client failed')) }); }
    catch(e){ reject(e); }
  });
  await gapi.client.init({ apiKey: API_KEY });
  await Promise.allSettled([
    gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'),
    gapi.client.load('https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest')
  ]);
  gapiReady = true;
}

export async function ensureLoaded(){
  await loadWithRetry('gis', initGis, {tries:3, baseDelay:400});
  await loadWithRetry('gapi', loadGapiClient, {tries:3, baseDelay:500});
  return true;
}

function getAccessTokenInteractive(promptMode){
  return new Promise((resolve, reject)=>{
    try{
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES, prompt: promptMode,
        callback: (tokenResponse)=>{
          try{
            const at = tokenResponse?.access_token;
            if (at){ gapi?.client?.setToken?.({ access_token: at }); resolve(at); }
            else reject(new Error('no access_token'));
          }catch(e){ reject(e); }
        }
      });
      client.requestAccessToken();
    }catch(e){ reject(e); }
  });
}

export async function ensureAccessToken({interactiveIfNeeded=true}={}){
  await ensureLoaded();
  const tok = gapi?.client?.getToken?.();
  if (tok?.access_token) return true;
  if (inflightTokenPromise) { await inflightTokenPromise; return !!(gapi?.client?.getToken?.()?.access_token); }
  inflightTokenPromise = (async ()=>{
    try{ await getAccessTokenInteractive(''); }catch(_){}
    if (gapi?.client?.getToken?.()?.access_token) return true;
    if (interactiveIfNeeded){ await getAccessTokenInteractive('consent'); }
    return !!(gapi?.client?.getToken?.()?.access_token);
  })();
  const ok = await inflightTokenPromise.finally(()=> inflightTokenPromise=null);
  if (!ok) throw new Error('OAuth token unavailable');
  return true;
}
export function signIn(){ ensureAccessToken({interactiveIfNeeded:true}); }
export function signOut(){
  try{ const tok = gapi?.client?.getToken?.(); if (tok?.access_token){ google?.accounts?.oauth2?.revoke?.(tok.access_token, ()=>{}); } }catch(_){}
  try{ gapi?.client?.setToken?.(null); }catch(_){}
}
export function isSignedIn(){ try{ return !!(gapi?.client?.getToken?.()?.access_token); }catch(_){ return false; } }

function makeBtn(text, onClick, disabled=false){
  const b=document.createElement('button'); b.textContent=text;
  b.style.cssText='appearance:none;border:1px solid rgba(255,255,255,.1);background:#1b2330;color:#eaf1ff;padding:6px 10px;border-radius:10px;cursor:pointer;';
  b.disabled=!!disabled; b.onclick=onClick; return b;
}
function makeStatusSpan(text){ const s=document.createElement('span'); s.textContent=text; s.style.cssText='font-size:12px;color:#9aa4b2;margin-right:8px'; return s; }
function renderFloatingChip(){
  let host=document.getElementById('auth-bar'); if(!host){ host=document.createElement('div'); host.id='auth-bar'; document.body.appendChild(host); }
  host.innerHTML=''; const box=document.createElement('div'); box.className='chip';
  box.style.cssText='display:flex;gap:8px;align-items:center;background:#141820;border:1px solid rgba(255,255,255,.08);padding:6px 8px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);';
  const authed=isSignedIn(); box.appendChild(makeStatusSpan(authed?'Google: Signed-in':'Google: Signed-out'));
  box.appendChild(makeBtn('Sign in', ()=>signIn(), authed)); box.appendChild(makeBtn('Sign out', ()=>signOut(), !authed)); host.appendChild(box);
}
function renderSidebarChip(){
  const side=document.getElementById('side'); if(!side) return;
  let box=document.getElementById('auth-box-side'); if(!box){ box=document.createElement('div'); box.id='auth-box-side'; side.prepend(box); }
  box.innerHTML='';
  const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;align-items:center;background:#141820;border:1px solid rgba(255,255,255,.08);padding:8px;border-radius:12px;';
  const authed=isSignedIn(); row.appendChild(makeStatusSpan('Google:')); row.appendChild(makeBtn('Sign in', ()=>signIn(), authed)); row.appendChild(makeBtn('Sign out', ()=>signOut(), !authed)); box.appendChild(row);
}
export async function initAuthUI(){ renderAuthUIs(); if (document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', renderAuthUIs, {once:true}); } }
function renderAuthUIs(){ renderFloatingChip(); renderSidebarChip(); }
window.__LMY_authDebug = function(){ return { gapi: !!window.gapi && !!(gapi.client), gis: !!(window.google && google.accounts && google.accounts.oauth2), hasToken: !!(gapi?.client?.getToken?.()?.access_token) }; };
