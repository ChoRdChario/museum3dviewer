
// materials.fetch.auth.polyfill.js
// Adds __lm_fetchJSONAuth if missing. Obtains a Google OAuth access token via gauth.module.js.
(() => {
  const TAG = "[auth-polyfill v1.0]";
  if (typeof window.__lm_fetchJSONAuth === "function") {
    console.log(TAG, "exists (skipped)");
    return;
  }
  async function ensureToken() {
    // Try dynamic import of the existing auth helper
    try {
      const g = await import('./gauth.module.js');
      if (g && typeof g.getAccessToken === 'function') {
        const tok = await g.getAccessToken();
        if (tok) return tok;
      }
    } catch (e) {
      console.warn(TAG, "gauth.module.js not available yet", e?.message || e);
    }
    // Try a very conservative fallback: GIS tokenClient if present
    try {
      const oauth2 = window.google?.accounts?.oauth2;
      const scopes = (window.LM_SCOPES || '').toString() || 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly';
      if (oauth2?.initTokenClient) {
        const token = await new Promise((resolve) => {
          const client = oauth2.initTokenClient({
            client_id: window.__LM_CLIENT_ID || window.GOOGLE_CLIENT_ID || '',
            scope: scopes,
            callback: (resp) => resolve(resp?.access_token || null),
          });
          client.requestAccessToken({prompt: ''});
        });
        if (token) return token;
      }
    } catch (e) {
      console.warn(TAG, "GIS fallback failed", e?.message || e);
    }
    return null;
  }

  window.__lm_fetchJSONAuth = async function __lm_fetchJSONAuth(url, opts={}) {
    const token = await ensureToken();
    const headers = new Headers(opts.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (opts.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(url, {...opts, headers});
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0,256)}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return await res.text();
  };
  console.log(TAG, "ready");
})();
