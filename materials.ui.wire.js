// materials.ui.wire.js v1.5
// Sync UI <-> sheet row per materialKey with programmatic guard
// Elements (current IDs):
//   - select#pm-material
//   - input#pm-opacity-range
//   - input#pm-double-sided (checkbox)
//   - input#pm-unlit-like (checkbox)
//
(function(){
  const LOG = '[mat-ui-wire v1.5]';
  const Q = {
    select: '#pm-material',
    range:  '#pm-opacity-range',
    ds:     '#pm-double-sided',
    unlit:  '#pm-unlit-like',
  };

  function log(...a){ console.log(LOG, ...a); }
  function warn(...a){ console.warn(LOG, ...a); }

  const $ = (sel) => document.querySelector(sel);

  // Programmatic update guard so we don't re-persist while syncing UI from sheet
  let programmatic = false;
  const guardRun = (fn) => {
    programmatic = true;
    try { fn(); } finally { programmatic = false; }
  };

  function collectUI(){
    const sel = $(Q.select);
    const rng = $(Q.range);
    const ds  = $(Q.ds);
    const un  = $(Q.unlit);
    return {
      key: sel && (sel.value || sel.selectedOptions?.[0]?.value || ''),
      opacity: rng ? parseFloat(rng.value) : 1,
      doubleSided: !!(ds && ds.checked),
      unlitLike:   !!(un && un.checked),
    };
  }

  function applyToUI(v){
    const rng = $(Q.range);
    const ds  = $(Q.ds);
    const un  = $(Q.unlit);
    guardRun(() => {
      if (rng && typeof v.opacity === 'number') rng.value = String(v.opacity);
      if (ds  && typeof v.doubleSided === 'boolean') ds.checked = !!v.doubleSided;
      if (un  && typeof v.unlitLike === 'boolean')   un.checked = !!v.unlitLike;
    });
  }

  async function syncFromSheet(materialKey){
    const P = window.__LM_MAT_PERSIST;
    if (!P || typeof P.readByKey !== 'function') { warn('persist API missing'); return; }
    const r = await P.readByKey(materialKey);
    if (r.hit){
      applyToUI(r.values);
      // reflect to render (no save)
      if (window.__LM_MAT_RENDER && typeof window.__LM_MAT_RENDER.apply === 'function'){
        window.__LM_MAT_RENDER.apply({
          key: materialKey,
          opacity: r.values.opacity,
          doubleSided: r.values.doubleSided,
          unlitLike: r.values.unlitLike
        });
      }
    }else{
      // defaults
      applyToUI({opacity:1, doubleSided:false, unlitLike:false});
      if (window.__LM_MAT_RENDER && typeof window.__LM_MAT_RENDER.apply === 'function'){
        window.__LM_MAT_RENDER.apply({
          key: materialKey, opacity:1, doubleSided:false, unlitLike:false
        });
      }
    }
  }

  async function persistFromUI(){
    if (programmatic) return; // skip programmatic updates
    const P = window.__LM_MAT_PERSIST;
    if (!P || typeof P.upsert !== 'function') { warn('persist API missing'); return; }
    const v = collectUI();
    if (!v.key) return;
    await P.upsert({
      materialKey: v.key,
      opacity: v.opacity,
      doubleSided: v.doubleSided,
      unlitLike: v.unlitLike
    });
    if (window.__LM_MAT_RENDER && typeof window.__LM_MAT_RENDER.apply === 'function'){
      window.__LM_MAT_RENDER.apply({
        key: v.key,
        opacity: v.opacity,
        doubleSided: v.doubleSided,
        unlitLike: v.unlitLike
      });
    }
  }

  function wire(){
    const sel = $(Q.select);
    const rng = $(Q.range);
    const ds  = $(Q.ds);
    const un  = $(Q.unlit);

    if (!sel || !rng || !ds || !un){
      return warn('UI parts missing', {sel:!!sel, rng:!!rng, ds:!!ds, un:!!un});
    }

    // On selection change: sync from sheet into UI (no save), render reflect
    sel.addEventListener('change', () => {
      const key = sel.value || sel.selectedOptions?.[0]?.value || '';
      if (!key) return;
      syncFromSheet(key);
    }, { passive:true });

    // Debounced saver for range & checkboxes
    let t;
    const debounced = () => { clearTimeout(t); t = setTimeout(persistFromUI, 120); };

    rng.addEventListener('input', debounced, { passive:true });
    rng.addEventListener('change', debounced, { passive:true });
    rng.addEventListener('pointerup', debounced, { passive:true });
    ds.addEventListener('change', debounced, { passive:true });
    un.addEventListener('change', debounced, { passive:true });

    // Initial sync (if something is preselected)
    const initKey = sel.value || sel.selectedOptions?.[0]?.value || '';
    if (initKey) syncFromSheet(initKey);

    log('wired with selection-sync & flags');
  }

  function bootstrap(){
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', wire, {once:true});
    }else{
      wire();
    }
  }

  bootstrap();
})();