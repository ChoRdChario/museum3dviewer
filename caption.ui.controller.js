// [caption.ui.controller] Phase A2 — caption UI + pin bridge + Sheets hooks + image attach
// Defensive: runs even if other bridges are missing.
(function(){
  const TAG='[caption.ui.controller]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);

  // Helpers
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$ = (sel,root=document)=>Array.from(root.querySelectorAll(sel));

  // Root hooks
  const pane = $('#pane-caption');
  if(!pane){
    return warn('pane not found; skip');
  }

  // Elements
  const elColorList  = $('#pinColorChips', pane);
  const elFilterList = $('#pinFilterChips', pane);
  const elList       = $('#caption-list', pane);
  const elTitle      = $('#caption-title', pane);
  const elBody       = $('#caption-body', pane);
  const elImages     = $('#images-grid', pane);
  const elImgStatus  = $('#images-status', pane);
  const elRefreshImg = $('#btnRefreshImages', pane);

  // Store (stable on window to survive reload of this script)
  const store = window.__LM_CAPTION_STORE || (window.__LM_CAPTION_STORE = {
    currentColor: '#eab308',
    filter: new Set(),
    items: [],
    selectedId: null,
    images: []
  });

  const PALETTE = ['#facc15','#f97316','#ef4444','#ec4899','#8b5cf6','#3b82f6','#0ea5e9','#22c55e','#14b8a6','#a3a3a3'];

  function newId(){
    return 'c_' + Math.random().toString(36).slice(2,10);
  }

  // --- small event hub for Sheets bridge --------------------------------------
  const addListeners = [];
  const changeListeners = [];
  const deleteListeners = [];
  const dirtyTimers = new Map(); // id -> raf id

  function onItemAdded(fn){
    if (typeof fn === 'function') addListeners.push(fn);
  }
  function emitItemAdded(item){
    addListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemAdded handler failed', e); }
    });
  }

  function onItemChanged(fn){
    if (typeof fn === 'function') changeListeners.push(fn);
  }
  function emitItemChanged(item){
    changeListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemChanged handler failed', e); }
    });
  }
  function scheduleChanged(item){
    if (!item || !item.id) return;
    const id = item.id;
    const prev = dirtyTimers.get(id);
    if (prev) cancelAnimationFrame(prev);
    const t = requestAnimationFrame(()=>{
      dirtyTimers.delete(id);
      emitItemChanged(item);
    });
    dirtyTimers.set(id, t);
  }

  function onItemDeleted(fn){
    if (typeof fn === 'function') deleteListeners.push(fn);
  }
  function emitItemDeleted(item){
    deleteListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemDeleted handler failed', e); }
    });
  }

  // --- viewer bridge + pins ---------------------------------------------------
  function getViewerBridge(){
    try{
      const pr = window.__lm_pin_runtime;
      if (pr && typeof pr.getBridge === 'function'){
        const b = pr.getBridge();
        if (b) return b;
      }
    }catch(e){}
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  function addPinForItem(item){
    const br = getViewerBridge();
    if (!br || typeof br.addPinMarker !== 'function') return;
    if (!item.pos) return;
    const p = item.pos;
    try{
      br.addPinMarker({ id:item.id, x:p.x, y:p.y, z:p.z, color:item.color });
    }catch(e){
      warn('addPinMarker failed', e);
    }
  }

  function syncPinsFromItems(){
    const br = getViewerBridge();
    if (!br || typeof br.clearPins !== 'function' || typeof br.addPinMarker !== 'function') return;
    try{
      br.clearPins();
      store.items.forEach(it=>{ if (it.pos) addPinForItem(it); });
    }catch(e){
      warn('syncPinsFromItems failed', e);
    }
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

  // --- colors / filters -------------------------------------------------------
  function renderColors(){
    if (!elColorList) return;
    elColorList.innerHTML = '';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
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
    if (!elFilterList) return;
    elFilterList.innerHTML = '';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
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

  // --- caption list -----------------------------------------------------------
  function refreshList(){
    if (!elList) return;
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
      if (it.imageFileId || (it.image && (it.image.id || it.image.url))) imgMark.textContent = '🖼';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'lm-cap-del';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        removeItem(it.id);
      });

      row.appendChild(sw);
      row.appendChild(title);
      row.appendChild(imgMark);
      row.appendChild(delBtn);

      if (store.selectedId === it.id) row.classList.add('selected');

      row.addEventListener('click', ()=>{
        selectItem(it.id);
      });

      elList.appendChild(row);
    });
  }

  function selectItem(id){
    store.selectedId = id || null;
    if (elList){
      $$('.lm-cap-row', elList).forEach(row=>{
        row.classList.toggle('selected', row.dataset.id === id);
      });
    }
    const it = store.items.find(x=>x.id===id);
    if (!it){
      syncViewerSelection(null);
      if (elTitle) elTitle.value = '';
      if (elBody)  elBody.value  = '';
      renderImages(); // clear image selection highlight
      return;
    }
    if (elTitle) elTitle.value = it.title || '';
    if (elBody)  elBody.value  = it.body  || '';
    syncViewerSelection(it.pos ? it.id : null);
    renderImages(); // update image highlight for this caption
  }

  function removeItem(id){
    const idx = store.items.findIndex(x=>x.id===id);
    if (idx === -1) return;
    const removed = store.items.splice(idx,1)[0] || null;
    if (store.selectedId === id) store.selectedId = null;

    // 3D ピンも削除／再構築
    try{
      const br = getViewerBridge();
      if (br){
        if (typeof br.removePinMarker === 'function'){
          br.removePinMarker(id);
        }else if (typeof br.clearPins === 'function' && typeof br.addPinMarker === 'function'){
          syncPinsFromItems();
        }
      }
    }catch(e){
      warn('removePinMarker failed', e);
    }

    // Sheets へ削除通知（ソフトデリートは caption.sheet.bridge 側）
    if (removed && removed.id){
      emitItemDeleted(removed);
    }else{
      emitItemDeleted({ id });
    }

    refreshList();
    renderImages();
  }

  // --- Title / Body input wiring ----------------------------------------------
  if (elTitle){
    let rafId = 0;
    elTitle.addEventListener('input', ()=>{
      const id = store.selectedId; if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.title = elTitle.value;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(()=>refreshList());
      scheduleChanged(it);
    });
  }

  if (elBody){
    let rafId = 0;
    elBody.addEventListener('input', ()=>{
      const id = store.selectedId; if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.body = elBody.value;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(()=>{});
      scheduleChanged(it);
    });
  }

  // --- Images grid ------------------------------------------------------------
  function getSelectedItem(){
    if (!store.selectedId) return null;
    return store.items.find(x=>x.id === store.selectedId) || null;
  }

  function renderImages(){
    if (!elImages) return;
    const list = store.images || [];
    elImages.innerHTML = '';
    const selected = getSelectedItem();
    const selectedImageId = selected && (selected.imageFileId || (selected.image && selected.image.id));

    if (!list.length){
      if (elImgStatus) elImgStatus.textContent = '画像はまだありません';
      return;
    }

    if (elImgStatus) elImgStatus.textContent = `${list.length} 枚の画像`;

    list.forEach(imgInfo=>{
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = 'lm-img-item';
      wrap.dataset.id = imgInfo.id;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = imgInfo.thumbUrl || imgInfo.thumbnailUrl || imgInfo.url || '';
      img.alt = imgInfo.name || '';
      wrap.appendChild(img);

      const label = document.createElement('div');
      label.className = 'lm-img-label';
      label.textContent = imgInfo.name || '(image)';
      wrap.appendChild(label);

      if (selectedImageId && selectedImageId === imgInfo.id){
        wrap.classList.add('active');
      }

      wrap.addEventListener('click', ()=>{
        const cur = getSelectedItem();
        if (!cur){
          log('image click ignored (no caption selected)');
          return;
        }
        cur.imageFileId = imgInfo.id;
        cur.image = imgInfo;
        scheduleChanged(cur);
        refreshList();   // 🖼 マーク更新
        renderImages();  // ハイライト更新
      });

      elImages.appendChild(wrap);
    });
  }

  if (elRefreshImg){
    elRefreshImg.addEventListener('click', ()=>{
      try{
        document.dispatchEvent(new Event('lm:refresh-images'));
      }catch(e){
        warn('refresh-images event failed', e);
      }
    });
  }

  // --- Public API for other modules -------------------------------------------
  function normalizeItem(raw){
    raw = raw || {};
    const id = raw.id || newId();
    const pos = raw.pos || (raw.x!=null && raw.y!=null && raw.z!=null
      ? { x:Number(raw.x), y:Number(raw.y), z:Number(raw.z) }
      : null);
    const imageFileId = raw.imageFileId || (raw.image && raw.image.id) || null;
    const image = raw.image || null;
    return {
      id,
      title: raw.title || '',
      body: raw.body || '',
      color: raw.color || '#eab308',
      pos,
      imageFileId,
      image,
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
      rowIndex: raw.rowIndex || null
    };
  }

  function setItems(items){
    store.items = (items || []).map(normalizeItem);
    refreshList();
    syncPinsFromItems();
    renderImages();
  }

  function setImages(images){
    store.images = images || [];
    renderImages();
  }

  // --- caption creation --------------------------------------------------------
  let preferWorldClicks = false;
  let worldHookInstalled = false;

  function addCaptionAt(x, y, world){
    const now = new Date().toISOString();
    const item = {
      id: newId(),
      title: '(untitled)',
      body: '',
      color: store.currentColor,
      pos: world || null,
      imageFileId: null,
      image: null,
      createdAt: now,
      updatedAt: now,
      rowIndex: null
    };
    store.items.push(item);
    refreshList();
    selectItem(item.id);
    addPinForItem(item);
    emitItemAdded(item);
  }

  // fallback click: GL canvas 上の Shift+クリック
  function installFallbackClick(){
    const area = document.getElementById('gl') ||
                 document.querySelector('#viewer,#glCanvas,#glcanvas');
    if (!area) return;
    area.addEventListener('click', (ev)=>{
      if (!ev.shiftKey) return;
      if (preferWorldClicks) return; // viewer 側で world 座標を扱う場合はそちらを優先
      const rect = area.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      addCaptionAt(x, y, null);
    });
  }

  function tryInstallWorldSpaceHook(){
    if (worldHookInstalled) return;
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick !== 'function') return;
    try{
      br.onCanvasShiftPick((world)=>{
        if (!world) return;
        preferWorldClicks = true;
        addCaptionAt(0.5, 0.5, world);
      });
      worldHookInstalled = true;
      log('world-space hook installed');
    }catch(e){
      warn('onCanvasShiftPick hook failed', e);
    }
  }

  installFallbackClick();
  tryInstallWorldSpaceHook();
  document.addEventListener('lm:viewer-bridge-ready', tryInstallWorldSpaceHook, { passive:true });
  window.addEventListener('lm:scene-ready',            tryInstallWorldSpaceHook, { passive:true });

  // Expose UI API
  window.__LM_CAPTION_UI = {
    addCaptionAt,
    refreshList,
    selectItem,
    removeItem,
    setItems,
    setImages,
    onItemAdded,
    onItemChanged,
    onItemDeleted,
    registerDeleteListener: onItemDeleted,
    get items(){ return store.items; }
  };

  // initial render
  renderColors();
  renderFilters();
  refreshList();
  renderImages();

  try{
    document.dispatchEvent(new Event('lm:caption-ui-ready'));
  }catch(_){}
  log('ready');
})();