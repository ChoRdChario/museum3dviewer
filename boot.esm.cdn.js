/* LociMyu boot.esm.cdn.js (minimal, robust client_id resolver)
 * 2025-11-12 JST
 * Scope:
 *   - Resolve Google OAuth client_id from several fallbacks already present in the page
 *   - Initialize GIS token client safely (with lazy script load if needed)
 *   - Expose window.__lm_getAccessToken() for other modules
 *   - Wire #auth-signin button to call __lm_getAccessToken()
 * Notes:
 *   - Keeps boot responsibilities minimal and defers app-specific logic to existing modules
 */

(function(){
  const TAG = "[LM-boot.min]";
  const log  = (...a)=>{ try{ console.log(TAG, ...a);}catch(_){} };
  const warn = (...a)=>{ try{ console.warn(TAG, ...a);}catch(_){} };
  const err  = (...a)=>{ try{ console.error(TAG, ...a);}catch(_){} };

  // --- Client ID resolver ----------------------------------------------------
  function readMeta(name){
    const el = document.querySelector(`meta[name="${name}"]`);
    return el && (el.getAttribute("content") || "").trim();
  }
  function readDataAttr(){
    const el = document.querySelector("[data-lm-client-id]");
    return el && (el.getAttribute("data-lm-client-id") || "").trim();
  }
  function readScriptData(){
    const el = Array.from(document.scripts||[]).find(s => s.hasAttribute("data-client_id"));
    return el && (el.getAttribute("data-client_id") || "").trim();
  }
  function readConfig(){
    try{
      if (window.LM_CONFIG && typeof window.LM_CONFIG.client_id === "string") return window.LM_CONFIG.client_id.trim();
    }catch(_){}
    try{
      if (window.__LM_BOOT && typeof window.__LM_BOOT.clientId === "string") return window.__LM_BOOT.clientId.trim();
    }catch(_){}
    return "";
  }
  function resolveClientId(){
    // 1) already set
    if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
    // 2) common meta names
    const c =
      readMeta("google-signin-client_id") ||
      readMeta("lm:client_id") ||
      readMeta("google-oauth-client_id") ||
      readDataAttr() ||
      readScriptData() ||
      readConfig() ||
      "";
    if (c) window.__LM_CLIENT_ID = c;
    return c;
  }

  // --- GIS loader ------------------------------------------------------------
  function ensureGIS(){
    return new Promise((resolve, reject)=>{
      if (window.google && window.google.accounts && window.google.accounts.oauth2){
        log("GIS loaded");
        return resolve();
      }
      const id = "gsi-client";
      if (document.getElementById(id)){
        // Wait until it becomes ready
        let tries = 0;
        const t = setInterval(()=>{
          if (window.google?.accounts?.oauth2){ clearInterval(t); log("GIS loaded"); resolve(); }
          else if (++tries > 100){ clearInterval(t); reject(new Error("GIS load timeout")); }
        }, 50);
        return;
      }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.id = id;
      s.onload = ()=>{ log("GIS loaded"); resolve(); };
      s.onerror = ()=>reject(new Error("GIS load failed"));
      document.head.appendChild(s);
      log("injecting GIS...");
    });
  }

  // --- Token client (lazy) ---------------------------------------------------
  let tokenClient = null;
  let inflight = null;

  async function ensureTokenClient(){
    const cid = resolveClientId();
    if (!cid) throw new Error("Missing client_id");
    await ensureGIS();
    if (!tokenClient){
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly",
        callback: (resp)=>{
          // callback is overridden per request; keep default for safety
          if (resp && resp.access_token){ log("token received (default callback)"); }
        }
      });
    }
    return tokenClient;
  }

  // Public API: get access token (re-entrant safe)
  window.__lm_getAccessToken = async function(){
    try{
      const tc = await ensureTokenClient();
      if (inflight) return await inflight;
      inflight = new Promise((resolve, reject)=>{
        // Temporary per-call callback
        const saved = tc.callback;
        tc.callback = (resp)=>{
          tc.callback = saved;
          inflight = null;
          if (resp && resp.access_token){ resolve(resp.access_token); }
          else { reject(new Error("No access_token in response")); }
        };
        try{
          tc.requestAccessToken({prompt: ""});
        }catch(e){
          tc.callback = saved;
          inflight = null;
          reject(e);
        }
      });
      return await inflight;
    }catch(e){
      warn("signin failed:", e && (e.message || e));
      err(e);
      throw e;
    }
  };

  // --- Wire UI ---------------------------------------------------------------
  function wireButtons(){
    const btnSignin = document.querySelector("#auth-signin");
    if (btnSignin && !btnSignin.__lm_wired){
      btnSignin.addEventListener("click", async (ev)=>{
        try{
          await window.__lm_getAccessToken();
          log("signin ok");
        }catch(e){
          // already logged
        }
      }, {capture:true});
      btnSignin.__lm_wired = true;
      log("wired #auth-signin");
    }

    const btnGlb = document.querySelector("#btnGlb");
    if (btnGlb && !btnGlb.__lm_wired){
      // noop; existing app logic will handle click
      btnGlb.__lm_wired = true;
      log("wired #btnGlb");
    }

    const inpUrl = document.querySelector("#glbUrl");
    if (inpUrl && !inpUrl.__lm_wired){
      inpUrl.addEventListener("keydown", (e)=>{
        if (e.key === "Enter"){
          const b = document.querySelector("#btnGlb");
          if (b) b.click();
        }
      }, {capture:true});
      inpUrl.__lm_wired = true;
      log("wired #glbUrl[Enter]");
    }
  }

  // Try to read client_id early and also on DOM changes
  try{
    resolveClientId();
  }catch(_){}
  wireButtons();
  const mo = new MutationObserver(()=>{ resolveClientId(); wireButtons(); });
  mo.observe(document.documentElement, {subtree:true, childList:true});

  log("auth shim ready");
})();
