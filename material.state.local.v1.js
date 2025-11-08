// material.state.local.v1.js
// LociMyu — material per-sheet state (localStorage) + save-bus
// Simplified: only acts when no Sheet context; otherwise sheet bridge handles persistence.
(() => {
  const TAG = '[mat-state v1]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  const KEY = '__LM_MATERIALS_STATE_v1';
  const loadAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(_){ return {}; } };
  const saveAll = (obj) => { localStorage.setItem(KEY, JSON.stringify(obj)); };

  const pane = document.querySelector('#pane-material.pane') || document.querySelector('#panel-material');
  if (!pane) return;

  const sel = pane.querySelector('#pm-material, #materialSelect');
  const rng = pane.querySelector('#pm-opacity-range, #opacityRange');
  if (!sel || !rng) return;

  function nsKey(spreadsheetId, sheetGid){ return `${spreadsheetId||'NOSPREAD'}:${sheetGid??'NOGID'}`; }

  function currentCtx(){
    return (window.getCurrentSheetCtx && window.getCurrentSheetCtx()) || window.__lm_sheetCtx || null;
  }

  // When sheet context exists, skip local persistence entirely.
  function shouldUseLocal(){
    const c = currentCtx();
    return !(c && c.spreadsheetId);
  }

  function applyOpacity(materialKey, v){
    if (window.viewerBridge?.setMaterialOpacity){
      window.viewerBridge.setMaterialOpacity(materialKey, Number(v));
    }
  }

  function fetchMaterialKeys(){
    // no-op in this trimmed local module
  }

  sel.addEventListener('change', ()=>{
    // local module does nothing on select when Sheet context is present
    if (shouldUseLocal()){
      const v = parseFloat(rng.value || '1');
      window.__lm_currentMaterialKey = sel.value;
      applyOpacity(sel.value, v);
    }
  });

  rng.addEventListener('input', () => {
    window.__lm_currentMaterialKey = sel.value;
    const v = parseFloat(rng.value||'1');
    applyOpacity(sel.value, v);

    if (!shouldUseLocal()) return;
    const c = currentCtx() || {};
    const all = loadAll();
    const ns = nsKey(c.spreadsheetId, c.sheetGid);
    all[ns] = all[ns] || {};
    all[ns][sel.value] = { opacity: v, updatedAt: new Date().toISOString(), updatedBy: 'local' };
    saveAll(all);
    log('saved local', ns, sel.value, all[ns][sel.value]);
  });

  setTimeout(fetchMaterialKeys, 0);
  log('armed'); log('ready');
})();
