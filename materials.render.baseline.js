// materials.render.baseline.js
// [mat-baseline v1.0] Enforce safe default render state across all materials on scene-ready and GLB load.
// - Prevents "black areas become transparent" by disabling unintended transparency and alpha cutouts.
// - Minimizes z-fighting on transparent materials with depthWrite=false and polygonOffset.
// - Leaves per-material overrides intact (materials.render.apply.js can still toggle unlit/doubleSided).

(() => {
  const TAG = '[mat-baseline v1.0]';
  const log = (...a)=>{ try{ console.log(TAG, ...a);}catch(_){}};

  function getScene(){ return (window.__LM_SCENE || window.scene); }
  function getTHREE(){ return (window.THREE || (window.__LM && window.__LM.THREE)); }

  function normalizeMaterial(mat, THREE_) {
    if (!mat) return;
    // 1) Always start from normal blending
    if (THREE_ && THREE_.NormalBlending != null) {
      mat.blending = THREE_.NormalBlending;
    }
    // 2) Decide transparency
    const chroma = !!(mat.userData && mat.userData.__lm_chromaEnabled);
    const reqTransparent = (mat.opacity ?? 1) < 0.999 || chroma;
    mat.transparent = !!reqTransparent;
    if (!reqTransparent) mat.opacity = 1.0;

    // 3) Do not use alphaMap unless explicitly set by chroma pipeline
    if (!chroma && mat.alphaMap) mat.alphaMap = null;

    // 4) Avoid accidental cutout
    if (!chroma) mat.alphaTest = 0.0;

    // 5) Depth behavior
    if (reqTransparent) {
      mat.depthWrite = false;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 1;
    } else {
      mat.depthWrite = true;
      mat.polygonOffset = false;
      mat.polygonOffsetFactor = 0;
      mat.polygonOffsetUnits = 0;
    }

    // Leave .side and shader (unlit) to the apply module
    mat.needsUpdate = true;
  }

  function runBaseline() {
    const scene = getScene();
    const THREE_ = getTHREE();
    if (!scene || !THREE_) { return false; }

    let mats = 0, meshes = 0;
    scene.traverse(o=>{
      if (!o.isMesh) return;
      meshes++;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      arr.forEach(m=>{ if (m) { normalizeMaterial(m, THREE_); mats++; } });
    });
    log('baseline applied', {meshes, mats});
    return true;
  }

  // Public API for manual re-run (e.g., after a new GLB load)
  window.__LM_MAT_BASELINE__ = runBaseline;

  // Heuristics: run at scene-ready and after GLB detection
  function safeRun() {
    setTimeout(()=>runBaseline(), 0);
    setTimeout(()=>runBaseline(), 250);
    setTimeout(()=>runBaseline(), 1000);
  }

  // 1) On viewer scene-ready if dispatched
  window.addEventListener('lm:scene-ready', safeRun);
  // 2) On our GLB detector (if present)
  window.addEventListener('lm:glb-detected', safeRun);
  // 3) Fallback on DOM ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    safeRun();
  } else {
    window.addEventListener('DOMContentLoaded', safeRun, {once:true});
  }

  log('armed');
})();
