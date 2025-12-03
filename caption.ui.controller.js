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

  function hasClass(el, cls){
    return el && el.classList && el.classList.contains(cls);
  }
  function addClass(el, cls){
    if (el && el.classList) el.classList.add(cls);
  }
  function removeClass(el, cls){
    if (el && el.classList) el.classList.remove(cls);
  }
  function toggleClass(el, cls, on){
    if (!el || !el.classList) return;
    if (on) el.classList.add(cls);
    else el.classList.remove(cls);
  }

  function newId(){
    return 'c_'+Math.random().toString(36).slice(2,10);
  }

  // State
  const store = {
    items: [],
    images: [],
    filtered: [],
    selectedId: null,
    currentColor: '#eab308', // default
    filterColor: null,
  };

  // DOM
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
  let elPreviewImg   = $('#caption-preview-img', pane);

  if (!elPreviewImg){
    elPreviewImg = document.createElement('div');
    elPreviewImg.id = 'caption-preview-img';
    elPreviewImg.className = 'caption-preview';
    pane.appendChild(elPreviewImg);
  }

  // Simple event helpers
  function on(el, ev, fn){
    if (!el) return;
    el.addEventListener(ev, fn);
  }

  // Dirty tracking
  let dirty = false;
  function markDirty(){
    dirty = true;
    try{
      document.dispatchEvent(new Event('lm:caption-dirty'));
    }catch(_){}
  }

  // Selection helpers
  function getSelectedItem(){
    return store.items.find(it => it.id === store.selectedId) || null;
  }

  // UI renderers ---------------------------------------------------------------
  function renderColors(){
    if (!elColorList) return;
    const colors = ['#eab308','#22c55e','#3b82f6','#ec4899','#f97316'];
    elColorList.innerHTML = '';
    colors.forEach(color=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip chip-color';
      btn.style.backgroundColor = color;
      if (store.currentColor === color) addClass(btn, 'active');
      btn.addEventListener('click', ()=>{
        store.currentColor = color;
        renderColors();
      });
      elColorList.appendChild(btn);
    });
  }

  function renderFilters(){
    if (!elFilterList) return;
    const colors = ['all','#eab308','#22c55e','#3b82f6','#ec4899','#f97316'];
    elFilterList.innerHTML = '';
    colors.forEach(color=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip chip-filter';
      if (color === 'all'){
        btn.textContent = 'ALL';
        if (!store.filterColor) addClass(btn, 'active');
      }else{
        btn.textContent = '';
        btn.style.backgroundColor = color;
        if (store.filterColor === color) addClass(btn, 'active');
      }
      btn.addEventListener('click', ()=>{
        store.filterColor = (color === 'all') ? null : color;
        renderFilters();
        refreshList();
      });
      elFilterList.appendChild(btn);
    });
  }

  function applyFilter(items){
    if (!store.filterColor) return items.slice();
    return items.filter(it => it.color === store.filterColor);
  }

  function renderList(){
    if (!elList) return;
    const items = applyFilter(store.items);
    store.filtered = items;
    elList.innerHTML = '';
    items.forEach(it=>{
      const li = document.createElement('li');
      li.className = 'caption-item';
      li.dataset.id = it.id;
      if (it.id === store.selectedId) addClass(li, 'active');

      const colorDot = document.createElement('span');
      colorDot.className = 'caption-color-dot';
      colorDot.style.backgroundColor = it.color || '#eab308';

      const title = document.createElement('span');
      title.className = 'caption-title';
      title.textContent = it.title || '(untitled)';

      li.appendChild(colorDot);
      li.appendChild(title);

      li.addEventListener('click', ()=>{
        selectItem(it.id);
      });

      elList.appendChild(li);
    });
  }

  function renderDetail(){
    const item = getSelectedItem();
    if (!elTitle || !elBody) return;
    if (!item){
      elTitle.value = '';
      elBody.value  = '';
      if (elPreviewImg) elPreviewImg.innerHTML = '';
      return;
    }
    elTitle.value = item.title || '';
    elBody.value  = item.body  || '';
    renderPreview();
  }

  function renderPreview(){
    const item = getSelectedItem();
    if (!elPreviewImg) return;
    elPreviewImg.innerHTML = '';
    if (!item || !item.image) return;
    const img = document.createElement('img');
    img.src = item.image.thumbUrl || item.image.url || '';
    img.alt = item.title || '';
    elPreviewImg.appendChild(img);
  }

  function refreshList(){
    renderList();
    renderDetail();
  }

  function renderImages(){
    if (!elImages || !elImgStatus) return;
    elImages.innerHTML = '';
    const items = store.images || [];
    if (!items.length){
      elImgStatus.textContent = '画像がありません';
      return;
    }
    elImgStatus.textContent = '';
    items.forEach(img=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'img-thumb';
      const image = document.createElement('img');
      image.src = img.thumbUrl || img.url || '';
      image.alt = img.name || '';
      btn.appendChild(image);
      btn.addEventListener('click', ()=>{
        const item = getSelectedItem();
        if (!item) return;
        item.image = img;
        item.imageFileId = img.id || null;
        renderPreview();
        scheduleChanged(item);
      });
      elImages.appendChild(btn);
    });
  }

  // --- View sync helpers ------------------------------------------------------
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
      br.setPinSelected(id || null);
    }catch(e){
      warn('setPinSelected failed', e);
    }
  }

  // --- colors / filters -------------------------------------------------------
  function renderColorsAndFilters(){
    renderColors();
    renderFilters();
  }

  // --- Title / Body 変更ハンドラ ---------------------------------------------
  let titleInputTimer = null;
  let bodyInputTimer  = null;

  function attachFieldHandlers(){
    if (elTitle){
      elTitle.addEventListener('input', ()=>{
        const item = getSelectedItem();
        if (!item) return;
        item.title = elTitle.value;
        markDirty();
        if (titleInputTimer) clearTimeout(titleInputTimer);
        titleInputTimer = setTimeout(()=>{
          titleInputTimer = null;
          refreshList();
          scheduleChanged(item);
        }, 150);
      });
    }
    if (elBody){
      elBody.addEventListener('input', ()=>{
        const item = getSelectedItem();
        if (!item) return;
        item.body = elBody.value;
        markDirty();
        if (bodyInputTimer) clearTimeout(bodyInputTimer);
        bodyInputTimer = setTimeout(()=>{
          bodyInputTimer = null;
          scheduleChanged(item);
        }, 200);
      });
    }
  }

  // --- 画像リストのリフレッシュ ----------------------------------------------
  function attachImageRefresh(){
    if (!elRefreshImg) return;
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
    renderPreview();
  }

  function setImages(images){
    store.images = images || [];
    renderImages();
    renderPreview();
  }

  // --- Item events (added/changed/deleted/selected) ---------------------------
  const addListeners = [];
  const changeListeners = [];
  const deleteListeners = [];
  const selectListeners = []; // caption selection listeners
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

  function onItemSelected(fn){
    if (typeof fn === 'function') selectListeners.push(fn);
  }
  function emitItemSelected(item){
    selectListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemSelected handler failed', e); }
    });
  }

  // --- caption creation --------------------------------------------------------
  let preferWorldClicks = false;
  let worldHookInstalled = false;
  let lastAddAtMs = 0;

  function addCaptionAt(x, y, world){
    const tNow = Date.now();
    if (tNow - lastAddAtMs < 150) {
      log('skip duplicate addCaptionAt');
      return;
    }
    lastAddAtMs = tNow;

    const ts = new Date().toISOString();
    const item = {
      id: newId(),
      title: '(untitled)',
      body: '',
      color: store.currentColor,
      pos: world || null,
      imageFileId: null,
      image: null,
      createdAt: ts,
      updatedAt: ts,
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

  // 世界座標フック: onCanvasShiftPick(payload) → payload.point を渡す
  function tryInstallWorldSpaceHook(){
    if (worldHookInstalled) return;
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick !== 'function') return;
    try{
      br.onCanvasShiftPick((payload)=>{
        const world = payload && payload.point ? payload.point : null;
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

  // Selection API --------------------------------------------------------------
  function selectItem(id){
    store.selectedId = id || null;
    refreshList();
    syncViewerSelection(store.selectedId);
    const item = getSelectedItem();
    emitItemSelected(item || null);
  }

  function removeItem(id){
    const idx = store.items.findIndex(it=>it.id === id);
    if (idx === -1) return;
    const [removed] = store.items.splice(idx, 1);
    if (store.selectedId === id){
      store.selectedId = null;
    }
    refreshList();
    syncPinsFromItems();
    emitItemDeleted(removed);
  }

  // List click handlers --------------------------------------------------------
  function attachListHandlers(){
    if (!elList) return;
    elList.addEventListener('click', (ev)=>{
      const li = ev.target.closest('li.caption-item');
      if (!li) return;
      const id = li.dataset.id;
      if (!id) return;
      selectItem(id);
    });
  }

  // Public API export ----------------------------------------------------------
  attachFieldHandlers();
  attachImageRefresh();
  attachListHandlers();
  renderColors();
  renderFilters();
  refreshList();

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
    onItemSelected,
    registerDeleteListener: onItemDeleted,
    get items(){ return store.items; },
    get images(){ return store.images; },
    get selectedId(){ return store.selectedId; }
  };
  window.__LM_CAPTION_UI.__ver = 'A2';

  // initial render
  renderColors();
  renderFilters();
  refreshList();
  renderImages();
  renderPreview();

  try{
    document.dispatchEvent(new Event('lm:caption-ui-ready'));
  }catch(_){}
  log('ready');
})();
