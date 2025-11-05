
// viewer.bridge.module.js — robust scene-ready bridge (v2.0)
(function(){
  const TAG = '[viewer-bridge+]';
  if (window.__viewerBridgePlusInstalled) return;
  window.__viewerBridgePlusInstalled = true;

  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // Ensure namespace
  const lm = (window.lm = window.lm || {});

  // If an upstream bridge already provides getScene, we wrap it; otherwise we expose a placeholder setter.
  let _getScene = (typeof lm.getScene === 'function') ? lm.getScene
                : (typeof window.getScene === 'function') ? window.getScene
                : null;

  // Try to discover a likely scene reference from common globals (best-effort, no throw).
  function sniffScene(){
    try {
      if (typeof _getScene === 'function') {
        return _getScene();
      }
      // common fallbacks
      if (window.viewer && window.viewer.scene) return window.viewer.scene;
      if (window.three && window.three.scene) return window.three.scene;
      if (window.scene) return window.scene;
    } catch(e){ /* ignore */ }
    return null;
  }

  // Expose a setter that upstream viewer can call to register the scene explicitly.
  lm.__setScene = function(scene){
    try {
      lm._sceneRef = scene;
      lm.getScene = _getScene = function(){ return lm._sceneRef || null; };
      window.getScene = window.getScene || lm.getScene;
      log('scene reference registered via __setScene');
    } catch(e){
      warn('failed to set scene', e);
    }
  };

  // Ensure getScene exists (even if currently returning null); upstream can swap later.
  if (!_getScene) {
    lm.getScene = function(){ return lm._sceneRef || sniffScene(); };
    window.getScene = window.getScene || lm.getScene;
    _getScene = lm.getScene;
    log('getScene exposed (lazy/sniff)');
  } else {
    lm.getScene = _getScene;
    window.getScene = window.getScene || _getScene;
    log('getScene exposed (wrap upstream)');
  }

  // A single promise that resolves once the scene truly has materials.
  if (!lm.readyScenePromise) {
    let resolve, reject;
    lm.readyScenePromise = new Promise((res, rej)=>{ resolve = res; reject = rej; });
    lm.__resolveReadyScene = resolve;
    lm.__rejectReadyScene  = reject;
  }

  // Helper to test if a THREE.Scene is "ready enough" (has at least one mesh with a material).
  function sceneHasMaterials(scene){
    if (!scene || !scene.traverse) return false;
    let ok = false;
    try {
      scene.traverse(obj=>{
        if (ok) return;
        const m = obj && obj.material;
        if (!m) return;
        if (Array.isArray(m)) { if (m.some(x=>!!x)) ok = true; }
        else if (m) ok = true;
      });
    } catch(e){ /* ignore */ }
    return ok;
  }

  // Polling loop with backoff + event hooks, resolves once materials exist.
  (function monitorSceneReady(){
    const start = performance.now();
    const hardTimeout = 20000; // 20s max
    let tries = 0;
    let rafId = 0;

    function tick(){
      tries++;
      const scene = _getScene ? _getScene() : sniffScene();
      if (scene && sceneHasMaterials(scene)) {
        if (!lm._sceneRef) lm._sceneRef = scene;
        try {
          lm.__resolveReadyScene && lm.__resolveReadyScene(scene);
          window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', {detail:{scene}}));
        } catch(e){}
        log('scene ready (materials present), tries=', tries);
        return; // stop
      }
      const elapsed = performance.now() - start;
      if (elapsed >= hardTimeout) {
        try { lm.__rejectReadyScene && lm.__rejectReadyScene(new Error('scene not ready (timeout)')); } catch(e){}
        warn('scene not ready (timeout). tries=', tries);
        return;
      }
      // backoff: rAF for first ~60 frames, then 100ms setTimeout
      if (tries < 60) {
        rafId = requestAnimationFrame(tick);
      } else {
        setTimeout(tick, 100);
      }
    }

    // Also try to react to common viewer events
    ['lm:scene-ready','lm:scene-stable','lm:viewer-ready','load'].forEach(ev=>{
      window.addEventListener(ev, ()=>{ setTimeout(()=>{ 
        if (!lm.__readySignalled) { tick(); }
      }, 10); }, { once:false });
    });

    tick(); // start
  })();

  log('ready bridge installed');
})();
