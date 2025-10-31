// @license MIT
// material.orchestrator.js (UI guard overlay) — V6_15c_INIT_ORDER_FIX
(function(){
  const TAG='[mat-orch]';
  const log = (...a)=>console.log(TAG, ...a);

  let suppressPersist = false;
  let programmaticSet = false;
  let currentKey = null;
  const lastSaved = new Map();
  const EPS = 0.01;

  const qs = (s, r=document)=>r.querySelector(s);
  const on = (el, ev, fn)=> el && el.addEventListener(ev, fn);

  function setSliderValue(slider, v){
    if (!slider) return;
    programmaticSet = true;
    slider.value = String(v);
    programmaticSet = false;
  }

  function applyOpacityToScene(materialKey, v){
    if (window.applyOpacityToScene) return window.applyOpacityToScene(materialKey, v);
    window.dispatchEvent(new CustomEvent('lm:material-opacity-apply', {detail:{materialKey, opacity:v}}));
  }

  function persist(matKey, value){
    if (suppressPersist || programmaticSet || !window.matSheet) return;
    const prev = lastSaved.get(matKey);
    if (prev!=null && Math.abs(prev - value) < EPS) return;
    lastSaved.set(matKey, value);
    try {
      window.matSheet.upsertOne({
        materialKey: matKey,
        opacity: value,
        updatedBy: 'ui'
      });
      log('persisted', matKey, value);
    } catch(e) {
      console.warn(TAG, 'persist failed', e);
    }
  }

  async function boot(){
    await new Promise(r=>setTimeout(r, 0));
    const matSelect    = qs('#mat-select') || qs('[data-mat-select]') || qs('select[name="mat-select"]');
    const perSlider    = qs('#mat-opacity') || qs('[data-mat-opacity]') || qs('input[type="range"][name="mat-opacity"]');
    const globalSlider = qs('#global-opacity') || qs('[data-global-opacity]') || qs('input[type="range"][name="global-opacity"]');

    try{
      suppressPersist = true;
      if (window.matSheet && typeof window.matSheet.loadAll === 'function'){
        const rows = await window.matSheet.loadAll();
        (rows||[]).forEach(r=>{
          const k = r && (r.materialKey || r.key || r.name);
          if (!k) return;
          const v = (typeof r.opacity === 'number') ? r.opacity : 1;
          lastSaved.set(k, v);
        });
        lastSaved.forEach((v,k)=>applyOpacityToScene(k, v));
      }
    } finally { suppressPersist = false; }

    on(matSelect, 'change', async ()=>{
      const key = matSelect && (matSelect.value || matSelect.getAttribute('value'));
      currentKey = key || null;
      if (!currentKey) return;

      suppressPersist = true;
      let v = 1;
      try{
        const rec = window.matSheet && typeof window.matSheet.getOne==='function'
          ? window.matSheet.getOne(currentKey) : null;
        if (rec && typeof rec.opacity === 'number') v = rec.opacity;
      } catch(e){ /* ignore */ }

      applyOpacityToScene(currentKey, v);
      setSliderValue(perSlider, v);
      suppressPersist = false;
    });

    on(perSlider, 'input', ()=>{
      if (programmaticSet || suppressPersist || !currentKey) return;
      const v = Number(perSlider.value);
      applyOpacityToScene(currentKey, v);
    });

    const commit = ()=>{
      if (programmaticSet || suppressPersist || !currentKey) return;
      const v = Number(perSlider.value);
      persist(currentKey, v);
    };
    on(perSlider, 'change', commit);
    on(perSlider, 'pointerup', commit);
    on(perSlider, 'mouseup', commit);

    on(globalSlider, 'input', ()=>{
      if (programmaticSet || suppressPersist) return;
      const v = Number(globalSlider.value);
      window.dispatchEvent(new CustomEvent('lm:global-opacity-apply', {detail:{opacity:v}}));
    });

    log('overlay wired');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
