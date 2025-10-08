// gauth.module.js — patched to read meta/config and load GIS
let tokenResponse = null;
let client = null;
let _apiKey = null;

function readMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el?.content || null;
}

function resolveClientId() {
  const meta = readMeta('google-oauth-client_id');
  if (meta) return meta;
  if (globalThis.__CONFIG?.GOOGLE_OAUTH_CLIENT_ID) return globalThis.__CONFIG.GOOGLE_OAUTH_CLIENT_ID;
  const literal = "%GOOGLE_OAUTH_CLIENT_ID%";
  return literal.startsWith("%") ? null : literal;
}

export function getApiKey() {
  if (_apiKey) return _apiKey;
  _apiKey = readMeta('google-api-key') || globalThis.__CONFIG?.GOOGLE_API_KEY || null;
  return _apiKey;
}

export function getAccessToken() {
  return tokenResponse?.access_token || null;
}

export function signOut() {
  const t = getAccessToken();
  tokenResponse = null;
  try { globalThis.google?.accounts?.oauth2?.revoke?.(t); } catch {}
}

async function ensureGIS(timeoutMs = 8000) {
  if (globalThis.google?.accounts?.oauth2) return true;
  if (!Array.from(document.scripts).some(s => /accounts\.google\.com\/gsi\/client/.test(s.src))) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (globalThis.google?.accounts?.oauth2) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  console.warn('[auth] Google Identity Services not loaded; using stub');
  return false;
}

export async function setupAuth(buttonEl, onAuthChange) {
  const client_id = resolveClientId();
  _apiKey = getApiKey();

  const ok = await ensureGIS();
  const scope = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  function updateLabel() {
    if (!buttonEl) return;
    buttonEl.textContent = tokenResponse ? 'Sign out' : 'Sign in';
  }

  if (!ok || !client_id) {
    console.warn('[auth] setup running in stub mode (client_id missing or GIS not ready)');
    updateLabel();
    buttonEl?.addEventListener('click', () => console.warn('[auth] sign-in clicked (stub)'));
    return;
  }

  client = google.accounts.oauth2.initTokenClient({
    client_id,
    scope,
    callback: (resp) => {
      tokenResponse = resp;
      onAuthChange?.(!!tokenResponse, tokenResponse);
      updateLabel();
    }
  });

  updateLabel();

  buttonEl.onclick = () => {
    if (!tokenResponse) {
      client.requestAccessToken();
    } else {
      signOut();
      onAuthChange?.(false, null);
      updateLabel();
    }
  };
}
