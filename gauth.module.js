// gauth.module.js (LM stable)
// Provides named export `getAccessToken` expected by boot.esm.cdn.js.
// Also exposes ensureToken/signIn/signOut helpers, but does NOT force an
// interactive consent flow on page load (UI側のボタンから呼べる前提).

const TOKEN_KEY = '__LM_TOK';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function readStoredToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function writeStoredToken(tok) {
  try { 
    if (tok) sessionStorage.setItem(TOKEN_KEY, tok);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
  if (!window.__LM_OAUTH) window.__LM_OAUTH = {};
  window.__LM_OAUTH.access_token = tok || null;
}

/** Load GIS script lazily */
function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const id = 'lm-gis-script';
    if (document.getElementById(id)) {
      // wait until available
      const t = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(t); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(t); resolve(); }, 2000);
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => {
      // small wait for global to settle
      const t = setInterval(() => {
        if (window.google?.accounts?.oauth2) { clearInterval(t); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(t); resolve(); }, 2000);
    };
    s.onerror = () => reject(new Error('GIS_LOAD_FAILED'));
    document.head.appendChild(s);
  });
}

/** Try to infer client_id from window or meta tag (do not hardcode here) */
function inferClientId() {
  return (
    window.__LM_CLIENT_ID ||
    (window.__LM_OAUTH && window.__LM_OAUTH.client_id) ||
    document.querySelector('meta[name="google-signin-client_id"]')?.content ||
    null
  );
}

/** Ensure token; interactive=false by default to avoid surprise prompts */
export async function ensureToken({ interactive = false, scope = SCOPE } = {}) {
  // 1) already in memory or storage
  const memTok = window.__LM_OAUTH?.access_token || readStoredToken();
  if (memTok) return memTok;

  if (!interactive) return null; // caller may switch to interactive later

  // 2) interactive flow via GIS
  await loadGIS();
  const client_id = inferClientId();
  if (!client_id) throw new Error('NO_CLIENT_ID');

  const token = await new Promise((resolve, reject) => {
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id,
        scope,
        callback: (resp) => {
          if (resp && resp.access_token) resolve(resp.access_token);
          else reject(new Error('NO_TOKEN'));
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      reject(e);
    }
  });

  writeStoredToken(token);
  return token;
}

/** Named export expected by boot.esm.cdn.js */
export function getAccessToken() {
  // Do NOT trigger interactive flow here; return current token if any.
  const tok = window.__LM_OAUTH?.access_token || readStoredToken();
  return tok || null;
}

/** Optional helpers for UI buttons */
export async function signIn() {
  const tok = await ensureToken({ interactive: true });
  return tok;
}

export function signOut() {
  const tok = readStoredToken();
  writeStoredToken(null);
  try {
    // Optional: revoke is not strictly necessary for Sheets usage
    if (tok && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(tok, () => {});
    }
  } catch {}
}

export const __LM_AUTH = { ensureToken, getAccessToken, signIn, signOut };

// Initialize in-memory mirror from storage on module load
writeStoredToken(readStoredToken());
