// [auto-apply v1.1+guard] Apply sheet-based material settings after GLB & context are ready.

(function(){
  const log = (...a)=>console.log('[auto-apply v1.1]', ...a);
  const warn = (...a)=>console.warn('[auto-apply v1.1]', ...a);

  // Safe THREE retrieval (do not throw if missing)
  function getTHREE() {
    return (window.THREE || globalThis.THREE || null);
  }

  // Wait helper
  function until(pred, {timeout=15000, step=100}={}){
    return new Promise((res, rej)=>{
      const t0 = performance.now();
      const id = setInterval(()=>{
        try {
          if (pred()) { clearInterval(id); res(true); return; }
        } catch(_e){ /* ignore */ }
        if (performance.now() - t0 > timeout) { clearInterval(id); rej(new Error('timeout')); }
      }, step);
    });
  }

  // One-shot main
  async function applyOnce(){
    // Preconditions: sheet ctx, scene, persist, THREE (non-throwing guard)
    try { await until(()=> !!window.__LM_SHEET_CTX); }
    catch(e){ return warn('preconditions missing', 'sheet-ctx', e.message); }

    try { await until(()=> !!(window.__LM_SCENE||window.scene)); }
    catch(e){ return warn('preconditions missing', 'scene', e.message); }

    try { await until(()=> !!window.__LM_MATERIALS_PERSIST__); }
    catch(e){ return warn('preconditions missing', 'persist', e.message); }

    const THREE = getTHREE();
    if (!THREE) {
      // Don't crash the pipeline; just skip this attempt.
      return warn('THREE not ready yet; will retry on next sheet-context');
    }

    const scene = window.__LM_SCENE || window.scene;
    const ctx = window.__LM_SHEET_CTX;
    const P = window.__LM_MATERIALS_PERSIST__;

    // Load settings map from sheet (__LM_MATERIALS). We keep it minimal: only the fields we actually use.
    async function fetchSettingsMap(){
      // Minimal read via Sheets API v4 values: get all rows and build a dictionary {materialKey: {opacity, doubleSided, unlitLike}}
      try {
        if (typeof window.__lm_fetchJSONAuth !== 'function') {
          warn('__lm_fetchJSONAuth missing; skip fetch');
          return {};
        }
        // Ensure headers exist (idempotent)
        await P.ensureHeaders?.();

        const rng = encodeURIComponent('__LM_MATERIALS!A1:M10000');
        const sheetId = ctx.spreadsheetId;
        const data = await window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${rng}`);
        const rows = data.values || [];
        if (!rows.length) return {};
        const header = rows[0];
        const idxKey = header.indexOf('materialKey');
        const idxOpacity = header.indexOf('opacity');
        const idxDS = header.indexOf('doubleSided');
        const idxUnlit = header.indexOf('unlitLike');

        const map = {};
        for (let i=1;i<rows.length;i++){
          const r = rows[i];
          const key = (r[idxKey]||'').trim();
          if (!key) continue;
          map[key] = {
            opacity: r[idxOpacity]!==undefined && r[idxOpacity]!=='' ? parseFloat(r[idxOpacity]) : 1,
            doubleSided: (r[idxDS]||'').toString().toUpperCase()==='TRUE',
            unlitLike: (r[idxUnlit]||'').toString().toUpperCase()==='TRUE',
          };
        }
        return map;
      } catch(e){
        warn('fetchSettingsMap failed', e);
        return {};
      }
    }

    function applyToScene(settings){
      const matches = [];
      scene.traverse(o=>{
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material)? o.material : [o.material];
        mats.forEach(m=>{
          if (!m) return;
          matches.push({mesh:o, mat:m});
        });
      });
      let hit = 0;
      matches.forEach(({mesh, mat})=>{
        const key = mat.name || mesh.name || '';
        const s = settings[key];
        if (!s) return;
        // opacity
        mat.transparent = (s.opacity ?? 1) < 0.999;
        mat.opacity = s.opacity ?? 1;
        // double sided
        mat.side = s.doubleSided ? (getTHREE()?.DoubleSide || 2) : (getTHREE()?.FrontSide || 0);
        // unlit-like
        mat.userData = mat.userData || {};
        mat.userData.__lm_unlit = !!s.unlitLike;
        mat.needsUpdate = true;
        hit++;
      });
      log('applied settings to', hit, 'materials');
    }

    const settings = await fetchSettingsMap();
    applyToScene(settings);
    log('applied (sheetId=', ctx.spreadsheetId, ')');
  }

  // Expose for manual calls
  window.__LM_AUTO_APPLY__ = applyOnce;

  // Wire to sheet-context
  window.addEventListener('lm:sheet-context', ()=>{
    // Fire-and-forget; guards inside will skip gracefully.
    applyOnce();
  }, { once:false });

  log('armed');
})();