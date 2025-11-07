// viewer.bridge.addon.js — minimal, non-invasive bridge to match orchestrator expectations
(() => {
  const TAG='[viewer-bridge:addon]';
  const log=(...a)=>console.log(TAG, ...a);

  // Respect existing object; add only missing members
  const vb = (window.viewerBridge = window.viewerBridge || {});

  // 1) Unified material listing
  if (typeof vb.getMaterialKeys !== 'function') {
    vb.getMaterialKeys = async () => {
      // Prefer existing helper if present
      if (typeof window.listMaterials === 'function') {
        const arr = window.listMaterials() || [];
        const keys = arr.map(x => x?.name ?? x?.materialKey).filter(Boolean);
        // uniq + sort
        return Array.from(new Set(keys)).sort((a,b)=>a.localeCompare(b,'ja'));
      }
      // Fallback: direct scene traversal
      const scene =
        window.__LM_SCENE ||
        window.__lm_scene  ||
        window.viewer?.scene ||
        (typeof window.getScene === 'function' ? window.getScene() : null);

      const keys = new Set();
      try {
        scene?.traverse?.(o => {
          if (!o?.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of mats) {
            const n = (m?.name || '').trim();
            if (!n) continue;
            // Keep generated names too; user may rename later
            keys.add(n);
          }
        });
      } catch {}
      return Array.from(keys).sort((a,b)=>a.localeCompare(b,'ja'));
    };
    log('getMaterialKeys added');
  }

  // 2) Opacity setter expected by orchestrator
  if (typeof vb.setMaterialOpacity !== 'function') {
    vb.setMaterialOpacity = (key, value) => {
      const scene =
        window.__LM_SCENE ||
        window.__lm_scene  ||
        window.viewer?.scene ||
        (typeof window.getScene === 'function' ? window.getScene() : null);

      if (!scene || !key) return;
      try {
        scene.traverse(o => {
          if (!o?.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of mats) {
            if (!m || m.name !== key) continue;
            if ('opacity' in m) m.opacity = value;
            if ('transparent' in m) m.transparent = value < 1.0 || m.transparent;
            if ('needsUpdate' in m) m.needsUpdate = true;
          }
        });
        log('setMaterialOpacity done for', key, value);
      } catch {}
    };
    log('setMaterialOpacity added');
  }

  // 3) (Optional) expose a small debug helper
  if (typeof vb.debugListMaterials !== 'function') {
    vb.debugListMaterials = async () => {
      const keys = await vb.getMaterialKeys();
      console.table(keys.map(k => ({key:k})));
      return keys;
    };
  }
})();