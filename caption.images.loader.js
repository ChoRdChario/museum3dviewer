// [caption.images.loader] Phase B1 — Drive sibling images loader for captions
// - Uses window.__LM_ACTIVE_GLB_ID set by glb.btn.bridge.v3.js
// - Calls drive.images.list.js (listSiblingImagesByGlbId)
// - Pushes results into __LM_CAPTION_UI.setImages(images)
(function(){
  const TAG='[caption.images.loader]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);

  let inflight = null;

  function getActiveGlbId(){
    const ctx = window.__lm_ctx || window.__LM_SAVE_CTX || {};
    return window.__LM_ACTIVE_GLB_ID || ctx.glbFileId || null;
  }

  async function loadImages(reason){
    const ui = window.__LM_CAPTION_UI;
    const glbId = getActiveGlbId();
    if (!ui || typeof ui.setImages !== 'function'){
      warn('no caption UI yet; skip images', reason);
      return;
    }
    if (!glbId){
      warn('no active GLB id; set empty images', reason);
      ui.setImages([]);
      return;
    }
    try{
      const mod = await import('./drive.images.list.js');
      const fn = mod.listSiblingImagesByGlbId || mod.listSiblingImages || mod.default;
      if (typeof fn !== 'function'){
        warn('drive.images.list.js missing listSiblingImagesByGlbId');
        ui.setImages([]);
        return;
      }
      const raw = await fn(glbId);
      const imgs = (raw || []).map(r=>({
        id: r.id,
        name: r.name || '',
        mimeType: r.mimeType || '',
        thumbUrl: r.thumbnailUrl || r.thumbUrl || r.url || '',
        url: r.url || r.webContentLink || r.webViewLink || ''
      }));
      ui.setImages(imgs);
      log('images loaded', imgs.length, 'reason:', reason);
    }catch(e){
      warn('image listing failed', e);
      try{
        const ui2 = window.__LM_CAPTION_UI;
        if (ui2 && typeof ui2.setImages === 'function') ui2.setImages([]);
      }catch(_){}
    }
  }

  function trigger(reason){
    if (inflight){
      // let previous finish; start new after that
      inflight.finally(()=>{
        inflight = loadImages(reason);
      });
      return;
    }
    inflight = loadImages(reason).finally(()=>{ inflight = null; });
  }

  window.addEventListener('load', ()=>trigger('window-load'));
  document.addEventListener('lm:caption-ui-ready', ()=>trigger('caption-ui-ready'));
  document.addEventListener('lm:refresh-images', ()=>trigger('manual-refresh'));

  log('armed');
})();