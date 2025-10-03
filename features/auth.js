// museum3dviewer/features/auth.js  (v6.6.6 - inline only)
// Sign-in UI is rendered ONLY next to the title (slot: #auth-inline).
// Floating bar & sidebar chip are removed. Exports are unchanged.
//
// Required in index.html:
//   <script src="https://accounts.google.com/gsi/client" async defer></script>
//   <script src="https://apis.google.com/js/api.js"></script>
//   <script type="module" src="./features/init_cloud_boot.js"></script>

const API_KEY   = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' ');

let tokenClient = null;
let gapiReady = false;
let gisReady  = false;

function loadGapiClient() {
  return new Promise((resolve, reject) => {
    if (!window.gapi?.load) return reject(new Error('gapi not loaded'));
    gapi.load('client', async () => {
      try {
        await gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: [
            'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
            'https://sheets.googleapis.com/$discovery/rest?version=v4'
          ]
        });
        gapiReady = true; resolve();
      } catch (e) { reject(e); }
    });
  });
}
function initGis() {
  if (!window.google?.accounts?.oauth2) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPES,
    callback: (resp) => {
      if (resp?.error) { console.warn('[auth] token error', resp); return; }
      console.log('[auth] token acquired');
      document.dispatchEvent(new CustomEvent('auth:signed-in'));
      renderInlineChip();
    }
  });
  gisReady = true;
}

export async function ensureLoaded(){
  try { if (!gapiReady) await loadGapiClient(); } catch(e){ console.warn('[auth] gapi load failed', e?.message||e); }
  if (!gisReady) initGis();
}
export function signIn(prompt='consent'){ if(!tokenClient) initGis(); try{ tokenClient?.requestAccessToken({prompt}); }catch(e){ console.warn('[auth] requestAccessToken failed',e);} }
export function signOut(){ try{ const t=gapi?.client?.getToken?.(); if(t){ google?.accounts?.oauth2?.revoke?.(t.access_token); gapi.client.setToken(null);} }catch{} console.log('[auth] signed out'); document.dispatchEvent(new CustomEvent('auth:signed-out')); renderInlineChip(); }
export function isSignedIn(){ try{ return !!gapi?.client?.getToken?.(); }catch{ return false; } }
export async function initAuthUI(){ renderInlineChip(); }

// ----- Inline chip next to the title -----
function renderInlineChip(){
  let slot=document.getElementById('auth-inline');
  if(!slot){
    const brand=document.querySelector('#side .brand, #side h3, .brand, h1, h3');
    if(brand){ slot=document.createElement('span'); slot.id='auth-inline'; slot.style.marginLeft='8px'; brand.appendChild(slot); }
  }
  if(!slot) return;
  slot.innerHTML='';
  const btn=document.createElement('button');
  btn.textContent = isSignedIn() ? 'Signed in' : 'Sign in';
  Object.assign(btn.style,{ background:'#1f6feb', color:'#fff', border:'none', borderRadius:'8px', padding:'4px 8px', fontSize:'12px', cursor:'pointer' });
  btn.onclick = () => isSignedIn() ? signOut() : signIn('consent');
  slot.appendChild(btn);
}

// Debug helper
window.__LMY_authDebug=()=>{
  console.log('[authDebug-inlineOnly]',{
    gapi:!!window.gapi, google:!!window.google, oauth2:!!window.google?.accounts?.oauth2,
    token:(()=>{try{return !!gapi.client.getToken();}catch{return false;}})(),
    inline: !!document.getElementById('auth-inline')
  });
  renderInlineChip();
};

// keep chip in sync
document.addEventListener('auth:signed-in', renderInlineChip);
document.addEventListener('auth:signed-out', renderInlineChip);
window.addEventListener('DOMContentLoaded', ()=>{ renderInlineChip(); });
