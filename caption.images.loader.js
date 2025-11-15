
// [caption.images.loader] Phase A0 stub: asks Drive bridge (if any), else empty.
(function(){
  const TAG='[caption.images.loader]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  async function tryListFromDrive(){
    try{
      const br = window.__lm_drive_bridge || window.__lm_viewer_bridge;
      if(br && typeof br.listSiblingImages === 'function'){
        const imgs = await br.listSiblingImages();
        if(window.__LM_CAPTION_UI) window.__LM_CAPTION_UI.setImages(imgs||[]);
        log('images via bridge', (imgs||[]).length);
        return;
      }
    }catch(e){ warn('bridge list failed', e); }
    if(window.__LM_CAPTION_UI) window.__LM_CAPTION_UI.setImages([]);
    log('images none (stub)');
  }

  window.addEventListener('load', tryListFromDrive);
  log('armed');
})();
