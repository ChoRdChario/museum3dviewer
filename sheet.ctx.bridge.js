/* sheet.ctx.bridge.js (reconstructed clean)
 * Emits sheet-context events from existing globals.
 * Fires:
 *   - lm:sheet-context  : first time both spreadsheetId & sheetGid are known
 *   - lm:sheet-changed  : when either changes thereafter
 */
(() => {
  if (window.__lm_sheet_ctx_bridge_installed) return;
  window.__lm_sheet_ctx_bridge_installed = true;

  const log = (...a) => console.log('[sheet-ctx-bridge]', ...a);

  let lastSid = null;
  let lastGid = null;
  let firedInitial = false;

  function readCtx() {
    const sid = (window.currentSpreadsheetId || window.spreadsheetId || null);
    const gid = (typeof window.currentSheetId !== 'undefined' ? window.currentSheetId
               : typeof window.sheetGid !== 'undefined' ? window.sheetGid
               : null);
    return { sid, gid };
  }

  function fire(type, sid, gid) {
    try {
      const detail = { spreadsheetId: sid, sheetGid: gid };
      // dispatch fresh events to both targets; enable bubbles/composed
      const evDoc = new CustomEvent(type, { detail, bubbles: true, composed: true });
      document.dispatchEvent(evDoc);
      const evWin = new CustomEvent(type, { detail, bubbles: true, composed: true });
      window.dispatchEvent(evWin);
      log(type, detail);
    } catch (e) {
      console.warn('[sheet-ctx-bridge] fire error', e);
    }
  }

  const tick = () => {
    const { sid, gid } = readCtx();
    if (sid && gid != null) {
      if (!firedInitial) {
        fire('lm:sheet-context', sid, gid);
        firedInitial = true;
        lastSid = sid; lastGid = gid;
      } else if (sid !== lastSid || gid !== lastGid) {
        fire('lm:sheet-changed', sid, gid);
        lastSid = sid; lastGid = gid;
      }
    }
  };

  const start = () => {
    tick();
    window.__lm_sheet_ctx_bridge_timer = window.setInterval(tick, 400);
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();