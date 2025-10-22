
/* boot.esm.cdn.js — P0 hotfix BIND-GIS → __LM_CLIENT_ID (2025-10-22T09:52:21) */
(function(){
  console.log("[boot] LociMyu boot start");

  function getClientId(){
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) return meta.content;
    if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
    if (typeof window.GIS_CLIENT_ID === "string" && window.GIS_CLIENT_ID) return window.GIS_CLIENT_ID;
    return null;
  }

  function bindClientIdOnce(){
    const cid = getClientId();
    if (cid) {
      if (!window.__LM_CLIENT_ID) window.__LM_CLIENT_ID = cid;
      if (!bindClientIdOnce._logged){ console.log("[boot] client_id bound"); bindClientIdOnce._logged=true; }
      return true;
    } else {
      if (!bindClientIdOnce._warned){ console.warn("[gauth] client_id not found at load; waiting for runtime setup"); bindClientIdOnce._warned=true; }
      return false;
    }
  }

  function waitForGIS(){
    return new Promise((res, rej)=>{
      let tries = 0;
      const t = setInterval(()=>{
        tries++;
        if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(t); res(true); }
        else if (tries>600) { clearInterval(t); rej(new Error("GIS not available (include https://accounts.google.com/gsi/client)")); }
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
        else if (tries>600) { clearInterval(t); rej(new Error("client_id not found (meta/__LM_CLIENT_ID/GIS_CLIENT_ID)")); }
      }, 100);
    });
  }

  function whenReady(cb){
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cb, {once:true});
    else cb();
  }

  whenReady(async () => {
    try {
      try { window.LM_SignIn && window.LM_SignIn.attach && window.LM_SignIn.attach(); } catch(e){ console.error("[signin] attach failed", e); }
      try { window.LM_SheetRename && window.LM_SheetRename.autodetectAndPublish && window.LM_SheetRename.autodetectAndPublish(); } catch(e){ console.error("[sheet-rename] autodetect failed", e); }
      try { window.LM_Materials && window.LM_Materials.init && window.LM_Materials.init(); } catch(e){ console.error("[materials] init failed", e); }

      await waitForGIS();
      bindClientIdOnce();
      await waitForClientId();

      if (window.LM_GAuth && typeof window.LM_GAuth.setupAuth === "function") {
        try { await window.LM_GAuth.setupAuth(); } catch(e){ console.error("[gauth] setupAuth failed", e); }
      } else { console.warn("[gauth] LM_GAuth not present"); }
    } catch(e){ console.error("[boot] init error", e); }
    console.log("[boot] bootOnce");
  });
})();
