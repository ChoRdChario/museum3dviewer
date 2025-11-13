/*! viewer.bridge.autobind.js
 * Bind window.__lm_viewer_bridge for consumers that don't know who created it.
 * - 優先: すでに存在する window.__lm_viewer_bridge
 * - フォールバック: window.viewerBridge / window.* をスキャン
 * lm:scene-ready 発火後も数回だけリトライする。
 */
(function(){
  const LOG_PREFIX = "[viewer-bridge.autobind]";
  const BRIDGE_KEYS = ["addPinMarker", "clearPins"];
  let bound = false;
  let tries = 0;
  const MAX_TRIES = 50;
  const RETRY_MS = 120;

  function looksLikeBridge(v){
    if (!v || typeof v !== "object") return false;
    return BRIDGE_KEYS.every((k) => typeof v[k] === "function");
  }

  function bindFrom(source, candidate){
    if (!candidate || !looksLikeBridge(candidate)) return false;
    window.__lm_viewer_bridge = candidate;
    bound = true;
    try{
      console.log(LOG_PREFIX, "bound __lm_viewer_bridge from", source);
    }catch(_){}
    try{
      document.dispatchEvent(new Event("lm:viewer-bridge-ready"));
    }catch(e){
      try{ console.warn(LOG_PREFIX, "dispatch lm:viewer-bridge-ready failed", e); }catch(_){}
    }
    return true;
  }

  function tryExisting(){
    if (bound) return true;
    // 1) 明示的にセットされたブリッジを最優先
    if (looksLikeBridge(window.__lm_viewer_bridge)){
      return bindFrom("existing __lm_viewer_bridge", window.__lm_viewer_bridge);
    }
    // 2) 旧来の window.viewerBridge も候補にする
    if (looksLikeBridge(window.viewerBridge)){
      return bindFrom("window.viewerBridge", window.viewerBridge);
    }
    return false;
  }

  function scanWindow(){
    if (bound) return true;
    tries++;
    if (tries > MAX_TRIES) return false;
    try{
      for (const key in window){
        try{
          const v = window[key];
          if (bindFrom(`window["${key}"]`, v)) return true;
        }catch(_){}
      }
    }catch(e){
      try{ console.warn(LOG_PREFIX, "scanWindow failed", e); }catch(_){}
    }
    return false;
  }

  function poll(){
    if (bound) return;
    if (tryExisting()) return;
    if (scanWindow()) return;
    if (tries >= MAX_TRIES){
      try{ console.warn(LOG_PREFIX, "gave up after", tries, "tries"); }catch(_){}
      return;
    }
    setTimeout(poll, RETRY_MS);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", poll, { once:true });
  } else {
    poll();
  }

  // シーン準備後にも一度だけリトライしておく
  document.addEventListener("lm:scene-ready", () => {
    if (!bound){
      try{ console.log(LOG_PREFIX, "scene-ready => rescan"); }catch(_){}
      tries = 0;
      poll();
    }
  });
})();
