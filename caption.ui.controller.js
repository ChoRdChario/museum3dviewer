// [caption.ui.controller] Phase A2 — caption UI + pin bridge +
//   - Stable selection model
//   - Sync with sheet bridge (__LM_CAPTION_SHEET_BRIDGE__)
//   - Sync with image loader (__LM_CAPTION_IMAGES__)
//   - World-space overlay uses __LM_CAPTION_UI as its data source

(function () {
  const TAG = '[caption.ui.controller]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // Helpers
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function safeParseFloat(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // ---------------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------------

  const root = document.getElementById('caption-panel-root') || document.body;
  if (!root) {
    warn('root not found; abort');
    return;
  }

  const el = {
    panel: document.getElementById('panel-caption'),
    list: document.getElementById('caption-list'),
    titleInput: document.getElementById('caption-title'),
    bodyInput: document.getElementById('caption-body'),
    imagesScroller: document.getElementById('caption-images-scroller'),
    imagesWrap: document.getElementById('caption-images-wrap'),
    imagesRefreshBtn: document.getElementById('caption-images-refresh'),
    previewImage: document.getElementById('caption-preview-image'),
    previewTitle: document.getElementById('caption-preview-title'),
    previewBody: document.getElementById('caption-preview-body'),
  };

  if (!el.panel || !el.list || !el.titleInput || !el.bodyInput) {
    warn('panel or core elements not found; abort');
    return;
  }

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  const store = {
    items: [],
    selectedId: null,  // single source of truth
    images: {
      byId: {},   // fileId -> { id, name, mimeType, thumbnailUrl }
      order: [],  // ordered array of ids
    },
    isBatchUpdating: false,
  };

  function getSelectedIdValue() {
    return store.selectedId || null;
  }

  function findItemIndexById(id) {
    if (!id) return -1;
    return store.items.findIndex(it => it.id === id);
  }

  function findItemById(id) {
    const idx = findItemIndexById(id);
    return idx >= 0 ? store.items[idx] : null;
  }

  function getActiveItem() {
    const id = getSelectedIdValue();
    return findItemById(id);
  }

  // ---------------------------------------------------------------------------
  // Pins bridge
  // ---------------------------------------------------------------------------

  function ensurePinBridge() {
    return window.__LM_PIN_BRIDGE__;
  }

  function syncPinsFromItems() {
    const pinBridge = ensurePinBridge();
    if (!pinBridge || typeof pinBridge.setPins !== 'function') return;

    const pins = store.items.map(it => ({
      id: it.id,
      color: it.color || '#eab308',
      pos: {
        x: it.posX,
        y: it.posY,
        z: it.posZ,
      },
      deleted: !!it.deleted,
    }));

    pinBridge.setPins(pins);
  }

  function handlePinSelected(id) {
    if (!id) return;
    selectItem(id);
  }

  // ---------------------------------------------------------------------------
  // Sheet bridge
  // ---------------------------------------------------------------------------

  function ensureSheetBridge() {
    return window.__LM_CAPTION_SHEET_BRIDGE__;
  }

  async function persistItemText(item) {
    const bridge = ensureSheetBridge();
    if (!bridge || typeof bridge.updateText !== 'function') return;
    if (!item || !item.id) return;

    try {
      await bridge.updateText(item);
    } catch (e) {
      console.error(TAG, 'persistItemText error', e);
    }
  }

  async function persistItemImage(item) {
    const bridge = ensureSheetBridge();
    if (!bridge || typeof bridge.updateImage !== 'function') return;
    if (!item || !item.id) return;

    try {
      await bridge.updateImage(item);
    } catch (e) {
      console.error(TAG, 'persistItemImage error', e);
    }
  }

  async function persistItemPos(item) {
    const bridge = ensureSheetBridge();
    if (!bridge || typeof bridge.updatePos !== 'function') return;
    if (!item || !item.id) return;

    try {
      await bridge.updatePos(item);
    } catch (e) {
      console.error(TAG, 'persistItemPos error', e);
    }
  }

  async function persistSoftDelete(item) {
    const bridge = ensureSheetBridge();
    if (!bridge || typeof bridge.softDelete !== 'function') return;
    if (!item || !item.id) return;

    try {
      await bridge.softDelete(item);
    } catch (e) {
      console.error(TAG, 'persistSoftDelete error', e);
    }
  }

  async function persistNewItem(item) {
    const bridge = ensureSheetBridge();
    if (!bridge || typeof bridge.append !== 'function') return;
    if (!item || !item.id) return;

    try {
      const rowIndex = await bridge.append(item);
      if (Number.isFinite(rowIndex)) {
        item.rowIndex = rowIndex;
      }
    } catch (e) {
      console.error(TAG, 'persistNewItem error', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Images loader bridge
  // ---------------------------------------------------------------------------

  function ensureImagesBridge() {
    return window.__LM_CAPTION_IMAGES__ || null;
  }

  function refreshImagesFromBridge() {
    const bridge = ensureImagesBridge();
    if (!bridge || !bridge.byId) {
      store.images.byId = {};
      store.images.order = [];
      return;
    }
    store.images.byId = bridge.byId || {};
    store.images.order = bridge.order || Object.keys(store.images.byId);
  }

  function renderImages() {
    refreshImagesFromBridge();

    const wrap = el.imagesWrap;
    if (!wrap) return;

    wrap.innerHTML = '';
    const ids = store.images.order;

    ids.forEach(id => {
      const imgMeta = store.images.byId[id];
      if (!imgMeta) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-caption-image-thumb';
      btn.dataset.fileId = imgMeta.id || id;

      const img = document.createElement('img');
      img.src = imgMeta.thumbnailUrl || imgMeta.webContentLink || '';
      img.alt = imgMeta.name || imgMeta.id || '';
      btn.appendChild(img);

      btn.addEventListener('click', () => {
        const active = getActiveItem();
        if (!active) return;

        active.imageFileId = btn.dataset.fileId || '';
        persistItemImage(active);
        renderPreview();
      });

      wrap.appendChild(btn);
    });

    updateImageSelectionHighlight();
  }

  function updateImageSelectionHighlight() {
    const active = getActiveItem();
    const selectedFileId = active && active.imageFileId;

    $all('.lm-caption-image-thumb', el.imagesWrap).forEach(btn => {
      if (!selectedFileId) {
        btn.classList.remove('selected');
        return;
      }
      if (btn.dataset.fileId === selectedFileId) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
  }

  function getSelectedImageMeta() {
    const active = getActiveItem();
    if (!active || !active.imageFileId) return null;
    return store.images.byId[active.imageFileId] || null;
  }

  function renderPreview() {
    const item = getActiveItem();

    const title = item && item.title
      ? item.title
      : '';
    const body = item && item.body
      ? item.body
      : '';

    if (el.titleInput) el.titleInput.value = title;
    if (el.bodyInput) el.bodyInput.value = body;

    if (el.previewTitle) el.previewTitle.textContent = title || '(untitled)';
    if (el.previewBody) el.previewBody.textContent = body || '';

    const imgMeta = getSelectedImageMeta();
    if (el.previewImage) {
      if (imgMeta && imgMeta.thumbnailUrl) {
        el.previewImage.src = imgMeta.thumbnailUrl;
        el.previewImage.style.display = '';
      } else {
        el.previewImage.src = '';
        el.previewImage.style.display = 'none';
      }
    }

    updateImageSelectionHighlight();
  }

  // ---------------------------------------------------------------------------
  // List rendering
  // ---------------------------------------------------------------------------

  function createListItem(item) {
    const li = document.createElement('li');
    li.className = 'lm-caption-list-item';
    li.dataset.id = item.id;

    const dot = document.createElement('span');
    dot.className = 'lm-caption-list-dot';
    dot.style.backgroundColor = item.color || '#eab308';
    li.appendChild(dot);

    const label = document.createElement('span');
    const title = item.title && item.title.trim();
    label.textContent = title || '(untitled)';
    li.appendChild(label);

    li.addEventListener('click', () => {
      selectItem(item.id);
    });

    return li;
  }

  function refreshList() {
    const list = el.list;
    if (!list) return;

    list.innerHTML = '';
    store.items.forEach(item => {
      if (item.deleted) return;
      const li = createListItem(item);
      if (item.id === getSelectedIdValue()) {
        li.classList.add('selected');
      }
      list.appendChild(li);
    });
  }

  function updateListSelectionHighlight() {
    const currentId = getSelectedIdValue();
    $all('.lm-caption-list-item', el.list).forEach(li => {
      if (li.dataset.id === currentId) {
        li.classList.add('selected');
      } else {
        li.classList.remove('selected');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Item normalization & collection operations
  // ---------------------------------------------------------------------------

  function normalizeItem(raw) {
    if (!raw) return null;
    return {
      id: raw.id,
      title: raw.title || '',
      body: raw.body || '',
      color: raw.color || '#eab308',
      posX: safeParseFloat(raw.posX, 0),
      posY: safeParseFloat(raw.posY, 0),
      posZ: safeParseFloat(raw.posZ, 0),
      imageFileId: raw.imageFileId || '',
      rowIndex: raw.rowIndex || null,
      deleted: !!raw.deleted,
    };
  }

  function addItemFromWorldSpace(worldPos) {
    const id = 'c_' + Math.random().toString(36).slice(2, 10);

    const item = normalizeItem({
      id,
      title: '',
      body: '',
      color: '#eab308',
      posX: worldPos && worldPos.x || 0,
      posY: worldPos && worldPos.y || 0,
      posZ: worldPos && worldPos.z || 0,
      imageFileId: '',
      rowIndex: null,
      deleted: false,
    });

    store.items.push(item);
    refreshList();
    syncPinsFromItems();
    selectItem(item.id);
    persistNewItem(item);
  }

  function markItemDeleted(id) {
    const item = findItemById(id);
    if (!item) return;
    item.deleted = true;
    refreshList();
    syncPinsFromItems();
    if (getSelectedIdValue() === id) {
      selectItem(null);
    }
    persistSoftDelete(item);
  }

  // ---------------------------------------------------------------------------
  // Selection core
  // ---------------------------------------------------------------------------

  const selectionCallbacks = {
    changed: [],
  };

  function notifySelectionChanged() {
    const id = getSelectedIdValue();
    const item = getActiveItem();
    selectionCallbacks.changed.forEach(fn => {
      try {
        fn(id, item);
      } catch (e) {
        console.error(TAG, 'selection callback error', e);
      }
    });
  }

  function selectItem(id) {
    const normalizedId = id || null;

    if (normalizedId && !findItemById(normalizedId)) {
      console.warn(TAG, 'selectItem: id not found', normalizedId);
      return;
    }

    store.selectedId = normalizedId;
    updateListSelectionHighlight();
    renderPreview();
    syncPinsFromItems(); // ensure viewer highlight stays in sync
    notifySelectionChanged();
  }

  // ---------------------------------------------------------------------------
  // Text & image change handlers
  // ---------------------------------------------------------------------------

  function handleTitleInput() {
    if (store.isBatchUpdating) return;
    const item = getActiveItem();
    if (!item) return;

    const v = el.titleInput.value || '';
    item.title = v;
    refreshList();
    renderPreview();
    persistItemText(item);
  }

  function handleBodyInput() {
    if (store.isBatchUpdating) return;
    const item = getActiveItem();
    if (!item) return;

    const v = el.bodyInput.value || '';
    item.body = v;
    renderPreview();
    persistItemText(item);
  }

  // ---------------------------------------------------------------------------
  // Items setter (sheet -> UI)
  // ---------------------------------------------------------------------------

  function setItems(items){
    // Normalize and replace items from sheet.
    store.items = (items || []).map(normalizeItem);

    // Try to preserve current selection if possible.
    var currentId = getSelectedIdValue();
    var hasCurrent = currentId && store.items.some(function(it){ return it.id === currentId; });

    refreshList();
    syncPinsFromItems();
    renderImages();
    renderPreview();

    if (hasCurrent){
      selectItem(currentId);
    } else if (store.items.length > 0){
      selectItem(store.items[0].id);
    } else {
      // No items; clear selection and overlay.
      selectItem(null);
    }
  }

  // ---------------------------------------------------------------------------
  // World-space hook (Shift+クリックで pin + caption)
  // ---------------------------------------------------------------------------

  function handleWorldSpaceClick(ev) {
    if (!ev || !ev.detail) return;
    const worldPos = ev.detail.worldPos;
    if (!worldPos) return;

    addItemFromWorldSpace(worldPos);
  }

  // ---------------------------------------------------------------------------
  // Public API (__LM_CAPTION_UI)
  // ---------------------------------------------------------------------------

  const CAPTION_UI = {
    get items() {
      return store.items.slice();
    },
    get selectedId() {
      return getSelectedIdValue();
    },

    setItems,
    selectItem,
    addItemFromWorldSpace,
    markItemDeleted,

    onSelectionChanged(fn) {
      if (typeof fn === 'function') {
        selectionCallbacks.changed.push(fn);
      }
    },

    getActiveItem,
  };

  window.__LM_CAPTION_UI = CAPTION_UI;
  log('ready');

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  // Title / Body inputs
  if (el.titleInput) {
    el.titleInput.addEventListener('input', handleTitleInput);
  }
  if (el.bodyInput) {
    el.bodyInput.addEventListener('input', handleBodyInput);
  }

  // Images refresh button
  if (el.imagesRefreshBtn) {
    el.imagesRefreshBtn.addEventListener('click', () => {
      const bridge = ensureImagesBridge();
      if (!bridge || typeof bridge.reload !== 'function') {
        warn('images reload bridge not available');
        return;
      }
      bridge.reload('manual-refresh');
    });
  }

  // Pins bridge hook
  const pinBridge = ensurePinBridge();
  if (pinBridge && typeof pinBridge.onPinSelected === 'function') {
    pinBridge.onPinSelected(handlePinSelected);
  }

  // World-space hook
  document.addEventListener('lm:canvas-shift-pick', handleWorldSpaceClick);

  // Initial images render (if any)
  renderImages();
  renderPreview();

  log('world-space hook installed');

})();
