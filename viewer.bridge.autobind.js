// [viewer-bridge.autobind] simplified auto-binding for __lm_viewer_bridge
// This script only tries to reuse existing viewer bridge objects that are
// explicitly exposed on window (window.__lm_viewer_bridge / window.viewerBridge).
// It no longer scans arbitrary window properties, to avoid accidentally binding
// to unrelated objects such as __lm_pin_runtime.
(function(){
  const LOG_PREFIX = "[viewer-bridge.autobind]";
  const BRIDGE_KEYS = ["addPinMarker", "clearPins"];
  let bound = false;
  let tries = 0;
  const MAX_TRIES = 50;
  const RETRY_MS = 120;

  function looksLikeBridge(v){
    if (!v || typeof v !== "object") return false;
    for (const k of BRIDGE_KEYS){
      if (typeof v[k] !== "function") return false;
    }
    return true;
  }

  function bindFrom(source, v){
    if (!looksLikeBridge(v)) return false;
    window.__lm_viewer_bridge = v;
    try {
      console.log(LOG_PREFIX, "bound __lm_viewer_bridge from", source);
    } catch(e) {}
    bound = true;
    return true;
  }

  function tryExisting(){
    if (bound) return true;

    if (looksLikeBridge(window.__lm_viewer_bridge)) {
      return bindFrom("existing window.__lm_viewer_bridge", window.__lm_viewer_bridge);
    }

    if (looksLikeBridge(window.viewerBridge)) {
      return bindFrom("window.viewerBridge", window.viewerBridge);
    }

    return false;
  }

  function poll(){
    if (bound) return;
    tries++;
    if (tryExisting()) {
      return;
    }
    if (tries >= MAX_TRIES) {
      try {
        console.log(LOG_PREFIX, "gave up auto-binding after", tries, "tries");
      } catch(e) {}
      return;
    }
    setTimeout(poll, RETRY_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", poll, { once: true });
  } else {
    poll();
  }

  // When the viewer scene is ready (GLB loaded), the viewer bridge is usually
  // assembled by glb.btn.bridge.v3. Hook this event to retry binding with a
  // fresh budget of attempts.
  document.addEventListener("lm:scene-ready", function(){
    if (bound) return;
    tries = 0;
    try {
      console.log(LOG_PREFIX, "lm:scene-ready -> retry binding");
    } catch(e) {}
    poll();
  });
})();