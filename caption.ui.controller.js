// [caption.ui.controller] minimal UI wiring (phase A0)
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

  const elColorList = $('#caption-color-list', pane) || $('#caption-colors', pane);
  const elFilterList = $('#caption-filter-list', pane) || $('#caption-filters', pane);
  const elList = $('#caption-list', pane);
  const elTitle = $('#caption-title', pane);
  const elBody  = $('#caption-body', pane);
  const elImgStatus = $('#images-status');
  const elImages = $('#images-grid');

  // Stable store on window for now (Phase A0 → will be replaced by sheet bridge)
  const store = window.__lm_capt || (window.__lm_capt = {
    currentColor: '#eab308',
    filter: new Set(),
    items: [],
    selectedId: null,
    images: [],
  });

  // Color palette (legacy-compatible 10 colors)
  const PALETTE = ['#eab308','#a3e635','#60a5fa','#a78bfa','#93c5fd','#fda4af','#c084fc','#a3a3a3','#f97316','#22c55e'];

  function newId(){
    return 'c_'+Math.random().toString(36).slice(2,10);
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

  function refreshList(){
    if(!elList) return;
    elList.innerHTML = '';
    const activeColors = store.filter.size ? store.filter : null;
    const items = store.items.filter(it=>{
      return !activeColors || activeColors.has(it.color);
    });

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
      if (it.image && it.image.url) imgMark.textContent = '🖼';

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

  function selectItem(id){
    store.selectedId = id;
    // Update list highlight
    if(elList){
      $$('.lm-cap-row', elList).forEach(row=>{
        row.classList.toggle('selected', row.dataset.id === id);
      });
    }
    // Update detail fields
    const it = store.items.find(x=>x.id===id);
    if(!it) return;
    if (elTitle) elTitle.value = it.title || '';
    if (elBody)  elBody.value = it.body  || '';
    // TODO: image preview later
  }

  function removeItem(id){
    const idx = store.items.findIndex(x=>x.id===id);
    if(idx===-1) return;
    store.items.splice(idx,1);
    if (store.selectedId === id) store.selectedId = null;
    refreshList();
  }

  // Title / Body input wiring
  if (elTitle){
    let tId = 0;
    elTitle.addEventListener('input', ()=>{
      const id = store.selectedId; if(!id) return;
      const it = store.items.find(x=>x.id===id); if(!it) return;
      it.title = elTitle.value;
      if(tId) cancelAnimationFrame(tId);
      tId = requestAnimationFrame(()=>refreshList());
    });
  }
  if (elBody){
    let bId = 0;
    elBody.addEventListener('input', ()=>{
      const id = store.selectedId; if(!id) return;
      const it = store.items.find(x=>x.id===id); if(!it) return;
      it.body = elBody.value;
      if(bId) cancelAnimationFrame(bId);
      bId = requestAnimationFrame(()=>refreshList());
    });
  }

  // Shift+Click でピン + キャプションを追加するエントリポイント
  function addCaptionAt(x,y, world){
    const item = { id:newId(), title:'(untitled)', body:'', color:store.currentColor, pos: world||null };
    store.items.push(item);
    refreshList();
    selectItem(item.id);
    log('caption added', item);
    // Bridge (if present, ピンも描画する)
    try {
      const pinRuntime = window.__lm_pin_runtime;
      const bridge = (pinRuntime && typeof pinRuntime.getBridge === 'function'
        ? pinRuntime.getBridge()
        : window.__lm_viewer_bridge);
      if(bridge && typeof bridge.addPinMarker === 'function' && item.pos){
        const p = item.pos;
        bridge.addPinMarker({ id: item.id, x: p.x, y: p.y, z: p.z, color: item.color });
      }
    } catch(e){ /* ignore */ }
  }

  // Fallback: 旧 canvas(#gl) 上での Shift+Click を拾う（3D座標は取れない）
  (function(){
    const canvas = document.getElementById('gl');
    if(!canvas){ return; }
    canvas.addEventListener('click', (e)=>{
      if(!e.shiftKey) return;
      addCaptionAt(e.offsetX, e.offsetY, null);
    });
  })();

  // Viewer bridge: 3D座標での Shift+Click からキャプション追加
  (function(){
    let hooked = false;
    function bind(){
      if (hooked) return true;
      const pinRuntime = window.__lm_pin_runtime;
      const bridge = (pinRuntime && typeof pinRuntime.getBridge === 'function'
        ? pinRuntime.getBridge()
        : window.__lm_viewer_bridge);
      if (!bridge || typeof bridge.onCanvasShiftPick !== 'function') return false;
      try{
        bridge.onCanvasShiftPick(({ x, y, z })=>{
          addCaptionAt(0, 0, { x, y, z });
        });
        hooked = true;
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

  // Public API for other modules
  window.__LM_CAPTION_UI = {
    addCaptionAt, refreshList, selectItem, removeItem,
    get items(){ return store.items; },
    setImages(list){ store.images = Array.isArray(list)? list : []; renderImages(); }
  };

  // --- images --------------------------------------------------------------
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
      });
      grid.appendChild(wrap);
    });
  }

  renderColors();
  renderFilters();
  refreshList();

  log('ready');
})();
