
// viewer.bridge.module.js
// Bridge between viewer (THREE scene) and material orchestrator.
// Exposes window.__LM_MATERIALS__ with keys() and apply().

(function(){
  const log = (...args)=>console.log('[viewer-bridge]', ...args);
  const warn = (...args)=>console.warn('[viewer-bridge]', ...args);

  // State bag
  const BAG = {
    ready: false,
    scene: null,
    materials: new Map(), // key -> material
    lastIndexCount: 0
  };

  function ensureGlobal(){
    if (!window.__LM_MATERIALS__) {
      window.__LM_MATERIALS__ = {
        get ready(){ return BAG.ready; },
        keys(){
          return Array.from(BAG.materials.keys());
        },
        apply(key, opts){
          const mat = BAG.materials.get(key);
          if (!mat) { warn('apply: material not found', key); return false; }
          if (opts && typeof opts.opacity === 'number') {
            mat.transparent = opts.opacity < 1.0 || mat.transparent === true;
            mat.opacity = opts.opacity;
          }
          if (opts && typeof opts.doubleSided === 'boolean') {
            const THREE = window.THREE || (window.__three__ && window.__three__.THREE);
            if (THREE) {
              mat.side = opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
            } else {
              warn('apply: THREE missing for side update');
            }
          }
          if (opts && typeof opts.unlit === 'boolean') {
            // "Unlit-like": kill lighting by pushing everything to emissive
            if ('emissive' in mat) {
              if (opts.unlit) {
                try { mat._lm_prevEmissive = mat.emissive.clone(); } catch(e){}
                mat.emissive.setRGB(1,1,1);
              } else if (mat._lm_prevEmissive) {
                mat.emissive.copy(mat._lm_prevEmissive);
              }
            }
            if ('metalness' in mat && 'roughness' in mat) {
              if (opts.unlit) {
                if (mat._lm_prevMR === undefined) mat._lm_prevMR = {m: mat.metalness, r: mat.roughness};
                mat.metalness = 0.0; mat.roughness = 1.0;
              } else if (mat._lm_prevMR) {
                mat.metalness = mat._lm_prevMR.m; mat.roughness = mat._lm_prevMR.r;
              }
            }
          }
          try { mat.needsUpdate = true; } catch(e){}
          return true;
        }
      };
    }
  }

  function indexMaterials(scene){
    BAG.materials.clear();
    const keys = new Set();
    scene.traverse(obj=>{
      if (obj && obj.isMesh && obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m=> collect(m));
        } else {
          collect(obj.material);
        }
      }
    });
    function collect(m){
      if (!m) return;
      let key = m.name || (m.map && m.map.name) || m.uuid || null;
      if (!key) return;
      if (keys.has(key)) {
        // same key already, keep first
        return;
      }
      keys.add(key);
      BAG.materials.set(key, m);
    }
    BAG.lastIndexCount = BAG.materials.size;
    log('scene indexed', BAG.lastIndexCount, 'materials');
  }

  function tryAttachFromGlobals(){
    const s = window.__lm && window.__lm.scene ? window.__lm.scene : (window.lmScene || null);
    if (s && s.isScene) {
      BAG.scene = s;
      indexMaterials(BAG.scene);
      BAG.ready = true;
      ensureGlobal();
      window.dispatchEvent(new CustomEvent('lm:materials-ready', {detail:{count: BAG.lastIndexCount}}));
      log('materials ready (global hook)', BAG.lastIndexCount);
      return true;
    }
    return false;
  }

  // Event wiring: accept a number of possible events from the viewer
  function onSceneReady(ev){
    const detail = ev && ev.detail || {};
    const scene = detail.scene || detail.root || window.scene || (detail.renderer && detail.renderer.scene) || null;
    const candidate = scene && scene.isScene ? scene : (window.__lm && window.__lm.scene) || null;
    if (!candidate) { warn('lm:scene-ready fired but no scene on detail'); return; }
    BAG.scene = candidate;
    indexMaterials(BAG.scene);
    BAG.ready = true;
    ensureGlobal();
    window.dispatchEvent(new CustomEvent('lm:materials-ready', {detail:{count: BAG.lastIndexCount}}));
    log('materials ready (event)', BAG.lastIndexCount);
  }

  // Bootstrap
  ensureGlobal();
  window.addEventListener('lm:scene-ready', onSceneReady, { once:false });
  // Some builds don't emit the event; poll briefly as a fallback
  let attempts = 0;
  const poll = setInterval(()=>{
    attempts++;
    if (tryAttachFromGlobals() || BAG.ready) { clearInterval(poll); return; }
    if (attempts > 100) { clearInterval(poll); warn('gave up waiting for scene'); }
  }, 100);

  log('bridge loaded');
})();
