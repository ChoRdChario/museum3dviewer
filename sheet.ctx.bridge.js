// sheet.ctx.bridge.js — diffed dispatcher (gid-first), no export tokens
(function(){
  const TAG='[ctx]';
  const log=(...a)=>console.log(TAG, ...a);
  const same = (a,b)=>JSON.stringify(a||{})===JSON.stringify(b||{});
  let cur = { spreadsheetId:'', sheetGid:'' };

  function setSheetContext(next){
    // NOTE: sheetGid can be 0 for the first sheet. Preserve 0.
    const n = {
      spreadsheetId: (next.spreadsheetId == null) ? '' : String(next.spreadsheetId),
      sheetGid: (next.sheetGid == null) ? '' : String(next.sheetGid)
    };
    if (same(n, cur)){ return false; }
    cur = n;
    window.__LM_ACTIVE_SPREADSHEET_ID = n.spreadsheetId;
    window.__LM_ACTIVE_SHEET_GID = n.sheetGid;
    window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail: n }));
    window.__LM_SHEET_CTX = n; // ★ auto-apply 互換用 alias
    log('set', n);
    return true;
  }

  let timer = null, getter = null, interval = 5000;
  function startSheetContextPolling(fn, opt){
    getter = fn; interval = Math.max(1000, (opt&&opt.intervalMs)||5000);
    stopSheetContextPolling();
    const tick = async ()=>{
      try{
        const v = await Promise.resolve(getter&&getter());
        if (v) setSheetContext(v);
      }catch(e){ /* silent */ }
    };
    timer = setInterval(tick, interval);
    log('getter bound (polling)');
    Promise.resolve().then(tick);
  }
  function stopSheetContextPolling(){
    if (timer){ clearInterval(timer); timer=null; }
  }

  window.setSheetContext = setSheetContext;
  window.startSheetContextPolling = startSheetContextPolling;
  window.stopSheetContextPolling = stopSheetContextPolling;
})();
