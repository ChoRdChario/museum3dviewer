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
  const elFilterList = $('#pinColorFilters', pane);
  const elList       = $('#caption-list', pane);
  const elDetail     = $('#caption-detail', pane);
  const elPreview    = $('#caption-preview', pane);
  const elImagesWrap = $('#caption-images-wrap', pane);

  // Color palette (fixed set)
  const PALETTE = [
    '#eab308', // amber
    '#22c55e', // green
    '#0ea5e9', // sky
    '#a855f7', // purple
    '#f97316', // orange
    '#f43f5e'  // rose
  ];

  // Global store (per-page; survives reloads within same tab)
  const store = window.__LM_CAPTION_STORE = window.__LM_CAPTION_STORE || {
    items: [],
    selectedId: null,
    images: [],
    filter: new Set(),
    currentColor: '#eab308'
  };

  // --- viewer bridge helpers ---------------------------------------------------
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
      // viewer.module.cdn.js の addPinMarker は { id, position:{x,y,z}, color? } 形式
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
    const fromViewer = !!(options && options.source === 'viewer');

    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;

    if (fromViewer) {
      return;
    }

    try{
      br.setPinSelected(id || null);
    }catch(e){
      warn('setPinSelected failed', e);
    }
  }

  function setupViewerPinSelection(){
    const br = getViewerBridge();
    if (!br || typeof br.onPinSelect !== 'function') return;
    try{
      br.onPinSelect((payload)=>{
        const id = payload && payload.id;
        if (!id) return;
        const item = store.items.find(it=>it.id===id);
        if (!item) return;
        selectItem(id, { source:'viewer' });
      });
    }catch(e){
      warn('onPinSelect hook failed', e);
    }
  }

  // --- ID & items --------------------------------------------------------------
  function newId(){
    return 'c_'+Math.random().toString(36).slice(2,10);
  }

  function normalizeItem(raw){
    const it = Object.assign({}, raw||{});
    if (!it.id) it.id = newId();
    if (!it.color) it.color = '#eab308';
    if (it.pos && typeof it.pos.x !== 'number') it.pos = null;
    return it;
  }

  function findItem(id){
    return store.items.find(it=>it.id===id) || null;
  }

  // --- list & filters ----------------------------------------------------------
  function renderColors(){
    if (!elColorList) return;
    elColorList.innerHTML = '';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
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
      row.className = 'lm-caption-row';
      row.dataset.id = it.id;

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.backgroundColor = it.color || '#eab308';

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = it.title || '(untitled)';

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = it.createdAt ? new Date(it.createdAt).toLocaleString() : '';

      row.appendChild(dot);
      row.appendChild(title);
      row.appendChild(meta);

      if (store.selectedId === it.id) row.classList.add('selected');

      row.addEventListener('click', ()=>{
        selectItem(it.id);
      });

      elList.appendChild(row);
    });
  }

  function selectItem(id, opts){
    const options = opts || {};
    const fromViewer = !!(options && options.source === 'viewer');

    store.selectedId = id || null;
    refreshList();
    renderDetail();

    if (!fromViewer){
      syncViewerSelection(id || null, { source:'ui' });
    }

    emitItemSelected(store.selectedId);
  }

  function removeItem(id){
    const idx = store.items.findIndex(it=>it.id===id);
    if (idx>=0){
      const [removed] = store.items.splice(idx,1);
      if (store.selectedId===id){
        store.selectedId = null;
      }
      refreshList();
      renderDetail();
      syncPinsFromItems();
      emitItemDeleted(removed);
    }
  }

  // --- detail panel ------------------------------------------------------------
  function renderDetail(){
    if (!elDetail) return;
    const item = findItem(store.selectedId);
    elDetail.innerHTML = '';

    if (!item){
      const msg = document.createElement('div');
      msg.className = 'empty';
      msg.textContent = 'ピンを Shift+クリックしてキャプションを追加してください。';
      elDetail.appendChild(msg);
      return;
    }

    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'lm-caption-title-input';
    title.value = item.title || '';
    title.addEventListener('input', ()=>{
      item.title = title.value;
      item.updatedAt = new Date().toISOString();
      emitItemChanged(item);
      refreshList();
      renderPreview();
    });

    const body = document.createElement('textarea');
    body.className = 'lm-caption-body-input';
    body.value = item.body || '';
    body.addEventListener('input', ()=>{
      item.body = body.value;
      item.updatedAt = new Date().toISOString();
      emitItemChanged(item);
      renderPreview();
    });

    const footer = document.createElement('div');
    footer.className = 'lm-caption-detail-footer';

    const colorLabel = document.createElement('span');
    colorLabel.textContent = 'Color';

    const colorDots = document.createElement('div');
    colorDots.className = 'color-dots';

    PALETTE.forEach(col=>{
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'mini-dot';
      dot.style.backgroundColor = col;
      if (item.color === col) dot.classList.add('active');
      dot.addEventListener('click', ()=>{
        item.color = col;
        store.currentColor = col;
        item.updatedAt = new Date().toISOString();
        emitItemChanged(item);
        renderDetail();
        refreshList();
        syncPinsFromItems();
        renderPreview();
      });
      colorDots.appendChild(dot);
    });

    footer.appendChild(colorLabel);
    footer.appendChild(colorDots);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', ()=>{
      if (item.id) removeItem(item.id);
    });

    elDetail.appendChild(title);
    elDetail.appendChild(body);
    elDetail.appendChild(footer);
    elDetail.appendChild(deleteBtn);
  }

  // --- images preview ----------------------------------------------------------
  function renderImages(){
    if (!elImagesWrap) return;
    elImagesWrap.innerHTML = '';

    const imgs = store.images || [];
    if (!imgs.length){
      const msg = document.createElement('div');
      msg.className = 'empty';
      msg.textContent = 'この GLB に紐づく画像はまだありません。';
      elImagesWrap.appendChild(msg);
      return;
    }

    const list = document.createElement('div');
    list.className = 'lm-caption-image-list';

    const selected = findItem(store.selectedId);

    imgs.forEach(img=>{
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'image-card';

      const thumb = document.createElement('img');
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.src = img.thumbnailLink || img.iconLink || '';
      thumb.alt = img.name || '';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = img.name || '';

      card.appendChild(thumb);
      card.appendChild(name);

      if (selected && selected.imageFileId === img.id){
        card.classList.add('active');
      }

      card.addEventListener('click', ()=>{
        const item = findItem(store.selectedId);
        if (!item) return;
        if (item.imageFileId === img.id){
          item.imageFileId = null;
        }else{
          item.imageFileId = img.id;
        }
        item.updatedAt = new Date().toISOString();
        emitItemChanged(item);
        renderImages();
        renderPreview();
      });

      list.appendChild(card);
    });

    elImagesWrap.appendChild(list);
  }

  function setImages(images){
    store.images = images || [];
    renderImages();
    renderPreview();
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

  function tryInstallWorldSpaceHook(){
    if (worldHookInstalled) return;
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick !== 'function') return;
    try{
      br.onCanvasShiftPick((payload)=>{
        if (!payload) return;
        // viewer.module.cdn.js 側のコールバック payload は {point:{x,y,z}, event, hit}
        // 旧バージョン互換として payload 自体が {x,y,z} の場合も許容する
        const p = payload.point || payload;
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') {
          log('onCanvasShiftPick payload has no numeric point', p);
          return;
        }
        preferWorldClicks = true;
        addCaptionAt(0.5, 0.5, { x:p.x, y:p.y, z:p.z });
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

  // --- preview panel -----------------------------------------------------------
  function resolveImageForItem(item){
    if (!item || !item.imageFileId) return null;
    const imgs = store.images || [];
    return imgs.find(im=>im.id===item.imageFileId) || null;
  }

  function renderPreview(){
    if (!elPreview) return;
    elPreview.innerHTML = '';

    const item = findItem(store.selectedId);
    if (!item){
      const msg = document.createElement('div');
      msg.className = 'empty';
      msg.textContent = '左のリストからキャプションを選択してください。';
      elPreview.appendChild(msg);
      return;
    }

    const card = document.createElement('div');
    card.className = 'lm-caption-preview-card';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title || '(untitled)';

    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = item.body || '';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Pin';

    const header = document.createElement('div');
    header.className = 'header';
    header.appendChild(tag);
    header.appendChild(title);

    const img = resolveImageForItem(item);
    if (img){
      const figure = document.createElement('figure');
      figure.className = 'preview-image';

      const im = document.createElement('img');
      im.loading = 'lazy';
      im.decoding = 'async';
      im.src = img.thumbnailLink || img.iconLink || '';
      im.alt = img.name || '';

      const cap = document.createElement('figcaption');
      cap.textContent = img.name || '';

      figure.appendChild(im);
      figure.appendChild(cap);
      card.appendChild(figure);
    }

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(meta);

    elPreview.appendChild(card);
  }

  // --- external API ------------------------------------------------------------
  const addListeners = [];
  const changeListeners = [];
  const deleteListeners = [];
  const selectListeners = [];

  function onItemAdded(fn){
    if (typeof fn === 'function') addListeners.push(fn);
  }
  function onItemChanged(fn){
    if (typeof fn === 'function') changeListeners.push(fn);
  }
  function onItemDeleted(fn){
    if (typeof fn === 'function') deleteListeners.push(fn);
  }
  function onItemSelected(fn){
    if (typeof fn === 'function') selectListeners.push(fn);
  }

  function emitItemAdded(item){
    addListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ warn('onItemAdded listener failed', e); }
    });
  }
  function emitItemChanged(item){
    changeListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ warn('onItemChanged listener failed', e); }
    });
  }
  function emitItemDeleted(item){
    deleteListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ warn('onItemDeleted listener failed', e); }
    });
  }
  function emitItemSelected(id){
    selectListeners.forEach(fn=>{
      try{ fn(id); }catch(e){ warn('onItemSelected listener failed', e); }
    });
  }

  function setItems(items){
    store.items = (items || []).map(normalizeItem);
    refreshList();
    syncPinsFromItems();
    renderImages();
    renderPreview();
  }

  function setImagesExternal(images){
    setImages(images);
  }

  window.__LM_CAPTION_UI = {
    addCaptionAt,
    refreshList,
    selectItem,
    removeItem,
    setItems,
    setImages: setImagesExternal,
    onItemAdded,
    onItemChanged,
    onItemDeleted,
    onItemSelected,
    registerDeleteListener: onItemDeleted,
    get items(){ return store.items; },
    get images(){ return store.images; },
    get selectedId(){ return store.selectedId; }
  };  window.__LM_CAPTION_UI.__ver = 'A2';


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
