/* LociMyu - Sheet Context Bridge (sticky cache)
 * Adds a persistent cache so late listeners can pick up the latest ctx.
 */
(function(){
  // expose a helper to publish ctx (call where ctx is produced), or set __lm_last_sheet_ctx before dispatch elsewhere.
  window.__lm_publish_sheet_ctx = function(ctx){
    try { window.__lm_last_sheet_ctx = ctx; } catch {}
    try {
      window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail: ctx }));
    } catch (e){
      console.warn('[sheet-ctx-bridge] dispatch failed', e);
    }
  };
  // If existing producer already dispatches 'lm:sheet-context', add:
  //   window.__lm_last_sheet_ctx = ctx;
  // immediately before dispatch to enable late listeners.
})();
