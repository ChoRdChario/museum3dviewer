
// LociMyu - Sheet Context Bridge (sticky cache)
(function(){
  if (window.__lm_sheet_ctx_bridge_installed) return;
  window.__lm_sheet_ctx_bridge_installed = true;

  function readCtx() {
    const spreadsheetId = window.currentSpreadsheetId || window.spreadsheetId || null;
    const gid = (typeof window.currentSheetId !== 'undefined') ? window.currentSheetId : window.sheetGid;
    return { spreadsheetId, sheetGid: gid };
  }

  function dispatch(ctx) {
    try {
      window.__lm_last_sheet_ctx = ctx;
      const ev = new CustomEvent('lm:sheet-context', { detail: ctx, bubbles: true, composed: true });
      window.dispatchEvent(ev);
    } catch (e) {
      console.warn('[sheet-ctx-bridge] dispatch fail', e);
    }
  }

  function tick() {
    try {
      const ctx = readCtx();
      if (ctx && ctx.spreadsheetId) dispatch(ctx);
    } catch (e) {}
  }

  function start() {
    tick();
    window.__lm_sheet_ctx_timer = setInterval(tick, 400);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
})();
