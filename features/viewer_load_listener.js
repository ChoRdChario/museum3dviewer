// features/viewer_load_listener.js
(function(){
  let attached = false;
  function attach(){
    if(attached) return; attached = true;
    document.addEventListener('lmy:load-glb-blob', async (e)=>{
      const blob = e.detail?.blob;
      if(!blob) return;
      try{
        if (window.__LMY_viewer?.loadBlob) return await window.__LMY_viewer.loadBlob(blob);
        if (window.viewer?.loadBlob)      return await window.viewer.loadBlob(blob);
        if (window.loadBlob)               return await window.loadBlob(blob);
        if (window.loadURL){
          const url = URL.createObjectURL(blob);
          await window.loadURL(url);
          // URL.revokeObjectURL(url); // 必要に応じて
          return;
        }
        console.warn('[viewer-load-listener] no loader found');
      }catch(err){
        console.error('[viewer-load-listener] load failed', err);
      }
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', attach);
  }else{
    attach();
  }
})();
