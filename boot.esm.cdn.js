
/*! LociMyu ESM/CDN — SAFE MODE (UI-first)
 * - No overlays, no global event interception
 * - Only reads existing UI and scene, wires listeners passively
 * - Optionally populates material list when a scene is present
 * - Sheets write kept minimal & throttled and only if token + ssid exist
 */
(() => {
  const TAG = '[materials-safe]';

  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // ---------- helpers
  const onDomReady = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true, passive: true });
    } else {
      queueMicrotask(fn);
    }
  };

  const getScene = () =>
    (window.gltfScene) ||
    (window.viewer && (window.viewer.gltfScene || window.viewer.scene)) ||
    (window.scene) ||
    null;

  const unique = (arr) => Array.from(new Set(arr));

  const readUI = () => {
    const sel = document.getElementById('mat-target');
    return {
      materialKey: sel?.value || 'GLOBAL',
      unlit: !!document.getElementById('mat-unlit')?.checked,
      doubleSided: !!document.getElementById('mat-doubleside')?.checked,
      opacity: Number(document.getElementById('mat-opacity')?.value ?? 1),
      white2alpha: !!document.getElementById('mat-white2alpha')?.checked,
      whiteThr: Number(document.getElementById('mat-white-thr')?.value ?? 0.92),
      black2alpha: !!document.getElementById('mat-black2alpha')?.checked,
      blackThr: Number(document.getElementById('mat-black-thr')?.value ?? 0.08),
    };
  };

  // ---------- target drop-down population (non-blocking, no overlays)
  const collectMaterialKeys = () => {
    const scene = getScene();
    if (!scene) return [];
    const keys = ['GLOBAL'];
    scene.traverse((obj) => {
      if (!obj || !obj.isMesh || !obj.material) return;
      const meshName = obj.name || 'Mesh';
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        const mName = (m && m.name) ? m.name : 'Material';
        keys.push(`${meshName}/${mName}`);
      });
    });
    return unique(keys);
  };

  const populateTarget = () => {
    const sel = document.getElementById('mat-target');
    if (!sel) return;
    const keys = collectMaterialKeys();
    if (!keys.length) return;

    // keep current selection if still exists
    const current = sel.value;
    // build an index of existing to avoid thrash
    const existing = new Map(Array.from(sel.options).map(o => [o.value, o]));

    // Remove options that no longer exist (except GLOBAL)
    Array.from(sel.options).forEach((opt) => {
      if (opt.value === 'GLOBAL') return;
      if (!keys.includes(opt.value)) opt.remove();
    });

    // Add missing
    keys.forEach((k) => {
      if (!existing.has(k)) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = (k === 'GLOBAL') ? 'GLOBAL — All Meshes' : k;
        sel.appendChild(opt);
      } else {
        // normalize label if needed
        const o = existing.get(k);
        if (o && o.textContent !== ((k === 'GLOBAL') ? 'GLOBAL — All Meshes' : k)) {
          o.textContent = (k === 'GLOBAL') ? 'GLOBAL — All Meshes' : k;
        }
      }
    });

    if (current && keys.includes(current)) {
      sel.value = current;
    } else {
      sel.value = 'GLOBAL';
    }

    log('populate target ready', { count: keys.length });
  };

  // ---------- UI wiring (passive)
  const wireUI = () => {
    const applyNow = () => {
      const s = readUI();
      // emit event only; leave actual rendering to existing code
      window.dispatchEvent(new CustomEvent('materials:apply', {
        detail: { materialKey: s.materialKey, settings: s }
      }));
      if (typeof window.materialsApplyHook === 'function') {
        try { window.materialsApplyHook({ materialKey: s.materialKey, settings: s }); } catch(e) {}
      }
    };

    const ids = ['mat-unlit','mat-doubleside','mat-opacity','mat-white2alpha','mat-white-thr','mat-black2alpha','mat-black-thr','mat-target'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = (el.tagName === 'INPUT' && el.type === 'range') ? 'input'
                : (el.tagName === 'INPUT' ? 'change'
                : 'change');
      el.addEventListener(evt, applyNow, { passive: true });
    });

    // first apply with a small delay to ensure scene hookup code can attach
    setTimeout(applyNow, 50);
    log('ui wired');
  };

  // ---------- Sheets (optional, safe)
  const gapiFetch = async (url, init={}) => {
    if (!window.getAccessToken) return { ok:false, status:0 };
    const token = await window.getAccessToken();
    if (!token) return { ok:false, status:401 };
    const r = await fetch(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        ...(init.headers||{})
      }
    });
    return r;
  };

  const ensureMaterialsHead = async (ssid) => {
    try {
      const q = encodeURIComponent('materials!A1:K1');
      const r = await gapiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${q}?majorDimension=ROWS`);
      if (r && r.ok) return true;
      // put header
      const body = {
        range: 'materials!A1:K1',
        majorDimension: 'ROWS',
        values: [[
          'sheetId','materialKey','unlit','doubleSided','opacity','white2alpha','whiteThr','black2alpha','blackThr','updatedAt','updatedBy'
        ]]
      };
      await gapiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/materials!A1:K1?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      return true;
    } catch(e) {
      return false;
    }
  };

  // Debounced upsert (very conservative)
  let saveTimer = null;
  const scheduleSave = (ssid, gid) => {
    if (!ssid) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const s = readUI();
      const row = [
        Number(gid||0),
        s.materialKey,
        s.unlit?1:0,
        s.doubleSided?1:0,
        Number.isFinite(s.opacity)?s.opacity:1,
        s.white2alpha?1:0,
        Number.isFinite(s.whiteThr)?s.whiteThr:0.92,
        s.black2alpha?1:0,
        Number.isFinite(s.blackThr)?s.blackThr:0.08,
        new Date().toISOString(),
        'unknown'
      ];

      const ok = await ensureMaterialsHead(ssid);
      if (!ok) return;

      // append-only safe path
      try {
        const body = { values: [row], majorDimension: 'ROWS', range: 'materials!A2:K2' };
        const q = 'valueInputOption=RAW&insertDataOption=INSERT_ROWS';
        const r = await gapiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/materials!A2:K9999:append?${q}`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        log('saved (append)', { sheetId: gid, materialKey: s.materialKey, status: r?.status });
      } catch(e) {
        warn('save failed', e);
      }
    }, 900);
  };

  // ---------- boot
  onDomReady(() => {
    log('safe boot');

    // Wire UI (does not block clicks anywhere)
    wireUI();

    // Poll scene a few times to populate target
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      if (getScene()) {
        populateTarget();
        clearInterval(poll);
      }
      if (tries > 40) clearInterval(poll);
    }, 250);

    // When UI changes, schedule save (if we can)
    const selSheet = () => {
      // try common select elements for gid
      const s = document.querySelector('nav select, #sheet-select, select[name="sheet"], select[data-role="sheet"]');
      return s ? s.value : '0';
    };
    const ssid = window.currentSpreadsheetId || null;

    const ids = ['mat-unlit','mat-doubleside','mat-opacity','mat-white2alpha','mat-white-thr','mat-black2alpha','mat-black-thr','mat-target'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = (el.tagName === 'INPUT' && el.type === 'range') ? 'input'
                : (el.tagName === 'INPUT' ? 'change'
                : 'change');
      el.addEventListener(evt, () => scheduleSave(ssid, selSheet()), { passive: true });
    });

    log('ready');
  });
})();
