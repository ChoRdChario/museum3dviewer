// materials.ui.wire.js
// v1.4 - selection sync + guarded UI updates + read-from-sheet
// - Keeps UI checkboxes/sliders in sync per-material when selection changes
// - Prevents accidental overwrite by ignoring programmatic UI updates
// - Reads existing values for the selected material from __LM_MATERIALS (A..M)

console.log('[mat-ui-wire v1.4] wiring...');

// ---- small utils ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bool = (v) => String(v).toUpperCase() === 'TRUE';

// ---- env helpers ----
function getSheetId() {
  return (window.__LM_SHEET_CTX && window.__LM_SHEET_CTX.spreadsheetId) || null;
}

async function authFetchJSON(url, init = {}) {
  if (typeof window.__lm_fetchJSONAuth !== 'function') throw new Error('__lm_fetchJSONAuth missing');
  return window.__lm_fetchJSONAuth(url, init);
}

// ---- read selected material's row from sheet ----
async function readRowByKey(sheetId, materialKey) {
  if (!sheetId || !materialKey) return null;

  // 1) find row index by scanning A:A
  const colA = await authFetchJSON(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('__LM_MATERIALS!A:A')}`
  );
  const rows = (colA && colA.values) || []; // [[header],[key],...]
  const idx = rows.findIndex(r => (r[0] || '') === materialKey);
  if (idx <= 0) return null; // not found or header

  const rowNumber = idx + 1;

  // 2) fetch B..M on that row
  const range = `__LM_MATERIALS!B${rowNumber}:M${rowNumber}`;
  const data = await authFetchJSON(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`
  );

  const vals = (data && data.values && data.values[0]) || [];
  // Map columns to fields (keep default fallbacks)
  const parsed = {
    opacity:       vals[0] !== undefined && vals[0] !== '' ? Number(vals[0]) : 1,
    doubleSided:   bool(vals[1] || 'FALSE'),
    unlitLike:     bool(vals[2] || 'FALSE'),
    chromaEnable:  bool(vals[3] || 'FALSE'),
    chromaColor:   vals[4] || '#000000',
    chromaTolerance: Number(vals[5] || 0),
    chromaFeather: Number(vals[6] || 0),
    roughness:     vals[7] || '',
    metalness:     vals[8] || '',
    emissiveHex:   vals[9] || '',
    // vals[10] updatedAt
    // vals[11] updatedBy
  };
  return parsed;
}

// ---- UI wiring ----
(function wire() {
  const sel = document.querySelector('#pm-material');
  const opRange = document.querySelector('#pm-opacity-range');
  const opVal = document.querySelector('#pm-opacity-val');
  const cbDouble = document.querySelector('#pm-flag-doublesided');
  const cbUnlit  = document.querySelector('#pm-flag-unlit');

  if (!sel || !opRange || !cbDouble || !cbUnlit) {
    console.warn('[mat-ui-wire v1.4] required UI parts missing');
    return;
  }

  // programmatic update guard
  let programmatic = false;
  const setProgrammatic = (v) => { programmatic = v; };

  // simple helper for render apply + persistence
  const applyRender = (payload) => {
    if (window.__LM_MAT_RENDER && typeof window.__LM_MAT_RENDER.apply === 'function') {
      try { window.__LM_MAT_RENDER.apply(payload); } catch (e) { console.warn('[mat-ui-wire] render.apply failed', e); }
    }
  };
  const persist = async (payload) => {
    if (window.__LM_MAT_PERSIST && typeof window.__LM_MAT_PERSIST.upsert === 'function') {
      try { await window.__LM_MAT_PERSIST.upsert(payload); } catch (e) { console.warn('[mat-ui-wire] persist failed', e); }
    }
  };

  // reflect UI from a record (without persisting & without triggering listeners)
  async function syncUIFromRecord(rec) {
    setProgrammatic(true);
    try {
      if (rec.opacity !== undefined && !Number.isNaN(rec.opacity)) {
        opRange.value = String(rec.opacity);
        if (opVal) opVal.textContent = String(rec.opacity);
      }
      if (cbDouble) cbDouble.checked = !!rec.doubleSided;
      if (cbUnlit)  cbUnlit.checked  = !!rec.unlitLike;
      // future: chroma fields here
    } finally {
      // let the DOM settle before unguarding
      await sleep(0);
      setProgrammatic(false);
    }
  }

  // on material selection change: read row and reflect; render apply only (no save)
  sel.addEventListener('change', async () => {
    const sheetId = getSheetId();
    const key = sel.value || sel.selectedOptions?.[0]?.value || '';
    if (!key) return;

    let rec = null;
    try { rec = await readRowByKey(sheetId, key); } catch (e) { console.warn('[mat-ui-wire] readRowByKey failed', e); }
    if (!rec) rec = { opacity: Number(opRange.value || 1) || 1, doubleSided: false, unlitLike: false };

    await syncUIFromRecord(rec);
    applyRender({ key, opacity: rec.opacity, doubleSided: rec.doubleSided, unlitLike: rec.unlitLike });
  }, { passive: true });

  // handlers for user interactions
  let t;
  const debounced = (fn) => { clearTimeout(t); t = setTimeout(fn, 120); };

  const onOpacity = () => {
    if (programmatic) return;
    const key = sel.value || sel.selectedOptions?.[0]?.value || '';
    const opacity = Number(opRange.value);
    if (opVal) opVal.textContent = String(opacity);
    if (!key || Number.isNaN(opacity)) return;
    applyRender({ key, opacity, doubleSided: cbDouble.checked, unlitLike: cbUnlit.checked });
    debounced(() => persist({ materialKey: key, opacity, doubleSided: cbDouble.checked, unlitLike: cbUnlit.checked }));
  };

  const onFlag = () => {
    if (programmatic) return;
    const key = sel.value || sel.selectedOptions?.[0]?.value || '';
    if (!key) return;
    const opacity = Number(opRange.value);
    applyRender({ key, opacity, doubleSided: cbDouble.checked, unlitLike: cbUnlit.checked });
    debounced(() => persist({ materialKey: key, opacity, doubleSided: cbDouble.checked, unlitLike: cbUnlit.checked }));
  };

  opRange.addEventListener('input', onOpacity, { passive: true });
  opRange.addEventListener('change', onOpacity, { passive: true });
  opRange.addEventListener('pointerup', onOpacity, { passive: true });
  cbDouble.addEventListener('change', onFlag, { passive: true });
  cbUnlit.addEventListener('change', onFlag, { passive: true });

  console.log('[mat-ui-wire v1.4] wired with selection-sync');
})();