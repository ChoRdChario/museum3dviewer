
/**
 * LociMyu - Sheet Context Bridge (sticky cache + de-dup)
 * Exposes a persistent cache so late listeners can pick up the latest ctx.
 */
(function(){
  if (window.__lm_sheet_ctx_bridge_installed) return;
  window.__lm_sheet_ctx_bridge_installed = true;

  const log = (...a)=>{ try{ console.log('[sheet-ctx-bridge]', ...a);}catch(_){} };

  let lastSid = null;
  let lastGid = null;
  let firedInitial = false;

  function readCtx(){
    const sid = (window.currentSpreadsheetId || window.spreadsheetId || null);
    const gid = (typeof window.currentSheetId !== 'undefined' ? window.currentSheetId
                 : (typeof window.sheetGid !== 'undefined' ? window.sheetGid : null));
    return { sid, gid };
  }

  function fire(type, sid, gid){
    try{
      const detail = { spreadsheetId: sid, sheetGid: gid };
      const ev = new CustomEvent('lm:sheet-context', { detail, bubbles:false, composed:true });
      // sticky cache for late listeners
      window.__lm_last_sheet_ctx = detail;
      window.dispatchEvent(ev);
      log('lm:sheet-context', detail);
    }catch(e){ console.warn('[sheet-ctx-bridge] fire error', e); }
  }

  function tick(){
    try{
      const ctx = readCtx();
      if (!ctx.sid && !ctx.gid) return;

      if (!firedInitial){
        firedInitial = true;
        lastSid = ctx.sid; lastGid = ctx.gid;
        fire('init', ctx.sid, ctx.gid);
        return;
      }
      // only fire when changed
      if (ctx.sid !== lastSid || ctx.gid !== lastGid){
        lastSid = ctx.sid; lastGid = ctx.gid;
        fire('changed', ctx.sid, ctx.gid);
      }
    }catch(e){
      console.warn('[sheet-ctx-bridge] tick error', e);
    }
  }

  function start(){
    // First tick immediately, then poll with moderate cadence
    tick();
    window.__lm_sheet_ctx_bridge_timer = window.setInterval(tick, 800);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    start();
  }else{
    window.addEventListener('DOMContentLoaded', start, { once:true });
  }

  log('ready');
})();
