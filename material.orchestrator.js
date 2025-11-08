// material.orchestrator.js  v2.4 (clean wire)
(function () {
  console.log('[mat-orch v2.4] load');

  const $ = (sel, root=document) => root.querySelector(sel);
  const $all = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const panel = $('#panel-material');
  if (!panel) {
    console.warn('[mat-orch] panel-material not found');
    return;
  }

  // ===== UI pickers (robust selector fallback) =====
  const dd = $('#pm-material, #panel-material select, [data-lm="pm-material"]', panel);
  const range = $('#pm-opacity-range, #pm-opacity input[type="range"], [data-lm="pm-opacity-range"]', panel);
  const value = $('#pm-opacity-value, #pm-opacity .value, [data-lm="pm-opacity-value"]', panel);

  if (!dd || !range) {
    console.warn('[mat-orch] pm controls missing', {hasDd: !!dd, hasRange: !!range});
    return;
  }

  // number表示が無いUIでも壊れないように
  const setValueText = (v) => {
    if (value) value.textContent = (Math.round(v * 100) / 100).toFixed(2);
  };

  // ===== Scene hook =====
  let scene = null;
  let materialsByName = new Map();

  const collectMaterials = () => {
    materialsByName.clear();
    if (!scene) return;
    scene.traverse(obj => {
      const applyMat = (m) => {
        if (!m || !m.name) return;
        if (!materialsByName.has(m.name)) materialsByName.set(m.name, []);
        materialsByName.get(m.name).push(m);
      };
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(applyMat);
        else applyMat(obj.material);
      }
    });
  };

  const populateDropdown = () => {
    if (!dd) return;
    const current = dd.value;
    dd.innerHTML = '';
    const names = [...materialsByName.keys()].sort();
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      dd.appendChild(opt);
    });
    if (names.length) {
      dd.value = names.includes(current) ? current : names[0];
    }
  };

  const applyOpacity = (name, v) => {
    const list = materialsByName.get(name) || [];
    list.forEach(mat => {
      mat.opacity = v;
      // 透明度 < 1 は透過を必須に
      mat.transparent = v < 0.999;
      // 透過時のZ書き込みは基本オフ（モデル次第）
      if ('depthWrite' in mat) mat.depthWrite = v >= 0.999;
      mat.needsUpdate = true;
    });
  };

  const onChange = () => {
    const name = dd.value;
    const v = Number(range.value);
    setValueText(v);
    applyOpacity(name, v);
    // Sheets へ通知イベント（bridge が拾う）
    window.dispatchEvent(new CustomEvent('lm:mat-opacity', {
      detail: {
        spreadsheetId: currentSheet?.spreadsheetId || null,
        sheetGid: currentSheet?.sheetGid ?? null,
        materialKey: name,
        opacity: v,
        updatedAt: new Date().toISOString(),
        updatedBy: 'ui'
      }
    }));
  };

  // ===== Sheet context (ローカル復元用) =====
  let currentSheet = null;
  const localKey = () => currentSheet
    ? `lm:mat:opacity:${currentSheet.spreadsheetId}:${currentSheet.sheetGid}`
    : null;

  const saveLocal = () => {
    const k = localKey();
    if (!k) return;
    const obj = { material: dd.value, opacity: Number(range.value), at: Date.now() };
    try { localStorage.setItem(k, JSON.stringify(obj)); } catch {}
  };
  const loadLocal = () => {
    const k = localKey();
    if (!k) return false;
    try {
      const obj = JSON.parse(localStorage.getItem(k) || 'null');
      if (!obj) return false;
      if (obj.material && materialsByName.has(obj.material)) dd.value = obj.material;
      if (typeof obj.opacity === 'number') {
        range.value = String(obj.opacity);
        setValueText(obj.opacity);
      }
      return true;
    } catch { return false; }
  };

  dd.addEventListener('change', () => { onChange(); saveLocal(); });
  range.addEventListener('input', () => { onChange(); });
  range.addEventListener('change', () => { saveLocal(); });

  // ===== Scene / Sheet events =====
  window.addEventListener('lm:scene-ready', (e) => {
    scene = e.detail?.scene || window.__lm_scene || scene;
    collectMaterials();
    populateDropdown();
    // デフォルト状態で同期
    if (!loadLocal()) {
      // 初期値（UIが1.0など既定値の場合でも明示反映）
      setValueText(Number(range.value));
      onChange();
    }
    console.log('[mat-orch v2.4] scene bound. materials:', materialsByName.size);
  });

  window.addEventListener('lm:sheet-context', (e) => {
    currentSheet = { spreadsheetId: e.detail?.spreadsheetId, sheetGid: e.detail?.sheetGid };
    // シートが変わったらローカル復元を試す
    loadLocal();
    console.log('[mat-orch v2.4] sheet-context', currentSheet);
  });

  console.log('[mat-orch v2.4] UI bound');
})();
