const TAG = '[caption-overlay]';

(function () {
  if (window.__LM_CAPTION_OVERLAY__ && window.__LM_CAPTION_OVERLAY__.__ver && String(window.__LM_CAPTION_OVERLAY__.__ver).startsWith('A2')) {
    try {
      console.log(TAG, 'already loaded');
    } catch (_) {}
    return;
  }

  'use strict';

  function log(...args) {
    try {
      console.log(TAG, ...args);
    } catch (_) {}
  }

  function warn(...args) {
    try {
      console.warn(TAG, ...args);
    } catch (_) {}
  }

  function ensureViewerBridge() {
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  function ensureCaptionUI() {
    return window.__LM_CAPTION_UI || null;
  }

  const windows = new Map(); // id -> { item, el, manualOffset, lastScreenPos }

  function ensureOverlayRoot() {
    let root = document.getElementById('lm-caption-overlay-root');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'lm-caption-overlay-root';
    root.style.position = 'absolute';
    root.style.left = '0';
    root.style.top = '0';
    root.style.right = '0';
    root.style.bottom = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '50';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lm-caption-overlay-lines');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';

    root.appendChild(svg);
    document.body.appendChild(root);

    log('overlay root created');
    return root;
  }

  function getOverlayRoot() {
    return document.getElementById('lm-caption-overlay-root') || ensureOverlayRoot();
  }

  function getLinesLayer() {
    const root = getOverlayRoot();
    if (!root) return null;
    let svg = root.querySelector('svg.lm-caption-overlay-lines');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'lm-caption-overlay-lines');
      svg.style.position = 'absolute';
      svg.style.left = '0';
      svg.style.top = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      root.appendChild(svg);
    }
    return svg;
  }

  function projectItemToScreen(item) {
    const br = ensureViewerBridge();
    if (!br || typeof br.projectPoint !== 'function' || !item || !item.pos) {
      return null;
    }
    try {
      const p = item.pos;
      // viewer.module.cdn.js の projectPoint は単一引数 {x,y,z} を期待する
      return br.projectPoint(p && typeof p.x === 'number' ? p : { x:p.x, y:p.y, z:p.z });
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
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    const rect = el.getBoundingClientRect();
    const preferredX = sp.x + 24;
    const preferredY = sp.y - rect.height * 0.3;
    let x = Math.min(Math.max(preferredX, 16), vw - rect.width - 16);
    let y = Math.min(Math.max(preferredY, 16), vh - rect.height - 16);

    el.style.left = x + 'px';
    el.style.top = y + 'px';
    state.manualOffset.x = x;
    state.manualOffset.y = y;
    state.lastScreenPos = sp;
  }

  function updateLines() {
    const svgLayer = getLinesLayer();
    if (!svgLayer) return;
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
      if (wx < 0 || wx > vw || wy < 0 || wy > vh) {
        return;
      }

      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(sp.x));
      line.setAttribute('y1', String(sp.y));
      line.setAttribute('x2', String(wx));
      line.setAttribute('y2', String(wy));
      line.setAttribute('stroke', 'rgba(148,163,184,0.9)');
      line.setAttribute('stroke-width', '1');

      svgLayer.appendChild(line);
    });
  }

  function createCaptionWindow(item) {
    const root = getOverlayRoot();
    if (!root) return null;

    let winLayer = root.querySelector('.lm-caption-window-layer');
    if (!winLayer) {
      winLayer = document.createElement('div');
      winLayer.className = 'lm-caption-window-layer';
      winLayer.style.position = 'absolute';
      winLayer.style.left = '0';
      winLayer.style.top = '0';
      winLayer.style.right = '0';
      winLayer.style.bottom = '0';
      winLayer.style.pointerEvents = 'none';
      root.appendChild(winLayer);
    }

    const el = document.createElement('div');
    el.className = 'lm-caption-window';
    el.style.position = 'absolute';
    el.style.minWidth = '220px';
    el.style.maxWidth = '320px';
    el.style.background = 'rgba(15,23,42,0.96)';
    el.style.borderRadius = '10px';
    el.style.boxShadow = '0 18px 40px rgba(15,23,42,0.9)';
    el.style.pointerEvents = 'auto';
    el.style.padding = '0';
    el.style.zIndex = '60';

    const inner = document.createElement('div');
    inner.style.position = 'relative';
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

    const colorDot = document.createElement('span');
    colorDot.style.display = 'inline-block';
    colorDot.style.width = '10px';
    colorDot.style.height = '10px';
    colorDot.style.borderRadius = '9999px';
    colorDot.style.backgroundColor = item.color || '#eab308';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = item.title || '(untitled)';
    titleSpan.style.flex = '1 1 auto';
    titleSpan.style.whiteSpace = 'nowrap';
    titleSpan.style.overflow = 'hidden';
    titleSpan.style.textOverflow = 'ellipsis';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.style.position = 'absolute';
    closeBtn.style.right = '2px';
    closeBtn.style.top = '-2px';
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#cbd5f5';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '14px';

    header.appendChild(colorDot);
    header.appendChild(titleSpan);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.textContent = item.body || '';
    body.style.fontSize = '12px';
    body.style.color = '#e5e7eb';
    body.style.marginTop = '4px';
    body.style.whiteSpace = 'pre-wrap';

    const img = (() => {
      const ui = ensureCaptionUI();
      if (!ui) return null;
      const imgs = ui.images || [];
      if (!item.imageFileId) return null;
      const im = imgs.find(i => i.id === item.imageFileId);
      return im || null;
    })();

    if (img) {
      const imgWrap = document.createElement('div');
      imgWrap.style.marginTop = '6px';
      imgWrap.style.borderRadius = '8px';
      imgWrap.style.overflow = 'hidden';
      imgWrap.style.background = 'rgba(15,23,42,0.9)';
      imgWrap.style.padding = '4px 6px 6px';
      imgWrap.style.display = 'flex';
      imgWrap.style.flexDirection = 'column';
      imgWrap.style.alignItems = 'flex-start';
      imgWrap.style.gap = '4px';
      imgWrap.style.border = '1px solid rgba(55,65,81,0.9)';

      const imgEl = document.createElement('img');
      imgEl.className = 'lm-cap-win-image';
      imgEl.loading = 'lazy';
      imgEl.decoding = 'async';
      imgEl.style.display = 'block';
      imgEl.style.maxWidth = '100%';
      imgEl.style.width = '100%';
      imgEl.style.height = 'auto';
      imgEl.style.objectFit = 'contain';
      imgEl.style.borderRadius = '6px';
      imgEl.src = img.thumbnailLink || img.iconLink || '';
      imgEl.alt = img.name || '';

      const imgLabel = document.createElement('div');
      imgLabel.textContent = img.name || '';
      imgLabel.style.fontSize = '11px';
      imgLabel.style.color = '#e5e7eb';
      imgLabel.style.marginTop = '2px';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'lm-cap-win-open';
      openBtn.textContent = 'Open original';
      openBtn.style.alignSelf = 'flex-start';
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

      openBtn.addEventListener('click', () => {
        if (img && img.webContentLink) {
          window.open(img.webContentLink, '_blank');
        }
      });

      imgWrap.appendChild(imgEl);
      imgWrap.appendChild(imgLabel);
      imgWrap.appendChild(openBtn);

      inner.appendChild(header);
      inner.appendChild(body);
      inner.appendChild(imgWrap);
    } else {
      inner.appendChild(header);
      inner.appendChild(body);
    }

    el.appendChild(inner);
    winLayer.appendChild(el);

    const state = {
      item,
      el,
      manualOffset: { x: 0, y: 0 },
      lastScreenPos: null
    };
    windows.set(item.id, state);

    positionWindowNearItem(state);
    updateLines();

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('mousedown', (ev) => {
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      const rect = el.getBoundingClientRect();
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
      updateLines();
    }

    function onUp() {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    closeBtn.addEventListener('click', () => {
      closeWindow(item.id);
    });

    return state;
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

  function syncFromUISelection() {
    const ui = ensureCaptionUI();
    if (!ui) return;
    const id = ui.selectedId;
    windows.forEach((st, keyId) => {
      if (keyId !== id) {
        closeWindow(keyId);
      }
    });
    const item = (ui.items || []).find(it => it.id === id);
    if (!item) return;
    if (!windows.has(id)) {
      createCaptionWindow(item);
    }
  }

  function bindCaptionEvents() {
    const ui = ensureCaptionUI();
    if (!ui) return;

    ui.onItemSelected((id) => {
      const item = (ui.items || []).find(it => it.id === id);
      if (!item) return;
      if (!windows.has(id)) {
        createCaptionWindow(item);
      } else {
        const st = windows.get(id);
        st.item = item;
        positionWindowNearItem(st);
      }
      updateLines();
    });

    ui.onItemChanged((item) => {
      const st = windows.get(item.id);
      if (!st) return;
      st.item = item;
      const titleNode = st.el.querySelector('.lm-cap-win-header span:nth-child(2)');
      if (titleNode) titleNode.textContent = item.title || '(untitled)';
      positionWindowNearItem(st);
      updateLines();
    });

    ui.onItemDeleted((item) => {
      closeWindow(item.id);
      updateLines();
    });

    log('caption events bound');
  }

  function bindViewerEvents() {
    try {
      const br = ensureViewerBridge();
      if (br && typeof br.onRenderTick === 'function') {
        br.onRenderTick(() => {
          updateLines();
        });
      }
      log('viewer events bound');
    } catch (e) {
      warn('viewer events bind failed', e);
    }
  }

  function tryBindAll() {
    bindCaptionEvents();
    bindViewerEvents();
    updateLines();
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
