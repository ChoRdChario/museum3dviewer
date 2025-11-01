// viewer.bridge.module.js
// Robust listMaterials: names for unnamed materials.
// Keeps existing getScene and event wiring pattern minimal and non-breaking.

(() => {
  let _scene = null;

  // Expose a setter only if not already provided by existing loader logic.
  // (If your loader already sets window.viewerBridge.setScene, this block is harmless.)
  if (!window.viewerBridge) window.viewerBridge = {};

  // Consumers call this after GLB load; keep for compatibility if needed.
  if (!window.viewerBridge.setScene) {
    window.viewerBridge.setScene = function setScene(scene) {
      _scene = scene;
      if (_scene) {
        const ev = new Event('lm:scene-ready');
        window.dispatchEvent(ev);
      }
    };
  } else {
    // If someone else defines setScene and stores scene internally,
    // we still mirror it if they dispatch lm:scene-ready.
    // getScene below will fall back to existing API if available.
  }

  function getScene() {
    if (window.viewerBridge && typeof window.viewerBridge._getInternalScene === 'function') {
      try { return window.viewerBridge._getInternalScene(); } catch (_e) {}
    }
    return _scene;
  }

  function listMaterials() {
    const scene = getScene();
    if (!scene) return [];

    const found = new Map();
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      let mats = obj.material;
      if (!mats) return;
      mats = Array.isArray(mats) ? mats : [mats];

      mats.forEach((mat, idx) => {
        if (!mat) return;
        const key = mat.uuid;               // stable unique key for a material instance
        if (found.has(key)) return;

        // Build a robust, human-friendly display name
        const meshName = (obj.name && String(obj.name).trim()) ? String(obj.name).trim() : 'Mesh';
        let name = (mat.name && String(mat.name).trim()) ? String(mat.name).trim() : '';
        if (!name && mat.userData && typeof mat.userData.name === 'string' && mat.userData.name.trim()) {
          name = mat.userData.name.trim();
        }
        if (!name) {
          name = (mats.length > 1) ? `${meshName} [${idx}]` : meshName;
        }

        found.set(key, { key, name, mesh: meshName, index: idx });
      });
    });

    return Array.from(found.values());
  }

  // Publish API (non-breaking merge)
  Object.assign(window.viewerBridge, {
    getScene,
    listMaterials,
  });
})();
