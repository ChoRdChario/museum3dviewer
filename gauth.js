// gauth.js — self-loading GIS/gapi + robust popup wiring (no新規ファイル).
// このファイルだけで gsi/client と api.js のロードまで面倒を見ます。

const CONFIG = {
  CLIENT_ID: '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com',
  API_KEY: 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI',
  SCOPES: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' '),
  DISCOVERY_DOCS: [
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    'https://sheets.googleapis.com/$discovery/rest?version=v4',
  ],
  GIS_SRC: 'https://accounts.google.com/gsi/client',
  GAPI_SRC: 'https://apis.google.com/js/api.js',
};

let tokenClient = null;
let accessToken = null;
let gapiInited = false;
let gisReady = false;

function ensureScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    // 既に読み込み済みなら即resolve
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    Object.entries(attrs).forEach(([k,v]) => s.setAttribute(k, v));
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
}

function waitForGapi(timeoutMs=12000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      if (window.gapi && gapi.load) return resolve();
      if (performance.now() - t0 > timeoutMs) return reject(new Error('gapi not loaded'));
      setTimeout(tick, 60);
    };
    tick();
  });
}
function waitForGIS(timeoutMs=12000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      if (performance.now() - t0 > timeoutMs) return reject(new Error('GIS not loaded'));
      setTimeout(tick, 60);
    };
    tick();
  });
}

async function initGapiClient() {
  if (gapiInited) return;
  await new Promise((res, rej) => gapi.load('client', { callback: res, onerror: rej }));
  await gapi.client.init({
    apiKey: CONFIG.API_KEY,
    discoveryDocs: CONFIG.DISCOVERY_DOCS,
  });
  gapiInited = true;
  console.log('[auth] gapi ready');
}

async function initGIS() {
  if (gisReady && tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: () => {}, // set at click
  });
  gisReady = true;
  console.log('[auth] GIS ready');
}

function authButtons() {
  const sel = [
    '#auth-btn',
    '[data-auth-btn]',
    '[data-role="auth-btn"]',
    '.auth-btn',
    '#signin', '.signin',
    'button[name="signin"]',
    'button[data-auth]'
  ].join(',');
  return Array.from(document.querySelectorAll(sel)).filter(el => el instanceof HTMLButtonElement);
}
function authChip() {
  return document.getElementById('auth-chip') || document.querySelector('.auth-chip,[data-auth-chip]');
}

function refreshUI(signed) {
  const chip = authChip();
  const btns = authButtons();
  if (chip) {
    chip.className = signed ? 'chip signed' : 'chip';
    chip.textContent = signed ? 'Signed in' : 'Signed out';
  }
  btns.forEach(btn => {
    btn.disabled = false;
    btn.textContent = signed ? 'Sign out' : (btn.dataset.labelSignin || 'Sign in');
  });
}

async function verifyTokenWorks() {
  const resp = await gapi.client.drive.about.get({ fields: 'user(emailAddress,displayName)' });
  return resp?.result?.user;
}

async function doSignOut() {
  if (!accessToken) { refreshUI(false); return; }
  try { await new Promise(res => google.accounts.oauth2.revoke(accessToken, res)); }
  catch(e) { console.warn('[auth] revoke error', e); }
  accessToken = null;
  gapi.client.setToken(null);
  refreshUI(false);
  console.log('[auth] signed out');
}

function wireButtons() {
  const btns = authButtons();
  if (!btns.length) {
    console.warn('[auth] no auth button found — add id="auth-btn" or data-auth-btn to a <button>.');
    return;
  }
  btns.forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.replaceWith(clone);
  });
  const fresh = authButtons();
  fresh.forEach(btn => {
    btn.addEventListener('click', () => {
      console.log('[auth] button click');
      if (accessToken) { doSignOut(); return; }

      btn.disabled = true;
      btn.textContent = 'Opening popup...';

      tokenClient.callback = async (resp) => {
        try {
          console.log('[auth] callback:', resp && Object.keys(resp).join(','));
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            gapi.client.setToken({ access_token: accessToken });
            try {
              const user = await verifyTokenWorks();
              console.log('[auth] verified as', user);
              refreshUI(true);
            } catch (e) {
              console.error('[auth] verify failed', e);
              accessToken = null;
              gapi.client.setToken(null);
              refreshUI(false);
              alert('Authorization failed. Check OAuth origins/consent.');
            }
          } else {
            refreshUI(false);
          }
        } finally {
          if (!accessToken) { btn.disabled = false; btn.textContent = btn.dataset.labelSignin || 'Sign in'; }
        }
      };

      try {
        tokenClient.requestAccessToken({ prompt: 'select_account consent' });
        console.log('[auth] popup requested');
      } catch (e) {
        console.error('[auth] requestAccessToken error', e);
        btn.disabled = false;
        btn.textContent = btn.dataset.labelSignin || 'Sign in';
      }
    }, { once: false });
  });
  console.log(`[auth] wired ${fresh.length} button(s)`);
}

export async function setupAuth(app) {
  refreshUI(false);

  // 1) 必要スクリプトが無ければ自力で挿入
  try {
    await ensureScript(CONFIG.GIS_SRC);
    console.log('[auth] GIS script tag ok');
  } catch(e) {
    console.error('[auth] failed to insert GIS script', e);
  }
  try {
    await ensureScript(CONFIG.GAPI_SRC);
    console.log('[auth] gapi script tag ok');
  } catch(e) {
    console.error('[auth] failed to insert gapi script', e);
  }

  // 2) 読み込み完了を待つ
  try {
    await waitForGIS();
    console.log('[auth] GIS script detected');
  } catch (e) {
    console.error('[auth] GIS load timeout', e);
  }
  try {
    await waitForGapi();
    console.log('[auth] gapi script detected');
  } catch (e) {
    console.error('[auth] gapi load timeout', e);
  }

  // 3) クライアント初期化
  await initGapiClient();
  await initGIS();

  // 4) ボタン配線
  wireButtons();

  // 5) appへ公開
  app.auth = {
    isSignedIn: () => !!accessToken,
    getAccessToken: () => accessToken,
  };
}
