// [caption.images.loader] Phase A1: ask Drive/viewer bridge for sibling images, with retries on context events.
(function(){
  const TAG='[caption.images.loader]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  // 現在の GLB fileId を分解して取得
  function getCurrentGlbId(){
    // 1) 明示的にキャプチャされている id を優先
    if (typeof window.__LM_CURRENT_GLB_ID === 'string' && window.__LM_CURRENT_GLB_ID){
      return window.__LM_CURRENT_GLB_ID;
    }
    // 2) フォールバック: #glbUrl の値から推定（Drive URL または 素の id）
    try{
      const input = document.querySelector('#glbUrl');
      const v = (input && input.value ? input.value.trim() : '');
      if (!v) return '';
      // それっぽい素の fileId
      if (/^[a-zA-Z0-9_-]{10,}$/.test(v)) return v;
      // Drive URL パターン
      const u = new URL(v);
      const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      const qp = u.searchParams.get('id');
      if (qp) return qp;
    }catch(_){}
    return '';
  }

  async function tryListFromDrive(){
    try{
      const br = window.__lm_drive_bridge || window.__lm_viewer_bridge;
      if(br && typeof br.listSiblingImages === 'function'){
        const imgs = await br.listSiblingImages();
        if(window.__LM_CAPTION_UI) window.__LM_CAPTION_UI.setImages(imgs||[]);
        log('images via bridge', (imgs||[]).length);
        return;
      }

      // --- Fallback path: Drive API を直接叩く（GLB fileId ベース） ---
      const glbId = getCurrentGlbId();
      if (glbId){
        try{
          const mod = await import('./drive.images.list.js');
          if (mod && typeof mod.listSiblingImagesByGlbId === 'function'){
            const imgs = await mod.listSiblingImagesByGlbId(glbId);
            if(window.__LM_CAPTION_UI) window.__LM_CAPTION_UI.setImages(imgs||[]);
            log('images via drive.images.list', (imgs||[]).length, 'glbId=', glbId);
            return;
          } else {
            warn('drive.images.list.js missing listSiblingImagesByGlbId');
          }
        }catch(e){
          warn('direct Drive list failed', e);
        }
      } else {
        log('no GLB id yet; skip direct Drive list once');
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
