(function(){
  'use strict';
  var VER = 'V6_12i_TAB_ACTIVATE_ENUM';
  var NS  = '[mat-orch]';
  function log(){ try{ console.log.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} }
  function warn(){ try{ console.warn.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} }

  // --------------------------------------------------------------------------
  // Shared state
  // --------------------------------------------------------------------------
  var st = (window.__lm_materialState = window.__lm_materialState || {
    populatedOnce: false,
    spreadsheetId: null,
    sheetGid: null
  });

  // --------------------------------------------------------------------------
  // Hide __LM_* sheets from any sheet pickers (defensive; idempotent)
  // --------------------------------------------------------------------------
  function hideMaterialsSheetInPicker(){
    function hideOpt(opt){
      if (!opt) return;
      var txt = (opt.textContent || opt.value || '').trim();
      if (!txt) return;
      if (txt === '__LM_MATERIALS' || (txt.indexOf('__LM_') === 0)) {
        try { opt.parentNode && opt.parentNode.removeChild(opt); } catch(e){}
      }
    }
    var i, opts = document.querySelectorAll('select option');
    for (i = 0; i < opts.length; i++) hideOpt(opts[i]);
    if (!hideMaterialsSheetInPicker._armed){
      hideMaterialsSheetInPicker._armed = true;
      var t = null;
      var mo = new MutationObserver(function(){
        if (t) clearTimeout(t);
        t = setTimeout(function(){
          var j, oo = document.querySelectorAll('select option');
          for (j = 0; j < oo.length; j++) hideOpt(oo[j]);
        }, 60);
      });
      mo.observe(document.body, { childList:true, subtree:true });
    }
  }

  // --------------------------------------------------------------------------
  // Material tab detection
  // --------------------------------------------------------------------------
  function findMaterialTabButton(){
    // Candidates: role=tab, button, a, div with tab semantics
    var cands = document.querySelectorAll('[role="tab"], button, a, div');
    for (var i=0; i<cands.length; i++){
      var el = cands[i];
      var txt = (el.textContent || '').trim().toLowerCase();
      if (!txt) continue;
      if (txt === 'material' || txt === 'materials') return el;
    }
    // Fallback: any element marked by data-lm attribute
    var marked = document.querySelector('[data-lm="material-tab-btn"]');
    return marked || null;
  }
  function isMaterialTabActive(){
    // Prefer an explicit panel element if present
    var panel = document.querySelector('#lm-material-tab, [data-lm="material-tab"]');
    if (panel){
      var style = window.getComputedStyle(panel);
      // visible if display not 'none' and visibility not 'hidden'
      if (style && style.display !== 'none' && style.visibility !== 'hidden') return true;
    }
    // Otherwise rely on tab button state (aria-selected, aria-pressed, class)
    var btn = findMaterialTabButton();
    if (btn){
      var sel = btn.getAttribute('aria-selected');
      if (sel === 'true') return true;
      var prs = btn.getAttribute('aria-pressed');
      if (prs === 'true') return true;
      var cls = btn.className || '';
      if (/\bactive\b/.test(cls)) return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Select helper (create if missing inside Material panel)
  // --------------------------------------------------------------------------
  function getOrCreateSelect(){
    var sel =
      document.querySelector('[data-lm="material-select"]') ||
      document.querySelector('#lm-material-select') ||
      document.querySelector('select[name="material"]') ||
      document.querySelector('#material-select');
    if (sel) return sel;

    var host =
      document.querySelector('#lm-material-tab') ||
      document.querySelector('[data-lm="material-tab"]') ||
      document.querySelector('[data-lm="right-panel"]') ||
      document.querySelector('#right-panel') ||
      document.body;

    var wrap = document.createElement('div');
    wrap.style.margin = '6px 0';
    var label = document.createElement('div');
    label.textContent = 'Select material';
    label.style.cssText = 'font-size:12px;opacity:.7;margin-bottom:4px;';
    sel = document.createElement('select');
    sel.id = 'lm-material-select';
    sel.style.width = '100%';
    wrap.appendChild(label);
    wrap.appendChild(sel);
    if (host && host.firstChild) host.insertBefore(wrap, host.firstChild);
    else (host || document.body).appendChild(wrap);
    return sel;
  }
  function populateSelect(values){
    var sel = getOrCreateSelect();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    function add(v,t){ var o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    add('', '-- Select --');
    for (var i=0; i<values.length; i++) add(values[i], values[i]);
    sel.dispatchEvent(new Event('change', {bubbles:true}));
  }

  // --------------------------------------------------------------------------
  // Material enumeration (bridge first, then scene traverse)
  // --------------------------------------------------------------------------
  function uniqueStrings(arr){
    var out = [], seen = {};
    for (var i=0;i<arr.length;i++){
      var s = (arr[i] || '').trim();
      if (!s) continue;
      if (seen[s]) continue;
      seen[s] = true; out.push(s);
    }
    return out;
  }
  function filterNames(list){
    var out = [];
    for (var i=0;i<list.length;i++){
      var n = (list[i] || '').trim();
      if (!n) continue;
      // Exclude placeholder material.NN
      if (/^material\.\d+$/.test(n)) continue;
      out.push(n);
    }
    return uniqueStrings(out);
  }
  function listFromBridge(){
    try{
      var b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
      if (b && typeof b.listMaterials === 'function'){
        var arr = b.listMaterials() || [];
        return Array.isArray(arr) ? filterNames(arr) : [];
      }
    }catch(e){}
    return [];
  }
  function findScene(){
    try{
      var s =
        (window.viewerBridge && typeof window.viewerBridge.getScene === 'function' && window.viewerBridge.getScene()) ||
        (window.__lm_getScene && window.__lm_getScene()) ||
        (window.__lm_viewer && window.__lm_viewer.scene) ||
        (window.viewer && window.viewer.scene) ||
        null;
      if (s && (s.isScene || s.type === 'Scene')) return s;
    }catch(e){}
    return null;
  }
  function listFromScene(){
    var scene = findScene();
    var THREE = window.THREE;
    if (!scene || !THREE || typeof scene.traverse !== 'function') return [];
    var set = {};
    function badType(m){
      var t = (m && m.type) || '';
      if (/Depth|Distance|Shadow|Sprite|Shader/.test(t)) return true;
      return !!(m && (m.isLineBasicMaterial || m.isLineDashedMaterial || m.isPointsMaterial));
    }
    function isOverlayObj(o){
      if (!o) return false;
      if (o.type === 'Sprite') return true;
      if (o.name && o.name.indexOf('__LM_') === 0) return true;
      if (o.userData && o.userData.__lmOverlay) return true;
      return false;
    }
    scene.traverse(function(obj){
      if (isOverlayObj(obj)) return;
      var mat = obj && obj.material;
      function push(m){
        if (!m || badType(m)) return;
        var n = (m.name || '').trim();
        if (!n || /^material\.\d+$/.test(n)) return;
        set[n] = true;
      }
      if (!mat) return;
      if (Array.isArray(mat)) for (var i=0;i<mat.length;i++) push(mat[i]); else push(mat);
    });
    return Object.keys(set);
  }

  // One-shot populate (with small retry/backoff once the Material tab becomes active)
  function populateWhenMaterialTabActive(){
    if (st.populatedOnce) return;
    var maxMs = 12000;
    var start = Date.now();
    function tick(){
      if (st.populatedOnce) return;
      if (!isMaterialTabActive()){
        if (Date.now() - start < maxMs) { setTimeout(tick, 250); }
        return;
      }
      // Try bridge first, then scene
      var names = listFromBridge();
      if (!names.length) names = listFromScene();
      if (names.length){
        populateSelect(names);
        st.populatedOnce = true;
        log('materials populated', names.length);
        return;
      }
      if (Date.now() - start < maxMs){
        setTimeout(tick, 300);
      }else{
        warn('materials still empty after retries (non-fatal)');
      }
    }
    tick();
  }

  // --------------------------------------------------------------------------
  // Wire listeners
  // --------------------------------------------------------------------------
  function armTabListeners(){
    // Click on a likely "Material" tab button
    var btn = findMaterialTabButton();
    if (btn && !btn.__lm_mat_btn_armed){
      btn.__lm_mat_btn_armed = true;
      btn.addEventListener('click', function(){ setTimeout(populateWhenMaterialTabActive, 50); }, true);
    }
    // Observe attribute changes to detect activation
    var moTarget =
      document.querySelector('#lm-material-tab') ||
      document.querySelector('[data-lm="material-tab"]') ||
      btn || document.body;
    try{
      var mo = new MutationObserver(function(){
        populateWhenMaterialTabActive();
      });
      mo.observe(moTarget, { attributes:true, childList:true, subtree:true });
    }catch(e){}
  }

  // --------------------------------------------------------------------------
  // Sheet context bookkeeping (no-ops here but kept for completeness)
  // --------------------------------------------------------------------------
  function onSheetCtx(ev){
    try{
      var d = (ev && ev.detail) || {};
      if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
      if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
      log('sheet context set', { spreadsheetId: st.spreadsheetId, sheetGid: st.sheetGid });
    }catch(e){}
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  // --------------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------------
  try {
    log('loaded VERSION_TAG:' + VER);
    hideMaterialsSheetInPicker();
    armTabListeners();
    // In case the tab is already active at first paint, try soon.
    setTimeout(populateWhenMaterialTabActive, 200);
  } catch(e){
    warn('init failed', e && (e.message || e));
  }
})();