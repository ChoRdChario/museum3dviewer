// [mat-sheet-persist v1.6+event] add persist-ready / persist-ctx events without breaking existing API
// This file is safe to include multiple times; wrappers guard against redefinition.

(function(){
  const P = window.__LM_MATERIALS_PERSIST__;
  // If the persist module is not yet present, poll briefly then emit when ready.
  if (!P) {
    if (!window.__LM_PERSIST_POLLING__) {
      window.__LM_PERSIST_POLLING__ = true;
      const t0 = performance.now();
      const id = setInterval(()=>{
        const ready = !!window.__LM_MATERIALS_PERSIST__;
        const timeout = (performance.now() - t0) > 10000;
        if (ready || timeout) {
          clearInterval(id);
          if (ready && !window.__LM_PERSIST_READY_EMITTED__) {
            window.__LM_PERSIST_READY_EMITTED__ = true;
            try { window.dispatchEvent(new CustomEvent('lm:persist-ready')); } catch{}
            console.log('[persist] emitted lm:persist-ready (polled)');
          } else if (timeout) {
            console.warn('[persist] persist module did not appear within 10s (poll ended)');
          }
        }
      }, 120);
    }
    return;
  }

  // Emit persist-ready once
  if (!window.__LM_PERSIST_READY_EMITTED__) {
    window.__LM_PERSIST_READY_EMITTED__ = true;
    try { window.dispatchEvent(new CustomEvent('lm:persist-ready')); } catch{}
    console.log('[persist] emitted lm:persist-ready');
  }

  // Wrap setCtx once to emit persist-ctx
  if (!P.__lm_ctx_wrapper_installed__ && typeof P.setCtx === 'function') {
    P.__lm_ctx_wrapper_installed__ = true;
    const orig = P.setCtx.bind(P);
    P.setCtx = (ctx) => {
      const r = orig(ctx);
      try { window.dispatchEvent(new CustomEvent('lm:persist-ctx', { detail: ctx || null })); } catch {}
      console.log('[persist] emitted lm:persist-ctx', ctx);
      return r;
    };
  }
})(); 
