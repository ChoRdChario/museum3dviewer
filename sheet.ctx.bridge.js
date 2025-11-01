
/*! sheet.ctx.bridge.js */
(() => {
  const log = (...a) => console.log("[sheet-ctx-bridge]", ...a);
  if (window.__sheetCtxInstalled) return;
  window.__sheetCtxInstalled = true;

  function emit(spreadsheetId, sheetGid) {
    const detail = { spreadsheetId, sheetGid };
    window.__lm_sheetContext = detail; // sticky
    document.dispatchEvent(new CustomEvent("lm:sheet-context", { detail }));
    log("lm:sheet-context", detail);
  }

  function start() {
    // Observe UI selects for spreadsheet/sheet
    const urlSel = document.getElementById("glbUrl"); // not strictly needed
    const sheetSel = document.getElementById("save-target-sheet");
    // For now, read from global if your app places it there
    const g = window.__lm_currentSheetCtx || {};
    if (g.spreadsheetId) emit(g.spreadsheetId, g.sheetGid || 0);

    // Periodic re-emit (sticky refresher)
    setInterval(() => {
      const ctx = window.__lm_currentSheetCtx || window.__lm_sheetContext;
      if (ctx && ctx.spreadsheetId) emit(ctx.spreadsheetId, ctx.sheetGid || 0);
    }, 1000);
  }

  start();
})();
