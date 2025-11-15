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

  const elColorList  = $('#caption-color-list', pane)  || $('#caption-colors', pane);
  const elFilterList = $('#caption-filter-list', pane) || $('#caption-filters', pane);
  const elList  = $('#caption-list', pane);
  const elTitle = $('#caption-title', pane);
  const elBody  = $('#caption-body', pane);
  const elBtnAdd = $('#caption-add', pane) || $('#caption-add-pin', pane);
  const elBtnClear = $('#caption-clear', pane) || $('#caption-clear-all', pane);
  const elBtnAttachImage = $('#caption-attach-image', pane);

  if (!elList || !elTitle || !elBody){
    return warn('essential caption controls missing; skip');
  }

  // --- State -------------------------------------------------------------------
  const store = {
    items: [],          // {id,title,body,color,image?,pos?}
    selectedId: null,
    filterColor: null,  // null = all
    colorPalette: ['#eab308','#22c55e','#3b82f6','#a855f7','#f97316','#ef4444','#e5e7eb']
  };

  const changeListeners = new Set();
  const dirtyTimers = new Map();

  // --- Public API (for other modules) -----------------------------------------
  const api = {
    getItems(){ return store.items.slice(); },
    setItems(list){
      store.items = Array.isArray(list)?list.map(normalizeItem):[];
      if (!store.selectedId && store.items.length){
        store.selectedId = store.items[0].id;
      }
      renderColors();
      refreshList();
    },
    addItem(raw){
      const it = normalizeItem(raw);
      store.items.push(it);
      store.selectedId = it.id;
      refreshList();
      scheduleChanged(it);
      return it;
    },
    getSelected(){
      return store.items.find(x=>x.id===store.selectedId) || null;
    },
    setFilterColor(color){
      store.filterColor = color || null;
      renderFilters();
      refreshList();
    },
    registerChangeListener(fn){
      if (typeof fn === 'function') changeListeners.add(fn);
      return ()=>changeListeners.delete(fn);
    },
    setImages(images){
      // images: [{id,name,mimeType,thumbnailUrl,url}, ...]
      store.images = Array.isArray(images)?images.slice():[];
      log('setImages', store.images.length);
    }
  };

  window.__LM_CAPTION_UI = api;

  // --- Normalization -----------------------------------------------------------
  function normalizeItem(raw){
    const it = Object.assign({
      id: `c_${Math.random().toString(36).slice(2)}`,
      title: '',
      body: '',
      color: store.colorPalette[0],
      image: null,
      pos: null
    }, raw || {});
    return it;
  }

  // --- Events to outside ------------------------------------------------------
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
    store.colorPalette.forEach(col=>{
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'lm-cap-color-chip';
      chip.style.backgroundColor = col;
      chip.title = col;
      chip.addEventListener('click', ()=>{
        const it = api.getSelected();
        if (!it) return;
        it.color = col;
        refreshList();
        scheduleChanged(it);
      });
      elColorList.appendChild(chip);
    });
  }

  function renderFilters(){
    if(!elFilterList) return;
    elFilterList.innerHTML = '';

    const btnAll = document.createElement('button');
    btnAll.type = 'button';
    btnAll.textContent = 'All';
    btnAll.className = 'lm-cap-filter';
    if (!store.filterColor) btnAll.classList.add('active');
    btnAll.addEventListener('click', ()=>{
      store.filterColor = null;
      renderFilters();
      refreshList();
    });
    elFilterList.appendChild(btnAll);

    store.colorPalette.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-cap-filter';
      btn.style.backgroundColor = col;
      if (store.filterColor === col) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        store.filterColor = col;
        renderFilters();
        refreshList();
      });
      elFilterList.appendChild(btn);
    });
  }

  function filteredItems(){
    if (!store.filterColor) return store.items.slice();
    return store.items.filter(it=>it.color===store.filterColor);
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

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'lm-cap-delete';
      btnDelete.textContent = '×';
      btnDelete.title = 'Delete caption';
      btnDelete.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        removeItem(it.id);
      });

      row.appendChild(sw);
      row.appendChild(title);
      row.appendChild(imgMark);
      row.appendChild(btnDelete);

      if (store.selectedId === it.id) row.classList.add('selected');

      row.addEventListener('click', ()=>{
        selectItem(it.id);
      });

      elList.appendChild(row);
    });
  }

  function selectItem(id){
    store.selectedId = id;
    if (elList){
      $$('.lm-cap-row', elList).forEach(row=>{
        row.classList.toggle('selected', row.dataset.id === id);
      });
    }
    const it = store.items.find(x=>x.id===id);
    if(!it) return;
    if (elTitle) elTitle.value = it.title || '';
    if (elBody)  elBody.value  = it.body  || '';
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
        return pinRuntime.getBridge();
      }
    }catch(_){}
    return window.__lm_viewer_bridge || null;
  }

  function addPinForItem(item){
    const br = getViewerBridge();
    if (!br || typeof br.addPinMarker !== 'function'){
      return warn('viewer bridge missing; cannot add pin');
    }
    const pos = item.pos || null;
    const color = item.color || store.colorPalette[0];
    br.addPinMarker(item.id, { color, pos });
  }

  function updatePinForItem(item){
    const br = getViewerBridge();
    if (!br || typeof br.updatePinMarker !== 'function'){
      return;
    }
    const pos = item.pos || null;
    const color = item.color || store.colorPalette[0];
    br.updatePinMarker(item.id, { color, pos });
  }

  // --- Add / Clear buttons -----------------------------------------------------
  if (elBtnAdd){
    elBtnAdd.addEventListener('click', ()=>{
      const br = getViewerBridge();
      let pos = null;
      if (br && typeof br.projectPoint === 'function'){
        try{
          pos = br.projectPoint();
        }catch(e){
          console.error(TAG,'projectPoint failed', e);
        }
      }
      const it = api.addItem({ pos });
      addPinForItem(it);
      selectItem(it.id);
    });
  }

  if (elBtnClear){
    elBtnClear.addEventListener('click', ()=>{
      if (!confirm('Clear all captions?')) return;
      store.items = [];
      store.selectedId = null;
      if (elTitle) elTitle.value = '';
      if (elBody)  elBody.value  = '';
      refreshList();
      const br = getViewerBridge();
      if (br && typeof br.clearPins === 'function'){
        br.clearPins();
      }
    });
  }

  // --- Image attach button -----------------------------------------------------
  if (elBtnAttachImage){
    elBtnAttachImage.addEventListener('click', ()=>{
      const it = api.getSelected();
      if (!it) return;
      const images = store.images || [];
      if (!images.length){
        alert('No images found in the same folder as the GLB.');
        return;
      }
      const names = images.map((img,i)=>`${i+1}: ${img.name || img.id}`);
      const choice = prompt(
        'Attach which image? (enter index)\n\n' + names.join('\n'),
        '1'
      );
      if (!choice) return;
      const idx = parseInt(choice,10)-1;
      if (isNaN(idx) || idx<0 || idx>=images.length){
        return alert('Invalid index');
      }
      it.image = images[idx];
      refreshList();
      scheduleChanged(it);
    });
  }

  // --- Initial render ----------------------------------------------------------
  renderColors();
  renderFilters();
  refreshList();

  log('ready');
})();
