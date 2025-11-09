// [auto-apply v1.1] safe THREE handling + event/ready gating. Applies settings once per sheet-context.
// NOTE: This stub calls a pluggable window.__LM_AUTO_APPLY__ if defined by your app's logic.

(function(){
  const until = (pred, ms=15000, step=100) => new Promise((res, rej) => {
    const t0 = performance.now();
    const id = setInterval(()=>{
      if (pred()) { clearInterval(id); res(true); }
      else if (performance.now() - t0 > ms) { clearInterval(id); rej(new Error('timeout')); }
    }, step);
  });

  const applyOnce = async () => {
    try {
      await until(() => !!window.__LM_SHEET_CTX);
      await until(() => !!window.__LM_MATERIALS_PERSIST__);
      await until(() => !!(window.__LM_SCENE || window.scene));
    } catch (e) {
      console.warn('[auto-apply v1.1] preconditions missing', e.message);
      return;
    }

    const THREE = window.THREE;
    if (!THREE) {
      console.warn('[auto-apply v1.1] THREE missing; skip apply');
      return;
    }

    if (typeof window.__LM_AUTO_APPLY__ === 'function') {
      try {
        await window.__LM_AUTO_APPLY__();
        console.log('[auto-apply v1.1] applied via __LM_AUTO_APPLY__ hook');
      } catch (e) {
        console.warn('[auto-apply v1.1] hook failed', e);
      }
    } else {
      console.log('[auto-apply v1.1] no __LM_AUTO_APPLY__ hook; nothing to do');
    }
  };

  window.addEventListener('lm:sheet-context', applyOnce, { once:false });
})();
