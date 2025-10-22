
/* LociMyu v6.6 P0 Boot Hub (ESM/CDN) — fix1 2025-10-22T01:01:26
 * - Actively waits for both client_id (meta or window.__LM_CLIENT_ID) and GIS to be ready
 * - Calls LM_GAuth.setupAuth() only after client_id is available
 * - Still does not create any UI
 */
(function(){
  console.log("[boot] LociMyu boot start");

  function getClientId(){
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) return meta.content;
    if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID.length>0) return window.__LM_CLIENT_ID;
    return null;
  }

  function bindClientIdOnce(){
    const cid = getClientId();
    if (cid) {
      window.__LM_CLIENT_ID = cid;
      if (!bindClientIdOnce._logged){ console.log("[boot] client_id bound"); bindClientIdOnce._logged=true; }
      return true;
    } else {
      if (!bindClientIdOnce._warned){ console.warn("[gauth] client_id not found at load; watching..."); bindClientIdOnce._warned=true; }
      return false;
    }
  }

  function waitForGIS(){
    return new Promise((res, rej)=>{
      let tries = 0;
      const t = setInterval(()=>{
        tries++;
        if (window.google && google.accounts && google.accounts.oauth2) {
          clearInterval(t); res(true);
        } else if (tries>600) { // ~60s
          clearInterval(t); rej(new Error("GIS not available (include https://accounts.google.com/gsi/client)"));
        }
      }, 100);
    });
  }

  function waitForClientId(){
    return new Promise((res, rej)=>{
      let tries = 0;
      if (bindClientIdOnce()) return res(true);
      const t = setInterval(()=>{
        tries++;
        if (bindClientIdOnce()) { clearInterval(t); res(true); }
        else if (tries>600) { clearInterval(t); rej(new Error("client_id not found (add <meta name='google-signin-client_id' ...> or set window.__LM_CLIENT_ID before boot)")); }
      }, 100);
    });
  }

  function whenReady(cb){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, {once:true});
    } else {
      cb();
    }
  }

  whenReady(async () => {
    try {
      // Start non-auth modules early (idempotent)
      if (window.LM_SignIn && typeof window.LM_SignIn.attach === "function") {
        try { window.LM_SignIn.attach(); } catch(e){ console.error("[signin] attach failed", e); }
      }
      if (window.LM_SheetRename && typeof window.LM_SheetRename.autodetectAndPublish === "function") {
        try { window.LM_SheetRename.autodetectAndPublish(); } catch(e){ console.error("[sheet-rename] autodetect failed", e); }
      }
      if (window.LM_Materials && typeof window.LM_Materials.init === "function") {
        try { window.LM_Materials.init(); } catch(e){ console.error("[materials] init failed", e); }
      }

      // Auth path — wait for both GIS and client_id
      await waitForGIS();
      await waitForClientId();

      if (window.LM_GAuth && typeof window.LM_GAuth.setupAuth === "function") {
        try { await window.LM_GAuth.setupAuth(); } catch(e){ console.error("[gauth] setupAuth failed", e); }
      } else {
        console.warn("[gauth] LM_GAuth not present");
      }
    } catch(e){
      console.error("[boot] init error", e);
    }

    console.log("[boot] bootOnce");
  });
})();
