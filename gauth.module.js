/* gauth.module.js — GIS token only (no UI) */
(function(){
  const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly"
  ].join(" ");
  let tokenClient = null, tokenValue = null, tokenExp = 0;
  const now = ()=>Date.now();

  async function setupAuth(){
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      await new Promise((res, rej)=>{
        let n=0, t=setInterval(()=>{ n++; if (window.google && google.accounts && google.accounts.oauth2){clearInterval(t);res();}
          if(n>300){clearInterval(t);rej(new Error("GIS not available"));}},100);
      });
    }
    const clientId = window.__LM_CLIENT_ID;
    if (!clientId){ console.warn("[gauth] client_id not found; call setupAuth later"); return; }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp)=>{
        if (resp && resp.access_token){
          tokenValue = resp.access_token;
          tokenExp = now() + (resp.expires_in? resp.expires_in*1000 : 50*60*1000);
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
    if (!force && tokenValue && now() < (tokenExp-30000)) return tokenValue;
    if (!tokenClient) { await setupAuth(); if (!tokenClient) throw new Error("token client not ready"); }
    return await new Promise((res, rej)=>{
      try{
        tokenClient.requestAccessToken();
        let n=0, t=setInterval(()=>{ n++; if (tokenValue){clearInterval(t);res(tokenValue);} if(n>300){clearInterval(t);rej(new Error("token timeout"));}},100);
      }catch(e){ rej(e); }
    });
  }
  window.LM_GAuth = { setupAuth, ensureToken, getAccessToken };
})();
