(function () {
  const TAG = "[caption.ui.controller]";
  console.log(TAG, "world-space hook installed");

  const elPanel =
    document.querySelector("#panel-caption") ||
    document.querySelector("#pane-caption");
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
  // 状態管理
  // ────────────────────────────────────────────────

  const store = {
    items: [],
    activeId: null,
    filter: "all", // "all" | "with-image" | "no-image"
    currentColor: "#ff6666",
  };

  function setItems(items) {
    store.items = items || [];
    renderList();
    renderPins();
  }

  function setActiveId(id) {
    store.activeId = id;
    renderList();
    renderActiveForm();
    renderPins();
  }

  function setFilter(filter) {
    store.filter = filter;
    renderList();
    renderPins();
  }

  function setCurrentColor(color) {
    store.currentColor = color;
    renderColorPalette();
  }

  function getActiveItem() {
    return store.items.find((it) => it.id === store.activeId) || null;
  }

  // ────────────────────────────────────────────────
  // 色パレット（Pin color）
  // ────────────────────────────────────────────────

  const COLOR_KEYS = [
    "#ff6666",
    "#ffcc66",
    "#66ff66",
    "#66ccff",
    "#9966ff",
    "#ff99cc",
    "#ffffff",
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

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "caption-filter";
      input.value = key;
      input.addEventListener("change", () => {
        setFilter(key);
      });

      const span = document.createElement("span");
      span.textContent =
        key === "all" ? "All" : key === "with-image" ? "With image" : "No image";

      label.appendChild(input);
      label.appendChild(span);
      elCaptionFilterRow.appendChild(label);
    });
  }

  function applyFilter(items) {
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

    pinRuntime.addPinMarker({
      id: item.id,
      position: item.position,
      color: item.color || store.currentColor,
      selected: item.id === store.activeId,
      title: item.title || "",
    });
  }

  function renderPins() {
    clearAllPinMarkers();
    const filtered = applyFilter(store.items);
    filtered.forEach((item) => {
      addPinMarkerForItem(item);
    });
  }

  // ────────────────────────────────────────────────
  // キャプションリストの描画
  // ────────────────────────────────────────────────

  function renderList() {
    elCaptionList.innerHTML = "";

    const filtered = applyFilter(store.items);

    filtered.forEach((item) => {
      const row = document.createElement("div");
      row.className = "lm-caption-row";
      row.setAttribute("data-id", item.id);

      if (item.id === store.activeId) {
        row.classList.add("active");
      }

      const sw = document.createElement("div");
      sw.className = "lm-caption-color-dot";
      sw.style.backgroundColor = item.color || store.currentColor;

      const title = document.createElement("div");
      title.className = "lm-caption-title";
      title.textContent = item.title || "(no title)";

      const meta = document.createElement("div");
      meta.className = "lm-caption-meta";
      meta.textContent = item.imageFileId ? "📷" : "";

      row.appendChild(sw);
      row.appendChild(title);
      row.appendChild(meta);

      row.addEventListener("click", () => {
        setActiveId(item.id);
        const pinRuntime = getPinRuntime();
        if (pinRuntime && typeof pinRuntime.setPinSelected === "function") {
          pinRuntime.setPinSelected(item.id);
        }
      });

      elCaptionList.appendChild(row);
    });
  }

  // ────────────────────────────────────────────────
  // アクティブ行の編集フォーム
  // ────────────────────────────────────────────────

  function renderActiveForm() {
    const active = getActiveItem();
    if (!active) {
      elCaptionTitle.value = "";
      elCaptionBody.value = "";
      return;
    }
    elCaptionTitle.value = active.title || "";
    elCaptionBody.value = active.body || "";
  }

  elCaptionTitle.addEventListener("input", () => {
    const active = getActiveItem();
    if (!active) return;
    active.title = elCaptionTitle.value;
    renderList();
  });

  elCaptionBody.addEventListener("input", () => {
    const active = getActiveItem();
    if (!active) return;
    active.body = elCaptionBody.value;
  });

  // ────────────────────────────────────────────────
  // 画像一覧の描画
  // ────────────────────────────────────────────────

  function renderImages(images) {
    elCaptionImageList.innerHTML = "";
    if (!images || images.length === 0) {
      elCaptionImages.classList.add("empty");
      return;
    }
    elCaptionImages.classList.remove("empty");

    const clone = elCaptionImageTemplate.content
      .cloneNode(true)
      .querySelector("[data-caption-image-item]");

    images.forEach((item) => {
      const node = clone.cloneNode(true);

      const img = node.querySelector("img");
      img.src = `https://drive.google.com/thumbnail?sz=w200-h200&id=${encodeURIComponent(
        item.imageFileId
      )}`;

      node.addEventListener("click", () => {
        const active = getActiveItem();
        if (!active) return;
        active.imageFileId = item.imageFileId;
        renderList();
      });

      elCaptionImageList.appendChild(node);
    });
  }

  // ────────────────────────────────────────────────
  // 公開 API
  // ────────────────────────────────────────────────

  const api = {
    setItems,
    setActiveId,
    setFilter,
    setCurrentColor,
    setImages: renderImages,
    projectToScreen,
  };

  window.__LM_CAPTION_UI = api;

  // 初期起動
  initColorPalette();
  initFilterButtons();
  renderList();
})();
