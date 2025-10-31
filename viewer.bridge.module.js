/* viewer.bridge.module.js — Robust Scene Bridge (2025-10-31)
   - Captures THREE.Scene from multiple sources (event, polling, hooks)
   - Exposes window.viewerBridge.{getScene,listMaterials}
   - Safe to include multiple times (idempotent)
*/
(function(){
  const NS='[viewer-bridge]';
  if (window.viewerBridge && window.viewerBridge.__robust) {
    console.log(NS, 'already installed'); 
    return;
  }
  const log=(...a)=>console.log(NS, ...a);
  const warn=(...a)=>console.warn(NS, ...a);

  const st = { scene:null, armed:false, fired:false };

  function setScene(s, reason){
    if (!s || st.scene) return;
    try{
      st.scene = s;
      log('scene captured via', reason);
      if (!st.fired){
        st.fired = true;
        const ev = new CustomEvent('lm:scene-ready', { detail:{ via:'viewer-bridge' }});
        window.dispatchEvent(ev); document.dispatchEvent(ev);
        log('lm:scene-ready dispatched (bridge)');
      }
    }catch(e){ warn('setScene failed', e); }
  }

  function trySlots(){
    const w = window;
    const slots = [
      ()=> w.__LM && w.__LM.scene,
      ()=> w.__LM_SCENE,
      ()=> w.__lm_getScene && w.__lm_getScene(),
      ()=> w.__lm_viewer && w.__lm_viewer.scene,
      ()=> w.viewer && w.viewer.scene,
      ()=> w.viewer3d && w.viewer3d.scene,
      ()=> (w.__sceneProbe && w.__sceneProbe.scene) // from any probes
    ];
    for (const f of slots){
      try { const s = f(); if (s && s.isScene) return s; } catch{}
    }
    return null;
  }

  // Event from viewer.module.cdn.js
  function onSceneEvt(){
    const s = trySlots();
    if (s) setScene(s, 'event(lm:scene-ready)');
  }
  window.addEventListener('lm:scene-ready', onSceneEvt);
  document.addEventListener('lm:scene-ready', onSceneEvt);

  // Poll (up to ~12s)
  (async () => {
    for (let i=0;i<60;i++){
      const s = trySlots();
      if (s){ setScene(s, 'poll'); break; }
      await new Promise(r=>setTimeout(r,200));
    }
    if (!st.scene) warn('scene not found during bridge watch (non-fatal)');
  })();

  // Optional THREE hook (works only if global THREE exists)
  try{
    const T = window.THREE;
    if (T && T.Scene && T.Scene.prototype && !T.Scene.prototype.__lm_bridge_hooked){
      const add = T.Scene.prototype.add;
      T.Scene.prototype.add = function(...args){
        try { setScene(this, 'THREE.Scene.add hook'); } catch{}
        return add.apply(this, args);
      };
      T.Scene.prototype.__lm_bridge_hooked = true;
      log('armed THREE.Scene.add hook');
    }
  }catch{}

  function listMaterials(){
    const s = st.scene || trySlots();
    if (!s) return [];
    const set = new Set();
    const nameOf = (m) => (m && m.name && String(m.name).trim()) || (m && m.id!=null ? `material.${m.id}` : '');
    try{
      s.traverse(obj=>{
        const mat = obj && obj.material;
        if (!mat) return;
        if (Array.isArray(mat)) mat.forEach(m=>{ const n=nameOf(m); if(n) set.add(n); });
        else { const n=nameOf(mat); if(n) set.add(n); }
      });
    }catch(e){ warn('traverse failed', e); }
    return Array.from(set);
  }

  window.viewerBridge = {
    __robust: true,
    getScene: () => st.scene || trySlots(),
    listMaterials
  };

  log('bridge installed');
})();