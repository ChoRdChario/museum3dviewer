
// viewer.bridge.module.js  V6_15b  (scene stabilize -> lm:scene-ready)
(() => {
  const log = (...a)=>console.log('[viewer-bridge]', ...a);

  function getSceneCandidate(){
    if (window.viewerBridge?.__scene) return window.viewerBridge.__scene;
    if (window.__LM_SCENE) return window.__LM_SCENE;
    if (window.__viewer?.scene) return window.__viewer.scene;
    if (window.viewer?.scene) return window.viewer.scene;
    if (window.lm?.scene) return window.lm.scene;
    return null;
  }

  const vb = window.viewerBridge = window.viewerBridge || {};

  vb.getScene = vb.getScene || (() => {
    const sc = getSceneCandidate();
    if (sc && !vb.__scene) vb.__scene = sc;
    return vb.__scene || sc || null;
  });

  vb.listMaterials = vb.listMaterials || (() => {
    const sc = vb.getScene();
    const set = new Set();
    sc?.traverse(o => {
      const m = o.material; if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(mm => { if (mm?.name) set.add(mm.name); });
    });
    return Array.from(set);
  });

  // Poll until mesh count stabilizes once after GLB load
  (function pollSceneUntilReady(){
    let last = -1, stable = 0, ticks = 0;
    const iv = setInterval(() => {
      const sc = vb.getScene();
      let meshes = 0;
      sc?.traverse(o => { if (o.isMesh) meshes++; });
      if (meshes>0 && meshes===last) stable++; else stable=0;
      last = meshes;
      if (stable>=2) {
        clearInterval(iv);
        log('scene stabilized with', meshes, 'meshes');
        window.dispatchEvent(new CustomEvent('lm:scene-ready', {detail:{from:'bridge-stable', meshCount:meshes}}));
      }
      ticks++; if (ticks>150) clearInterval(iv);
    }, 200);
  })();
})();
