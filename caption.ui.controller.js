// [caption.ui.controller] Phase A1’ — caption UI + pin bridge + Sheets hook points
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

  // Accept both old and new ID schemes for pin color / filter chips
  const elColorList  =
    $('#caption-color-list',  pane) ||
    $('#caption-colors',      pane) ||
    $('#pinColorChips',       pane);

  const elFilterList =
    $('#caption-filter-list', pane) ||
    $('#caption-filters',     pane) ||
    $('#pinFilterChips',      pane);
  const elList  = $('#caption-list', pane);
  const elTitle = $('#caption-title', pane);
  const elBody  = $('#caption-body', pane);
  const elImgStatus = $('#images-status', pane) || $('#images-status');
  const elImages    = $('#images-grid', pane)   || $('#images-grid');

  // Stable store on window
  const store = window.__lm_capt || (window.__lm_capt = {
    currentColor: '#eab308',
    filter: new Set(),
    items: [],
    selectedId: null,
    images: [],
  });

  const PALETTE = ['#facc15','#f97316','#ef4444','#ec4899','#8b5cf6','#3b82f6','#0ea5e9','#22c55e','#14b8a6','#a3a3a3'];

  function newId(){
    return 'c_'+Math.random().toString(36).slice(2,10);
  }

  // viewer 側の onCanvasShiftPick が有効になったら true。
  // true のときは fallback(#gl click)は何もしない（ダブル追加防止）。
  let preferWorldClicks = false;

  // --- small event hub for Sheets bridge --------------------------------------
  const addListeners = [];
  const changeListeners = [];
  const dirtyTimers = new Map(); // id -> timerId

  function onItemAdded(fn){
    if (typeof fn === 'function') addListeners.push(fn);
  }
  function emitItemAdded(item){
    addListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemAdded handler failed',e); }
    });
  }

  function onItemChanged(fn){
    if (typeof fn === 'function') changeListeners.push(fn);
  }
  function emitItemChanged(item){
    changeListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemChanged handler failed',e); }
    });
  }
  function scheduleChanged(item){
    if (!item || !item.id) return;
    const id = item.id;
    const prev = dirtyTimers.get(id);
    if (prev) cancelTimeout(prev);
    const t = setTimeout(()=>{
      dirtyTimers.delete(id);
      emitItemChanged(item);
    }, 600);
    dirtyTimers.set(id, t);
  }
  function cancelTimeout(t){
    try{ clearTimeout(t); }catch(_){}
  }

  // --- Rendering helpers -------------------------------------------------------

  function renderColors(){
    if(!elColorList) return;
    elColorList.innerHTML = '';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-cap-color';
      btn.style.backgroundColor = col;
      if (store.currentColor === col) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        store.currentColor = col;
        renderColors();
      });
      elColorList.appendChild(btn);
    });
  }

  function renderFilters(){
    if(!elFilterList) return;
    elFilterList.innerHTML = '';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-cap-filter';
      btn.style.backgroundColor = col;
      if (store.filter.has(col)) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        if (store.filter.has(col)) store.filter.delete(col);
        else store.filter.add(col);
        renderFilters();
        refreshList();
      });
      elFilterList.appendChild(btn);
    });
  }

  function filteredItems(){
    const active = store.filter.size ? store.filter : null;
    if (!active) return store.items.slice();
    return store.items.filter(it => active.has(it.color));
  }

  function refreshList(){
    if(!elList) return;
    elList.innerHTML = '';
    const items = filteredItems();
    items.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'lm-cap-row';
      row.dataset.id = it.id;
      const sw = document.createElement('span');
      sw.className = 'lm-cap-sw';
      sw.style.backgroundColor = it.color || '#eab308';
      const title = document.createElement('span');
      title.className = 'lm-cap-title';
      title.textContent = it.title || '(untitled)';
      const imgMark = document.createElement('span');
      imgMark.className = 'lm-cap-imgmark';
      if (it.image && (it.image.url || it.image.id)) imgMark.textContent = '🖼';

      row.appendChild(sw);
      row.appendChild(title);
      row.appendChild(imgMark);

      if (store.selectedId === it.id) row.classList.add('selected');

      row.addEventListener('click', ()=>{
        selectItem(it.id);
      });

      elList.appendChild(row);
    });
  }

    function syncViewerSelection(id){
    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;
    try{
      br.setPinSelected(id || null, !!id);
    }catch(e){
      warn('setPinSelected failed', e);
    }
  }

