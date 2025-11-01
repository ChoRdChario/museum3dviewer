
/*! viewer.bridge.module.js (sticky-ready) */
(() => {
  const log = (...a) => console.log("[viewer-bridge]", ...a);
  if (window.viewerBridge?.__installed) return;

  const state = {
    scene: null,
    ready: false,
    materials: [],
  };

  // Helper: list materials safely (handles arrays/single, unnamed)
  function listMaterialsFromScene(scene) {
    const mats = new Map();
    if (!scene) return [];
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      const m = obj.material;
      const list = Array.isArray(m) ? m : (m ? [m] : []);
      list.forEach((mat, idx) => {
        if (!mat) return;
        const key = mat.uuid || `${obj.uuid}:${idx}`;
        const name = (mat.name && String(mat.name).trim()) ? String(mat.name) : null;
        if (!mats.has(key)) mats.set(key, { key, name: name || null, material: mat });
      });
    });
    const arr = Array.from(mats.values()).map((m, i) => ({
      key: m.key,
      name: m.name || `(unnamed ${i+1})`,
      ref: m.material
    }));
    return arr;
  }

  // Sticky dispatch
  function dispatchReady() {
    const evName = "lm:scene-ready";
    const payload = { materials: state.materials.map(m => ({ key: m.key, name: m.name })) };
    window.__lm_sceneReady = { at: Date.now(), ...payload };
    log("scene stabilized with", state.materials.length, "meshes");
    document.dispatchEvent(new CustomEvent(evName, { detail: payload }));
  }

  // Poll until scene exists (host provides THREE scene on window.__lm_viewer / getScene)
  function pollSceneUntilReady() {
    let tries = 0;
    const max = 100; // ~10s
    const id = setInterval(() => {
      tries++;
      try {
        const scene = (window.viewer?.scene) || (window.__lm_viewer && window.__lm_viewer.scene) || (window.getScene && window.getScene());
        if (scene && !state.ready) {
          state.scene = scene;
          state.materials = listMaterialsFromScene(scene);
          state.ready = true;
          clearInterval(id);
          dispatchReady();
        }
        if (tries >= max) clearInterval(id);
      } catch (e) {
        // keep polling
      }
    }, 100);
  }

  window.viewerBridge = {
    __installed: true,
    isReady: () => !!state.ready,
    getScene: () => state.scene,
    listMaterials: () => state.materials.map(m => ({ key: m.key, name: m.name, ref: m.ref })),
    waitUntilReady: ({ timeout = 8000 } = {}) => new Promise((resolve, reject) => {
      if (state.ready) return resolve(true);
      const start = Date.now();
      const on = () => {
        document.removeEventListener("lm:scene-ready", on);
        resolve(true);
      };
      document.addEventListener("lm:scene-ready", on, { once: true });
      const t = setInterval(() => {
        if (state.ready) { clearInterval(t); on(); }
        else if (Date.now() - start > timeout) { clearInterval(t); reject(new Error("viewerBridge timeout")); }
      }, 100);
    }),
  };

  pollSceneUntilReady();
})();
