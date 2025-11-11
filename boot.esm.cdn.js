/*
 * LociMyu Minimal Boot (Auth + Drive GLB resolver -> viewer button path)
 * 2025-11-12
 */
(function(){
  const TAG = "[LM-boot.min]";

  const log  = (...a)=>{ try{ console.log(TAG, a.length===1?a[0]:a); }catch(_){} };
  const warn = (...a)=>{ try{ console.warn(TAG, a.length===1?a[0]:a); }catch(_){} };
  const err  = (...a)=>{ try{ console.error(TAG, a.length===1?a[0]:a); }catch(_){} };

  // -------- GIS auth shim (keeps existing setup; we don't change client_id resolution policy) --------
  let tokenClient = null;
  let lastToken = null;

  async function ensureTokenClient(){
    // client_id must come from existing page wiring (meta/script) into window.__LM_CLIENT_ID
    const cid = window.__LM_CLIENT_ID || (window.__LM_CONFIG && window.__LM_CONFIG.client_id) || null;
    if (!cid) throw new Error("Missing client_id");

    const init = window.google && window.google.accounts && window.google.accounts.oauth2 && window.google.accounts.oauth2.initTokenClient;
    if (!init) throw new Error("GIS not loaded");

    tokenClient = init({
      client_id: cid,
      scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets",
      callback: (resp) => {
        if (resp && resp.access_token) {
          lastToken = resp.access_token;
        }
      }
    });
    return tokenClient;
  }

  async function __lm_getAccessToken(){
    try{
      if (!tokenClient) await ensureTokenClient();
      return await new Promise((resolve, reject)=>{
        tokenClient.callback = (resp)=>{
          if (resp && resp.access_token){
            lastToken = resp.access_token;
            resolve(resp.access_token);
          } else {
            reject(new Error("no access_token"));
          }
        };
        try{
          tokenClient.requestAccessToken({ prompt: "" });
        }catch(e){
          // If promptless fails (no prior grant), retry with consent
          try{
            tokenClient.requestAccessToken({ prompt: "consent" });
          }catch(e2){
            reject(e2);
          }
        }
      });
    }catch(e){
      warn("signin failed:", e.message || e);
      throw e;
    }
  }
  window.__lm_getAccessToken = __lm_getAccessToken;
  log("auth shim ready");

  // -------- GLB resolver: Drive share URL -> alt=media -> blob URL --------
  const driveIdFromShare = (u)=>{
    try{
      const m = String(u).match(/\/file\/d\/([^/]+)\//);
      return m ? m[1] : null;
    }catch(_){ return null; }
  };

  async function driveFileToBlobUrl(shareUrl){
    const fid = driveIdFromShare(shareUrl);
    if (!fid) return null;
    const tok = lastToken || await __lm_getAccessToken();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}?alt=media&supportsAllDrives=true`;
    const res = await fetch(url, { headers: { "Authorization": `Bearer ${tok}` }});
    if (!res.ok) throw new Error(`Drive fetch ${res.status}`);
    const blob = await res.blob();
    const bUrl = URL.createObjectURL(blob);
    return bUrl;
  }

  // ---- Wire UI: turn any input (Enter) / button click into "resolve -> fill -> click Load" flow ----
  function getUI(){
    const urlInput = document.querySelector("#glbUrl");
    const btnLoad  = document.querySelector("#btnGlb");
    return { urlInput, btnLoad };
  }

  async function resolveAndTrigger(url){
    try{
      if (!url) return;
      const isDrive = /https?:\/\/drive\.google\.com\/file\/d\//.test(url);
      if (!isDrive) {
        // Non-Drive: just copy the url into input and click load to use existing path
        const {urlInput, btnLoad} = getUI();
        if (urlInput) urlInput.value = url;
        if (btnLoad)  btnLoad.click();
        log(["glb passthrough", url]);
        return;
      }
      const blobUrl = await driveFileToBlobUrl(url);
      const {urlInput, btnLoad} = getUI();
      if (!urlInput || !btnLoad) throw new Error("viewer UI not ready");
      urlInput.value = blobUrl;
      btnLoad.click();
      log(["glb resolved -> blob:", blobUrl]);
    }catch(e){
      err(["glb resolve failed", e && (e.stack || e.message || String(e))]);
    }
  }

  // Existing UI hooks
  function wireUI(){
    const {urlInput, btnLoad} = getUI();
    if (btnLoad && !btnLoad.__lm_wired){
      btnLoad.addEventListener("click", (ev)=>{
        const {urlInput} = getUI();
        const u = urlInput && urlInput.value || "";
        // If this click is user-driven, resolve path first, then let our code re-click
        if (/drive\.google\.com\/file\/d\//.test(u)){
          ev.preventDefault();
          ev.stopImmediatePropagation();
          resolveAndTrigger(u);
        }
      }, true); // capture to intercept before site handler
      btnLoad.__lm_wired = true;
      log(["wired #btnGlb"]);
    }
    if (urlInput && !urlInput.__lm_wired){
      urlInput.addEventListener("keydown", (e)=>{
        if (e.key === "Enter"){
          e.preventDefault();
          e.stopImmediatePropagation();
          resolveAndTrigger(urlInput.value);
        }
      }, true);
      urlInput.__lm_wired = true;
      log(["wired #glbUrl[Enter]"]);
    }
    // auth button stays as original behavior; only ensure we expose token getter
    const btnSignin = document.querySelector("#auth-signin");
    if (btnSignin && !btnSignin.__lm_wired){
      btnSignin.addEventListener("click", async ()=>{
        try{ await __lm_getAccessToken(); log(["signin ok"]); }
        catch(e){ err(e); }
      }, {capture:false});
      btnSignin.__lm_wired = true;
      log(["wired #auth-signin"]);
    }
  }
  wireUI();
  log(["boot safe stub ready"]);

  // In case UI appears late
  const mo = new MutationObserver(()=>wireUI());
  mo.observe(document.documentElement, {subtree:true, childList:true});
})();
