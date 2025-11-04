/**
 * LociMyu: populate material <select> from scene materials (robust, idempotent)
 * Inserted by ChatGPT build. Safe to include multiple times.
 */
(function(){
  const LOG_PREFIX = '[populate-bridgepatch]';
  const log = (...a)=>console.log(LOG_PREFIX, ...a);
  const once = (fn)=>{
    let done=false; return (...a)=>{ if(done) return; done=true; try{ return fn(...a);}catch(e){console.error(LOG_PREFIX, e);} };
  };

  // Find select and range robustly
  function findSelect(){
    const sels = [
      '#pm-material',
      '#materialSelect',
      'select[name="materialKey"]',
      '[data-lm="material-select"]',
      '.lm-material-select',
      '#materialPanel select',
      '.material-panel select'
    ];
    for (const s of sels){
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function getScene(){
    try {
      if (window.lm && typeof window.lm.getScene==='function') return window.lm.getScene();
      if (window.viewerBridge && typeof window.viewerBridge.getScene==='function') return window.viewerBridge.getScene();
      if (typeof window.getScene==='function') return window.getScene();
    } catch(e){ console.warn(LOG_PREFIX, 'getScene probe failed', e); }
    return null;
  }

  function snapshotMaterials(scene){
    const map = new Map();
    if (!scene || !scene.traverse) return [];
    scene.traverse(obj=>{
      const m = obj && obj.material;
      if (!m) return;
      const arr = Array.isArray(m) ? m : [m];
      for (const mm of arr){
        const name = (mm && mm.name) || '(no-name)';
        if (!map.has(name)) map.set(name, 0);
        map.set(name, map.get(name)+1);
      }
    });
    return Array.from(map.keys());
  }

  function areSameOptions(sel, list){
    const current = Array.from(sel.options).map(o=>o.textContent.trim());
    const filtered = current.filter(t=>t && t !== '— Select material —' && t !== '— Select —');
    // Compare ignoring placeholder
    const a = filtered.join('|'), b = list.join('|');
    return a === b;
  }

  function populate(){
    const sel = findSelect();
    const scene = getScene();
    if (!sel || !scene) return false;

    const names = snapshotMaterials(scene).sort((a,b)=>a.localeCompare(b));
    if (!names.length) return false;

    if (areSameOptions(sel, names)){
      log('select already populated (same options); skip');
      return true;
    }
    // wipe and rebuild with placeholder
    const placeholder = document.createElement('option');
    placeholder.textContent = '— Select material —';
    placeholder.value = '';
    placeholder.disabled = false; // keep selectable for clearing
    const frag = document.createDocumentFragment();
    frag.appendChild(placeholder);
    for (const nm of names){
      const opt = document.createElement('option');
      opt.value = nm;
      opt.textContent = nm;
      frag.appendChild(opt);
    }
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    sel.appendChild(frag);

    log('select populated with', names.length, 'materials');
    window.dispatchEvent(new CustomEvent('lm:pm-select-populated', {detail:{count:names.length}}));
    return true;
  }

  // Debounced try
  let tries = 0;
  const maxTries = 60; // ~3s at 50ms
  const tick = ()=>{
    tries++;
    if (populate()) return done('populated');
    if (tries >= maxTries) return done('timeout');
    setTimeout(tick, 50);
  };

  const done = once((reason)=>{
    log('done, reason=', reason);
  });

  // Hooks
  window.addEventListener('lm:scene-ready', ()=>setTimeout(()=>populate()||tick(), 10));
  window.addEventListener('viewer-bridge:ready', ()=>setTimeout(()=>populate()||tick(), 10));

  // Kick initial
  setTimeout(()=>populate()||tick(), 50);

  // Expose manual kick
  window.__pm_populate = { tryPopulateOnce: (reason='manual')=> (populate()? done('manual-populated'): done('manual-no-scene')), version:'1.0.0' };
})();