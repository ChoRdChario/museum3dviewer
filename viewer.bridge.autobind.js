/*! viewer.bridge.autobind.js
 * Find the viewer bridge object (one that exposes addPinMarker/clearPins)
 * and publish it to window.__lm_viewer_bridge.
 * Robust to load order; retries on scene-ready.
 */
(function(){
  const LOG_PREFIX = "[viewer-bridge.autobind]";
  const BRIDGE_KEYS = ["addPinMarker", "clearPins"];
  let bound = false;
  let tries = 0;
  const MAX_TRIES = 50;
  const RETRY_MS = 120;

  function looksLikeBridge(v){
    if(!v || typeof v !== "object") return false;
    return BRIDGE_KEYS.every(k => typeof v[k] === "function");
  }

  function scanOnce(){
    tries++;
    // Priority 1: commonly used global variable names (fast path)
    const hotNames = ["viewerBridge", "__viewerBridge", "__lm_viewer", "__LM_VIEW"];
    for(const n of hotNames){
      if(looksLikeBridge(window[n])){
        publish(window[n], "hotName:" + n);
        return true;
      }
    }
    // Priority 2: exhaustive scan of window keys (fallback path)
    for(const k of Object.keys(window)){
      const v = window[k];
      if(looksLikeBridge(v)){
        publish(v, "window." + k);
        return true;
      }
    }
    return false;
  }

  function publish(bridge, source){
    if(bound) return;
    bound = true;
    window.__lm_viewer_bridge = bridge;
    try {
      console.log(LOG_PREFIX, "bound __lm_viewer_bridge from", source);
      document.dispatchEvent(new Event("lm:viewer-bridge-ready"));
    } catch(e){
      console.warn(LOG_PREFIX, "dispatch failed", e);
    }
  }

  function poll(){
    if(bound) return;
    if(scanOnce()) return;
    if(tries >= MAX_TRIES) {
      console.warn(LOG_PREFIX, "give up (not found after", tries, "tries)");
      return;
    }
    setTimeout(poll, RETRY_MS);
  }

  // Kick off on DOMContentLoaded
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", poll, {once:true});
  } else {
    poll();
  }

  // Also retry once scene is ready (bridge may be created there)
  document.addEventListener("lm:scene-ready", () => {
    if(!bound){
      console.log(LOG_PREFIX, "scene-ready => rescan");
      tries = 0;
      poll();
    }
  });
})();