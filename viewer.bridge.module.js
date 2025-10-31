// viewer.bridge.module.js
// Exposes window.viewerBridge with helpers to access the three.js scene and list materials.
(() => {
  const log = (...a)=>console.log('[viewer-bridge]', ...a);

  let cachedScene = null;

  function getScene() {
    if (cachedScene) return cachedScene;
    // Common globals the app may expose
    const s = (window.__viewer && window.__viewer.scene)
           || (window.viewer && window.viewer.scene)
           || (window.lm && window.lm.scene)
           || null;
    if (s) cachedScene = s;
    return s;
  }

  // Poll once in a while until a scene appears (helps slower GLB loads)
  (function pollScene(){
    const iv = setInterval(() => {
      const s = getScene();
      if (s) {
        clearInterval(iv);
        log('scene captured via poll');
        window.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { when: Date.now() } }));
      }
    }, 250);
    setTimeout(()=>clearInterval(iv), 15000);
  })();

  function listMaterials() {
    const scene = getScene();
    if (!scene) return [];
    const names = new Set();
    scene.traverse(obj => {
      const m = obj.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(mm => {
        if (mm && typeof mm.name === 'string' && mm.name) names.add(mm.name);
      });
    });
    return Array.from(names);
  }

  window.viewerBridge = { getScene, listMaterials };
})();