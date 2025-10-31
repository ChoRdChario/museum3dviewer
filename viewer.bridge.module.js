// viewer.bridge.module.js
// LociMyu - viewer bridge (scene access & material listing + stabilization ping)
(function(){
  const log  = (...a)=>console.log('[viewer-bridge]', ...a);
  const warn = (...a)=>console.warn('[viewer-bridge]', ...a);

  if (!window.viewerBridge) window.viewerBridge = {};

  function pickScene(){
    try {
      if (window.viewerBridge.__scene) return window.viewerBridge.__scene;
      if (window.__LM_SCENE) return window.__LM_SCENE;
      if (window.__viewer?.scene) return window.__viewer.scene;
      if (window.viewer?.scene) return window.viewer.scene;
      if (window.lm?.scene) return window.lm.scene;
    } catch(e){}
    return null;
  }

  if (typeof window.viewerBridge.getScene !== 'function'){
    window.viewerBridge.getScene = () => {
      const sc = pickScene();
      if (sc) window.viewerBridge.__scene = sc;
      return sc;
    };
  }

  if (typeof window.viewerBridge.listMaterials !== 'function'){
    window.viewerBridge.listMaterials = () => {
      const sc = window.viewerBridge.getScene();
      const set = new Set();
      sc?.traverse(o=>{
        const m = o.material; if (!m) return;
        (Array.isArray(m)?m:[m]).forEach(mm=>{ if (mm?.name) set.add(mm.name); });
      });
      return Array.from(set);
    };
  }

  (function pollSceneUntilReady(){
    let last = -1, stable = 0;
    const iv = setInterval(()=>{
      const sc = window.viewerBridge.getScene();
      if (!sc) return;
      let cnt = 0;
      sc.traverse(o=>{ if (o.isMesh) cnt++; });
      if (cnt>0 && cnt===last) {
        stable++;
        if (stable>=3){
          clearInterval(iv);
          window.dispatchEvent(new CustomEvent('lm:scene-ready', {detail:{from:'poll-stable', meshCount:cnt}}));
          log('scene stabilized with', cnt, 'meshes');
        }
      } else {
        stable = 0;
      }
      last = cnt;
    }, 300);
    setTimeout(()=>clearInterval(iv), 30000);
  })();
})();