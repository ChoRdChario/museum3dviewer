
// [caption.sheet.bridge] Phase A0 shim
// No-op persistence layer; logs calls. Will be replaced by real Sheets bridge.
(function(){
  const TAG='[caption.sheet.bridge]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  function onSheetContext(evt){
    const d = (evt && evt.detail) || {};
    window.__lm_sheet_ctx = d;
    log('sheet-context', d);
    // Later: load captions from d.sheetGid
  }

  window.addEventListener('lm:sheet-context', onSheetContext);
  log('armed');
})();
