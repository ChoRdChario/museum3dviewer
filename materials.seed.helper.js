
/*! materials.seed.helper.js
 * Tries to locate a THREE.Scene from common globals and registers it
 * into LM_Materials automatically. Also shows a fallback "Scan from model"
 * button in the Material tab if not present.
 */
(function () {
  function ensureScanButton() {
    if (document.getElementById('scanMaterials')) return;
    // Find Material tab container heuristically
    const tab = document.querySelector('[data-tab="material"], #materialTab, .material-tab, .mat-tab') ||
                document.querySelector('.tabs') || document.body;
    const btn = document.createElement('button');
    btn.id = 'scanMaterials';
    btn.textContent = 'Scan from model';
    btn.style.margin = '8px 0';
    btn.className = 'btn btn--ghost';
    tab.appendChild(btn);
    btn.addEventListener('click', tryRegisterOnce);
  }

  function findScene() {
    // Try a few common places
    // 1) window.scene
    if (window.scene && typeof window.scene.traverse === 'function') return window.scene;
    // 2) gltf.scene
    if (window.gltf && window.gltf.scene) return window.gltf.scene;
    // 3) viewer-like wrappers
    if (window.viewer) {
      if (typeof window.viewer.getScene === 'function') {
        try { const s = window.viewer.getScene(); if (s) return s; } catch {}
      }
      if (window.viewer.scene) return window.viewer.scene;
      if (window.viewer.three?.scene) return window.viewer.three.scene;
    }
    // 4) last resort: look for WebGLRenderer with scene ref
    for (const k of Object.keys(window)) {
      const v = window[k];
      if (v && v.isScene && typeof v.traverse === 'function') return v;
    }
    return null;
  }

  function tryRegisterOnce() {
    if (!window.LM_Materials) return;
    const s = findScene();
    if (s) {
      window.LM_Materials.registerScene(s);
      return true;
    }
    return false;
  }

  ensureScanButton();

  // Poll a bit on startup
  let tries = 0;
  const timer = setInterval(() => {
    if (tryRegisterOnce()) { clearInterval(timer); }
    if (++tries > 50) clearInterval(timer); // ~5s
  }, 100);
})();
