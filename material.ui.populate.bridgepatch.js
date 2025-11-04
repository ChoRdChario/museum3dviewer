
/**
 * material.ui.populate.bridgepatch.js
 * v1.2 - robust populate for per-material select
 *
 * Purpose:
 *  - Waits for both UI(select/range) and scene(getScene & materials)
 *  - Populates #pm-material with distinct material names from scene
 *  - Re-populates on `lm:scene-ready` and exposes a manual trigger
 *
 * Safe to include multiple times – uses idempotent guards.
 */
(function(){
  const TAG = '[populate-bridgepatch]';
  if (window.__pm_populate?.__installed) {
    console.log(TAG, 'already installed');
    return;
  }

  const SEL_SELECT_CANDIDATES = [
    '#pm-material',
    '#materialSelect',
    'select[name="materialKey"]',
    '[data-lm="material-select"]',
    '.lm-material-select',
    '#materialPanel select',
    '.material-panel select'
  ];

  function pickSelect(){
    for (const q of SEL_SELECT_CANDIDATES) {
      const el = document.querySelector(q);
      if (el && el.tagName === 'SELECT') return el;
    }
    return null;
  }

  function waitFor(cond, timeout=8000, interval=80){
    const start = performance.now();
    return new Promise((resolve, reject)=>{
      (function tick(){
        try {
          const v = cond();
          if (v) return resolve(v);
        } catch(e){ /* ignore */ }
        if (performance.now() - start >= timeout) return reject(new Error('timeout'));
        setTimeout(tick, interval);
      })();
    });
  }

  function getGetScene(){
    return (window.lm && typeof window.lm.getScene === 'function') ? window.lm.getScene
         : (typeof window.getScene === 'function' ? window.getScene : null);
  }

  function extractMaterialNames(scene){
    const names = new Map(); // name -> uses
    scene.traverse(obj=>{
      const m = obj.material;
      if (!m) return;
      const arr = Array.isArray(m) ? m : [m];
      for (const mm of arr){
        const name = (mm && (mm.name || '(no-name)')) || '(no-name)';
        names.set(name, (names.get(name)||0)+1);
      }
    });
    return Array.from(names.entries())
      .sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]))
      .map(([n])=>n);
  }

  function populateSelect(select, names){
    // Preserve selection if possible
    const prev = select.value;
    // Clear and rebuild
    while(select.options.length) select.remove(0);
    const opt0 = document.createElement('option');
    opt0.textContent = '— Select material —';
    opt0.value = '';
    select.appendChild(opt0);
    for (const n of names){
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      select.appendChild(opt);
    }
    if (prev && names.includes(prev)) select.value = prev;
    // Fire change so downstream sees new options
    select.dispatchEvent(new Event('change', {bubbles:true}));
  }

  async function tryPopulateOnce(reason='auto'){
    const tried = [];
    try {
      const select = await waitFor(()=>{
        const s = pickSelect();
        if (!s) { tried.push('select'); return null; }
        return s;
      }, 2500);

      const getScene = await waitFor(()=> getGetScene(), 2500);
      const scene = await waitFor(()=>{
        const sc = getScene();
        // Ensure scene object and at least one mesh with material
        if (!sc) return null;
        let hasMat = false;
        sc.traverse(o=>{ if (o.material) hasMat = true; });
        return hasMat ? sc : null;
      }, 5500);

      const names = extractMaterialNames(scene);
      populateSelect(select, names);
      console.log(TAG, 'populated', {count:names.length, reason});
      return true;
    } catch(e){
      console.log(TAG, 'done, reason=', e.message || String(e), 'tried=', tried);
      return false;
    }
  }

  // Expose & wire
  window.__pm_populate = {
    tryPopulateOnce,
    __installed: true,
  };

  // Kick once after load
  setTimeout(()=>tryPopulateOnce('boot'), 0);

  // Re-populate on scene-ready signals
  window.addEventListener('lm:scene-ready', ()=> tryPopulateOnce('scene-ready'));

  // Also retry shortly if first attempt found zero options besides placeholder
  setTimeout(()=>{
    const sel = pickSelect();
    if (!sel) return;
    const hasReal = Array.from(sel.options).some(o=>o.value);
    if (!hasReal) tryPopulateOnce('retry-short');
  }, 1200);

})();
