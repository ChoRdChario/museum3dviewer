/* LociMyu - Material Orchestrator (sticky-ready + UI sync)
 * VERSION: V6_16c_STICKY_READY_UI_SYNC
 */
(function(){
  const VERSION_TAG = 'V6_16c_STICKY_READY_UI_SYNC';
  const NS = '__lm_mat_orch__';
  if (window[NS]?.wired) {
    console.log('[mat-orch] already wired; skip');
    return;
  }
  window[NS] = window[NS] || { wired:false };
  console.log('[mat-orch] loaded VERSION_TAG:', VERSION_TAG);

  // ---------- tiny utils ----------
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  function num(v, d){ return (v==='' || v==null || Number.isNaN(+v)) ? d : +v; }
  function flag(v){ return v===true || v==='1' || v===1 || v==='true'; }

  // ---------- sticky waits (robust against event races) ----------
  async function waitSceneReadySticky(total=8000, step=80){
    const t0 = performance.now();
    while (performance.now()-t0 < total){
      try{
        const vb = window.viewerBridge;
        if (vb && typeof vb.listMaterials === 'function'){
          const list = vb.listMaterials() || [];
          if (list.length > 0) return true;
        }
      }catch{}
      let hit=false;
      const once = ()=>{ hit=true; window.removeEventListener('lm:scene-ready', once); };
      window.addEventListener('lm:scene-ready', once, { once:true });
      await new Promise(r => setTimeout(r, step));
      if (hit) return true;
    }
    throw new Error('scene-ready timeout');
  }
  async function getSheetCtxSticky(total=8000, step=80){
    const t0 = performance.now();
    while (performance.now()-t0 < total){
      if (window.__lm_last_sheet_ctx) return window.__lm_last_sheet_ctx;
      let ctx=null;
      const once = (e)=>{ ctx = e.detail || e; };
      window.addEventListener('lm:sheet-context', once, { once:true });
      await new Promise(r => setTimeout(r, step));
      if (ctx) return ctx;
    }
    throw new Error('sheet-context timeout');
  }

  // ---------- UI refs ----------
  const els = {
    material: document.getElementById('pm-material'),
    range:    document.getElementById('pm-opacity-range'),
    out:      document.getElementById('pm-opacity-val'),
    dbl:      document.getElementById('pm-flag-doublesided'),
    unlit:    document.getElementById('pm-flag-unlit'),
  };
  function uiOk(){
    return !!(els.material && els.range && els.out && els.dbl && els.unlit);
  }
  function applyStateToUI(state){
    if (!state) return;
    if (typeof state.opacity === 'number'){
      els.range.value = String(state.opacity);
      els.out.value   = Number(state.opacity).toFixed(2);
    }
    if (typeof state.doubleSided === 'boolean') els.dbl.checked  = !!state.doubleSided;
    if (typeof state.unlit       === 'boolean') els.unlit.checked = !!state.unlit;
  }
  function readStateFromRows(rows){
    if (!rows || !rows.length) return null;
    const sorted = rows.slice().sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''));
    const r = sorted[0];
    return {
      opacity:     num(r.opacity, 1),
      doubleSided: flag(r.doubleSided),
      unlit:       flag(r.unlit),
    };
  }

  // ---------- polyfill: materialsSheetBridge.loadByKey ----------
  (function ensureLoadByKey(){
    const msb = window.materialsSheetBridge;
    if (!msb) return;
    if (!msb.loadByKey){
      msb.loadByKey = async function(ctx, key){
        const all = await msb.loadAll(ctx);
        return (all||[]).filter(r => r && r.materialKey === key);
      };
      console.log('[mat-orch] polyfilled materialsSheetBridge.loadByKey');
    }
  })();

  // ---------- main wiring ----------
  async function wireOnce(){
    if (window[NS].wired) return;
    if (!uiOk()){
      console.warn('[mat-orch] UI controls not found');
      return;
    }

    // 1) wait for scene & sheet context in a sticky way
    await waitSceneReadySticky();
    const sheetCtx = await getSheetCtxSticky();

    // 2) build dropdown
    const vb = window.viewerBridge;
    const mats = (vb.listMaterials && vb.listMaterials()) || [];
    els.material.innerHTML = '<option value="">— Select —</option>';
    mats.forEach(m => {
      if (!m || !m.name) return;
      const opt = document.createElement('option');
      opt.value = opt.textContent = m.name;
      els.material.appendChild(opt);
    });

    // 3) selection -> fetch rows -> reflect to UI (no viewer apply here)
    els.material.addEventListener('change', async () => {
      const key = els.material.value;
      if (!key) return;
      try{
        const rows = await window.materialsSheetBridge.loadByKey(sheetCtx, key);
        const st = readStateFromRows(rows) || { opacity:1, doubleSided:false, unlit:false };
        applyStateToUI(st);
      }catch(e){
        console.warn('[mat-orch] loadByKey failed', e);
        applyStateToUI({ opacity:1, doubleSided:false, unlit:false });
      }
    });

    // 4) keep existing viewer bindings (lightweight helpers, optional)
    els.range.addEventListener('input', () => {
      els.out.value = Number(els.range.value).toFixed(2);
      if (!els.material.value) return;
      const fn = window.viewerBridge && window.viewerBridge.applyOpacity;
      if (typeof fn === 'function'){
        fn(els.material.value, Number(els.range.value) || 0);
      }
    });

    window[NS].wired = true;
    console.log('[mat-orch] wired panel (sticky)');
  }

  // boot with retry (rare)
  (async function boot(){
    try{
      await wireOnce();
    }catch(e){
      console.warn('[mat-orch] first wire failed, retry soon', e);
      setTimeout(boot, 300);
    }
  })();
})();
