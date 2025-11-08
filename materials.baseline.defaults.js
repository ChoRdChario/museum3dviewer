// materials.baseline.defaults.js
// v1.0 — Global baseline to prevent accidental transparency / z-fighting artifacts
// Applies safe defaults to *all* materials in the scene, at load and on future additions.
// Logs with prefix: [mat-baseline v1.0]

(function(){
  const TAG = '[mat-baseline v1.0]';

  function getTHREE() {
    return window.THREE || (window.__LM_SCENE && window.__LM_SCENE.renderer && window.__LM_SCENE.renderer.THREE) || null;
  }

  function isTransparentNeeded(mat){
    const chroma = !!(mat && mat.userData && mat.userData.__lm_chromaEnabled);
    const op = (mat && typeof mat.opacity === 'number') ? mat.opacity : 1.0;
    return chroma || (op < 0.999);
  }

  function normalizeMaterial(mat){
    const THREE = getTHREE();
    if (!THREE || !mat) return;

    // 1) Opaque by default
    mat.blending   = THREE.NormalBlending;
    const needsTransparent = isTransparentNeeded(mat);
    mat.transparent = !!needsTransparent;
    if (!needsTransparent) mat.opacity = 1.0;

    // 2) Alpha handling
    // If chroma key is OFF, do not cut-out by alpha and don't use alphaMap.
    if (!mat.userData?.__lm_chromaEnabled) {
      mat.alphaTest = 0.0;
      if (mat.alphaMap) mat.alphaMap = null;
    }

    // 3) Depth behavior
    mat.depthTest  = true;
    mat.depthWrite = !needsTransparent; // disable when transparent to reduce flicker

    // 4) Transparent polygon offset to reduce z-fighting
    if (needsTransparent) {
      mat.polygonOffset = true;
      // Slight pull toward camera to avoid coplanar flicker; tune as needed
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits  = -1;
    } else {
      mat.polygonOffset = false;
      mat.polygonOffsetFactor = 0;
      mat.polygonOffsetUnits  = 0;
    }

    // 5) Safety
    // Some exporters set .alphaToCoverage / .premultipliedAlpha flags; we keep renderer defaults.
    // Ensure update
    mat.needsUpdate = true;
  }

  function sweep(root){
    if (!root) return;
    let count = 0, meshes = 0;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      meshes++;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { if (m) { normalizeMaterial(m); count++; } });
    });
    console.log(TAG, 'sweep normalized', count, 'materials on', meshes, 'meshes');
  }

  // Hook: when the scene is ready / model is ready — apply once
  function trySweepFromEvent(detail){
    const scene = (detail && (detail.scene || detail.root)) || window.__LM_SCENE || window.scene;
    if (scene) sweep(scene);
  }

  window.addEventListener('lm:scene-ready', (e)=> trySweepFromEvent(e.detail));
  window.addEventListener('lm:model-ready', (e)=> trySweepFromEvent(e.detail));
  window.addEventListener('lm:post-load',   (e)=> trySweepFromEvent(e.detail));

  // Hook: future additions — monkey-patch Object3D.add once
  if (!window.__LM_BASELINE_PATCHED__) {
    window.__LM_BASELINE_PATCHED__ = true;
    const THREE = getTHREE();
    if (THREE && THREE.Object3D) {
      const origAdd = THREE.Object3D.prototype.add;
      THREE.Object3D.prototype.add = function(...args){
        const r = origAdd.apply(this, args);
        // Normalize any materials on added subtree
        args.forEach(node => { if (node && node.traverse) sweep(node); });
        return r;
      };
      console.log(TAG, 'installed Object3D.add sweep hook');
    } else {
      console.log(TAG, 'THREE not ready at install; hooks will rely on events only');
    }
  }

  // If scene already exists (hot reload case), sweep once
  if (window.__LM_SCENE || window.scene) {
    sweep(window.__LM_SCENE || window.scene);
  }

  console.log(TAG, 'ready');
})();
