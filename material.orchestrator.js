// LociMyu Material Orchestrator (robust enum + Sheets ensure + UI glue)
// VERSION_TAG: V6_12f_ENUM_FROM_BRIDGE
(function(){
  const VER = 'V6_12f_ENUM_FROM_BRIDGE';
  const NS  = '[mat-orch]';
  const log = (...a)=>console.log(NS, ...a);
  const warn= (...a)=>console.warn(NS, ...a);
  log('loaded VERSION_TAG:'+VER);

  // -------- State -----------------------------------------------------------
  const st = (window.__lm_materialState = window.__lm_materialState || {
    spreadsheetId:null,
    sheetGid:null,
    modelKey:null,
    currentMaterialKey:null,
    sceneReady:false,
    modelReady:false,
  });

  // -------- Events ----------------------------------------------------------
  function onSheetCtx(ev){
    const d = ev && ev.detail || {};
    if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
    log('sheet context set', {spreadsheetId: st.spreadsheetId, sheetGid: st.sheetGid});
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  function onSceneReady(){ st.sceneReady = true; tryPopulateSoon('scene'); }
  function onModelReady(){ st.modelReady = true; tryPopulateSoon('model'); }
  window.addEventListener('lm:scene-ready', onSceneReady);
  document.addEventListener('lm:scene-ready', onSceneReady);
  window.addEventListener('lm:model-ready', onModelReady);
  document.addEventListener('lm:model-ready', onModelReady);

  // -------- UI helpers ------------------------------------------------------
  function ownSelect(){
    return document.querySelector('[data-lm="material-select"]')
        || document.querySelector('#lm-material-select')
        || document.querySelector('select[name="material"]')
        || document.querySelector('#material-select')
        || createSelectSlot();
  }
  function createSelectSlot(){
    const box = document.querySelector('[data-lm="material-tab"], #lm-material-tab') || document.body;
    const wrap = document.createElement('div');
    wrap.style.marginBottom='8px';
    const sel = document.createElement('select');
    sel.id = 'lm-material-select';
    sel.style.width='100%';
    wrap.appendChild(sel);
    box.prepend(wrap);
    return sel;
  }
  function fillSelect(materials){
    const sel = ownSelect();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '— Select material —');
    materials.forEach(n=>add(n,n));
    sel.addEventListener('change', ()=>{ st.currentMaterialKey = sel.value; }, { once:false });
    log('materials populated', materials.length);
  }

  // -------- Bridge-based enumeration ---------------------------------------
  function listViaBridge(){
    const b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
    if (!b) return [];
    try{
      if (typeof b.listMaterials === 'function'){
        const r = b.listMaterials();
        return (r && typeof r.then==='function') ? [] : (Array.isArray(r) ? r : []);
      }
    }catch(e){ /* ignore */}
    return [];
  }

  // Fallback: traverse a Scene if bridge exposes getScene()
  function listViaScene(){
    const b = window.viewerBridge;
    if (!b || typeof b.getScene!=='function') return [];
    const scene = b.getScene();
    if (!scene || typeof scene.traverse!=='function') return [];
    const set = new Set();
    const nameOf = (m)=> (m && m.name && String(m.name).trim()) || (m && m.id!=null ? ('material.'+m.id) : '');
    try{
      scene.traverse(obj=>{
        const mat = obj && obj.material;
        if (!mat) return;
        if (Array.isArray(mat)) mat.forEach(m=>{ const n=nameOf(m); if(n) set.add(n); });
        else { const n=nameOf(mat); if(n) set.add(n); }
      });
    }catch(_e){}
    return Array.from(set);
  }

  // Main populate loop (retries a few times)
  let populated = false;
  async function populateWhenReady(){
    if (populated) return;
    const MAX = 40; // ~8s
    for (let i=0;i<MAX && !populated;i++){
      let mats = listViaBridge();
      if (!mats.length) mats = listViaScene();
      if (mats && mats.length){
        fillSelect(mats);
        populated = true;
        break;
      }
      await new Promise(r=>setTimeout(r, 200));
    }
    if (!populated) warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
  }
  function tryPopulateSoon(reason){
    // kick quickly then let the loop continue
    setTimeout(populateWhenReady, 0);
  }

  // expose a tiny debug api
  window.__lm_material_orch_debug = Object.assign(window.__lm_material_orch_debug||{}, {
    populateWhenReady,
    listViaBridge,
    listViaScene,
  });

  // initial kick (in case events already fired)
  tryPopulateSoon('boot');
})();
