/*! caption.viewer.overlay.js
 * Step4: Viewer caption windows (multi, draggable, resizable, with leader lines)
 * Requires:
 *  - window.__LM_CAPTION_UI (from caption.ui.controller.js)
 *  - window.__lm_viewer_bridge (from viewer.bridge.expose.js)
 */
(function(){
  const TAG = '[caption-overlay]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  let captionUI = null;
  let bridge = null;
  let overlayRoot = null;
  let svg = null;
  let winLayer = null;

  const windows = new Map(); // id -> { item, el, line, mode, x, y }

  function ensureCaptionUI(){
    if (captionUI && captionUI.selectItem) return captionUI;
    captionUI = window.__LM_CAPTION_UI || null;
    return captionUI;
  }

  function ensureBridge(){
    if (bridge && typeof bridge.projectPoint === 'function') return bridge;
    bridge = window.__lm_viewer_bridge || window.viewerBridge || null;
    return bridge;
  }

  function ensureOverlayRoot(){
    if (overlayRoot) return overlayRoot;
    const root = document.createElement('div');
    root.id = 'lm-caption-overlay-root';
    root.style.position = 'fixed';
    root.style.left = '0';
    root.style.top = '0';
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '9999';

    // SVG layer for lines
    const ns = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('id', 'lm-caption-overlay-lines');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.pointerEvents = 'none';

    // Window layer
    winLayer = document.createElement('div');
    winLayer.id = 'lm-caption-overlay-windows';
    winLayer.style.position = 'absolute';
    winLayer.style.left = '0';
    winLayer.style.top = '0';
    winLayer.style.width = '100%';
    winLayer.style.height = '100%';
    winLayer.style.pointerEvents = 'none';

    root.appendChild(svg);
    root.appendChild(winLayer);
    document.body.appendChild(root);
    overlayRoot = root;
    log('overlay root created');
    return overlayRoot;
  }

  function getScreenPointForItem(item){
    const b = ensureBridge();
    if (!b || !b.projectPoint) return null;
    const pos = item && item.pos;
    if (!pos || typeof pos.x !== 'number') return null;
    try{
      const p = b.projectPoint(pos.x, pos.y, pos.z);
      return p;
    }catch(e){
      warn('projectPoint failed', e);
      return null;
    }
  }

  function createWindowForItem(item, mode){
    if (!item || !item.id) return null;
    ensureOverlayRoot();
    const existing = windows.get(item.id);
    if (existing) return existing;

    const el = document.createElement('div');
    el.className = 'lm-cap-win';
    el.dataset.id = item.id;
    el.style.position = 'absolute';
    el.style.minWidth = '180px';
    el.style.minHeight = '80px';
    el.style.maxWidth = '360px';
    el.style.pointerEvents = 'auto';

    // z-index stacking
    el.style.zIndex = String(100);

    const header = document.createElement('div');
    header.className = 'lm-cap-win-header';

    const colorDot = document.createElement('span');
    colorDot.className = 'lm-cap-win-color';
    colorDot.style.backgroundColor = item.color || '#4b5563';

    const title = document.createElement('div');
    title.className = 'lm-cap-win-title';
    title.textContent = item.title || '(untitled)';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lm-cap-win-close';
    closeBtn.textContent = '×';

    header.appendChild(colorDot);
    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'lm-cap-win-body';
    body.textContent = item.body || '';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'lm-cap-win-image-wrap';

    const img = document.createElement('img');
    img.className = 'lm-cap-win-image';
    img.loading = 'lazy';
    img.decoding = 'async';
    imgWrap.appendChild(img);
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'lm-cap-win-open';
    openBtn.textContent = 'Open original';
    imgWrap.appendChild(openBtn);

    const inner = document.createElement('div');
    inner.className = 'lm-cap-win-inner';
    inner.appendChild(header);
    inner.appendChild(body);
    inner.appendChild(imgWrap);

    el.appendChild(inner);
    winLayer.appendChild(el);

    // line
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('stroke', 'rgba(148,163,184,0.9)');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('fill', 'none');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);

    const state = {
      item,
      el,
      line,
      mode: mode || 'auto',
      x: 0,
      y: 0
    };
    windows.set(item.id, state);

    // close
    closeBtn.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      closeWindow(item.id);
    });

    // header drag
    enableDrag(state, header);

    // clicking window focuses corresponding caption in list
    el.addEventListener('mousedown', ()=>{
      bringToFront(state);
      try{
        const ui = ensureCaptionUI();
        if (ui && typeof ui.selectItem === 'function'){
          ui.selectItem(item.id);
        }
      }catch(_){}
    });

    updateWindowContent(state);
    positionWindowInitial(state);

    return state;
  }

  function updateWindowContent(state){
    if (!state || !state.el) return;
    const item = state.item;
    const header = state.el.querySelector('.lm-cap-win-title');
    const colorDot = state.el.querySelector('.lm-cap-win-color');
    const body = state.el.querySelector('.lm-cap-win-body');
    const img = state.el.querySelector('.lm-cap-win-image');
    const openBtn = state.el.querySelector('.lm-cap-win-open');
    if (header) header.textContent = (item.title || '').trim() || '(untitled)';
    if (colorDot) colorDot.style.backgroundColor = item.color || '#4b5563';
    if (body) body.textContent = item.body || '';

    // image: look up from captionUI.images / item.image / item.imageFileId
    let thumbUrl = '';
    let originalUrl = '';
    try{
      const ui = ensureCaptionUI();
      const images = (ui && ui.images) || [];
      const imgId = item.imageFileId || (item.image && item.image.id);
      if (imgId){
        let meta = images.find(x=>x.id === imgId) || item.image || null;
        if (meta){
          thumbUrl = meta.thumbUrl || meta.thumbnailUrl || meta.url || meta.webContentLink || meta.webViewLink || '';
          originalUrl = meta.webViewLink || meta.webContentLink || meta.url || thumbUrl;
        }
      }
    }catch(e){
      warn('updateWindowContent image lookup failed', e);
    }
    state.imageUrl = thumbUrl;
    state.imageOriginalUrl = originalUrl;
    if (img){
      if (thumbUrl){
        img.src = thumbUrl;
        img.style.display = '';
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
      }
    }
    if (openBtn){
      if (originalUrl){
        openBtn.style.display = 'inline-flex';
        openBtn.onclick = (ev)=>{
          ev.stopPropagation();
          try{ window.open(originalUrl, '_blank', 'noopener'); }catch(_){}
        };
      } else {
        openBtn.style.display = 'none';
        openBtn.onclick = null;
      }
    }
  }

  function positionWindowInitial(state){
    const item = state.item;
    const p = getScreenPointForItem(item);
    if (!p || !p.visible){
      // fallback: center of screen
      const vw = window.innerWidth || 800;
      const vh = window.innerHeight || 600;
      state.x = vw * 0.5 - 120;
      state.y = vh * 0.4;
      applyWindowPosition(state);
      return;
    }
    const offsetX = 12;
    const offsetY = 40;
    state.x = p.x + offsetX;
    state.y = p.y - offsetY;
    applyWindowPosition(state);
  }

  function applyWindowPosition(state){
    if (!state || !state.el) return;
    const el = state.el;
    const vw = window.innerWidth || 800;
    const vh = window.innerHeight || 600;
    const rect = el.getBoundingClientRect();
    let x = state.x;
    let y = state.y;
    const w = rect.width || 220;
    const h = rect.height || 140;
    if (x + w > vw - 8) x = vw - w - 8;
    if (y + h > vh - 8) y = vh - h - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    state.x = x;
    state.y = y;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function bringToFront(state){
    if (!state || !state.el) return;
    let maxZ = 100;
    windows.forEach(ws=>{
      const z = parseInt(ws.el.style.zIndex||'100',10);
      if (!isNaN(z) && z>maxZ) maxZ = z;
    });
    state.el.style.zIndex = String(maxZ+1);
  }

  function enableDrag(state, handle){
    if (!handle || !state || !state.el) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;

    const onDown = (ev)=>{
      ev.preventDefault();
      ev.stopPropagation();
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      baseX = state.x;
      baseY = state.y;
      state.mode = 'manual';
      bringToFront(state);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    const onMove = (ev)=>{
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      state.x = baseX + dx;
      state.y = baseY + dy;
      applyWindowPosition(state);
    };
    const onUp = ()=>{
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', onDown);
  }

  function closeWindow(id){
    const st = windows.get(id);
    if (!st) return;
    if (st.el && st.el.parentElement) st.el.parentElement.removeChild(st.el);
    if (st.line && st.line.parentNode) st.line.parentNode.removeChild(st.line);
    windows.delete(id);
  }

  function updateLines(){
    ensureOverlayRoot();
    const b = ensureBridge();
    if (!b || !b.projectPoint) return;
    windows.forEach(state=>{
      const { item, el, line } = state;
      if (!item || !el || !line) return;
      const p = getScreenPointForItem(item);
      if (!p || !p.visible){
        line.setAttribute('stroke-opacity','0');
        return;
      }
      line.setAttribute('stroke-opacity','1');
      const anchorX = state.x + (el.offsetWidth||220) * 0.1;
      const anchorY = state.y + 16; // near header
      line.setAttribute('x1', String(p.x));
      line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(anchorX));
      line.setAttribute('y2', String(anchorY));
      // auto mode: keep window following pin (for slight camera moves)
      if (state.mode === 'auto'){
        const offsetX = 12;
        const offsetY = 40;
        state.x = p.x + offsetX;
        state.y = p.y - offsetY;
        applyWindowPosition(state);
      }
    });
  }

  function onItemSelected(item){
    ensureOverlayRoot();
    if (!item || !item.id){
      // do not auto-close all; user may have multiple windows
      return;
    }
    const existing = windows.get(item.id);
    if (existing){
      existing.item = item;
      updateWindowContent(existing);
      bringToFront(existing);
      return;
    }
    createWindowForItem(item, 'auto');
  }

  function onItemChanged(item){
    if (!item || !item.id) return;
    const st = windows.get(item.id);
    if (!st) return;
    st.item = item;
    updateWindowContent(st);
  }

  function onItemDeleted(item){
    if (!item || !item.id) return;
    closeWindow(item.id);
  }

  function bindCaptionEvents(){
    const ui = ensureCaptionUI();
    if (!ui) return;
    try{
      if (typeof ui.onItemSelected === 'function'){
        ui.onItemSelected(onItemSelected);
      }
      if (typeof ui.onItemChanged === 'function'){
        ui.onItemChanged(onItemChanged);
      }
      if (typeof ui.onItemDeleted === 'function'){
        ui.onItemDeleted(onItemDeleted);
      }
    }catch(e){
      warn('bindCaptionEvents failed', e);
    }
  }

  function bindViewerEvents(){
    const b = ensureBridge();
    if (!b) return;
    try{
      if (typeof b.onRenderTick === 'function'){
        b.onRenderTick(updateLines);
      } else {
        // fallback: requestAnimationFrame
        const tick = ()=>{
          updateLines();
          window.requestAnimationFrame(tick);
        };
        window.requestAnimationFrame(tick);
      }
      if (typeof b.onPinSelect === 'function'){
        b.onPinSelect((id)=>{
          try{
            const ui = ensureCaptionUI();
            if (ui && typeof ui.selectItem === 'function'){
              ui.selectItem(id);
            }
          }catch(e){
            warn('onPinSelect bridge failed', e);
          }
        });
      }
    }catch(e){
      warn('bindViewerEvents failed', e);
    }
  }

  function init(){
    ensureOverlayRoot();
    bindCaptionEvents();
    bindViewerEvents();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(init, 0);
  } else {
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(init,0), { once:true });
  }

  document.addEventListener('lm:caption-ui-ready', ()=>{
    try{ bindCaptionEvents(); }catch(_){}
  });
  document.addEventListener('lm:viewer-bridge-ready', ()=>{
    try{ bindViewerEvents(); }catch(_){}
  });

})();