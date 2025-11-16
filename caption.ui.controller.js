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

  // viewer bridge accessor
  function getViewerBridge(){
    try{
      const cand = [
        window.__lm_viewer_bridge,
        window.viewerBridge,
        (window.__LM_VIEW && window.__LM_VIEW.bridge)
      ];
      for (const b of cand){
        if (b && typeof b.addPinMarker === 'function') return b;
      }
    }catch(e){}
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  // viewer 側の onCanvasShiftPick が有効になったら true。
  // true のときは fallback(#gl click)は何もしない（ダブル追加防止）。
  let preferWorldClicks = false;

  // --- small event hub for Sheets bridge --------------------------------------
  const addListeners = [];
  const changeListeners = [];
  const deleteListeners = [];
  const dirtyTimers = new Map(); // id -> timerId

  function onItemDeleted(fn){
    if (typeof fn === 'function') deleteListeners.push(fn);
  }
  function emitItemDeleted(item){
    deleteListeners.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG,'onItemDeleted handler failed', e); }
    });
  }

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
    if (prev) cancelAnimationFrame(prev);
    const t = requestAnimationFrame(()=>{
      dirtyTimers.delete(id);
      emitItemChanged(item);
    });
    dirtyTimers.set(id, t);
  }

  // --- colors / filters -------------------------------------------------------
  function renderColors(){
    if(!elColorList) return;
    elColorList.innerHTML='';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.style.backgroundColor = col;
      btn.addEventListener('click', ()=>{
        store.currentColor = col;
        renderColors();
      });
      if (store.currentColor === col) btn.classList.add('active');
      elColorList.appendChild(btn);
    });
  }

  function renderFilters(){
    if(!elFilterList) return;
    elFilterList.innerHTML='';
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

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'lm-cap-del';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        if (it && it.id){
          removeItem(it.id);
        }
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

  function syncViewerSelection(id){
    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;
    try{
      br.setPinSelected(id || null, !!id);
    }catch(e){ warn('setPinSelected failed', e); }
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
    if (idx === -1) return;
    const removed = store.items.splice(idx,1)[0] || null;
    if (store.selectedId === id) store.selectedId = null;

    // 3D 側のピンも同期して削除
    try{
      const br = getViewerBridge();
      if (br){
        if (typeof br.removePinMarker === 'function'){
          br.removePinMarker(id);
        }else if (typeof br.clearPins === 'function' && typeof br.addPinMarker === 'function'){
          // removePinMarker が無い環境では、一覧から再構築する
          syncPinsFromItems();
        }
      }
    }catch(e){
      warn('removePinMarker failed', e);
    }

    // Sheets ブリッジ向けに削除イベントを通知
    if (removed && removed.id){
      emitItemDeleted(removed);
    }else{
      emitItemDeleted({ id });
    }

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
    elBody.addEventListener('input', ()=>{
      const id = store.selectedId; if(!id) return;
      const it = store.items.find(x=>x.id===id); if(!it) return;
      it.body = elBody.value;
      scheduleChanged(it);
    });
  }

  // --- image grid wiring (Phase A1’ placeholder) ------------------------------
  function renderImages(){
    if (!elImages) return;
    elImages.innerHTML='';
    const imgs = store.images||[];
    if (!imgs.length){
      if (elImgStatus){
        elImgStatus.textContent = '画像はまだありません';
      }
      return;
    }
    if (elImgStatus){
      elImgStatus.textContent = imgs.length+' 枚の画像';
    }
    imgs.forEach(img=>{
      const wrap = document.createElement('div');
      wrap.className = 'lm-img-thumb';
      wrap.textContent = img.name || '(image)';
      // ここではまだクリックでの紐付けまでは行わない（A3 で実装予定）
      wrap.addEventListener('click', ()=>{
        // いまはデバッグログのみ
        console.log(TAG,'image clicked (stub)', img);
        // 将来的には: 選択中キャプションに imageFileId をセットして scheduleChanged()
        // ただし、これをやるには Sheets 側の列設計とあわせる必要があるので A3 で。
      });
      elImages.appendChild(wrap);
    });
  }

  // --- API for other modules ---------------------------------------------------
  function normalizeItem(raw){
    if (!raw) raw = {};
    const id = raw.id || newId();
    const color = raw.color || '#eab308';
    const pos = raw.pos || null;
    return {
      id,
      title: raw.title || '',
      body: raw.body || '',
      color,
      pos,
      image: raw.image || null,
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
      rowIndex: raw.rowIndex || null,
    };
  }

  function setItems(items){
    store.items = (items || []).map(normalizeItem);
    refreshList();
  }

  function setImages(images){
    store.images = images || [];
    renderImages();
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
      createdAt: new Date().toISOString(),
      updatedAt: null,
      rowIndex: null,
    };
    store.items.push(item);
    refreshList();
    selectItem(item.id);
    addPinForItem(item);
    emitItemAdded(item);
  }

  // --- fallback click handler (pane canvas) -----------------------------------
  // どこか別のモジュールが onCanvasShiftPick を提供している場合は、そちらが true を返した時点で fallback は無効化。
  function installFallbackClick(){
    const area = document.getElementById('gl') || document.querySelector('#viewer,#glCanvas,#glcanvas');
    if (!area) return;
    area.addEventListener('click', (ev)=>{
      if (!ev.shiftKey) return;
      if (preferWorldClicks) return; // viewer 側が有効ならそちらに任せる
      const rect = area.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top)  / rect.height;
      addCaptionAt(x, y, null);
    });
  }

  // --- world-space click hook --------------------------------------------------
  // viewer 側が onCanvasShiftPick を expose している場合にそれを尊重する。
  function installWorldSpaceHook(){
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick !== 'function') return;
    try{
      br.onCanvasShiftPick((world)=>{
        preferWorldClicks = true;
        addCaptionAt(0.5, 0.5, world); // 画面座標は使わず world のみ
      });
    }catch(e){
      warn('world-space hook failed', e);
    }
  }

  installFallbackClick();
  installWorldSpaceHook();

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

  log('ready');
})();