function selectItem(id){
    store.selectedId = id;
    if (elList){
      $$('.lm-cap-row', elList).forEach(row=>{
        row.classList.toggle('selected', row.dataset.id === id);
      });
    }
    const it = store.items.find(x=>x.id===id);
    if(!it){
      syncViewerSelection(null);
      return;
    }
    if (elTitle) elTitle.value = it.title || '';
    if (elBody)  elBody.value  = it.body  || '';
    // 3D ピン側の選択も同期
    syncViewerSelection(it.pos ? it.id : null);
  }

  function removeItem(id){
    const idx = store.items.findIndex(x=>x.id===id);
    if(idx===-1) return;
    store.items.splice(idx,1);
    if (store.selectedId === id) store.selectedId = null;
    refreshList();
  }

  // --- Title / Body input wiring ----------------------------------------------
  if (elTitle){
    let tId = 0;
    elTitle.addEventListener('input', ()=>{
      const id = store.selectedId; if(!id) return;
      const it = store.items.find(x=>x.id===id); if(!it) return;
      it.title = elTitle.value;
      if (tId) cancelAnimationFrame(tId);
      tId = requestAnimationFrame(()=>refreshList());
      scheduleChanged(it);
    });
  }
  if (elBody){
    let bId = 0;
    elBody.addEventListener('input', ()=>{
      const id = store.selectedId; if(!id) return;
      const it = store.items.find(x=>x.id===id); if(!it) return;
      it.body = elBody.value;
      if (bId) cancelAnimationFrame(bId);
      bId = requestAnimationFrame(()=>refreshList());
      scheduleChanged(it);
    });
  }

  // --- Pin bridge helpers ------------------------------------------------------
  function getViewerBridge(){
    try{
      const pinRuntime = window.__lm_pin_runtime;
      if (pinRuntime && typeof pinRuntime.getBridge === 'function'){
        const b = pinRuntime.getBridge();
        if (b) return b;
      }
    }catch(e){}
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  function addPinForItem(item){
    const br = getViewerBridge();
    if (!br || typeof br.addPinMarker!=='function') return;
    if (!item.pos) return;
    const p = item.pos;
    try{
      br.addPinMarker({ id:item.id, x:p.x, y:p.y, z:p.z, color:item.color });
    }catch(e){ warn('addPinMarker failed', e); }
  }

  function syncPinsFromItems(){
    const br = getViewerBridge();
    if (!br || typeof br.clearPins!=='function' || typeof br.addPinMarker!=='function') return;
    try{
      br.clearPins();
      store.items.forEach(it=>{ if(it.pos) addPinForItem(it); });
    }catch(e){ warn('syncPinsFromItems failed', e); }
  }

  // --- Public entry: Shift+クリックでの追加 -----------------------------------
  function addCaptionAt(x, y, world){
    const item = {
      id: newId(),
      title: '(untitled)',
      body: '',
      color: store.currentColor,
      pos: world || null,
      image: null,
      createdAt: null,
      updatedAt: null,
    };
    store.items.push(item);
    refreshList();
    selectItem(item.id);
    log('caption added', item);
    addPinForItem(item);
    emitItemAdded(item);
  }

  // Fallback: legacy canvas click (2D only, no world pos)
  (function(){
    const canvas = document.getElementById('gl');
    if(!canvas) return;
    canvas.addEventListener('click', (e)=>{
      if(!e.shiftKey) return;
      // viewer の 3D ピックが生きているときは、こちらは無効化して二重登録を防ぐ
      if (preferWorldClicks) return;
      addCaptionAt(e.offsetX, e.offsetY, null);
    });
  })();

  // Viewer bridge: onCanvasShiftPick (3D)
  (function(){
    let hooked = false;
    function bind(){
      if (hooked) return true;
      const br = getViewerBridge();
      if (!br || typeof br.onCanvasShiftPick !== 'function') return false;
      try{
        br.onCanvasShiftPick(({x,y,z})=>{
          addCaptionAt(0,0,{x,y,z});
        });
        hooked = true;
        preferWorldClicks = true;   // 以後は 3D 側を優先
        log('onCanvasShiftPick bound');
      }catch(e){
        warn('bind onCanvasShiftPick failed', e);
      }
      return hooked;
    }
    if (!bind()){
      document.addEventListener('lm:viewer-bridge-ready', ()=>{ bind(); }, { once:true });
    }
  })();
  // Viewer bridge: onPinSelect (3D pin click -> list select)
  (function(){
    let hooked = false;
    function bind(){
      if (hooked) return true;
      const br = getViewerBridge();
      if (!br || typeof br.onPinSelect !== 'function') return false;
      try{
        br.onPinSelect((id)=>{
          if (!id) return;
          selectItem(id);
        });
        hooked = true;
        log('onPinSelect bound');
      }catch(e){
        warn('bind onPinSelect failed', e);
      }
      return hooked;
    }
    document.addEventListener('lm:viewer-bridge-ready', ()=>{ bind(); });
    window.addEventListener('lm:scene-ready', ()=>{ bind(); });
    setTimeout(bind, 2000);
  })();


  // --- Images ------------------------------------------------------------------
  function renderImages(){
    if (!elImages || !elImgStatus) return;
    const list = store.images || [];
    elImages.innerHTML = '';
    if (!list.length){
      elImgStatus.textContent = 'no registered images';
      return;
    }
    elImgStatus.textContent = `${list.length} images`;
    const grid = elImages;
    list.forEach(it=>{
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = 'lm-img-item';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = it.thumbUrl || it.url || '';
      img.alt = it.name || '';
      wrap.appendChild(img);
      wrap.addEventListener('click', ()=>{
        const id = store.selectedId;
        if(!id) return;
        const item = store.items.find(x=>x.id===id);
        if(!item) return;
        item.image = { id: it.id || null, name: it.name || null, url: it.url || null };
        refreshList();
        // 画像選択の保存は A3 で本実装予定なので、ここではまだ scheduleChanged しない
      });
      grid.appendChild(wrap);
    });
  }

  // --- API for other modules ---------------------------------------------------
  function normalizeItem(raw){
    if (!raw) raw = {};
    const id = raw.id || newId();
    const color = raw.color || '#eab308';
    let pos = raw.pos || null;
    if (!pos && raw.posX!=null && raw.posY!=null && raw.posZ!=null){
      const x = Number(raw.posX), y = Number(raw.posY), z = Number(raw.posZ);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)){
        pos = {x,y,z};
      }
    }
    return {
      id,
      title: raw.title || '',
      body: raw.body || '',
      color,
      pos,
      image: raw.image || (raw.imageFileId ? {id:raw.imageFileId} : null),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
      rowIndex: raw.rowIndex || null,
    };
  }

  function setItems(list){
    try{
      store.items = Array.isArray(list) ? list.map(normalizeItem) : [];
      refreshList();
      syncPinsFromItems();
    }catch(e){
      warn('setItems failed', e);
    }
  }

  function setImages(list){
    store.images = Array.isArray(list) ? list : [];
    renderImages();
  }

  window.__LM_CAPTION_UI = {
    addCaptionAt,
    refreshList,
    selectItem,
    removeItem,
    setItems,
    setImages,
    onItemAdded,
    onItemChanged,
    get items(){ return store.items; }
  };

  // initial render
  renderColors();
  renderFilters();
  refreshList();
  renderImages();

  log('ready');
})();
