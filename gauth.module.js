// gauth.module.js - token bridge + GIS flow (2025-10-07)
const CFG = {
  CLIENT_ID: window.CLIENT_ID || "595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com",
  API_KEY: window.API_KEY || "AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI",
  SCOPES: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets"
  ].join(" "),
  DISCOVERY_DOCS: [
    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4"
  ]
};

function uniq(arr){ return Array.from(new Set(arr.filter(Boolean))); }
function isVisible(el){ return !!(el && el.offsetParent !== null); }

function findAuthChips(){
  const bySelectors = [
    '#authChip','[data-auth=\"chip\"]','#topSignInBtn','button.signin','.auth-chip',
    '.topbar .chip','.topbar button','header .chip','header button'
  ].flatMap(sel => Array.from(document.querySelectorAll(sel)));
  const textMatches = Array.from(document.querySelectorAll('header *, .topbar *'))
    .filter(el => /sign\s*in/i.test(el.textContent || ''));
  let candidates = uniq([...bySelectors, ...textMatches]).filter(isVisible);
  const prefer = candidates.find(el => el.closest('.topbar, header'));
  if (prefer) candidates = uniq([prefer, ...candidates]);
  return candidates;
}

async function loadGapiIfNeeded(){
  if (window.gapi?.client) return;
  await new Promise((resolve, reject) => {
    if (!window.gapi?.load) return reject(new Error('[gauth] gapi not loaded. Include <script src=\"https://apis.google.com/js/api.js\"></script>'));
    window.gapi.load('client', { callback: resolve, onerror: () => reject(new Error('[gauth] gapi.load failed')) });
  });
  await window.gapi.client.init({ apiKey: CFG.API_KEY, discoveryDocs: CFG.DISCOVERY_DOCS });
}

function ensureGIS(){
  const gis = window.google?.accounts?.oauth2;
  if (!gis) throw new Error('[gauth] Google Identity Services not loaded. Include <script src=\"https://accounts.google.com/gsi/client\" async defer></script>');
  return gis;
}

export function setupAuth({ chip, onReady, onSignedIn, onSignedOut } = {}) {
  const chips = uniq([chip, ...findAuthChips()]).filter(Boolean);
  if (!chips.length) throw new Error('[gauth] no auth chip/button found');
  const primary = chips[0];
  chips.slice(1).forEach(el => { try { el.style.display = 'none'; } catch {} });

  const state = { signedIn: false, tokenClient: null };

  function paint(el){
    if (!el) return;
    const wantText = state.signedIn ? 'Signed in' : 'Sign in';
    el.classList.toggle?.('ok', state.signedIn);
    el.classList.toggle?.('warn', !state.signedIn);
    if ((el.textContent || '').trim().toLowerCase() !== wantText.toLowerCase()){
      el.textContent = wantText;
    }
    el.setAttribute?.('aria-pressed', state.signedIn ? 'true' : 'false');
    if (el.tagName === 'BUTTON' && !el.type) el.type = 'button';
  }
  function refresh(){ paint(primary); }

  function setSignedIn(v){
    state.signedIn = !!v;
    refresh();
    if (state.signedIn) onSignedIn?.(); else onSignedOut?.();
  }

  async function beginGoogleSignIn(){
    try {
      const gis = ensureGIS();
      if (!state.tokenClient){
        state.tokenClient = gis.initTokenClient({
          client_id: CFG.CLIENT_ID,
          scope: CFG.SCOPES,
          callback: async (resp) => {
            if (resp.error) { console.error('[gauth] token error', resp); return; }
            try {
              // 1) Remember token for modules that don't use gapi directly
              window.ACCESS_TOKEN = resp.access_token;
              document.dispatchEvent(new CustomEvent('auth:token', { detail: { access_token: resp.access_token }}));

              // 2) Init gapi client and propagate token (if your utils use gapi.client.getToken)
              await loadGapiIfNeeded();
              if (window.gapi?.client?.setToken) {
                window.gapi.client.setToken({ access_token: resp.access_token });
              }
              setSignedIn(true);
              console.log('[gauth] signed in (token acquired)');
            } catch (e) {
              console.error('[gauth] post-token init failed', e);
            }
          }
        });
      }
      const haveToken = !!(window.gapi?.client?.getToken?.()?.access_token);
      state.tokenClient.requestAccessToken({ prompt: haveToken ? '' : 'consent' });
    } catch (e) {
      console.error('[gauth] sign-in start failed', e);
    }
  }

  function onChipClick(ev){
    ev.preventDefault();
    beginGoogleSignIn();
  }

  primary.removeEventListener('click', onChipClick);
  primary.addEventListener('click', onChipClick);

  // Optional global for backward compatibility
  window.beginGoogleSignIn = beginGoogleSignIn;
  window.getAccessToken = function(){
    return window.gapi?.client?.getToken?.()?.access_token || window.ACCESS_TOKEN || null;
  };

  refresh();
  onReady?.();

  return {
    isSignedIn(){ return !!state.signedIn; },
    setSignedIn,
    refresh,
    element: primary
  };
}
