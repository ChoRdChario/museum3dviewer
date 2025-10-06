// gauth.js — robust wiring + diagnostics (no new files; minimal invasive)
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
};

let tokenClient = null;
let accessToken = null;
let gapiInited = false;
let gisReady = false;

function qsAllButtons() {
  // 探索範囲を広げる（ID/クラス/データ属性）
  const sel = [
    '#auth-btn',
    '[data-auth-btn]',
    '[data-role="auth-btn"]',
    '.auth-btn',
    '#signin', '.signin',
    'button[name="signin"]',
    'button[data-auth]'
  ].join(',');
  const list = Array.from(document.querySelectorAll(sel)).filter(el => el instanceof HTMLButtonElement);
  return list;
}
function getChip() {
  return document.getElementById('auth-chip') || document.querySelector('.auth-chip,[data-auth-chip]');
}

function refreshUI(signed) {
  const chip = getChip();
  const btns = qsAllButtons();
  if (chip) {
    chip.className = signed ? 'chip signed' : 'chip';
    chip.textContent = signed ? 'Signed in' : 'Signed out';
  }
  btns.forEach(btn => {
    btn.disabled = false;
    btn.textContent = signed ? 'Sign out' : (btn.dataset.labelSignin || 'Sign in');
  });
}

function waitForGapi(timeoutMs=10000) {
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
function waitForGIS(timeoutMs=10000) {
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

// クリックにワイヤリング
function wireButtons() {
  const btns = qsAllButtons();
  if (!btns.length) {
    console.warn('[auth] no auth button found — add id="auth-btn" or data-auth-btn to a <button>.');
    return;
  }
  btns.forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.replaceWith(clone);
  });
  const fresh = qsAllButtons();
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

  try {
    await waitForGapi();
    console.log('[auth] gapi script detected');
  } catch (e) {
    console.error('[auth] gapi load timeout', e);
  }
  try {
    await waitForGIS();
    console.log('[auth] GIS script detected');
  } catch (e) {
    console.error('[auth] GIS load timeout', e);
  }

  await initGapiClient();
  await initGIS();

  wireButtons();

  app.auth = {
    isSignedIn: () => !!accessToken,
    getAccessToken: () => accessToken,
    _debug: () => ({ accessToken, gapiInited, gisReady })
  };
}
