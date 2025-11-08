
// materials.render.apply.js
// type: module
import * as THREE from 'three';

(function(){
  const LOG = (...args)=>console.log('[mat-render v1.0]', ...args);
  const WARN = (...args)=>console.warn('[mat-render v1.0]', ...args);

  function getScene() {
    // Expect window.__LM_SCENE from viewer bridge; fallback to search
    const s = (window.__LM_SCENE && (window.__LM_SCENE.scene || window.__LM_SCENE));
    if (s) return s;
    // Try common places
    if (window.viewer && window.viewer.scene) return window.viewer.scene;
    return null;
  }

  function forEachMaterial(scene, cb){
    if (!scene) return;
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      const mat = obj.material;
      if (Array.isArray(mat)) {
        mat.forEach((m, idx)=> m && cb(obj, m, idx));
      } else if (mat) {
        cb(obj, mat, null);
      }
    });
  }

  function matchesKey(mat, key){
    if (!key) return false;
    return (mat.name === key) || (String(mat.name||'').endsWith(key)) || (String(mat.userData?.key||'') === key);
  }

  function ensureTransparent(material, opacity){
    const op = (typeof opacity === 'number') ? opacity : material.opacity;
    material.transparent = (op < 1) || material.transparent === true;
    material.opacity = op;
  }

  function toUnlit(obj, mat, idx){
    if (mat && (mat instanceof THREE.MeshBasicMaterial)) return mat; // already unlit
    if (mat && mat.userData && mat.userData._origLit) return mat; // already swapped

    const params = {
      name: mat.name,
      map: mat.map || null,
      alphaMap: mat.alphaMap || null,
      color: (mat.color ? mat.color.clone() : new THREE.Color(0xffffff)),
      side: mat.side,
      transparent: mat.transparent,
      opacity: mat.opacity,
      depthWrite: mat.depthWrite,
      depthTest: mat.depthTest,
      wireframe: mat.wireframe,
      blending: mat.blending
    };
    const basic = new THREE.MeshBasicMaterial(params);
    basic.userData._origLit = mat;
    if (idx == null) obj.material = basic;
    else {
      const arr = obj.material.slice();
      arr[idx] = basic;
      obj.material = arr;
    }
    basic.needsUpdate = true;
    return basic;
  }

  function toLit(obj, mat, idx){
    const orig = mat?.userData?._origLit;
    if (!orig) return mat;
    if (idx == null) obj.material = orig;
    else {
      const arr = obj.material.slice();
      arr[idx] = orig;
      obj.material = arr;
    }
    orig.needsUpdate = true;
    return orig;
  }

  function applyFlags({key, opacity, doubleSided, unlitLike}){
    const scene = getScene();
    if (!scene) {
      WARN('no scene yet; defer');
      return;
    }
    let hit = 0;
    forEachMaterial(scene, (obj, mat, idx)=>{
      if (!matchesKey(mat, key)) return;
      let target = mat;
      if (unlitLike === true) {
        target = toUnlit(obj, mat, idx);
      } else if (unlitLike === false) {
        target = toLit(obj, mat, idx);
      }
      if (typeof doubleSided === 'boolean') {
        target.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      }
      if (typeof opacity === 'number' && !isNaN(opacity)) {
        ensureTransparent(target, opacity);
      }
      target.needsUpdate = true;
      obj.layers.needsUpdate = true;
      hit++;
    });
    LOG('applied', {key, opacity, doubleSided, unlitLike, hit});
  }

  function currentUIState(){
    const sel = document.querySelector('#pm-material');
    const rng = document.querySelector('#pm-opacity-range');
    const ds  = document.querySelector('#pm-flag-doublesided');
    const ul  = document.querySelector('#pm-flag-unlit');
    const key = sel?.value || sel?.selectedOptions?.[0]?.value || '';
    const opacity = rng ? parseFloat(rng.value) : undefined;
    const doubleSided = ds ? !!ds.checked : undefined;
    const unlitLike   = ul ? !!ul.checked : undefined;
    return {key, opacity, doubleSided, unlitLike};
  }

  function wireUI(){
    const sel = document.querySelector('#pm-material');
    const rng = document.querySelector('#pm-opacity-range');
    const ds  = document.querySelector('#pm-flag-doublesided');
    const ul  = document.querySelector('#pm-flag-unlit');
    if (!sel || !rng) { WARN('ui incomplete'); return; }

    let t;
    const fire = ()=>{
      clearTimeout(t);
      t = setTimeout(()=> applyFlags(currentUIState()), 60);
    };

    ['change','input','pointerup'].forEach(ev=> rng.addEventListener(ev, fire, {passive:true}));
    ['change'].forEach(ev=> sel.addEventListener(ev, fire, {passive:true}));
    if (ds) ds.addEventListener('change', fire, {passive:true});
    if (ul) ul.addEventListener('change', fire, {passive:true});

    // Also apply when scene becomes ready
    window.addEventListener('lm:scene-ready', fire);
    window.addEventListener('lm:mat-ui-ready', fire);
    // Initial kick (may no-op if scene not ready yet)
    setTimeout(fire, 200);
    LOG('wired');
  }

  // Public API for other modules
  window.__LM_MAT_RENDER = { apply: applyFlags };

  // Try wiring after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUI, {once:true});
  } else {
    wireUI();
  }
})();
