// viewer.bridge.module.js
// LociMyu: viewerBridge (scene access + materials list) with GLTFLoader tap fallback
(function(){
  const log  = (...a)=>console.log('[viewer-bridge]', ...a);
  const warn = (...a)=>console.warn('[viewer-bridge]', ...a);

  // ---- Scene discovery ----
  function discoverScene() {
    try { if (window.viewerBridge && window.viewerBridge.__scene) return window.viewerBridge.__scene; } catch(e){}
    try { if (window.__viewer && window.__viewer.scene) return (window.viewerBridge.__scene = window.__viewer.scene); } catch(e){}
    try { if (window.viewer && window.viewer.scene)     return (window.viewerBridge.__scene = window.viewer.scene); } catch(e){}
    try { if (window.lm && window.lm.scene)             return (window.viewerBridge.__scene = window.lm.scene); } catch(e){}
    return null;
  }

  // ---- Optional GLTFLoader.parse tap (safe no-op if unavailable) ----
  (function tapGLTFLoader(){
    const THREE = window.THREE;
    const GL = THREE && THREE.GLTFLoader && THREE.GLTFLoader.prototype;
    if (!GL || GL.__lm_scene_tapped) return;
    const origParse = GL.parse;
    GL.parse = function(data, path, onLoad, onError){
      const wrapped = (gltf) => {
        try {
          const sc = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
          if (sc) {
            window.__viewer = window.__viewer || {};
            window.__viewer.scene = sc;
            window.dispatchEvent(new CustomEvent('lm:scene-ready', {detail:{from:'gltf-parse'}}));
            log('scene captured via GLTFLoader.parse');
          }
        } catch(e){ /*noop*/ }
        onLoad && onLoad(gltf);
      };
      return origParse.call(this, data, path, wrapped, onError);
    };
    GL.__lm_scene_tapped = true;
    log('GLTFLoader.parse hooked');
  })();

  // ---- Install bridge ----
  const vb = Object.assign(window.viewerBridge || {}, {
    getScene(){
      const sc = discoverScene();
      if (sc) this.__scene = sc;
      return sc;
    },
    listMaterials(){
      const sc = this.getScene();
      const set = new Set();
      sc && sc.traverse && sc.traverse(o => {
        const m = o.material; if (!m) return;
        (Array.isArray(m)?m:[m]).forEach(mm => { if (mm && mm.name) set.add(mm.name); });
      });
      return Array.from(set);
    }
  });
  window.viewerBridge = vb;

  // Update cached scene when ready
  window.addEventListener('lm:scene-ready', () => { vb.getScene(); log('scene ready'); });

  log('installed');
})();
