// viewer.bridge.module.js
(function(){
  const log=(...a)=>console.log('[viewer-bridge]',...a), warn=(...a)=>console.warn('[viewer-bridge]',...a);
  const vb = window.viewerBridge || (window.viewerBridge = {});

  function pickScene(){
    if (vb.__scene?.isScene) return vb.__scene;
    if (window.__LM_SCENE?.isScene) return window.__LM_SCENE;
    if (window.__viewer?.scene?.isScene) return window.__viewer.scene;
    if (window.viewer?.scene?.isScene) return window.viewer.scene;
    if (window.lm?.scene?.isScene) return window.lm.scene;
    return null;
  }

  if (typeof vb.getScene !== 'function') {
    vb.getScene = () => {
      const s = pickScene();
      if (s) vb.__scene = s;
      return s;
    };
  }

  if (typeof vb.listMaterials !== 'function') {
    vb.listMaterials = () => {
      const sc = vb.getScene();
      const set = new Set();
      sc?.traverse(o=>{
        const m=o.material; if(!m) return;
        (Array.isArray(m)?m:[m]).forEach(mm=>{ if(mm?.name) set.add(mm.name); });
      });
      return Array.from(set);
    };
  }

  (function pollStable(){
    let prev= -1, stable=0;
    const iv = setInterval(()=>{
      const sc = vb.getScene(); if(!sc) return;
      let count=0; sc.traverse(o=>{ if (o.isMesh) count++; });
      if (count>0 && count===prev) stable++; else stable=0;
      prev=count;
      if (stable>=3){
        window.dispatchEvent(new CustomEvent('lm:scene-ready', {detail:{from:'bridge-poll', meshCount:count}}));
        log('scene stabilized with', count, 'meshes');
        clearInterval(iv);
      }
    },300);
    setTimeout(()=>clearInterval(iv),30000);
  })();
})();