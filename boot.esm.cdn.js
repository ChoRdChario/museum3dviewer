/* ===================================================================
 * LociMyu boot: minimal auth + button wire (2025-11-12, r3)
 * - Resolves client_id from multiple sources (meta, script#g_id_onload, window.__LM_CONFIG)
 * - Waits dynamically if client_id not yet present (MutationObserver + timeout)
 * - Exposes window.__lm_getAccessToken() and window.__lm_signinNow()
 * - Wires #auth-signin click (idempotent)
 * - Wires #btnGlb and #glbUrl[Enter] to dispatch 'lm:glb-load' with {url}
 * - Adds GLB resolver shim: Google Drive links -> authorized blob URL, then redispatch
 * =================================================================== */
(function(){
  'use strict';
  var TAG = "[LM-boot.min]";
  function log(){ try{ console.log(TAG, [].slice.call(arguments)); }catch(_){ } }
  function warn(){ try{ console.warn(TAG, [].slice.call(arguments)); }catch(_){ } }
  function onReady(fn){ if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, {once:true}); else fn(); }

  function readClientIdOnce(){
    try{
      if (window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
      var m1 = document.querySelector('meta[name="google-oauth-client_id"]');
      var m2 = document.querySelector('meta[name="google-signin-client_id"]');
      var s1 = document.querySelector('#g_id_onload');
      var val = null;
      if (m1 && m1.getAttribute) val = m1.getAttribute('content');
      if (!val && m2 && m2.getAttribute) val = m2.getAttribute('content');
      if (!val && s1 && s1.getAttribute) val = s1.getAttribute('data-client_id');
      if (!val && window.__LM_CONFIG && window.__LM_CONFIG.client_id) val = window.__LM_CONFIG.client_id;
      if (val) window.__LM_CLIENT_ID = val;
      return val || null;
    }catch(e){ return null; }
  }

  // Wait up to ~4s for client_id to appear via DOM or config
  function waitForClientId(timeoutMs){
    timeoutMs = (typeof timeoutMs === 'number') ? timeoutMs : 4000;
    return new Promise(function(resolve, reject){
      var existing = readClientIdOnce();
      if (existing) return resolve(existing);

      var done = false;
      function finish(ok, val){
        if (done) return;
        done = true;
        try{ mo.disconnect(); }catch(_){}
        if (ok) { window.__LM_CLIENT_ID = val; resolve(val); }
        else reject(new Error("Missing client_id"));
      }

      var mo = new MutationObserver(function(){
        var cid = readClientIdOnce();
        if (cid) finish(true, cid);
      });
      try { mo.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['content','data-client_id']}); } catch(_){}

      // Also poll a few times (covers late window.__LM_CONFIG assignment)
      var tries = Math.max(1, Math.floor(timeoutMs / 100));
      var i = 0;
      var iv = setInterval(function(){
        var cid = readClientIdOnce();
        if (cid){ clearInterval(iv); finish(true, cid); }
        else if (++i >= tries){ clearInterval(iv); finish(false); }
      }, 100);
    });
  }

  // Lazy-load GIS if not present
  function ensureGIS(){
    return new Promise(function(resolve){
      if (window.google && window.google.accounts && window.google.accounts.oauth2){ return resolve(true); }
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = function(){ log("GIS loaded"); resolve(true); };
      s.onerror = function(){ warn("GIS load failed"); resolve(false); };
      (document.head||document.documentElement).appendChild(s);
    });
  }

  var _tokenClient = null;
  async function ensureTokenClient(){
    var cid = await waitForClientId(4000);
    await ensureGIS();
    if (_tokenClient) return _tokenClient;
    if (!(window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.initTokenClient)){
      throw new Error("GIS not ready");
    }
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly",
      callback: function(){}
    });
    return _tokenClient;
  }

  // Public: get access token string
  window.__lm_getAccessToken = async function(){
    var tc = await ensureTokenClient();
    return new Promise(function(resolve, reject){
      try{
        tc.callback = function(resp){
          if (resp && resp.access_token) return resolve(resp.access_token);
          if (resp && resp.error) return reject(new Error(resp.error));
          return reject(new Error("no token"));
        };
        tc.requestAccessToken({ prompt: "" });
      }catch(e){ reject(e); }
    });
  };

  // Manual trigger helper (for debugging)
  window.__lm_signinNow = function(){ return window.__lm_getAccessToken().then(function(){ log("signin ok"); }).catch(function(e){ warn("signin failed:", e && e.message || e); }); };

  // Wire Sign in button
  function wireSigninBtn(root){
    var btn = (root||document).querySelector && (root||document).querySelector("#auth-signin");
    if (!btn || btn.__lm_wired) return;
    btn.__lm_wired = true;
    btn.addEventListener("click", function(){
      window.__lm_signinNow().then(function(){
        try{ btn.textContent = "Signed in"; btn.disabled = true; }catch(_){}
      });
    }, false);
    log("wired #auth-signin");
  }

  // Wire GLB input/button to dispatch a signal
  function wireGlbControls(root){
    var r = root||document;
    var btn = r.querySelector && r.querySelector("#btnGlb");
    var inp = r.querySelector && r.querySelector("#glbUrl");
    if (btn && !btn.__lm_wired){
      btn.__lm_wired = true;
      btn.addEventListener("click", function(){
        try{
          var url = (inp && inp.value) || "";
          if (!url) return;
          window.dispatchEvent(new CustomEvent("lm:glb-load", { detail: { url: url } }));
          log("glb signal", url);
        }catch(e){ warn("glb wire error", e); }
      });
      log("wired #btnGlb");
    }
    if (inp && !inp.__lm_wired){
      inp.__lm_wired = true;
      inp.addEventListener("keydown", function(ev){
        if (ev.key === "Enter"){
          try{
            var url = inp.value || "";
            if (!url) return;
            window.dispatchEvent(new CustomEvent("lm:glb-load", { detail: { url: url } }));
            log("glb signal (enter)", url);
          }catch(e){ warn("glb wire error", e); }
        }
      });
      log("wired #glbUrl[Enter]");
    }
  }

  onReady(function(){ wireSigninBtn(document); wireGlbControls(document); });
  try{
    var mo = new MutationObserver(function(muts){
      for (var i=0;i<muts.length;i++){
        var m = muts[i];
        for (var j=0;j<(m.addedNodes||[]).length;j++){
          var n = m.addedNodes[j];
          if (n && n.nodeType === 1){ wireSigninBtn(n); wireGlbControls(n); }
        }
      }
    });
    mo.observe(document.documentElement, {childList:true, subtree:true});
  }catch(_){}

  // Minimal fetch shim (can be replaced later)
  if (typeof window.__lm_fetchJSONAuth !== "function"){
    window.__lm_fetchJSONAuth = async function(url,opt){
      var tok = await window.__lm_getAccessToken();
      var hdrs = Object.assign({}, (opt&&opt.headers)||{}, { "Authorization": "Bearer "+tok });
      var res = await fetch(url, Object.assign({}, opt||{}, { headers: hdrs }));
      if (!res.ok) throw new Error("HTTP "+res.status);
      return res.json();
    };
    log("auth shim ready");
  }

  // ------------------------------------------------------------------
  // GLB resolver shim: handle Google Drive links robustly
  // ------------------------------------------------------------------
  function extractDriveFileId(url){
    try{
      var m1 = /\/file\/d\/([a-zA-Z0-9_-]{10,})/i.exec(url);
      if (m1) return m1[1];
      var u = new URL(url);
      if (u.hostname.indexOf("drive.google.com")>=0){
        if (u.searchParams.has("id")) return u.searchParams.get("id");
        // shared “view” page sometimes stores id in last segment
        var segs = u.pathname.split("/");
        var idx = segs.indexOf("d");
        if (idx>=0 && segs[idx+1]) return segs[idx+1];
      }
    }catch(_){}
    return null;
  }

  async function driveToBlobURL(fileId){
    var tok = await window.__lm_getAccessToken();
    var api = "https://www.googleapis.com/drive/v3/files/"+fileId+"?alt=media&supportsAllDrives=true";
    var res = await fetch(api, { headers: { "Authorization": "Bearer "+tok } });
    if (!res.ok) throw new Error("Drive HTTP "+res.status);
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    return url;
  }

  function installGlbResolver(){
    if (window.__LM_GLB_RESOLVER_INSTALLED__) return;
    window.__LM_GLB_RESOLVER_INSTALLED__ = true;
    window.addEventListener("lm:glb-load", function(ev){
      try{
        var d = (ev && ev.detail) || {};
        if (!d || !d.url) return;
        if (d._resolved) return; // avoid loops
        var fid = extractDriveFileId(d.url);
        if (!fid) return; // not a Drive link; let downstream handle
        // Resolve asynchronously then redispatch with blob URL
        (async function(){
          try{
            var blobUrl = await driveToBlobURL(fid);
            var payload = { url: blobUrl, _resolved: true, src: "drive" };
            window.dispatchEvent(new CustomEvent("lm:glb-load", { detail: payload }));
            log("glb resolved -> blob:", blobUrl);
          }catch(e){
            warn("glb resolve failed", e && e.message || e);
          }
        })();
      }catch(e){ /* ignore */ }
    }, true); // capture to resolve early
    log("glb resolver installed");
  }
  installGlbResolver();

  // Notify that auth bootstrap is ready
  try{ window.dispatchEvent(new CustomEvent("lm:boot-auth-ready")); }catch(_){}
})();

// -------------------------------------------------------------------
// boot.esm.cdn.js — SAFE MINIMAL BOOT (2025-11-12 r3)
//  - Ensures __LM_MATERIALS sheet + header (idempotent)
//  - Listens to `lm:sheet-context` and runs once per spreadsheetId
//  - No top-level await / imports; ES5-compatible
// -------------------------------------------------------------------
;(function(){
  'use strict';
  try { console.log('[LociMyu ESM/CDN] boot safe stub loaded'); } catch(_){}

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

  function a1(name, range){ return encodeURIComponent(String(name)) + '!' + range; }
  function f(url, opt){ return window.__lm_fetchJSONAuth(url, opt); }

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
        var exists = !!(((meta||{}).sheets||[]).some(function(s){ return s && s.properties && s.properties.title === '__LM_MATERIALS'; }));
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
      } catch(_){ return ''; }
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
        .then(function(a1v){ if (a1v !== HEAD[0]) return putHeader(spreadsheetId); })
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

  if (typeof window.ensureMaterialsHeader !== 'function') {
    window.ensureMaterialsHeader = ensureMaterialsHeader;
  }

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