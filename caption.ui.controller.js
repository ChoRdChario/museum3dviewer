// [caption.ui.controller] Phase A2 — caption UI + pin bridge + Sheets hooks + image attach
// Defensive: runs even if other bridges are missing.
(function(){
  if (window.__LM_CAPTION_UI && window.__LM_CAPTION_UI.__ver && String(window.__LM_CAPTION_UI.__ver).startsWith('A2')) {
    console.log('[caption.ui.controller]', 'already loaded');
    return;
  }

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
  let elPreview = $('#caption-image-preview', pane);
  if (!elPreview && elImages && elImages.parentElement){
    elPreview = document.createElement('div');
    elPreview.id = 'caption-image-preview';
    elPreview.className = 'lm-cap-preview';
    try{
      elImages.parentElement.insertBefore(elPreview, elImages);
    }catch(e){
      console.warn(TAG, 'preview insert failed', e);
    }
  }

  if (!elList || !elTitle || !elBody) {
    return warn('required elements not found; skip');
  }

  // Store (shared across reloads)
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

  function nowIso(){
    try{
      return new Date().toISOString();
    }catch(e){
      return null;
    }
  }

  // Current context (Sheet bridgeから与えられる)
  let sheetContext = null; // { spreadsheetId, sheetGid, sheetTitle, nextRowIndex }

  // ---------------------------------------------------------------------------
  // Viewer bridge helpers
  // ---------------------------------------------------------------------------
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
      // 新 API: addPinMarker({ id, position:{x,y,z}, color })
      br.addPinMarker({ id:item.id, position:{ x:p.x, y:p.y, z:p.z }, color:item.color });
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

  function syncViewerSelection(id, opts){
    const options = opts || {};
    const fromViewer = !!(options && options.fromViewer);
    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;

    // ビューア側から来た選択イベントは「送り返さない」
    // （無限 pinSelect ループ防止）
    if (fromViewer) return;

    try{
      br.setPinSelected(id || null, !!id);
    }catch(e){
      warn('syncViewerSelection failed', e);
    }
  }

  // --- colors / filters -------------------------------------------------------
  function renderColors(){
    if (!elColorList) return;
    elColorList.innerHTML = '';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-pin-color-chip';
      btn.dataset.color = col;
      btn.style.backgroundColor = col;
      if (store.currentColor === col){
        btn.classList.add('selected');
      }
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
    const colors = PALETTE;
    colors.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-pin-filter-chip';
      btn.dataset.color = col;
      btn.style.backgroundColor = col;
      if (store.filter.has(col)){
        btn.classList.add('active');
      }
      btn.addEventListener('click', ()=>{
        if (store.filter.has(col)){
          store.filter.delete(col);
        }else{
          store.filter.add(col);
        }
        renderFilters();
        renderList();
      });
      elFilterList.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'lm-pin-filter-chip lm-pin-filter-clear';
    clearBtn.textContent = 'All';
    if (store.filter.size === 0){
      clearBtn.classList.add('active');
    }
    clearBtn.addEventListener('click', ()=>{
      store.filter.clear();
      renderFilters();
      renderList();
    });
    elFilterList.appendChild(clearBtn);
  }

  function filterItemsForView(){
    if (!store.filter || store.filter.size === 0) return store.items.slice();
    return store.items.filter(it=>store.filter.has(it.color));
  }

  // --- list rendering ---------------------------------------------------------
  function renderList(){
    if (!elList) return;
    elList.innerHTML = '';

    const items = filterItemsForView();
    if (!items || items.length === 0){
      const empty = document.createElement('div');
      empty.className = 'lm-caption-empty';
      empty.textContent = 'No captions yet.';
      elList.appendChild(empty);
      return;
    }

    items.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'lm-caption-row';
      row.dataset.id = it.id;

      const dot = document.createElement('span');
      dot.className = 'lm-caption-dot';
      dot.style.backgroundColor = it.color || '#eab308';

      const title = document.createElement('div');
      title.className = 'lm-caption-title';
      title.textContent = it.title || '(untitled)';

      const body = document.createElement('div');
      body.className = 'lm-caption-body-preview';
      body.textContent = it.body || '';

      row.appendChild(dot);
      row.appendChild(title);
      row.appendChild(body);

      if (store.selectedId === it.id){
        row.classList.add('selected');
      }

      row.addEventListener('click', ()=>{
        selectItem(it.id, { fromList:true });
      });

      elList.appendChild(row);
    });
  }

  function findItem(id){
    return store.items.find(it=>it.id === id) || null;
  }

  function setSelection(id, opts){
    const options = opts || {};
    const fromViewer = !!options.fromViewer;

    store.selectedId = id || null;
    renderList();

    const item = id ? findItem(id) : null;
    if (item){
      elTitle.value = item.title || '';
      elBody.value  = item.body || '';
      if (item.imageFileId){
        highlightThumbnail(item.imageFileId);
      }else{
        clearPreview();
      }
    }else{
      elTitle.value = '';
      elBody.value  = '';
      clearPreview();
    }

    // viewer 側への同期（viewer→UI のときは送らない）
    if (!fromViewer){
      syncViewerSelection(id, { fromViewer:false });
    }
  }

  function selectItem(id, opts){
    setSelection(id, opts || {});
  }

  // --- preview / images -------------------------------------------------------
  function clearPreview(){
    if (!elPreview) return;
    elPreview.innerHTML = '';
    elPreview.style.display = 'none';
  }

  function renderPreview(fileId){
    if (!elPreview){
      clearPreview();
      return;
    }
    elPreview.innerHTML = '';
    if (!fileId){
      elPreview.style.display = 'none';
      return;
    }

    const img = document.createElement('img');
    img.className = 'lm-cap-preview-img';
    img.loading = 'lazy';
    img.alt = '';
    img.src = `https://drive.google.com/thumbnail?sz=w512-h512&id=${encodeURIComponent(fileId)}`;
    img.addEventListener('error', ()=>{
      elPreview.style.display = 'none';
    });
    elPreview.appendChild(img);
    elPreview.style.display = '';
  }

  function highlightThumbnail(fileId){
    if (!elImages) return;
    const thumbs = $$('.lm-cap-image-thumb', elImages);
    thumbs.forEach(th=>{
      const fid = th.dataset.fileId || '';
      if (fid === fileId){
        th.classList.add('selected');
      }else{
        th.classList.remove('selected');
      }
    });
    renderPreview(fileId);
  }

  function setImages(images){
    store.images = images || [];
    if (!elImages) return;
    elImages.innerHTML = '';

    if (!images || images.length === 0){
      if (elImgStatus){
        elImgStatus.textContent = 'No images found in GLB folder.';
      }
      return;
    }

    images.forEach(img=>{
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'lm-cap-image-thumb';
      el.dataset.fileId = img.id;
      el.title = img.name || '';
      el.style.backgroundImage = `url("https://drive.google.com/thumbnail?sz=w128-h128&id=${encodeURIComponent(img.id)}")`;
      el.addEventListener('click', ()=>{
        const item = store.selectedId ? findItem(store.selectedId) : null;
        if (!item) return;
        item.imageFileId = img.id;
        highlightThumbnail(img.id);
        renderPreview(img.id);
        emitChange(item, { field:'imageFileId' });
      });
      elImages.appendChild(el);
    });

    if (elImgStatus){
      elImgStatus.textContent = `${images.length} images`;
    }

    // selection に紐づくプレビューを再描画
    const cur = store.selectedId ? findItem(store.selectedId) : null;
    if (cur && cur.imageFileId){
      highlightThumbnail(cur.imageFileId);
    }else{
      clearPreview();
    }
  }

  function setImageStatus(text){
    if (!elImgStatus) return;
    elImgStatus.textContent = text || '';
  }

  // --- item helpers -----------------------------------------------------------
  function normalizePos(raw){
    if (!raw) return null;
    if (typeof raw.x === 'number' && typeof raw.y === 'number' && typeof raw.z === 'number'){
      return { x:raw.x, y:raw.y, z:raw.z };
    }
    if (Array.isArray(raw) && raw.length >= 3){
      const [x,y,z] = raw;
      if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number'){
        return { x, y, z };
      }
    }
    return null;
  }

  function normalizeItem(raw){
    if (!raw) return null;
    const pos = normalizePos(raw.pos || raw.position || null);
    const imageFileId = raw.imageFileId || raw.imageId || null;
    const image = raw.image || null;
    return {
      id: String(raw.id || newId()),
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
    store.items = Array.isArray(items)
      ? items.map(normalizeItem).filter(Boolean)
      : [];
    renderList();
    syncPinsFromItems();
  }

  function upsertItem(newItem){
    const idx = store.items.findIndex(it=>it.id === newItem.id);
    if (idx >= 0){
      store.items.splice(idx,1,newItem);
    }else{
      store.items.push(newItem);
    }
    renderList();
    syncPinsFromItems();
  }

  function removeItem(id){
    const idx = store.items.findIndex(it=>it.id === id);
    if (idx < 0) return;
    store.items.splice(idx,1);
    if (store.selectedId === id){
      store.selectedId = null;
      elTitle.value = '';
      elBody.value  = '';
      clearPreview();
    }
    renderList();
    syncPinsFromItems();
  }

  // --- events to outside (Sheet bridge 等) ------------------------------------
  const emitter = (function(){
    const listeners = {};
    return {
      on(ev, fn){
        if (!listeners[ev]) listeners[ev] = new Set();
        listeners[ev].add(fn);
        return ()=>listeners[ev].delete(fn);
      },
      emit(ev, payload){
        (listeners[ev] || []).forEach(fn=>{
          try{ fn(payload); }catch(e){ warn('listener error', e); }
        });
      }
    };
  })();

  function on(ev, fn){ return emitter.on(ev, fn); }

  function emitChange(item, opts){
    emitter.emit('change', { item, opts:opts || {} });
  }

  function emitAdd(item, opts){
    emitter.emit('itemAdded', { item, opts:opts || {} });
  }

  function emitDelete(id, opts){
    emitter.emit('itemDeleted', { id, opts:opts || {} });
  }

  // --- form handlers ----------------------------------------------------------
  function handleTitleChange(){
    const id = store.selectedId;
    if (!id) return;
    const item = findItem(id);
    if (!item) return;
    item.title = elTitle.value || '';
    item.updatedAt = nowIso();
    upsertItem(item);
    emitChange(item, { field:'title' });
  }

  function handleBodyChange(){
    const id = store.selectedId;
    if (!id) return;
    const item = findItem(id);
    if (!item) return;
    item.body = elBody.value || '';
    item.updatedAt = nowIso();
    upsertItem(item);
    emitChange(item, { field:'body' });
  }

  // --- add caption ------------------------------------------------------------
  let lastClickPos = { x:0.5, y:0.5 };  // fallback のスクリーン座標
  let preferWorldClicks = false;
  let worldHookInstalled = false;

  function addCaptionAt(screenX, screenY, worldPos){
    const id   = newId();
    const now  = nowIso();
    const pos  = normalizePos(worldPos) || null;

    const item = {
      id,
      title: '',
      body: '',
      color: store.currentColor || '#eab308',
      pos,
      imageFileId: null,
      image: null,
      createdAt: now,
      updatedAt: now,
      rowIndex: null
    };

    upsertItem(item);
    selectItem(id);

    // viewer 側 pin 追加
    addPinForItem(item);

    emitAdd(item, { screen:{x:screenX,y:screenY}, world:pos });
  }

  // --- DOM events -------------------------------------------------------------
  elTitle.addEventListener('change', handleTitleChange);
  elBody.addEventListener('change', handleBodyChange);

  if (elRefreshImg){
    elRefreshImg.addEventListener('click', ()=>{
      try{
        const ev = new CustomEvent('lm:caption-images-refresh', { bubbles:true });
        elRefreshImg.dispatchEvent(ev);
      }catch(e){
        warn('refresh images event failed', e);
      }
    });
  }

  // viewer overlay からのクリック座標を受け取る（fallback 用）
  document.addEventListener('lm:caption-screen-click', (ev)=>{
    if (!ev || !ev.detail) return;
    const d = ev.detail;
    if (typeof d.x === 'number' && typeof d.y === 'number'){
      lastClickPos = { x:d.x, y:d.y };
    }
  }, { passive:true });

  function handleCanvasShiftClick(ev){
    if (preferWorldClicks) return; // world-space hook が優先
    const pos = lastClickPos || { x:0.5, y:0.5 };
    addCaptionAt(pos.x, pos.y, null);
  }

  function installFallbackClick(){
    const canvas = document.querySelector('canvas#gl');
    if (!canvas) return;
    canvas.addEventListener('click', (ev)=>{
      if (!ev.shiftKey) return;
      handleCanvasShiftClick(ev);
    }, { passive:true });
  }

  function tryInstallWorldSpaceHook(){
    if (worldHookInstalled) return;
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick !== 'function') return;
    try{
      br.onCanvasShiftPick((payload)=>{
        if (!payload) return;
        const world = payload.point || payload;
        if (!world || typeof world.x !== 'number' || typeof world.y !== 'number' || typeof world.z !== 'number') {
          log('onCanvasShiftPick payload missing numeric point', payload);
          return;
        }
        preferWorldClicks = true;
        addCaptionAt(0.5, 0.5, { x: world.x, y: world.y, z: world.z });
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
    __ver: 'A2-20251211',
    on,
    setItems,
    setSelection,
    setImages,
    setImageStatus,
    getStore(){
      return store;
    },
    setSheetContext(ctx){
      sheetContext = ctx || null;
    }
  };

  log('ready');
})();
