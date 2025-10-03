// features/auth.js
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
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error) return console.warn('[auth] token error', response);
      console.log('[auth] token acquired');
      document.dispatchEvent(new CustomEvent('auth:signed-in'));
      renderAuthUi();
    }
  });
  gisReady = true;
}

export async function ensureLoaded() {
  if (!gapiReady) await loadGapiClient();
  if (!gisReady) initGis();
}

export function signIn(prompt = 'consent') {
  if (!tokenClient) initGis();
  tokenClient.requestAccessToken({ prompt });
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
  renderAuthUi();
}
export function isSignedIn() {
  try { return !!gapi.client.getToken(); } catch { return false; }
}
export async function initAuthUI() {
  await ensureLoaded();
  renderAuthUi();
}

function renderAuthUi() {
  let bar = document.getElementById('auth-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'auth-bar';
    Object.assign(bar.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: 9999,
      display: 'flex', gap: '8px', alignItems: 'center',
      background: 'rgba(0,0,0,0.5)', padding: '8px 10px', borderRadius: '10px',
      backdropFilter: 'blur(4px)', color: '#fff', fontFamily: 'system-ui, sans-serif', fontSize: '12px'
    });
    document.body.appendChild(bar);
  }
  bar.innerHTML = '';
  const status = document.createElement('span');
  status.textContent = isSignedIn() ? 'Signed in' : 'Signed out';
  status.style.opacity = '0.8';

  const btnIn = document.createElement('button');
  btnIn.textContent = 'Sign in';
  styleBtn(btnIn);
  btnIn.disabled = isSignedIn();
  btnIn.onclick = () => signIn(isSignedIn() ? '' : 'consent');

  const btnOut = document.createElement('button');
  btnOut.textContent = 'Sign out';
  styleBtn(btnOut);
  btnOut.disabled = !isSignedIn();
  btnOut.onclick = () => signOut();

  bar.appendChild(status);
  bar.appendChild(btnIn);
  bar.appendChild(btnOut);
}
function styleBtn(b) {
  Object.assign(b.style, { background: '#1f6feb', color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' });
  b.onmouseenter = () => b.style.opacity = '0.9';
  b.onmouseleave = () => b.style.opacity = '1';
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.gapi && window.google && window.google.accounts && window.google.accounts.oauth2) {
    initAuthUI();
  }
});
