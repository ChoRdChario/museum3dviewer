/**
 * materials.ui.wire.js
 * v1.6
 *
 * - Wires UI controls to persist changes AND to reflect cache on selection.
 * - Requires materials.sheet.persist.js (for write) and materials.sheet.hydrate.js (for read).
 */
(function(){
  const LOG_PREFIX = '[mat-ui-wire v1.6]';
  function log(...a){ console.log(LOG_PREFIX, ...a); }
  function warn(...a){ console.warn(LOG_PREFIX, ...a); }

  const els = {
    sel:  null, // #pm-material
    rng:  null, // #pm-opacity-range
    ds:   null, // #pm-double-sided
    un:   null, // #pm-unlit-like
  };

  // Persist helper (delegates to materials.sheet.persist.js API pattern)
  async function persistCurrent(){
    const key = els.sel?.value || els.sel?.selectedOptions?.[0]?.value || '';
    if (!key) return;
    const payload = {
      materialKey: key,
      opacity: parseFloat(els.rng?.value ?? '1'),
      doubleSided: !!els.ds?.checked,
      unlitLike:   !!els.un?.checked,
    };
    if (typeof window.__LM_MAT_PERSIST__?.upsert === 'function'){
      await window.__LM_MAT_PERSIST__.upsert(payload);
    }else{
      warn('persist API missing (__LM_MAT_PERSIST__.upsert)');
    }
    // Let others know
    window.dispatchEvent(new CustomEvent('lm:mat-apply', { detail: { key, values: payload } }));
  }

  // Read from cache and reflect into UI
  function reflectFromCache(){
    const key = els.sel?.value || els.sel?.selectedOptions?.[0]?.value || '';
    if (!key) return;
    const cache = window.__LM_MAT_CACHE;
    if (!cache || typeof cache.get !== 'function') return;
    const v = cache.get(key);
    if (!v) return;
    if (els.rng && v.opacity != null && !isNaN(v.opacity)) els.rng.value = String(v.opacity);
    if (els.ds) els.ds.checked = !!v.doubleSided;
    if (els.un) els.un.checked = !!v.unlitLike;
    log('ui reflected from cache', { key, v });
  }

  // Wire
  function wire(){
    els.sel = document.querySelector('#pm-material');
    els.rng = document.querySelector('#pm-opacity-range');
    els.ds  = document.querySelector('#pm-double-sided');
    els.un  = document.querySelector('#pm-unlit-like');

    if (!els.sel || !els.rng){
      warn('UI parts missing', { sel: !!els.sel, rng: !!els.rng, ds: !!els.ds, un: !!els.un });
      return;
    }

    // Initial reflect if cache ready
    reflectFromCache();

    let t;
    const debounced = () => { clearTimeout(t); t = setTimeout(persistCurrent, 120); };

    els.sel.addEventListener('change', ()=>{
      reflectFromCache();         // selection -> first reflect UI from cache
      debounced();                // then persist snapshot (so sheet stays aligned with UI selection)
    }, { passive:true });

    els.rng.addEventListener('input', debounced, { passive:true });
    els.rng.addEventListener('change', debounced, { passive:true });
    els.rng.addEventListener('pointerup', debounced, { passive:true });

    if (els.ds) els.ds.addEventListener('change', debounced, { passive:true });
    if (els.un) els.un.addEventListener('change', debounced, { passive:true });

    log('wired');
  }

  // On materials ready / model ready -> re-reflect UI (in case values changed)
  window.addEventListener('lm:materials-ready', reflectFromCache);
  window.addEventListener('lm:model-ready', reflectFromCache);

  // Boot
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wire, { once:true });
  }else{
    setTimeout(wire, 0);
  }
})();