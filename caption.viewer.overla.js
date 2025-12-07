// caption.viewer.overlay.js — overlay canvas + caption windows
(function(){
  const TAG = '[caption-overlay]';
  const log  = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  if (window.__LM_CAPTION_OVERLAY && window.__LM_CAPTION_OVERLAY.__ver && window.__LM_CAPTION_OVERLAY.__ver.startsWith('A2')) {
    log('already loaded');
    return;
  }

  function $(sel,root=document){ return root.querySelector(sel); }

  // viewer.bridge.autobind.js が __lm_viewer_bridge を用意している前提
  function ensureViewerBridge(){
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  // ---- Overlay root ----
  const viewerCanvas =
    document.getElementById('viewer-canvas') ||
    document.getElementById('gl');
  if (!viewerCanvas){
    return warn('viewer canvas not found; skip overlay init');
  }
  let overlayRoot = document.getElementById('captionOverlayRoot');
  if (!overlayRoot){
    overlayRoot = document.createElement('div');
    overlayRoot.id = 'captionOverlayRoot';
    overlayRoot.className = 'caption-overlay-root';
    viewerCanvas.parentNode.appendChild(overlayRoot);
    log('overlay root created');
  }

  // ---- State ----
  const state = {
    items: [],  // {id, title, body, color, pos:{x,y,z}}
    selectedId: null,
    windows: new Map(), // id -> {el, line}
  };

  // ---- World -> screen projection ----
  function projectItemToScreen(item) {
    const br = ensureViewerBridge();
    if (!br || typeof br.projectPoint !== 'function' || !item || !item.pos) {
      return null;
    }
    try {
      const p = item.pos;
      // viewer.module.cdn.js の projectPoint(pos:{x,y,z}) 仕様に合わせた呼び出し
      return br.projectPoint({ x:p.x, y:p.y, z:p.z });
    } catch (e) {
      warn('projectPoint failed', e);
      return null;
    }
  }

  function positionWindowNearItem(state) {
    state.windows.forEach((w, id)=>{
      const item = state.items.find(it=>it.id === id);
      if (!item || !item.pos) {
        w.el.style.display = 'none';
        w.line.style.display = 'none';
        return;
      }
      const sp = projectItemToScreen(item);
      if (!sp) {
        w.el.style.display = 'none';
        w.line.style.display = 'none';
        return;
      }
      const canvasRect = viewerCanvas.getBoundingClientRect();
      const rootRect = overlayRoot.getBoundingClientRect();
      const cx = canvasRect.left + sp.x * canvasRect.width  - rootRect.left;
      const cy = canvasRect.top  + sp.y * canvasRect.height - rootRect.top;

      const winW = w.el.offsetWidth || 160;
      const winH = w.el.offsetHeight || 80;

      const wx = Math.min(Math.max(cx + 16, 0), rootRect.width  - winW);
      const wy = Math.min(Math.max(cy - winH/2, 0), rootRect.height - winH);

      w.el.style.transform = `translate(${wx}px, ${wy}px)`;
      w.el.style.display = 'block';

      const line = w.line;
      const x1 = cx;
      const y1 = cy;
      const x2 = wx;
      const y2 = wy + winH/2;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const angle = Math.atan2(dy, dx) * 180/Math.PI;

      line.style.width = `${len}px`;
      line.style.transform = `translate(${x1}px, ${y1}px) rotate(${angle}deg)`;
      line.style.display = 'block';
    });
  }

  // ---- DOM for window + line ----
  function createWindowForItem(item){
    const el = document.createElement('div');
    el.className = 'caption-window';
    el.dataset.id = item.id;

    const title = document.createElement('div');
    title.className = 'caption-window-title';
    title.textContent = item.title || '(no title)';

    const body = document.createElement('div');
    body.className = 'caption-window-body';
    body.textContent = item.body || '';

    el.appendChild(title);
    el.appendChild(body);

    const line = document.createElement('div');
    line.className = 'caption-window-line';

    overlayRoot.appendChild(line);
    overlayRoot.appendChild(el);

    return { el, line };
  }

  // ---- Sync windows ----
  function syncWindows(){
    const existingIds = new Set(state.items.map(it=>it.id));
    Array.from(state.windows.keys()).forEach(id=>{
      if (!existingIds.has(id)){
        const w = state.windows.get(id);
        if (w){
          w.el.remove();
          w.line.remove();
        }
        state.windows.delete(id);
      }
    });

    state.items.forEach(item=>{
      if (!state.windows.has(item.id)){
        const w = createWindowForItem(item);
        state.windows.set(item.id, w);
      }
      const w = state.windows.get(item.id);
      if (!w) return;
      w.el.classList.toggle('selected', item.id === state.selectedId);
      const titleEl = w.el.querySelector('.caption-window-title');
      const bodyEl  = w.el.querySelector('.caption-window-body');
      if (titleEl) titleEl.textContent = item.title || '(no title)';
      if (bodyEl)  bodyEl.textContent = item.body || '';
    });

    positionWindowNearItem(state);
  }

  // ---- Mouse / Shift+Click hook ----
function installShiftClickHook(){
  const br = ensureViewerBridge();
  if (!br || typeof br.onCanvasShiftPick !== 'function') {
    warn('onCanvasShiftPick not available on viewer bridge');
    return;
  }

  try{
    br.onCanvasShiftPick(({ point } = {})=>{
      const world = point;
      if (!world || typeof world.x !== 'number') {
        warn('onCanvasShiftPick delivered invalid world', world);
        return;
      }
      // world 座標をキャプション UI 側に伝えるイベント
      document.dispatchEvent(
        new CustomEvent('lm:world-click', { detail:{ world } })
      );
    });
    log('shift-pick hook installed via viewer bridge');
  }catch(e){
    warn('onCanvasShiftPick hook failed', e);
  }
}


  // ---- Caption UI integration ----
  function setItems(items){
    state.items = Array.isArray(items) ? items.slice() : [];
    syncWindows();
  }

  function setSelectedId(id){
    state.selectedId = id;
    syncWindows();
  }

  document.addEventListener('lm:caption-added', (ev)=>{
    const item = ev.detail && ev.detail.item;
    if (!item) return;
    const existing = state.items.slice();
    existing.push(item);
    state.items = existing;
    state.selectedId = item.id;
    syncWindows();
  });

  document.addEventListener('lm:caption-selection', (ev)=>{
    const item = ev.detail && ev.detail.item;
    state.selectedId = item ? item.id : null;
    syncWindows();
  });

  window.__LM_CAPTION_OVERLAY = {
    __ver: 'A2',
    setItems,
    setSelectedId,
    syncWindows,
  };

  document.addEventListener('lm:viewer-bridge-ready', ()=>{
    syncWindows();
  });

  installShiftClickHook();

  window.addEventListener('resize', ()=>{
    positionWindowNearItem(state);
  });

  log('overlay fully bound');
})();
