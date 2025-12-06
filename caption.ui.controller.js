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

  // Preview renderer (v6.6 stub)
  // Legacy callers expect renderPreview() to exist, but the dedicated
  // preview pane UI has been retired. This stub keeps the call safe
  // without changing any behaviour.
  function renderPreview() {
    // no-op on purpose
  }

  // Helpers
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$ = (sel,root=document)=>Array.from(root.querySelectorAll(sel));

  const COLORS = [
    '#f97373','#facc15','#4ade80','#22c55e',
    '#38bdf8','#60a5fa','#a855f7','#f97316',
    '#ec4899','#8b5cf6','#0ea5e9','#22c55e'
  ];

  const FILTERS = [
    {id:'all', label:'All'},
    {id:'img', label:'With image'},
    {id:'noimg', label:'No image'}
  ];

  const store = {
    items: [],
    images: [],
    selectedId: null,
    filterId: 'all'
  };

  // ★ グローバルストアとして公開（設計どおりに戻す）
  // 他モジュール（overlay など）やデバッグ用に参照可能にする。
  window.__LM_CAPTION_STORE = store;

  const addListeners = [];
  const changeListeners = [];
  const deleteListeners = [];
  const selectListeners = [];

  function getViewerBridge(){
    try{
      if (window.__lm_pin_runtime && typeof window.__lm_pin_runtime.getViewerBridge === 'function') {
        return window.__lm_pin_runtime.getViewerBridge();
      }
    }catch(e){
      warn('pin-runtime bridge lookup failed', e);
    }
    try{
      if (window.__lm_viewer_bridge) return window.__lm_viewer_bridge;
      if (window.viewerBridge) return window.viewerBridge;
    }catch(e){
      warn('viewer bridge lookup failed', e);
    }
    return null;
  }

  function getPinRuntime(){
    return window.__lm_pin_runtime || null;
  }

  function setItems(items){
    store.items = Array.isArray(items) ? items.slice() : [];
    refreshList();
    syncPinsFromItems();
  }

  function setImages(images){
    store.images = Array.isArray(images) ? images.slice() : [];
    renderImages();
  }

  function setSelectedId(id){
    store.selectedId = id;
    refreshListSelection();
    syncPinsSelection();
  }

  function findItem(id){
    return store.items.find(it=>it.id===id) || null;
  }

  function upsertItem(item){
    const idx = store.items.findIndex(it=>it.id===item.id);
    if (idx === -1) {
      store.items.push(item);
      emitItemAdded(item);
    } else {
      store.items[idx] = item;
      emitItemChanged(item);
    }
    refreshList();
    syncPinsFromItems();
  }

  function removeItem(id){
    const idx = store.items.findIndex(it=>it.id===id);
    if (idx === -1) return;
    const [item] = store.items.splice(idx,1);
    if (store.selectedId === id) store.selectedId = null;
    refreshList();
    syncPinsFromItems();
    emitItemDeleted(item);
  }

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

  function onItemDeleted(fn){
    if (typeof fn === 'function') deleteListeners.push(fn);
  }
  function emitItemDeleted(item){
    deleteListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemDeleted handler failed', e); }
    });
  }

  function onItemSelected(fn){
    if (typeof fn === 'function') selectListeners.push(fn);
  }
  function emitItemSelected(item){
    selectListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemSelected handler failed', e); }
    });
  }

  // DOM refs
  const root = document.querySelector('#pane-caption') || document.body;
  const elColorChips = root.querySelector('#pinColorChips');
  const elFilterChips = root.querySelector('#pinFilterChips');
  const elList = root.querySelector('#caption-list');
  const elTitle = root.querySelector('#caption-title');
  const elBody  = root.querySelector('#caption-body');
  const elImagesGrid = root.querySelector('#images-grid');
  const elImagesStatus = root.querySelector('#images-status');

  if (!elColorChips || !elFilterChips || !elList || !elTitle || !elBody) {
    warn('essential elements missing; skip init', {
      elTitle: !!elTitle,
      elBody: !!elBody,
      elList: !!elList
    });
    return;
  }

  let currentColor = COLORS[0];

  function renderColors(){
    elColorChips.innerHTML = '';
    COLORS.forEach(c=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.style.background = c;
      if (c === currentColor) b.style.boxShadow = '0 0 0 2px #fff';
      b.addEventListener('click', ()=>{
        currentColor = c;
        renderColors();
      });
      elColorChips.appendChild(b);
    });
  }

  function renderFilters(){
    elFilterChips.innerHTML = '';
    FILTERS.forEach(f=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = f.label;
      b.className = 'pill' + (store.filterId === f.id ? ' active':'');
      b.addEventListener('click', ()=>{
        store.filterId = f.id;
        renderFilters();
        refreshList();
      });
      elFilterChips.appendChild(b);
    });
  }

  function makeRow(item){
    const row = document.createElement('div');
    row.className = 'lm-cap-row';
    row.dataset.id = item.id;

    const sw = document.createElement('div');
    sw.className = 'lm-cap-sw';
    sw.style.background = item.color || '#60a5fa';

    const title = document.createElement('div');
    title.className = 'lm-cap-title';
    title.textContent = item.title || '(untitled)';

    const imgMark = document.createElement('div');
    imgMark.className = 'lm-cap-imgmark';
    imgMark.textContent = item.imageFileId ? '🖼' : '';

    const delBtn = document.createElement('button');
    delBtn.className = 'lm-cap-del';
    delBtn.textContent = '×';

    row.appendChild(sw);
    row.appendChild(title);
    row.appendChild(imgMark);
    row.appendChild(delBtn);

    row.addEventListener('click', (ev)=>{
      if (ev.target === delBtn) return;
      setSelectedId(item.id);
      emitItemSelected(item);
      elTitle.value = item.title || '';
      elBody.value  = item.body  || '';
    });

    delBtn.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      if (confirm('Delete this caption?')) {
        removeItem(item.id);
      }
    });

    return row;
  }

  function applyFilter(items){
    switch(store.filterId){
      case 'img':   return items.filter(it=>!!it.imageFileId);
      case 'noimg': return items.filter(it=>!it.imageFileId);
      default:      return items;
    }
  }

  function refreshList(){
    elList.innerHTML = '';
    const filtered = applyFilter(store.items);
    filtered.forEach(item=>{
      const row = makeRow(item);
      if (item.id === store.selectedId) row.classList.add('selected');
      elList.appendChild(row);
    });
  }

  function refreshListSelection(){
    const rows = $$('.lm-cap-row', elList);
    rows.forEach(r=>{
      if (r.dataset.id === store.selectedId) r.classList.add('selected');
      else r.classList.remove('selected');
    });
  }

  function renderImages(){
    if (!elImagesGrid) return;
    elImagesGrid.innerHTML = '';
    if (!store.images.length) {
      elImagesStatus.textContent = 'No images detected in GLB folder.';
      return;
    }
    elImagesStatus.textContent = store.images.length + ' images';
    store.images.forEach(img=>{
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.style.border = '0';
      wrap.style.padding = '0';
      wrap.style.background = 'transparent';
      wrap.style.cursor = 'pointer';
      wrap.style.display = 'inline-block';

      const elImg = document.createElement('img');
      elImg.src = img.thumbUrl || img.url;
      elImg.alt = img.name || '';
      elImg.style.width = '88px';
      elImg.style.height = '88px';
      elImg.style.objectFit = 'cover';
      elImg.style.borderRadius = '8px';
      elImg.loading = 'lazy';

      wrap.appendChild(elImg);
      wrap.addEventListener('click', ()=>{
        const it = findItem(store.selectedId);
        if (!it) return;
        it.imageFileId = img.id;
        upsertItem(it);
        elImagesStatus.textContent = `Linked to: ${img.name || img.id}`;
      });

      elImagesGrid.appendChild(wrap);
    });
  }

  function syncPinsFromItems(){
    const pinRt = getPinRuntime();
    const br = getViewerBridge();
    if (!pinRt || !br) return;

    try{
      pinRt.clearPins();
    }catch(e){
      warn('clearPins failed', e);
    }

    store.items.forEach(it=>{
      if (!it.pos) return;
      try{
        pinRt.addPinMarker({
          id: it.id,
          pos: it.pos,
          color: it.color || '#60a5fa',
          selected: it.id === store.selectedId
        });
      }catch(e){
        warn('addPinMarker failed for', it.id, e);
      }
    });
  }

  function syncPinsSelection(){
    const pinRt = getPinRuntime();
    if (!pinRt) return;
    try{
      pinRt.setPinSelected(store.selectedId || null);
    }catch(e){
      warn('setPinSelected failed', e);
    }
  }

  function selectItem(id){
    const it = findItem(id);
    if (!it) return;
    setSelectedId(id);
    elTitle.value = it.title || '';
    elBody.value  = it.body  || '';
    emitItemSelected(it);
  }

  function addCaptionAt(x,y,world){
    if (!world || typeof world.x !== 'number') {
      warn('addCaptionAt: invalid world', world);
    }
    const id = 'c_' + Math.random().toString(36).slice(2,10);
    const now = new Date().toISOString();
    const baseColor = currentColor || COLORS[0];

    const item = {
      id,
      title: elTitle.value || '(untitled)',
      body: elBody.value || '',
      color: baseColor,
      pos: world || null,
      posX: world ? world.x : null,
      posY: world ? world.y : null,
      posZ: world ? world.z : null,
      imageFileId: null,
      createdAt: now,
      updatedAt: now
    };

    upsertItem(item);
    setSelectedId(id);
    elTitle.value = item.title;
    elBody.value  = item.body;

    try{
      const ev = new CustomEvent('lm:caption-added', { detail: { item } });
      window.dispatchEvent(ev);
    }catch(e){
      warn('lm:caption-added dispatch failed', e);
    }
  }

  let preferWorldClicks = true;
  let worldHookInstalled = false;

  function tryInstallWorldSpaceHook(){
    if (worldHookInstalled) return;
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick !== 'function') return;
    try{
      br.onCanvasShiftPick((payload)=>{
        const world = payload && (payload.point || payload.world || payload);
        if (!world || typeof world.x !== 'number') return;
        preferWorldClicks = true;
        addCaptionAt(0.5, 0.5, world);
      });
      worldHookInstalled = true;
      log('world-space hook installed');
    }catch(e){
      warn('onCanvasShiftPick hook failed', e);
    }
  }

  function installFallbackClick(){
    const canvas = document.querySelector('#gl, canvas');
    if (!canvas) return;
    canvas.addEventListener('dblclick',(ev)=>{
      if (preferWorldClicks) return;
      const rect = canvas.getBoundingClientRect();
      const nx = (ev.clientX - rect.left) / rect.width;
      const ny = (ev.clientY - rect.top)  / rect.height;
      const br = getViewerBridge();
      const world = br && typeof br.projectPoint === 'function'
        ? br.projectPoint({x:nx,y:ny})
        : null;
      addCaptionAt(nx, ny, world);
    });
  }

  window.addEventListener('lm:scene-ready',            tryInstallWorldSpaceHook, { passive:true });
  window.addEventListener('lm:scene-deep-ready',       tryInstallWorldSpaceHook, { passive:true });
  window.addEventListener('lm:viewer-bridge-available',tryInstallWorldSpaceHook, { passive:true });

  installFallbackClick();

  function wireSheetBridge(){
    window.addEventListener('lm:caption-items-from-sheet',(ev)=>{
      const items = (ev && ev.detail && ev.detail.items) || [];
      setItems(items);
    }, {passive:true});

    window.addEventListener('lm:caption-images-from-sheet',(ev)=>{
      const images = (ev && ev.detail && ev.detail.images) || [];
      setImages(images);
    }, {passive:true});

    window.addEventListener('lm:caption-updated-from-sheet',(ev)=>{
      const item = (ev && ev.detail && ev.detail.item) || null;
      if (!item || !item.id) return;
      upsertItem(item);
    }, {passive:true});

    window.addEventListener('lm:caption-deleted-from-sheet',(ev)=>{
      const id = (ev && ev.detail && ev.detail.id) || null;
      if (!id) return;
      removeItem(id);
    }, {passive:true});
  }

  wireSheetBridge();

  elTitle.addEventListener('change', ()=>{
    const it = findItem(store.selectedId);
    if (!it) return;
    it.title = elTitle.value;
    it.updatedAt = new Date().toISOString();
    upsertItem(it);
  });

  elBody.addEventListener('change', ()=>{
    const it = findItem(store.selectedId);
    if (!it) return;
    it.body = elBody.value;
    it.updatedAt = new Date().toISOString();
    upsertItem(it);
  });

  const btnRefreshImages = root.querySelector('#btnRefreshImages');
  if (btnRefreshImages) {
    btnRefreshImages.addEventListener('click', ()=>{
      try{
        const ev = new CustomEvent('lm:refresh-images',{detail:{}});
        window.dispatchEvent(ev);
      }catch(e){
        warn('lm:refresh-images dispatch failed', e);
      }
    });
  }

  // initial render
  renderColors();
  window.addEventListener('lm:scene-ready',            function(){ try{ syncPinsFromItems(); }catch(_){ } }, { passive:true });

  renderFilters();
  refreshList();
  renderImages();
  renderPreview();
  try{ syncPinsFromItems(); }catch(_){}

  try{
    const ev = new CustomEvent('lm:caption-ui-ready',{detail:{}});
    window.dispatchEvent(ev);
  }catch(e){
    warn('lm:caption-ui-ready dispatch failed', e);
  }

  window.__LM_CAPTION_UI = {
    addCaptionAt,
    refreshList,
    selectItem,
    removeItem,
    setItems,
    setImages,
    syncPinsFromItems,
    getViewerBridge,
    onItemAdded,
    onItemChanged,
    onItemDeleted,
    onItemSelected,
    registerDeleteListener: onItemDeleted,
    getItems(){ return store.items; },
    get items(){ return store.items; },
    get images(){ return store.images; },
    get selectedId(){ return store.selectedId; }
  };
  window.__LM_CAPTION_UI.__ver = 'A2';
})();
