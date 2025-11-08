// materials.render.apply.js
// [mat-render v1.1] apply per-material runtime shading safely
// - Fixes 'black areas become transparent' by enforcing NormalBlending and conditional transparency
// - Reduces z-fighting on transparent passes using depthWrite=false & polygonOffset
// - Keeps compatibility with existing wire code via window.__LM_MAT_RENDER_APPLY__

(() => {
  const TAG = '[mat-render v1.1]';

  function log(...args){ try{ console.log(TAG, ...args);}catch(_){/*noop*/} }
  function warn(...args){ try{ console.warn(TAG, ...args);}catch(_){/*noop*/} }

  function getScene(){
    return (window.__LM_SCENE || window.scene);
  }

  function collectTargetMaterials(key){
    const scene = getScene();
    if (!scene) return [];
    const hits = [];
    scene.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (!m) return;
        if (m.name === key || o.name === key) hits.push({ mesh: o, mat: m });
      });
    });
    return hits;
  }

  function enforceBlendPolicy(mat){
    const THREE = window.THREE || {};
    const chromaEnabled = !!(mat.userData && mat.userData.__lm_chromaEnabled);
    const needsTransparent = (mat.opacity ?? 1) < 0.999 || chromaEnabled;

    // 1) Always use normal blending (avoid additive-like surprises)
    mat.blending = (THREE.NormalBlending ?? 1);

    // 2) Enable transparency only when needed
    mat.transparent = !!needsTransparent;
    if (!needsTransparent) mat.opacity = 1.0;

    // 3) Avoid accidental cutout/alpha usage unless chroma is on
    if (!chromaEnabled) {
      mat.alphaTest = 0.0;
      if (mat.map) mat.alphaMap = null;
    }

    // 4) Z stability for transparent objects
    mat.depthTest  = true;
    mat.depthWrite = !needsTransparent;      // do not write depth when transparent
    mat.polygonOffset = needsTransparent;    // slightly pull forward transparent pass
    mat.polygonOffsetFactor = needsTransparent ? -1 : 0;
    mat.polygonOffsetUnits  = needsTransparent ? -1 : 0;

    mat.needsUpdate = true;
  }

  function applyStateToMaterial(mat, state){
    // Basic shading toggles driven by UI/state
    if ('doubleSided' in state) mat.side = state.doubleSided ? (window.THREE?.DoubleSide ?? 2) : (window.THREE?.FrontSide ?? 0);
    if ('unlitLike'   in state) mat.colorWrite = true, (mat.emissive && (mat.emissiveIntensity = state.unlitLike ? 1.0 : (mat.emissiveIntensity ?? 0)));
    // Fallback "unlit-like": push everything to emissive if requested
    if ('unlitLike' in state) {
      if (state.unlitLike) {
        // A cheap unlit-like: use MeshBasicMaterial behavior by forcing lighting-independent shading
        // We avoid material swap; instead approximate by disabling lights influence
        mat.lights = false;
      } else {
        mat.lights = true;
      }
    }
    if ('opacity' in state && typeof state.opacity === 'number') mat.opacity = state.opacity;

    enforceBlendPolicy(mat);
  }

  function applyMaterialRender(state){
    // state: { key, opacity, doubleSided, unlitLike }
    const key = state?.key || '';
    if (!key){ warn('missing key'); return 0; }

    const targets = collectTargetMaterials(key);
    if (!targets.length){ warn('no materials found for key', key); return 0; }

    targets.forEach(({mat}) => applyStateToMaterial(mat, state));
    const first = targets[0]?.mat;
    log('applied', {
      key,
      opacity: first?.opacity ?? state.opacity ?? 1,
      doubleSided: !!state.doubleSided,
      unlitLike:   !!state.unlitLike,
      hit: targets.length
    });
    return targets.length;
  }

  // Stable global API used by materials.ui.wire.js
  window.__LM_MAT_RENDER_APPLY__ = applyMaterialRender;

  log('wired');
})();
