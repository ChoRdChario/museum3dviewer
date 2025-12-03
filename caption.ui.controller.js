// caption.ui.controller.js
(function(){
  'use strict';

  const LOG_PREFIX = '[caption.ui.controller]';

  function log(...args){
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args){
    console.warn(LOG_PREFIX, ...args);
  }

  // ----------------------------------------------------------------------------
  // State
  // ----------------------------------------------------------------------------

  let currentSpreadsheetId = null;
  let currentSheetGid = null;
  let captionsById = new Map(); // id -> caption item
  let captionOrder = [];        // array of ids (for UI ordering)
  let isSyncingFromViewer = false;
  let isSyncingToViewer = false;

  let viewerBridge = null;
  let worldHookInstalled = false;
  let preferWorldClicks = false;

  // ----------------------------------------------------------------------------
  // Utilities
  // ----------------------------------------------------------------------------

  function getViewerBridge(){
    if (viewerBridge) return viewerBridge;
    if (window.__lm_viewer_bridge){
      viewerBridge = window.__lm_viewer_bridge;
      return viewerBridge;
    }
    return null;
  }

  function setSheetContext(ctx){
    currentSpreadsheetId = ctx && ctx.spreadsheetId || null;
    currentSheetGid      = ctx && ctx.sheetGid      || null;
  }

  function ensureCaptionItem(id){
    let item = captionsById.get(id);
    if (!item){
      item = {
        id,
        title: '(untitled)',
        body: '',
        color: '#eab308',
        pos: null,
        imageFileId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deleted: false
      };
      captionsById.set(id, item);
      captionOrder.push(id);
    }
    return item;
  }

  function updateCaptionItem(id, patch){
    const item = ensureCaptionItem(id);
    Object.assign(item, patch || {});
    item.updatedAt = new Date().toISOString();
    return item;
  }

  function getActiveCaptionId(){
    const root = document.getElementById('caption-root');
    if (!root) return null;
    const active = root.querySelector('.lm-caption-card.is-active');
    if (!active) return null;
    return active.dataset.captionId || null;
  }

  // ----------------------------------------------------------------------------
  // Viewer bridge helpers
  // ----------------------------------------------------------------------------

  function syncViewerSelection(id){
    if (isSyncingFromViewer) {
      log('skip re-entrant syncViewerSelection', null);
      return;
    }
    const br = getViewerBridge();
    if (!br || typeof br.setPinSelected !== 'function') return;
    try{
      isSyncingToViewer = true;
      br.setPinSelected(id);
    }catch(e){
      warn('syncViewerSelection failed', e);
    }finally{
      isSyncingToViewer = false;
    }
  }

  function onViewerPinSelected(id){
    if (isSyncingToViewer) return;
    const root = document.getElementById('caption-root');
    if (!root) return;
    const card = root.querySelector(`.lm-caption-card[data-caption-id="${id}"]`);
    if (!card) return;

    isSyncingFromViewer = true;
    try{
      root.querySelectorAll('.lm-caption-card.is-active').forEach(el => el.classList.remove('is-active'));
      card.classList.add('is-active');
      card.scrollIntoView({block:'nearest', behavior:'smooth'});
    }finally{
      isSyncingFromViewer = false;
    }
  }

  // ----------------------------------------------------------------------------
  // World-space hook
  // ----------------------------------------------------------------------------

  function tryInstallWorldSpaceHook(){
    if (worldHookInstalled) return;
    const br = getViewerBridge();
    if (!br || typeof br.onCanvasShiftPick !== 'function') return;
    try{
      // viewer.module.cdn.js 側では onCanvasShiftPick に
      //   { point: THREE.Vector3 | null, intersect: {...} }
      // という payload を渡してくる。
      br.onCanvasShiftPick((payload)=>{
        if (!payload || !payload.point) return;
        const p = payload.point;
        const world = { x: p.x, y: p.y, z: p.z };
        // world 座標が取れる場合はそちらを優先して使用する
        preferWorldClicks = true;
        addCaptionAt(0.5, 0.5, world);
      });
      worldHookInstalled = true;
      log('world-space hook installed');
    }catch(e){
      warn('onCanvasShiftPick hook failed', e);
    }
  }

  // ----------------------------------------------------------------------------
  // Caption creation / update
  // ----------------------------------------------------------------------------

  function addCaptionAt(screenX, screenY, world){
    const id = `c_${Math.random().toString(36).slice(2,10)}`;
    const item = ensureCaptionItem(id);

    // pos の扱い:
    // - world が {x,y,z} 形式で渡ってきた場合はそのまま採用
    // - それ以外の場合は null のまま（後続で viewer 側に聞きにいく余地も残す）
    let pos = null;
    if (world && typeof world.x === 'number' && typeof world.y === 'number' && typeof world.z === 'number'){
      pos = { x: world.x, y: world.y, z: world.z };
    }

    Object.assign(item, {
      title: '(untitled)',
      body: '',
      color: '#eab308',
      pos,
      imageFileId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false
    });

    if (!captionOrder.includes(id)){
      captionOrder.push(id);
    }

    renderCaptions();
    selectItem(id);

    // 保存橋渡し
    if (window.__lm_caption_sheet_bridge && typeof window.__lm_caption_sheet_bridge.appendRow === 'function'){
      window.__lm_caption_sheet_bridge.appendRow(item);
    }
  }

  function renderCaptions(){
    const root = document.getElementById('caption-root');
    if (!root) return;

    const listEl = root.querySelector('[data-role="caption-list"]');
    if (!listEl) return;

    listEl.innerHTML = '';

    captionOrder.forEach(id => {
      const item = captionsById.get(id);
      if (!item || item.deleted) return;

      const card = document.createElement('div');
      card.className = 'lm-caption-card';
      card.dataset.captionId = id;

      const dot = document.createElement('div');
      dot.className = 'lm-caption-dot';
      dot.style.backgroundColor = item.color || '#eab308';

      const title = document.createElement('div');
      title.className = 'lm-caption-title';
      title.textContent = item.title || '(untitled)';

      card.appendChild(dot);
      card.appendChild(title);

      card.addEventListener('click', ()=>{
        selectItem(id);
      });

      listEl.appendChild(card);
    });
  }

  function selectItem(id){
    const root = document.getElementById('caption-root');
    if (!root) return;

    const card = root.querySelector(`.lm-caption-card[data-caption-id="${id}"]`);
    if (!card) return;

    root.querySelectorAll('.lm-caption-card.is-active').forEach(el => el.classList.remove('is-active'));
    card.classList.add('is-active');

    const item = captionsById.get(id);
    if (!item) return;

    const titleInput = root.querySelector('[data-role="caption-title"]');
    const bodyInput  = root.querySelector('[data-role="caption-body"]');

    if (titleInput) titleInput.value = item.title || '';
    if (bodyInput)  bodyInput.value  = item.body  || '';

    syncViewerSelection(id);
  }

  // ----------------------------------------------------------------------------
  // Sheet bridge callbacks
  // ----------------------------------------------------------------------------

  function onSheetContext(ctx){
    setSheetContext(ctx);
    captionsById.clear();
    captionOrder.length = 0;
  }

  function onSheetHeader(headerRange){
    // no-op for now; structure is固定
    log('header put', headerRange);
  }

  function onSheetAppendRow(item){
    const ensured = ensureCaptionItem(item.id);
    Object.assign(ensured, item);
    if (!captionOrder.includes(item.id)){
      captionOrder.push(item.id);
    }
    renderCaptions();
  }

  function onSheetSoftDeleteRow(item){
    const target = captionsById.get(item.id);
    if (!target) return;
    target.deleted = true;
    target.updatedAt = new Date().toISOString();
    renderCaptions();
  }

  // ----------------------------------------------------------------------------
  // DOM wiring
  // ----------------------------------------------------------------------------

  function bindDom(){
    const root = document.getElementById('caption-root');
    if (!root) return;

    const addBtn = root.querySelector('[data-role="caption-add"]');
    if (addBtn){
      addBtn.addEventListener('click', ()=>{
        addCaptionAt(0.5, 0.5, null);
      });
    }

    const titleInput = root.querySelector('[data-role="caption-title"]');
    const bodyInput  = root.querySelector('[data-role="caption-body"]');

    if (titleInput){
      titleInput.addEventListener('input', ()=>{
        const id = getActiveCaptionId();
        if (!id) return;
        const item = updateCaptionItem(id, { title: titleInput.value });
        if (window.__lm_caption_sheet_bridge && typeof window.__lm_caption_sheet_bridge.updateRow === 'function'){
          window.__lm_caption_sheet_bridge.updateRow(item);
        }
        renderCaptions();
      });
    }

    if (bodyInput){
      bodyInput.addEventListener('input', ()=>{
        const id = getActiveCaptionId();
        if (!id) return;
        const item = updateCaptionItem(id, { body: bodyInput.value });
        if (window.__lm_caption_sheet_bridge && typeof window.__lm_caption_sheet_bridge.updateRow === 'function'){
          window.__lm_caption_sheet_bridge.updateRow(item);
        }
      });
    }
  }

  // ----------------------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------------------

  function init(){
    log('ready');

    bindDom();
    tryInstallWorldSpaceHook();

    if (window.__lm_caption_sheet_bridge){
      window.__lm_caption_sheet_bridge.on('context', onSheetContext);
      window.__lm_caption_sheet_bridge.on('header',  onSheetHeader);
      window.__lm_caption_sheet_bridge.on('append',  onSheetAppendRow);
      window.__lm_caption_sheet_bridge.on('softDelete', onSheetSoftDeleteRow);
    }

    const br = getViewerBridge();
    if (br && typeof br.onPinSelect === 'function'){
      br.onPinSelect((id)=>{
        onViewerPinSelected(id);
      });
    }
  }

  if (document.readyState === 'loading'){
    window.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }

})();
