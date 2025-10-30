// material.orchestrator.js
(() => {
  const VER = 'V6_12e_MATERIAL_ENUM_ROBUST_BRIDGE';
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
    if (!st.modelKey && typeof window.__lm_modelKey === 'string') st.modelKey = window.__lm_modelKey;
  }
  window.addEventListener('lm:model-ready', onModel);
  document.addEventListener('lm:model-ready', onModel);

  // ---------- Material enumeration (hybrid + fallbacks) ---------------------
  function listMaterialsViaBridge(){
    try{
      const b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
      if (b && typeof b.listMaterials === 'function'){
        const r = b.listMaterials();
        if (Array.isArray(r) && r.length) return r;
      }
    }catch(_e){}
    return [];
  }

  function getSceneCandidates(){
    const cands = [];
    try{ if (typeof window.__lm_getScene === 'function'){ const s = window.__lm_getScene(); if (s) cands.push(s); } }catch(_e){}
    try{ if (window.__lm_viewer && window.__lm_viewer.scene) cands.push(window.__lm_viewer.scene); }catch(_e){}
    try{ if (window.viewer && window.viewer.scene) cands.push(window.viewer.scene); }catch(_e){}
    try{ if (window.THREE && window.__lm_renderer && window.__lm_renderer.scene) cands.push(window.__lm_renderer.scene); }catch(_e){}
    return cands.filter(Boolean);
  }

  function listMaterialsFromScene(scene){
    const set = new Set();
    if (!scene) return [];
    scene.traverse(obj => {
      const m = obj && obj.material;
      if (!m) return;
      if (Array.isArray(m)){
        m.forEach(mi => collectMaterial(mi, set));
      } else {
        collectMaterial(m, set);
      }
    });
    return Array.from(set);
  }

  function collectMaterial(mat, set){
    if (!mat) return;
    const name = (mat.name && String(mat.name).trim()) || ('material.' + (mat.id ?? ''));
    set.add(name);
  }

  async function listMaterialsHybrid(){
    // 0) app-provided helper (rare)
    try{
      if (typeof window.__lm_listMaterials === 'function'){
        const r = window.__lm_listMaterials();
        if (Array.isArray(r) && r.length) return r;
      }
    }catch(_e){}
    // 1) bridge
    const viaBridge = listMaterialsViaBridge();
    if (viaBridge.length) return viaBridge;
    // 2) scene traversal (try multiple candidates)
    const scenes = getSceneCandidates();
    for (const s of scenes){
      const arr = listMaterialsFromScene(s);
      if (arr.length) return arr;
    }
    return [];
  }

  function ensureSelectSlot(){
    const existing =
      document.querySelector('[data-lm="material-select"]') ||
      document.querySelector('#lm-material-select') ||
      document.querySelector('select[name="material"]') ||
      document.querySelector('#material-select');
    if (existing) return existing;
    // create minimal select safely in Material tab
    const box = document.querySelector('[data-lm="material-tab"], #lm-material-tab') || document.body;
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    const sel = document.createElement('select');
    sel.id = 'lm-material-select';
    sel.style.width='100%';
    wrap.appendChild(sel);
    box.prepend(wrap);
    return sel;
  }

  function buildMaterialSelect(materials){
    const sel = ensureSelectSlot();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const add = (val, txt)=>{ const o=document.createElement('option'); o.value=val; o.textContent=txt; sel.appendChild(o); };
    add('', '— Select —');
    materials.forEach(m => add(m, m));
    sel.addEventListener('change', ()=>{ st.currentMaterialKey = sel.value; }, { once:false });
    log('materials populated', materials.length);
  }

  async function populateWhenReady(){
    const retryMax = 40, interval = 200;
    for (let i=0;i<retryMax;i++){
      // try on every loop in case viewer loads slowly
      try{
        const materials = await Promise.resolve(listMaterialsHybrid());
        if (materials && materials.length){
          buildMaterialSelect(materials);
          return;
        }
      }catch(_e){}
      await new Promise(r=>setTimeout(r, interval));
    }
    warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
  }

  // Run when scene/model reported ready
  document.addEventListener('lm:scene-ready', ()=>populateWhenReady(), { once:true });
  document.addEventListener('lm:model-ready', ()=>populateWhenReady(), { once:true });

  // also try after DOMContentLoaded just in case
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(populateWhenReady, 0), { once:true });
  }else{
    setTimeout(populateWhenReady, 0);
  }

  // ---------- Hide __LM_* from sheet pickers --------------------------------
  function hideMaterialsSheetInPicker(){
    const HIDE = (opt) => {
      const txt = (opt.textContent || opt.value || '').trim();
      if (!txt) return false;
      if (txt === '__LM_MATERIALS' || txt.startsWith('__LM_')) { opt.remove(); return true; }
      return false;
    };
    document.querySelectorAll('select option').forEach(HIDE);
    if (!hideMaterialsSheetInPicker._armed){
      hideMaterialsSheetInPicker._armed = true;
      let t=null;
      const mo = new MutationObserver(()=>{
        if (t) clearTimeout(t);
        t = setTimeout(()=>document.querySelectorAll('select option').forEach(HIDE), 60);
      });
      mo.observe(document.body, { childList:true, subtree:true });
    }
  }
  hideMaterialsSheetInPicker();

})();