/* LociMyu: material.orchestrator.js
 * Version: A3.4_RACE_FIX
 * Goal:
 *  - Eliminate race between UI mount and scene readiness.
 *  - Never give up early; retry until both (UI select + GLB materials) are ready.
 *  - Populate select using traverse() fallback (listMaterials optional).
 *  - Guard against double-boot when the script is accidentally included twice.
 */

(() => {
  // --- double-run guard -----------------------------------------------------
  if (window.__LM_MAT_ORCH__) {
    console.warn('[mat-orch] already running; skip second boot');
    return;
  }
  window.__LM_MAT_ORCH__ = { version: 'A3.4_RACE_FIX' };
  window.HOTFIX_BIND_MATERIALS = 'A3.4';

  const LOG_PREFIX = '[mat-orch]';
  const log  = (...a) => console.log(LOG_PREFIX, ...a);
  const warn = (...a) => console.warn(LOG_PREFIX, ...a);
  const err  = (...a) => console.error(LOG_PREFIX, ...a);

  log('boot', window.__LM_MAT_ORCH__.version);

  // --- utilities ------------------------------------------------------------
  const getBridge = () =>
    window.__LM_VIEWER_BRIDGE__ || window.LM_VIEWER_BRIDGE || window.viewerBridge || null;

  const getScene = () => {
    const br = getBridge();
    try { return br && typeof br.getScene === 'function' ? br.getScene() : null; }
    catch { return null; }
  };

  const findSelect = () =>
    document.querySelector('#pm-material, select[aria-label="Select material"], #materialSelect, #mat-select, #matKeySelect, select[name*="material"], select[id*="material"]');

  const isVisible = (el) =>
    !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');

  const unique = (arr) => Array.from(new Set(arr));

  // collect GLB materials via traverse (overlay/basic unnamed filtered out)
  const collectMaterialsFromScene = (scene) => {
    const out = [];
    const seen = new Set();
    if (!scene || typeof scene.traverse !== 'function') return out;
    scene.traverse((obj) => {
      if (!obj || !obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m, i) => {
        if (!m) return;
        const rawName = (m.name || '').trim();
        if (m.type === 'MeshBasicMaterial' && !rawName) return; // overlay etc.
        const key = m.uuid || m.id || rawName || `${obj.uuid}:${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const label = rawName || (obj.name ? `${obj.name} (${m.type || 'Material'})` : (m.type || 'Material'));
        out.push({ key, label });
      });
    });
    return out;
  };

  // optional: listMaterials if available
  const listMaterials = async () => {
    try {
      const br = getBridge();
      if (!br || typeof br.listMaterials !== 'function') return [];
      const mats = await br.listMaterials();
      if (!Array.isArray(mats)) return [];
      return unique(mats.map((m) => (m?.name || m?.uuid || m?.id)).filter(Boolean)).map((k) => ({ key: k, label: String(k) }));
    } catch {
      return [];
    }
  };

  const populateSelect = (sel, rows) => {
    if (!sel || !rows?.length) return false;
    // Preserve a leading placeholder if present
    const first = sel.options[0];
    const keepPlaceholder = first && /select material/i.test(first.textContent || '');

    // Clear and add
    sel.innerHTML = '';
    if (keepPlaceholder) {
      const ph = document.createElement('option');
      ph.textContent = first.textContent;
      ph.value = '';
      sel.appendChild(ph);
    }
    const frag = document.createDocumentFragment();
    rows.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.key;
      opt.textContent = r.label || r.key;
      frag.appendChild(opt);
    });
    sel.appendChild(frag);
    log('bound', rows.length, 'materials → select');
    return true;
  };

  // --- orchestrate with retries --------------------------------------------
  let bound = false;
  const MAX_MS = 8000;
  const START = performance.now();

  const tryBindOnce = async (reason) => {
    if (bound) return;
    const sel = findSelect();
    const scene = getScene();
    if (!sel || !isVisible(sel)) {
      log('wait UI…', reason || '');
      return;
    }
    if (!scene || typeof scene.traverse !== 'function') {
      log('wait scene…', reason || '');
      return;
    }

    // Prefer traverse-based list; fall back to listMaterials
    let rows = collectMaterialsFromScene(scene);
    if (!rows.length) {
      const listed = await listMaterials();
      // listMaterials can return keys only; leave labels same as key
      rows = listed;
    }

    if (!rows.length) {
      log('no GLB materials yet; retry…', reason || '');
      return;
    }

    if (populateSelect(sel, rows)) {
      bound = true;
      window.__LM_MAT_ORCH__.bound = true;
    }
  };

  // scene-ready event hook (from bridge)
  const installSceneReadyHook = () => {
    // Hook common custom events defensively
    const onSceneReady = () => tryBindOnce('event:scene-ready');
    window.addEventListener('lm:scene-ready', onSceneReady, { passive: true });
    // As some builds dispatch on document:
    document.addEventListener('lm:scene-ready', onSceneReady, { passive: true });

    // Also attempt shortly after boot (common case where scene stabilizes just after boot)
    setTimeout(() => tryBindOnce('t+300'), 300);
  };

  // polling fallback to cover any missed events
  const interval = setInterval(async () => {
    if (bound) { clearInterval(interval); return; }
    const elapsed = performance.now() - START;
    if (elapsed > MAX_MS) {
      clearInterval(interval);
      warn('timeout without binding (UI/scene/materials not simultaneously ready)');
      return;
    }
    await tryBindOnce('poll');
  }, 250);

  // start
  installSceneReadyHook();
})();
