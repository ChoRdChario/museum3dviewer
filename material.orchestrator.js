/* LociMyu Material Orchestrator (panel-targeted)
 * VERSION_TAG: V6_12j_PANEL_SELECT
 * Purpose:
 *   - Enumerate materials from viewerBridge (or scene fallback) after model is ready
 *   - Populate the EXISTING material dropdown in the Material tab (middle/right panel)
 *   - Do NOT render any extra "diagnostic" select at top of page
 *   - Hide '__LM_*' sheets from any sheet pickers
 *
 * Safe to drop-in over previous 'material.orchestrator.js'.
 */
(function(){
  var VER = 'V6_12j_PANEL_SELECT';
  var NS  = '[mat-orch]';
  var log = function(){ try{ console.log.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} };
  var warn= function(){ try{ console.warn.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} };

  log('loaded VERSION_TAG:'+VER);

  // ---------- State ----------------------------------------------------------
  var st = (window.__lm_materialState = window.__lm_materialState || {
    spreadsheetId: null,
    sheetGid: null,
    modelReady: false,
    sceneReady: false,
    populatedOnce: false
  });

  // ---------- Sheet context wiring ------------------------------------------
  function onSheetCtx(ev){
    try{
      var d = (ev && ev.detail) || {};
      if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
      if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
      log('sheet context set', {spreadsheetId: st.spreadsheetId, sheetGid: st.sheetGid});
    }catch(e){}
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  // ---------- Bridge helpers -------------------------------------------------
  function getBridge(){
    return window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge || null;
  }
  function listMaterialsFromBridge(){
    try{
      var b = getBridge();
      if (b && typeof b.listMaterials === 'function'){
        var arr = b.listMaterials() || [];
        if (Array.isArray(arr)) return arr.slice();
      }
    }catch(e){}
    return [];
  }
  function getScene(){
    try{
      var b = getBridge();
      if (b && typeof b.getScene === 'function'){
        var s = b.getScene();
        if (s && s.isScene) return s;
      }
    }catch(e){}
    // fallbacks
    try{
      if (window.__lm_getScene) {
        var s2 = window.__lm_getScene();
        if (s2 && s2.isScene) return s2;
      }
    }catch(e){}
    try{
      var v = window.__lm_viewer || window.viewer || null;
      if (v && v.scene && v.scene.isScene) return v.scene;
    }catch(e){}
    return null;
  }
  function listMaterialsFromScene(scene){
    var THREE = window.THREE;
    if (!scene || !THREE) return [];
    // filters
    function badType(m){
      var t = (m && m.type) || '';
      if (/Depth|Distance|Shadow|Sprite|Shader/.test(t)) return true;
      return !!(m && (m.isLineBasicMaterial || m.isLineDashedMaterial || m.isPointsMaterial));
    }
    function isOverlayObj(o){
      return !!(o && (o.type === 'Sprite' || (o.name && o.name.indexOf('__LM_') === 0) || (o.userData && o.userData.__lmOverlay)));
    }
    var set = {};
    scene.traverse(function(obj){
      if (isOverlayObj(obj)) return;
      var mat = obj && obj.material;
      function push(m){
        if (!m || badType(m)) return;
        var n = (m.name || '').trim();
        if (!n || /^material\.\d+$/.test(n)) return; // drop placeholders
        set[n] = true;
      }
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(push); else push(mat);
    });
    return Object.keys(set);
  }

  // ---------- Panel select detection ----------------------------------------
  function getRightPanelRoot(){
    return document.querySelector('[data-lm="right-panel"]')
        || document.querySelector('#right-panel')
        || document.querySelector('#panel')
        || document.body;
  }
  function getMaterialSection(){
    var root = getRightPanelRoot();
    var cands = [
      root && root.querySelector('[data-lm="material-tab"]'),
      root && root.querySelector('#lm-material-tab'),
      root && root.querySelector('#tab-material'),
      root
    ];
    for (var i=0;i<cands.length;i++){ if (cands[i]) return cands[i]; }
    return root;
  }
  function findPanelSelect(){
    var box = getMaterialSection();
    if (!box) return null;
    // Priority selectors
    var sel =
      box.querySelector('[data-lm="material-select"]') ||
      box.querySelector('#material-select') ||
      box.querySelector('select[name="material"]');
    if (sel) return sel;
    // Heuristic: nearest select to a label containing 'Select material' or 'material'
    var labels = box.querySelectorAll('div, label, span, p');
    for (var i=0;i<labels.length;i++){
      var t = (labels[i].textContent || '').toLowerCase();
      if (!t) continue;
      if (t.indexOf('select material')>=0 || t.indexOf('material')>=0){
        var near = labels[i].parentElement;
        if (!near) continue;
        var s = near.querySelector('select');
        if (s) return s;
      }
    }
    // Fallback: pick first empty-ish select inside the Material tab
    var all = box.querySelectorAll('select');
    for (var j=0;j<all.length;j++){
      var s2 = all[j];
      if (s2.id === 'lm-material-select') continue; // ignore any debug/detached select
      if (!s2.options || s2.options.length <= 1) return s2;
    }
    return null;
  }

  // ---------- Populate into panel select ------------------------------------
  function populatePanelSelect(materials){
    var sel = findPanelSelect();
    if (!sel){
      warn('panel select not found');
      return false;
    }
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var add = function(v,t){ var o=document.createElement('option'); o.value=v; o.textContent=t||v; sel.appendChild(o); };
    add('', '-- Select --');
    for (var i=0;i<materials.length;i++) add(materials[i], materials[i]);
    sel.value = '';
    try{ sel.dispatchEvent(new Event('change', {bubbles:true})); }catch(e){}
    log('materials populated', materials.length);
    return true;
  }

  // ---------- Hide __LM_* in sheet pickers ----------------------------------
  function hideMaterialsSheetInPicker(){
    function HIDE(opt){
      var txt = ((opt && (opt.textContent || opt.value)) || '').trim();
      if (!txt) return false;
      if (txt === '__LM_MATERIALS' || txt.indexOf('__LM_') === 0){ if (opt && opt.parentNode) opt.parentNode.removeChild(opt); return true; }
      return false;
    }
    try{ Array.prototype.forEach.call(document.querySelectorAll('select option'), HIDE); }catch(e){}
    if (!hideMaterialsSheetInPicker._armed){
      hideMaterialsSheetInPicker._armed = true;
      var t = null;
      try{
        var mo = new MutationObserver(function(){
          if (t) clearTimeout(t);
          t = setTimeout(function(){
            try{ Array.prototype.forEach.call(document.querySelectorAll('select option'), HIDE); }catch(e){}
          }, 60);
        });
        mo.observe(document.body, {childList:true, subtree:true});
      }catch(e){}
    }
  }
  hideMaterialsSheetInPicker();

  // ---------- Main populate flow --------------------------------------------
  function enumerateMaterials(){
    var list = listMaterialsFromBridge();
    if (list.length) return list;
    var scene = getScene();
    if (!scene) return [];
    return listMaterialsFromScene(scene);
  }

  function populateWhenReady(){
    if (st.populatedOnce) return;
    var tries = 0, MAX = 40;
    (function tick(){
      tries++;
      var mats = enumerateMaterials();
      var ok = false;
      if (mats && mats.length){
        ok = populatePanelSelect(mats);
      }
      if (ok){
        st.populatedOnce = true;
        return;
      }
      if (tries < MAX){
        setTimeout(tick, 250);
      }else{
        warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
      }
    })();
  }

  // ---------- Tab activation watcher ----------------------------------------
  function isMaterialTabActive(){
    try{
      var root = getRightPanelRoot();
      // Look for a tab button that is "Material" and active-ish
      var tabs = (root && root.querySelectorAll('button, a, [role="tab"]')) || [];
      for (var i=0;i<tabs.length;i++){
        var t = (tabs[i].textContent || '').trim().toLowerCase();
        if (!t) continue;
        if (t === 'material' || t === 'materials'){
          // if it looks selected via aria or class
          if (tabs[i].getAttribute('aria-selected') === 'true') return true;
          var cls = tabs[i].className || '';
          if (/\bactive\b/.test(cls)) return true;
        }
      }
    }catch(e){}
    return false;
  }
  function armTabWatcher(){
    // Re-populate when Material tab becomes active
    var root = getRightPanelRoot();
    function handler(){ if (isMaterialTabActive()) populateWhenReady(); }
    try{
      root.addEventListener('click', handler, true);
      root.addEventListener('keydown', function(ev){ var k=(ev.key||'').toLowerCase(); if (k==='enter' || k===' ') handler(); }, true);
    }catch(e){}
  }
  armTabWatcher();

  // ---------- Scene/model ready bridges -------------------------------------
  function onScene(){ st.sceneReady = true; populateWhenReady(); }
  function onModel(){ st.modelReady = true; populateWhenReady(); }
  window.addEventListener('lm:scene-ready', onScene);
  document.addEventListener('lm:scene-ready', onScene);
  window.addEventListener('lm:model-ready', onModel);
  document.addEventListener('lm:model-ready', onModel);

  // Try immediately as well (in case tab is already active and model ready)
  setTimeout(populateWhenReady, 0);
})();
