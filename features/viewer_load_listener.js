// features/viewer_load_listener.js (v2 — 強制受け口)
(function(){
  let attached = false;
  function attach(){
    if(attached) return; attached = true;

    async function handoff(blob){
      try{
        if (window.__LMY_viewer?.loadBlob) return await window.__LMY_viewer.loadBlob(blob);
        if (window.viewer?.loadBlob)      return await window.viewer.loadBlob(blob);
        if (window.loadBlob)               return await window.loadBlob(blob);
        if (window.loadURL){
          const url = URL.createObjectURL(blob);
          try{ await window.loadURL(url); } finally {}
          return;
        }
        console.warn('[viewer-load-listener] no loader found');
      }catch(err){
        console.error('[viewer-load-listener] load failed', err);
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
