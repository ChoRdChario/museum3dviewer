// viewer.bridge.adapter.js
// Adds window.viewerBridge.getMaterialKeys() if not present.
// Keeps existing APIs intact.
(function(){
  if (!window.viewerBridge) window.viewerBridge = {};
  if (window.viewerBridge.getMaterialKeys) return;

  window.viewerBridge.getMaterialKeys = async function getMaterialKeys(){
    // Prefer listMaterials() if available
    try {
      if (typeof window.listMaterials === 'function') {
        const list = window.listMaterials() || [];
        const keys = list.map(it => it?.name || it?.materialKey).filter(Boolean);
        return Array.from(new Set(keys)).sort();
      }
    } catch (e) {
      console.warn('[viewer-bridge] listMaterials failed', e);
    }

    // Fallback: traverse scene for material names
    try {
      const scene = window.__LM_SCENE || (window.viewer && window.viewer.scene);
      const set = new Set();
      if (scene && typeof scene.traverse === 'function') {
        scene.traverse(obj => {
          const mats = obj && obj.material
            ? (Array.isArray(obj.material) ? obj.material : [obj.material])
            : [];
          mats.forEach(m => m && m.name && set.add(m.name));
        });
      }
      return Array.from(set).sort();
    } catch (e) {
      console.warn('[viewer-bridge] traverse failed', e);
      return [];
    }
  };
})();