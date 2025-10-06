// gauth.js — self-loading + popup wiring + イベント通知（最小差分）
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
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    Object.entries(attrs).forEach(([k,v]) => s.setAttribute(k, v));
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script load failed: ' + src));
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

function ensureAuthWidgets() {
  let btns = authButtons();
  if (btns.length) return btns;
  const styleId = 'auth-auto-style';
  if (!document.getElementById(styleId)) {
    const st = document.createElement('style');
    st.id = styleId;
    st.textContent = `
    .auth-auto-wrap{position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;gap:8px;align-items:center;font-family:system-ui,Arial,sans-serif}
    .auth-auto-chip{padding:4px 8px;border-radius:12px;background:#eee;color:#333}
    .auth-auto-chip.signed{background:#2e7d32;color:#fff}
    .auth-auto-btn{padding:6px 10px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1)}
    .auth-auto-btn:disabled{opacity:.6;cursor:not-allowed}
    `;
    document.head.appendChild(st);
  }
  const wrap = document.createElement('div');
  wrap.className = 'auth-auto-wrap';
  const chip = document.createElement('div');
  chip.id = 'auth-chip';
  chip.className = 'auth-auto-chip';
  chip.textContent = 'Signed out';
  const btn = document.createElement('button');
  btn.id = 'auth-btn';
  btn.className = 'auth-auto-btn';
  btn.textContent = 'Sign in';
  wrap.appendChild(chip);
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
  console.log('[auth] auto-injected auth button');
  return [btn];
}

function refreshUI(signed) {
  const chip = authChip();
  const btns = authButtons();
  if (chip) {
    chip.className = signed ? (chip.className + ' signed') : chip.className.replace(/\bsigned\b/g,'');
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
  document.dispatchEvent(new CustomEvent('lmy:auth-signed-out'));
}

function wireButtons() {
  let btns = authButtons();
  if (!btns.length) btns = ensureAuthWidgets();
  btns.forEach(btn => {
    const clone = btn.cloneNode(true);
    clone.id = btn.id;
    clone.className = btn.className;
    clone.dataset.labelSignin = btn.dataset.labelSignin || '';
    clone.textContent = btn.textContent;
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
              document.dispatchEvent(new CustomEvent('lmy:auth-signed-in', { detail: { accessToken, user } }));
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

  try { await ensureScript(CONFIG.GIS_SRC); console.log('[auth] GIS script tag ok'); }
  catch(e) { console.error('[auth] failed to insert GIS script', e); }
  try { await ensureScript(CONFIG.GAPI_SRC); console.log('[auth] gapi script tag ok'); }
  catch(e) { console.error('[auth] failed to insert gapi script', e); }

  try { await waitForGIS(); console.log('[auth] GIS script detected'); }
  catch (e) { console.error('[auth] GIS load timeout', e); }
  try { await waitForGapi(); console.log('[auth] gapi script detected'); }
  catch (e) { console.error('[auth] gapi load timeout', e); }

  await initGapiClient();
  await initGIS();

  wireButtons();

  app.auth = {
    isSignedIn: () => !!accessToken,
    getAccessToken: () => accessToken,
  };
}
