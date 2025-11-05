// material.ui.populate.bridgepatch.js
// Populate <select id="pm-material"> with scene materials when scene/UI are ready
// Robust against load order; safe to call multiple times.
(function(){
  const LOGTAG = '[populate-bridgepatch]';
  const SELS = {
    select: [
      '#pm-material',
      '#materialSelect',
      'select[name="materialKey"]',
      '[data-lm="material-select"]',
      '.lm-material-select',
      '#materialPanel select',
      '.material-panel select'
    ]
  };

  function log(...a){ console.log(LOGTAG, ...a); }
  function pickOne(selectors){
    for (const s of selectors){
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function getScene(){
    try {
      if (window.lm && typeof window.lm.getScene === 'function') return window.lm.getScene();
      if (typeof window.getScene === 'function') return window.getScene();
    } catch(e){ /* noop */ }
    return null;
  }

  function collectMaterials(scene){
    const map = new Map(); // name -> {count, uuids:Set}
    scene.traverse(obj=>{
      let m = obj.material;
      if (!m) return;
      const arr = Array.isArray(m) ? m : [m];
      for (const mm of arr){
        const name = (mm && (mm.name || '(no-name)')) || '(no-name)';
        if (!map.has(name)) map.set(name, {count:0, uuids:new Set()});
        const rec = map.get(name);
        rec.count++;
        if (mm && mm.uuid) rec.uuids.add(mm.uuid);
      }
    });
    // return sorted array
    return Array.from(map.entries()).sort((a,b)=> b[1].count - a[1].count);
  }

  function fillSelect($sel, mats){
    // preserve first option (placeholder) if present
    const placeholder = $sel.options.length ? $sel.options[0] : null;
    $sel.innerHTML = '';
    if (placeholder){
      $sel.appendChild(placeholder);
    }else{
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— Select material —';
      $sel.appendChild(opt);
    }
    const matMap = {};
    for (const [name, rec] of mats){
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = rec.count > 1 ? `${name} (x${rec.count})` : name;
      opt.dataset.uuids = JSON.stringify(Array.from(rec.uuids));
      $sel.appendChild(opt);
      matMap[name] = Array.from(rec.uuids);
    }
    $sel.__pmMatMap = matMap;
  }

  function ensureChangeHandler($sel){
    if ($sel.__pmBind) return;
    $sel.addEventListener('change', (e)=>{
      const name = e.target.value;
      const uuids = ($sel.__pmMatMap && $sel.__pmMatMap[name]) || [];
      const detail = { name, uuids };
      window.dispatchEvent(new CustomEvent('pm:material-selected', {detail}));
      log('material selected', detail);
    });
    $sel.__pmBind = true;
  }

  async function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function tryPopulate(reason='auto'){
    // Wait up to ~2.5s total for both scene and UI
    const tried = [];
    for (let i=0;i<25;i++){
      const scene = getScene();
      const $sel = pickOne(SELS.select);
      if (scene && $sel){
        const mats = collectMaterials(scene);
        fillSelect($sel, mats);
        ensureChangeHandler($sel);
        log('populated', {count: mats.length, reason});
        return true;
      }
      tried.push({hasScene: !!getScene(), hasSelect: !!pickOne(SELS.select)});
      await wait(100);
    }
    log('done, reason= timeout tried=', tried);
    return false;
  }

  // Public manual kicker
  window.__pm_populate = {
    tryPopulateOnce: tryPopulate
  };

  // Auto wire
  window.addEventListener('lm:scene-ready', ()=>tryPopulate('scene-ready'));
  window.addEventListener('lm:scene-stable', ()=>tryPopulate('scene-stable'));
  document.addEventListener('DOMContentLoaded', ()=>tryPopulate('dom'));
  // Give it one last chance after load
  window.addEventListener('load', ()=>setTimeout(()=>tryPopulate('load'), 50));
})();