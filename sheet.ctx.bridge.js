/* sheet.ctx.bridge.js
 * Approach A: Emit sheet-context events from existing globals
 * - Watches window.currentSpreadsheetId / window.currentSheetId
 * - Fires:
 *    - lm:sheet-context  : first time both are known
 *    - lm:sheet-changed  : when either value changes afterwards
 * - Safe to include multiple times; internal guard prevents duplicates.
 */
(() => {
  if (window.__lm_sheet_ctx_bridge_installed) return;
  window.__lm_sheet_ctx_bridge_installed = true;

  const log = (...a) => console.log('[sheet-ctx-bridge]', ...a);

  let lastSid = null;
  let lastGid = null;
  let firedInitial = false;

  function readCtx() {
    // Primary globals used in your repo
    let sid = window.currentSpreadsheetId ?? window.__lm_spreadsheetId ?? window.__lm_sheet?.spreadsheetId ?? null;
    let gid = window.currentSheetId ?? window.__lm_sheetGid ?? window.__lm_sheet?.sheetGid ?? null;
    if (gid != null && typeof gid !== 'number') {
      const n = Number(gid);
      gid = Number.isNaN(n) ? null : n;
    }
    return { sid, gid };
  }

  function fire(type, sid, gid) {
  try {
    const detail = { spreadsheetId: sid, sheetGid: gid };
    const evDoc = new CustomEvent(type, { detail, bubbles: true, composed: true });
    document.dispatchEvent(evDoc);
    const evWin = new CustomEvent(type, { detail, bubbles: true, composed: true });
    window.dispatchEvent(evWin);
    log(type, detail);
  } catch (e) {
    console.warn('[sheet-ctx] fire error', e);
  }
} }));
    log(type, { spreadsheetId: sid, sheetGid: gid });
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

  // Start polling after document is interactive
  const start = () => {
    tick();
    // Keep it light; 400ms is a good compromise
    window.__lm_sheet_ctx_bridge_timer = window.setInterval(tick, 400);
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();