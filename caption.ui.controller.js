(function () {
  const TAG = "[caption.ui.controller]";
  console.log(TAG, "world-space hook installed");

  const elPanel = document.querySelector("#panel-caption");
  if (!elPanel) {
    console.warn(TAG, "panel not found");
    return;
  }

  // ────────────────────────────────────────────────
  // DOM 構築
  // ────────────────────────────────────────────────

  const elCaptionColorRow = elPanel.querySelector("[data-caption-color-row]");
  const elCaptionFilterRow = elPanel.querySelector("[data-caption-filter-row]");
  const elCaptionList = elPanel.querySelector("[data-caption-list]");
  const elCaptionTitle = elPanel.querySelector("[data-caption-title]");
  const elCaptionBody = elPanel.querySelector("[data-caption-body]");
  const elCaptionImages = elPanel.querySelector("[data-caption-images]");
  const elCaptionImageTemplate = elPanel.querySelector(
    "[data-caption-image-template]"
  );
  const elCaptionImageList = elPanel.querySelector("[data-caption-image-list]");

  if (
    !elCaptionColorRow ||
    !elCaptionFilterRow ||
    !elCaptionList ||
    !elCaptionTitle ||
    !elCaptionBody ||
    !elCaptionImages ||
    !elCaptionImageTemplate ||
    !elCaptionImageList
  ) {
    console.warn(TAG, "some caption panel elements not found");
    return;
  }

  // ────────────────────────────────────────────────
  // カラーパレット
  // ────────────────────────────────────────────────

  const COLOR_KEYS = [
    "#ffb3ba",
    "#ffdfba",
    "#ffffba",
    "#baffc9",
    "#bae1ff",
    "#e2baff",
    "#ffbaff",
    "#ffd1b3",
    "#d1ffb3",
    "#b3ffff",
  ];

  function initColorPalette() {
    COLOR_KEYS.forEach((color) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lm-pin-color";
      btn.style.backgroundColor = color;
      btn.setAttribute("data-color", color);
      btn.addEventListener("click", () => {
        setCurrentColor(color);
      });
      elCaptionColorRow.appendChild(btn);
    });
  }

  // ────────────────────────────────────────────────
  // フィルタ（All / With image / No image）
  // ────────────────────────────────────────────────

  const FILTER_KEYS = ["all", "with-image", "no-image"];

  function initFilterButtons() {
    FILTER_KEYS.forEach((key) => {
      const label = document.createElement("label");
      label.className = "lm-caption-filter-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "caption-filter";
      radio.value = key;

      const span = document.createElement("span");
      span.textContent =
        key === "all"
          ? "All"
          : key === "with-image"
          ? "With image"
          : "No image";

      label.appendChild(radio);
      label.appendChild(span);
      elCaptionFilterRow.appendChild(label);

      radio.addEventListener("change", () => {
        if (radio.checked) {
          setFilter(key);
        }
      });
    });
  }

  // ────────────────────────────────────────────────
  // 内部ストア
  // ────────────────────────────────────────────────

  const store = {
    items: [],
    activeId: null,
    currentColor: COLOR_KEYS[0],
    filter: "all",
    lastAddAtMs: 0,
  };

  function findItemById(id) {
    return store.items.find((it) => it.id === id) || null;
  }

  function applyFilter(items) {
    if (store.filter === "all") return items;
    if (store.filter === "with-image") {
      return items.filter((it) => !!it.imageFileId);
    }
    if (store.filter === "no-image") {
      return items.filter((it) => !it.imageFileId);
    }
    return items;
  }

  // ────────────────────────────────────────────────
  // ビューア／ピンランタイムへの橋渡し
  // ────────────────────────────────────────────────

  function getPinRuntime() {
    return window.__lm_pin_runtime || null;
  }

  function getViewerBridge() {
    const pinRuntime = getPinRuntime();
    if (!pinRuntime) return null;
    return pinRuntime.getViewerBridge();
  }

  function projectToScreen(world) {
    const bridge = getViewerBridge();
    if (!bridge || typeof bridge.projectPoint !== "function") return null;
    return bridge.projectPoint(world);
  }

  function clearAllPinMarkers() {
    const pinRuntime = getPinRuntime();
    if (!pinRuntime || typeof pinRuntime.clearPins !== "function") return;
    pinRuntime.clearPins();
  }

  function addPinMarkerForItem(item) {
    const pinRuntime = getPinRuntime();
    if (!pinRuntime || typeof pinRuntime.addPinMarker !== "function") return;

    const world = {
      x: item.posX,
      y: item.posY,
      z: item.posZ,
    };

    pinRuntime.addPinMarker({
      id: item.id,
      world,
      color: item.color,
      selected: store.activeId === item.id,
    });
  }

  function setSelectedPin(id) {
    const pinRuntime = getPinRuntime();
    if (!pinRuntime || typeof pinRuntime.setPinSelected !== "function") return;
    pinRuntime.setPinSelected(id);
  }

  // ────────────────────────────────────────────────
  // DOM レンダリング
  // ────────────────────────────────────────────────

  function renderColorPalette() {
    const buttons = elCaptionColorRow.querySelectorAll("[data-color]");
    buttons.forEach((btn) => {
      const color = btn.getAttribute("data-color");
      if (color === store.currentColor) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  function renderFilter() {
    const radios = elCaptionFilterRow.querySelectorAll(
      'input[type="radio"][name="caption-filter"]'
    );
    radios.forEach((radio) => {
      radio.checked = radio.value === store.filter;
    });
  }

  function renderList() {
    elCaptionList.innerHTML = "";

    const filtered = applyFilter(store.items);
    filtered.forEach((item) => {
      const row = document.createElement("div");
      row.className = "lm-caption-row";
      row.setAttribute("data-caption-id", item.id);

      const colorDot = document.createElement("span");
      colorDot.className = "lm-caption-color-dot";
      colorDot.style.backgroundColor = item.color;

      const titleSpan = document.createElement("span");
      titleSpan.className = "lm-caption-title";
      titleSpan.textContent = item.title || "(untitled)";

      row.appendChild(colorDot);
      row.appendChild(titleSpan);

      row.addEventListener("click", () => {
        selectCaption(item.id);
      });

      elCaptionList.appendChild(row);
    });
  }

  function renderDetail() {
    const active = store.activeId
      ? findItemById(store.activeId)
      : store.items[0] || null;

    if (!active) {
      elCaptionTitle.value = "";
      elCaptionBody.value = "";
      elCaptionImages.classList.add("hidden");
      elCaptionImageList.innerHTML = "";
      return;
    }

    if (store.activeId !== active.id) {
      store.activeId = active.id;
    }

    elCaptionTitle.value = active.title || "";
    elCaptionBody.value = active.body || "";

    renderImageList(active);
  }

  function renderImageList(item) {
    elCaptionImageList.innerHTML = "";

    if (!item.imageFileId) {
      elCaptionImages.classList.add("hidden");
      return;
    }

    elCaptionImages.classList.remove("hidden");

    const clone = elCaptionImageTemplate.content
      .cloneNode(true)
      .querySelector("[data-caption-image-item]");

    const img = clone.querySelector("img");
    img.src = `https://drive.google.com/thumbnail?sz=w200-h200&id=${encodeURIComponent(
      item.imageFileId
    )}`;

    elCaptionImageList.appendChild(clone);
  }

  function renderPins() {
    clearAllPinMarkers();
    const filtered = applyFilter(store.items);
    filtered.forEach((item) => {
      addPinMarkerForItem(item);
    });
  }

  function renderAll() {
    renderColorPalette();
    renderFilter();
    renderList();
    renderDetail();
    renderPins();
  }

  // ────────────────────────────────────────────────
  // アクション
  // ────────────────────────────────────────────────

  function setCurrentColor(color) {
    store.currentColor = color;
    renderColorPalette();
  }

  function setFilter(filterKey) {
    if (!FILTER_KEYS.includes(filterKey)) return;
    store.filter = filterKey;
    renderList();
    renderPins();
  }

  function addItemFromSheet(raw) {
    const item = {
      id: raw.id,
      title: raw.title || "",
      body: raw.body || "",
      color: raw.color || COLOR_KEYS[0],
      posX: Number(raw.posX) || 0,
      posY: Number(raw.posY) || 0,
      posZ: Number(raw.posZ) || 0,
      imageFileId: raw.imageFileId || "",
      createdAt: raw.createdAt || "",
      updatedAt: raw.updatedAt || "",
    };

    const existingIndex = store.items.findIndex((it) => it.id === item.id);
    if (existingIndex >= 0) {
      store.items[existingIndex] = item;
    } else {
      store.items.push(item);
    }
  }

  function setItemsFromSheet(rows) {
    store.items = [];
    rows.forEach((raw) => addItemFromSheet(raw));
    store.activeId = store.items[0] ? store.items[0].id : null;
    renderAll();
  }

  function addCaptionAt(world) {
    const now = Date.now();
    if (now - store.lastAddAtMs < 300) {
      console.log(TAG, "skip addCaptionAt (debounce)");
      return null;
    }
    store.lastAddAtMs = now;

    const id = "c_" + Math.random().toString(36).slice(2, 10);

    const base = {
      id,
      title: "",
      body: "",
      color: store.currentColor,
      posX: world.x,
      posY: world.y,
      posZ: world.z,
      imageFileId: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.items.push(base);
    store.activeId = id;

    renderAll();

    dispatchCaptionAdded(base);

    return base;
  }

  function updateActiveCaption(fields) {
    const active = store.activeId
      ? findItemById(store.activeId)
      : store.items[0] || null;
    if (!active) return;

    Object.assign(active, fields, {
      updatedAt: new Date().toISOString(),
    });

    renderAll();
    dispatchCaptionUpdated(active);
  }

  function selectCaption(id) {
    const item = findItemById(id);
    if (!item) return;
    store.activeId = id;
    renderAll();
    setSelectedPin(id);
    dispatchCaptionSelected(item);
  }

  function deleteActiveCaption() {
    const active = store.activeId
      ? findItemById(store.activeId)
      : store.items[0] || null;
    if (!active) return;

    const idx = store.items.findIndex((it) => it.id === active.id);
    if (idx >= 0) {
      store.items.splice(idx, 1);
    }

    const next =
      store.items[idx] ||
      store.items[idx - 1] ||
      store.items[0] ||
      null;

    store.activeId = next ? next.id : null;

    renderAll();
    dispatchCaptionDeleted(active);
  }

  // ────────────────────────────────────────────────
  // イベントディスパッチ（他モジュール連携用）
  // ────────────────────────────────────────────────

  function dispatchCaptionAdded(item) {
    window.dispatchEvent(
      new CustomEvent("lm:caption-added", {
        detail: { item },
      })
    );
  }

  function dispatchCaptionUpdated(item) {
    window.dispatchEvent(
      new CustomEvent("lm:caption-updated", {
        detail: { item },
      })
    );
  }

  function dispatchCaptionDeleted(item) {
    window.dispatchEvent(
      new CustomEvent("lm:caption-deleted", {
        detail: { item },
      })
    );
  }

  function dispatchCaptionSelected(item) {
    window.dispatchEvent(
      new CustomEvent("lm:caption-selected", {
        detail: { item },
      })
    );
  }

  // ────────────────────────────────────────────────
  // DOM イベント配線
  // ────────────────────────────────────────────────

  elCaptionTitle.addEventListener("input", () => {
    updateActiveCaption({ title: elCaptionTitle.value });
  });

  elCaptionBody.addEventListener("input", () => {
    updateActiveCaption({ body: elCaptionBody.value });
  });

  elCaptionBody.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      deleteActiveCaption();
    }
  });

  // ────────────────────────────────────────────────
  // 外から呼ばれる公開 API
  // ────────────────────────────────────────────────

  const ui = {
    setItemsFromSheet,
    addCaptionAt,
    selectCaption,
    setFilter,
    setCurrentColor,
    deleteActiveCaption,
  };

  window.__LM_CAPTION_UI = ui;

  // 初期化
  initColorPalette();
  initFilterButtons();
  renderAll();

  console.log(TAG, "ready");
})();
