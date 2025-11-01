
/**
 * LociMyu - Material Orchestrator (sticky-ready + UI sync + robust selectors)
 * VERSION_TAG: V6_16e_STICKY_UI_APPLY_PERSIST
 *
 * Goals:
 *  - Always populate the dropdown from viewer first (no hard-fail on waits).
 *  - Wire UI exactly once with resilient selectors (works across ids).
 *  - On selection: read saved row from sheet (if available) and reflect to UI.
 *  - On slider/input: apply to viewer (throttled) and persist append-only.
 *  - Avoid log spam / duplicate wire by using an idempotent guard.
 */
(function(){
  if (window.__lm_mat_orch_installed) return;
  window.__lm_mat_orch_installed = true;

  const VERSION_TAG = 'V6_16e_STICKY_UI_APPLY_PERSIST';
  const log = (...a) => { try { console.log('[mat-orch]', ...a); } catch(_){} };
  log('loaded VERSION_TAG:', VERSION_TAG);

  // ---- Small utils
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sels, root=document) => sels.map(s=>root.querySelector(s)).find(Boolean);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const rafThrottle = (fn) => {
    let r = false, lastArgs=null;
    return (...args)=>{
      lastArgs=args;
      if (r) return;
      r = true;
      requestAnimationFrame(()=>{ r=false; fn(...lastArgs); });
    };
  };
  const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

  // ---- Robust element pickup
  function pickupUI(){
    const els = {
      sel: $$('#pm-material, select[data-lm="pm-material"], select[name="pm-material"]'),
      range: $$('#pm-opacity-range, #pm-opacity, input[type="range"][data-role="pm-opacity"], input[type="range"][name="pm-opacity"]'),
      val: $$('#pm-opacity-val, [data-role="pm-opacity-val"]'),
      ds: $$('#pm-flag-doublesided, input[name="pm-double-sided"]'),
      ul: $$('#pm-flag-unlit, input[name="pm-unlit"]'),
    };
    return els;
  }

  // ---- Sticky waits (soft) --------------------------------------------------
  async function waitSceneReadySticky(timeoutMs=1200){
    // Try to short-circuit if viewerBridge already provides materials
    try{
      if (window.viewerBridge && typeof window.viewerBridge.listMaterials==='function'){
        const list = window.viewerBridge.listMaterials();
        if (list && list.length) return true;
      }
    }catch{}
    // Soft wait on event
    return new Promise(async (resolve)=>{
      let done=false;
      const onEvt = ()=>{ if (!done){ done=true; resolve(true);} };
      window.addEventListener('lm:scene-ready', onEvt, { once:true });
      await sleep(timeoutMs);
      if (!done){ resolve(false); }
    });
  }

  async function getSheetCtxSticky(timeoutMs=1200){
    // take last sticky value if present
    if (window.__lm_last_sheet_ctx) return window.__lm_last_sheet_ctx;
    // soft wait once
    return new Promise(async (resolve)=>{
      let done=false;
      const onEvt = (e)=>{ if (!done){ done=true; resolve(e.detail || null);} };
      window.addEventListener('lm:sheet-context', onEvt, { once:true });
      await sleep(timeoutMs);
      if (!done){ resolve(window.__lm_last_sheet_ctx || null); }
    });
  }

  // ---- Panel population from viewer ----------------------------------------
  function populatePanelFromViewer(els){
    const vb = window.viewerBridge;
    if (!vb || typeof vb.listMaterials!=='function') return 0;
    const list = vb.listMaterials() || [];
    if (!els.sel) return list.length;
    // Clear once
    els.sel.innerHTML = '';
    // Placeholder
    const ph = document.createElement('option');
    ph.value=''; ph.textContent='— Select material —';
    els.sel.appendChild(ph);
    for (const m of list){
      // allow both string keys and {key,name}
      const key = typeof m==='string' ? m : (m.key||m.name||m.id||'');
      if (!key) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = (m.name || m.key || key);
      els.sel.appendChild(opt);
    }
    log('panel populated', list.length, 'materials');
    return list.length;
  }

  // ---- Apply helpers --------------------------------------------------------
  function applyOpacityToViewer(matKey, opacity){
    const vb = window.viewerBridge;
    if (!vb || !matKey) return 0;
    let count = 0;
    try{
      if (typeof vb.setMaterialOpacity === 'function'){
        count = vb.setMaterialOpacity(matKey, opacity) | 0;
      }else if (typeof vb.applyOpacityByMaterial === 'function'){
        count = vb.applyOpacityByMaterial(matKey, opacity) | 0;
      }else if (typeof vb.setOpacityForMaterial === 'function'){
        count = vb.setOpacityForMaterial(matKey, opacity) | 0;
      }
    }catch(e){
      console.warn('[mat-orch] applyOpacity error', e);
    }
    log(`opacity ${opacity.toFixed(2)} → "${matKey}" x${count}`);
    return count;
  }

  function reflectOpacityUI(els, v){
    if (!els.range) return;
    const vv = Number.isFinite(v) ? clamp01(v) : 1;
    els.range.value = vv;
    if (els.val) els.val.textContent = vv.toFixed(2);
  }

  // ---- Persist (append-only) -----------------------------------------------
  function buildRecord(ctx, modelKey, matKey, state){
    const now = new Date().toISOString();
    return {
      key: matKey,
      modelKey: modelKey || '',
      materialKey: matKey,
      opacity: state.opacity,
      doubleSided: !!state.doubleSided,
      unlit: !!state.unlit,
      // chroma fields reserved
      chromaEnable: !!state.chromaEnable,
      chromaColor: state.chromaColor || '',
      chromaTolerance: state.chromaTolerance ?? '',
      chromaFeather: state.chromaFeather ?? '',
      updatedAt: now,
      updatedBy: 'mat-orch',
      spreadsheetId: ctx && ctx.spreadsheetId || '',
      sheetGid: ctx && ctx.sheetGid != null ? ctx.sheetGid : 0,
    };
  }

  async function persistAppend(ctx, rec){
    const br = window.materialsSheetBridge;
    if (!br) return false;
    try{
      if (typeof br.append === 'function') { await br.append(ctx, rec); }
      else if (typeof br.appendOne === 'function') { await br.appendOne(ctx, rec); }
      else if (typeof br.save === 'function') { await br.save(ctx, rec); }
      else if (typeof br.write === 'function') { await br.write(ctx, rec); }
      else { console.warn('[mat-orch] no append-like API on materialsSheetBridge'); return false; }
      log('persisted to sheet:', rec.key);
      return true;
    }catch(e){
      console.warn('[mat-orch] persist error', e);
      return false;
    }
  }

  async function loadSaved(ctx, modelKey, matKey){
    const br = window.materialsSheetBridge;
    if (!br || !ctx) return null;
    try{
      // polyfill path: loadByKey(ctx, modelKey, matKey)
      if (typeof br.loadByKey === 'function'){
        return await br.loadByKey(ctx, modelKey, matKey);
      }
      // fallback: getLatest or read
      if (typeof br.getLatest === 'function'){
        return await br.getLatest(ctx, modelKey, matKey);
      }
    }catch(e){ console.warn('[mat-orch] loadByKey error', e); }
    return null;
  }

  // ---- Main wire ------------------------------------------------------------
  const state = {
    wired:false,
    currentMatKey:'',
    modelKey:''
  };

  function modelKeyFromURL(){
    try {
      const u = new URL(window.location.href);
      return (u.searchParams.get('model') || u.searchParams.get('glb') || '').split('/').pop() || '';
    }catch{ return ''; }
  }

  function ensureModelKey(){ if (!state.modelKey) state.modelKey = modelKeyFromURL(); }

  function wireUIEvents(els){
    if (state.wired) return;
    state.wired = true;

    // slider input -> apply (throttled), label sync
    const throttledApply = rafThrottle(async ()=>{
      if (!state.currentMatKey) return;
      const v = clamp01(parseFloat(els.range.value || '1'));
      if (els.val) els.val.textContent = v.toFixed(2);
      applyOpacityToViewer(state.currentMatKey, v);
    });
    if (els.range){
      els.range.addEventListener('input', throttledApply);
      els.range.addEventListener('change', async ()=>{
        // persist after change
        const ctx = await getSheetCtxSticky(800);
        ensureModelKey();
        const rec = buildRecord(ctx, state.modelKey, state.currentMatKey, {
          opacity: clamp01(parseFloat(els.range.value||'1')),
          doubleSided: !!(els.ds && els.ds.checked),
          unlit: !!(els.ul && els.ul.checked),
        });
        await persistAppend(ctx, rec);
      });
    }

    // material selection -> reflect saved -> pre-apply
    if (els.sel){
      els.sel.addEventListener('change', async ()=>{
        const key = els.sel.value || '';
        state.currentMatKey = key;
        // default UI
        reflectOpacityUI(els, 1);
        if (!key) return;
        // try load saved
        const ctx = await getSheetCtxSticky(800);
        ensureModelKey();
        const saved = await loadSaved(ctx, state.modelKey, key);
        const op = saved && Number.isFinite(+saved.opacity) ? +saved.opacity : 1;
        reflectOpacityUI(els, op);
        // pre-apply
        applyOpacityToViewer(key, op);
      });
    }

    log('wired panel');
  }

  async function boot(){
    const els = pickupUI();
    // populate from viewer immediately
    populatePanelFromViewer(els);

    // try soft waits (do not abort if false)
    await waitSceneReadySticky(1000);
    const ctx = await getSheetCtxSticky(1000);
    if (ctx && !window.__lm_last_sheet_ctx) window.__lm_last_sheet_ctx = ctx;

    // wire once
    wireUIEvents(els);

    // if nothing is selected yet, keep first actual material selected
    if (els.sel && !els.sel.value && els.sel.options.length > 1){
      els.sel.selectedIndex = 1;
      els.sel.dispatchEvent(new Event('change', {bubbles:true}));
    }
  }

  // kick
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    boot();
  }else{
    window.addEventListener('DOMContentLoaded', boot, { once:true });
  }
})();
