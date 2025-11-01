
// LociMyu - Sheet Context Bridge (sticky, deduped)
// VERSION_TAG: V6_16f_SHEET_CTX_STICKY
(function(){
  if (window.__lm_sheet_ctx_bridge_installed) return;
  window.__lm_sheet_ctx_bridge_installed = true;

  const log=(...a)=>{try{console.log('[sheet-ctx-bridge]',...a);}catch(_){}}
  log('ready');

  let last = { spreadsheetId: undefined, sheetGid: undefined };

  function readCtx(){
    const sid = (window.currentSpreadsheetId || window.spreadsheetId || null);
    const gid = (typeof window.currentSheetGid !== 'undefined' ? window.currentSheetGid :
                (typeof window.sheetGid !== 'undefined' ? window.sheetGid : null));
    return { spreadsheetId: sid, sheetGid: gid };
  }

  function emit(type, detail){
    try {
      const ev = new CustomEvent(type, { detail, bubbles: true, composed: true });
      window.dispatchEvent(ev);
    } catch (e) {
      console.warn('[sheet-ctx-bridge] dispatch failed', e);
    }
  }

  function tick(){
    const ctx = readCtx();
    if (!ctx.spreadsheetId) return; // avoid noise before first bind

    if (ctx.spreadsheetId !== last.spreadsheetId || ctx.sheetGid !== last.sheetGid){
      last = ctx;
      window.__lm_last_sheet_ctx = ctx;
      emit('lm:sheet-context', ctx);
      log('lm:sheet-context', ctx);
    }
  }

  const start = ()=> setInterval(tick, 400);
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    start();
  }else{
    window.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
