// ui.js — consolidated (safe tabs + overlay + thumbnails + HEIC guard)
export function setupTabs(){
  const btns = Array.from(document.querySelectorAll('.tab-btn'));
  const tabs = new Map(Array.from(document.querySelectorAll('.tab')).map(el=>{
    const id = el.id.startsWith('tab-') ? el.id.slice(4) : el.id.replace(/^tab/,'').toLowerCase();
    return [id, el];
  }));

  const show = (key)=>{
    btns.forEach(b=> b.classList.toggle('active', b.dataset.tab===key));
    tabs.forEach((el,name)=> el.classList.toggle('active', name===key));
  };

  // top tab buttons
  btns.forEach(b=> b.addEventListener('click', ()=> show(b.dataset.tab)));

  // mobile footer buttons (existence guarded)
  const byId = (id)=> document.getElementById(id);
  const wire = (id, key)=>{ const el = byId(id); if(el) el.onclick = ()=> show(key); };
  wire('mobileHome',      'home');
  wire('mobileMaterials', 'materials');
  wire('mobileCamera',    'camera');
  wire('mobileCaptions',  'captions');

  // default tab
  const defaultTab = tabs.has('home') ? 'home' : (tabs.has('captions') ? 'captions' : Array.from(tabs.keys())[0]);
  if(defaultTab) show(defaultTab);
}

// ====== Caption overlay & thumbnails ======
async function tokenFetchBlobURL(fileId){
  try{
    const token = (window.gapi && gapi.client && gapi.client.getToken && gapi.client.getToken())?.access_token;
    if(!token) throw new Error('no token');
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if(!r.ok) throw new Error('fetch failed');
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }catch(e){
    return `https://drive.google.com/uc?id=${fileId}`; // public fallback
  }
}

function $(id){ return document.getElementById(id); }

async function updateOverlay(){
  const overlay = $('captionOverlay');
  if(!overlay) return;
  const title = $('capTitle')?.value?.trim();
  const body  = $('capBody')?.value?.trim();
  const imgId = $('capImageSelect')?.value;
  if(!title && !body && !imgId){ overlay.style.display='none'; overlay.innerHTML=''; return; }
  let imgHtml = '';
  if(imgId){
    const url = await tokenFetchBlobURL(imgId);
    imgHtml = `<img src="${url}" alt="">`;
  }
  overlay.innerHTML = `<h4>${title||''}</h4><p>${body||''}</p>${imgHtml}`;
  overlay.style.display = 'block';
}

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
      const url = await tokenFetchBlobURL(f.id);
      card.innerHTML = `<img src="${url}" alt="">`;
      card.addEventListener('click', ()=>{
        const sel = $('capImageSelect');
        if(sel){ sel.value = f.id; sel.dispatchEvent(new Event('change', {bubbles:true})); }
      });
      rail.appendChild(card);
    }
  }catch(e){
    console.warn('[thumb rail] failed', e);
  }
}

function wireCaptionUI(){
  ['capTitle','capBody','capImageSelect'].forEach(id=>{
    const el = $(id);
    if(el){ el.addEventListener('input', ()=>updateOverlay()); el.addEventListener('change', ()=>updateOverlay()); }
  });
  const list = $('captionList');
  if(list){ list.addEventListener('click', ()=> setTimeout(updateOverlay, 0)); }

  // Guard select onchange recursion for HEIC conversion paths
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

  document.addEventListener('lmy:model-meta-ready', buildThumbs);
  setTimeout(()=>{ buildThumbs(); updateOverlay(); }, 0);
}

export function initUI(){
  setupTabs();
  wireCaptionUI();
}
