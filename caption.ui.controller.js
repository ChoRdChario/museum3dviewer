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
    elPreview.className = 'caption-image-preview';
    elImages.parentElement.insertBefore(elPreview, elImages);
  }

  // State
  const store = {
    items: [],
    selectedId: null,
    currentColor: '#eab308', // amber-500
    filterColor: null,
    images: [],
    imagesLoaded: false,
  };

  const colorOptions = [
    { id: 'amber',   value: '#eab308', label: 'Amber'   },
    { id: 'cyan',    value: '#22d3ee', label: 'Cyan'    },
    { id: 'violet',  value: '#a855f7', label: 'Violet'  },
    { id: 'emerald', value: '#22c55e', label: 'Emerald' },
    { id: 'rose',    value: '#f97373', label: 'Rose'    },
  ];

  const filterOptions = [
    { id: 'all',   value: null,         label: 'All'   },
    { id: 'amber', value: '#eab308',    label: 'Amber' },
    { id: 'cyan',  value: '#22d3ee',    label: 'Cyan'  },
    { id: 'violet',value: '#a855f7',    label: 'Violet'},
    { id: 'emerald', value:'#22c55e',   label: 'Emerald' },
    { id: 'rose',    value:'#f97373',   label: 'Rose' },
  ];

  const listeners = {
    added: [],
    changed: [],
    deleted: [],
    selected: [],
  };

  function onItemAdded(fn){ listeners.added.push(fn); }
  function onItemChanged(fn){ listeners.changed.push(fn); }
  function onItemDeleted(fn){ listeners.deleted.push(fn); }
  function onItemSelected(fn){ listeners.selected.push(fn); }

  function emitItemAdded(item){
    listeners.added.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG, 'onItemAdded handler failed', e); }
    });
  }
  function emitItemChanged(item){
    listeners.changed.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG, 'onItemChanged handler failed', e); }
    });
  }
  function emitItemDeleted(item){
    listeners.deleted.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG, 'onItemDeleted handler failed', e); }
    });
  }
  function emitItemSelected(item){
    listeners.selected.forEach(fn=>{
      try{ fn(item); }catch(e){ console.error(TAG, 'onItemSelected handler failed', e); }
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
    if (!item || !item.pos) return;
    const p = item.pos || {};
    const hasCoords = (typeof p.x === 'number' &&
                       typeof p.y === 'number' &&
                       typeof p.z === 'number');
    if (!hasCoords) return;
    const pos = { x:p.x, y:p.y, z:p.z };
    try{
      br.addPinMarker({ id:item.id, position: pos, color:item.color });
    }catch(e){
      warn('addPinMarker failed', e);
    }
  }

  function clearPins(){
    const br = getViewerBridge();
    if (!br || typeof br.clearPins !== 'function') return;
    try{
      br.clearPins();
    }catch(e){
      warn('clearPins failed', e);
    }
  }

  function syncViewerSelection(id, opts){
    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;
    const options = opts || {};
    if (options.fromViewer) return;
    try{
      br.setPinSelected(id || null);
    }catch(e){
      warn('setPinSelected failed', e);
    }
  }

  // --- ID helper --------------------------------------------------------------
  let idCounter = 0;
  function newId(){
    idCounter++;
    return 'c_' + Math.random().toString(36).slice(2,10) + idCounter.toString(36);
  }

  // --- List rendering ---------------------------------------------------------
  function renderList(){
    if (!elList) return;
    elList.innerHTML = '';

    const visible = store.items.filter(it=>{
      if (!store.filterColor) return true;
      return it.color === store.filterColor;
    });

    if (!visible.length){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No captions yet. Shift+Click on the model to add.';
      elList.appendChild(empty);
      return;
    }

    visible.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'lm-cap-row';
      row.dataset.id = it.id;

      const sw = document.createElement('span');
      sw.className = 'lm-cap-swatch';
      sw.style.background = it.color || '#eab308';

      const title = document.createElement('span');
      title.className = 'lm-cap-title';
      title.textContent = it.title || '(untitled)';

      const imgMark = document.createElement('span');
      imgMark.className = 'lm-cap-imgmark';
      if (it.imageFileId || (it.image && it.image.id)){
        imgMark.textContent = '📷';
      }else{
        imgMark.textContent = '';
      }

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

  function refreshList(){
    renderList();
  }

  // --- Selection & editors ----------------------------------------------------
  function selectItem(id, opts){
    const options = opts || {};
    const fromViewer = !!(options && options.source === 'viewer');

    store.selectedId = id || null;

    if (elList){
      $$('.lm-cap-row', elList).forEach(row=>{
        row.classList.toggle('selected', row.dataset.id === id);
      });
    }

    const it = store.items.find(it=>it.id === id) || null;

    if (!it){
      // Clear editors when nothing is selected
      if (elTitle) elTitle.value = '';
      if (elBody) elBody.value = '';
      syncViewerSelection(null, {fromViewer});
      renderImages();
      renderPreview();
      emitItemSelected(null);
      return;
    }

    if (elTitle) elTitle.value = it.title || '';
    if (elBody) elBody.value = it.body || '';

    // Keep existing behaviour for viewer sync: only sync when we actually have
    // a 3D pin position. When selection originates from the viewer, the ca
    // is marked with fromViewer so that syncViewerSelection does not echo it
    // back to the viewer.
    syncViewerSelection(it.pos ? it.id : null, {fromViewer});

    renderImages();
    renderPreview();
    emitItemSelected(it);
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
        }else if (typeof br.clearPins === 'function'){
          br.clearPins();
          store.items.forEach(it=>addPinForItem(it));
        }
      }
    }catch(e){
      warn('removePinMarker/clearPins failed', e);
    }

    if (removed){
      emitItemDeleted(removed);
    }

    refreshList();
    selectItem(null);
  }

  // --- Dirty tracking + emit changed -----------------------------------------
  const dirtyTimers = new Map();
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

  // --- Caption creation -------------------------------------------------------
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
                 document.querySelector('#viewer,#glCanvas,#three-canvas');
    if (!area) return;

    area.addEventListener('click', (ev)=>{
      if (!ev.shiftKey) return;
      const rect = area.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const br = getViewerBridge();
      if (!br || typeof br.onCanvasShiftPick !== 'function') return;
      try{
        br.onCanvasShiftPick({ x, y }, (world)=>{
          addCaptionAt(x, y, world || null);
        });
      }catch(e){
        warn('onCanvasShiftPick failed', e);
      }
    }, { passive: true });
  }

  // --- Color chips ------------------------------------------------------------
  function renderColorChips(){
    if (!elColorList) return;
    elColorList.innerHTML = '';
    colorOptions.forEach(opt=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.textContent = opt.label;
      btn.dataset.color = opt.value;
      if (store.currentColor === opt.value) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        store.currentColor = opt.value;
        $$('.pill', elColorList).forEach(b=>{
          b.classList.toggle('active', b === btn);
        });
      });
      elColorList.appendChild(btn);
    });
  }

  function renderFilterChips(){
    if (!elFilterList) return;
    elFilterList.innerHTML = '';
    filterOptions.forEach(opt=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.textContent = opt.label;
      btn.dataset.color = opt.value || '';
      if (store.filterColor === opt.value) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        store.filterColor = opt.value;
        $$('.pill', elFilterList).forEach(b=>{
          b.classList.toggle('active', b === btn);
        });
        refreshList();
      });
      elFilterList.appendChild(btn);
    });
  }

  // --- Title / Body editors ---------------------------------------------------
  if (elTitle){
    let rafId = 0;
    elTitle.addEventListener('input', ()=>{
      let id = store.selectedId;

      // Fallback: selection 情報が抜けている場合は、UI の選択行 or 単一行から復元する
      if (!id){
        if (elList){
          const selRow = elList.querySelector('.lm-cap-row.selected');
          if (selRow && selRow.dataset && selRow.dataset.id){
            id = selRow.dataset.id;
            store.selectedId = id;
          }
        }
        if (!id && store.items.length === 1){
          id = store.items[0].id;
          store.selectedId = id;
        }
      }

      if (!id) return;
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
      let id = store.selectedId;

      // Fallback: selection 情報が抜けている場合は、UI の選択行 or 単一行から復元する
      if (!id){
        if (elList){
          const selRow = elList.querySelector('.lm-cap-row.selected');
          if (selRow && selRow.dataset && selRow.dataset.id){
            id = selRow.dataset.id;
            store.selectedId = id;
          }
        }
        if (!id && store.items.length === 1){
          id = store.items[0].id;
          store.selectedId = id;
        }
      }

      if (!id) return;
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

  function renderPreview(){
    if (!elPreview) return;
    const sel = getSelectedItem();
    elPreview.innerHTML = '';
    if (!sel || !(sel.imageFileId || (sel.image && sel.image.id))){
      elPreview.style.display = 'none';
      return;
    }

    const img = document.createElement('img');
    if (sel.imageFileId){
      img.src = `https://drive.google.com/thumbnail?id=${encodeURIComponent(sel.imageFileId)}&sz=w400`;
    }else if (sel.image && sel.image.id){
      img.src = `https://drive.google.com/thumbnail?id=${encodeURIComponent(sel.image.id)}&sz=w400`;
    }
    img.alt = sel.title || '';
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '8px';

    elPreview.innerHTML = '';
    elPreview.appendChild(img);
    elPreview.style.display = 'block';
  }

  function renderImages(){
    if (!elImages) return;
    elImages.innerHTML = '';

    const sel = getSelectedItem();
    const images = store.images || [];
    if (!images.length){
      if (elImgStatus){
        elImgStatus.textContent = store.imagesLoaded
          ? 'No images found in this GLB folder.'
          : 'Images will be listed after first search.';
      }
      return;
    }

    if (elImgStatus){
      elImgStatus.textContent = `Images in GLB folder: ${images.length}`;
    }

    let selectedImageId = sel && (sel.imageFileId || (sel.image && sel.image.id)) || null;

    images.forEach(imgInfo=>{
      const wrap = document.createElement('div');
      wrap.className = 'img-item';
      wrap.dataset.id = imgInfo.id;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = `https://drive.google.com/thumbnail?id=${encodeURIComponent(imgInfo.id)}&sz=w160`;
      img.alt = imgInfo.name || '';

      const label = document.createElement('div');
      label.className = 'img-label';
      label.textContent = imgInfo.name || '';

      const detach = document.createElement('button');
      detach.type = 'button';
      detach.textContent = '×';
      detach.className = 'img-detach';
      detach.style.opacity = '0';

      if (selectedImageId && selectedImageId === imgInfo.id){
        wrap.classList.add('selected');
        detach.style.opacity = '1';
      }

      wrap.appendChild(img);
      wrap.appendChild(label);
      wrap.appendChild(detach);

      wrap.addEventListener('click', ()=>{
        const cur = getSelectedItem();
        if (!cur) return;
        cur.imageFileId = imgInfo.id;
        cur.image = imgInfo;
        selectedImageId = imgInfo.id;
        renderImages();
        renderPreview();
        scheduleChanged(cur);
      });

      wrap.addEventListener('mouseenter', ()=>{ detach.style.opacity = '1'; });
      wrap.addEventListener('mouseleave', ()=>{
        if (!(selectedImageId && selectedImageId === imgInfo.id)){
          detach.style.opacity = '0';
        }
      });

      detach.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        const cur = getSelectedItem();
        if (!cur) return;
        if (cur.imageFileId && cur.imageFileId === imgInfo.id){
          cur.imageFileId = null;
          cur.image = null;
          selectedImageId = null;
          renderImages();
          renderPreview();
          scheduleChanged(cur);
        }
      });

      elImages.appendChild(wrap);
    });
  }

  // --- Image loader bridge ----------------------------------------------------
  function triggerImageReload(reason){
    try{
      const mod = window.__LM_CAPTION_IMAGES_LOADER__;
      if (!mod || typeof mod.trigger !== 'function'){
        warn('caption images loader not available');
        return;
      }
      mod.trigger(reason || 'manual');
    }catch(e){
      warn('triggerImageReload failed', e);
    }
  }

  if (elRefreshImg){
    elRefreshImg.addEventListener('click', ()=>{
      triggerImageReload('manual');
    });
  }

  // --- bridge for caption.images.loader.js -----------------------------------
  function setImages(images){
    store.images = Array.isArray(images) ? images.slice() : [];
    store.imagesLoaded = true;
    renderImages();
    renderPreview();
  }

  // --- External API (for sheet bridge etc.) ----------------------------------
  const api = {
    __ver: 'A2',
    get items(){ return store.items; },
    get selectedId(){ return store.selectedId; },
    onItemAdded,
    onItemChanged,
    onItemDeleted,
    onItemSelected,
    setItems(items){
      store.items = Array.isArray(items) ? items.slice() : [];
      // rowIndex はそのまま保持する
      refreshList();
      if (store.items.length){
        selectItem(store.items[0].id);
      }else{
        selectItem(null);
      }
      clearPins();
      store.items.forEach(it=>addPinForItem(it));
    },
    addCaptionAt,
    selectItem,
    removeItem,
    setImages,
  };

  window.__LM_CAPTION_UI = api;

  installFallbackClick();
  renderColorChips();
  renderFilterChips();
  refreshList();

  log('ready');
  log('world-space hook installed');
})();
