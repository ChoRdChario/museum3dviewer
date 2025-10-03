// features/viewer_load_listener.js (v2.1 — handoff + auto frame)
(function(){
  let attached = false;
  function attach(){
    if(attached) return; attached = true;

    async function handoff(blob){
      try{
        if (window.__LMY_viewer?.loadBlob) return await window.__LMY_viewer.loadBlob(blob).then(autoFrame);
        if (window.viewer?.loadBlob)      return await window.viewer.loadBlob(blob).then(autoFrame);
        if (window.loadBlob)               return await window.loadBlob(blob).then?.(autoFrame) ?? autoFrame();
        if (window.loadURL){
          const url = URL.createObjectURL(blob);
          try{ await window.loadURL(url); } finally {}
          await autoFrame();
          return;
        }
        console.warn('[viewer-load-listener] no loader found');
      }catch(err){
        console.error('[viewer-load-listener] load failed', err);
      }
    }

    async function autoFrame(){
      try{
        const v = window.__LMY_viewer || window.viewer || window;
        if (v.fitToScene) { v.fitToScene(); return; }
        if (v.frameScene) { v.frameScene(); return; }
        if (v.controls?.reset) v.controls.reset();
        if (v.camera && v.scene && window.THREE){
          const box = new THREE.Box3().setFromObject(v.scene);
          const size = box.getSize(new THREE.Vector3()).length();
          const center = box.getCenter(new THREE.Vector3());
          v.camera.position.set(center.x, center.y, center.z + size*0.8);
          v.camera.lookAt(center);
          v.camera.updateProjectionMatrix?.();
        }
        (v.render || v.requestRender)?.();
      }catch(e){
        console.warn('[viewer-load-listener] autoFrame skipped', e);
      }
    }

    if(!window.__LMY_loadGlbBlob){
      window.__LMY_loadGlbBlob = async (blob)=> handoff(blob);
    }
    document.addEventListener('lmy:load-glb-blob', (e)=>{
      const blob = e.detail?.blob;
      if(blob) handoff(blob);
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', attach);
  }else{
    attach();
  }
})();
