// gauth.js — GIS token flow with guaranteed user-gesture popup and post-auth verification
// Requires in index.html:
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
let gapiInited = false;
let gisReady = false;

function getEls() {
  return {
    chip: document.getElementById('auth-chip'),
    btn: document.getElementById('auth-btn'),
  };
}

function refreshUI(state) {
  const { chip, btn } = getEls();
  if (chip) {
    chip.className = state ? 'chip signed' : 'chip';
    chip.textContent = state ? 'Signed in' : 'Signed out';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = state ? 'Sign out' : 'Sign in';
  }
}

function waitForGapi() {
  return new Promise((resolve) => {
    const tick = () => (window.gapi && gapi.load) ? resolve() : setTimeout(tick, 30);
    tick();
  });
}
function waitForGIS() {
  return new Promise((resolve) => {
    const ok = (window.google && google.accounts && google.accounts.oauth2);
    if (ok) return resolve();
    const tick = () => (window.google && google.accounts && google.accounts.oauth2) ? resolve() : setTimeout(tick, 30);
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
}

async function initGIS() {
  if (gisReady && tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: () => {}, // will be set just-in-time before request
  });
  gisReady = true;
}

async function verifyTokenWorks() {
  // Drive About を読めれば正しく認可済み
  const resp = await gapi.client.drive.about.get({ fields: 'user(emailAddress,displayName)' });
  return resp?.result?.user;
}

async function doSignOut() {
  if (!accessToken) { refreshUI(false); return; }
  try {
    await new Promise((resolve) => google.accounts.oauth2.revoke(accessToken, resolve));
  } catch (e) {
    console.warn('[auth] revoke error', e);
  } finally {
    accessToken = null;
    gapi.client.setToken(null);
    refreshUI(false);
  }
}

export async function setupAuth(app) {
  const { btn } = getEls();
  refreshUI(false);

  await Promise.all([ waitForGapi(), waitForGIS() ]);
  await initGapiClient();
  await initGIS();

  if (btn) {
    btn.onclick = null;
    btn.addEventListener('click', () => {
      if (accessToken) {
        doSignOut();
        return;
      }
      // --- Critical: call requestAccessToken IN the click event (no await before) ---
      btn.disabled = true;
      btn.textContent = 'Opening popup...';

      tokenClient.callback = async (resp) => {
        try {
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            gapi.client.setToken({ access_token: accessToken });

            // Verify by calling Drive
            try {
              const user = await verifyTokenWorks();
              console.log('[auth] verified as', user);
              refreshUI(true);
            } catch (e) {
              console.error('[auth] verify failed', e);
              accessToken = null;
              gapi.client.setToken(null);
              refreshUI(false);
              alert('Google authorization failed. Check OAuth origins & consent screen.');
            }
          } else {
            refreshUI(false);
          }
        } finally {
          // ensure button recovers
          const { btn: b } = getEls();
          if (b && !accessToken) { b.disabled = false; b.textContent = 'Sign in'; }
        }
      };

      try {
        // Force visible UX (account chooser + consent if needed)
        tokenClient.requestAccessToken({ prompt: 'select_account consent' });
      } catch (e) {
        console.error('[auth] requestAccessToken error', e);
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }, { once: false });
  }

  app.auth = {
    isSignedIn: () => !!accessToken,
    getAccessToken: () => accessToken,
  };
}
