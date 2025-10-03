// features/auth.js  (v6.6.2)
// Visible Auth UI in two places: floating chip (top-right) + sidebar fallback (#side).
// GIS + GAPI bootstrap included.

const API_KEY = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' ');

let tokenClient = null;
let gapiReady = false;
let gisReady = false;

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
        gapiReady = true;
        resolve();
      } catch (e) { reject(e); }
    });
  });
}

function initGis() {
  if (!window.google?.accounts?.oauth2) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error) { console.warn('[auth] token error', response); return; }
      console.log('[auth] token acquired');
      document.dispatchEvent(new CustomEvent('auth:signed-in'));
      renderAuthUIs();
    }
  });
  gisReady = true;
}

export async function ensureLoaded() {
  if (!gapiReady) await loadGapiClient().catch(e=>{ console.warn('[auth] gapi load failed', e); });
  if (!gisReady) initGis();
}

export function signIn(prompt = 'consent') {
  if (!tokenClient) initGis();
  try {
    tokenClient?.requestAccessToken({ prompt });
  } catch (e) {
    console.warn('[auth] requestAccessToken failed', e);
  }
}
export function signOut() {
  try {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token);
      gapi.client.setToken(null);
    }
  } catch {}
  console.log('[auth] signed out');
  document.dispatchEvent(new CustomEvent('auth:signed-out'));
  renderAuthUIs();
}
export function isSignedIn() {
  try { return !!gapi.client.getToken(); } catch { return false; }
}

export async function initAuthUI() {
  renderAuthUIs();
}

// ===== UI Rendering (floating + sidebar fallback) =====

function renderAuthUIs() {
  renderFloatingChip();
  renderSidebarChip();
}

function renderFloatingChip() {
  let bar = document.getElementById('auth-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'auth-bar';
    Object.assign(bar.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: 999999,
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      background: 'rgba(0,0,0,0.55)',
      padding: '8px 10px',
      borderRadius: '10px',
      backdropFilter: 'blur(4px)',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      pointerEvents: 'auto'
    });
    document.body.appendChild(bar);
  }
  bar.innerHTML = '';
  bar.appendChild(makeStatusSpan());
  bar.appendChild(makeBtn('Sign in', () => signIn(isSignedIn() ? '' : 'consent'), isSignedIn()));
  bar.appendChild(makeBtn('Sign out', () => signOut(), !isSignedIn()));
}

function renderSidebarChip() {
  const side = document.getElementById('side');
  if (!side) return;
  let box = document.getElementById('auth-box-side');
  if (!box) {
    box = document.createElement('div');
    box.id = 'auth-box-side';
    box.style.margin = '8px 0 12px 0';
    box.style.display = 'flex';
    box.style.gap = '6px';
    box.style.alignItems = 'center';
    side.prepend(box);
  }
  box.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = 'Google:';
  label.style.opacity = '0.8';
  box.appendChild(label);
  box.appendChild(makeStatusSpan());
  box.appendChild(makeBtn('Sign in', () => signIn(isSignedIn() ? '' : 'consent'), isSignedIn()));
  box.appendChild(makeBtn('Sign out', () => signOut(), !isSignedIn()));
}

function makeStatusSpan() {
  const status = document.createElement('span');
  status.textContent = isSignedIn() ? 'Signed in' : 'Signed out';
  status.style.opacity = '0.85';
  status.style.minWidth = '72px';
  return status;
}
function makeBtn(text, onClick, disabled) {
  const b = document.createElement('button');
  b.textContent = text;
  Object.assign(b.style, {
    background: '#1f6feb', color: '#fff', border: 'none', borderRadius: '8px',
    padding: '6px 10px', cursor: 'pointer'
  });
  b.disabled = !!disabled;
  b.onclick = onClick;
  return b;
}

// Debug helpers
window.__LMY_authDebug = () => {
  console.log('[authDebug]', {
    gapi: !!window.gapi, google: !!window.google, oauth2: !!window.google?.accounts?.oauth2,
    token: (()=>{ try { return !!gapi.client.getToken(); } catch { return false; } })(),
    bar: !!document.getElementById('auth-bar'), side: !!document.getElementById('auth-box-side')
  });
  renderAuthUIs();
};

window.addEventListener('DOMContentLoaded', () => {
  renderAuthUIs();
});
