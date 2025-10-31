/*! material.orchestrator.js (enum + UI populate robust) */
(function(){
  var VER='V6_12h_ENUM_ROBUST_SCAN';
  var NS='[mat-orch]';
  function log(){ try{ console.log.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} }
  function warn(){ try{ console.warn.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} }
  log('loaded VERSION_TAG:'+VER);

  var st = (window.__lm_materialState = window.__lm_materialState || {
    spreadsheetId:null, sheetGid:null, modelKey:null, currentMaterialKey:null
  });

  function onSheetCtx(ev){
    var d = (ev && ev.detail) || {};
    if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid!=='undefined') st.sheetGid = d.sheetGid;
    log('sheet context set', {spreadsheetId:st.spreadsheetId, sheetGid:st.sheetGid});
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  // ---- UI helpers -----------------------------------------------------------
  function getSelect(){
    return document.querySelector('[data-lm="material-select"]')
        || document.querySelector('#lm-material-select')
        || document.querySelector('select[name="material"]')
        || document.querySelector('#material-select')
        || null;
  }
  function ensureSelect(){
    var sel = getSelect();
    if (sel) return sel;
    var box = document.querySelector('[data-lm="material-tab"]')
           || document.querySelector('#lm-material-tab')
           || document.querySelector('[data-lm="right-panel"]')
           || document.querySelector('#right-panel')
           || document.body;
    var wrap = document.createElement('div');
    wrap.style.cssText='margin:6px 0;';
    var lab = document.createElement('div');
    lab.textContent='Select material';
    lab.style.cssText='font-size:12px;opacity:.7;margin-bottom:4px;';
    sel = document.createElement('select');
    sel.id = 'lm-material-select';
    sel.style.width='100%';
    wrap.appendChild(lab);
    wrap.appendChild(sel);
    box.prepend(wrap);
    return sel;
  }
  function fillSelect(values){
    var sel = ensureSelect();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    function add(v,t){ var o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); }
    add('', '— Select —');
    values.forEach(function(v){ add(v,v); });
    sel.onchange = function(){ st.currentMaterialKey = sel.value; };
    sel.dispatchEvent(new Event('change', {bubbles:true}));
  }

  // ---- hide __LM_* in any sheet pickers ------------------------------------
  (function hideSheetNames(){
    function hide(opt){
      try{
        var txt = (opt.textContent || opt.value || '').trim();
        if (txt && (txt==='__LM_MATERIALS' || txt.indexOf('__LM_')===0)) opt.remove();
      }catch(e){}
    }
    var mo = new MutationObserver(function(){ document.querySelectorAll('select option').forEach(hide); });
    mo.observe(document.body, {childList:true, subtree:true});
    document.addEventListener('DOMContentLoaded', function(){ document.querySelectorAll('select option').forEach(hide); });
    setTimeout(function(){ document.querySelectorAll('select option').forEach(hide); }, 400);
  })();

  // ---- materials enumeration ------------------------------------------------
  function listFromBridge(){
    try{
      var b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
      if (b && typeof b.listMaterials==='function'){
        var arr = b.listMaterials() || [];
        return Array.isArray(arr) ? arr.slice() : [];
      }
    }catch(e){}
    return [];
  }
  function listFromScene(){
    var scene = (window.__lm_getScene && window.__lm_getScene())
             || (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene())
             || (window.__lm_viewer && window.__lm_viewer.scene)
             || (window.viewer && window.viewer.scene)
             || null;
    var THREE = window.THREE;
    if (!scene || !THREE) return [];
    function badType(m){
      var t=(m&&m.type)||'';
      if (/Depth|Distance|Shadow|Sprite|Shader/.test(t)) return true;
      return !!(m && (m.isLineBasicMaterial || m.isLineDashedMaterial || m.isPointsMaterial));
    }
    var set={};
    scene.traverse(function(obj){
      if (obj && (obj.type==='Sprite' || (obj.name && obj.name.indexOf('__LM_')===0) || (obj.userData && obj.userData.__lmOverlay))) return;
      var mat = obj && obj.material;
      function push(m){
        if (!m || badType(m)) return;
        var n=(m.name||'').trim();
        if (!n || /^material\.\d+$/.test(n)) return;
        set[n]=true;
      }
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(push); else push(mat);
    });
    return Object.keys(set);
  }

  // ---- populate with retry --------------------------------------------------
  async function populateWhenReady(){
    var tries=0, max=60; // ~12s
    while(tries++<max){
      var mats = listFromBridge();
      if (!mats.length) mats = listFromScene();
      if (mats.length){
        fillSelect(mats);
        log('materials populated', mats.length);
        return;
      }
      await new Promise(function(r){ setTimeout(r, 200); });
      if (tries===5 || tries===15 || tries===30) warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
    }
  }

  // kick
  populateWhenReady();
})();