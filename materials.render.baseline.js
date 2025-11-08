// materials.render.baseline.js
// v1.2: Global guard to avoid "black turns transparent" & z-fighting on translucent
(function(){
  const TAG='[mat-baseline v1.2]';
  function log(...a){ console.log(TAG, ...a); }

  function applyToScene(scene){
    if (!scene) return;
    let count=0;
    scene.traverse(o=>{
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m=>{
        if (!m) return;
        const transparentBecause = (m.opacity ?? 1) < 0.999 || (!!m.userData && !!m.userData.__lm_chromaEnabled);
        // Only enable transparent when necessary
        m.blending    = (window.THREE?.NormalBlending ?? 1);
        m.transparent = !!transparentBecause;
        if (!transparentBecause) m.opacity = 1.0;

        // Prevent accidental cutout from textures unless chroma is on
        if (!m.userData?.__lm_chromaEnabled) {
          m.alphaTest = 0.0;
          if (m.alphaMap) m.alphaMap = null;
        }

        // Depth behavior for stability
        m.depthTest  = true;
        m.depthWrite = !transparentBecause;
        m.polygonOffset = !!transparentBecause;
        m.polygonOffsetFactor = transparentBecause ? -1 : 0;
        m.polygonOffsetUnits  = transparentBecause ? -1 : 0;

        m.needsUpdate = true;
        count++;
      });
    });
    log('applied to materials:', count);
  }

  // Hook into scene/model lifecycle
  function hook(){
    const scene = window.__LM_SCENE || window.scene;
    if (scene) applyToScene(scene);
  }

  window.addEventListener('lm:scene-ready', e=>applyToScene((e && e.detail && e.detail.scene) || window.__LM_SCENE || window.scene));
  window.addEventListener('lm:model-ready', hook);
  window.addEventListener('lm:mat-apply', hook);
  // Try once after load
  setTimeout(hook, 1000);
  log('armed');
})();
