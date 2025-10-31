// viewer.bridge.module.js  — robust scene/materials bridge (drop-in)
(function () {
  const NS = '[viewer-bridge]';
  const log = (...a) => console.log(NS, ...a);
  const warn = (...a) => console.warn(NS, ...a);

  // ---- scene discovery -----------------------------------------------------
  function getViewerLike() {
    // Try common handles used by various builds
    return (
      window.__lm_viewer ||
      window.viewer ||
      window.__lm_threeRoot ||
      window.__LM_VIEWER ||
      window.lmViewer ||
      null
    );
  }

  function getScene() {
    const v = getViewerLike();
    if (v && v.scene) return v.scene;

    try {
      if (v && v.renderer && v.renderer.scene) return v.renderer.scene;
      if (v && v.three && v.three.scene) return v.three.scene;
    } catch (_e) {}

    try {
      if (typeof window.__lm_getScene === 'function') {
        const s = window.__lm_getScene();
        if (s) return s;
      }
    } catch (_e) {}

    return null;
  }

  // ---- materials enumeration ----------------------------------------------
  function listMaterialsFromScene(scene) {
    if (!scene) return [];
    const set = new Set();

    function add(mat) {
      if (!mat) return;
      const name =
        (mat.name && String(mat.name).trim()) ||
        (typeof mat.id !== 'undefined' ? `material.${mat.id}` : 'material');
      set.add(name);
    }

    try {
      if (typeof scene.traverse === 'function') {
        scene.traverse((obj) => {
          const m = obj && obj.material;
          if (!m) return;
          if (Array.isArray(m)) m.forEach(add);
          else add(m);
        });
      }
    } catch (_e) {}

    return Array.from(set).sort();
  }

  function listMaterials() {
    return listMaterialsFromScene(getScene());
  }

  // ---- public bridge -------------------------------------------------------
  const api = {
    getScene,
    listMaterials,
    listMaterialsFromScene,
    isReady: () => !!getScene(),
  };

  // Merge onto existing bridge if present
  window.viewerBridge = Object.assign(window.viewerBridge || {}, api);
  window.__lm_viewerBridge = window.viewerBridge;

  // Fire lm:scene-ready exactly once when scene becomes available
  function dispatchSceneReady() {
    try {
      const ev = new CustomEvent('lm:scene-ready', { bubbles: true, composed: true });
      (document || window).dispatchEvent(ev);
      log('lm:scene-ready dispatched (bridge)');
    } catch (_e) {}
  }

  function armSceneReadyWatcher() {
    if (window.__lm_sceneReadyFired) return;
    if (api.isReady()) {
      window.__lm_sceneReadyFired = true;
      dispatchSceneReady();
      return;
    }
    // poll briefly until scene appears
    let tries = 0;
    const max = 50; // ~10s at 200ms
    const iv = setInterval(() => {
      if (api.isReady()) {
        clearInterval(iv);
        if (!window.__lm_sceneReadyFired) {
          window.__lm_sceneReadyFired = true;
          dispatchSceneReady();
        }
      } else if (++tries >= max) {
        clearInterval(iv);
        warn('scene not found during bridge watch (non-fatal)');
      }
    }, 200);
  }

  armSceneReadyWatcher();
  log('bridge installed');
})();