
// material.orchestrator.js
// V6_15i2_UI_ROBUST_BIND
(() => {
  const VERSION_TAG = 'V6_15i2_UI_ROBUST_BIND';
  const log = (...a) => console.log('[mat-orch]', ...a);
  const warn = (...a) => console.warn('[mat-orch]', ...a);
  const err = (...a) => console.error('[mat-orch]', ...a);

  const vb = window.viewerBridge;
  const sb = window.materialsSheetBridge;
  let currentSheetCtx = null;

  let wired = false;
  let ui = null;
  let savedMap = new Map();
  const pending = { t: null, payload: null };
  let programmaticSet = false;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function throttleSheetUpsert(payload, delay=220) {
    pending.payload = payload;
    if (pending.t) return;
    pending.t = setTimeout(async () => {
      const p = pending.payload;
      pending.t = null;
      pending.payload = null;
      try {
        if (!sb || !sb.upsertOne) throw new Error('materialsSheetBridge.upsertOne missing');
        await sb.upsertOne(p);
        log('persisted to sheet:', p.materialKey || p.name || p.materialName || '(unknown)');
      } catch (e) {
        err('upsertOne failed', e);
      }
    }, delay);
  }

  function qs(root, sel) { try { return root.querySelector(sel); } catch { return null; } }

  function probeUI(maxTries = 30, intervalMs = 120) {
    return new Promise(async (resolve, reject) => {
      for (let i=0; i<maxTries; i++) {
        if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
          await sleep(50);
        }
        const panel = 
          document.querySelector('#panel-material') ||
          document.querySelector('[data-lm-panel="material"]') ||
          document.querySelector('#tab-material') ||
          document.querySelector('section[data-tab="material"]') ||
          document.querySelector('[data-panel="material"]') ||
          document.querySelector('#material');

        const selMaterial = 
          document.querySelector('#pm-material-select') ||
          document.querySelector('#pm-material') ||
          document.querySelector('select[data-lm="material"]') ||
          document.querySelector('#mat-select') ||
          (panel ? qs(panel, 'select') : null);

        const sliderOpacity = 
          document.querySelector('#pm-opacity') ||
          document.querySelector('input[type="range"][data-lm="opacity"]') ||
          document.querySelector('#mat-opacity') ||
          (panel ? qs(panel, 'input[type="range"]') : null);

        const chkDouble = 
          document.querySelector('#pm-double') ||
          document.querySelector('input[type="checkbox"][data-lm="double"]') ||
          document.querySelector('#mat-double');

        const chkUnlit =
          document.querySelector('#pm-unlit') ||
          document.querySelector('input[type="checkbox"][data-lm="unlit"]') ||
          document.querySelector('#mat-unlit');

        if (panel && selMaterial && sliderOpacity) {
          ui = { panel, selMaterial, sliderOpacity, chkDouble, chkUnlit };
          log('ui ok');
          return resolve(ui);
        }
        await sleep(intervalMs);
      }
      reject(new Error('UI controls not found'));
    });
  }

  function materialKeyOf(m) {
    return (m && (m.name || m.uuid || m.id || m.type)) || 'unknown';
  }

  function applyToSceneOpacity(sceneMaterials, key, opacity) {
    let count = 0;
    for (const m of sceneMaterials) {
      const mk = materialKeyOf(m);
      if (mk === key) {
        if (typeof m.opacity === 'number') {
          m.opacity = opacity;
          m.transparent = opacity < 1 ? true : m.transparent;
          if (m.needsUpdate !== undefined) m.needsUpdate = true;
          count++;
        }
      }
    }
    return count;
  }

  function setUISilently(opacity, opts={}) {
    programmaticSet = true;
    if (typeof opacity === 'number' && ui.sliderOpacity) {
      ui.sliderOpacity.value = String(opacity);
    }
    if (ui.chkDouble && typeof opts.doubleSided === 'boolean') {
      ui.chkDouble.checked = !!opts.doubleSided;
    }
    if (ui.chkUnlit && typeof opts.unlit === 'boolean') {
      ui.chkUnlit.checked = !!opts.unlit;
    }
    Promise.resolve().then(()=> programmaticSet = false);
  }

  async function wireOnce() {
    if (wired) return;
    wired = true;
    log('loaded VERSION_TAG:', VERSION_TAG);

    await probeUI().catch(e=>{ wired=false; throw e; });
    await waitForBridges();

    const mats = (vb && vb.listMaterials) ? vb.listMaterials() : [];
    ui.selMaterial.innerHTML = '';
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = '-- Select --';
    ui.selMaterial.appendChild(ph);
    for (const m of mats) {
      const opt = document.createElement('option');
      opt.value = materialKeyOf(m);
      opt.textContent = m.name || materialKeyOf(m);
      ui.selMaterial.appendChild(opt);
    }
    log('panel populated', mats.length, 'materials');

    try {
      const mapOrRows = (await sb.loadAll()) || new Map();
      savedMap = mapOrRows instanceof Map ? mapOrRows : new Map();
      if (!(mapOrRows instanceof Map) && Array.isArray(mapOrRows)) {
        for (const r of mapOrRows) {
          const key = r.materialKey || r.name;
          if (!key) continue;
          const prev = savedMap.get(key);
          if (!prev || String(r.updatedAt||'') > String(prev.updatedAt||'')) savedMap.set(key, r);
        }
      }
    } catch (e) {
      warn('loadAll failed (continue with empty):', e);
      savedMap = new Map();
    }

    function currentSelectionKey() {
      const v = ui.selMaterial.value || '';
      return v;
    }

    function onSelectChanged() {
      const key = currentSelectionKey();
      if (!key) return;
      const row = savedMap.get(key) || null;
      const opacity = row && typeof row.opacity === 'number' ? row.opacity : 1.0;
      const opts = {
        doubleSided: !!(row && (row.doubleSided===1 || row.doubleSided===true)),
        unlit: !!(row && (row.unlit===1 || row.unlit===true)),
      };
      const n = applyToSceneOpacity(vb.listMaterials(), key, opacity);
      log(`opacity ${opacity.toFixed(2)} → "${key}" x${n}`);
      setUISilently(opacity, opts);
    }

    ui.selMaterial.addEventListener('change', onSelectChanged);

    function onOpacityInput() {
      if (programmaticSet) return;
      const key = currentSelectionKey();
      if (!key) return;
      const v = Number(ui.sliderOpacity.value);
      applyToSceneOpacity(vb.listMaterials(), key, v);
    }

    function onOpacityCommit() {
      if (programmaticSet) return;
      const key = currentSelectionKey();
      if (!key) return;
      const v = Number(ui.sliderOpacity.value);
      const row = {
        spreadsheetId: (currentSheetCtx && currentSheetCtx.spreadsheetId) || '',
        sheetGid: (currentSheetCtx && currentSheetCtx.sheetGid) || 0,
        materialKey: key,
        name: key,
        opacity: v,
        updatedAt: new Date().toISOString(),
        updatedBy: 'ui',
        modelKey: (window.viewerBridge && window.viewerBridge.modelKey) || '',
      };
      savedMap.set(key, row);
      throttleSheetUpsert(row);
    }

    ui.sliderOpacity.addEventListener('input', onOpacityInput);
    ui.sliderOpacity.addEventListener('change', onOpacityCommit);
    ui.sliderOpacity.addEventListener('mouseup', onOpacityCommit);
    ui.sliderOpacity.addEventListener('touchend', onOpacityCommit);

    if (ui.selMaterial.options.length > 1) {
      ui.selMaterial.selectedIndex = 1;
      onSelectChanged();
    }

    log('wired panel');
  }

  async function waitForBridges(maxWaitMs = 4000) {
    const t0 = performance.now();
    while (true) {
      const okViewer = !!(vb && vb.listMaterials && vb.getScene);
      const okSheet  = !!(sb && (sb.ready || (sb.loadAll && sb.upsertOne)));
      if (okViewer && okSheet) return;
      if (performance.now() - t0 > maxWaitMs) {
        throw new Error('viewerBridge/materialsSheetBridge not ready');
      }
      await sleep(120);
    }
  }

  window.addEventListener('lm:sheet-context', (e) => {
    currentSheetCtx = e && e.detail || e;
  }, { passive: true });

  window.addEventListener('lm:scene-ready', () => {
    maybeWire();
  }, { once: false });

  document.addEventListener('DOMContentLoaded', () => {
    maybeWire();
  });

  async function maybeWire() {
    try {
      if (wired) return;
      await wireOnce();
    } catch (e) {
      warn('boot failed (will retry automatically)', e);
      setTimeout(maybeWire, 500);
    }
  }

  window.__LM_MAT_ORCH = { maybeWire, VERSION_TAG };
  maybeWire();
})();
