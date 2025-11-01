
// LociMyu - Material Orchestrator (robust $$ and UI pickup fixes)
// VERSION_TAG: V6_16f_UI_PICKUP_SAFEGUARD

(function(){
  if (window.__lm_material_orchestrator_installed) return;
  window.__lm_material_orchestrator_installed = true;

  const VER = 'V6_16f_UI_PICKUP_SAFEGUARD';
  const log = (...a)=>{ try{ console.log('[mat-orch]', ...a);}catch(_){} };
  log('loaded VERSION_TAG:', VER);

  // ---------- small utils ----------
  const raf = (fn)=> (window.requestAnimationFrame||setTimeout)(fn,0);

  // robust $$: accepts selector string, element, NodeList/HTMLCollection, or array(mixed)
  function $$(input) {
    // normalize to array
    const normalizeOne = (v) => {
      if (!v) return [];
      if (typeof v === 'string') return Array.from(document.querySelectorAll(v));
      if (v.nodeType === 1) return [v];
      if (Array.isArray(v)) return v.flatMap(normalizeOne);
      if (v instanceof NodeList || v instanceof HTMLCollection) return Array.from(v);
      return [];
    };
    return normalizeOne(input).filter(Boolean);
  }

  // safe query for first match among candidates
  function pickOne(candidates){
    for (const c of candidates){
      const arr = $$(c);
      if (arr.length) return arr[0];
    }
    return null;
  }

  // viewerBridge helpers (be liberal about method names across versions)
  function applyOpacityByKey(key, value){
    const vb = window.viewerBridge || window.viewer || {};
    if (!key) return;
    try{
      if (typeof vb.setMaterialOpacity === 'function'){
        vb.setMaterialOpacity(key, value); return true;
      }
      if (typeof vb.applyOpacityByMaterial === 'function'){
        vb.applyOpacityByMaterial(key, value); return true;
      }
      if (typeof vb.setOpacityForMaterial === 'function'){
        vb.setOpacityForMaterial(key, value); return true;
      }
    }catch(e){
      console.warn('[mat-orch] applyOpacity error', e);
    }
    return false;
  }

  function listMaterialKeys(){
    const vb = window.viewerBridge || window.viewer || {};
    try{
      if (typeof vb.listMaterials === 'function') return vb.listMaterials() || [];
      if (vb.scene && vb.scene.materials) return Object.keys(vb.scene.materials);
    }catch(e){}
    return [];
  }

  // --------- UI wiring ---------
  let ui = {
    materialSelect: null,
    opacityRange  : null,
    doubleSided   : null,
    unlit         : null
  };

  function pickupUI(){
    ui.materialSelect = pickOne([
      '#pm-material-select',
      'select[data-lm="material-select"]',
      '.lm-material-select'
    ]);
    ui.opacityRange = pickOne([
      '#pm-opacity-range',
      'input[type="range"][data-lm="opacity-range"]',
      '.lm-opacity-range input[type="range"]'
    ]);
    ui.doubleSided = pickOne([
      '#pm-double-sided',
      'input[type="checkbox"][data-lm="double-sided"]'
    ]);
    ui.unlit = pickOne([
      '#pm-unlit',
      'input[type="checkbox"][data-lm="unlit-like"]'
    ]);

    // basic sanity
    if (!ui.materialSelect || !ui.opacityRange){
      throw new Error('UI elements not found (materialSelect/opacityRange)');
    }
    log('ui ok');
  }

  // --------- Sheet bridge (append-only) ---------
  function persistRow(row){
    const b = window.materialsSheetBridge || {};
    // we try common API variants; if none exists, silently skip (viewer change only)
    if (typeof b.append === 'function') return b.append(row);
    if (typeof b.appendRow === 'function') return b.appendRow(row);
    if (typeof b.persist === 'function') return b.persist(row);
  }

  function loadByKey(key){
    const b = window.materialsSheetBridge || {};
    if (!key) return null;
    if (typeof b.loadByKey === 'function') return b.loadByKey(key);
    if (typeof b.load === 'function') return b.load(key);
    return null;
  }

  // reflect row -> UI (only fields we currently expose)
  function reflectToUI(row){
    if (!row) return;
    if (ui.opacityRange && typeof row.opacity === 'number'){
      ui.opacityRange.value = String(row.opacity);
    }
    if (ui.doubleSided && typeof row.doubleSided === 'number'){
      ui.doubleSided.checked = !!row.doubleSided;
    }
    if (ui.unlit && typeof row.unlit === 'number'){
      ui.unlit.checked = !!row.unlit;
    }
  }

  // gather UI -> row
  function readUI(key){
    const row = {
      key: key || '',
      materialKey: key || '',
      opacity: Number(ui.opacityRange ? ui.opacityRange.value : 1),
      doubleSided: ui.doubleSided && ui.doubleSided.checked ? 1 : 0,
      unlit: ui.unlit && ui.unlit.checked ? 1 : 0,
      updatedAt: new Date().toISOString(),
      updatedBy: 'mat-orch'
    };
    return row;
  }

  // populate material dropdown
  function fillMaterialsOnce(){
    const sel = ui.materialSelect;
    if (!sel) return;
    // keep current selection if any
    const current = sel.value;
    // reset
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.textContent = '— Select material —';
    placeholder.value = '';
    sel.appendChild(placeholder);

    const keys = listMaterialKeys();
    keys.forEach(k=>{
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    });

    if (current && keys.includes(current)) sel.value = current;
  }

  function onSelectChange(){
    const key = ui.materialSelect.value;
    if (!key) return;

    // try load saved row for this material
    Promise.resolve(loadByKey(key)).then(row=>{
      if (row && typeof row === 'object'){
        reflectToUI(row);
        raf(()=> applyOpacityByKey(key, Number(ui.opacityRange.value||1)));
      }else{
        // reset to defaults but do not change model until user touches slider
        reflectToUI({opacity: 1, doubleSided: 0, unlit: 0});
      }
    }).catch(()=>{});
  }

  function onOpacityInput(){
    const key = ui.materialSelect && ui.materialSelect.value;
    if (!key) return;
    const v = Number(ui.opacityRange.value||1);
    applyOpacityByKey(key, v);
    // append-only persist
    persistRow(readUI(key));
  }

  function wireUI(){
    // prevent duplicate listeners across retries
    const marker = '__lm_wired';
    for (const [name, el] of Object.entries(ui)){
      if (el && !el[marker]){
        if (name === 'materialSelect') el.addEventListener('change', onSelectChange, {passive:true});
        if (name === 'opacityRange') el.addEventListener('input', ()=> raf(onOpacityInput), {passive:true});
        el[marker] = true;
      }
    }
  }

  // waiters (scene & sheet context) with conservative timeouts + retry
  function once(target, type, timeoutMs){
    return new Promise((resolve, reject)=>{
      let to = setTimeout(()=>{
        target.removeEventListener(type, on);
        reject(new Error(type+' timeout'));
      }, timeoutMs||3000);
      function on(e){
        clearTimeout(to);
        target.removeEventListener(type, on);
        resolve(e && e.detail);
      }
      target.addEventListener(type, on, {once:true});
    });
  }

  async function boot(){
    try{
      pickupUI();
    }catch(e){
      log('ui not ready yet, retry...', e.message);
      setTimeout(boot, 300);
      return;
    }

    // populate dropdown early
    fillMaterialsOnce();

    // wait for scene & sheet context (sticky bridges will re-emit)
    try{
      await once(window, 'lm:scene-ready', 4000);
    }catch{}
    try{
      await once(window, 'lm:sheet-context', 4000);
    }catch{}

    // repopulate (now that scene is surely ready)
    fillMaterialsOnce();
    wireUI();
    log('wired panel');
  }

  // kick
  boot();
})();
