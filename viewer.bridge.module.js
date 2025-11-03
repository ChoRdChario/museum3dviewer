/* viewer.bridge.module.js  — drop-in replacement
 * Provides window.__LM_MATERIALS__ to index materials and apply opacity/doubleSided/unlit-like.
 * Safe, non-destructive: no material class swaps.
 */
(function () {
  const bus = window;
  const S = { byKey: new Map(), scene: null, three: window.THREE, ready: false };

  function indexMaterials(scene) {
    try {
      S.byKey.clear();
      scene.traverse(obj => {
        const m = obj.material;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach(mat => {
          const key = (mat.name || '').trim();
          if (!key) return;
          if (!S.byKey.has(key)) S.byKey.set(key, new Set());
          S.byKey.get(key).add(mat);
          // remember original states once
          if (mat && mat.userData) {
            if (mat.userData.__lm_original_side === undefined) mat.userData.__lm_original_side = mat.side;
            if (mat.userData.__lm_original_tonemap === undefined) mat.userData.__lm_original_tonemap = (typeof mat.toneMapped === "boolean" ? mat.toneMapped : true);
          }
        });
      });
      S.ready = true;
      console.log('[viewer-bridge] indexed materials', S.byKey.size);
    } catch (e) {
      console.warn('[viewer-bridge] indexMaterials failed', e);
    }
  }

  function ensureSceneFrom(e) {
    return e?.detail?.scene || (window.__LM_VIEWER__ && window.__LM_VIEWER__.scene) || window.scene || null;
  }

  bus.addEventListener('lm:scene-ready', (e) => {
    const scene = ensureSceneFrom(e);
    if (scene) {
      S.scene = scene;
      indexMaterials(scene);
    } else {
      console.warn('[viewer-bridge] lm:scene-ready received but scene missing');
    }
  });

  // Fallback: try to index once after load if a global scene is present
  setTimeout(() => {
    if (!S.ready && (window.__LM_VIEWER__?.scene || window.scene)) {
      indexMaterials(window.__LM_VIEWER__?.scene || window.scene);
    }
  }, 1500);

  window.__LM_MATERIALS__ = {
    ready: () => !!S.ready,
    keys: () => [...S.byKey.keys()],
    has: (key) => S.byKey.has(key),
    apply: (key, props = {}) => {
      const set = S.byKey.get(key);
      if (!set) return false;

      set.forEach(mat => {
        if (!mat) return;
        if ("opacity" in props) {
          let o = props.opacity;
          if (typeof o !== "number" || !(o >= 0 && o <= 1)) o = 1;
          mat.opacity = o;
          mat.transparent = o < 1 ? true : mat.transparent;
          // reduce artifacts when transparent
          mat.depthWrite = o >= 1;
        }
        if ("doubleSided" in props) {
          const ds = !!props.doubleSided;
          const THREE = S.three || window.THREE;
          if (THREE) {
            mat.side = ds ? THREE.DoubleSide : THREE.FrontSide;
          }
          mat.needsUpdate = true;
        }
        if ("unlit" in props) {
          const unlit = !!props.unlit;
          if (typeof mat.toneMapped === "boolean") mat.toneMapped = !unlit;
          if (mat.emissive) {
            try { mat.emissiveIntensity = unlit ? 1.0 : 0.0; } catch {}
          }
          mat.needsUpdate = true;
        }
      });
      window.dispatchEvent(new CustomEvent('lm:render-request'));
      return true;
    }
  };
})();
