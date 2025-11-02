/* LociMyu - Material Orchestrator
 * Version: V6_16g_SAFE_UI_PIPELINE
 * Purpose: Robust, order-safe wiring for Material UI (dropdown + opacity slider),
 *          model application, and sheet persistence with append-only writes.
 */
(function(){
  if (window.__lm_mat_orch_installed) return;
  window.__lm_mat_orch_installed = true;

  const VERSION_TAG = 'V6_16g_SAFE_UI_PIPELINE';
  const state = { wired:false, ui:null, optionsBuilt:false, lastListSig:'' };

  function log(){ try{ console.log.apply(console, ['[mat-orch]', VERSION_TAG].concat([].slice.call(arguments))); }catch(_){} }

  // ---------- small helpers ----------
  function clamp01(v){ v = parseFloat(v); if (isNaN(v)) v = 0; return Math.max(0, Math.min(1, v)); }

  // Wait for predicate using MutationObserver + polling
  function waitFor(pred, {timeout=6000, interval=120} = {}) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const tick = () => {
        try{
          const v = pred();
          if (v) { cleanup(); return resolve(v); }
          if (performance.now() - t0 > timeout) { cleanup(); return reject(new Error('waitFor timeout')); }
        }catch(e){ /* ignore */ }
      };
      const mo = new MutationObserver(tick);
      try{ mo.observe(document.body, {subtree:true, childList:true}); }catch(_){}
      const tm = setInterval(tick, interval);
      const cleanup = () => { try{mo.disconnect();}catch(_){}; clearInterval(tm); };
      tick();
    });
  }

  // Find the Per-material opacity section and pick select/range within it
  async function pickupUI() {
    const container = await waitFor(() => {
      const nodes = document.querySelectorAll('section,div,fieldset,.card,.panel');
      for (const el of nodes) {
        const txt = (el.textContent || '').toLowerCase();
        if ((txt.includes('per-material opacity') || txt.includes('per material opacity') || txt.includes('saved per sheet'))
            && el.querySelector('input[type="range"]') && el.querySelector('select')) {
          return el;
        }
      }
      return null;
    }, {timeout: 8000});

    const selects = Array.from(container.querySelectorAll('select'));
    const opacityRange = container.querySelector('input[type="range"]');
    if (!opacityRange || selects.length === 0) throw new Error('UI elements not found (materialSelect/opacityRange)');

    // Prefer select which looks like it contains materials
    let materialSelect = selects.find(s => {
      const t = (s.textContent || '').toLowerCase();
      return t.includes('material'); // wide match
    }) || selects[1] || selects[0];

    return { container, materialSelect, opacityRange };
  }

  // Build dropdown options from viewerBridge.listMaterials()
  async function fillMaterialsOnce() {
    const ui = state.ui;
    if (!ui) return;
    const vb = window.viewerBridge;
    if (!vb || typeof vb.listMaterials !== 'function') return;

    const list = vb.listMaterials() || [];
    const normalizeKey = (m) => {
      if (!m) return null;
      if (typeof m === 'string') return m;
      return m.name || m.materialKey || m.key || null;
    };
    const keys = list.map(normalizeKey).filter(Boolean);

    const sig = JSON.stringify(keys);
    if (sig === state.lastListSig && state.optionsBuilt) return; // already populated with same list
    state.lastListSig = sig;

    // Clear and rebuild
    const sel = ui.materialSelect;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = '— Select material —';
    sel.appendChild(ph);

    for (const k of keys) {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = k;
      sel.appendChild(opt);
    }
    state.optionsBuilt = true;
    log('panel populated', keys.length, 'materials');
  }

  // Load existing row by material key (API name variations tolerated)
  async function sheetLoadByKey(key){
    const br = window.materialsSheetBridge || {};
    const cand = br.loadByKey || br.load || br.fetchByKey || br.getByKey || null;
    if (typeof cand === 'function') {
      try { return await cand(key); } catch(e){ log('loadByKey error', e); }
    }
    return null;
  }

  // Append/persist row (API name variations tolerated)
  async function sheetAppend(row){
    const br = window.materialsSheetBridge || {};
    const cand = br.append || br.appendRow || br.persist || br.save || null;
    if (typeof cand === 'function') {
      try { return await cand(row); } catch(e){ log('append error', e); }
    }
    return null;
  }

  async function onSelectChange() {
    const { materialSelect, opacityRange } = state.ui || {};
    const key = materialSelect && materialSelect.value;
    if (!key) return;

    // Prefer saved value
    let opacity = 1.0;
    const saved = await sheetLoadByKey(key);
    if (saved && typeof saved.opacity === 'number') {
      opacity = saved.opacity;
    } else {
      try {
        const vb = window.viewerBridge;
        const g = vb && vb.getMaterialOpacity;
        if (typeof g === 'function') opacity = clamp01(g.call(vb, key));
      } catch(e){}
    }
    opacityRange.value = String(opacity);
    opacityRange.dispatchEvent(new Event('input', {bubbles:false}));
  }

  const persistDebounce = (() => { let h; return (fn)=>{ clearTimeout(h); h=setTimeout(fn,200); }; })();

  async function onOpacityInput() {
    const { materialSelect, opacityRange } = state.ui || {};
    const key = materialSelect && materialSelect.value;
    if (!key) return;
    const val = clamp01(opacityRange.value);

    // apply to model
    try {
      const vb = window.viewerBridge;
      const setter = vb.setMaterialOpacity || vb.applyOpacityByMaterial || vb.setOpacityForMaterial;
      if (typeof setter === 'function') setter.call(vb, key, val);
    } catch(e){ log('apply opacity error', e); }

    // persist (debounced)
    persistDebounce(async () => {
      await sheetAppend({ materialKey: key, opacity: val });
    });
  }

  async function wireOnce() {
    // 1) viewer ready (API present)
    await waitFor(() => {
      const vb = window.viewerBridge;
      return vb && typeof vb.listMaterials === 'function';
    }, {timeout: 8000});

    // 2) sheet-context non-null/undefined
    const sheetCtx = await waitFor(() => {
      const ctx = window.__lm_last_sheet_ctx;
      return (ctx && ctx.spreadsheetId && ctx.sheetGid !== undefined && ctx.sheetGid !== null) ? ctx : null;
    }, {timeout: 8000});
    log('sheet-context', sheetCtx);

    // 3) pickup UI
    state.ui = await pickupUI();

    // 4) populate and wire once
    await fillMaterialsOnce();

    if (!state.wired) {
      const { materialSelect, opacityRange } = state.ui;
      materialSelect.addEventListener('change', onSelectChange, {passive:true});
      opacityRange.addEventListener('input', onOpacityInput, {passive:true});
      state.wired = true;
      log('wired panel');
    }

    // Trigger initial sync if any
    if (state.ui.materialSelect.value) await onSelectChange();
  }

  // Boot once after DOM ready
  async function boot(){
    log('loaded VERSION_TAG:', VERSION_TAG);
    try {
      await wireOnce();
    } catch (e) {
      log('first wire failed, retry soon', e && e.message || e);
      setTimeout(() => boot(), 600); // one-shot retry window; wireOnce guards against dupes
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    window.addEventListener('DOMContentLoaded', boot, { once:true });
  }

})();