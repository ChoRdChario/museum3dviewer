// ui.js — consolidated + exports used by main.js (setLoading, setStatus, toast)
function ensureBadge(id, baseStyle){
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = baseStyle;
    document.body.appendChild(el);
  }
  return el;
}

export function setStatus(text='READY'){
  const el = ensureBadge('statusBadge', 'position:fixed;left:12px;bottom:12px;background:#111c;color:#fff;border:1px solid #444;border-radius:999px;padding:8px 12px;font-weight:700;box-shadow:0 2px 10px #0006;z-index:9999;');
  el.textContent = text;
  el.style.display = 'inline-block';
}

export function setLoading(on=true, label='Loading...'){
  const el = ensureBadge('loadingBadge', 'position:fixed;right:12px;bottom:12px;background:#1f4f8f;color:#fff;border:1px solid #295ea8;border-radius:10px;padding:8px 12px;font-weight:600;box-shadow:0 2px 10px #0006;z-index:9999;');
  el.textContent = on ? label : '';
  el.style.display = on ? 'inline-block' : 'none';
}

export function toast(message, type='info', {timeout=2600}={}){
  const host = ensureBadge('toastHost', 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;');
  const item = document.createElement('div');
  item.className = 'toast-item';
  item.style.cssText = 'background:#111c;color:#fff;border:1px solid #444;border-radius:10px;padding:10px 14px;box-shadow:0 4px 18px #0008;opacity:0;transform:translateY(8px);transition:opacity .15s ease, transform .15s ease; pointer-events:auto;';
  if(type==='success'){ item.style.background = '#0f3'; item.style.color='#021'; item.style.borderColor='#0c4'; }
  if(type==='error'){ item.style.background = '#c92a2a'; item.style.color='#fff'; item.style.borderColor='#a51111'; }
  if(type==='warn'){ item.style.background = '#f08c00'; item.style.color='#211'; item.style.borderColor='#b06a00'; }
  item.textContent = message;
  host.appendChild(item);
  requestAnimationFrame(()=>{ item.style.opacity='1'; item.style.transform='translateY(0)'; });
  setTimeout(()=>{
    item.style.opacity='0'; item.style.transform='translateY(8px)';
    setTimeout(()=> item.remove(), 180);
  }, timeout);
}

// ===== Tabs =====
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

  btns.forEach(b=> b.addEventListener('click', ()=> show(b.dataset.tab)));

  const byId = (id)=> document.getElementById(id);
  const wire = (id, key)=>{ const el = byId(id); if(el) el.onclick = ()=> show(key); };
  wire('mobileHome',      'home');
  wire('mobileMaterials', 'materials');
  wire('mobileCamera',    'camera');
  wire('mobileCaptions',  'captions');

  const defaultTab = tabs.has('home') ? 'home' : (tabs.has('captions') ? 'captions' : Array.from(tabs.keys())[0]);
  if(defaultTab) show(defaultTab);
}

// ===== Caption overlay & thumbnails =====
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
    return `https://drive.google.com/uc?id=${fileId}`;
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
  setStatus('READY');
  setLoading(false);
}

// 旧window互換
if(!window.__LMY) window.__LMY = {};
window.__LMY.setStatus = (t)=> setStatus(t||'READY');
