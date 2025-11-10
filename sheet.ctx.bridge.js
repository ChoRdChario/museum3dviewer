/* sheet.ctx.bridge.js — clean rebuild (2025-10-30)
   Emits sheet context events once globals are available.
*/
(function(){
  if (window.__lm_sheet_ctx_bridge_installed) return;
  window.__lm_sheet_ctx_bridge_installed = true;

  function log(){ try{ console.log.apply(console, ['[sheet-ctx-bridge]'].concat([].slice.call(arguments))); }catch(e){} }

  var lastSid = null;
  var lastGid = null;
  var firedInitial = false;

  function readCtx(){
    var sid = window.currentSpreadsheetId || window.spreadsheetId || null;
    var gid = (typeof window.currentSheetId !== 'undefined') ? window.currentSheetId
            : (typeof window.sheetGid !== 'undefined') ? window.sheetGid
            : null;
    return { sid: sid, gid: gid };
  }

  function fire(type, sid, gid){
    try{
      var detail = { spreadsheetId: sid, sheetGid: gid };
      var evDoc = new CustomEvent(type, { detail: detail, bubbles: true, composed: true });
      document.dispatchEvent(evDoc);
      var evWin = new CustomEvent(type, { detail: detail, bubbles: true, composed: true });
      window.dispatchEvent(evWin);
      log(type, detail);
    }catch(e){
      console.warn('[sheet-ctx-bridge] fire error', e);
    }
  }

  function tick(){
    try{
      var ctx = readCtx();
      if (ctx.sid && (ctx.gid !== null && typeof ctx.gid !== 'undefined')){
        if (!firedInitial){
          fire('lm:sheet-context', ctx.sid, ctx.gid);
          firedInitial = true;
          lastSid = ctx.sid; lastGid = ctx.gid;
        }else if (ctx.sid !== lastSid || ctx.gid !== lastGid){
          fire('lm:sheet-changed', ctx.sid, ctx.gid);
          lastSid = ctx.sid; lastGid = ctx.gid;
        }
      }
    }catch(e){
      console.warn('[sheet-ctx-bridge] tick error', e);
    }
  }

  function start(){
    tick();
    window.__lm_sheet_ctx_bridge_timer = window.setInterval(tick, 400);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    start();
  }else{
    window.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();

// Ensure materials persist layer receives context
try {
  window.addEventListener('lm:sheet-context', (e) => {
    const d = (e && e.detail) || {};
    if (d.spreadsheetId && (d.sheetGid !== undefined)) {
      if (window.LM_MaterialsPersist && typeof window.LM_MaterialsPersist.setCtx === 'function') {
        window.LM_MaterialsPersist.setCtx(d.spreadsheetId, d.sheetGid);
        console.log('[ctx->persist] setCtx applied', d.spreadsheetId, d.sheetGid);
      }
    }
  }, { once: false });
} catch (err) { console.warn('[ctx->persist] setCtx wiring failed', err); }
