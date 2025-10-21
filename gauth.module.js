
// gauth.module.js
// Minimal GIS-based token manager for Sheets API (fetch direct).
// - Loads Google Identity Services (GIS) script
// - Exposes window.__LM_OAUTH with ensureToken/getToken/clearToken
// - Publishes 'lm:oauth-ready' when a valid token is available
// - Stores token in sessionStorage ('__LM_TOK') until page unload

(() => {
  const NS = '__LM_OAUTH';
  if (window[NS]?.__installed) return;

  const STATE = {
    token: null,
    clientId: null,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    tokenClient: null,
  };

  const saveToken = (tok) => {
    STATE.token = tok || null;
    try {
      if (tok) sessionStorage.setItem('__LM_TOK', tok);
      else sessionStorage.removeItem('__LM_TOK');
    } catch {}
    if (tok) {
      window.dispatchEvent(new CustomEvent('lm:oauth-ready', { detail: { access_token: tok } }));
    }
  };

  const loadSaved = () => {
    try {
      const t = sessionStorage.getItem('__LM_TOK');
      if (t) STATE.token = t;
    } catch {}
  };

  const inferClientId = () => {
    // Priority: window.GOOGLE_CLIENT_ID → <meta name="google-signin-client_id"> → localStorage
    if (typeof window.GOOGLE_CLIENT_ID === 'string' && window.GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com')) {
      return window.GOOGLE_CLIENT_ID;
    }
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content && meta.content.includes('.apps.googleusercontent.com')) {
      return meta.content;
    }
    try {
      const fromLS = localStorage.getItem('__LM_GOOGLE_CLIENT_ID');
      if (fromLS && fromLS.includes('.apps.googleusercontent.com')) return fromLS;
    } catch {}
    return null;
  };

  const loadGIS = () => new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load GIS'));
    document.head.appendChild(s);
  });

  const initTokenClient = async () => {
    if (STATE.tokenClient) return;
    await loadGIS();
    STATE.clientId = inferClientId();
    if (!STATE.clientId) {
      console.warn('[gauth] GOOGLE_CLIENT_ID not found. Set window.GOOGLE_CLIENT_ID or a <meta name="google-signin-client_id">.');
      return;
    }
    STATE.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: STATE.clientId,
      scope: STATE.scope,
      callback: (resp) => {
        if (resp && resp.access_token) {
          saveToken(resp.access_token);
        } else {
          console.warn('[gauth] token callback without token', resp);
        }
      }
    });
  };

  // Public API
  const api = {
    __installed: true,
    getToken() {
      return STATE.token || null;
    },
    async ensureToken({ interactive = false } = {}) {
      loadSaved();
      if (STATE.token) {
        return STATE.token;
      }
      await initTokenClient();
      if (!STATE.tokenClient) {
        // no client id → cannot proceed
        return null;
      }
      try {
        // Try silent first, unless explicitly interactive requested
        await new Promise((resolve) => {
          STATE.tokenClient.callback = (resp) => {
            if (resp && resp.access_token) saveToken(resp.access_token);
            resolve();
          };
          STATE.tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
        });
      } catch (e) {
        console.warn('[gauth] ensureToken error', e);
        return null;
      }
      return STATE.token || null;
    },
    clearToken() {
      saveToken(null);
    }
  };

  // Attach
  window[NS] = api;

  // Early silent attempt on boot
  (async () => {
    await api.ensureToken({ interactive: false });
  })().catch(() => {});

  console.log('[gauth] installed');
})();
