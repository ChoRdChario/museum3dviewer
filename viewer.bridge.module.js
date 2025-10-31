/**
 * viewer.bridge.module.js
 * Provide a stable external bridge to the viewer's three.js Scene and materials.
 * - Exposes: window.viewerBridge.getScene(), listMaterials()
 * - Emits:   window 'lm:scene-ready' when a non-empty scene stabilizes
 */
(() => {
  const VBNS = 'viewer-bridge';
  const log  = (...a)=>console.log(`[${VBNS}]`, ...a);
  const warn = (...a)=>console.warn(`[${VBNS}]`, ...a);

  const vb = (window.viewerBridge = window.viewerBridge || {});
  vb.__scene = vb.__scene || null;

  function firstSceneCandidate() {
    if (vb.__scene)                 return vb.__scene;
    if (window.__LM_SCENE)          return window.__LM_SCENE;
    if (window.__viewer?.scene)     return window.__viewer.scene;
    if (window.viewer?.scene)       return window.viewer.scene;
    if (window.lm?.scene)           return window.lm.scene;
    return null;
  }

  // stable getters
  if (typeof vb.getScene !== 'function') {
    vb.getScene = () => (vb.__scene || firstSceneCandidate());
  }

  if (typeof vb.listMaterials !== 'function') {
    vb.listMaterials = () => {
      const scene = vb.getScene();
      const set = new Set();
      scene?.traverse(o => {
        const m = o.material;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach(mm => {
          if (mm && mm.name) set.add(mm.name);
        });
      });
      return Array.from(set);
    };
  }

  // cache any incoming scene-ready
  const cacheSceneFromDetail = (ev) => {
    const sc = ev?.detail?.scene;
    if (sc && sc !== vb.__scene) {
      vb.__scene = sc;
      log('scene cached from lm:scene-ready');
    }
  };
  window.addEventListener('lm:scene-ready', cacheSceneFromDetail);
  document.addEventListener('lm:scene-ready', cacheSceneFromDetail);

  // Poll until the scene stabilizes (meshes count stops changing).
  (function pollSceneUntilReady(){
    let lastCount = -1;
    let stable = 0;
    let fired = false;
    const maxMs = 30000;
    const start = Date.now();

    const iv = setInterval(() => {
      const sc = firstSceneCandidate();
      if (sc) vb.__scene = sc;

      let cnt = 0;
      (vb.__scene || sc)?.traverse(o => { if (o.isMesh) cnt++; });

      if (cnt > 0 && cnt === lastCount) {
        stable++;
      } else {
        stable = 0;
      }
      lastCount = cnt;

      if (!fired && cnt > 0 && stable >= 3) {
        fired = true;
        clearInterval(iv);
        try {
          window.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { from: 'bridge-poll', meshCount: cnt, scene: vb.__scene || sc } }));
          log('lm:scene-ready dispatched (bridge-poll), meshes=', cnt);
        } catch(e) { warn('dispatch failed', e); }
      }

      if (Date.now() - start > maxMs) {
        clearInterval(iv);
        if (!fired) warn('scene did not stabilize within timeout');
      }
    }, 300);
  })();
})();