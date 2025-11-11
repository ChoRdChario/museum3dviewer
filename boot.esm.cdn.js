/* LociMyu boot mini (auth + glb) 2025-11-12 */
(() => {
  const TAG = '[LM-boot.min]';

  // -------- Utility: safe loggers --------
  const log = (...a)=>{ try{ console.log(TAG, ...a);}catch(_){} };
  const warn = (...a)=>{ try{ console.warn(TAG, ...a);}catch(_){} };
  const err = (...a)=>{ try{ console.error(TAG, ...a);}catch(_){} };

  // -------- Auth shim (GIS) --------
  // Resolve Client ID from multiple well-known places
  function resolveClientId() {
    if (window.__LM_CLIENT_ID && typeof window.__LM_CLIENT_ID === 'string') return window.__LM_CLIENT_ID;

    // <meta name="google-signin-client_id" content="xxx.apps.googleusercontent.com">
    const m = document.querySelector('meta[name="google-signin-client_id"]');
    if (m && m.content) return m.content.trim();

    // window.__LM_CONFIG or window.lm?.config?.client_id
    const c1 = (window.__LM_CONFIG && window.__LM_CONFIG.client_id) ? window.__LM_CONFIG.client_id : null;
    if (typeof c1 === 'string') return c1;

    const c2 = (window.lm && window.lm.config && window.lm.config.client_id) ? window.lm.config.client_id : null;
    if (typeof c2 === 'string') return c2;

    return null;
  }

  // Load GIS if not loaded
  function loadGIS() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        log('GIS loaded');
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => { log('GIS loaded'); resolve(); };
      s.onerror = () => reject(new Error('Failed to load GIS'));
      document.head.appendChild(s);
    });
  }

  // One tokenClient instance per session
  let __tokenClient = null;
  async function ensureTokenClient() {
    const clientId = resolveClientId();
    if (!clientId) {
      warn('signin failed: Missing required parameter client_id.');
      throw new Error('Missing client_id');
    }
    await loadGIS();
    if (__tokenClient) return __tokenClient;
    const scopes = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly';
    __tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes,
      callback: () => {},
    });
    return __tokenClient;
  }

  // Public accessor for token
  if (typeof window.__lm_getAccessToken !== 'function') {
    window.__lm_getAccessToken = async function() {
      const tc = await ensureTokenClient();
      return new Promise((resolve, reject) => {
        try {
          tc.callback = (resp) => {
            if (resp && resp.access_token) {
              log('signin ok');
              resolve(resp.access_token);
            } else {
              reject(new Error('No access_token'));
            }
          };
          tc.requestAccessToken({prompt: ''});
        } catch(e) {
          reject(e);
        }
      });
    };
    log('auth shim ready');
  }

  // -------- Wire Sign-in button (#auth-signin) --------
  function wireSigninButton() {
    const btn = document.querySelector('#auth-signin');
    if (!btn || btn.__lm_auth_wired) return;
    btn.addEventListener('click', async () => {
      try { await window.__lm_getAccessToken(); } 
      catch(e) { err(e); }
    });
    btn.__lm_auth_wired = true;
  }

  // -------- GLB Load wires (URL + button) --------
  function doLoadGLB(urlRaw) {
    const url = String(urlRaw || '').trim();
    if (!url) return;
    // Prefer viewer API if present
    if (window.viewer && typeof window.viewer.loadModel === 'function') {
      log('viewer.loadModel(url) path');
      try { window.viewer.loadModel(url); } catch(e) { err(e); }
      return;
    }
    // Fallback: fire event
    try {
      const ev = new CustomEvent('lm:glb-load', { detail: { url } });
      window.dispatchEvent(ev);
      log('dispatch lm:glb-load', url);
    } catch(e) {
      err(e);
    }
  }

  function wireGlbControls() {
    const btn = document.querySelector('#btnGlb');
    const input = document.querySelector('#glbUrl');

    if (btn && !btn.__lm_glb_wired) {
      btn.addEventListener('click', () => doLoadGLB(input ? input.value : ''));
      btn.__lm_glb_wired = true;
      log('wired #btnGlb');
    }
    if (input && !input.__lm_glb_wired) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') doLoadGLB(input.value);
      });
      input.__lm_glb_wired = true;
      log('wired #glbUrl[Enter]');
    }
  }

  // -------- Observe DOM to keep wires alive --------
  const mo = new MutationObserver(() => { wireSigninButton(); wireGlbControls(); });
  mo.observe(document.documentElement, {subtree: true, childList: true});
  // Initial attempt
  wireSigninButton();
  wireGlbControls();

  // -------- Expose a tiny auth-aware fetch (optional) --------
  if (typeof window.__lm_fetchJSONAuth !== 'function') {
    window.__lm_fetchJSONAuth = async function(url, opt) {
      const token = await window.__lm_getAccessToken();
      const res = await fetch(url, {
        ...(opt || {}),
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(opt && opt.headers || {}) }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
  }

  log('boot safe stub ready');
})();