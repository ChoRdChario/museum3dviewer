// viewer.bridge.autobind.js
// Exports a viewer bridge to window.__lm_viewer_bridge if a suitable object is found.
// Then emits 'lm:viewer-bridge-ready' so pin runtime can bind safely.
(function(){
  const EVT = 'lm:viewer-bridge-ready';
  function hasBridge(v){
    return v && typeof v === 'object'
           && typeof v.addPinMarker === 'function'
           && typeof v.clearPins === 'function';
  }
  function scanOnce(){
    try{
      const keys = Object.keys(window);
      for (let i=0;i<keys.length;i++){
        const k = keys[i];
        const v = window[k];
        if (hasBridge(v)){
          window.__lm_viewer_bridge = v;
          document.dispatchEvent(new Event(EVT));
          console.log('[viewer-bridge] autobound from window.' + k);
          return true;
        }
      }
    }catch(e){
      console.warn('[viewer-bridge] scan error', e);
    }
    return false;
  }
  function tryBind(){
    if (window.__lm_viewer_bridge && hasBridge(window.__lm_viewer_bridge)){
      // already bound by native exporter
      document.dispatchEvent(new Event(EVT));
      console.log('[viewer-bridge] existing __lm_viewer_bridge detected');
      return true;
    }
    return scanOnce();
  }
  // Run once now; if not yet available, wait for scene ready then retry.
  if (!tryBind()){
    document.addEventListener('lm:scene-ready', () => {
      setTimeout(tryBind, 0);
    }, { once:true });
    // Also retry shortly after GLB detection events (defensive)
    document.addEventListener('glb:loaded', () => setTimeout(tryBind, 0));
  }
})();
