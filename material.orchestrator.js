
/**
 * material.orchestrator.js (patched)
 * Safe UI pipeline: selection restores settings (no writes),
 * user edits apply to scene and save (debounced) only when changed.
 *
 * Version: V6_16h_SAFE_UI_PIPELINE.A3.glbOnly+sheetReflect
 */
(function () {
  const TAG = '[mat-orch]';
  console.log(TAG, 'A3 boot');

  // --------- State ---------
  let ui = null;
  let sheetCtx = null;
  let currentKey = null;
  let suspendUI = false;  // true while we are programmatically updating inputs
  let dirty = false;
  let loadToken = 0;      // to defeat out-of-order async

  // Guards
  const g = {
    sceneReady: false,
    uiReady: false,
  };

  // --------- Utils ---------
  const $ = (sel) => document.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn, { passive: true });
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function debounce(fn, ms) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Access to bridges
  const viewerBridge =
    window.__LM_VIEWER_BRIDGE__ || window.LM_VIEWER_BRIDGE || window.viewerBridge || null;
  const matSheet = window.materialsSheetBridge || (window.__LM && window.__LM.materialsSheetBridge) || null;

  // --------- UI bootstrap ---------
  function findUI() {
    const select = $('#materialSelect,#mat-select,#matKeySelect');
    const opacity = $('#opacityRange,#matOpacity');
    const doubleSided = $('#doubleSided,#matDoubleSided');
    const unlit = $('#unlit,#matUnlit');
    if (select && opacity && doubleSided && unlit) {
      return { select, opacity, doubleSided, unlit };
    }
    return null;
  }

  function disableControls(disabled) {
    if (!ui) return;
    ui.select.disabled = !!disabled;
    ui.opacity.disabled = !!disabled;
    ui.doubleSided.disabled = !!disabled;
    ui.unlit.disabled = !!disabled;
  }

  // --------- Scene helpers ---------
  function getScene() {
    if (!viewerBridge || typeof viewerBridge.getScene !== 'function') return null;
    try { return viewerBridge.getScene(); } catch { return null; }
  }

  function collectGLBMaterials(scene) {
    // Build unique list of materials coming from GLB (heuristics):
    // - Mesh only (skip Sprites/Lines/Points)
    // - Exclude MeshBasicMaterial with empty name (likely overlay)
    // - Key is uuid (fallback to name), label is name or mesh+type
    const list = [];
    const seen = new Set();
    scene.traverse((obj) => {
      if (!obj || !obj.isMesh) return;
      if (obj.isSprite || obj.isPoints || obj.isLine) return;
      const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
      arr.forEach((m, i) => {
        if (!m) return;
        const rawName = (m.name || '').trim();
        const isOverlayBasic = (m.type === 'MeshBasicMaterial' && !rawName);
        if (isOverlayBasic) return; // exclude generated overlay mats
        const key = m.uuid || rawName || `${obj.uuid}:${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const label = rawName || (obj.name ? `${obj.name} (${m.type || 'Material'})` : `${m.type || 'Material'} ${i+1}`);
        list.push({
          key,
          label,
          uuid: m.uuid || null,
          name: rawName || null,
          mesh: obj.name || null,
          type: m.type || null,
        });
      });
    });
    // Sort for stability
    list.sort((a,b) => (a.label||'').localeCompare(b.label||'') || (a.mesh||'').localeCompare(b.mesh||''));
    return list;
  }

  function getMaterialByKey(scene, key) {
    let found = null;
    scene.traverse((obj) => {
      if (found || !obj || !obj.isMesh) return;
      const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of arr) {
        if (!m) continue;
        const k = m.uuid || m.name || null;
        if (k && String(k) === String(key)) { found = m; break; }
      }
    });
    return found;
  }

  // --------- Sheet helpers ---------
  // Each row schema (expected):
  // { materialKey, opacity, doubleSided, unlit, updatedAt, updatedBy, ... }
  async function loadRowFor(key) {
    if (!matSheet || typeof matSheet.loadAll !== 'function') return null;
    try {
      const map = await matSheet.loadAll(); // Map<key, row> or object
      if (!map) return null;
      return map.get ? map.get(key) : map[key] || null;
    } catch (e) {
      console.warn(TAG, 'loadRowFor error', e);
      return null;
    }
  }

  async function saveRow(partial) {
    if (!matSheet || typeof matSheet.upsertOne !== 'function') return;
    try {
      await matSheet.upsertOne(partial);
    } catch (e) {
      console.warn(TAG, 'upsertOne error', e);
    }
  }

  // --------- UI reflect from row (no write) ---------
  function reflectToUI(row, matObj) {
    if (!ui) return;
    suspendUI = true;
    try {
      if (row && typeof row.opacity === 'number') {
        ui.opacity.value = String(clamp01(row.opacity));
      } else if (matObj && typeof matObj.opacity === 'number') {
        ui.opacity.value = String(clamp01(matObj.opacity));
      }
      if (row && typeof row.doubleSided === 'boolean') {
        ui.doubleSided.checked = !!row.doubleSided;
      } else if (matObj && typeof matObj.side !== 'undefined') {
        // THREE: DoubleSide === 2
        ui.doubleSided.checked = (matObj.side === 2);
      }
      if (row && typeof row.unlit === 'boolean') {
        ui.unlit.checked = !!row.unlit;
      } else if (matObj && typeof matObj.isMeshBasicMaterial === 'boolean') {
        ui.unlit.checked = !!matObj.isMeshBasicMaterial;
      }
    } finally {
      suspendUI = false;
    }
  }

  // --------- Apply to scene (no save) ---------
  function applyToScene(matObj, values) {
    if (!matObj || !values) return;
    if (typeof values.opacity === 'number' && matObj.opacity !== values.opacity) {
      matObj.opacity = clamp01(values.opacity);
      matObj.transparent = matObj.opacity < 1 ? true : matObj.transparent;
      matObj.needsUpdate = true;
    }
    if (typeof values.doubleSided === 'boolean') {
      const DoubleSide = (window.THREE && window.THREE.DoubleSide) || 2;
      const newSide = values.doubleSided ? DoubleSide : (matObj.side || 0);
      if (matObj.side !== newSide) {
        matObj.side = newSide;
        matObj.needsUpdate = true;
      }
    }
    // Unlit toggle requires material swap in general; here we only reflect checkbox,
    // actual implementation may be a no-op unless you have a swapper. Keep as-is.
  }

  // --------- Select -> UI reflect (no saves) ---------
  async function onSelectMaterial(key){
    if(!key){
      currentKey = null;
      return;
    }
    currentKey = key;
    dirty = false;
    const token = ++loadToken;
    suspendUI = true;
    disableControls(true);

    try {
      const scene = getScene();
      const matObj = scene ? getMaterialByKey(scene, key) : null;
      const row = await loadRowFor(key);
      if (token !== loadToken) return; // out-of-order protection
      // Reflect row (or mat defaults) to UI
      reflectToUI(row, matObj);
    } finally {
      suspendUI = false;
      disableControls(false);
    }
  }

  // --------- Edit handlers (apply + debounce-save) ---------
  const debouncedSave = debounce(async () => {
    if (!currentKey || !dirty) return;
    const scene = getScene();
    const matObj = scene ? getMaterialByKey(scene, currentKey) : null;
    if (!matObj) return;

    const row = {
      materialKey: currentKey,
      opacity: Number(ui.opacity.value),
      doubleSided: !!ui.doubleSided.checked,
      unlit: !!ui.unlit.checked,
      updatedAt: new Date().toISOString(),
    };
    await saveRow(row);
    dirty = false;
    console.log(TAG, 'saved', row);
  }, 500);

  function wireInputs(){
    if (!ui) return;
    on(ui.select, 'change', (e) => onSelectMaterial(e.target.value));

    const markAndApply = () => {
      if (suspendUI || !currentKey) return;
      dirty = true;
      const scene = getScene();
      const matObj = scene ? getMaterialByKey(scene, currentKey) : null;
      if (matObj) {
        applyToScene(matObj, {
          opacity: Number(ui.opacity.value),
          doubleSided: !!ui.doubleSided.checked,
          unlit: !!ui.unlit.checked,
        });
      }
      debouncedSave();
    };

    on(ui.opacity, 'input', markAndApply);
    on(ui.doubleSided, 'change', markAndApply);
    on(ui.unlit, 'change', markAndApply);
  }

  // --------- Populate material list ---------
  function populateSelect(list){
    if (!ui || !ui.select) return;
    const sel = ui.select;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select material —';
    sel.appendChild(opt0);
    list.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.uuid || r.key;
      opt.textContent = r.label || r.name || r.uuid || r.key;
      sel.appendChild(opt);
    });
  }

  async function refreshMaterials(){
    const scene = getScene();
    if (!scene || typeof scene.traverse !== 'function') return;
    const list = collectGLBMaterials(scene);
    if (!list.length) return;
    populateSelect(list);
    console.log(TAG, 'material list (GLB-only)', list.map(x => x.label));
  }

  // --------- Boot loop ---------
  function boot(){
    // 1) wait UI
    if (!ui) {
      ui = findUI();
      if (!ui) {
        console.log(TAG, 'UI still not found; keep idle');
        return;
      }
      wireInputs();
    }
    // 2) wait scene ready (viewer-bridge will dispatch lm:scene-ready)
    if (!g.sceneReady) return;
    // 3) once ready, refresh list once
    refreshMaterials();
  }

  // --------- Scene ready hook ---------
  window.addEventListener('lm:scene-ready', () => {
    g.sceneReady = true;
    console.log(TAG, 'scene-ready observed');
    // run once right after scene
    setTimeout(boot, 0);
  }, { once: true });

  // Safety: if scene already ready in bridge (late attach)
  try {
    if (viewerBridge && typeof viewerBridge.getScene === 'function') {
      const sc = viewerBridge.getScene();
      if (sc) {
        g.sceneReady = true;
      }
    }
  } catch {}

  // --------- Tick ---------
  setInterval(boot, 250);
})();
