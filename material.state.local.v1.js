// material.state.local.v1.js
// LociMyu — material per-sheet state (localStorage) + save-bus
// - Caches changes locally per {spreadsheetId, sheetGid, materialKey}
// - Emits 'lm:material-save' events so a server/Sheet bridge can persist upstream
// - Rehydrates on sheet-context and on GLB load
(() => {
  const TAG = '[mat-state v1]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // ----- storage helpers -----
  const KEY = '__LM_MATERIALS_STATE_v1';
  const loadAll = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(_){ return {}; }
  };
  const saveAll = (obj) => {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch(e){ warn('localStorage save failed', e); }
  };
  const nsKey = (spreadsheetId, sheetGid) => `${spreadsheetId || 'NOSPREAD'}:${sheetGid ?? 'NOGID'}`;

  // Current sheet context (provided by materials.sheet.bridge.js)
  let ctx = { spreadsheetId: null, sheetGid: null };

  // Listen sheet context
  window.addEventListener('lm:sheet-context', (ev) => {
    const d = ev?.detail || ev;
    if (d?.spreadsheetId != null) ctx.spreadsheetId = d.spreadsheetId;
    if (d?.sheetGid != null) ctx.sheetGid = d.sheetGid;
    log('context', ctx);
    // On context change, try to hydrate UI+scene
    setTimeout(hydrateFromLocal, 0);
  });

  // Simple debounce
  const debounce = (fn, ms=300) => {
    let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  };

  // Find UI controls (created by material.runtime.patch.js / material.id.unify.* etc.)
  function pickControls() {
    const doc = document;
    return {
      sel: doc.querySelector('#materialSelect, #pm-material'),
      opacity: doc.querySelector('#opacityRange, #pm-opacity-range'),
      chkDouble: doc.querySelector('#doubleSided, #pm-double'),
      chkUnlit: doc.querySelector('#unlitLike, #pm-unlit'),
    };
  }

  // Read current UI values into state object
  function readUi() {
    const { sel, opacity, chkDouble, chkUnlit } = pickControls();
    const materialKey = sel && sel.value || '';
    const st = {
      materialKey,
      opacity: opacity ? parseFloat(opacity.value) : null,
      doubleSided: chkDouble ? !!chkDouble.checked : null,
      unlitLike: chkUnlit ? !!chkUnlit.checked : null,
      updatedAt: new Date().toISOString(),
    };
    return st;
  }

  // Persist to localStorage & emit save event (for Sheets bridge)
  const pushSave = debounce(() => {
    const st = readUi();
    if (!st.materialKey) { return; } // nothing selected
    const all = loadAll();
    const ns = nsKey(ctx.spreadsheetId, ctx.sheetGid);
    if (!all[ns]) all[ns] = {};
    all[ns][st.materialKey] = {
      opacity: st.opacity,
      doubleSided: st.doubleSided,
      unlitLike: st.unlitLike,
      updatedAt: st.updatedAt,
      updatedBy: 'local', // placeholder
    };
    saveAll(all);
    log('saved local', ns, st.materialKey, all[ns][st.materialKey]);

    // Emit event for upstream persistence
    const detail = {
      spreadsheetId: ctx.spreadsheetId,
      sheetGid: ctx.sheetGid,
      materialKey: st.materialKey,
      values: all[ns][st.materialKey],
    };
    try { window.dispatchEvent(new CustomEvent('lm:material-save', { detail })); }
    catch(e){ warn('emit lm:material-save failed', e); }
  }, 200);

  // Apply one entry to scene via existing runtime (reuse UI triggers)
  function applyToScene(entryKey, entry) {
    const { sel, opacity, chkDouble, chkUnlit } = pickControls();
    if (!sel || !opacity) return;
    // Select material; this should trigger runtime wiring
    if (entryKey && sel.value !== entryKey) {
      sel.value = entryKey;
      sel.dispatchEvent(new Event('change'));
    }
    if (typeof entry.opacity === 'number' && opacity) {
      opacity.value = String(entry.opacity);
      opacity.dispatchEvent(new Event('input'));
    }
    if (chkDouble && typeof entry.doubleSided === 'boolean') {
      chkDouble.checked = !!entry.doubleSided;
      chkDouble.dispatchEvent(new Event('change'));
    }
    if (chkUnlit && typeof entry.unlitLike === 'boolean') {
      chkUnlit.checked = !!entry.unlitLike;
      chkUnlit.dispatchEvent(new Event('change'));
    }
  }

  // Hydrate on context or GLB load
  function hydrateFromLocal() {
    const ns = nsKey(ctx.spreadsheetId, ctx.sheetGid);
    const all = loadAll();
    const map = all[ns] || {};
    const keys = Object.keys(map);
    if (keys.length === 0) { log('hydrate: no entries for', ns); return; }
    log('hydrate', ns, keys.length);
    // Apply the first available entry to scene & leave others selectable
    const k0 = keys[0];
    applyToScene(k0, map[k0]);
  }

  // Wire UI events
  function armUi() {
    const { sel, opacity, chkDouble, chkUnlit } = pickControls();
    if (opacity) opacity.addEventListener('input', pushSave, false);
    if (sel) sel.addEventListener('change', pushSave, false);
    if (chkDouble) chkDouble.addEventListener('change', pushSave, false);
    if (chkUnlit) chkUnlit.addEventListener('change', pushSave, false);
    log('armed');
  }

  // GLB load signal compatibility
  window.addEventListener('lm:glb-loaded', () => setTimeout(hydrateFromLocal, 0));

  // Initial arm (some UIs are synthesized later; retry a few times)
  let tries = 0;
  (function waitUi(){
    tries++;
    armUi();
    const { sel, opacity } = pickControls();
    if (tries < 15 && (!sel || !opacity)) setTimeout(waitUi, 150);
  })();

  // Expose debug
  window.__lm_mat_state = { loadAll, saveAll };
  log('ready');
})();
