// UI Support patch: overlay & thumbnail list & vertical UX niceties
// 1) Caption overlay in viewer showing title/body/image of *current* selection (read from fields)
// 2) Thumbnail rail next to select box
// 3) Rebind caption field changes -> overlay update
(function(){
  const $ = (id)=>document.getElementById(id);

  const overlay = document.getElementById('captionOverlay');
  function setOverlayVisible(v){ overlay.style.display = v ? 'block' : 'none'; }
  async function loadBlobUrl(fileId, mime){
    try{
      if(!window.drive){ return null; }
      const buf = await window.drive.downloadFile(fileId);
      const blob = new Blob([buf], { type: mime || 'image/jpeg' });
      return URL.createObjectURL(blob);
    }catch(e){ console.warn('[overlay] blob load failed', e); return null; }
  }

  async function updateOverlay(){
    const title = $('capTitle')?.value?.trim();
    const body  = $('capBody')?.value?.trim();
    const imgId = $('capImageSelect')?.value;
    if(!title && !body && !imgId){ setOverlayVisible(false); overlay.innerHTML=''; return; }
    let imgHtml = '';
    if(imgId){
      // try to get meta for mime
      let mime = 'image/jpeg';
      try{ const meta = await window.drive.getFileMeta(imgId); mime = meta?.mimeType || mime; }catch(_){}
      const url = await loadBlobUrl(imgId, mime);
      if(url){ imgHtml = `<img src="${url}" alt="image">`; }
    }
    overlay.innerHTML = `<h4>${title||''}</h4><p>${body||''}</p>${imgHtml}`;
    setOverlayVisible(true);
  }

  ['capTitle','capBody','capImageSelect'].forEach(id=>{
    const el = $(id);
    if(el){
      el.addEventListener('input', updateOverlay);
      el.addEventListener('change', updateOverlay);
    }
  });
  // Also update when a caption row is clicked (main.js がフィールドを埋め直すため)
  const list = $('captionList');
  if(list){
    list.addEventListener('click', ()=> setTimeout(updateOverlay, 0));
  }

  // --- Thumbnail rail for image select ---
  (async function buildThumbs(){
    const railId = 'capThumbRail';
    if($(railId)) return;
    const rail = document.createElement('div');
    rail.id = railId;
    rail.style.display = 'grid';
    rail.style.gridTemplateColumns = 'repeat(auto-fill, minmax(84px,1fr))';
    rail.style.gap = '6px';
    rail.style.maxHeight = '24vh';
    rail.style.overflow = 'auto';
    $('capImagePreview')?.parentElement?.insertAdjacentElement('afterend', rail);
    try{
      // Find folder from current model meta if available
      const folderId = (window.currentModelMeta && window.currentModelMeta.parents && window.currentModelMeta.parents[0]) || null;
      if(!folderId || !window.drive) return;
      const imgs = await window.drive.listImagesInFolder(folderId);
      for(const f of imgs){
        // Skip HEIC thumbs until user selects -> convert path; here is a browser thumb only
        const card = document.createElement('div');
        card.style.border = '1px solid var(--line)';
        card.style.borderRadius = '6px';
        card.style.padding = '4px';
        card.style.cursor = 'pointer';
        card.title = f.name;
        // Fetch small preview blob
        let url = null;
        try{
          const buf = await window.drive.downloadFile(f.id);
          const blob = new Blob([buf], { type: f.mimeType || 'image/jpeg' });
          url = URL.createObjectURL(blob);
        }catch(_){}
        card.innerHTML = url ? `<img src="${url}" style="width:100%;height:64px;object-fit:cover;border-radius:4px">`
                             : `<div style="height:64px;display:grid;place-items:center;font-size:11px;color:#999">no preview</div>`;
        card.addEventListener('click', ()=>{
          const sel = $('capImageSelect');
          if(sel){ sel.value = f.id; sel.dispatchEvent(new Event('change', {bubbles:true})); }
        });
        rail.appendChild(card);
      }
    }catch(e){ console.warn('[thumb rail] failed', e); }
  })();

})();