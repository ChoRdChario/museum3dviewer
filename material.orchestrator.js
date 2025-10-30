// material.orchestrator.js
// LociMyu Material Orchestrator (robust material enumeration + dropdown populate)
// VERSION_TAG: V6_12d_MATERIAL_ENUM_ROBUST
// This module focuses on reliably populating the material dropdown without
// touching token/Sheets flows. It is safe to drop-in.

(function(){
  const VER = 'V6_12d_MATERIAL_ENUM_ROBUST';
  const NS  = '[mat-orch]';
  const log = (...a)=>console.log(NS, ...a);
  const warn= (...a)=>console.warn(NS, ...a);

  log('loaded VERSION_TAG:'+VER);

  // ---------- State ---------------------------------------------------------
  const st = (window.__lm_materialState = window.__lm_materialState || {
    spreadsheetId: null,
    sheetGid: null,
    modelKey: null,
    currentMaterialKey: null,
    modelReady: false,
    sceneReady: false
  });

  // ---------- Events wiring (robust: listen on both window & document) ------
  function onSheetCtx(ev){
    const d = ev?.detail || {};
    if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
    log('sheet context set', {spreadsheetId: st.spreadsheetId, sheetGid: st.sheetGid});
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  function onScene(){ st.sceneReady = true; }
  window.addEventListener('lm:scene-ready', onScene);
  document.addEventListener('lm:scene-ready', onScene);

  function onModel(){
    st.modelReady = true;
    // absorb optional model key if provided by host
    if (!st.modelKey && typeof window.__lm_modelKey === 'string') st.modelKey = window.__lm_modelKey;
  }
  window.addEventListener('lm:model-ready', onModel);
  document.addEventListener('lm:model-ready', onModel);

  // ---------- DOM helpers ---------------------------------------------------
  function $(sel){ return document.querySelector(sel); }
  function findMaterialSelect(){
    return (
      $('#lm-material-select') ||
      document.querySelector('[data-lm="material-select"]') ||
      document.querySelector('select[name="material"]') ||
      document.querySelector('select.lm-material-select')
    );
  }

  function ensurePlaceholderOption(selectEl){
    // Keep first option as placeholder. If none, add one.
    if (!selectEl) return;
    const first = selectEl.options && selectEl.options[0];
    if (!first || (first.value && first.value !== '')){
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— Select material —';
      selectEl.insertBefore(opt, selectEl.firstChild);
    }
  }

  // ---------- Scene/Materials discovery ------------------------------------
  function callIfFn(fn){
    try{
      if (typeof fn === 'function') return fn();
    }catch(_e){}
    return null;
  }

  function findScene(){
    // Try multiple well-known bridges/vars
    let scene =
      callIfFn(window.__lm_getScene) ||
      (window.viewer && window.viewer.scene) ||
      (window.__lm_viewer && window.__lm_viewer.scene) ||
      window.__lm_threeScene ||
      null;
    return scene || null;
  }

  function listMaterialsFromScene(scene){
    const out = new Map(); // key: displayName -> true
    try{
      if (!scene || !scene.traverse) return [];
      scene.traverse(obj => {
        let mats = null;
        if (obj && obj.material){
          mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        }
        if (!mats) return;
        for (const m of mats){
          if (!m) continue;
          let name = '';
          try{
            name = (m.name || '').trim();
          }catch(_e){ name = ''; }
          if (!name) {
            // Construct a readable fallback
            const base = (m.type || 'material').toLowerCase();
            name = `${base}.${(m.id!=null ? m.id : Math.random().toString(36).slice(2,6))}`;
          }
          if (!out.has(name)) out.set(name, true);
        }
      });
    }catch(_e){/* ignore */}
    return Array.from(out.keys()).sort((a,b)=>a.localeCompare(b));
  }

  // ---------- UI populate ---------------------------------------------------
  function buildMaterialSelect(materials){
    const sel = findMaterialSelect();
    if (!sel) return false;
    // Clear (keep placeholder if present)
    const keepFirst = 1;
    while (sel.options.length > keepFirst) sel.remove(sel.options.length-1);
    ensurePlaceholderOption(sel);
    for (const name of materials){
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    sel.disabled = false;
    // remember to state
    sel.addEventListener('change', ()=>{
      st.currentMaterialKey = sel.value;
    }, {once:false, passive:true});
    return true;
  }

  // Retry-populate loop: wait for both scene + select
  async function populateWhenReady(){
    const retryMax = 30; // ~6s
    const interval = 200;
    for (let i=0;i<retryMax;i++){
      const sel = findMaterialSelect();
      const scene = findScene();
      if (sel && scene){
        const materials = listMaterialsFromScene(scene);
        if (materials && materials.length){
          buildMaterialSelect(materials);
          return;
        }
      }
      await new Promise(r=>setTimeout(r, interval));
    }
    warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
  }

  // Kick after DOM ready as well
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(populateWhenReady, 0), {once:true});
  }else{
    setTimeout(populateWhenReady, 0);
  }
  // Also kick on our lifecycle events
  window.addEventListener('lm:model-ready', ()=>setTimeout(populateWhenReady, 0), {once:false});
  document.addEventListener('lm:model-ready', ()=>setTimeout(populateWhenReady, 0), {once:false});
  window.addEventListener('lm:scene-ready', ()=>setTimeout(populateWhenReady, 0), {once:false});
  document.addEventListener('lm:scene-ready', ()=>setTimeout(populateWhenReady, 0), {once:false});

  // ---------- Debug surface -------------------------------------------------
  window.__lm_material_orch_debug = {
    VER,
    findScene,
    listMaterialsFromScene,
    populateWhenReady
  };
})();