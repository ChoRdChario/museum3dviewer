/* ===================================================================
 * LociMyu boot: minimal auth + button wire (2025-11-12)
 * - Reads client_id from <meta name="google-oauth-client_id"> or window.__LM_CONFIG.client_id
 * - Exposes window.__lm_getAccessToken()
 * - Wires #auth-signin click (capture) to request token
 * =================================================================== */
(function(){
  const TAG = "[LM-boot.min]";
  function log(){ try{ console.log(TAG, ...arguments);}catch(_){ } }
  function warn(){ try{ console.warn(TAG, ...arguments);}catch(_){ } }
  function onReady(fn){ if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, {once:true}); else fn(); }

  // resolve client_id once
  function resolveClientId(){
    if (window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
    try{
      const m1 = document.querySelector('meta[name="google-oauth-client_id"]');
      const m2 = document.querySelector('meta[name="google-signin-client_id"]');
      const val = (m1 && m1.getAttribute("content")) || (m2 && m2.getAttribute("content")) ||
                  (window.__LM_CONFIG && window.__LM_CONFIG.client_id) || null;
      if (val) window.__LM_CLIENT_ID = val;
      return val;
    }catch(e){ warn("resolveClientId failed", e); return null; }
  }

  // lazy-load GIS if not present
  function ensureGIS(){
    return new Promise((resolve)=>{
      if (window.google && window.google.accounts && window.google.accounts.oauth2){ return resolve(true); }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = ()=>{ log("GIS loaded"); resolve(true); };
      s.onerror = ()=>{ warn("GIS load failed"); resolve(false); };
      (document.head||document.documentElement).appendChild(s);
    });
  }

  let _tokenClient = null;
  async function ensureTokenClient(){
    const cid = resolveClientId();
    if (!cid) { throw new Error("Missing client_id"); }
    await ensureGIS();
    if (_tokenClient) return _tokenClient;
    if (!(google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.initTokenClient)){
      throw new Error("GIS not ready");
    }
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly",
      callback: (resp)=>{ /* no-op here; handled per request */ }
    });
    return _tokenClient;
  }

  // Public: returns access token (string). Uses callback style API under the hood.
  window.__lm_getAccessToken = async function(){
    const tc = await ensureTokenClient();
    return new Promise((resolve, reject)=>{
      try{
        tc.callback = (resp)=>{
          if (resp && resp.access_token) return resolve(resp.access_token);
          if (resp && resp.error) return reject(new Error(resp.error));
          return reject(new Error("no token"));
        };
        tc.requestAccessToken({ prompt: "" }); // silent if possible
      }catch(e){ reject(e); }
    });
  };

  // Wire the Sign in button if present
  function wireSigninBtn(root){
    const btn = (root||document).querySelector && (root||document).querySelector("#auth-signin");
    if (!btn || btn.__lm_wired) return;
    btn.__lm_wired = true;
    btn.addEventListener("click", async (e)=>{
      try{
        await window.__lm_getAccessToken();
        btn.textContent = "Signed in";
        btn.disabled = true;
        log("signin ok");
      }catch(err){ warn("signin failed:", err && err.message || err); }
    }, false);
  }

  onReady(()=>{ wireSigninBtn(document); });
  // Observe dynamic UI
  try{
    const mo = new MutationObserver((muts)=>{
      for (const m of muts){
        for (const n of m.addedNodes){ if (n && n.nodeType === 1) wireSigninBtn(n); }
      }
    });
    mo.observe(document.documentElement, {childList:true, subtree:true});
  }catch(_){}

  // Minimal fetch shim for Sheets/Drive (others can overwrite)
  if (typeof window.__lm_fetchJSONAuth !== "function"){
    window.__lm_fetchJSONAuth = async function(url,opt){
      const accessToken = await window.__lm_getAccessToken();
      const hdrs = Object.assign({}, (opt&&opt.headers)||{}, { "Authorization": "Bearer "+accessToken });
      const res = await fetch(url, Object.assign({}, opt||{}, { headers: hdrs }));
      if (!res.ok) throw new Error("HTTP "+res.status);
      return res.json();
    };
    log("auth shim ready");
  }

  // Tiny GLB loader signal bridge (kept minimal; actual viewer handles it)
  window.dispatchEvent(new CustomEvent("lm:boot-auth-ready"));

})();

// boot.esm.cdn.js — SAFE MINIMAL BOOT (2025-11-12)
// Purpose:
//  - Replace corrupted boot with a minimal, syntax-safe bootstrap
//  - Keep expected globals stable (logging + __lm_fetchJSONAuth shim)
//  - Ensure __LM_MATERIALS sheet + header via window.ensureMaterialsHeader
//  - Subscribe to `lm:sheet-context` and run ensure once per spreadsheetId
// Notes:
//  - No top-level await. No external imports. No dependencies.
//  - Non-invasive: if real implementations exist, this defers to them.

