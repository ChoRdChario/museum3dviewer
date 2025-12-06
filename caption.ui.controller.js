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

  // State
  const COLORS = ['#22c55e','#3b82f6','#a855f7','#f97316','#e11d48','#6b7280']; // tailwind-ish
  const FILTERS = [
    { id:'all',    label:'すべて' },
    { id:'green',  label:'緑' },
    { id:'blue',   label:'青' },
    { id:'purple', label:'紫' },
    { id:'orange', label:'橙' },
    { id:'red',    label:'赤' },
    { id:'gray',   label:'グレー' }
  ];

  const store = {
    items: [],
    images: [],
    selectedId: null,
    filterId: 'all'
  };

  let currentColor = COLORS[0];
  let elList, elTitle, elBody, elColorChips, elFilterChips;
  let elImageGrid;
  let bound = false;

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
    try{ syncPinsFromItems(); }catch(_){}
  }

  function setImages(images){
    store.images = Array.isArray(images) ? images.slice() : [];
    renderImages();
  }

  function findItem(id){
    return store.items.find(it=>it.id===id) || null;
  }

  function setSelectedId(id){
    store.selectedId = id || null;
    syncPinsSelection();
    refreshList();
  }

  function emitItemChanged(item){
    try{
      const ev = new CustomEvent('lm:caption-changed',{detail:{item}});
      window.dispatchEvent(ev);
    }catch(e){
      warn('lm:caption-changed dispatch failed', e);
    }
  }

  function emitItemSelected(item){
    try{
      const ev = new CustomEvent('lm:caption-selected',{detail:{item}});
      window.dispatchEvent(ev);
    }catch(e){
      warn('lm:caption-selected dispatch failed', e);
    }
  }

  function emitItemDeleted(item){
    try{
      const ev = new CustomEvent('lm:caption-deleted',{detail:{item}});
      window.dispatchEvent(ev);
    }catch(e){
      warn('lm:caption-deleted dispatch failed', e);
    }
  }

  function upsertItem(item){
    const idx = store.items.findIndex(it=>it.id===item.id);
    if (idx>=0) {
      store.items.splice(idx,1,item);
    } else {
      store.items.push(item);
    }
    refreshList();
    emitItemChanged(item);
    try{ syncPinsFromItems(); }catch(_){}
  }

  function removeItem(id){
    const it = findItem(id);
    if (!it) return;
    store.items = store.items.filter(x=>x.id!==id);
    if (store.selectedId===id) store.selectedId=null;
    refreshList();
    emitItemDeleted(it);
    try{ syncPinsFromItems(); }catch(_){}
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
          x: it.pos.x,
          y: it.pos.y,
          z: it.pos.z,
          color: it.color || '#60a5fa'
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
      title: elTitle.value || '',
      body:  elBody.value  || '',
      createdAt: now,
      updatedAt: now,
      color: baseColor,
      pos: world ? {x:world.x,y:world.y,z:world.z}: null,
      screen: { x, y }
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

  let pendingDeleteHandler = null;
  function onItemDeleted(handler){
    pendingDeleteHandler = handler;
  }

  function handleDeleteClick(id){
    const it = findItem(id);
    if (!it) return;
    if (pendingDeleteHandler) {
      try{
        const ok = pendingDeleteHandler(it);
        if (ok === false) return;
      }catch(e){
        warn('delete handler failed', e);
      }
    }
    removeItem(id);
  }

  function handleTitleInput(){
    const it = findItem(store.selectedId);
    if (!it) return;
    it.title = elTitle.value || '';
    it.updatedAt = new Date().toISOString();
    upsertItem(it);
  }

  function handleBodyInput(){
    const it = findItem(store.selectedId);
    if (!it) return;
    it.body = elBody.value || '';
    it.updatedAt = new Date().toISOString();
    upsertItem(it);
  }

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

  function renderPreview(){
    // 現状のプレビュー表示は caption.viewer.overlay.js 側に委ねている。
    // ここではエラー回避用のスタブのみ提供し、UIへの影響は与えない。
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
    title.textContent = item.title || '(無題)';

    const meta = document.createElement('div');
    meta.className = 'lm-cap-meta';
    meta.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'lm-cap-del';
    del.textContent = '×';
    del.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      handleDeleteClick(item.id);
    });

    row.appendChild(sw);
    const textWrap = document.createElement('div');
    textWrap.className = 'lm-cap-text';
    textWrap.appendChild(title);
    textWrap.appendChild(meta);
    row.appendChild(textWrap);
    row.appendChild(del);

    row.addEventListener('click', ()=>{
      selectItem(item.id);
    });

    if (store.selectedId === item.id) {
      row.classList.add('active');
    }

    return row;
  }

  function filterItemsForView(){
    const f = store.filterId;
    if (f === 'all') return store.items;
    const colorMap = {
      green:  COLORS[0],
      blue:   COLORS[1],
      purple: COLORS[2],
      orange: COLORS[3],
      red:    COLORS[4],
      gray:   COLORS[5]
    };
    const targetColor = colorMap[f];
    return store.items.filter(it=>it.color===targetColor);
  }

  function refreshList(){
    if (!elList) return;
    elList.innerHTML = '';
    const items = filterItemsForView();
    items.forEach(it=>{
      elList.appendChild(makeRow(it));
    });
  }

  function renderImages(){
    if (!elImageGrid) return;
    elImageGrid.innerHTML = '';
    store.images.forEach(img=>{
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'lm-cap-img-cell';
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.src = img.thumbnailLink || img.webContentLink || img.webViewLink || '';
      im.alt = img.name || '';
      cell.appendChild(im);
      elImageGrid.appendChild(cell);
    });
  }

  function bindDom(){
    const root = document;
    elList        = $('.lm-cap-list', root);
    elTitle       = $('#captionTitle', root);
    elBody        = $('#captionBody', root);
    elColorChips  = $('.lm-cap-color-chips', root);
    elFilterChips = $('.lm-cap-filter-chips', root);
    elImageGrid   = $('.lm-cap-image-grid', root);

    if (!elList || !elTitle || !elBody || !elColorChips || !elFilterChips) {
      warn('caption UI DOM not ready');
      return false;
    }

    elTitle.addEventListener('input', handleTitleInput);
    elBody.addEventListener('input', handleBodyInput);

    // world-space hook
    try{
      const br = getViewerBridge();
      if (br && typeof br.onCanvasShiftPick === 'function') {
        br.onCanvasShiftPick((payload)=>{
          try{
            const world = payload && (payload.point || payload.world || payload.worldPoint || null);
            if (!world) {
              warn('onCanvasShiftPick payload without world', payload);
              return;
            }
            const { x, y } = payload;
            addCaptionAt(x,y,world);
          }catch(e){
            warn('onCanvasShiftPick handler failed', e);
          }
        });
        log('world-space hook installed');
      }else{
        warn('onCanvasShiftPick not available on viewer bridge');
      }
    }catch(e){
      warn('world-space hook install failed', e);
    }

    bound = true;
    return true;
  }

  function init(){
    if (!bindDom()) return;

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
      onItemAdded: upsertItem,
      onItemChanged: upsertItem,
      onItemDeleted: removeItem,
      onItemSelected: selectItem,
      registerDeleteListener: onItemDeleted,
      getItems(){ return store.items; },
      get items(){ return store.items; },
      get images(){ return store.images; },
      get selectedId(){ return store.selectedId; }
    };
    window.__LM_CAPTION_UI.__ver = 'A2';
  }

  let tries = 0;
  const MAX_TRIES = 20;

  function poll(){
    if (bound) return;
    tries++;
    if (tries>MAX_TRIES) {
      try{ console.warn(TAG, 'gave up waiting for DOM'); }catch(_){}
      return;
    }
    if (bindDom()){
      init();
      return;
    }
    setTimeout(poll, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', poll, { once:true });
  } else {
    poll();
  }

  // シーン準備後にも一度だけリトライしておく
  document.addEventListener("lm:scene-ready", () => {
    if (!bound){
      try{ console.log(TAG, "scene-ready => rescan"); }catch(_){}
      tries = 0;
      poll();
    }
  });
})();