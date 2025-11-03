
/**
 * material.orchestrator.js
 * Safe UI pipeline: selection restores settings (no writes),
 * user edits apply to scene and save (debounced) only when changed.
 *
 * Version: V6_16h_SAFE_UI_PIPELINE.A3
 */
(function () {
  const TAG = '[mat-orch]';
  console.log(TAG, 'A3 boot');

  // --------- State ---------
  let ui = null;
  let sheetCtx = null;
  let currentKey = null;
  let snapshot = null;
  let dirty = false;
  let suspendUI = false;
  let loadToken = 0;
  const cache = new Map();

  // External bridges (soft dependencies)
  const getSheetBridge = () => (window.__LM_MAT_SHEET__ || window.__LM_MATERIALS_SHEET_BRIDGE__ || null);
  const getViewerBridge = () => (window.__LM_VIEWER_BRIDGE__ || null);

  // --------- Defaults & helpers ---------
  const defaults = Object.freeze({
    opacity: 1.0,
    doubleSided: false,
    unlit: false,
    chromaEnable: false,
    chromaTolerance: 0,
    chromaFeather: 0
  });

  function normalize(s) {
    const n = s || {};
    return {
      opacity: clamp(num(n.opacity, 1.0), 0, 1),
      doubleSided: !!n.doubleSided,
      unlit: !!n.unlit,
      chromaEnable: !!n.chromaEnable,
      chromaTolerance: clamp(num(n.chromaTolerance, 0), 0, 1),
      chromaFeather: clamp(num(n.chromaFeather, 0), 0, 1),
    };
  }
  function num(v, d){ v = Number(v); return Number.isFinite(v) ? v : d; }
  function clamp(x, lo, hi){ return Math.min(hi, Math.max(lo, x)); }
  function shallowEqual(a,b){
    if(!a||!b) return false;
    for(const k of Object.keys(defaults)){
      if(a[k] !== b[k]) return false;
    }
    return true;
  }

  function debounce(fn, ms){
    let t=null;
    return function(...args){
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(this,args), ms);
    };
  }

  // --------- UI discovery ---------
  function discoverUI(){
    const $ = (id)=> document.getElementById(id);
    const materialSelect = $('materialSelect') || $('matSelect') || $('material-select');
    const opacityRange   = $('opacityRange')   || $('matOpacity');
    const chkDouble      = $('doubleSided')    || $('matDoubleSided');
    const chkUnlit       = $('unlit')          || $('matUnlit');
    const chromaEnable   = $('chromaEnable')   || $('matChromaEnable');
    const chromaTol      = $('chromaTolerance')|| $('matChromaTolerance');
    const chromaFeather  = $('chromaFeather')  || $('matChromaFeather');

    if(!materialSelect || !opacityRange || !chkDouble || !chkUnlit || !chromaEnable || !chromaTol || !chromaFeather){
      return null;
    }
    return {
      materialSelect, opacityRange, chkDouble, chkUnlit, chromaEnable, chromaTol, chromaFeather,
      all: [opacityRange, chkDouble, chkUnlit, chromaEnable, chromaTol, chromaFeather]
    };
  }

  function disableControls(disabled){
    if(!ui) return;
    for(const el of ui.all){
      if(el) el.disabled = disabled;
    }
  }

  // --------- UI <-> Settings mapping ---------
  function applySettingsToControls(s){
    if(!ui) return;
    suspendUI = true;
    const v = normalize(s);
    ui.opacityRange.value = String(v.opacity);
    ui.chkDouble.checked  = !!v.doubleSided;
    ui.chkUnlit.checked   = !!v.unlit;
    ui.chromaEnable.checked = !!v.chromaEnable;
    ui.chromaTol.value    = String(v.chromaTolerance);
    ui.chromaFeather.value= String(v.chromaFeather);
    suspendUI = false;
  }

  function gatherControls(){
    if(!ui) return normalize(defaults);
    return normalize({
      opacity: Number(ui.opacityRange.value),
      doubleSided: !!ui.chkDouble.checked,
      unlit: !!ui.chkUnlit.checked,
      chromaEnable: !!ui.chromaEnable.checked,
      chromaTolerance: Number(ui.chromaTol.value),
      chromaFeather: Number(ui.chromaFeather.value),
    });
  }

  // --------- Select -> UI reflect (no saves) ---------
  async function onSelectMaterial(key){
    if(!key){
      currentKey = null;
      return;
    }
    currentKey = key;
    dirty = false;
    const token = ++loadToken;
    suspendUI = true;
    disableControls(true);

    // prefer cache, else fetch
    let settings = cache.get(key);
    const sheet = getSheetBridge();
    if(!settings && sheet && sheet.getLatestSettings){
      try{
        settings = await sheet.getLatestSettings({ key, ctx: sheetCtx });
      }catch(err){
        console.warn(TAG, 'getLatestSettings failed', err);
      }
    }

    if(token !== loadToken){
      // selection changed while awaiting -> abandon
      return;
    }

    applySettingsToControls(settings || defaults);
    snapshot = normalize(settings || defaults);
    cache.set(key, snapshot);
    suspendUI = false;
    disableControls(false);

    // Apply to scene for immediate visual coherence (no saving)
    const viewer = getViewerBridge();
    if(viewer && viewer.applyMaterialSettings){
      try{
        viewer.applyMaterialSettings(currentKey, snapshot);
      }catch(err){
        console.warn(TAG, 'applyMaterialSettings (onSelect) failed', err);
      }
    }
  }

  // --------- UI -> apply & save (debounced) ---------
  function onAnyControlChanged(){
    if(suspendUI || !currentKey) return;
    const next = gatherControls();
    if(shallowEqual(next, snapshot)){
      dirty = false;
      return;
    }
    dirty = true;
    cache.set(currentKey, next);

    // Apply to scene immediately
    const viewer = getViewerBridge();
    if(viewer && viewer.applyMaterialSettings){
      try{
        viewer.applyMaterialSettings(currentKey, next);
      }catch(err){
        console.warn(TAG, 'applyMaterialSettings failed', err);
      }
    }

    scheduleSave();
  }

  const scheduleSave = debounce(async function(){
    if(!dirty || !currentKey) return;
    const sheet = getSheetBridge();
    if(!(sheet && sheet.saveSettings)){
      console.warn(TAG, 'sheet bridge not ready; skip save');
      return;
    }
    const data = cache.get(currentKey);
    try{
      await sheet.saveSettings({ key: currentKey, data, ctx: sheetCtx });
      snapshot = normalize(data);
      dirty = false;
    }catch(err){
      console.warn(TAG, 'saveSettings failed', err);
    }
  }, 450);

  // --------- Wiring ---------
  function bindUI(){
    if(!ui) return;
    ui.materialSelect.addEventListener('change', (e)=> onSelectMaterial(e.target.value));
    // Use `input` for immediate responsiveness
    for(const el of ui.all){
      const evt = (el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'checkbox')) ? 'input' : 'change';
      el.addEventListener(evt, onAnyControlChanged);
    }
  }

  // Listen sheet context
  window.addEventListener('lm:sheet-context', (e)=>{
    sheetCtx = e && e.detail;
    console.log(TAG, 'ctx-bridge|lm:sheet-context', sheetCtx);
  });

  // If viewer bridge publishes material keys via a custom event, reflect selection
  window.addEventListener('lm:viewer:materials', (e)=>{
    const keys = (e && e.detail && e.detail.keys) || [];
    // If a currentKey exists in list, refresh UI from cache/sheet
    if(keys && keys.length){
      if(!currentKey || !keys.includes(currentKey)){
        // pick first as default but do not auto-save
        onSelectMaterial(keys[0]);
      }else{
        onSelectMaterial(currentKey);
      }
    }
  });

  // --------- Boot: poll for readiness ---------
  (function boot(){
    const startedAt = Date.now();
    let tries = 0;
    const t = setInterval(()=>{
      tries++;
      if(!ui){
        ui = discoverUI();
        if(!ui){
          if(tries%20===0) console.warn(TAG, 'UI still not found; keep idle');
          return;
        }
        console.log(TAG, 'UI discovered');
        bindUI();
      }
      // Optionally detect viewer bridge keys
      const viewer = getViewerBridge();
      if(viewer && typeof viewer.getMaterialKeys === 'function'){
        const keys = viewer.getMaterialKeys();
        if(keys && keys.length && !currentKey){
          onSelectMaterial(keys[0]);
        }
      }
      // If both UI exists and we have at least attempted selection once, we can stop polling
      if(ui){
        clearInterval(t);
      }
    }, 200);
  })();
})();
