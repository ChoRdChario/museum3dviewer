/*! pin.runtime.bridge.js
 * Bind to window.__lm_viewer_bridge (set by viewer.bridge.autobind.js) and expose
 * simple helpers for caption pin rendering. Non-fatal if delayed.
 */
(function(){
  const LOG_PREFIX = "[pin-bridge]";
  let bridge = null;
  let armed = false;
  console.log(LOG_PREFIX, "armed");

  function tryBind(){
    if(bridge) return true;
    bridge = window.__lm_viewer_bridge || null;
    if(bridge){
      console.log(LOG_PREFIX, "bound");
      document.dispatchEvent(new Event("lm:viewer-bridge-ready"));
      return true;
    }
    return false;
  }

  // Initial attempt
  tryBind();

  // Re-try on these events
  document.addEventListener("lm:viewer-bridge-ready", tryBind);
  document.addEventListener("lm:scene-ready", tryBind);

  // Public API (guarded)
  window.__lm_pin_runtime = {
    addPin: function(p){
      if(!tryBind()){ console.warn(LOG_PREFIX, "addPin ignored (no bridge yet)"); return; }
      return bridge.addPinMarker(p);
    },
    clear: function(){
      if(!tryBind()){ console.warn(LOG_PREFIX, "clear ignored (no bridge yet)"); return; }
      return bridge.clearPins();
    },
    getBridge: function(){ return tryBind() ? bridge : null; }
  };
})();