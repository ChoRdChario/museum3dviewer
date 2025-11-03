/* viewer.bridge.module.js
 * Bridge that exposes window.__LM_MATERIALS__ once the THREE.js scene is ready.
 * It listens for "lm:scene-ready" and indexes materials by material.name.
 */
(function(){
  const log = (...args)=>console.log('[viewer-bridge]', ...args);
  const warn = (...args)=>console.warn('[viewer-bridge]', ...args);

  const state = {
    scene: null,
    materialsByKey: new Map(),
    ready: false,
    THREE: null,
  };

  // Public API
  const API = {
    /**
     * @returns {string[]} material keys currently known
     */
    keys(){
      return Array.from(state.materialsByKey.keys());
    },
    /**
     * Apply properties to all materials that share the given key (name)
     * @param {string} key
     * @param {{opacity?:number,doubleSided?:boolean,unlit?:boolean}} opts
     */
    apply(key, opts = {}){
      const set = state.materialsByKey.get(key);
      if(!set || !set.size){ return false; }
      set.forEach(mat => {
        if (typeof opts.opacity === 'number') {
          try {
            mat.opacity = opts.opacity;
            mat.transparent = opts.opacity < 1.0 || mat.transparent;
            // To reduce z-fighting when transparent
            mat.depthWrite = opts.opacity >= 1.0;
            mat.needsUpdate = true;
          } catch(e){ warn('opacity apply failed', e); }
        }
        if (typeof opts.doubleSided === 'boolean' && state.THREE) {
          try {
            mat.side = opts.doubleSided ? state.THREE.DoubleSide : state.THREE.FrontSide;
            mat.needsUpdate = true;
          } catch(e){ warn('doubleSided apply failed', e); }
        }
        if (typeof opts.unlit === 'boolean') {
          try {
            // Light-insensitive-ish look without swapping shader
            if ('toneMapped' in mat) mat.toneMapped = !opts.unlit ? true : false;
            if (mat.emissive && 'setScalar' in mat.emissive) {
              // add small emissive when unlit
              mat.emissiveIntensity = opts.unlit ? 0.6 : 0.0;
            }
            mat.needsUpdate = true;
          } catch(e){ warn('unlit apply failed', e); }
        }
      });
      // Ask renderer (if any) to render next frame
      try {
        window.dispatchEvent(new CustomEvent('lm:render-request'));
      } catch(e){}
      return true;
    },
    get ready(){ return state.ready; }
  };

  function indexScene(scene){
    state.materialsByKey.clear();
    const seen = new Set();
    scene.traverse(obj=>{
      // Mesh or SkinnedMesh etc.
      if (obj && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m=>{
          if (!m) return;
          if (seen.has(m)) return;
          seen.add(m);
          const key = (m.name || 'material').trim();
          if (!state.materialsByKey.has(key)) state.materialsByKey.set(key, new Set());
          state.materialsByKey.get(key).add(m);
        });
      }
    });
    log('scene stabilized with', [...state.materialsByKey.values()].reduce((a,s)=>a+s.size,0), 'materials across', state.materialsByKey.size, 'keys');
    state.ready = true;
  }

  function handleSceneReady(e){
    // Try to get THREE from global if present
    state.THREE = window.THREE || state.THREE;
    const detail = (e && e.detail) || {};
    const scene = detail.scene || window.__LM_SCENE__ || null;
    if (!scene || typeof scene.traverse !== 'function') {
      warn('scene-ready received but no scene to index');
      return;
    }
    state.scene = scene;
    indexScene(scene);
  }

  // Expose API immediately (incomplete until scene indexed)
  if (!window.__LM_MATERIALS__) {
    Object.defineProperty(window, '__LM_MATERIALS__', { value: API, configurable: false, enumerable: false, writable: false });
  } else {
    // merge minimal for safety
    window.__LM_MATERIALS__.keys = API.keys;
    window.__LM_MATERIALS__.apply = API.apply;
    Object.defineProperty(window.__LM_MATERIALS__, 'ready', { get(){ return API.ready; } });
  }

  // If scene is already available
  if (window.__LM_SCENE__ && typeof window.__LM_SCENE__.traverse === 'function') {
    handleSceneReady({detail:{scene: window.__LM_SCENE__}});
  }

  window.addEventListener('lm:scene-ready', handleSceneReady, { once:false });
})();