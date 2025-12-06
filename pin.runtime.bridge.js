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
      armed = true;
      return true;
    }
    return false;
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    tryBind();
  } else {
    document.addEventListener("DOMContentLoaded", tryBind, { once:true });
  }
  document.addEventListener("lm:viewer-bridge-ready", tryBind);
  document.addEventListener("lm:scene-ready", tryBind);

  // Public API (guarded)
  window.__lm_pin_runtime = {
    // Add a pin marker to the scene (legacy helper)
    addPin: function(p){
      if(!tryBind()){ console.warn(LOG_PREFIX, "addPin ignored (no bridge yet)"); return; }
      return bridge.addPinMarker(p);
    },
    // Clear all pins (legacy helper)
    clear: function(){
      if(!tryBind()){ console.warn(LOG_PREFIX, "clear ignored (no bridge yet)"); return; }
      return bridge.clearPins();
    },
    // New-style APIs expected by caption.ui.controller.js
    addPinMarker: function(p){
      // Delegate to addPin so the behavior stays in one place
      return this.addPin(p);
    },
    clearPins: function(){
      return this.clear();
    },
    setPinSelected: function(id){
      if(!tryBind()){ console.warn(LOG_PREFIX, "setPinSelected ignored (no bridge yet)"); return; }
      if (bridge && typeof bridge.setPinSelected === "function") {
        return bridge.setPinSelected(id);
      }
    },
    // Accessor for the underlying viewer bridge
    getBridge: function(){
      return tryBind() ? bridge : null;
    },
    getViewerBridge: function(){
      return this.getBridge();
    }
  };
})();