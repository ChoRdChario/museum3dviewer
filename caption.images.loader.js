// [caption.images.loader] Phase A1: ask Drive/viewer bridge for sibling images, with retries on context events.
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
    }catch(e){
      warn('bridge list failed', e);
    }
    if(window.__LM_CAPTION_UI) window.__LM_CAPTION_UI.setImages([]);
    log('images none (stub)');
  }

  // 初回: ページロード完了時に一度試す
  window.addEventListener('load', tryListFromDrive);

  // GLB ロード後に sheet-context が確定したタイミングでも再試行
  window.addEventListener('lm:sheet-context', ()=>{ setTimeout(tryListFromDrive, 0); });

  // viewer ブリッジが準備できたタイミングでも一応試しておく
  document.addEventListener('lm:viewer-bridge-ready', ()=>{ setTimeout(tryListFromDrive, 0); });

  // Drive ブリッジ専用の ready イベントがあれば、それも拾う
  document.addEventListener('lm:drive-bridge-ready', ()=>{ setTimeout(tryListFromDrive, 0); });

  log('armed');
})();
