// viewer.bridge.module.js
// vA2_6_strict_wait - waits for THREE+scene and non-zero materials, then publishes once
// Safe to include multiple times; idempotent by guard flag.

(function(){
  const NS = '__LM_BRIDGE__';
  if (window[NS] && window[NS].installed) {
    console.warn('[viewer-bridge] already installed');
    return;
  }
  const state = window[NS] = (window[NS]||{});
  state.installed = true;
  state.version = 'vA2_6_strict_wait';
  state.debug = function(){ return {
    hasTHREE: !!window.THREE,
    scene: !!state.scene,
    camera: !!state.camera,
    renderer: !!state.renderer,
    extractedAt: state.extractedAt || null,
    materialCount: (state.materials && state.materials.list ? state.materials.list.length : 0),
  }};

  // Utility: stable key for materials
  function stableKey(mat, dupMap){
    let name = (mat && mat.name) ? String(mat.name) : 'Material';
    if (!name || name.trim() === '') name = 'Material';
    let key = name;
    let n = dupMap[key] || 0;
    if (n>0) key = name + '#' + (n+1);
    dupMap[name] = n+1;
    return key;
  }

  function extractMaterials(scene){
    const list = [];
    const byUuid = {};
    const dupMap = {};
    scene.traverse(obj=>{
      if (obj && obj.material){
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats){
          if (!m || byUuid[m.uuid]) continue;
          byUuid[m.uuid] = m;
          list.push({
            key: stableKey(m, dupMap),
            uuid: m.uuid,
            name: m.name || '',
            transparent: !!m.transparent,
            opacity: (typeof m.opacity==='number')? m.opacity : 1,
            doubleSided: m.side === (window.THREE ? window.THREE.DoubleSide : 2),
            unlit: !!(m.isMeshBasicMaterial) // heuristic: Basic ~ unlit
          });
        }
      }
    });
    return {list, byUuid};
  }

  let rafId = 0;
  let ticks = 0;
  let published = false;
  let lastCount = -1;

  function ensureGlobals(scene,camera,renderer){
    if (typeof window.THREE === 'undefined' && renderer && renderer.getContext){
      // Try to locate THREE via constructor chain if not global (best-effort noop here)
    }
    // We will still expose the bridge pack for consumers
    window.__lm = Object.assign((window.__lm||{}), { scene, camera, renderer, THREE: window.THREE });
  }

  function publish(scene,camera,renderer){
    state.scene = scene;
    state.camera = camera;
    state.renderer = renderer;
    state.extractedAt = Date.now();

    const mats = extractMaterials(scene);
    state.materials = mats;
    lastCount = mats.list.length;
    if (!window.__LM_MATERIALS__) window.__LM_MATERIALS__ = {};
    window.__LM_MATERIALS__.list = mats.list;
    window.__LM_MATERIALS__.byUuid = mats.byUuid;

    ensureGlobals(scene,camera,renderer);

    try {
      window.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { scene, THREE: window.THREE } }));
    } catch(e){ console.warn('[viewer-bridge] scene-ready dispatch failed', e); }
    try {
      window.dispatchEvent(new CustomEvent('lm:materials-ready', { detail: { keys: mats.list.map(m=>m.key) } }));
    } catch(e){ console.warn('[viewer-bridge] materials-ready dispatch failed', e); }

    console.log('[viewer-bridge] published scene & materials (strict)', {extractedAt: state.extractedAt, count: lastCount});
  }

  function tick(){
    ticks++;
    // Heuristics to detect scene/camera/renderer
    let scene = state.scene;
    let camera = state.camera;
    let renderer = state.renderer;

    // Try known globals/hints
    if (!scene){
      // popular engines sometimes attach a global __THREE_SCENES__ or keep last created scene in renderer.info
      if (window.__THREE_SCENES__ && window.__THREE_SCENES__.length){
        scene = window.__THREE_SCENES__[0];
      }
      if (!scene && window.__lm && window.__lm.scene) scene = window.__lm.scene;
    }
    if (!renderer && window.__lm && window.__lm.renderer) renderer = window.__lm.renderer;
    if (!camera && window.__lm && window.__lm.camera) camera = window.__lm.camera;

    // Fallback: scan common viewer mounts
    if (!scene){
      const canvases = Array.from(document.querySelectorAll('canvas'));
      // if there is a known viewer module that stashes objects on canvas, we could use it,
      // but we'll just wait.
    }

    // If we think we have a scene, check materials count
    if (scene){
      const mats = extractMaterials(scene);
      const count = mats.list.length;
      if (!published && count > 0){
        published = true;
        publish(scene,camera,renderer);
      } else if (published && count !== lastCount){
        // re-emit materials-ready when number changes (e.g., model loaded later)
        state.materials = mats;
        lastCount = count;
        window.__LM_MATERIALS__ = Object.assign((window.__LM_MATERIALS__||{}), { list: mats.list, byUuid: mats.byUuid });
        try {
          window.dispatchEvent(new CustomEvent('lm:materials-ready', { detail: { keys: mats.list.map(m=>m.key) } }));
        } catch(e){}
        console.log('[viewer-bridge] materials changed; re-emitted', {count});
      }
    }

    // Give up after a while but keep light polling for late model load
    const maxTicks = 1800; // ~30s at 60fps (upper bound; real fps can vary)
    if (ticks < maxTicks && !published){
      rafId = window.requestAnimationFrame(tick);
    } else if (!published){
      console.warn('[viewer-bridge] gave up waiting for scene/materials');
    } else {
      // keep slow polling to detect late material changes
      setTimeout(()=>{ rafId = window.requestAnimationFrame(tick); }, 1000);
    }
  }

  rafId = window.requestAnimationFrame(tick);
})(); 
