// LociMyu boot.esm.cdn.js (auth+GLB minimal, robust client_id resolver)
// VERSION: V6_11_GLBAUTH_MIN_SAFE
(() => {
  const TAG = '[LM-boot.min]';

  // Small helpers
  const $ = (id) => document.getElementById(id);
  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);
  const err  = (...args) => console.error(TAG, ...args);

  // ---------- Resolve client_id & scopes ----------
  function pickMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el && el.getAttribute('content') || '';
  }
  function resolveClientId() {
    // priority: explicit global -> common meta names -> data attr on #app
    const fromGlobal = (window.GIS_CLIENT_ID || window.__LM_CLIENT_ID || '').trim();
    if (fromGlobal) return fromGlobal;

    const fromMeta =
      pickMeta('google-signin-client_id') || // legacy
      pickMeta('gis-client-id') ||           // our convention
      pickMeta('client_id');                 // fallback

    if (fromMeta) return fromMeta.trim();

    const app = document.getElementById('app');
    const fromData = (app && (app.dataset.gisClientId || app.dataset.clientId)) || '';
    if (fromData) return String(fromData).trim();

    throw new Error('Missing client_id');
  }

  const SCOPES = (window.GIS_SCOPES ||
    'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets').trim();

  // ---------- Load GIS once ----------
  let _gisLoading;
  function loadGIS() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (_gisLoading) return _gisLoading;
    _gisLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => { log('GIS loaded'); res(); };
      s.onerror = () => rej(new Error('GIS load failed'));
      document.head.appendChild(s);
    });
    return _gisLoading;
  }

  // ---------- Token client (single-flight) ----------
  let _tokenClient, _inflight;
  function singleFlight(key, fn) {
    if (_inflight && _inflight.key === key) return _inflight.p;
    const p = Promise.resolve().then(fn).finally(() => { if (_inflight && _inflight.key === key) _inflight = null; });
    _inflight = { key, p };
    return p;
  }

  async function ensureTokenClient() {
    return singleFlight('ensureTokenClient', async () => {
      await loadGIS();
      const client_id = resolveClientId();
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id,
        scope: SCOPES,
        callback: () => {}
      });
      return _tokenClient;
    });
  }

  // Public: get access token
  window.__lm_getAccessToken = async function() {
    try {
      await ensureTokenClient();
    } catch(e) {
      warn('signin failed:', e.message || e);
      throw e;
    }
    return new Promise((resolve) => {
      _tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          log('signin ok');
          resolve(resp.access_token);
        } else {
          warn('signin canceled or no token', resp);
          resolve('');
        }
      };
      _tokenClient.requestAccessToken();
    });
  };

  // ---------- GLB wire (emit only) ----------
  function emit(e, detail) {
    window.dispatchEvent(new CustomEvent(e, { detail }));
  }
  function installGlbResolver() {
    // listen to our tiny "glb load" signal (from external helpers)
    window.addEventListener('lm:glb-load', async (ev) => {
      const src = ev?.detail;
      log(['glb signal', src]);
      if (!src) return;

      // Google Drive share link -> file id
      const m = String(src).match(/\/d\/([a-zA-Z0-9_-]{10,})\//);
      if (m) {
        // authenticate & stream to blob URL (viewer expects a URL)
        try {
          const token = await window.__lm_getAccessToken();
          const dl = `https://www.googleapis.com/drive/v3/files/${m[1]}?alt=media`;
          const resp = await fetch(dl, { headers: { Authorization: `Bearer ${token}` }});
          if (!resp.ok) throw new Error(`drive fetch ${resp.status}`);
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          log(['glb resolved -> blob:', url]);
          emit('lm:model-url', url);      // viewer should be listening to this
          return;
        } catch(e) {
          err('drive fetch failed', e);
        }
      }

      // Otherwise pass-through
      emit('lm:model-url', src);
    });
    log('glb resolver installed');
  }

  // ---------- Wire UI ----------
  function wireUI() {
    const btnSignin = $('auth-signin');
    const btnGlb = $('btnGlb');
    const input = $('glbUrl');

    btnSignin && btnSignin.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await window.__lm_getAccessToken(); } catch(e) { err(e); }
    }, { capture:true });

    const doLoad = () => {
      const url = input?.value?.trim();
      if (url) emit('lm:glb-load', url);
    };
    btnGlb && btnGlb.addEventListener('click', (e) => { e.preventDefault(); doLoad(); }, { capture:true });
    input && input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLoad(); });

    log(['wired #auth-signin']);
    log(['wired #btnGlb']);
    log(['wired #glbUrl[Enter]']);
  }

  // ---------- Boot ----------
  function boot() {
    log('auth shim ready');
    wireUI();
    installGlbResolver();
    log(['boot safe stub ready']);
  }
  (document.readyState === 'loading') ? document.addEventListener('DOMContentLoaded', boot) : boot();

  // Debug aid for your console: try to re-pick client id
  window.__LM_DEBUG = Object.assign(window.__LM_DEBUG || {}, {
    pickClientIdFromDOM: () => {
      try { return resolveClientId(); } catch { return ''; }
    }
  });
})();
