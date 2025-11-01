
/* material.orchestrator.js
 * VERSION_TAG: V6_15g_SHEET_BRIDGE_GUARD
 * Responsibilities:
 *  - Wait for UI controls, viewerBridge, and materialsSheetBridge
 *  - Ensure order: load saved values -> apply to scene -> reflect to UI -> bind events
 *  - Debounced append writes to __LM_MATERIALS via materials.sheet.bridge.js
 */
(function () {
  const TAG = 'V6_15g_SHEET_BRIDGE_GUARD';

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const debounce = (fn, wait) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const q = (sel) => document.querySelector(sel);

  async function waitForUI(timeoutMs = 12000, pollMs = 50) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      // primary selectors
      let sel = q('#pm-material') || q('select[name="pm-material"]') || q('[data-lm="pm-material"]');
      let sld = q('#pm-opacity') || q('#pm-permat-opacity') || q('[data-lm="pm-opacity"]') || q('[data-lm="pm-permat-opacity"]');
      if (sel && sld) return { sel, sld };
      await sleep(pollMs);
    }
    throw new Error('UI controls not found');
  }

  async function waitForBridges(timeoutMs = 12000, pollMs = 60) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const vb = window.viewerBridge;
      const sb = window.materialsSheetBridge;
      if (vb && sb) return { vb, sb };
      await sleep(pollMs);
    }
    throw new Error('viewerBridge/materialsSheetBridge not ready');
  }

  // flags/state
  let wired = false;
  let haveScene = false;
  let haveSheetCtx = false;
  let sheetCtx = null;
  let latestRowsByKey = new Map(); // materialKey -> latest row
  let currentMaterialKey = null;

  function log(...args) {
    console.log('[mat-orch]', ...args);
  }

  // Listen for scene + sheet events
  window.addEventListener('lm:scene-ready', () => { haveScene = true; maybeWire(); }, { once: true });
  // sheet-context may fire repeatedly; capture latest and allow wire once
  window.addEventListener('lm:sheet-context', (ev) => {
    haveSheetCtx = true;
    sheetCtx = ev && ev.detail || ev;
    maybeWire();
  });

  async function maybeWire() {
    if (wired || !haveScene || !haveSheetCtx) return;
    wired = true;
    try {
      await boot();
    } catch (e) {
      wired = false; // allow retry if something truly failed
      console.warn('[mat-orch] boot failed (will not retry automatically)', e);
    }
  }

  async function boot() {
    log('loaded VERSION_TAG:', TAG);

    // 1) Wait UI + bridges
    const { sel, sld } = await waitForUI();
    log('ui ok');
    const { vb, sb } = await waitForBridges();
    // Cache refs
    const matSelect = sel;
    const opacitySlider = sld;

    // 2) Populate materials
    const mats = (vb.listMaterials && vb.listMaterials()) || [];
    // unique keys (skip empty names)
    const keys = Array.from(new Set(mats.map(m => m && m.name).filter(Boolean))).sort();
    matSelect.innerHTML = '<option value="">— Select —</option>' + keys.map(k => `<option value="${k}">${k}</option>`).join('');
    log('panel populated', keys.length, 'materials');

    // 3) Load saved values first
    latestRowsByKey.clear();
    try {
      const all = await sb.loadAll(sheetCtx && sheetCtx.spreadsheetId, sheetCtx && sheetCtx.sheetGid);
      // all: Array<rowObject> expected
      if (Array.isArray(all)) {
        for (const r of all) {
          const mk = r.materialKey || r.name || r.key;
          if (!mk) continue;
          const prev = latestRowsByKey.get(mk);
          // pick the newest by updatedAt if exists
          if (!prev) latestRowsByKey.set(mk, r);
          else {
            const a = Date.parse(prev.updatedAt || 0);
            const b = Date.parse(r.updatedAt || 0);
            if (b >= a) latestRowsByKey.set(mk, r);
          }
        }
      }
    } catch (e) {
      console.warn('[mat-orch] loadAll failed (continue with empty):', e);
    }

    // helpers
    const applyOpacityToScene = (materialKey, val01) => {
      if (!materialKey) return;
      if (vb && typeof vb.applyMaterialOpacity === 'function') {
        vb.applyMaterialOpacity(materialKey, val01);
        return;
      }
      // fallback: simple loop (if viewerBridge exposes materials list with refs)
      try {
        const items = vb.listMaterials ? vb.listMaterials() : [];
        for (const it of items) {
          if (it && it.name === materialKey && it.material) {
            const m = it.material;
            if ('transparent' in m) m.transparent = val01 < 1.0 || m.transparent;
            if ('opacity' in m) m.opacity = val01;
            if ('needsUpdate' in m) m.needsUpdate = true;
          }
        }
      } catch (err) {
        console.warn('[mat-orch] applyOpacity fallback failed:', err);
      }
    };

    const reflectToUI = (materialKey) => {
      const row = latestRowsByKey.get(materialKey);
      if (row && row.opacity != null && row.opacity !== '') {
        const v = Number(row.opacity);
        if (!Number.isNaN(v)) {
          opacitySlider.value = String(Math.max(0, Math.min(1, v)));
        }
      } else {
        // default
        opacitySlider.value = '1';
      }
    };

    const saveDebounced = debounce(async (materialKey, v) => {
      try {
        await sb.upsertOne({
          materialKey,
          opacity: v,
          updatedBy: 'ui'
        }, sheetCtx && sheetCtx.spreadsheetId, sheetCtx && sheetCtx.sheetGid);
        log('persisted to sheet:', materialKey);
      } catch (e) {
        console.warn('[mat-orch] upsertOne failed', e);
      }
    }, 220);

    // 4) Bind events (after reflect)
    matSelect.addEventListener('change', () => {
      currentMaterialKey = matSelect.value || null;
      reflectToUI(currentMaterialKey);
      // DO NOT persist here
      const v = Number(opacitySlider.value);
      if (!Number.isNaN(v)) applyOpacityToScene(currentMaterialKey, v);
    });

    const onSlidePreview = () => {
      if (!currentMaterialKey) return;
      const v = Number(opacitySlider.value);
      if (Number.isNaN(v)) return;
      applyOpacityToScene(currentMaterialKey, v);
    };
    const onSlideCommit = () => {
      if (!currentMaterialKey) return;
      const v = Number(opacitySlider.value);
      if (Number.isNaN(v)) return;
      saveDebounced(currentMaterialKey, v);
    };

    opacitySlider.addEventListener('input', onSlidePreview);
    opacitySlider.addEventListener('change', onSlideCommit);
    opacitySlider.addEventListener('pointerup', onSlideCommit);
    opacitySlider.addEventListener('mouseup', onSlideCommit);
    opacitySlider.addEventListener('touchend', onSlideCommit);

    log('wired panel');

    // 5) If there is an existing value in the select, reflect immediately
    if (matSelect.value) {
      currentMaterialKey = matSelect.value;
      reflectToUI(currentMaterialKey);
      const v = Number(opacitySlider.value);
      if (!Number.isNaN(v)) applyOpacityToScene(currentMaterialKey, v);
    }
  }

  // In case the events fired earlier than this script attached
  // try boot after a short delay if both bridges are already ready
  (async () => {
    try {
      // small delay to let index.html finish layout
      await sleep(30);
      // if viewer and sheet ctx already present, flags may be true
      if (window.__lm_scene_ready) haveScene = true;
      if (window.__lm_sheet_ctx_ready) { haveSheetCtx = true; sheetCtx = window.__lm_sheet_ctx_ready; }
      maybeWire();
    } catch (e) {
      console.warn('[mat-orch] early boot attempt failed', e);
    }
  })();
})();
