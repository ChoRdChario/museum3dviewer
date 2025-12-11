const TAG = '[caption-overlay]';

(function () {
  if (window.__LM_CAPTION_OVERLAY__ && window.__LM_CAPTION_OVERLAY__.__ver && String(window.__LM_CAPTION_OVERLAY__.__ver).startsWith('A2')) {
    try { console.log(TAG, 'already loaded'); } catch(_) {}
    return;
  }

  'use strict';

  function log(...args) {
    try { console.log(TAG, ...args); } catch (_) {}
  }
  function warn(...args) {
    try { console.warn(TAG, ...args); } catch (_) {}
  }

  let overlayRoot = null;
  let svgLayer = null;
  let winLayer = null;
  const windows = new Map(); // id -> state

  function ensureOverlayRoot() {
    if (overlayRoot && svgLayer && winLayer) return overlayRoot;

    const root = document.createElement('div');
    root.id = 'lm-caption-overlay-root';
    root.style.position = 'fixed';
    root.style.left = '0';
    root.style.top = '0';
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.zIndex = '9999';
    root.style.pointerEvents = 'none';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('id', 'lm-caption-overlay-lines');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'visible';

    const winWrap = document.createElement('div');
    winWrap.id = 'lm-caption-overlay-windows';
    winWrap.style.position = 'absolute';
    winWrap.style.left = '0';
    winWrap.style.top = '0';
    winWrap.style.width = '100%';
    winWrap.style.height = '100%';
    winWrap.style.pointerEvents = 'none';

    root.appendChild(svg);
    root.appendChild(winWrap);
    document.body.appendChild(root);

    overlayRoot = root;
    svgLayer = svg;
    winLayer = winWrap;

    log('overlay root created');
    return root;
  }

  

  function getCanvasRect() {
    try {
      const canvas = document.getElementById('gl');
      if (canvas && typeof canvas.getBoundingClientRect === 'function') {
        const r = canvas.getBoundingClientRect();
        if (r && r.width && r.height) {
          return r;
        }
      }
    } catch (_) {}

    const vw = window.innerWidth  || document.documentElement.clientWidth  || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return {
      left: 0,
      top: 0,
      right: vw,
      bottom: vh,
      width: vw,
      height: vh
    };
  }

function ensureCaptionUI() {
    return window.__LM_CAPTION_UI || null;
  }

  function ensureViewerBridge() {
    const ui = ensureCaptionUI();
    try {
      if (ui && typeof ui.getViewerBridge === 'function') {
        const b = ui.getViewerBridge();
        if (b) return b;
      }
    } catch (_) {}
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  function createWindowForItem(item, mode) {
    ensureOverlayRoot();
    const id = item.id;
    let state = windows.get(id);
    if (state && state.el) {
      state.mode = mode || state.mode || 'auto';
      state.item = item;
      updateWindowContent(state);
      bringToFront(state);
      return state;
    }

    const el = document.createElement('div');
    el.className = 'lm-cap-win';
    el.style.position = 'absolute';
    el.style.left = '50%';
    el.style.top = '20%';
    el.style.minWidth = '220px';
    el.style.maxWidth = '420px';
    el.style.minHeight = '80px';
    el.style.pointerEvents = 'auto';

    // カードらしい見た目（CSS が負けても効くように inline 指定）
    el.style.boxSizing = 'border-box';
    el.style.background = 'rgba(15,23,42,0.98)';
    el.style.color = '#e5e7eb';
    el.style.borderRadius = '10px';
    el.style.border = '1px solid rgba(148,163,184,0.9)';
    el.style.boxShadow = '0 16px 40px rgba(15,23,42,0.9)';
    el.style.overflow = 'hidden';
    el.style.resize = 'both';

    const inner = document.createElement('div');
    inner.className = 'lm-cap-win-inner';
    inner.style.display = 'flex';
    inner.style.flexDirection = 'column';
    inner.style.gap = '6px';
    inner.style.padding = '8px 10px 10px';

    const header = document.createElement('div');
    header.className = 'lm-cap-win-header';
    header.style.position = 'relative';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '6px';
    header.style.cursor = 'move';
    header.style.fontSize = '12px';
    header.style.color = '#f9fafb';
    header.style.userSelect = 'none';
    header.style.paddingRight = '20px';

    const colorDot = document.createElement('div');
    colorDot.className = 'lm-cap-win-color';
    colorDot.style.width = '10px';
    colorDot.style.height = '10px';
    colorDot.style.borderRadius = '999px';
    colorDot.style.backgroundColor = '#4b5563';
    colorDot.style.flexShrink = '0';

    const titleEl = document.createElement('div');
    titleEl.className = 'lm-cap-win-title';
    titleEl.style.flex = '1 1 auto';
    titleEl.style.lineHeight = '1.2';
    titleEl.style.wordBreak = 'break-word';
    titleEl.style.fontWeight = '700'; // タイトル太字

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lm-cap-win-close';
    closeBtn.textContent = '×';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '4px';
    closeBtn.style.right = '4px';
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#9ca3af';
    closeBtn.style.fontSize = '14px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '0 2px';

    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.color = '#f9fafb';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.color = '#9ca3af';
    });

    header.appendChild(colorDot);
    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'lm-cap-win-body';
    body.style.fontSize = '11px';
    body.style.lineHeight = '1.35';
    body.style.maxHeight = '260px';
    body.style.overflowY = 'auto';
    body.style.paddingRight = '2px';
    body.style.whiteSpace = 'pre-wrap';
    body.style.wordBreak = 'break-word';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'lm-cap-win-image-wrap';
    imgWrap.style.marginTop = '4px';
    imgWrap.style.maxHeight = '60vh';
    imgWrap.style.overflow = 'hidden';
    imgWrap.style.background = 'rgba(15,23,42,0.95)';
    imgWrap.style.borderRadius = '8px';
    imgWrap.style.padding = '4px 6px 6px';
    imgWrap.style.display = 'flex';
    imgWrap.style.flexDirection = 'column';
    imgWrap.style.alignItems = 'flex-start';
    imgWrap.style.gap = '4px';
    imgWrap.style.border = '1px solid rgba(55,65,81,0.9)';

    const img = document.createElement('img');
    img.className = 'lm-cap-win-image';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    img.style.width = '100%';        // 画像をカード幅いっぱいに
    img.style.height = 'auto';
    img.style.objectFit = 'contain';
    img.style.borderRadius = '4px';
    imgWrap.appendChild(img);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'lm-cap-win-open';
    openBtn.textContent = 'Open original';
    openBtn.style.alignSelf = 'flex-start'; // 画像の直下・左寄せ
    openBtn.style.marginTop = '4px';
    openBtn.style.border = 'none';
    openBtn.style.borderRadius = '999px';
    openBtn.style.padding = '2px 10px';
    openBtn.style.fontSize = '10px';
    openBtn.style.lineHeight = '1.3';
    openBtn.style.background = 'rgba(30,64,175,0.9)';
    openBtn.style.color = '#e5e7eb';
    openBtn.style.cursor = 'pointer';
    openBtn.style.whiteSpace = 'nowrap';

    openBtn.addEventListener('mouseenter', () => {
      openBtn.style.background = 'rgba(59,130,246,0.98)';
    });
    openBtn.addEventListener('mouseleave', () => {
      openBtn.style.background = 'rgba(30,64,175,0.9)';
    });

    imgWrap.appendChild(openBtn);

    inner.appendChild(header);
    inner.appendChild(body);
    inner.appendChild(imgWrap);
    el.appendChild(inner);
    winLayer.appendChild(el);

    const st = {
      id,
      el,
      header,
      colorDot,
      titleEl,
      body,
      img,
      openBtn,
      imgWrap,
      item,
      mode: mode || 'auto',
      lastScreenPos: null,
      manualOffset: { x: 0, y: 0 },
      imageUrl: '',
      imageOriginalUrl: ''
    };
    windows.set(id, st);

    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeWindow(id);
    });

    enableDrag(st);
    updateWindowContent(st);
    positionWindowNearItem(st);
    bringToFront(st);

    return st;
  }

  function bringToFront(state) {
    if (!state || !state.el || !winLayer) return;
    winLayer.appendChild(state.el);
  }

  function driveViewUrlFromMeta(meta) {
    if (!meta) return '';
    if (meta.webViewLink) return meta.webViewLink;
    const id = meta.id || null;
    if (id) {
      return 'https://drive.google.com/file/d/' +
        encodeURIComponent(id) + '/view';
    }
    const url = meta.webContentLink || meta.url || '';
    if (!url) return '';
    const m = url.match(/[?&]id=([^&]+)/);
    if (m) {
      const fid = decodeURIComponent(m[1]);
      return 'https://drive.google.com/file/d/' +
        encodeURIComponent(fid) + '/view';
    }
    return url;
  }

  function updateWindowContent(state) {
    if (!state || !state.el) return;
    const item = state.item || {};
    const body = state.body;
    const img = state.img;
    const openBtn = state.openBtn;

    if (state.titleEl) {
      const titleText = (item.title || '').trim() || '(untitled)';
      state.titleEl.textContent = titleText;
    }
    if (state.colorDot) {
      state.colorDot.style.backgroundColor = item.color || '#4b5563';
    }
    if (body) {
      body.textContent = item.body || '';
    }

    let thumbUrl = '';
    let originalUrl = '';
    try {
      const ui = ensureCaptionUI();
      const images = (ui && ui.images) || [];
      const imgId = item.imageFileId || (item.image && item.image.id);
      if (imgId) {
        const meta = images.find(x => x.id === imgId) || item.image || null;
        if (meta) {
          thumbUrl =
            meta.thumbUrl ||
            meta.thumbnailUrl ||
            meta.url ||
            meta.webContentLink ||
            meta.webViewLink ||
            '';
          originalUrl = driveViewUrlFromMeta(meta) || thumbUrl;
        }
      }
    } catch (e) {
      warn('updateWindowContent image lookup failed', e);
    }

    state.imageUrl = thumbUrl;
    state.imageOriginalUrl = originalUrl;

    if (img) {
      if (thumbUrl) {
        img.src = thumbUrl;
        img.style.display = 'block';
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
      }
    }

    if (openBtn) {
      if (originalUrl) {
        openBtn.style.display = 'inline-flex';
        openBtn.onclick = (ev) => {
          ev.stopPropagation();
          try {
            window.open(originalUrl, '_blank', 'noopener');
          } catch (_) {}
        };
      } else {
        openBtn.style.display = 'none';
        openBtn.onclick = null;
      }
    }
  }

  function enableDrag(state) {
    const el = state.el;
    const header = state.header || el;
    let dragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    header.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      dragging = true;
      state.mode = 'manual';
      const rect = el.getBoundingClientRect();
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      ev.preventDefault();
    });

    function onMove(ev) {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const left = startLeft + dx;
      const top = startTop + dy;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      state.manualOffset.x = left;
      state.manualOffset.y = top;
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  function closeWindow(id) {
    const st = windows.get(id);
    if (!st) return;
    if (st.el && st.el.parentNode) {
      st.el.parentNode.removeChild(st.el);
    }
    windows.delete(id);
    try {
      const ui = ensureCaptionUI();
      if (ui && ui.selectedId === id && typeof ui.selectItem === 'function') {
        ui.selectItem(null);
      }
    } catch (_) {}
  }

  function projectItemToScreen(item) {
    const br = ensureViewerBridge();
    if (!br || typeof br.projectPoint !== 'function' || !item || !item.pos) {
      return null;
    }
    try {
      const p = item.pos || {};
      const hasCoords = (typeof p.x === 'number' &&
                         typeof p.y === 'number' &&
                         typeof p.z === 'number');
      if (!hasCoords) return null;

      const sp = br.projectPoint({ x: p.x, y: p.y, z: p.z });
      if (!sp || typeof sp.x !== 'number' || typeof sp.y !== 'number') {
        return null;
      }

      // viewer.module.cdn.js 側でキャンバス基準のピクセル座標に変換済み
      return {
        x: sp.x,
        y: sp.y,
        z: sp.z
      };
    } catch (e) {
      warn('projectPoint failed', e);
      return null;
    }
  }

function positionWindowNearItem(state) {
    const el = state.el;
    const item = state.item;
    if (!el || !item) return;

    const sp = projectItemToScreen(item);
    if (!sp) return;

    const canvasRect = getCanvasRect();
    const margin = 16;

    const rect = el.getBoundingClientRect();
    const preferredX = sp.x + 24;
    const preferredY = sp.y - rect.height * 0.3;

    let minX = canvasRect.left + margin;
    let maxX = canvasRect.right - rect.width - margin;
    let minY = canvasRect.top + margin;
    let maxY = canvasRect.bottom - rect.height - margin;

    // キャンバス情報が取得できなかった場合はウィンドウ全体でフォールバック
    if (!isFinite(minX) || !isFinite(maxX) || minX > maxX) {
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      minX = margin;
      maxX = vw ? (vw - rect.width - margin) : margin;
    }
    if (!isFinite(minY) || !isFinite(maxY) || minY > maxY) {
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      minY = margin;
      maxY = vh ? (vh - rect.height - margin) : margin;
    }

    let x = Math.min(Math.max(preferredX, minX), maxX);
    let y = Math.min(Math.max(preferredY, minY), maxY);

    el.style.left = x + 'px';
    el.style.top = y + 'px';
    state.manualOffset.x = x;
    state.manualOffset.y = y;
    state.lastScreenPos = sp;
  }

  
function updateLines() {
    ensureOverlayRoot();
    const br = ensureViewerBridge();
    if (!svgLayer || !br || typeof br.projectPoint !== 'function') return;

    while (svgLayer.firstChild) {
      svgLayer.removeChild(svgLayer.firstChild);
    }
    const svgNS = 'http://www.w3.org/2000/svg';

    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    windows.forEach((state) => {
      const item = state.item;
      if (!item || !item.pos) return;
      const sp = projectItemToScreen(item);
      if (!sp) return;
      state.lastScreenPos = sp;

      const el = state.el;
      const rect = el.getBoundingClientRect();
      let wx = rect.left + rect.width * 0.18;
      let wy = rect.top + 24;

      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', sp.x);
      line.setAttribute('y1', sp.y);
      line.setAttribute('x2', wx);
      line.setAttribute('y2', wy);
      line.setAttribute('stroke', 'rgba(148,163,184,0.9)');
      line.setAttribute('stroke-width', '1.2');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svgLayer.appendChild(line);

      if (state.mode === 'auto') {
        const canvasRect = getCanvasRect();
        const margin = 16;

        const preferredX = sp.x + 24;
        const preferredY = sp.y - rect.height * 0.3;

        let minX = canvasRect.left + margin;
        let maxX = canvasRect.right - rect.width - margin;
        let minY = canvasRect.top + margin;
        let maxY = canvasRect.bottom - rect.height - margin;

        if (!isFinite(minX) || !isFinite(maxX) || minX > maxX) {
          const vw = window.innerWidth || document.documentElement.clientWidth || 0;
          minX = margin;
          maxX = vw ? (vw - rect.width - margin) : margin;
        }
        if (!isFinite(minY) || !isFinite(maxY) || minY > maxY) {
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          minY = margin;
          maxY = vh ? (vh - rect.height - margin) : margin;
        }

        let x = Math.min(Math.max(preferredX, minX), maxX);
        let y = Math.min(Math.max(preferredY, minY), maxY);

        el.style.left = x + 'px';
        el.style.top = y + 'px';
        state.manualOffset.x = x;
        state.manualOffset.y = y;
      }
    });
  }

  function bindCaptionEvents() {
    const ui = ensureCaptionUI();
    if (!ui) return false;

    if (typeof ui.onItemSelected === 'function') {
      ui.onItemSelected((item) => {
        if (!item) return;
        createWindowForItem(item, 'auto');
      });
    }

    if (typeof ui.onItemChanged === 'function') {
      ui.onItemChanged((item) => {
        if (!item || !item.id) return;
        const st = windows.get(item.id);
        if (!st) return;
        st.item = item;
        updateWindowContent(st);
      });
    }

    if (typeof ui.onItemDeleted === 'function') {
      ui.onItemDeleted((item) => {
        if (!item || !item.id) return;
        closeWindow(item.id);
      });
    }

    log('caption events bound');
    return true;
  }

  function bindViewerEvents() {
    const br = ensureViewerBridge();
    if (!br) return false;
    try {
      if (typeof br.onRenderTick === 'function') {
        br.onRenderTick(updateLines);
      }
      if (typeof br.onPinSelect === 'function') {
        br.onPinSelect((id) => {
          try {
            const ui = ensureCaptionUI();
            if (ui && typeof ui.selectItem === 'function') {
              ui.selectItem(id, {source: 'viewer'});
            }
          } catch (e) {
            warn('onPinSelect -> selectItem failed', e);
          }
        });
      }
    } catch (e) {
      warn('bindViewerEvents failed', e);
    }
    log('viewer events bound');
    return true;
  }

  function tryBindAll() {
    ensureOverlayRoot();
    let ok1 = bindCaptionEvents();
    let ok2 = bindViewerEvents();
    if (ok1 && ok2) {
      log('overlay fully bound');
      return true;
    }
    return false;
  }

  function init() {
    ensureOverlayRoot();
    tryBindAll();

    document.addEventListener('lm:caption-ui-ready', () => {
      tryBindAll();
    });
    document.addEventListener('lm:viewer-bridge-ready', () => {
      tryBindAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__LM_CAPTION_OVERLAY__ = { __ver: 'A2' };
})();
