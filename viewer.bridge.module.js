/* viewer.bridge.module.js — ROBUST SCENE/MATERIAL BRIDGE (drop-in)
   - Works with ESM three.js (no global THREE at boot)
   - Captures scene via late binding + prototype hook
   - Exposes window.viewerBridge.listMaterials()
   - Emits 'lm:scene-ready' once
*/
(function(){
  const NS='[viewer-bridge]';
  const log=(...a)=>console.log(NS, ...a);
  const warn=(...a)=>console.warn(NS, ...a);

  // --------------------------------------------------------------------------
  // State
  const st = {
    THREE: null,
    scene: null,
    firedSceneReady: false,
    armedAddHook: false,
  };

  function fireSceneReady(){
    if (st.firedSceneReady || !st.scene) return;
    st.firedSceneReady = true;
    const ev = new CustomEvent('lm:scene-ready', { detail: { scene:true }});
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
    log('lm:scene-ready dispatched (bridge)');
  }

  // --------------------------------------------------------------------------
  // Late capture helpers
  function captureTHREE(v){
    if (!v || st.THREE) return;
    try {
      st.THREE = v;
      log('THREE captured (late)');
      armAddHook();               // once THREE known, we can hook Scene.add
    } catch(e){ warn('captureTHREE failed', e); }
  }

  function captureScene(s){
    if (!s || st.scene) return;
    try {
      if (s.isScene) {
        st.scene = s;
        log('scene captured');
        // Try firing event a tiny bit later to let listeners attach
        setTimeout(fireSceneReady, 0);
      }
    } catch(e){ warn('captureScene failed', e); }
  }

  // Hook Scene.prototype.add to catch the first scene encountered
  function armAddHook(){
    if (st.armedAddHook || !st.THREE || !st.THREE.Scene) return;
    st.armedAddHook = true;
    try {
      const proto = st.THREE.Scene.prototype;
      const origAdd = proto.add;
      if (typeof origAdd === 'function'){
        proto.add = function(...args){
          // "this" is the Scene instance
          captureScene(this);
          return origAdd.apply(this, args);
        };
        log('Scene.add hook armed');
      }
    } catch(e){ warn('armAddHook failed', e); }
  }

  // Observe late assignment to window.THREE (if not present yet)
  (function armWindowThreeWatcher(){
    if ('THREE' in window) { captureTHREE(window.THREE); return; }
    try{
      Object.defineProperty(window, 'THREE', {
        configurable: true,
        enumerable: true,
        get(){ return st.THREE; },
        set(v){
          // replace this property with a normal value and capture
          Object.defineProperty(window, 'THREE', { value:v, writable:true, configurable:true });
          captureTHREE(v);
        }
      });
      log('window.THREE watcher armed');
    }catch(e){ /* some environments disallow defineProperty on window – ignore */ }
  })();

  // Observe late assignment to a common viewer handle (__lm_viewer)
  (function armViewerHandleWatcher(){
    const key='__lm_viewer';
    if (key in window && window[key] && window[key].scene) captureScene(window[key].scene);
    try{
      Object.defineProperty(window, key, {
        configurable: true,
        enumerable: true,
        get(){ return undefined; },
        set(v){
          Object.defineProperty(window, key, { value:v, writable:true, configurable:true });
          try{ if (v && v.scene) captureScene(v.scene); }catch{}
        }
      });
      log('window.__lm_viewer watcher armed');
    }catch(e){ /* optional */ }
  })();

  // Best-effort polling for already-existing scene locations
  async function tryFindScenePoll(){
    const slots = [
      ()=>window.__lm_getScene && window.__lm_getScene(),
      ()=>window.__lm_viewer && window.__lm_viewer.scene,
      ()=>window.viewer && window.viewer.scene,
      ()=>window.viewer3d && window.viewer3d.scene,
      ()=>window.__LM && window.__LM.scene,
    ];
    const MAX=50, INTERVAL=200;
    for (let i=0;i<MAX && !st.scene;i++){
      for (const f of slots){
        try{
          const s = f && f();
          if (s && s.isScene){ captureScene(s); break; }
        }catch{}
      }
      // THREE might appear later too
      if (!st.THREE && window.THREE) captureTHREE(window.THREE);
      await new Promise(r=>setTimeout(r, INTERVAL));
    }
    if (!st.scene) warn('scene not found during bridge watch (non-fatal)');
  }
  tryFindScenePoll();

  // --------------------------------------------------------------------------
  // Materials enumeration exposed to orchestrator
  function listMaterials(){
    if (!st.scene) return [];
    const set = new Set();
    const nameOf = (m)=> (m && m.name && String(m.name).trim())
                     || (m && m.id!=null ? `material.${m.id}` : '');
    try{
      st.scene.traverse(obj=>{
        const mat = obj && obj.material;
        if (!mat) return;
        if (Array.isArray(mat)) mat.forEach(mi=>{ const n=nameOf(mi); if(n) set.add(n); });
        else { const n=nameOf(mat); if(n) set.add(n); }
      });
    }catch(e){ warn('traverse failed', e); }
    return [...set];
  }

  // Public bridge API
  window.viewerBridge = Object.assign(window.viewerBridge || {}, {
    listMaterials,
  });

  log('bridge installed');
})();
