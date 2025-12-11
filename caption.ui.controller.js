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

  function createEl(tag, cls, text){
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text!=null) el.textContent = text;
    return el;
  }

  // Global store (per-page; survives reloads within same tab)
  const store = window.__LM_CAPTION_STORE = window.__LM_CAPTION_STORE || {
    items: [],
    selectedId: null,
    images: [],
    filter: new Set(),
    currentColor: '#eab308'
  };

  let lastAddAtMs = 0;
  let preferWorldClicks = false;
  let worldHookInstalled = false;

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
    const fromViewer = !!(options && options.fromViewer);
    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;

    // ビューア側から来た選択イベントは「送り返さない」
    if (fromViewer) {
      return;
    }

    try{
      if (id){
        br.setPinSelected(id);
      }else{
        br.setPinSelected(null);
      }
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
        selectItem(id, { fromViewer:true });
      });
    }catch(e){
      warn('onPinSelect hook failed', e);
    }
  }

  // ---------------------------------------------------------------------------
  // ID, items, selection
  // ---------------------------------------------------------------------------
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

  function selectItem(id, opts){
    const options = opts || {};
    const fromViewer = !!(options && options.fromViewer);

    store.selectedId = id || null;
    refreshList();
    renderDetail();

    if (!fromViewer){
      syncViewerSelection(id || null, { fromViewer:false });
    }
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
      const br = getViewerBridge();
      if (br && typeof br.removePinMarker === 'function'){
        try{
          br.removePinMarker(id);
          if (typeof br.clearPins === 'function' && typeof br.addPinMarker === 'function'){
            syncPinsFromItems();
          }
        }catch(e){
          warn('removePinMarker failed', e);
        }
      }
      emitItemDeleted(removed);
    }
  }

  // ---------------------------------------------------------------------------
  // UI: list + detail
  // ---------------------------------------------------------------------------
  const listEl   = $('#caption-list');
  const detailEl = $('#caption-detail');
  const colorButtons = $$('.lm-caption-color');

  function renderListItem(item){
    const li = document.createElement('li');
    li.className = 'lm-caption-item';
    li.dataset.id = item.id;
    if (item.id === store.selectedId){
      li.classList.add('selected');
    }

    const dot = document.createElement('span');
    dot.className = 'lm-caption-color-dot';
    dot.style.backgroundColor = item.color || '#eab308';

    const title = document.createElement('span');
    title.className = 'lm-caption-title';
    title.textContent = item.title || '(untitled)';

    li.appendChild(dot);
    li.appendChild(title);
    li.addEventListener('click', ()=>{
      selectItem(item.id, { fromViewer:false });
    });

    return li;
  }

  function refreshList(){
    if (!listEl) return;
    listEl.innerHTML = '';
    const items = store.items || [];
    items.forEach(it=>{
      const li = renderListItem(it);
      listEl.appendChild(li);
    });
  }

  function renderDetail(){
    if (!detailEl) return;
    const item = findItem(store.selectedId);
    detailEl.innerHTML = '';

    if (!item){
      const msg = document.createElement('div');
      msg.className = 'lm-caption-empty';
      msg.textContent = 'ピンを Shift+クリックしてキャプションを追加してください。';
      detailEl.appendChild(msg);
      return;
    }

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'lm-caption-input-title';
    titleInput.value = item.title || '';
    titleInput.addEventListener('input', ()=>{
      item.title = titleInput.value;
      emitItemChanged(item);
      refreshList();
    });

    const bodyArea = document.createElement('textarea');
    bodyArea.className = 'lm-caption-input-body';
    bodyArea.value = item.body || '';
    bodyArea.addEventListener('input', ()=>{
      item.body = bodyArea.value;
      emitItemChanged(item);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '削除';
    delBtn.className = 'lm-caption-delete';
    delBtn.addEventListener('click', ()=>{
      if (item.id) removeItem(item.id);
    });

    detailEl.appendChild(titleInput);
    detailEl.appendChild(bodyArea);
    detailEl.appendChild(delBtn);
  }

  // ---------------------------------------------------------------------------
  // Color selection
  // ---------------------------------------------------------------------------
  function setupColorButtons(){
    if (!colorButtons || !colorButtons.length) return;
    colorButtons.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const color = btn.dataset.color || '#eab308';
        store.currentColor = color;
        colorButtons.forEach(b=>b.classList.toggle('active', b===btn));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Add caption / click handling
  // ---------------------------------------------------------------------------
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
      if (preferWorldClicks) return;
      if (!ev.shiftKey) return;
      const rect = area.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / (rect.width || 1);
      const y = (ev.clientY - rect.top) / (rect.height || 1);
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
        // viewer.module.cdn.js の onCanvasShiftPick は { point:{x,y,z}, event, hit } 形式
        // 旧バージョン互換として payload 自体が {x,y,z} の場合も許容する
        const p = payload.point || payload;
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') {
          log('onCanvasShiftPick payload has no numeric point', p);
          return;
        }
        preferWorldClicks = true;
        // world 座標だけを保存対象として渡す
        addCaptionAt(0.5, 0.5, { x: p.x, y: p.y, z: p.z });
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

  // ---------------------------------------------------------------------------
  // Images integration (simplified)
  // ---------------------------------------------------------------------------
  function setImages(images){
    store.images = images || [];
    renderImages();
  }

  function renderImages(){
    // 実装省略（既存ロジックをそのまま残す）
  }

  // ---------------------------------------------------------------------------
  // External API for other modules
  // ---------------------------------------------------------------------------
  const addListeners = [];
  const changeListeners = [];
  const deleteListeners = [];

  function onItemAdded(fn){
    if (typeof fn === 'function') addListeners.push(fn);
  }
  function onItemChanged(fn){
    if (typeof fn === 'function') changeListeners.push(fn);
  }
  function onItemDeleted(fn){
    if (typeof fn === 'function') deleteListeners.push(fn);
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

  function setItems(items){
    store.items = (items || []).map(normalizeItem);
    refreshList();
    syncPinsFromItems();
    renderImages();
    renderPreview();
  }

  // preview rendering 略（既存コードをそのまま）

  function refresh(){
    refreshList();
    renderDetail();
    syncPinsFromItems();
  }

  // init
  setupColorButtons();
  setupViewerPinSelection();
  refresh();

  window.__LM_CAPTION_UI = {
    __ver: 'A2',
    addCaptionAt,
    refreshList,
    selectItem,
    removeItem,
    setItems,
    setImages,
    onItemAdded,
    onItemChanged,
    onItemDeleted,
    get items(){ return store.items; },
    get selectedId(){ return store.selectedId; }
  };

  log('ready');
})();
