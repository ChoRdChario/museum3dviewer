/*! material.state.local.v1.js - v1.6 (hotfix) */
(function(){
  const LOG = (...a)=>console.log('[mat-state v1]', ...a);

  // Expose a tiny API used by orchestrator/bridge
  const api = {
    save(ctx, materialKey, patch){
      const {spreadsheetId, sheetGid} = (ctx||{});
      const k = `${spreadsheetId||'NOSPREAD'}:${Number.isFinite(+sheetGid)? sheetGid : 'NOGID'}:${materialKey}`;
      const st = Object.assign({updatedAt: new Date().toISOString(), updatedBy: 'local'}, patch||{});
      try{
        const cur = JSON.parse(localStorage.getItem(k) || '{}');
        const next = Object.assign({}, cur, st);
        localStorage.setItem(k, JSON.stringify(next));
        LOG('saved local', k.split(':')[2], next);
        // emit: let bridges sync
        window.dispatchEvent(new CustomEvent('lm:material-state-saved-local', {detail:{key:k, materialKey, ...ctx, ...next}}));
      }catch(e){
        console.warn('[mat-state v1] local save failed', e);
      }
    }
  };
  window.__lm_material_state = api;
  LOG('armed');
  setTimeout(()=>LOG('ready'),0);
})();
