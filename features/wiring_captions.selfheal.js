// features/wiring_captions.selfheal.js
(function(){
  if (window.__LMY_viewer) return;
  let armed = false;
  function arm(){
    if (armed) return; armed = true;
    document.addEventListener('lmy:load-glb-blob', async (e)=>{
      try{
        if (!window.__LMY_viewer){
          await import('./viewer_bootstrap.js');
        }
        const blob = e?.detail?.blob;
        if (blob && window.__LMY_viewer?.loadBlob){
          await window.__LMY_viewer.loadBlob(blob);
          console.log('[wiring:selfheal] rendered via viewer_bootstrap');
        } else {
          console.warn('[wiring:selfheal] missing blob or viewer API');
        }
      }catch(err){
        console.warn('[wiring:selfheal] failed', err);
      }
    }, { passive:true });
  }
  arm();
  console.log('[wiring:selfheal] armed');
})();
