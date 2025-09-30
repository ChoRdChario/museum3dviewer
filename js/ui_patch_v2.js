// UI Patch v2: overlay image using Drive 'uc' URL; thumbnails grid; no horizontal overflow
(function(){
  const $ = (id)=>document.getElementById(id);
  const overlay = $('captionOverlay');

  function driveImageURL(fileId){ return `https://drive.google.com/uc?id=${fileId}`; }

  function setOverlayVisible(v){ overlay.style.display = v ? 'block' : 'none'; }

  async function updateOverlay(){
    const title = $('capTitle')?.value?.trim();
    const body  = $('capBody')?.value?.trim();
    const imgId = $('capImageSelect')?.value;
    if(!title && !body && !imgId){ setOverlayVisible(false); overlay.innerHTML=''; return; }
    let imgHtml = '';
    if(imgId){ imgHtml = `<img src="${driveImageURL(imgId)}" alt="image">`; }
    overlay.innerHTML = `<h4>${title||''}</h4><p>${body||''}</p>${imgHtml}`;
    setOverlayVisible(true);
  }

  ['capTitle','capBody','capImageSelect'].forEach(id=>{
    const el = $(id);
    if(el){ el.addEventListener('input', updateOverlay); el.addEventListener('change', updateOverlay); }
  });
  const list = $('captionList');
  if(list){ list.addEventListener('click', ()=> setTimeout(updateOverlay, 0)); }

  async function buildThumbs(){
    const rail = $('capThumbRail');
    if(!rail) return;
    rail.innerHTML = '';
    try{
      const folderId = (window.currentModelMeta && window.currentModelMeta.parents && window.currentModelMeta.parents[0]) || null;
      if(!folderId || !window.drive || !window.drive.listImagesInFolder) return;
      const imgs = await window.drive.listImagesInFolder(folderId);
      for(const f of imgs){
        const card = document.createElement('div');
        card.className = 'card';
        const url = driveImageURL(f.id);
        card.innerHTML = `<img src="${url}" alt="">`;
        card.addEventListener('click', ()=>{
          const sel = $('capImageSelect');
          if(sel){ sel.value = f.id; sel.dispatchEvent(new Event('change', {bubbles:true})); }
        });
        rail.appendChild(card);
      }
    }catch(e){ console.warn('[thumb rail] failed', e); }
  }

  document.addEventListener('lmy:model-meta-ready', buildThumbs);
  setTimeout(()=>{ buildThumbs(); updateOverlay(); }, 0);

  const sel = $('capImageSelect');
  if(sel && !sel.dataset.lmyGuarded){
    sel.dataset.lmyGuarded = '1';
    const orig = sel.onchange;
    sel.onchange = async function(e){
      if(sel.dataset.busy === '1'){ return (typeof orig==='function') && orig.call(this, e); }
      sel.dataset.busy = '1';
      try{
        const res = await (typeof orig==='function' ? orig.call(this, e) : undefined);
        sel.dataset.busy = '0';
        return res;
      }catch(err){
        sel.dataset.busy = '0';
        throw err;
      }
    };
  }
})();