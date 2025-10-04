// features/wiring_bridge_glb_to_viewer.js
// 強制ブリッジ：lmy:load-glb-blob -> viewer (未ロードなら import して描画)
(function(){
  function onBlob(e){
    const blob = e?.detail?.blob;
    if (!blob){ console.warn('[bridge] no blob in event'); return; }
    (async ()=>{
      try{
        if (!window.__LMY_viewer){
          await import('./viewer_bootstrap.js');
        }
        if (!window.__LMY_viewer?.loadBlob){
          console.warn('[bridge] viewer exists but no loadBlob');
          return;
        }
        await window.__LMY_viewer.loadBlob(blob);
        console.log('[bridge] blob rendered');
      }catch(err){
        console.warn('[bridge] render failed', err);
      }
    })();
  }
  document.addEventListener('lmy:load-glb-blob', onBlob, { passive:true });
  console.log('[bridge] armed');
})();
