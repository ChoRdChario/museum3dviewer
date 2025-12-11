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
    root.style.right = '0';
    root.style.bottom = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '40'; // above viewer, below menus

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'lm-caption-overlay-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';

    const winContainer = document.createElement('div');
    winContainer.className = 'lm-caption-overlay-windows';
    winContainer.style.position = 'absolute';
    winContainer.style.left = '0';
    winContainer.style.top = '0';
    winContainer.style.width = '100%';
    winContainer.style.height = '100%';
    winContainer.style.pointerEvents = 'none';

    root.appendChild(svg);
    root.appendChild(winContainer);

    document.body.appendChild(root);

    overlayRoot = root;
    svgLayer = svg;
    winLayer = winContainer;

    log('overlay root created');
    return overlayRoot;
  }

  // ---------------------------------------------------------------------------
  // Viewer bridge
  // ---------------------------------------------------------------------------
  function ensureViewerBridge() {
    const pr = window.__lm_pin_runtime;
    if (pr && typeof pr.getBridge === 'function') {
      try {
        const b = pr.getBridge();
        if (b) return b;
      } catch (e) {
        warn('pin_runtime.getBridge failed', e);
      }
    }
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------
  function createWindowState(id, item) {
    return {
      id,
      item,
      el: null,
      lineEl: null
    };
  }

  function getWindowState(id) {
    return windows.get(id) || null;
  }

  function ensureLineElement() {
    if (!svgLayer) ensureOverlayRoot();
    if (!svgLayer) return null;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'lm-caption-line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '0');
    svgLayer.appendChild(line);
    return line;
  }

  function createWindowElement(state) {
    if (!winLayer) ensureOverlayRoot();
    if (!winLayer) return null;

    const el = document.createElement('div');
    el.className = 'lm-caption-window';
    el.dataset.id = state.id;
    el.style.position = 'absolute';
    el.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.className = 'lm-caption-window-title';

    const body = document.createElement('div');
    body.className = 'lm-caption-window-body';

    el.appendChild(title);
    el.appendChild(body);

    winLayer.appendChild(el);
    state.el = el;
    state.titleEl = title;
    state.bodyEl = body;
    return el;
  }

  function updateWindowContent(state) {
    const { item, titleEl, bodyEl } = state;
    if (!item) return;
    if (titleEl) {
      titleEl.textContent = item.title || '(untitled)';
    }
    if (bodyEl) {
      bodyEl.textContent = item.body || '';
    }
  }

  // ---------------------------------------------------------------------------
  // Projection / positioning
  // ---------------------------------------------------------------------------
  function projectItemToScreen(item) {
    const br = ensureViewerBridge();
    if (!br || typeof br.projectPoint !== 'function' || !item || !item.pos) {
      return null;
    }
    try {
      const p = item.pos;
      // Support both legacy projectPoint(x,y,z) and new projectPoint({x,y,z})
      if (br.projectPoint.length >= 3) {
        return br.projectPoint(p.x, p.y, p.z);
      }
      return br.projectPoint({ x: p.x, y: p.y, z: p.z });
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
    if (!sp) {
      el.style.display = 'none';
      if (state.lineEl) state.lineEl.style.display = 'none';
      return;
    }

    const vw = window.innerWidth  || document.documentElement.clientWidth  || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;

    const x = sp.x * vw;
    const y = sp.y * vh;

    const rect = el.getBoundingClientRect();
    const offsetX = 24;
    const offsetY = -rect.height / 2;

    const left = x + offsetX;
    const top  = y + offsetY;

    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;
    el.style.display = '';

    if (state.lineEl) {
      state.lineEl.setAttribute('x1', String(x));
      state.lineEl.setAttribute('y1', String(y));
      state.lineEl.setAttribute('x2', String(left));
      state.lineEl.setAttribute('y2', String(top + rect.height / 2));
      state.lineEl.style.display = '';
    }
  }

  function updateAllWindows() {
    windows.forEach((state) => {
      positionWindowNearItem(state);
    });
  }

  // ---------------------------------------------------------------------------
  // Binding to caption UI
  // ---------------------------------------------------------------------------
  function bindCaptionEvents() {
    const ui = window.__LM_CAPTION_UI;
    if (!ui || typeof ui.on !== 'function') {
      warn('caption UI not ready');
      return false;
    }

    ui.on('change', ({ item }) => {
      if (!item || !item.id) return;
      const st = windows.get(item.id);
      if (!st) return;
      st.item = item;
      updateWindowContent(st);
      positionWindowNearItem(st);
    });

    ui.on('itemAdded', ({ item }) => {
      if (!item || !item.id) return;
      let st = windows.get(item.id);
      if (!st) {
        st = createWindowState(item.id, item);
        st.el = createWindowElement(st);
        st.lineEl = ensureLineElement();
        windows.set(item.id, st);
      } else {
        st.item = item;
      }
      updateWindowContent(st);
      positionWindowNearItem(st);
    });

    ui.on('itemDeleted', ({ id }) => {
      const st = windows.get(id);
      if (!st) return;
      if (st.el && st.el.parentElement) {
        st.el.parentElement.removeChild(st.el);
      }
      if (st.lineEl && st.lineEl.parentElement) {
        st.lineEl.parentElement.removeChild(st.lineEl);
      }
      windows.delete(id);
    });

    log('caption events bound');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Binding to viewer
  // ---------------------------------------------------------------------------
  function bindViewerEvents() {
    const br = ensureViewerBridge();
    if (!br) {
      warn('viewer bridge not ready');
      return false;
    }

    if (typeof br.onRenderTick === 'function') {
      try {
        br.onRenderTick(() => {
          updateAllWindows();
        });
      } catch (e) {
        warn('onRenderTick bind failed', e);
      }
    }

    if (typeof br.onPinSelect === 'function') {
      try {
        br.onPinSelect(({ id }) => {
          const ui = window.__LM_CAPTION_UI;
          if (!ui || typeof ui.setSelection !== 'function') return;
          ui.setSelection(id || null, { fromViewer: true });
        });
      } catch (e) {
        warn('onPinSelect bind failed', e);
      }
    }

    const canvas = document.querySelector('canvas#gl');
    if (canvas) {
      canvas.addEventListener('click', (ev) => {
        if (!ev.shiftKey) return;
        const rect = canvas.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;
        try {
          const ev2 = new CustomEvent('lm:caption-screen-click', {
            bubbles: true,
            detail: { x, y }
          });
          canvas.dispatchEvent(ev2);
        } catch (e) {
          warn('screen-click event failed', e);
        }
      }, { passive: true });
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
      window.removeEventListener('lm:scene-ready', tryBindAll);
      document.removeEventListener('lm:viewer-bridge-ready', tryBindAll);
    }
  }

  window.addEventListener('resize', () => {
    updateAllWindows();
  });

  setTimeout(tryBindAll, 0);
  window.addEventListener('lm:scene-ready', tryBindAll, { passive: true });
  document.addEventListener('lm:viewer-bridge-ready', tryBindAll, { passive: true });

  window.__LM_CAPTION_OVERLAY__ = {
    __ver: 'A2-20251211'
  };

  log('overlay fully bound');
})();
