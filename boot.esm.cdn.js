
/* LociMyu minimal boot (auth-first) - 2025-11-12
 * Focus: robust client_id resolution + GIS token client + #auth-signin wiring
 * Safe to drop-in; logs are prefixed with [LM-boot.min]
 */
(() => {
  const TAG = '[LM-boot.min]';

  const log  = (...a) => { try { console.log(TAG, ...a); } catch(_) {} };
  const warn = (...a) => { try { console.warn(TAG, ...a); } catch(_) {} };
  const err  = (...a) => { try { console.error(TAG, ...a); } catch(_) {} };

  // --- single-flight utility --------------------------------------------------
  const flights = new Map();
  function singleFlight(key, fn) {
    if (flights.has(key)) return flights.get(key);
    const p = (async () => {
      try { return await fn(); } finally { flights.delete(key); }
    })();
    flights.set(key, p);
    return p;
  }

  // --- client_id resolver -----------------------------------------------------
  function pickClientIdFromDOM() {
    // Priority order; stop at the first valid value
    const tryFns = [
      () => (window.__LM_CLIENT_ID && String(window.__LM_CLIENT_ID)),
      () => (window.LM_CONFIG && window.LM_CONFIG.client_id && String(window.LM_CONFIG.client_id)),
      () => {
        const m = document.querySelector('meta[name="google-signin-client_id"]');
        return m && m.content;
      },
      () => {
        const m = document.querySelector('meta[name="lm:client_id"]');
        return m && m.content;
      },
      () => {
        const s = document.querySelector('script[data-client_id]');
        return s && s.dataset && s.dataset.client_id;
      },
      () => {
        const el = document.getElementById('lm-client-id');
        return el && el.dataset && el.dataset.clientId;
      },
      () => (window.GOOGLE_CLIENT_ID && String(window.GOOGLE_CLIENT_ID)),
    ];

    for (const f of tryFns) {
      try {
        const v = f();
        if (v && typeof v === 'string') {
          const id = v.trim();
          if (id && id.includes('.apps.googleusercontent.com')) {
            return id;
          }
        }
      } catch (_) {}
    }
    return '';
  }

  function resolveClientId() {
    const id = pickClientIdFromDOM();
    if (!id) throw new Error('Missing client_id');
    return id;
  }

  // --- GIS loader -------------------------------------------------------------
  async function loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      log('GIS loaded');
      return;
    }
    await singleFlight('gis', async () => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => { log('GIS loaded'); res(); };
      s.onerror = (e) => rej(new Error('Failed to load GIS script'));
      document.head.appendChild(s);
    }));
  }

  // --- token client ensure ----------------------------------------------------
  let _tokenClient = null;
  async function ensureTokenClient() {
    await loadGIS();
    const clientId = resolveClientId(); // may throw
    return singleFlight('tokenClient', async () => {
      if (_tokenClient) return _tokenClient;
      if (!window.google?.accounts?.oauth2?.initTokenClient) {
        throw new Error('GIS oauth2 not available');
      }
      _tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
        callback: () => {},
      });
      return _tokenClient;
    });
  }

  // --- public accessor --------------------------------------------------------
  window.__lm_getAccessToken = async function __lm_getAccessToken() {
    try {
      const tc = await ensureTokenClient();
      const token = await new Promise((resolve, reject) => {
        try {
          tc.callback = (resp) => {
            if (resp && resp.access_token) return resolve(resp.access_token);
            reject(new Error('No access_token in response'));
          };
          tc.requestAccessToken();
        } catch (e) { reject(e); }
      });
      log('signin ok');
      return token;
    } catch (e) {
      warn('signin failed:', e.message || e);
      err(e);
      throw e;
    }
  };

  // --- wiring -----------------------------------------------------------------
  function wireButtons() {
    const btnSignin = document.getElementById('auth-signin');
    if (btnSignin && !btnSignin.__lm_wired) {
      // capture で先に掴む + bubble でも掴む（UIに別ハンドラがあっても動かすため）
      const h = async (ev) => {
        try { await window.__lm_getAccessToken(); } catch(_) {}
      };
      btnSignin.addEventListener('click', h, true);
      btnSignin.addEventListener('click', h, false);
      btnSignin.__lm_wired = true;
      log('wired #auth-signin');
    }
    const btnGlb = document.getElementById('btnGlb');
    if (btnGlb && !btnGlb.__lm_wired) {
      // ここでは既存ローダーに任せる（GLBは別モジュールが処理）
      btnGlb.__lm_wired = true;
      log('wired #btnGlb');
    }
    const inp = document.getElementById('glbUrl');
    if (inp && !inp.__lm_wired) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // 既存のEnterハンドラが動く前提（過去版のローダーと互換）
        }
      }, true);
      inp.__lm_wired = true;
      log('wired #glbUrl[Enter]');
    }
    log('auth shim ready');
  }

  // Try once now, and keep watching for late DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }
  const mo = new MutationObserver(() => wireButtons());
  mo.observe(document.documentElement, {subtree:true, childList:true});

  // expose for debugging
  window.__LM_DEBUG = Object.assign(window.__LM_DEBUG || {}, {
    resolveClientId, pickClientIdFromDOM
  });
})();
