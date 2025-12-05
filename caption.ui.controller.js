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
  const elColorList  = $('#pinColorChips');
  const elAddBtn     = $('#btnAddCaption');
  const elTitle      = $('#captionTitle');
  const elBody       = $('#captionBody');
  const elList       = $('#captionList');
  const elCoordX     = $('#captionCoordX');
  const elCoordY     = $('#captionCoordY');
  const elCoordZ     = $('#captionCoordZ');
  const elImagesWrap = $('#captionImagesWrap');
  const elAddImageBtn= $('#btnAddImage');
  const elRefreshImgBtn = $('#btnRefreshImages');

  if (!elColorList || !elAddBtn || !elTitle || !elBody || !elList){
    return warn('base elements missing; skip init');
  }

  // ---- State ----
  const store = {
    items: [],    // {id, title, body, color, pos:{x,y,z}, images:[], createdAt, updatedAt}
    selectedId: null,
    activeColor: null,
    idCounter: 0,
  };

  // ---- Viewer bridge (Three scene + overlay hook) ----
  function getViewerBridge(){
    try{
      if (window.__lm_viewer_bridge) return window.__lm_viewer_bridge;
      if (window.viewerBridge) return window.viewerBridge;
      if (window.__lm_pin_runtime && typeof window.__lm_pin_runtime.getBridge === 'function'){
        const b = window.__lm_pin_runtime.getBridge();
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
      // viewer.module.cdn.js 側の仕様に合わせて position:{x,y,z} を渡す
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

  function setPinSelected(id){
    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;
    try{
      br.setPinSelected(id);
    }catch(e){
      warn('setPinSelected failed', e);
    }
  }

  function projectToWorldFromOverlay(ev){
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick!=='function'){
      warn('projectToWorldFromOverlay: no onCanvasShiftPick');
      return null;
    }
    try{
      const rect = ev.target.closest('canvas')?.getBoundingClientRect();
      if (!rect) return null;
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top)  / rect.height;
      const world = br.onCanvasShiftPick(x, y);
      if (!world || typeof world.x!=='number') return null;
      return world;
    }catch(e){
      warn('projectToWorldFromOverlay failed', e);
      return null;
    }
  }

  // ---- ID helper ----
  function nextId(){
    store.idCounter += 1;
    return 'c_' + Math.random().toString(36).slice(2,10);
  }

  // ---- Color chips ----
  function initColorChips(){
    if (!elColorList) return;
    const chips = $$('.pin-color-chip', elColorList);
    if (!chips.length) return;
    chips.forEach(ch=>{
      ch.addEventListener('click', ()=>{
        const color = ch.dataset.color || ch.style.backgroundColor || '#ff0000';
        store.activeColor = color;
        chips.forEach(c=>c.classList.remove('active'));
        ch.classList.add('active');
      });
    });
    // default
    const first = chips[0];
    if (first){
      const color = first.dataset.color || first.style.backgroundColor || '#ff0000';
      store.activeColor = color;
      first.classList.add('active');
    }
  }

  // ---- UI Rendering ----
  function renderList(){
    elList.innerHTML = '';
    store.items.forEach(item=>{
      const li = document.createElement('li');
      li.className = 'caption-item';
      li.dataset.id = item.id;

      const colorDot = document.createElement('span');
      colorDot.className = 'caption-color-dot';
      colorDot.style.backgroundColor = item.color || '#ccc';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'caption-title';
      titleSpan.textContent = item.title || '(no title)';

      const bodySpan = document.createElement('span');
      bodySpan.className = 'caption-body-snippet';
      bodySpan.textContent = item.body || '';

      li.appendChild(colorDot);
      li.appendChild(titleSpan);
      li.appendChild(bodySpan);

      if (item.id === store.selectedId){
        li.classList.add('selected');
      }

      li.addEventListener('click', ()=>{
        selectItem(item.id);
      });

      elList.appendChild(li);
    });
  }

  function renderDetail(){
    const item = store.items.find(it=>it.id === store.selectedId) || null;
    if (!item){
      elTitle.value = '';
      elBody.value = '';
      elCoordX.value = '';
      elCoordY.value = '';
      elCoordZ.value = '';
      elImagesWrap.innerHTML = '';
      return;
    }
    elTitle.value = item.title || '';
    elBody.value = item.body || '';
    if (item.pos){
      elCoordX.value = String(item.pos.x ?? '');
      elCoordY.value = String(item.pos.y ?? '');
      elCoordZ.value = String(item.pos.z ?? '');
    }else{
      elCoordX.value = '';
      elCoordY.value = '';
      elCoordZ.value = '';
    }

    // Images (simple list)
    elImagesWrap.innerHTML = '';
    (item.images || []).forEach(url=>{
      const img = document.createElement('img');
      img.className='caption-image-thumb';
      img.src = url;
      elImagesWrap.appendChild(img);
    });
  }

  function selectItem(id){
    store.selectedId = id;
    renderList();
    renderDetail();
    setPinSelected(id);
  }

  // ---- Add caption (from button + Shift+Click hook) ----
  function addCaptionAt(pos){
    const id = nextId();
    const color = store.activeColor || '#ff0000';
    const now = new Date().toISOString();

    const item = {
      id,
      title: elTitle.value || '',
      body: elBody.value || '',
      color,
      pos: pos || null,
      images: [],
      createdAt: now,
      updatedAt: now,
    };
    store.items.push(item);
    store.selectedId = id;
    renderList();
    renderDetail();
    addPinForItem(item);
    emitItemAdded(item);
  }

  function emitItemAdded(item){
    document.dispatchEvent(new CustomEvent('lm:caption-added', { detail:{ item } }));
  }

  // ---- Shift+Click -> world position -> add caption ----
  function installWorldSpaceHook(){
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick!=='function'){
      warn('installWorldSpaceHook: no onCanvasShiftPick on bridge');
      return;
    }
    // caption.viewer.overlay.js 側から dispatch されるイベントを受ける
    document.addEventListener('lm:world-click', (ev)=>{
      const detail = ev.detail || {};
      const world = detail.world;
      if (!world || typeof world.x!=='number') return;
      addCaptionAt(world);
    });
  }

  // ---- Sheets bridge: append / load ----
  function getSheetBridge(){
    return window.__lm_caption_sheet_bridge || null;
  }

  function setItems(items){
    store.items = Array.isArray(items) ? items.slice() : [];
    renderList();
    renderDetail();
    syncPinsFromItems();
  }

  function getItems(){
    return store.items.slice();
  }

  function notifySelectionChanged(){
    const item = store.items.find(it=>it.id === store.selectedId) || null;
    document.dispatchEvent(new CustomEvent('lm:caption-selection', { detail:{ item } }));
  }

  // ---- Events ----
  elAddBtn.addEventListener('click', ()=>{
    // World pos は overlay 経由のイベントでセットされる想定だが、
    // ここでは pos=null としてとりあえず追加（後から編集可）
    addCaptionAt(null);
  });

  elTitle.addEventListener('input', ()=>{
    const item = store.items.find(it=>it.id === store.selectedId);
    if (!item) return;
    item.title = elTitle.value;
    item.updatedAt = new Date().toISOString();
    renderList();
    notifySelectionChanged();
  });

  elBody.addEventListener('input', ()=>{
    const item = store.items.find(it=>it.id === store.selectedId);
    if (!item) return;
    item.body = elBody.value;
    item.updatedAt = new Date().toISOString();
    notifySelectionChanged();
  });

  // Images: external loader module manages the actual URLs / refresh
  if (elRefreshImgBtn){
    elRefreshImgBtn.addEventListener('click', ()=>{
      document.dispatchEvent(new Event('lm:caption-images-refresh'));
    });
  }

  // ---- Integration with caption.sheet.bridge.js ----
  window.__LM_CAPTION_UI = {
    __ver: 'A2',
    setItems,
    getItems,
    selectItem,
    syncPinsFromItems,
  };

  // ---- Init ----
  initColorChips();
  installWorldSpaceHook();
  renderList();
  renderDetail();

  log('ready');
})();
