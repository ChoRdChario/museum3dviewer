
/*! material.orchestrator.js v2.3 clean */
(() => {
  console.log('[mat-orch v2.3] load');
  const w = window;
  const d = document;

  // DOM getters (canonical ids)
  const $ = (sel) => d.querySelector(sel);
  const el = {
    select: $('#pm-material'),
    range:  $('#pm-opacity-range'),
    out:    $('#pm-opacity-val'),
  };

  // State
  let scene = null;
  let materialsByName = new Map();
  let currentName = '';

  function clamp01(x){ x = Number(x); return isFinite(x) ? Math.max(0, Math.min(1, x)) : 1; }

  function findScene() {
    // Try a few known hooks
    if (w.__LM_SCENE && w.__LM_SCENE.isScene) return w.__LM_SCENE;
    if (w.viewerBridge && typeof w.viewerBridge.getScene === 'function') return w.viewerBridge.getScene();
    if (w.viewer_bridge && w.viewer_bridge.scene) return w.viewer_bridge.scene;
    // three.js scenes heuristics
    for (const k in w) {
      const v = w[k];
      if (v && v.isScene) return v;
    }
    return null;
  }

  function indexMaterials(sc) {
    materialsByName.clear();
    sc.traverse((obj) => {
      const m = obj.material;
      if (!m) return;
      const add = (mat) => {
        const key = mat.name || `material#${materialsByName.size+1}`;
        if (!materialsByName.has(key)) materialsByName.set(key, mat);
      };
      if (Array.isArray(m)) m.forEach(add); else add(m);
    });
  }

  function populateDropdown() {
    const sel = el.select;
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select material —</option>';
    const names = Array.from(materialsByName.keys()).sort((a,b)=>a.localeCompare(b));
    for (const name of names) {
      const opt = d.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    }
    // keep current if exists
    if (currentName && materialsByName.has(currentName)) sel.value = currentName;
  }

  function reflectOpacityUI(op) {
    if (el.range) el.range.value = String(op.toFixed(2));
    if (el.out)   el.out.textContent = op.toFixed(2);
  }

  function getSelectedMaterial() {
    const name = el.select?.value || currentName;
    currentName = name;
    return materialsByName.get(name) || null;
  }

  function applyOpacity(op) {
    const mat = getSelectedMaterial();
    if (!mat) return;
    op = clamp01(op);
    mat.transparent = op < 0.999;
    mat.opacity = op;
    if ('depthWrite' in mat) mat.depthWrite = op >= 0.999;
    if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
    reflectOpacityUI(op);
    // Notify listeners
    w.dispatchEvent(new CustomEvent('lm:mat-opacity', { detail: { name: currentName, opacity: op } }));
  }

  function onRange() {
    const val = clamp01(parseFloat(el.range.value || '1'));
    applyOpacity(val);
    saveLocal();
  }

  function onSelect() {
    const mat = getSelectedMaterial();
    if (!mat) return;
    const op = clamp01(Number(mat.opacity ?? 1));
    reflectOpacityUI(op);
    saveLocal();
  }

  // Local storage per-sheet
  let sheetCtx = { spreadsheetId: null, sheetGid: null };
  function storageKey() {
    const sid = sheetCtx.spreadsheetId || 'no-sheet';
    const gid = sheetCtx.sheetGid != null ? sheetCtx.sheetGid : 'no-gid';
    return `lm:mat:opacity:${sid}:${gid}`;
  }

  function saveLocal() {
    try {
      const key = storageKey();
      const data = JSON.stringify({ name: currentName, opacity: Number(el.range?.value ?? 1) });
      localStorage.setItem(key, data);
      console.log('[mat-orch v2.3] local saved', key, data);
    } catch (e) { console.warn('[mat-orch] local save failed', e); }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return;
      const {name, opacity} = JSON.parse(raw);
      if (name && materialsByName.has(name)) {
        currentName = name;
        el.select.value = name;
        applyOpacity(clamp01(opacity ?? 1));
      }
    } catch (e) { console.warn('[mat-orch] local load failed', e); }
  }

  function bindUI() {
    if (el.range) el.range.addEventListener('input', onRange);
    if (el.select) el.select.addEventListener('change', onSelect);
    console.log('[mat-orch v2.3] UI bound');
  }

  // Boot
  function bootOnce() {
    scene = findScene();
    if (!scene) { console.warn('[mat-orch] scene not ready'); return; }
    indexMaterials(scene);
    populateDropdown();
    bindUI();
    loadLocal();
  }

  // Event wiring
  w.addEventListener('lm:scene-ready', bootOnce, { once: true });
  w.addEventListener('lm:sheet-context', (e) => {
    const { spreadsheetId, sheetGid } = e.detail || {};
    sheetCtx.spreadsheetId = spreadsheetId;
    sheetCtx.sheetGid = sheetGid;
    // reload to reflect per-sheet
    loadLocal();
  });

  // Fallback retry if event missed
  if (document.readyState !== 'loading') setTimeout(bootOnce, 0);
  else d.addEventListener('DOMContentLoaded', () => setTimeout(bootOnce, 0));

})();
