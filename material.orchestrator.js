/* material.orchestrator.js
   V6_12b_MATERIAL_ENUM_FIX + LM_SYSTEM_SHEET_HIDE
   - Robust material listing after lm:model-ready (30 retries x 200ms)
   - Safe dropdown populate (id: #pm-material, fallbacks)
   - No token dependency for listing
   - Keep existing ensure/upsert paths intact if present on window
   - Hide system sheets (prefix "__LM_") from sheet selectors
*/
(function(){
  const VERSION_TAG = 'V6_12b_MATERIAL_ENUM_FIX';
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  // ---- State ---------------------------------------------------------------
  const state = {
    modelReady:false,
    materialNames: [],
    lastPopulateTs: 0,
  };

  // ---- Utilities -----------------------------------------------------------
  function getMaterialSelect(){
    return document.querySelector('#pm-material, [data-lm="material-select"], #lm-material-select, select[name="material"]');
  }
  function setOptions(select, names){
    if (!select) return;
    const cur = select.value;
    select.innerHTML = '';
    names.forEach(n=>{
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      select.appendChild(opt);
    });
    // Try to keep previous selection
    if (cur && names.includes(cur)) select.value = cur;
    // Fire change so other handlers sync
    const ev = new Event('change', {bubbles:true});
    select.dispatchEvent(ev);
  }

  function unique(arr){ return Array.from(new Set(arr.filter(Boolean))); }

  // Try multiple sources to collect material names
  function collectMaterialNames(){
    // 1) viewer.listMaterials() if available
    try{
      if (window.viewer && typeof window.viewer.listMaterials === 'function'){
        const arr = window.viewer.listMaterials();
        if (Array.isArray(arr) && arr.length) return unique(arr.map(x=>String(x)));
      }
    }catch(e){}
    // 2) Traverse scene (THREE) if available
    try{
      const v = window.__lm_viewer || window.viewer;
      const scene = v && (v.scene || (v.getScene && v.getScene()));
      const THREE = window.THREE || null;
      if (scene){
        const names = [];
        scene.traverse(obj=>{
          if (obj && obj.material){
            const m = obj.material;
            if (Array.isArray(m)) m.forEach(mm=> mm && names.push(mm.name || mm.uuid));
            else names.push(m.name || m.uuid);
          }
        });
        if (names.length) return unique(names);
      }
    }catch(e){}
    // 3) Fallback no data
    return [];
  }

  // Populate loop with retries after model-ready
  async function populateWhenReady(){
    const select = getMaterialSelect();
    let tries = 30;
    while (tries-- > 0){
      const names = collectMaterialNames();
      if (names.length){
        state.materialNames = names;
        setOptions(select, names);
        log('materials populated', names.length);
        return true;
      }
      await new Promise(r=>setTimeout(r, 200));
    }
    warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
    return false;
  }

  // Wire model-ready to trigger populate
  function onModelReady(){
    state.modelReady = true;
    populateWhenReady();
  }

  document.addEventListener('lm:model-ready', onModelReady);
  window.addEventListener('lm:model-ready', onModelReady);

  // Also attempt once after DOMContentLoaded in case model is already ready
  document.addEventListener('DOMContentLoaded', ()=>{
    setTimeout(()=>{ if (!state.materialNames.length) populateWhenReady(); }, 500);
  });

  // ---- System sheet hiding (UI polish) ------------------------------------
  // Simple DOM filter for any <select> that lists sheet titles.
  // Heuristics: ids/names that contain "sheet" and option text starting with "__LM_".
  function scrubSystemSheets(root){
    const selects = Array.from(root.querySelectorAll('select')).filter(s=>{
      const idn = (s.id || '') + ' ' + (s.name || '') + ' ' + (s.getAttribute('data-lm')||'');
      return /sheet|sheets|worksheet/i.test(idn);
    });
    selects.forEach(sel=>{
      let changed = false;
      Array.from(sel.options).forEach(opt=>{
        const txt = (opt.textContent || opt.value || '').trim();
        if (txt.startsWith('__LM_')){
          opt.remove();
          changed = true;
        }
      });
      if (changed){
        const ev = new Event('change', {bubbles:true});
        sel.dispatchEvent(ev);
      }
    });
  }

  // Observe changes to keep it filtered
  const mo = new MutationObserver(muts=>{
    muts.forEach(m=>{
      if (m.type === 'childList'){
        m.addedNodes.forEach(node=>{
          if (node.nodeType === 1){
            scrubSystemSheets(node);
          }
        });
      }
    });
  });
  mo.observe(document.documentElement, {subtree:true, childList:true});
  // Initial sweep
  document.addEventListener('DOMContentLoaded', ()=>scrubSystemSheets(document));

  // ---- Sheet context logging passthrough (non-breaking) -------------------
  function onSheetCtx(ev){
    const d = (ev && ev.detail) || {};
    log('sheet context set', {spreadsheetId:d.spreadsheetId, sheetGid:d.sheetGid});
  }
  document.addEventListener('lm:sheet-context', onSheetCtx);
  window.addEventListener('lm:sheet-context', onSheetCtx);

  log('loaded VERSION_TAG:'+VERSION_TAG);
})();