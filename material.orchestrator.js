
// material.orchestrator.js
// LociMyu v6.x — Material UI Orchestrator (patched full file)
// Order-sensitive: this module assumes viewer.bridge.module.js and materials.sheet.bridge.js are loaded first.
// VERSION TAG:
const __MAT_ORCH_VERSION_TAG__ = 'V6_16_UI_SYNC_PREAPPLY';

(() => {
  console.log('[mat-orch] loaded VERSION_TAG:', __MAT_ORCH_VERSION_TAG__);

  // ---------- Utilities ----------
  const $ = (sel) => document.querySelector(sel);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  function throttle(fn, wait) {
    let t = 0, lastArgs = null, scheduled = False;
    return (...args) => {
      lastArgs = args;
      const now = Date.now();
      const fire = () => { scheduled = false; t = Date.now(); fn(...lastArgs); };
      if (!scheduled) {
        const delay = Math.max(0, wait - (now - t));
        scheduled = true;
        setTimeout(fire, delay);
      }
    };
  }

  function waitForEventOnce(eventName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const handler = (ev) => {
        cleanup();
        resolve(ev);
      };
      const cleanup = () => {
        window.removeEventListener(eventName, handler);
        if (timer) clearTimeout(timer);
      };
      window.addEventListener(eventName, handler, { once: true });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`waitForEventOnce timeout: ${eventName}`));
      }, timeoutMs);
    });
  }

  async function waitForUI(timeoutMs = 4000) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const ok = el.materialSelect && el.opacityRange && el.opacityOut;
      if (ok) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('UI controls not found');
  }

  async function waitReadyBridges(timeoutMs = 6000) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const vb = window.viewerBridge;
      const sb = window.materialsSheetBridge;
      const vbOk = vb && typeof vb.listMaterials === 'function';
      const sbOk = sb && typeof sb.loadAll === 'function' && typeof sb.upsertOne === 'function';
      if (vbOk && sbOk) return { vb, sb };
      await new Promise(r => setTimeout(r, 80));
    }
    throw new Error('viewerBridge/materialsSheetBridge not ready');
  }

  // ---------- DOM refs ----------
  const el = {
    materialSelect: $('#pm-material'),
    opacityRange  : $('#pm-opacity-range'),
    opacityOut    : $('#pm-opacity-val'),
    flagDouble    : $('#pm-flag-doublesided'),
    flagUnlit     : $('#pm-flag-unlit'),
    // future: chroma controls etc.
  };

  // ---------- In-memory state ----------
  let stateByMat = new Map();  // materialKey -> { opacity, doubleSided, unlit, ... }
  let syncingUI  = false;      // guard to avoid UI -> scene write during programmatic sync
  let wiredOnce  = false;

  function normalizeRowsToStateMap(rows) {
    // rows: array of append-only entries. Last one wins per materialKey.
    const m = new Map();
    if (!Array.isArray(rows)) return m;
    for (const r of rows) {
      const k = r.materialKey || r.name || r.key;
      if (!k) continue;
      m.set(k, {
        opacity     : r.opacity != null ? Number(r.opacity) : 1,
        doubleSided : !!r.doubleSided,
        unlit       : !!r.unlit,
        // extend here (chroma, etc.)
      });
    }
    return m;
  }

  async function applyAndSyncUI(materialKey, viewerBridge) {
    const s = stateByMat.get(materialKey) || { opacity: 1, doubleSided: false, unlit: false };
    // 1) Scene first
    try {
      viewerBridge?.setMaterialOpacity?.(materialKey, s.opacity);
      viewerBridge?.setMaterialFlags?.(materialKey, { doubleSided: !!s.doubleSided, unlit: !!s.unlit });
    } catch (e) {
      console.warn('[mat-orch] scene apply failed', e);
    }

    // 2) UI sync (guard events)
    syncingUI = true;
    try {
      if (el.opacityRange) {
        el.opacityRange.value = String(s.opacity);
        if (el.opacityOut) el.opacityOut.value = (+s.opacity).toFixed(2);
      }
      if (el.flagDouble) el.flagDouble.checked = !!s.doubleSided;
      if (el.flagUnlit)  el.flagUnlit.checked  = !!s.unlit;
    } finally {
      setTimeout(() => { syncingUI = false; }, 0);
    }
  }

  function wireUIEvents(viewerBridge, materialsSheetBridge, getCurrentKey) {
    const persist = throttle(async (k, partial) => {
      const cur = stateByMat.get(k) || {};
      const next = { ...cur, ...partial };
      stateByMat.set(k, next);
      try {
        await materialsSheetBridge.upsertOne({ materialKey: k, ...next });
        console.log('[mat-orch] persisted to sheet:', k);
      } catch (e) {
        console.warn('[mat-orch] upsertOne failed', e);
      }
    }, 250);

    on(el.opacityRange, 'input', () => {
      if (syncingUI) return;
      const k = getCurrentKey();
      if (!k) return;
      const v = Number(el.opacityRange.value);
      try {
        viewerBridge?.setMaterialOpacity?.(k, v);
        if (el.opacityOut) el.opacityOut.value = v.toFixed(2);
      } finally {
        persist(k, { opacity: v });
      }
    });

    on(el.flagDouble, 'change', () => {
      if (syncingUI) return;
      const k = getCurrentKey();
      if (!k) return;
      const v = !!el.flagDouble.checked;
      try {
        viewerBridge?.setMaterialFlags?.(k, { doubleSided: v, unlit: !!(el.flagUnlit?.checked) });
      } finally {
        persist(k, { doubleSided: v });
      }
    });

    on(el.flagUnlit, 'change', () => {
      if (syncingUI) return;
      const k = getCurrentKey();
      if (!k) return;
      const v = !!el.flagUnlit.checked;
      try {
        viewerBridge?.setMaterialFlags?.(k, { doubleSided: !!(el.flagDouble?.checked), unlit: v });
      } finally {
        persist(k, { unlit: v });
      }
    });
  }

  async function wireOnce(viewerBridge, materialsSheetBridge) {
    if (wiredOnce) return;
    wiredOnce = true;

    // 1) Populate material select from scene
    const mats = (viewerBridge?.listMaterials?.() || []);
    const sel  = el.materialSelect;
    if (!sel) throw new Error('material <select> missing');
    sel.innerHTML = '<option value="">— Select —</option>';
    for (const m of mats) {
      const key = m.key || m.name;
      const text = m.name || m.key || '(unnamed)';
      if (!key) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = text;
      sel.appendChild(opt);
    }
    console.log('[mat-orch] panel populated', mats.length, 'materials');

    // 2) Load saved rows from sheet → normalize to Map
    try {
      const rows = await materialsSheetBridge.loadAll();
      stateByMat = normalizeRowsToStateMap(rows);
    } catch (e) {
      console.warn('[mat-orch] loadAll failed (continue with empty):', e);
      stateByMat = new Map();
    }

    // 3) Select change = apply saved state to scene and sync UI
    on(sel, 'change', () => {
      const k = sel.value || '';
      if (!k) return;
      applyAndSyncUI(k, viewerBridge);
    });

    // 4) Bind UI events (last, to avoid firing during initial sync)
    wireUIEvents(viewerBridge, materialsSheetBridge, () => sel.value || '');

    console.log('[mat-orch] wired panel');
  }

  // ---------- Boot sequence ----------
  async function boot() {
    try {
      await waitForUI(3500);
      console.log('[mat-orch] ui ok');
    } catch (e) {
      console.warn('[mat-orch] boot failed (will retry automatically) Error:', e);
      scheduleRetry();
      return;
    }

    let vb, sb;
    try {
      ({ vb, sb } = await waitReadyBridges(6000));
    } catch (e) {
      console.warn('[mat-orch] boot failed (will retry automatically) Error:', e);
      scheduleRetry();
      return;
    }

    // Wait scene-ready if viewer exposes event. If scene already ready, skip.
    const needScene = !(vb?.getScene?.()); // if getScene exists and returns something, assume ready
    if (needScene) {
      try {
        await waitForEventOnce('lm:scene-ready', 6000);
      } catch (e) {
        console.warn('[mat-orch] boot failed (will retry automatically) Error:', e);
        scheduleRetry();
        return;
      }
    }

    try {
      await wireOnce(vb, sb);
    } catch (e) {
      console.warn('[mat-orch] boot failed (will retry automatically) Error:', e);
      scheduleRetry();
      return;
    }
  }

  let retryTimer = null;
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      boot();
    }, 500);
  }

  // Start
  // Kick once now, and also re-kick when scene or sheet context changes.
  boot();
  window.addEventListener('lm:scene-ready', () => {
    // Try to wire if not wired yet
    if (!wiredOnce) boot();
  }, { passive: true });

  // sheet-context can change when user switches gid, etc.
  window.addEventListener('lm:sheet-context', () => {
    // We don't auto rewire to avoid duplicate handlers;
    // but if boot had failed previously because sheet wasn't ready yet, try again.
    if (!wiredOnce) boot();
  }, { passive: true });

  // Expose for debugging
  window.__mat_orch__ = {
    version: __MAT_ORCH_VERSION_TAG__,
    get stateByMat() { return stateByMat; },
    forceRewire: () => { wiredOnce = false; boot(); },
  };
})();
