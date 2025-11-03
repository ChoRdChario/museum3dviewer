/* material.orchestrator.js
 * Connects Material tab UI to the viewer bridge (__LM_MATERIALS__) and to Sheets bridge.
 * Safe pipeline with retries; logs mimic existing format.
 */
(function(){
  const VERSION = 'V6_16g_SAFE_UI_PIPELINE.A2.4';
  const LOG_PREFIX = '[mat-orch]';
  const log = (...args)=>console.log(LOG_PREFIX, ...args);
  const warn = (...args)=>console.warn(LOG_PREFIX, ...args);

  log(VERSION, 'boot');

  // ---- Debug helper requested by the user
  window.__LM_DEBUG_DUMP = function(){
    const vb = window.__LM_MATERIALS__;
    const keys = vb && typeof vb.keys === 'function' ? vb.keys() : [];
    const candidates = [
      '#materialSelect','[data-lm="materialSelect"]','.lm-material-select select'
    ].map(q=>({q, n: document.querySelectorAll(q).length}));
    return { vbKeys: keys, candidates, THREE: !!window.THREE };
  };

  // ---- UI discovery (support multiple selectors)
  function pick(selList){
    for (const s of selList) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }
  const El = {
    select: pick(['#materialSelect','[data-lm="materialSelect"]','.lm-material-select select']),
    opacity: pick(['#materialOpacity','[data-lm="materialOpacity"]','.lm-material-opacity input[type="range"]']),
    ds: pick(['#doubleSided','[data-lm="doubleSided"]','.lm-material-double input[type="checkbox"]']),
    unlit: pick(['#unlitLike','[data-lm="unlitLike"]','.lm-material-unlit input[type="checkbox"]']),
  };
  log(VERSION, 'ui discovered');

  // ---- Sheet context (provided by materials.sheet.bridge.js)
  let sheetCtx = null;
  window.addEventListener('lm:sheet-context', (e)=>{
    sheetCtx = e && e.detail || null;
  });
  // backward-compatible log echo
  window.addEventListener('lm:sheet-context', (e)=>{
    log('sheet ctx ready');
  });

  // helper
  function ctxReady(){
    return !!(sheetCtx && sheetCtx.spreadsheetId);
  }

  // ---- Populate material list when bridge is ready
  function populateWhenReady(){
    const vb = window.__LM_MATERIALS__;
    if (!vb || !vb.ready || !vb.keys || vb.keys().length===0){
      log('THREE/scene not ready; deferred shim');
      setTimeout(populateWhenReady, 200);
      return;
    }
    // Fill select
    if (El.select) {
      const keys = vb.keys();
      // clear and add options
      El.select.innerHTML = '';
      keys.forEach(k=>{
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = k;
        El.select.appendChild(opt);
      });
      // select first
      if (keys.length) El.select.value = keys[0];
    } else {
      warn('materialSelect not found');
    }
  }

  populateWhenReady();

  // ---- Apply helpers
  function currentKey(){ return El.select && El.select.value; }
  function applyToModel(partial){
    const key = currentKey();
    if (!key) return;
    const ok = window.__LM_MATERIALS__ && window.__LM_MATERIALS__.apply(key, partial);
    if (!ok) warn('apply skipped; key not indexed yet');
    log('apply model', 'key='+key, `opacity=${typeof partial.opacity==='number'?partial.opacity:'-'}`, `ds=${!!partial.doubleSided}`, `unlit=${!!partial.unlit}`);
  }

  // ---- UI bindings
  function wireOnce(){
    if (El.select) {
      El.select.addEventListener('change', ()=>{
        // No immediate apply; only selection
      });
    }
    if (El.opacity) {
      const handler = ()=>{
        const v = parseFloat(El.opacity.value);
        if (!isFinite(v)) return;
        applyToModel({opacity: v});
        saveDebounced();
      };
      El.opacity.addEventListener('input', handler);
      El.opacity.addEventListener('change', handler);
    }
    if (El.ds) {
      El.ds.addEventListener('change', ()=>{
        applyToModel({doubleSided: !!El.ds.checked});
        saveDebounced();
      });
    }
    if (El.unlit) {
      El.unlit.addEventListener('change', ()=>{
        applyToModel({unlit: !!El.unlit.checked});
        saveDebounced();
      });
    }
    log(VERSION, 'wireOnce complete');
  }
  wireOnce();

  // ---- Scene ready echo from viewer bridge
  window.addEventListener('lm:scene-ready', ()=>{
    log('EVENT lm:scene-ready');
    populateWhenReady();
  });

  // ---- Save to sheet via materials.sheet.bridge.js
  // Expects global "materialsSheetBridge" with upsertOne(ctx, row)
  const SAVE_DELAY = 350;
  let saveTimer = null;
  function saveDebounced(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{
      if (!ctxReady()){
        log('ctx not ready; skip save');
        return;
      }
      try {
        const row = {
          materialKey: currentKey() || '',
          opacity: El.opacity ? parseFloat(El.opacity.value) : null,
          doubleSided: El.ds ? !!El.ds.checked : null,
          unlit: El.unlit ? !!El.unlit.checked : null,
          updatedAt: new Date().toISOString()
        };
        // materials.sheet.bridge.js exposes global "LM_MAT_SHEET"
        const api = window.LM_MAT_SHEET || window.materialsSheetBridge || null;
        if (!api || typeof api.upsertOne !== 'function') throw new Error('sheet API missing');
        api.upsertOne(sheetCtx, row);
      } catch(e){
        warn('save failed', e);
      }
    }, SAVE_DELAY);
  }

})();