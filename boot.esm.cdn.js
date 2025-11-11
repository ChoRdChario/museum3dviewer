
/*! LociMyu boot minimal (auth + wire) 2025-11-12 */
(() => {
  const TAG = "[LM-boot.min]";

  // -------- util loggers --------
  const log  = (...a) => { try { console.log(TAG, ...a); } catch(_){} };
  const warn = (...a) => { try { console.warn(TAG, ...a); } catch(_){} };
  const err  = (...a) => { try { console.error(TAG, ...a); } catch(_){} };

  // -------- client_id resolver --------
  function resolveClientId() {
    // 1) explicit global
    if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID.trim()) {
      return window.__LM_CLIENT_ID.trim();
    }
    // 2) meta tag
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) { return meta.content.trim(); }
    // 3) possible config objects
    const cands = [
      window.LM_CONFIG && window.LM_CONFIG.google && window.LM_CONFIG.google.client_id,
      window.locimyu && window.locimyu.googleClientId,
      window.__LM_BOOT && window.__LM_BOOT.client_id,
    ].filter(Boolean);
    if (cands.length) { return String(cands[0]).trim(); }
    throw new Error("Missing client_id");
  }

  // -------- GIS loader (single-flight) --------
  let _gsiPromise = null;
  function loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      return Promise.resolve();
    }
    if (_gsiPromise) return _gsiPromise;
    _gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = () => { log("GIS loaded"); resolve(); };
      s.onerror = () => reject(new Error("GIS load failed"));
      document.head.appendChild(s);
    });
    return _gsiPromise;
  }

  // -------- token client (cached) --------
  let _tokenClient = null;
  let _accessToken = null;
  let _tokenExp = 0; // epoch ms

  async function ensureTokenClient() {
    await loadGIS();
    const client_id = resolveClientId(); // may throw
    if (_tokenClient) return _tokenClient;

    // Create a token client; callback is set per request
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id,
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly",
      callback: () => {},
    });
    return _tokenClient;
  }

  // -------- public: get access token --------
  // options: {force: boolean}
  window.__lm_getAccessToken = async function(options={}) {
    try {
      const now = Date.now();
      if (!options.force && _accessToken && now < _tokenExp - 30000) { // 30s early refresh
        return _accessToken;
      }
      const tc = await ensureTokenClient();
      const token = await new Promise((resolve, reject) => {
        try {
          tc.callback = (resp) => {
            if (resp && resp.access_token) {
              _accessToken = resp.access_token;
              // GIS doesn't always include expires_in; assume 1h if absent
              const ttl = (typeof resp.expires_in === "number" ? resp.expires_in : 3600) * 1000;
              _tokenExp = Date.now() + ttl;
              resolve(_accessToken);
            } else if (resp && resp.error) {
              reject(new Error(resp.error));
            } else {
              reject(new Error("No access_token in response"));
            }
          };
          // First request should show consent; subsequent can be silent
          const prompt = (_accessToken ? "" : "consent");
          tc.requestAccessToken({ prompt });
        } catch (e) { reject(e); }
      });
      log("signin ok");
      return token;
    } catch (e) {
      warn("signin failed:", e && e.message ? e.message : e);
      throw e;
    }
  };

  // -------- wire UI --------
  function wireSigninButton() {
    const btn = document.getElementById("auth-signin");
    if (!btn || btn.__lm_wired) return;
    btn.__lm_wired = true;

    btn.addEventListener("click", async (e) => {
      try {
        await window.__lm_getAccessToken();
      } catch (ex) {
        err(ex);
      }
    }, false);
    log("wired #auth-signin");
  }

  // GLB input wiring (kept as-is for current flow)
  function wireGlbInputs() {
    const btn = document.getElementById("btnGlb");
    const input = document.getElementById("glbUrl");

    const dispatch = (url) => {
      if (!url) return;
      const ev = new CustomEvent("lm:glb-load", { detail: { url } });
      window.dispatchEvent(ev);
      log("glb signal", url);
    };

    if (btn && !btn.__lm_wired) {
      btn.__lm_wired = true;
      btn.addEventListener("click", () => dispatch(String(input && input.value || "").trim()));
      log("wired #btnGlb");
    }
    if (input && !input.__lm_wired) {
      input.__lm_wired = true;
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") dispatch(String(input.value || "").trim());
      });
      log("wired #glbUrl[Enter]");
    }
  }

  // Mutation observer to re-bind if UI re-renders
  const mo = new MutationObserver(() => { wireSigninButton(); wireGlbInputs(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Initial
  document.addEventListener("DOMContentLoaded", () => {
    log("auth shim ready");
    wireSigninButton();
    wireGlbInputs();
    log("boot safe stub ready");
  });
})();
