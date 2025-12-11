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

  const svgNS = 'http://www.w3.org/2000/svg';

  function ensureViewerBridge() {
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  function ensureCaptionUI() {
    return window.__LM_CAPTION_UI || null;
  }

  const windows = new Map(); // id -> { item, el, lastScreenPos }

  function createOverlayRoot() {
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

    const svg = document.createElementNS(svgNS, 'svg');
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
    return document.getElementById('lm-caption-overlay-root') || createOverlayRoot();
  }

  function getOverlaySvg() {
    const root = getOverlayRoot();
    if (!root) return null;
    let svg = root.querySelector('svg.lm-caption-overlay-lines');
    if (!svg) {
      svg = document.createElementNS(svgNS, 'svg');
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
      return br.projectPoint(p && typeof p.x === 'number' ? p : { x: p.x, y: p.y, z: p.z });
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
    const preferredY = sp.y - rect.height * 0.5;

    let x = preferredX;
    let y = preferredY;

    if (x + rect.width > vw - 16) {
      x = vw - rect.width - 16;
    }
    if (x < 16) x = 16;
    if (y + rect.height > vh - 16) {
      y = vh - rect.height - 16;
    }
    if (y < 16) y = 16;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    state.lastScreenPos = sp;
  }

  function updateLines() {
    const svg = getOverlaySvg();
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const root = getOverlayRoot();
    if (!root) return;

    const rectRoot = root.getBoundingClientRect();

    windows.forEach((state, id) => {
      const item = state.item;
      if (!item || !item.pos) return;
      const sp = projectItemToScreen(item) || state.lastScreenPos;
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
      line.setAttribute('stroke-width', '1');

      svg.appendChild(line);
    });
  }

  function createCaptionWindow(item) {
    const root = getOverlayRoot();
    if (!root) return null;

    const el = document.createElement('div');
    el.className = 'lm-caption-window';
    el.style.position = 'absolute';
    el.style.minWidth = '200px';
    el.style.maxWidth = '320px';
    el.style.background = 'rgba(15,23,42,0.96)';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 12px 30px rgba(15,23,42,0.9)';
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
    closeBtn.style.top = '0';
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

    inner.appendChild(header);
    inner.appendChild(body);
    el.appendChild(inner);
    root.appendChild(el);

    const state = { item, el, lastScreenPos: null };
    windows.set(item.id, state);

    positionWindowNearItem(state);
    updateLines();

    // drag handling, click handling など既存ロジックをこのあとにそのまま残す
    // ...

    return state;
  }

  function removeCaptionWindow(id) {
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
      if (keyId !== id) removeCaptionWindow(keyId);
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

    document.addEventListener('lm:caption-select', (ev) => {
      const d = ev && ev.detail || {};
      const id = d.id || null;
      if (!id) return;
      const item = (ui.items || []).find(it => it.id === id);
      if (!item) return;
      if (!windows.has(id)) {
        createCaptionWindow(item);
      }
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

  (function init() {
    try {
      getOverlayRoot();
      bindCaptionEvents();
      bindViewerEvents();
      log('overlay fully bound');
    } catch (e) {
      warn('init failed', e);
    }
  })();

  window.__LM_CAPTION_OVERLAY__ = { __ver: 'A2' };
})();
