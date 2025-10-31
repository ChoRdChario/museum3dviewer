// material.orchestrator.js — V6_15e_INIT_ORDER_FIX
// Ensures correct init order: (load saved -> apply to scene -> reflect to UI -> bind)
(() => {
  const TAG = 'V6_15e_INIT_ORDER_FIX';
  console.log('[mat-orch] loaded VERSION_TAG:', TAG);

  // --- Guards & shared state ---
  let gotScene = false;
  let gotSheet = false;
  let wired = false;

  let ctx = { spreadsheetId: null, sheetGid: null };
  let ui = null; // {global, sel, perOpacity, dbl, unlit}

  // --- helpers ---
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const qs = (id) => document.getElementById(id);

  async function waitForDOMContentReady() {
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }
  }

  async function waitForUI(maxTries = 60, intervalMs = 100) {
    for (let i = 0; i < maxTries; i++) {
      const u = {
        global: qs('pm-global'),
        sel: qs('pm-material'),
        perOpacity: qs('pm-material-opacity'),
        dbl: qs('pm-double'),
        unlit: qs('pm-unlit'),
      };
      if (u.global && u.sel && u.perOpacity) return u;
      await sleep(intervalMs);
    }
    throw new Error('UI controls not found');
  }

  function normalizeSavedMap(saved) {
    // Accept Map, Array of rows, or plain object keyed by materialKey
    if (!saved) return new Map();
    if (saved instanceof Map) return saved;
    const m = new Map();
    if (Array.isArray(saved)) {
      for (const row of saved) {
        if (!row) continue;
        const key = row.materialKey || row.name || row.key;
        if (!key) continue;
        m.set(key, row); // last wins
      }
      return m;
    }
    if (typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) m.set(k, v);
      return m;
    }
    return new Map();
  }

  // --- wire ---
  async function boot() {
    try {
      await waitForDOMContentReady();
      ui = await waitForUI();
      console.log('[mat-orch] ui ok');

      window.addEventListener('lm:scene-ready', () => { gotScene = true; tryWire(); });
      window.addEventListener('lm:sheet-context', (e) => {
        const d = e && e.detail || {};
        if (d.spreadsheetId) {
          ctx.spreadsheetId = d.spreadsheetId;
          ctx.sheetGid = d.sheetGid;
          gotSheet = true;
        }
        tryWire();
      });
    } catch (err) {
      console.warn('[mat-orch] UI controls not found (abort)', err);
    }
  }

  async function tryWire() {
    if (wired || !gotScene || !gotSheet || !ui) return;
    wired = true;
    await wireOnce();
  }

  async function wireOnce() {
    // Safety: required bridges
    const viewerBridge = window.viewerBridge;
    const matSheet = window.matSheet;
    if (!viewerBridge || !viewerBridge.listMaterials || !viewerBridge.setMaterialOpacity) {
      console.error('[mat-orch] viewerBridge missing or incomplete');
      return;
    }
    if (!matSheet || !matSheet.loadAll || !matSheet.upsertOne) {
      console.error('[mat-orch] matSheet bridge missing or incomplete');
      return;
    }

    // 1) populate dropdown from scene
    const mats = await viewerBridge.listMaterials();
    ui.sel.replaceChildren();
    // placeholder
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = '— Select material —';
    ui.sel.appendChild(ph);
    for (const name of mats) {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      ui.sel.appendChild(o);
    }
    console.log('[mat-orch] panel populated', mats.length, 'materials');

    // 2) read all saved rows first
    let savedMap = normalizeSavedMap(await matSheet.loadAll(ctx));

    // apply saved opacity to scene before binding UI
    for (const name of mats) {
      const row = savedMap.get(name);
      if (row && typeof row.opacity === 'number' && !Number.isNaN(row.opacity)) {
        try { viewerBridge.setMaterialOpacity(name, row.opacity); } catch {}
      }
    }

    // initial UI (no selection)
    ui.sel.value = '';
    // keep default at 1.0 if provided otherwise current value
    const defaultVal = ui.perOpacity.defaultValue || '1.0';
    ui.perOpacity.value = String(defaultVal);

    // 3) bind events
    bindEvents(savedMap);
  }

  function bindEvents(savedMap) {
    const viewerBridge = window.viewerBridge;
    const matSheet = window.matSheet;
    let saveTimer = null;

    // Selecting a material should reflect its saved value both to scene and UI (without triggering persistence)
    ui.sel.addEventListener('change', () => {
      const key = ui.sel.value;
      if (!key) return;

      const row = savedMap.get(key);
      const op = (row && typeof row.opacity === 'number' && !Number.isNaN(row.opacity)) ? row.opacity : 1.0;

      // 1) scene first
      try { viewerBridge.setMaterialOpacity(key, op); } catch {}
      // 2) then UI without emitting synthetic events
      ui.perOpacity.value = String(op);
      // no persist here
      console.log('[mat-orch] applied saved opacity', op, 'to', key);
    });

    // Live preview on input
    ui.perOpacity.addEventListener('input', () => {
      const key = ui.sel.value; if (!key) return;
      const val = Number(ui.perOpacity.value);
      if (Number.isNaN(val)) return;
      try { viewerBridge.setMaterialOpacity(key, val); } catch {}
    });

    // Persist on change/pointerup with debounce and diff check
    const schedulePersist = () => {
      const key = ui.sel.value; if (!key) return;
      const val = Number(ui.perOpacity.value);
      if (Number.isNaN(val)) return;
      const prev = savedMap.get(key)?.opacity;
      if (prev === val) return; // no-op

      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          await matSheet.upsertOne(ctx, {
            materialKey: key,
            name: key,
            opacity: val,
            updatedAt: new Date().toISOString(),
            updatedBy: 'ui',
            sheetGid: Number(ctx.sheetGid) || 0,
            modelKey: (window.viewerBridge && window.viewerBridge.getModelKey && window.viewerBridge.getModelKey()) || ''
          });
          savedMap.set(key, { ...(savedMap.get(key) || {}), opacity: val });
          console.log('[mat-orch] persisted to sheet:', key, val);
        } catch (e) {
          console.warn('[mat-orch] persist failed', e);
        }
      }, 200);
    };

    ui.perOpacity.addEventListener('change', schedulePersist);
    ui.perOpacity.addEventListener('pointerup', schedulePersist);
  }

  boot();
})();
