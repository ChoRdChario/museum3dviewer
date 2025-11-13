
// [caption.ui.controller] minimal UI wiring (phase A0)
// Defensive: runs even if other bridges are missing.
(function(){
  const TAG='[caption.ui.controller]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  // Helpers
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$ = (sel,root=document)=>Array.from(root.querySelectorAll(sel));

  // Root hooks
  const pane = $('#pane-caption');
  if(!pane){ return warn('pane not found; skip'); }

  const elColor = $('#pinColorChips');
  const elFilter = $('#pinFilterChips');
  const elList = $('#caption-list');
  const elTitle = $('#caption-title');
  const elBody = $('#caption-body');
  const elImages = $('#images-grid');
  const elImgStatus = $('#images-status');

  // Stable store on window for now (Phase A0 → will be replaced by sheet bridge)
  const store = window.__lm_capt || (window.__lm_capt = {
    currentColor: '#eab308',
    filter: new Set(),
    items: [],
    selectedId: null,
    images: [],
  });

  // Color palette (legacy-compatible 10 colors)
  const PALETTE = ['#eab308','#a3e635','#60a5fa','#a78bfa','#93c5fd','#fda4af','#c084fc','#a3a3a3','#f97316','#22c55e'];

  function renderChips(target, palette, onPick){
    target.innerHTML='';
    palette.forEach(col=>{
      const b = document.createElement('button');
      b.type='button'; b.className='chip'; b.title=col; b.style.background=col;
      b.addEventListener('click',()=>onPick(col,b));
      target.appendChild(b);
    });
  }

  // Pin color picker
  renderChips(elColor, PALETTE, (col,btn)=>{
    store.currentColor = col;
    $$('.chip', elColor).forEach(x=>x.style.outline='none');
    btn.style.outline = '2px solid #fff5';
    log('pin color =', col);
  });
  // Select first as default outline
  const firstColorBtn = $('.chip', elColor);
  if(firstColorBtn) firstColorBtn.style.outline='2px solid #fff5';

  // Filter chips (same palette + All/None)
  (function(){
    const wrap = document.createElement('div');
    wrap.style.display='flex'; wrap.style.flexWrap='wrap'; wrap.style.gap='6px';
    const mk = (label, cb) => {
      const b=document.createElement('button');
      b.textContent=label; b.className='chip'; b.style.width='auto'; b.style.borderRadius='12px'; b.style.padding='0 8px';
      b.addEventListener('click',cb); return b;
    };
    const allBtn = mk('All', ()=>{ store.filter.clear(); refreshList(); });
    const noneBtn = mk('None', ()=>{ store.filter = new Set(PALETTE); refreshList(); });
    wrap.appendChild(allBtn); wrap.appendChild(noneBtn);
    elFilter.appendChild(wrap);
    renderChips(elFilter, PALETTE, (col,btn)=>{
      if(store.filter.has(col)) store.filter.delete(col); else store.filter.add(col);
      btn.style.outline = store.filter.has(col) ? '2px solid #fff5' : 'none';
      refreshList();
    });
  })();

  // Item utilities
  const newId = ()=> 'cap_'+Math.random().toString(36).slice(2,9);

  function selectItem(id){
    store.selectedId = id;
    $$('.item', elList).forEach(li=>{
      li.style.background = (li.dataset.id===id) ? '#111827' : 'transparent';
      li.style.borderLeft = (li.dataset.id===id) ? '3px solid #60a5fa' : '3px solid transparent';
    });
    const it = store.items.find(x=>x.id===id);
    elTitle.value = it ? (it.title||'') : '';
    elBody.value = it ? (it.body||'') : '';
  }

  function removeItem(id){
    const idx = store.items.findIndex(x=>x.id===id);
    if(idx>=0){ store.items.splice(idx,1); }
    if(store.selectedId===id) store.selectedId=null;
    refreshList();
  }

  function renderItem(it){
    const li = document.createElement('div');
    li.className='item'; li.dataset.id = it.id;
    li.style.padding='8px'; li.style.border='1px solid #1f2937'; li.style.borderRadius='8px';
    li.style.margin='6px'; li.style.display='grid'; li.style.gridTemplateColumns='1fr auto'; li.style.alignItems='center';
    const text = document.createElement('div');
    const title = (it.title||'(untitled)');
    const body = (it.body||'(no description)');
    text.innerHTML = `<div style="font-weight:600">${title}</div><div style="opacity:.7">${body}</div>`;
    const del = document.createElement('button'); del.textContent='×'; del.title='Delete'; del.style.width='28px'; del.style.height='28px';
    del.addEventListener('click',e=>{ e.stopPropagation(); removeItem(it.id); });
    li.appendChild(text); li.appendChild(del);
    li.addEventListener('click',()=>selectItem(it.id));
    return li;
  }

  function refreshList(){
    elList.innerHTML='';
    const filtered = store.items.filter(it => !store.filter.size || !store.filter.has(it.color));
    if(!filtered.length){
      const empty = document.createElement('div');
      empty.className='muted'; empty.style.padding='8px 10px'; empty.textContent='(no captions)';
      elList.appendChild(empty);
    } else {
      filtered.forEach(it=> elList.appendChild(renderItem(it)));
    }
    if(store.selectedId && !store.items.some(i=>i.id===store.selectedId)){
      store.selectedId = null;
    }
  }

  // Title/Body binding (debounced update)
  let tId=null; let bId=null;
  elTitle.addEventListener('input', ()=>{
    const id = store.selectedId; if(!id) return;
    const it = store.items.find(x=>x.id===id); if(!it) return;
    it.title = elTitle.value;
    if(tId) cancelAnimationFrame(tId);
    tId = requestAnimationFrame(()=>refreshList());
  });
  elBody.addEventListener('input', ()=>{
    const id = store.selectedId; if(!id) return;
    const it = store.items.find(x=>x.id===id); if(!it) return;
    it.body = elBody.value;
    if(bId) cancelAnimationFrame(bId);
    bId = requestAnimationFrame(()=>refreshList());
  });

  // Shift+Click to add a pin + caption (placeholder; viewer bridge hookup later)
  function addCaptionAt(x,y, world){
    const item = { id:newId(), title:'(untitled)', body:'', color:store.currentColor, pos: world||null };
    store.items.push(item);
    refreshList();
    selectItem(item.id);
    log('caption added', item);
    // Bridge (if present)
    try {
      const maybe = window.__lm_viewer_bridge;
      if(maybe && typeof maybe.addPinMarker === 'function'){
        maybe.addPinMarker(item);
      }
    } catch(e){ /* ignore */ }
  }

  // Fallback: listen canvas shift-click
  (function(){
    const canvas = document.getElementById('gl');
    if(!canvas){ return; }
    canvas.addEventListener('click', (e)=>{
      if(!e.shiftKey) return;
      addCaptionAt(e.offsetX, e.offsetY, null);
    });
  })();

  // Public API for other modules
  window.__LM_CAPTION_UI = {
    addCaptionAt, refreshList, selectItem, removeItem,
    get items(){ return store.items; },
    setImages(list){ store.images = Array.isArray(list)? list : []; renderImages(); }
  };

  // Initial render
  refreshList();
  renderImages();

  function renderImages(){
    elImages.innerHTML='';
    const imgs = store.images || [];
    if(!imgs.length){
      elImgStatus.textContent = 'No Image';
      return;
    }
    elImgStatus.textContent = '';
    const grid = elImages;
    imgs.forEach(it=>{
      const wrap = document.createElement('button');
      wrap.type='button'; wrap.style.width='74px'; wrap.style.height='74px';
      wrap.style.borderRadius='10px'; wrap.style.overflow='hidden'; wrap.style.border='1px solid #1f2937';
      wrap.style.padding=0; wrap.style.background='#0b0d11';
      const img = document.createElement('img');
      img.src = it.thumb || it.url || it.src || '';
      img.alt = it.name || '';
      img.style.width='100%'; img.style.height='100%'; img.style.objectFit='cover';
      wrap.appendChild(img);
      wrap.addEventListener('click', ()=>{
        const id = store.selectedId;
        if(!id) return;
        const item = store.items.find(x=>x.id===id);
        if(!item) return;
        item.image = { id: it.id || null, name: it.name || null, url: it.url || null };
        refreshList();
      });
      grid.appendChild(wrap);
    });
  }

  log('ready');
})();
