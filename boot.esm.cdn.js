/* LociMyu boot.esm.cdn.js  (GLB normalize focus) 2025-11-12
 * - Keeps minimal auth shim (window.__lm_getAccessToken)
 * - Rewires GLB button/Enter to use __lm_requestGlbLoad(url)
 * - __lm_requestGlbLoad resolves Drive/GitHub links to direct/Blob URLs
 * - Emits a single normalized event:  window.dispatchEvent(new CustomEvent('lm:glb-load',{detail:{url}}))
 * - Avoids duplicate signals & keeps compatibility with existing listeners
 */

(function(){
  const TAG = "[LM-boot.min]";

  // -------- tiny console helpers
  const log  = (...a)=>{ try{console.log(TAG, ...a);}catch(_){}};
  const warn = (...a)=>{ try{console.warn(TAG, ...a);}catch(_){}};
  const err  = (...a)=>{ try{console.error(TAG, ...a);}catch(_){}};

  // -------- wait for Google Identity Services script (if present)
  function ensureGisLoaded(){
    return new Promise((resolve)=>{
      if (window.google?.accounts?.oauth2) return resolve(true);
      const s = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (s && (s.dataset.loaded==="1" || s.dataset.loaded===true)) return resolve(true);
      if (s){
        s.addEventListener('load', ()=>{ s.dataset.loaded="1"; resolve(true); }, {once:true});
        return;
      }
      // optional load if not present
      const sc = document.createElement('script');
      sc.src = "https://accounts.google.com/gsi/client";
      sc.async = true; sc.defer = true;
      sc.onload = ()=>{ sc.dataset.loaded="1"; resolve(true); };
      sc.onerror = ()=> resolve(false);
      document.head.appendChild(sc);
    }).then(()=>{ log("GIS loaded"); return true; });
  }

  // -------- client_id resolver (robust, non-blocking)
  async function waitForClientId(timeoutMs=4000){
    const t0 = Date.now();
    const pick = ()=>{
      const m1 = document.querySelector('meta[name="google-oauth-client_id"]')?.content;
      if (m1) return m1;
      const m2 = document.querySelector('meta[name="google-signin-client_id"]')?.content;
      if (m2) return m2;
      const g = document.querySelector('#g_id_onload')?.getAttribute('data-client_id');
      if (g) return g;
      const c = (window.__LM_CONFIG && window.__LM_CONFIG.client_id) ? window.__LM_CONFIG.client_id : null;
      if (c) return c;
      return null;
    };
    let cid = pick();
    if (cid) return cid;
    // observe for late injection
    return await new Promise((resolve)=>{
      const mo = new MutationObserver(()=>{
        const got = pick();
        if (got){ mo.disconnect(); resolve(got); }
        else if (Date.now()-t0 > timeoutMs){ mo.disconnect(); resolve(null); }
      });
      mo.observe(document.documentElement, {childList:true, subtree:true});
      setTimeout(()=>{ const got=pick(); if (!got) resolve(null); else resolve(got); }, Math.min(600, timeoutMs));
      setTimeout(()=>{ mo.disconnect(); resolve(pick()); }, timeoutMs);
    });
  }

  // -------- minimal auth shim
  let _tokenClient=null, _clientId=null;
  async function ensureTokenClient(){
    await ensureGisLoaded();
    if (!_clientId){
      _clientId = await waitForClientId();
      if (!_clientId) throw new Error("Missing client_id");
    }
    if (_tokenClient) return _tokenClient;
    if (!window.google?.accounts?.oauth2) throw new Error("GIS not available");
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: _clientId,
      scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets",
      callback: ()=>{},
    });
    return _tokenClient;
  }

  window.__lm_getAccessToken = async function(){
    try{
      const tc = await ensureTokenClient();
      return await new Promise((resolve, reject)=>{
        try{
          tc.callback = (resp)=>{
            if (resp && resp.access_token) return resolve(resp.access_token);
            reject(new Error("no token"));
          };
          tc.requestAccessToken({prompt:""});
        }catch(e){ reject(e); }
      });
    }catch(e){
      warn("signin failed:", e.message||e);
      throw e;
    }
  };
  log("auth shim ready");

  // -------- GLB URL normalizer
  function isDriveView(u){ return /https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//.test(u); }
  function extractDriveId(u){ const m = u.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//); return m?m[1]:null; }
  function isGithubBlob(u){ return /https?:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(u); }

  function toGithubRaw(u){
    // https://github.com/user/repo/blob/branch/path/to.glb
    // -> https://raw.githubusercontent.com/user/repo/branch/path/to.glb
    try{
      const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
      if (!m) return u;
      const [,user,repo,branch,rest] = m;
      return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${rest}`;
    }catch(_){ return u; }
  }

  async function driveToBlobUrl(u){
    const id = extractDriveId(u);
    if (!id) return u;
    let token = null;
    try{ token = await window.__lm_getAccessToken(); }catch(_){}
    // Prefer token fetch to avoid uc confirmation/cookies
    if (token){
      const api = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
      const res = await fetch(api, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Drive alt=media ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      return url;
    }
    // Fallback to uc?export=download&id=
    return `https://drive.google.com/uc?export=download&id=${id}`;
  }

  async function normalizeGlbUrl(u){
    if (!u) throw new Error("no url");
    if (isDriveView(u)) return await driveToBlobUrl(u);
    if (isGithubBlob(u)) return toGithubRaw(u);
    // Google Drive "open?id="
    if (/drive\.google\.com\/open\?id=/.test(u)){
      const id = (new URL(u)).searchParams.get("id");
      if (id) return await driveToBlobUrl(`https://drive.google.com/file/d/${id}/view`);
    }
    return u;
  }

  // public API: resolve + emit a single normalized event
  let _glbBusy = false;
  window.__lm_requestGlbLoad = async function(inputUrl){
    if (!inputUrl) return warn("no glb url");
    if (_glbBusy){ warn("glb busy; dropping"); return; }
    _glbBusy = true;
    try{
      const url = await normalizeGlbUrl(String(inputUrl).trim());
      log("glb resolved", url.slice(0,120));
      // emit ONE canonical event; consumers listen to this
      window.dispatchEvent(new CustomEvent("lm:glb-load", { detail: { url } }));
    }catch(e){
      err("glb normalize error", e);
      window.dispatchEvent(new CustomEvent("lm:glb-error", { detail: { message: String(e?.message||e) } }));
    }finally{ _glbBusy = false; }
  };

  // ---- wire UI
  function wireGlbUI(){
    const btn = document.querySelector("#btnGlb");
    const inp = document.querySelector("#glbUrl");
    if (btn && !btn.__lm_wired){
      btn.addEventListener("click", ()=> window.__lm_requestGlbLoad(inp?.value||""));
      btn.__lm_wired = true;
      log("wired #btnGlb");
    }
    if (inp && !inp.__lm_wired){
      inp.addEventListener("keydown", (e)=>{
        if (e.key==="Enter"){ e.preventDefault(); window.__lm_requestGlbLoad(inp.value||""); }
      });
      inp.__lm_wired = true;
      log("wired #glbUrl[Enter]");
    }
  }
  wireGlbUI();
  const mo = new MutationObserver(()=> wireGlbUI());
  mo.observe(document.documentElement, {subtree:true, childList:true});

  // ---- optional: minimal visual feedback to catch pipeline issues
  window.addEventListener("lm:glb-load", (ev)=>{
    const u = ev?.detail?.url || "";
    log("glb dispatch", u.slice(0,120));
  });

  // keep stubs for compatibility with earlier logs
  log("boot safe stub ready");
})();