;(function(){
  'use strict';

  try { console.log('[LociMyu ESM/CDN] boot safe stub loaded'); } catch(_){}

  // If the real authenticated fetch exists, keep it. Otherwise provide a safe fallback.
  if (typeof window.__lm_fetchJSONAuth !== 'function') {
    window.__lm_fetchJSONAuth = function(url, opt){
      return fetch(url, opt).then(function(r){
        if (r.ok) return r.json();
        throw new Error('HTTP ' + r.status);
      });
    };
    try { console.log('[boot.safe] __lm_fetchJSONAuth fallback installed'); } catch(_){}
  }

  var HEAD = [
    "materialKey","opacity","chromaColor","chromaTolerance","chromaFeather",
    "doubleSided","unlitLike","updatedAt","updatedBy","sheetGid","sheetTitle",
    "meshName","matIndex","matName","version","notes","reserved1","reserved2"
  ];

  function a1(name, range){
    return encodeURIComponent(String(name)) + '!' + range;
  }
  function f(url, opt){
    return window.__lm_fetchJSONAuth(url, opt);
  }

  // Single-flight guard per spreadsheetId
  var inflight = new Map();
  var ensuredIds = new Set();

  function fetchOnce(key, fn){
    if (inflight.has(key)) return inflight.get(key);
    var p = Promise.resolve().then(fn).finally(function(){ inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }

  function ensureSheet(spreadsheetId){
    return fetchOnce('meta:'+spreadsheetId, function(){
      var url = 'https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheetId+'?fields=sheets(properties(sheetId%2Ctitle))';
      return f(url).then(function(meta){
        var exists = !!(meta && meta.sheets || []).some(function(s){
          return s && s.properties && s.properties.title === '__LM_MATERIALS';
        });
        if (exists) return true;
        var u = 'https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheetId+':batchUpdate';
        var body = { requests: [ { addSheet: { properties: { title:'__LM_MATERIALS', gridProperties:{ frozenRowCount:1 } } } } ] };
        return f(u, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
          .then(function(){ try{ console.log('[boot.safe] __LM_MATERIALS created'); }catch(_){}; return true; });
      });
    });
  }

  function readHeaderA1(spreadsheetId){
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheetId+'/values:batchGet?ranges='+encodeURIComponent("'__LM_MATERIALS'!A1:A1");
    return f(url).then(function(json){
      try {
        var values = (((json||{}).valueRanges||[])[0]||{}).values||[];
        return (values[0]||[])[0] || '';
      } catch(_){
        return '';
      }
    });
  }

  function putHeader(spreadsheetId){
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheetId+'/values/'+a1('__LM_MATERIALS','A1:R1')+'?valueInputOption=RAW';
    var body = { values: [ HEAD ] };
    return f(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      .then(function(){ try{ console.log('[boot.safe] header put A1:R1'); }catch(_){}; });
  }

  function ensureMaterialsHeader(spreadsheetId){
    if (!spreadsheetId) return Promise.resolve(false);
    if (ensuredIds.has(spreadsheetId)) return Promise.resolve(true);
    return fetchOnce('ensure:'+spreadsheetId, function(){
      return ensureSheet(spreadsheetId)
        .then(function(){ return readHeaderA1(spreadsheetId); })
        .then(function(a1v){
          if (a1v !== HEAD[0]) return putHeader(spreadsheetId);
        })
        .then(function(){
          ensuredIds.add(spreadsheetId);
          window.__LM_MATERIALS_READY__ = true;
          return true;
        })
        .catch(function(err){
          try { console.warn('[boot.safe] ensureMaterialsHeader failed', err); } catch(_){}
          throw err;
        });
    });
  }

  // Expose (non-destructive) — keep a previous implementation if present
  if (typeof window.ensureMaterialsHeader !== 'function') {
    window.ensureMaterialsHeader = ensureMaterialsHeader;
  }

  // Listen for sheet-context changes and run ensure once per distinct spreadsheetId
  var lastCtx = null;
  window.addEventListener('lm:sheet-context', function(ev){
    try {
      var d = (ev && ev.detail) || ev || {};
      var sid = d.spreadsheetId || d.id || null;
      if (!sid || sid === lastCtx) return;
      lastCtx = sid;
      setTimeout(function(){ ensureMaterialsHeader(sid); }, 200);
      try { console.log('[boot.safe] ctx scheduled', sid); } catch(_){}
    } catch(e){
      try { console.warn('[boot.safe] ctx handler', e); } catch(_){}
    }
  }, { passive: true });

  try { console.log('[LociMyu ESM/CDN] boot safe stub ready'); } catch(_){}
})();
