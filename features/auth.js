// features/auth.js  (v2.3 — de-dupe & fixed top-right & ESM exports)
const API_KEY   = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

let tokenClient = null;
let gapiInited  = false;
let accessToken = null;

function h(tag, props={}, ...children){
  const el = document.createElement(tag);
  Object.assign(el, props);
  (children||[]).forEach(c=> el.append(c));
  return el;
}

// --- de-dupe: 同名スロット/古いボタンを掃除
function cleanupAuthUINodes(){
  // 既存の auth-slot を残しつつ、それ以外の「Sign in / Sign out」残骸を排除
  document.querySelectorAll('[data-lmy-auth], .lmy-auth-legacy')
    .forEach(n => n.remove());
  // 誤って body 直下に作られた auth-slot の複数化対策
  const slots = [...document.querySelectorAll('#auth-slot')];
  slots.slice(1).forEach(n=> n.remove());
}

function ensureStyle(){
  if (document.getElementById('auth-css')) return;
  const css = `
  .auth-slot-fixed{
    position:fixed; top:8px; right:12px; z-index:2147483000;
    display:inline-flex; gap:6px; align-items:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  }
  .auth-slot-fixed .btn{
    background:#1f6feb; color:#fff; border:none; border-radius:8px;
    padding:6px 10px; cursor:pointer; font-size:12px;
  }
  .auth-slot-fixed .badge{
    padding:.15rem .5rem; background:#1f6feb; color:#fff;
    border-radius:10px; font-size:12px;
  }`;
  const s = h('style', { id:'auth-css' }); s.textContent = css;
  document.head.appendChild(s);
}

function pickMount(){
  return (
    document.querySelector('#app-title-right') ||
    document.querySelector('#app-title') ||
    document.querySelector('header .title') ||
    document.querySelector('#topbar') ||
    document.querySelector('header') ||
    document.querySelector('#header') ||
    document.body
  );
}

function renderAuthUi(){
  cleanupAuthUINodes();
  ensureStyle();

  let slot = document.getElementById('auth-slot');
  if(!slot){
    const mount = pickMount();
    slot = h('span', { id:'auth-slot', className:'auth-slot-fixed', dataset:{ lmyAuth:'' }});
    mount.append(slot);
  }
  slot.innerHTML = '';
  if(accessToken){
    slot.append(
      h('span', { className:'badge', textContent:'Signed in' }),
      h('button', { className:'btn', textContent:'Sign out', onclick: signOut }),
    );
  }else{
    slot.append(h('button', { className:'btn', textContent:'Sign in', onclick: signIn }));
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
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [
      'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
      'https://sheets.googleapis.com/$discovery/rest?version=v4',
    ],
  });
  gapiInited = true;
}

function ensureTokenClient(){
  if(tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPES, prompt: 'consent',
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

// ----- exports -----
export async function ensureLoaded(){ await loadGapi(); ensureTokenClient(); }
export async function initAuthUI(){ renderAuthUi(); }
export async function signIn(){ await ensureLoaded(); tokenClient.requestAccessToken(); }
export function signOut(){
  if(!accessToken) return;
  try{ google.accounts.oauth2.revoke(accessToken); }catch{}
  gapi.client.setToken(null);
  accessToken = null;
  renderAuthUi();
}
export function isAuthed(){ return !!accessToken; }

// 後方互換
if(!window.__LMY_auth){
  window.__LMY_auth = { init: initAuthUI, signIn, signOut, isAuthed, ensureLoaded };
}

// 初期描画
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', ()=> initAuthUI());
}else{
  initAuthUI();
}
