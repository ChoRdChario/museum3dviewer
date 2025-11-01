// LociMyu - material.orchestrator.js
// VERSION_TAG: V6_15f_UI_WAIT_FIX
// Purpose: Ensure strict init order (load saved -> apply scene -> reflect UI -> bind events)
// and make the UI lookup resilient so it doesn't abort when scripts race with DOM build.

(() => {
  const TAG = '[mat-orch]';
  const VERSION_TAG = 'V6_15f_UI_WAIT_FIX';
  console.log(TAG, 'loaded VERSION_TAG:', VERSION_TAG);

  // --------- tiny helpers ---------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Debounce utility
  const debounce = (fn, ms=200) => {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // Safe DOM query with retries; returns an object of found controls
  async function waitForUI(timeoutMs = 10000, pollMs = 120) {
    const t0 = Date.now();
    let lastWarn = 0;

    while (Date.now() - t0 < timeoutMs) {
      // Select candidates with multiple fallback selectors (be permissive)
      const selMaterial = document.querySelector('#pm-material, select[name="pm-material"], [data-lm="pm-material"]');
      // Per-material opacity slider: try several common ids/fallbacks
      const rngOpacity  = document.querySelector(
        '#pm-opacity, #pm-permat-opacity, input[type="range"][name="pm-opacity"], [data-lm="pm-opacity"]'
      );
      // Optional checkboxes (future use; tolerate missing now)
      const chkDouble   = document.querySelector('#pm-double, #pm-doublesided, [data-lm="pm-double"]');
      const chkUnlit    = document.querySelector('#pm-unlit, [data-lm="pm-unlit"]');

      // Detect the material panel container to scope future queries if needed
      const panel = selMaterial?.closest('.card, .panel, section') || document.querySelector('#panel-material, [data-lm="panel-material"]') || document;

      if (selMaterial && rngOpacity) {
        return { panel, selMaterial, rngOpacity, chkDouble, chkUnlit };
      }

      // Emit a throttled warning to avoid log spam
      const now = Date.now();
      if (now - lastWarn > 1200) {
        console.warn(TAG, 'waiting UI...', { hasSelect: !!selMaterial, hasRange: !!rngOpacity });
        lastWarn = now;
      }
      await sleep(pollMs);
    }
    throw new Error('UI controls not found');
  }

  // Event bus guard
  let booted = false;
  let haveScene = false;
  let haveSheet = false;

  // External bridges (assumed to be loaded by index.html in correct order)
  const viewerBridge = window.viewerBridge || {};
  const matSheet     = window.materialsSheetBridge || window.matSheet;

  // cache: latest saved values map materialKey -> value row (latest)
  let savedMap = new Map();

  // Selected state
  let ui = null; // filled by waitForUI()
  let currentMaterial = null;
  let applyingFromLoad = false; // guard to avoid feedback loop on select->apply

  // --------- data normalization ---------
  function normalizeSaved(saved) {
    // Accept Map<string, object>, Array<object>, or plain object map
    const out = new Map();
    if (!saved) return out;

    if (saved instanceof Map) {
      saved.forEach((v, k) => out.set(k, v));
      return out;
    }
    if (Array.isArray(saved)) {
      // pick the last for each materialKey
      for (const row of saved) {
        const k = row.materialKey || row.name || row.key;
        if (!k) continue;
        out.set(k, row); // later rows overwrite earlier => treat as latest
      }
      return out;
    }
    if (typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) out.set(k, v);
      return out;
    }
    return out;
  }

  // --------- scene application ---------
  function applyOpacityToScene(materialKey, value) {
    try {
      if (!viewerBridge || typeof viewerBridge.setMaterialOpacity !== 'function') return;
      viewerBridge.setMaterialOpacity(materialKey, value);
    } catch (e) {
      console.warn(TAG, 'applyOpacityToScene failed', e);
    }
  }

  // Reflect a value to UI without triggering save
  function reflectUIOpacity(value) {
    if (!ui?.rngOpacity) return;
    ui.rngOpacity.value = String(value);
    // if there is a display target (like an output), reflect as well
    const out = ui.panel.querySelector('#pm-opacity-display, [data-lm="pm-opacity-display"]');
    if (out) out.textContent = Number(value).toFixed(2);
  }

  // --------- binding once both scene & sheet are ready ---------
  async function wireOnce() {
    if (booted || !haveScene || !haveSheet) return;
    booted = true;

    // 1) Wait UI (resilient)
    ui = await waitForUI().catch((e) => {
      console.error(TAG, 'UI wait failed:', e);
      throw e;
    });
    console.log(TAG, 'ui ok');

    // 2) Populate material list from scene
    const mats = (typeof viewerBridge.listMaterials === 'function') ? viewerBridge.listMaterials() : [];
    if (Array.isArray(mats)) {
      // Clear options
      ui.selMaterial.innerHTML = '<option value="">— Select material —</option>';
      for (const m of mats) {
        const key = typeof m === 'string' ? m : (m.name || m.materialKey || m.key);
        if (!key) continue;
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = key;
        ui.selMaterial.appendChild(opt);
      }
      console.log(TAG, 'panel populated', mats.length, 'materials');
    }

    // 3) Load saved values FIRST, apply to scene, then reflect UI defaults (do not save here)
    try {
      const loaded = await matSheet.loadAll?.();
      savedMap = normalizeSaved(loaded);
      console.log(TAG, 'savedMap size', savedMap.size);
    } catch (e) {
      console.warn(TAG, 'loadAll failed (continue with empty):', e);
      savedMap = new Map();
    }

    // Helper to compute initial opacity for a material
    const getSavedOpacity = (matKey) => {
      const row = savedMap.get(matKey);
      const v = row && ('opacity' in row) ? Number(row.opacity) : 1.0;
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1.0;
    };

    // If a first option exists (not empty), preselect nothing to avoid accidental overwrite
    ui.selMaterial.value = '';

    // 4) Bind UI events (after saved applied path is set up)
    ui.selMaterial.addEventListener('change', () => {
      const key = ui.selMaterial.value;
      currentMaterial = key || null;
      if (!currentMaterial) return;

      // pull saved value; fall back 1.0; then apply -> reflect UI
      const v = getSavedOpacity(currentMaterial);
      applyingFromLoad = true;
      applyOpacityToScene(currentMaterial, v);
      reflectUIOpacity(v);
      // clear the guard shortly after frame to avoid catching user interactions
      requestAnimationFrame(() => { applyingFromLoad = false; });
    });

    // Opacity slider live preview (no save)
    ui.rngOpacity.addEventListener('input', () => {
      if (!currentMaterial) return;
      const v = Number(ui.rngOpacity.value);
      applyOpacityToScene(currentMaterial, v);
    });

    // Debounced save on change/pointerup
    const persistDebounced = debounce(async () => {
      if (!currentMaterial) return;
      if (applyingFromLoad) return; // ignore reflections
      const v = Number(ui.rngOpacity.value);
      // prepare row
      const row = {
        materialKey: currentMaterial,
        name: currentMaterial,
        opacity: v,
        updatedAt: new Date().toISOString(),
        updatedBy: 'ui',
        sheetGid: (window.__lm_sheet_context && window.__lm_sheet_context.sheetGid) || 0,
        modelKey: (window.__lm_model_key) || '',
      };
      try {
        await matSheet.upsertOne?.(row);
        // update local cache so subsequent selects see latest
        savedMap.set(currentMaterial, row);
        console.log(TAG, 'persisted to sheet:', currentMaterial, v.toFixed(2));
      } catch (e) {
        console.warn(TAG, 'upsertOne failed', e);
      }
    }, 220);

    const saveEvents = ['change', 'pointerup'];
    for (const ev of saveEvents) {
      ui.rngOpacity.addEventListener(ev, persistDebounced);
    }

    console.log(TAG, 'wired panel');
  }

  // --------- listen external readiness ---------
  window.addEventListener('lm:scene-ready', () => {
    haveScene = true;
    wireOnce();
  }, { once: false });

  window.addEventListener('lm:sheet-context', (ev) => {
    // store for upserts; and mark ready
    try {
      window.__lm_sheet_context = ev?.detail || ev; // keep around for upsert row
    } catch {}
    haveSheet = true;
    wireOnce();
  }, { once: false });

  // In case both are already ready by the time this file loads, try a delayed kick
  setTimeout(() => wireOnce(), 1500);
})();
