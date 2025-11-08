// material.orchestrator.js  v2.5
(function () {
  console.log('[mat-orch v2.5] load');

  const $ = (sel, root=document) => root.querySelector(sel);
  const panel = $('#panel-material');
  if (!panel) { console.warn('[mat-orch] panel-material missing'); return; }

  // ---- UI pickers with resilient fallback ----
  const dd =
    $('#pm-material', panel) ||
    $('section select', panel) ||
    $('[data-lm="pm-material"]', panel);

  const range =
    $('#pm-opacity-range', panel) ||
    (function () {
      const sec = Array.from(panel.querySelectorAll('section,fieldset,div'))
        .find(el => /Per\s*-\s*material\s*opacity/i.test(el.textContent || ''));
      return (sec && sec.querySelector('input[type="range"]'))
          || panel.querySelector('input[type="range"]');
    })();

  const value =
    $('#pm-opacity-value', panel) ||
    $('[data-lm="pm-opacity-value"]', panel) ||
    (function () {
      const v = document.createElement('span');
      v.id = 'pm-opacity-value';
      if (range && range.parentElement) range.parentElement.appendChild(v);
      return v;
    })();

  if (!dd || !range) {
    console.warn('[mat-orch] pm controls missing', { hasDd: !!dd, hasRange: !!range });
    return;
  }

  const setValueText = (v) => {
    if (value) value.textContent = (Math.round(v * 100) / 100).toFixed(2);
  };

  // ---- Scene & materials ----
  let scene = null;
  let materialsByName = new Map();
  let currentSheet = null;

  const collectMaterials = () => {
    materialsByName.clear();
    if (!scene) return;
    scene.traverse(obj => {
      const put = (m) => {
        if (!m || !m.name) return;
        if (!materialsByName.has(m.name)) materialsByName.set(m.name, []);
        materialsByName.get(m.name).push(m);
      };
      if (obj.material) Array.isArray(obj.material) ? obj.material.forEach(put) : put(obj.material);
    });
  };

  const populateDropdown = () => {
    const keep = dd.value;
    dd.innerHTML = '';
    [...materialsByName.keys()].sort().forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n; dd.appendChild(o);
    });
    if (materialsByName.size) dd.value = materialsByName.has(keep) ? keep : dd.options[0].value;
  };

  const applyOpacity = (name, v) => {
    const list = materialsByName.get(name) || [];
    list.forEach(m => {
      m.opacity = v;
      m.transparent = v < 0.999;
      if ('depthWrite' in m) m.depthWrite = v >= 0.999;
      m.needsUpdate = true;
    });
  };

  const emitSave = (name, v) => {
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

  const onChange = () => {
    const name = dd.value;
    const v = Number(range.value);
    setValueText(v);
    applyOpacity(name, v);
    emitSave(name, v);
  };

  // ---- local persist per sheet ----
  const localKey = () => currentSheet
    ? `lm:mat:opacity:${currentSheet.spreadsheetId}:${currentSheet.sheetGid}`
    : null;

  const saveLocal = () => {
    const k = localKey(); if (!k) return;
    try { localStorage.setItem(k, JSON.stringify({ material: dd.value, opacity: Number(range.value), at: Date.now() })); } catch {}
  };
  const loadLocal = () => {
    const k = localKey(); if (!k) return false;
    try {
      const o = JSON.parse(localStorage.getItem(k) || 'null'); if (!o) return false;
      if (o.material && materialsByName.has(o.material)) dd.value = o.material;
      if (typeof o.opacity === 'number') { range.value = String(o.opacity); setValueText(o.opacity); }
      return true;
    } catch { return false; }
  };

  dd.addEventListener('change', () => { onChange(); saveLocal(); });
  range.addEventListener('input', onChange);
  range.addEventListener('change', saveLocal);

  // ---- events ----
  window.addEventListener('lm:scene-ready', (e) => {
    scene = e.detail?.scene || window.__lm_scene || scene;
    collectMaterials();
    populateDropdown();
    if (!loadLocal()) { setValueText(Number(range.value)); onChange(); }
    console.log('[mat-orch v2.5] scene bound, materials:', materialsByName.size);
  });

  window.addEventListener('lm:sheet-context', (e) => {
    currentSheet = { spreadsheetId: e.detail?.spreadsheetId, sheetGid: e.detail?.sheetGid };
    loadLocal();
    console.log('[mat-orch v2.5] sheet-context', currentSheet);
  });

  console.log('[mat-orch v2.5] UI bound');
})();
