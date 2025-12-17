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
  let elFilterStatus = $('#pinFilterStatus', pane);
  let elFilterClear  = $('#btnClearPinFilter', pane);
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
    elPreview.className = 'lm-cap-preview';
    try{
      elImages.parentElement.insertBefore(elPreview, elImages);
    }catch(e){
      warn('preview insert failed', e);
    }
  }


  // Store (stable on window to survive reload of this script)
  const store = window.__LM_CAPTION_STORE || (window.__LM_CAPTION_STORE = {
    currentColor: '#eab308',
    filter: null, // null = filter OFF (show all); Set() = filter ON (empty means show none)
    items: [],
    selectedId: null,
    images: []
  });
  function getSelectedIdValue() {
    const sel = store.selectedId;
    if (!sel) return null;
    if (typeof sel === 'string') return sel;
    if (typeof sel === 'object' && sel.id) return sel.id;
    try {
      return String(sel);
    } catch (e) {
      return null;
    }
  }



  const PALETTE = ['#facc15','#f97316','#ef4444','#ec4899','#8b5cf6','#3b82f6','#0ea5e9','#22c55e','#14b8a6','#a3a3a3'];

  // --- Pin filter colors (used colors only; checkmark means VISIBLE) ----------
  let __lm_usedFilterColors = [];

  function __lm_normHexLocal(v){
    if (!v) return null;
    if (typeof v !== 'string') v = String(v);
    v = v.trim();
    if (!v) return null;
    // #rgb or #rrggbb
    if (v[0] === '#'){
      const s = v.toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(s)) return s;
      if (/^#[0-9a-f]{3}$/.test(s)){
        return '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
      }
      return null;
    }
    // rgb(r,g,b)
    const m = v.match(/^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    if (m){
      const r = Math.max(0, Math.min(255, parseInt(m[1],10)));
      const g = Math.max(0, Math.min(255, parseInt(m[2],10)));
      const b = Math.max(0, Math.min(255, parseInt(m[3],10)));
      return '#' + [r,g,b].map(n=>n.toString(16).padStart(2,'0')).join('');
    }
    return null;
  }

  function __lm_computeUsedFilterColors(){
    const used = new Set();
    try{
      (store.items || []).forEach(it=>{
        const hex = __lm_normHexLocal(it && it.color);
        if (hex) used.add(hex);
      });
    }catch(_){}

    // Order: palette order first, then the rest (stable lexicographic)
    const out = [];
    const rest = new Set(used);
    PALETTE.forEach(c=>{
      const hex = __lm_normHexLocal(c);
      if (hex && rest.has(hex)){
        out.push(hex);
        rest.delete(hex);
      }
    });
    const tail = Array.from(rest);
    tail.sort();
    return out.concat(tail);
  }

  function __lm_refreshUsedFilterColors(){
    __lm_usedFilterColors = __lm_computeUsedFilterColors();
    return __lm_usedFilterColors;
  }

  function __lm_getUsedFilterColors(){
    return __lm_usedFilterColors || [];
  }

  function syncFilterToUsedColors(){
    // Keeps store.filter as "VISIBLE colors set" (never empty when colors exist).
    const prevUsed = __lm_getUsedFilterColors();
    const prevUsedCount = prevUsed.length;
    const active = (store.filter instanceof Set) ? store.filter : (store.filter = new Set());
    const wasAll = (prevUsedCount > 0) && (active.size === prevUsedCount);

    const used = __lm_refreshUsedFilterColors();
    const usedCount = used.length;

    if (!usedCount){
      active.clear();
      return;
    }

    const usedSet = new Set(used);

    if (wasAll || active.size === 0){
      active.clear();
      used.forEach(c=>active.add(c));
      return;
    }

    // Intersect with used colors (drop colors no longer used on this sheet),
    // and normalize to canonical "#rrggbb" strings.
    const next = new Set();
    Array.from(active).forEach(c=>{
      const hex = __lm_normHexLocal(c);
      if (hex && usedSet.has(hex)) next.add(hex);
    });

    active.clear();
    next.forEach(c=>active.add(c));

    // Never allow empty selection when there are used colors
    if (active.size === 0){
      used.forEach(c=>active.add(c));
    }
  }



  function newId(){
    return 'c_' + Math.random().toString(36).slice(2,10);
  }

  // --- small event hub for Sheets bridge --------------------------------------
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

    // Coalesce multiple quick changes (title, body, image, position...) into
    // a single notification per animation frame to avoid hammering Sheets API.
    if (typeof requestAnimationFrame === 'function') {
      const prev = dirtyTimers.get(id);
      if (prev) cancelAnimationFrame(prev);
      const t = requestAnimationFrame(()=>{
        dirtyTimers.delete(id);
        try {
          emitItemChanged(item);
        } catch (e) {
          console.error(TAG, 'scheduleChanged deferred emit failed', e);
        }
      });
      dirtyTimers.set(id, t);
    } else {
      // Fallback for environments without rAF
      emitItemChanged(item);
    }
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

  function syncPinsFromItems(){
    const br = getViewerBridge();
    if (!br || typeof br.clearPins !== 'function' || typeof br.addPinMarker !== 'function') return;
    try{
      br.clearPins();
      store.items.forEach(it=>{ if (it.pos) addPinForItem(it); });
      applyPinFilter();
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
    // （無限 pinSelect ループ防止）
    if (fromViewer) return;

    try{
      br.setPinSelected(id || null, !!id);
    }catch(e){
      warn('syncViewerSelection failed', e);
    }
  }

  // --- colors / filters -------------------------------------------------------
  function renderColors(){
    if (!elColorList) return;
    elColorList.innerHTML = '';
    PALETTE.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
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
    // Filter chips show ONLY colors that are actually used on the current caption sheet.
    const used = __lm_getUsedFilterColors();
    elFilterList.innerHTML = '';
    if (!used || !used.length){
      return;
    }
    used.forEach(col=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.style.backgroundColor = col;

      const f = store.filter;
      const isOn = (f === null) ? true : ((f instanceof Set) ? f.has(col) : false);
      if (isOn) btn.classList.add('active');
      try{ btn.setAttribute('aria-pressed', isOn ? 'true' : 'false'); }catch(_){}

      btn.addEventListener('click', ()=>{
        // filter semantics:
        //   store.filter === null  => OFF (show all)
        //   store.filter is Set()  => ON  (empty => show none)
        let active;
        if (store.filter === null){
          // First interaction turns filter ON with "all used" selected
          active = new Set();
          used.forEach(c=>active.add(c));
          store.filter = active;
        }else if (store.filter instanceof Set){
          active = store.filter;
        }else{
          active = (store.filter = new Set());
        }

        if (active.has(col)){
          // Allow empty set (show none)
          active.delete(col);
        }else{
          active.add(col);
        }

        renderFilters();
        updateFilterStatus();
        applyPinFilter();
      });

      elFilterList.appendChild(btn);
    });
  }



  function updateFilterStatus(){
    const used = __lm_getUsedFilterColors();
    const usedCount = used ? used.length : 0;

    const f = store.filter;
    const active = (f instanceof Set) ? f : null;
    const activeCount = active ? active.size : 0;

    if (elFilterStatus){
      if (!usedCount){
        elFilterStatus.textContent = 'Filter: (no pins)';
      }else if (f === null){
        elFilterStatus.textContent = `Filter: OFF (All ${usedCount})`;
      }else if (activeCount === 0){
        elFilterStatus.textContent = `Filter: None (0/${usedCount})`;
      }else if (activeCount >= usedCount){
        elFilterStatus.textContent = `Filter: All (${usedCount})`;
      }else{
        elFilterStatus.textContent = `Filter: ${activeCount}/${usedCount}`;
      }
    }
    if (elFilterList){
      try{
        elFilterList.dataset.usedCount = String(usedCount);
        elFilterList.dataset.activeCount = String((f === null) ? usedCount : activeCount);
      }catch(_){}
    }
    if (elFilterClear){
      // Clear turns OFF (show all). Disable when already OFF or when no pins exist.
      elFilterClear.disabled = (!usedCount) || (f === null);
    }
  }


  function applyPinFilter(){
    const br = getViewerBridge();
    if (!br || typeof br.setPinColorFilter !== 'function') return;
    try{
      const f = store.filter;
      if (f === null){
        // OFF = show all pins
        br.setPinColorFilter(null);
      }else{
        // ON = show subset; empty => show none
        const colors = Array.from((f instanceof Set) ? f : []);
        br.setPinColorFilter(colors);
      }
    }catch(e){
      warn('setPinColorFilter failed', e);
    }
  }

  function bindFilterClearButton(){
    if (!elFilterClear) return;
    if (elFilterClear.__lmBound) return;
    elFilterClear.__lmBound = true;
    elFilterClear.addEventListener('click', ()=>{
      // Clear = turn filter OFF (show all pins)
      store.filter = null;
      renderFilters();
      updateFilterStatus();
      applyPinFilter();
    });
  }


  function filteredItems(){
    // List filtering is intentionally disabled:
    // the filter now hides pins in the viewer while keeping the list visible.
    return store.items.slice();
  }

  // --- caption list -----------------------------------------------------------
  function refreshList(){
    if (!elList) return;
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
      if (it.imageFileId || (it.image && (it.image.id || it.image.url))) imgMark.textContent = '🖼';

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

      if (getSelectedIdValue() === it.id) row.classList.add('selected');

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
    // a 3D pin position. When selection originates from the viewer, the call
    // is marked with fromViewer so that syncViewerSelection does not echo it
    // back to the viewer.
    syncViewerSelection(it.pos ? it.id : null, {fromViewer});

    // Visual aid: pulse the selected pin in the viewer
    try{
      const br = getViewerBridge();
      if (it.pos && br && typeof br.pulsePin === 'function') br.pulsePin(it.id);
    }catch(e){ warn('pulsePin failed', e); }

    // Keep selected pin visible even when a color filter is active
    applyPinFilter();

    renderImages();
    renderPreview();
    emitItemSelected(it);
  }
  function removeItem(id){
    const idx = store.items.findIndex(x=>x.id===id);
    if (idx === -1) return;
    const removed = store.items.splice(idx,1)[0] || null;
    if (getSelectedIdValue() === id) store.selectedId = null;

    // 3D ピンも削除／再構築
    try{
      const br = getViewerBridge();
      if (br){
        if (typeof br.removePinMarker === 'function'){
          br.removePinMarker(id);
        }else if (typeof br.clearPins === 'function' && typeof br.addPinMarker === 'function'){
          syncPinsFromItems();
        }
      }
    }catch(e){
      warn('removePinMarker failed', e);
    }

    // Sheets へ削除通知（ソフトデリートは caption.sheet.bridge 側）
    if (removed && removed.id){
      emitItemDeleted(removed);
    }else{
      emitItemDeleted({ id });
    }

    // Used colors may have changed; keep filter chips/state consistent.
    try{ syncFilterToUsedColors(); }catch(_){}
    renderFilters();
    updateFilterStatus();
    applyPinFilter();

    refreshList();
    renderImages();
    renderPreview();
  }

  // --- Title / Body input wiring ----------------------------------------------
  if (elTitle){
    let rafId = 0;
    let composing = false;
    let justCommitted = false;

    elTitle.addEventListener('compositionstart', ()=>{ composing = true; });
    elTitle.addEventListener('compositionend', ()=>{
      composing = false;
      justCommitted = true;
      const id = getSelectedIdValue(); if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.title = elTitle.value;
      scheduleChanged(it);
      setTimeout(()=>{ justCommitted = false; }, 0);
    });

    elTitle.addEventListener('input', ()=>{
      const id = getSelectedIdValue(); if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.title = elTitle.value;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(()=>refreshList());
      if (composing) return;
      if (justCommitted) return;
      scheduleChanged(it);
    });

    elTitle.addEventListener('blur', ()=>{
      const id = getSelectedIdValue(); if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.title = elTitle.value;
      scheduleChanged(it);
    });
  }

  if (elBody){
    let rafId = 0;
    let composing = false;
    let justCommitted = false;

    elBody.addEventListener('compositionstart', ()=>{ composing = true; });
    elBody.addEventListener('compositionend', ()=>{
      composing = false;
      justCommitted = true;
      const id = getSelectedIdValue(); if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.body = elBody.value;
      scheduleChanged(it);
      setTimeout(()=>{ justCommitted = false; }, 0);
    });

    elBody.addEventListener('input', ()=>{
      const id = getSelectedIdValue(); if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.body = elBody.value;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(()=>{});
      if (composing) return;
      if (justCommitted) return;
      scheduleChanged(it);
    });

    elBody.addEventListener('blur', ()=>{
      const id = getSelectedIdValue(); if (!id) return;
      const it = store.items.find(x=>x.id===id); if (!it) return;
      it.body = elBody.value;
      scheduleChanged(it);
    });
  }

  // --- Images grid ------------------------------------------------------------
  function getSelectedItem(){
    const sid = getSelectedIdValue();
    if (!sid) return null;
    return store.items.find(x=>x.id === sid) || null;
  }

  function renderPreview(){
    if (!elPreview) return;
    const sel = getSelectedItem();
    elPreview.innerHTML = '';
    if (!sel || !(sel.imageFileId || (sel.image && sel.image.id))){
      elPreview.style.display = 'none';
      return;
    }
    const imgId = sel.imageFileId || (sel.image && sel.image.id);
    const list = store.images || [];
    const meta = (list.find(it => it.id === imgId) || sel.image || null);
    if (!meta){
      elPreview.style.display = 'none';
      return;
    }
    const url = meta.thumbUrl || meta.thumbnailUrl || meta.url || meta.webContentLink || meta.webViewLink || '';
    if (!url){
      elPreview.style.display = 'none';
      return;
    }
    const label = document.createElement('div');
    label.className = 'lm-cap-preview-label';
    label.textContent = 'Attached image';
    const img = document.createElement('img');
    img.src = url;
    img.alt = meta.name || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    elPreview.appendChild(label);
    elPreview.appendChild(img);
    elPreview.style.display = 'block';
  }

  function renderImages(){
    if (!elImages) return;
    // enforce grid layout from JS (3 columns) in case CSS is old
    elImages.style.display = 'grid';
    elImages.style.gridTemplateColumns = 'repeat(3, minmax(72px, 1fr))';
    elImages.style.gap = '6px';
    elImages.style.maxHeight = '360px';
    elImages.style.overflowY = 'auto';

    const list = store.images || [];
    elImages.innerHTML = '';
    const selected = getSelectedItem();
    const selectedImageId = selected && (selected.imageFileId || (selected.image && selected.image.id));

    if (!list.length){
      if (elImgStatus) elImgStatus.textContent = '画像はまだありません';
      return;
    }

    if (elImgStatus) elImgStatus.textContent = `${list.length} 枚の画像`;

    list.forEach(imgInfo=>{
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = 'lm-img-item';
      wrap.dataset.id = imgInfo.id;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = imgInfo.thumbUrl || imgInfo.thumbnailUrl || imgInfo.url || '';
      img.alt = imgInfo.name || '';
      wrap.appendChild(img);

      const label = document.createElement('div');
      label.className = 'lm-img-label';
      label.textContent = imgInfo.name || '(image)';
      wrap.appendChild(label);

      // detach button (visible on hover / when attached)
      const detach = document.createElement('button');
      detach.type = 'button';
      detach.textContent = '×';
      detach.title = 'Detach image';
      detach.style.position = 'absolute';
      detach.style.top = '2px';
      detach.style.right = '2px';
      detach.style.width = '16px';
      detach.style.height = '16px';
      detach.style.border = 'none';
      detach.style.borderRadius = '999px';
      detach.style.padding = '0';
      detach.style.fontSize = '11px';
      detach.style.lineHeight = '1';
      detach.style.background = 'rgba(15,23,42,0.9)';
      detach.style.color = '#e5e7eb';
      detach.style.cursor = 'pointer';
      detach.style.opacity = '0';
      detach.style.transition = 'opacity .12s ease-out';
      wrap.style.position = 'relative';

      if (selectedImageId && selectedImageId === imgInfo.id){
        wrap.classList.add('active');
        detach.style.opacity = '1';
      }

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
          scheduleChanged(cur);
          refreshList();
          renderImages();
  renderPreview();
          renderPreview();
        }
      });

      wrap.appendChild(detach);

      wrap.addEventListener('click', ()=>{
        const cur = getSelectedItem();
        if (!cur){
          log('image click ignored (no caption selected)');
          return;
        }
        // attach (no toggle; detach is handled by × button)
        cur.imageFileId = imgInfo.id;
        cur.image = imgInfo;
        scheduleChanged(cur);
        refreshList();   // 🖼 マーク更新
        renderImages();  // ハイライト更新
        renderPreview();
      });

      elImages.appendChild(wrap);
    });
  }
  if (elRefreshImg){
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

    // Filter chips are derived from used colors on this sheet.
    try{ syncFilterToUsedColors(); }catch(_){}

    renderFilters();
    updateFilterStatus();
    applyPinFilter();

    refreshList();
    syncPinsFromItems();
    renderImages();
    renderPreview();
  }


  function setImages(images){
    store.images = images || [];
    renderImages();
  renderPreview();
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

    // Used-colors filter chips may change when a new pin is added.
    try{ syncFilterToUsedColors(); }catch(_){}
    renderFilters();
    updateFilterStatus();

    refreshList();
    selectItem(item.id);
    addPinForItem(item);

    applyPinFilter();
    emitItemAdded(item);
  }

  // fallback click: GL canvas 上の Shift+クリック
  function installFallbackClick(){
    const area = document.getElementById('gl') ||
                 document.querySelector('#viewer,#glCanvas,#glcanvas');
    if (!area) return;
    area.addEventListener('click', (ev)=>{
      if (!ev.shiftKey) return;
      if (worldHookInstalled) return; // A案: world-hook が入っているなら fallback は使わない（初回座標欠落対策）
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
        try{
          const keys = payload && typeof payload === 'object' ? Object.keys(payload) : null;
          const pt = payload && (payload.point || payload);
        }catch(_){ }
        if (!payload) return;
        const world = payload.point || payload;
        if (!world ||
            typeof world.x !== 'number' ||
            typeof world.y !== 'number' ||
            typeof world.z !== 'number') {
          log('onCanvasShiftPick payload missing numeric point', payload);
          return;
        }
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

  // Expose UI API
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
  };  window.__LM_CAPTION_UI.__ver = 'A2';


  // initial render
  renderColors();
  try{ syncFilterToUsedColors(); }catch(_){}
  renderFilters();
  updateFilterStatus();
  bindFilterClearButton();
  applyPinFilter();
  refreshList();
  renderImages();
  renderPreview();

  try{
    document.dispatchEvent(new Event('lm:caption-ui-ready'));
  }catch(_){}
  log('ready');
})();
