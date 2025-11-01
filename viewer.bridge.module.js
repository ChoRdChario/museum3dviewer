
/* viewer.bridge.module.js
 * Provide viewerBridge.getScene/listMaterials and stabilize scene-ready
 */
(function(){
  const log  = (...a)=>console.log('[viewer-bridge]', ...a);
  const warn = (...a)=>console.warn('[viewer-bridge]', ...a);

  const vb = window.viewerBridge = window.viewerBridge || {};

  function getSceneCandidate(){
    return window.__LM_SCENE || window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null;
  }
  vb.getScene = vb.getScene || (()=>{
    try{ return getSceneCandidate(); }catch(e){ warn(e); return null; }
  });
  vb.listMaterials = vb.listMaterials || (()=>{
    const sc = vb.getScene();
    const set = new Set();
    sc?.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{ if(mm?.name) set.add(mm.name); });
    });
    return Array.from(set);
  });

  // poll until mesh count stabilizes, then notify
  (function pollSceneUntilReady(){
    let last= -1, stable=0, count=0;
    const iv = setInterval(()=>{
      const sc = vb.getScene();
      if (!sc) return;
      count = 0;
      sc.traverse(o=>{ if (o.isMesh) count++; });
      if (count>0 && count===last) {
        stable++;
        if (stable>=3){
          log('scene stabilized with', count, 'meshes');
          try{
            window.dispatchEvent(new CustomEvent('lm:scene-ready', {detail:{from:'poll-stable', meshCount:count}}));
          }catch(e){ warn('dispatch failed', e); }
          clearInterval(iv);
        }
      } else {
        stable=0;
      }
      last = count;
    }, 300);
    setTimeout(()=>clearInterval(iv), 30000);
  })();
})();
