// features/auth.js  (v1-perm-fix)
const API_KEY = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

let tokenClient = null;
let gapiInited = false;
let accessToken = null;

function h(tag, props={}, ...children){
  const el = document.createElement(tag);
  Object.assign(el, props);
  children.forEach(c=> el.append(c));
  return el;
}

function renderAuthUi(){
  const slotId = 'auth-slot';
  let slot = document.getElementById(slotId);
  if(!slot){
    const title = document.querySelector('#app-title-right') || document.body;
    slot = h('span', { id: slotId, style: 'margin-left:.5rem;vertical-align:middle;display:inline-flex;gap:6px;' });
    title.append(slot);
  }
  slot.innerHTML = '';
  if(accessToken){
    slot.append(
      h('span', { className:'badge', textContent:'Signed in', style:'padding:.15rem .5rem;background:#1f6feb;color:#fff;border-radius:10px;font-size:12px' }),
      h('button', { textContent:'Sign out', className:'btn', onclick: signOut, style:'margin-left:6px' }),
    );
  }else{
    slot.append(h('button', { textContent:'Sign in', className:'btn', onclick: signIn }));
  }
}

async function loadGapi(){
  if(gapiInited) return;
  await new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  await new Promise((res)=> gapi.load('client', res));
  await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    'https://sheets.googleapis.com/$discovery/rest?version=v4',
  ]});
  gapiInited = true;
}

function ensureTokenClient(){
  if(tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    prompt: 'consent',
    callback: (resp)=>{
      accessToken = resp.access_token || null;
      if(accessToken){
        gapi.client.setToken({ access_token: accessToken });
        console.log('[auth] token acquired');
        document.dispatchEvent(new CustomEvent('lmy:authed'));
      }
      renderAuthUi();
    }
  });
}

async function signIn(){
  await loadGapi();
  ensureTokenClient();
  tokenClient.requestAccessToken();
}

function signOut(){
  if(!accessToken){ return; }
  try{ google.accounts.oauth2.revoke(accessToken); }catch{}
  gapi.client.setToken(null);
  accessToken = null;
  renderAuthUi();
}

function isAuthed(){ return !!accessToken; }

async function init(){ renderAuthUi(); }

window.__LMY_auth = { init, signIn, signOut, isAuthed };
document.addEventListener('DOMContentLoaded', init);
