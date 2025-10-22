
/* gauth.module.js — IIFE (non-ESM) */
(function () {
  const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly"
  ].join(" ");
  let tokenClient = null, tokenValue = null, tokenExpMs = 0;
  const now = () => Date.now();
  function resolveClientId(){
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) return meta.content;
    if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
    if (typeof window.GIS_CLIENT_ID === "string" && window.GIS_CLIENT_ID) return window.GIS_CLIENT_ID;
    return null;
  }
  function waitForGIS(){
    return new Promise((res, rej)=>{
      let n=0, t=setInterval(()=>{
        n++; if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(t); res(true); }
        else if (n>600){ clearInterval(t); rej(new Error("GIS not available")); }
      },100);
    });
  }
  async function setupAuth(){
    await waitForGIS();
    const clientId = resolveClientId();
    if (!clientId){ console.warn("[gauth] client_id not found at load; waiting for runtime setup"); return; }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp)=>{
        if (resp && resp.access_token){
          tokenValue = resp.access_token;
          tokenExpMs = now() + (Number(resp.expires_in||3000)*1000);
          window.__LM_TOK = tokenValue;
          console.log("[gauth] token acquired");
        } else {
          console.error("[gauth] token missing", resp);
        }
      }
    });
  }
  function getAccessToken(){ return tokenValue || ""; }
  async function ensureToken(force=false){
    if (!force && tokenValue && now() < (tokenExpMs-30000)) return tokenValue;
    if (!tokenClient){ await setupAuth(); if (!tokenClient) throw new Error("token client not ready"); }
    return await new Promise((resolve,reject)=>{
      try{
        tokenClient.requestAccessToken();
        let n=0, t=setInterval(()=>{
          n++; if (tokenValue){ clearInterval(t); resolve(tokenValue); }
          if (n>300){ clearInterval(t); reject(new Error("token timeout")); }
        },100);
      }catch(e){ reject(e); }
    });
  }
  window.LM_GAuth = { setupAuth, ensureToken, getAccessToken };
})();
