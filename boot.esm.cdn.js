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
