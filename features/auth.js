// museum3dviewer/features/auth.js  (v6.6.5)
// 右上/右ペイン/タイトル横の3箇所にSign-in UIを描画。
// ensureLoaded/initAuthUI/signIn/signOut/isSignedIn を公開。

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
      renderAuthUIs();
    }
  });
  gisReady = true;
}

export async function ensureLoaded(){
  try { if (!gapiReady) await loadGapiClient(); } catch(e){ console.warn('[auth] gapi load failed', e?.message||e); }
  if (!gisReady) initGis();
}
export function signIn(prompt='consent'){ if(!tokenClient) initGis(); try{ tokenClient?.requestAccessToken({prompt}); }catch(e){ console.warn('[auth] requestAccessToken failed',e);} }
export function signOut(){ try{ const t=gapi?.client?.getToken?.(); if(t){ google?.accounts?.oauth2?.revoke?.(t.access_token); gapi.client.setToken(null);} }catch{} console.log('[auth] signed out'); document.dispatchEvent(new CustomEvent('auth:signed-out')); renderAuthUIs(); }
export function isSignedIn(){ try{ return !!gapi?.client?.getToken?.(); }catch{ return false; } }
export async function initAuthUI(){ renderAuthUIs(); }

function renderAuthUIs(){ renderFloatingChip(); renderSidebarChip(); renderInlineChip(); }

function renderFloatingChip(){
  let bar=document.getElementById('auth-bar');
  if(!bar){
    bar=document.createElement('div'); bar.id='auth-bar';
    Object.assign(bar.style,{position:'fixed',top:'12px',right:'12px',zIndex:2147483000,display:'flex',gap:'8px',alignItems:'center',background:'rgba(0,0,0,0.55)',padding:'8px 10px',borderRadius:'10px',backdropFilter:'blur(4px)',color:'#fff',fontFamily:'system-ui,sans-serif',fontSize:'12px',boxShadow:'0 6px 18px rgba(0,0,0,.35)'});
    document.body.appendChild(bar);
  }
  bar.innerHTML='';
  bar.appendChild(makeStatusSpan());
  bar.appendChild(makeBtn('Sign in',()=>signIn(isSignedIn()?'':'consent'),isSignedIn()));
  bar.appendChild(makeBtn('Sign out',()=>signOut(),!isSignedIn()));
}
function renderSidebarChip(){
  const side=document.getElementById('side'); if(!side) return;
  let box=document.getElementById('auth-box-side');
  if(!box){ box=document.createElement('div'); box.id='auth-box-side'; Object.assign(box.style,{margin:'8px 0 12px',display:'flex',gap:'6px',alignItems:'center'}); side.prepend(box); }
  box.innerHTML=''; const label=document.createElement('span'); label.textContent='Google:'; label.style.opacity='.8'; box.appendChild(label);
  box.appendChild(makeStatusSpan());
  box.appendChild(makeBtn('Sign in',()=>signIn(isSignedIn()?'':'consent'),isSignedIn()));
  box.appendChild(makeBtn('Sign out',()=>signOut(),!isSignedIn()));
}
function renderInlineChip(){
  let slot=document.getElementById('auth-inline');
  if(!slot){
    const brand=document.querySelector('#side .brand, #side h3, .brand, h1, h3');
    if(brand){ slot=document.createElement('span'); slot.id='auth-inline'; slot.style.marginLeft='8px'; brand.appendChild(slot); }
  }
  if(!slot) return;
  slot.innerHTML='';
  const b=makeBtn(isSignedIn()?'Signed in':'Sign in',()=>isSignedIn()?signOut():signIn('consent'));
  b.style.padding='4px 8px'; b.style.fontSize='12px';
  slot.appendChild(b);
}
function makeStatusSpan(){ const s=document.createElement('span'); s.textContent=isSignedIn()?'Signed in':'Signed out'; s.style.opacity='.85'; s.style.minWidth='72px'; return s; }
function makeBtn(text,onClick,disabled){ const b=document.createElement('button'); b.textContent=text; Object.assign(b.style,{background:'#1f6feb',color:'#fff',border:'none',borderRadius:'8px',padding:'6px 10px',cursor:'pointer'}); b.disabled=!!disabled; b.onclick=onClick; return b; }

// Debug
window.__LMY_authDebug=()=>{ console.log('[authDebug]',{ gapi:!!window.gapi, google:!!window.google, oauth2:!!window.google?.accounts?.oauth2, token:(()=>{try{return !!gapi.client.getToken();}catch{return false;}})(), bar:!!document.getElementById('auth-bar'), side:!!document.getElementById('auth-box-side'), inline:!!document.getElementById('auth-inline')}); renderAuthUIs(); };

window.addEventListener('lmy:auth-mount-inline', renderInlineChip);
document.addEventListener('auth:signed-in', renderInlineChip);
document.addEventListener('auth:signed-out', renderInlineChip);
window.addEventListener('DOMContentLoaded', ()=>{ renderAuthUIs(); });
