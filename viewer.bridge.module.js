
/* viewer.bridge.module.js
 * LociMyu - Viewer Bridge (scene access + material listing + stability poll)
 * Provides:
 *   - window.viewerBridge.getScene(): THREE.Scene | null
 *   - window.viewerBridge.listMaterials(): string[]
 * Emits:
 *   - window 'lm:scene-ready' when scene is stable (as a safety)
 */
(function(){
  const log  = (...a)=>console.log('[viewer-bridge]', ...a);
  const warn = (...a)=>console.warn('[viewer-bridge]', ...a);

  if (!window.viewerBridge) window.viewerBridge = {};
  const vb = window.viewerBridge;

  function pickSceneCandidate(){
    try {
      if (vb.__scene && typeof vb.__scene === 'object') return vb.__scene;
    } catch(e){}
    try {
      if (typeof vb.getScene === 'function') {
        const s = vb.getScene();
        if (s) return s;
      }
    } catch(e){}
    if (window.__LM_SCENE) return window.__LM_SCENE;
    if (window.__viewer?.scene) return window.__viewer.scene;
    if (window.viewer?.scene)   return window.viewer.scene;
    if (window.lm?.scene)       return window.lm.scene;
    return null;
  }

  vb.getScene = function(){
    const s = pickSceneCandidate();
    if (s) vb.__scene = s;
    return s;
  };

  vb.listMaterials = function(){
    const sc = vb.getScene();
    const set = new Set();
    if (!sc) return [];
    try {
      sc.traverse(o => {
        const m = o.material; if (!m) return;
        (Array.isArray(m)?m:[m]).forEach(mm => { if (mm?.name) set.add(mm.name); });
      });
    } catch(e){ warn('traverse failed', e); }
    return Array.from(set);
  };

  // Safety: poll until scene has a stable mesh count and fire lm:scene-ready
  (function pollSceneUntilReady(){
    let last = -1, stable = 0;
    const iv = setInterval(() => {
      const sc = vb.getScene();
      if (!sc) return;
      let cnt = 0;
      sc.traverse(o => { if (o && o.isMesh) cnt++; });
      if (cnt > 0 && cnt === last) {
        stable++;
        if (stable >= 3) {
          clearInterval(iv);
          log('scene stabilized with', cnt, 'meshes');
          try { window.dispatchEvent(new CustomEvent('lm:scene-ready', { detail:{ from:'bridge-poll', meshCount: cnt } })); } catch(e){}
        }
      } else {
        stable = 0;
      }
      last = cnt;
    }, 300);
    setTimeout(() => clearInterval(iv), 30000);
  })();

  log('bridge installed');
})();
