// gauth.js — Google Identity Services + gapi (Drive/Sheets) proper popup flow
// 前提: index.html に以下の <script> が挿入済みであること：
// <script src="https://accounts.google.com/gsi/client" async defer></script>
// <script src="https://apis.google.com/js/api.js" async defer></script>

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
let gapiReady = false;
let gapiInited = false;
let gisReady = false;

function loadGapi() {
  return new Promise((resolve) => {
    if (window.gapi && gapi.load) {
      resolve();
      return;
    }
    const check = () => (window.gapi && gapi.load) ? resolve() : setTimeout(check, 50);
    check();
  });
}
function loadGIS() {
  return new Promise((resolve) => {
    if (window.google && google.accounts && google.accounts.oauth2) {
      resolve();
      return;
    }
    const check = () => (window.google && google.accounts && google.accounts.oauth2) ? resolve() : setTimeout(check, 50);
    check();
  });
}

async function initGapiClient() {
  if (gapiInited) return;
  await new Promise((res, rej) => {
    gapi.load('client', { callback: res, onerror: rej });
  });
  await gapi.client.init({
    apiKey: CONFIG.API_KEY,
    discoveryDocs: CONFIG.DISCOVERY_DOCS,
  });
  gapiInited = true;
  gapiReady = true;
}

async function initGIS() {
  if (gisReady && tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (resp) => {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        // UIをここでSIGNED INへ
        refreshChip(true);
        // gapi にトークンを渡す（以降 gapi.client.request が認可付きになる）
        gapi.client.setToken({ access_token: accessToken });
      } else {
        console.warn('[auth] no access_token in response', resp);
        refreshChip(false);
      }
    },
  });
  gisReady = true;
}

function getAuthElements() {
  const chip = document.getElementById('auth-chip');
  const btn = document.getElementById('auth-btn');
  return { chip, btn };
}

function refreshChip(signedIn) {
  const { chip, btn } = getAuthElements();
  if (chip) {
    chip.className = signedIn ? 'chip signed' : 'chip';
    chip.textContent = signedIn ? 'Signed in' : 'Signed out';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = signedIn ? 'Sign out' : 'Sign in';
  }
}

async function signInWithPopup() {
  if (!gisReady || !tokenClient) await initGIS();
  // prompt:'consent' を強制して確実にポップアップ表示
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function signOut() {
  if (!accessToken) { refreshChip(false); return; }
  try {
    // Revoke token
    await new Promise((resolve) => {
      google.accounts.oauth2.revoke(accessToken, () => resolve());
    });
  } catch(e) {
    console.warn('[auth] revoke failed', e);
  } finally {
    accessToken = null;
    gapi.client.setToken(null);
    refreshChip(false);
  }
}

export async function setupAuth(app) {
  // UI存在チェック（重複作成防止）
  const { chip, btn } = getAuthElements();
  if (!chip || !btn) {
    console.warn('[auth] UI not found (auth-chip, auth-btn)');
  }

  // 初期は必ずサインアウト状態表示
  refreshChip(false);

  // ライブラリ読み込みを待つ
  await Promise.all([ loadGapi(), loadGIS() ]);
  await initGapiClient();
  await initGIS();

  // クリック配線（既にある場合は一度removeしてから）
  if (btn) {
    btn.onclick = null;
    btn.addEventListener('click', async () => {
      if (accessToken) {
        await signOut();
      } else {
        // ボタン無反応に見えないように一瞬だけローディング表示
        btn.disabled = true;
        btn.textContent = 'Opening popup...';
        // ポップアップ起動
        signInWithPopup();
        // callbackでSigned inに切り替えるのでここでのUI更新はしない
        setTimeout(() => { if (!accessToken) { btn.disabled = false; btn.textContent = 'Sign in'; } }, 4000);
      }
    }, { once: false });
  }

  // app へAPIを露出
  app.auth = {
    isSignedIn: () => !!accessToken,
    getAccessToken: () => accessToken,
    signInWithPopup,
    signOut,
  };
}
