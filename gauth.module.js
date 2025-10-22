/* LociMyu v6.6 - gauth.module.js (P0) — No UI creation.
 * Exposes: LM_GAuth.setupAuth(), LM_GAuth.ensureToken(), LM_GAuth.getAccessToken()
 * Uses Google Identity Services (token client) to obtain spreadsheet scopes.
 */
(function(){
  const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly"
  ].join(" ");
  let tokenClient = null;
  let tokenValue = null;
  let tokenExp = 0; // epoch ms

  function now() { return Date.now(); }

  async function setupAuth(){
    // Wait for GIS to exist if page loads it late
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      await new Promise((res, rej)=>{
        let tries = 0;
        const t = setInterval(()=>{
          tries++;
          if (window.google && google.accounts && google.accounts.oauth2) {
            clearInterval(t); res();
          }
          if (tries > 300) { // ~30s
            clearInterval(t); rej(new Error("GIS not available"));
          }
        }, 100);
      });
    }
    const clientId = window.__LM_CLIENT_ID;
    if (!clientId) {
      console.warn("[gauth] client_id not found; call setupAuth later after meta is set");
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp)=>{
        if (resp && resp.access_token) {
          tokenValue = resp.access_token;
          tokenExp = now() + (resp.expires_in ? (resp.expires_in*1000) : 50*60*1000);
          window.__LM_TOK = tokenValue; // optional mirror for debugging
          console.log("[gauth] token acquired");
        } else {
          console.error("[gauth] token response missing access_token", resp);
        }
      }
    });
  }

  function getAccessToken(){
    return tokenValue || "";
  }

  async function ensureToken(force=false){
    const stillValid = !force && tokenValue && (now() < (tokenExp - 30*1000));
    if (stillValid) return tokenValue;
    if (!tokenClient) {
      await setupAuth();
      if (!tokenClient) throw new Error("GIS token client not ready");
    }
    // GIS token request; this may show consent/selector UI
    return await new Promise((res, rej)=>{
      try{
        tokenClient.requestAccessToken();
        // Poll for tokenValue set by callback
        let tries = 0;
        const t = setInterval(()=>{
          tries++;
          if (tokenValue) { clearInterval(t); res(tokenValue); }
          else if (tries > 300) { clearInterval(t); rej(new Error("token request timeout")); }
        }, 100);
      }catch(e){
        rej(e);
      }
    });
  }

  window.LM_GAuth = { setupAuth, ensureToken, getAccessToken };
})();
