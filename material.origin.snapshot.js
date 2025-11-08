
/* material.origin.snapshot.js v1.0 */
(function(){
  const TAG='[mat-origin v1.0]';
  if (window.__LM_MAT_ORIGIN && window.__LM_MAT_ORIGIN.locked){ console.debug(TAG,'already'); return; }
  window.__LM_MAT_ORIGIN={uuids:new Set(),items:[],locked:false};
  function snap(scene){
    if(!scene) return;
    const uu=new Set(); const items=[];
    scene.traverse(o=>{
      if(!o.isMesh) return;
      const mats=Array.isArray(o.material)?o.material:[o.material];
      mats.forEach(m=>{ if(!m||uu.has(m.uuid)) return; uu.add(m.uuid); items.push({uuid:m.uuid,name:m.name||`mat_${m.uuid.slice(0,8)}`}); });
    });
    window.__LM_MAT_ORIGIN.uuids=uu; window.__LM_MAT_ORIGIN.items=items; window.__LM_MAT_ORIGIN.locked=true;
    console.debug(TAG,'snapshotted',{count:items.length});
  }
  window.addEventListener('lm:glb-detected',()=>{ const sc=window.__LM_SCENE; requestAnimationFrame(()=>snap(sc)); },{once:true});
})();