
/* viewer.bridge.module.js — ensure getScene() is available */
(function(){
  const g = window.viewerBridge = window.viewerBridge || {};
  if (!g.getScene) {
    // Try to infer from common globals if available
    g.getScene = function(){
      if (g.scene) return g.scene;
      if (window.__THREE_SCENE__) return window.__THREE_SCENE__;
      try { return window.app?.viewer?.scene || null; } catch(e){}
      return null;
    };
  }
  console.log('[viewer-bridge] ready (getScene exposed)');
})();
