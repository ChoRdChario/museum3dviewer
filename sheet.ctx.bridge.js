/*! sheet.ctx.bridge.js — gid-based context bridge (no-module/UMD) */
(function(){
  if (!window.sheetCtxBridge) {
    console.warn("[sheet-ctx] boot not loaded; minimal stub will be created");
    window.sheetCtxBridge = (function(){
      let _timer=null,_last=null;
      function _emit(ctx){ console.log("[ctx] set", ctx); window.dispatchEvent(new CustomEvent("lm:sheet-context",{detail:ctx})); }
      function start(getter,opt){
        const interval=(opt&&opt.intervalMs)||4000;
        if(_timer) clearInterval(_timer);
        try{ const ctx=getter&&getter(); if(ctx&&ctx.spreadsheetId){ _last=JSON.stringify(ctx); _emit(ctx);} }catch(e){}
        _timer=setInterval(function(){
          try{ const ctx=getter&&getter(); if(!(ctx&&ctx.spreadsheetId))return; const s=JSON.stringify(ctx); if(s!==_last){_last=s; _emit(ctx);} }catch(e){}
        }, interval);
      }
      function stop(){ if(_timer) clearInterval(_timer); _timer=null; }
      return { start, stop };
    })();
  }
  window.startSheetContextPolling = function(getter,opt){
    if(!window.sheetCtxBridge) throw new Error("[sheet-ctx] bridge missing");
    window.sheetCtxBridge.start(getter,opt);
  };
  window.stopSheetContextPolling = function(){
    if(window.sheetCtxBridge) window.sheetCtxBridge.stop();
  };
})();