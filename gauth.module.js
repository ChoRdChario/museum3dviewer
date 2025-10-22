
/* gauth.module.js — IIFE (non-ESM) version for inline <script> usage
   Provides only auth functions. No UI generation. */
(function () {
  const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly"
  ].join(" ");

  let tokenClient = null;
  let tokenValue = null;
  let tokenExpMs = 0;

  function now() { return Date.now(); }

  function resolveClientId() {
    // Try meta, then __LM_CLIENT_ID (boot), then GIS_CLIENT_ID (config)
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) return meta.content;
    if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
    if (typeof window.GIS_CLIENT_ID === "string" && window.GIS_CLIENT_ID) return window.GIS_CLIENT_ID;
    return null;
  }

  function waitForGIS() {
    return new Promise((res, rej) => {
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (window.google && google.accounts && google.accounts.oauth2) {
          clearInterval(t); res(true);
        } else if (tries > 600) {
          clearInterval(t); rej(new Error("GIS not available"));
        }
      }, 100);
    });
  }

  async function setupAuth() {
    await waitForGIS();
    const clientId = resolveClientId();
    if (!clientId) {
      console.warn("[gauth] client_id not found at load; waiting for runtime setup");
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp && resp.access_token) {
          tokenValue = resp.access_token;
          const sec = Number(resp.expires_in || 3000); // ~50min default
          tokenExpMs = now() + sec * 1000;
          window.__LM_TOK = tokenValue;
          console.log("[gauth] token acquired");
        } else {
          console.error("[gauth] token missing", resp);
        }
      }
    });
  }

  function getAccessToken() {
    return tokenValue || "";
  }

  async function ensureToken(force = false) {
    if (!force && tokenValue && now() < (tokenExpMs - 30000)) {
      return tokenValue;
    }
    if (!tokenClient) {
      await setupAuth();
      if (!tokenClient) throw new Error("token client not ready");
    }
    // Request token and wait until callback populates tokenValue
    return await new Promise((resolve, reject) => {
      try {
        tokenClient.requestAccessToken();
        let n = 0;
        const t = setInterval(() => {
          n++;
          if (tokenValue) { clearInterval(t); resolve(tokenValue); }
          if (n > 300) { clearInterval(t); reject(new Error("token timeout")); }
        }, 100);
      } catch (e) {
        reject(e);
      }
    });
  }

  // Expose without ESM exports
  window.LM_GAuth = { setupAuth, ensureToken, getAccessToken };
})();
