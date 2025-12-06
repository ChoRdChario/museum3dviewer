// [pin-bridge] runtime facade between caption UI and viewer bridge
// Exposes a small, stable API on window.__lm_pin_runtime:
//
//   - addPin(pin) / addPinMarker(pin)
//   - clear() / clearPins()
//   - setPinSelected(pinId)
//   - getViewerBridge() / getBridge()
//
// Internally this delegates to the viewer bridge object that is assembled by
// glb.btn.bridge.v3 / viewer.module.cdn.js (window.__lm_viewer_bridge or
// window.viewerBridge).
(function(){
  const LOG_PREFIX = "[pin-bridge]";
  let bridge = null;
  let tries = 0;
  const MAX_TRIES = 50;
  const RETRY_MS = 120;

  function looksLikeViewerBridge(v){
    if (!v || typeof v !== "object") return false;
    if (typeof v.addPinMarker !== "function") return false;
    if (typeof v.clearPins !== "function") return false;
    return true;
  }

  function resolveBridge(){
    if (bridge && looksLikeViewerBridge(bridge)) return bridge;

    const candidates = [
      ["window.__lm_viewer_bridge", window.__lm_viewer_bridge],
      ["window.viewerBridge", window.viewerBridge]
    ];

    for (const [source, v] of candidates){
      if (looksLikeViewerBridge(v)){
        bridge = v;
        try {
          console.log(LOG_PREFIX, "bound to", source);
        } catch(e) {}

        // Notify any listeners that the viewer bridge became available.
        try {
          const ev = new CustomEvent("lm:viewer-bridge-ready", { detail: { source } });
          document.dispatchEvent(ev);
        } catch(e) {}
        return bridge;
      }
    }

    return null;
  }

  function scheduleInitialBind(){
    if (tries > 0) return; // already scheduled
    tries++;
    setTimeout(tryBindLoop, RETRY_MS);
  }

  function tryBindLoop(){
    const b = resolveBridge();
    if (b) return;
    tries++;
    if (tries >= MAX_TRIES) {
      try {
        console.log(LOG_PREFIX, "gave up auto-binding after", tries, "tries");
      } catch(e) {}
      return;
    }
    setTimeout(tryBindLoop, RETRY_MS);
  }

  // Kick off binding after DOM is mostly ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleInitialBind, { once: true });
  } else {
    scheduleInitialBind();
  }

  // When the 3D scene is ready, chances are high that the viewer bridge is ready too.
  document.addEventListener("lm:scene-ready", function(){
    tries = 0;
    tryBindLoop();
  });

  const runtime = {
    addPin: function(pin){
      const b = resolveBridge();
      if (!b) {
        try { console.warn(LOG_PREFIX, "addPin called before viewer bridge is ready"); } catch(e) {}
        return;
      }
      return b.addPinMarker(pin);
    },
    clear: function(){
      const b = resolveBridge();
      if (!b) {
        try { console.warn(LOG_PREFIX, "clear called before viewer bridge is ready"); } catch(e) {}
        return;
      }
      return b.clearPins();
    },

    // New APIs used by caption.ui.controller.js
    addPinMarker: function(pin){
      return runtime.addPin(pin);
    },
    clearPins: function(){
      return runtime.clear();
    },
    setPinSelected: function(pinId){
      const b = resolveBridge();
      if (!b) {
        try { console.warn(LOG_PREFIX, "setPinSelected called before viewer bridge is ready"); } catch(e) {}
        return;
      }
      if (typeof b.setPinSelected === "function") {
        return b.setPinSelected(pinId);
      } else {
        try { console.warn(LOG_PREFIX, "viewer bridge has no setPinSelected"); } catch(e) {}
      }
    },

    getViewerBridge: function(){
      return resolveBridge();
    },
    // Backward compatible alias
    getBridge: function(){
      return resolveBridge();
    }
  };

  window.__lm_pin_runtime = runtime;
  try { console.log(LOG_PREFIX, "armed"); } catch(e) {}
})();