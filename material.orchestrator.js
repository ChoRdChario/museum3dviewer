/* material.orchestrator.js (safe vA3.4) */
(() => {
  const TAG = '[mat-orch]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // prefer pane-material; fall back to panel-material (but we won't bind outside pane when both exist)
  const pane = document.querySelector('#pane-material.pane') || document.querySelector('#panel-material');
  if (!pane){ warn('pane not found (#pane-material/#panel-material)'); return; }

  // query helpers (scoped to pane only)
  const q = (sel)=> pane.querySelector(sel);
  let sel = q('#pm-material, #materialSelect');
  let rng = q('#pm-opacity-range, #opacityRange');

  let tries = 0;
  function tryBind(){
    sel = q('#pm-material, #materialSelect');
    rng = q('#pm-opacity-range, #opacityRange');
    if (sel && rng){
      bind();
      return true;
    }
    if (++tries > 60){ warn('controls not found after retry'); return true; }
    return false;
  }

  if (!sel || !rng){
    const tm = setInterval(()=>{ if (tryBind()) clearInterval(tm); }, 250);
  } else {
    bind();
  }

  function bind(){
    log('UI found', {pane, select: sel, opacity: rng});
    // selection change -> restore (no save)
    sel.addEventListener('change', () => {
      const key = sel.value;
      window.__lm_currentMaterialKey = key;
      // restore from sheet index if available
      const ctx = (window.getCurrentSheetCtx && window.getCurrentSheetCtx()) || window.__lm_sheetCtx || {};
      const modelKey = (window.getCurrentModelKey && window.getCurrentModelKey()) || 'NOMODEL';
      const snap = (window.lmLookupMaterialSnapshot && window.lmLookupMaterialSnapshot(ctx, modelKey, key)) || { opacity: 1 };
      // silent UI update
      rng.value = String(snap.opacity ?? 1);
      if (window.viewerBridge?.setMaterialOpacity){
        window.viewerBridge.setMaterialOpacity(key, Number(snap.opacity ?? 1));
      }
      log('restored', key, snap.opacity);
    });

    // opacity input -> viewer + schedule save
    rng.addEventListener('input', () => {
      const key = (window.__lm_currentMaterialKey = sel.value);
      const v = Number(rng.value || '1');
      if (window.viewerBridge?.setMaterialOpacity){
        window.viewerBridge.setMaterialOpacity(key, v);
      }
      if (window.lmScheduleSave){
        window.lmScheduleSave(key, { opacity: v });
      }
    });

    log('UI bound');
  }
})();
