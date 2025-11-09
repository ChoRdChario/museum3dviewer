// [mat-ui-wire v1.7] robust rebind: waits for persist-ready + sheet-context, then binds once.
// It is safe to include over existing wire; it replaces range handlers to prevent duplication.

(function(){
  const sel  = document.querySelector('#pm-material');
  const rng0 = document.querySelector('#pm-opacity-range');
  const cbDS = document.querySelector('#pm-double-sided');
  const cbUL = document.querySelector('#pm-unlit-like');

  if (!sel || !rng0) {
    console.warn('[mat-ui-wire v1.7] UI parts missing', {sel:!!sel, rng:!!rng0, ds:!!cbDS, un:!!cbUL});
    return;
  }

  if (window.__LM_UI_WIRE_BOUND_V17__) {
    // already installed
    return;
  }

  // De-duplicate by cloning the range input (removes previous listeners)
  const rng = rng0.cloneNode(true);
  rng0.parentNode.replaceChild(rng, rng0);

  const state = { havePersist:false, haveSheet:false, bound:false };

  const tryBind = () => {
    if (state.bound) return;
    state.havePersist = !!window.__LM_MATERIALS_PERSIST__;
    state.haveSheet   = !!window.__LM_SHEET_CTX;
    if (!state.havePersist || !state.haveSheet) return;

    const P = window.__LM_MATERIALS_PERSIST__;
    if (!P) return;

    const getKey = () => sel.value || sel.selectedOptions?.[0]?.value || '';
    let t;
    const onChange = async () => {
      const materialKey = getKey();
      const opacity = parseFloat(rng.value);
      if (!materialKey || Number.isNaN(opacity)) return;
      try {
        // API name compatibility: ensureSheetAndHeaders or ensureHeaders
        const ensure = P.ensureSheetAndHeaders || P.ensureHeaders || P.ensure;
        await ensure?.();
        await P.upsert?.({
          materialKey,
          opacity,
          doubleSided: !!cbDS?.checked,
          unlitLike:   !!cbUL?.checked,
          sheetGid: window.__LM_SHEET_CTX?.sheetGid ?? 0
        });
        console.log('[mat-ui-wire] upsert', { materialKey, opacity, sheetGid: window.__LM_SHEET_CTX?.sheetGid ?? 0 });
      } catch (e) {
        console.error('[mat-ui-wire] upsert failed', e);
      }
    };
    const debounced = () => { clearTimeout(t); t = setTimeout(onChange, 150); };

    rng.addEventListener('input',     debounced, {passive:true});
    rng.addEventListener('change',    debounced, {passive:true});
    rng.addEventListener('pointerup', debounced, {passive:true});
    sel.addEventListener('change',    onChange,  {passive:true});
    cbDS?.addEventListener('change',  onChange,  {passive:true});
    cbUL?.addEventListener('change',  onChange,  {passive:true});

    state.bound = true;
    window.__LM_UI_WIRE_BOUND_V17__ = true;
    console.log('[mat-ui-wire v1.7] bound after persist+sheet ready');
  };

  // Fast-path if everything is already present
  tryBind();

  // Event driven: whichever comes later will trigger re-check
  window.addEventListener('lm:persist-ready', () => tryBind());
  window.addEventListener('lm:persist-ctx',   () => tryBind());
  window.addEventListener('lm:sheet-context', (e) => {
    // Best-effort: forward ctx into persist in case upstream forgot to call setCtx
    try { window.__LM_MATERIALS_PERSIST__?.setCtx?.(e?.detail); } catch {}
    tryBind();
  });
})();
