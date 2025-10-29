/* material.orchestrator.js
 * LociMyu – Material Orchestrator (v6.7 SAVE-INTEGRATION)
 * CHANGE MARKERS:
 *   - VERSION_TAG:V6_7_SAVE
 *   - ADDED: ensureMaterialSheet(), upsertProps(), saveCurrentOpacity()
 *   - ADDED: window.lmMaterials public API (report, setCurrentSheetContext, ...)
 *   - UI hooks now target #pm-material and #pm-opacity-range explicitly
 */

(() => {
  const SHEET_NAME = '__LM_MATERIALS';
  const SCHEMA_VER = '1';
  const VERSION_TAG = 'VERSION_TAG:V6_7_SAVE';

  const log = (...args) => console.log('[mat-orch]', ...args);
  const warn = (...args) => console.warn('[mat-orch]', ...args);
  const err = (...args) => console.error('[mat-orch]', ...args);

  // ===== Auth helpers =====
  async function getAccessToken() {
    try {
      if (typeof window.__lm_getAccessToken === 'function') {
        const tok = await window.__lm_getAccessToken();
        if (tok) return tok;
      }
    } catch {}
    try {
      if (window.gauth && typeof window.gauth.getAccessToken === 'function') {
        const tok = await window.gauth.getAccessToken();
        if (tok) return tok;
      }
    } catch {}
    throw new Error('token_missing');
  }
  async function authFetch(url, init={}) {
    const tok = await getAccessToken();
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${tok}`);
    return fetch(url, { ...init, headers });
  }

  // ===== State =====
  const state = {
    spreadsheetId: null,
    sheetGid: null,
    ui: {
      dropdown: null,        // #pm-material
      perMatSlider: null,    // #pm-opacity-range
    },
  };

  // ===== Public: set sheet context =====
  function setCurrentSheetContext({ spreadsheetId, sheetGid }) {
    state.spreadsheetId = spreadsheetId || null;
    state.sheetGid = (typeof sheetGid === 'number') ? sheetGid : (
      typeof sheetGid === 'string' && sheetGid !== '' ? Number(sheetGid) : null
    );
    log('sheet context set', { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid });
  }

  // ===== Ensure __LM_MATERIALS exists (idempotent) =====
  async function ensureMaterialSheet() {
    if (!state.spreadsheetId) {
      warn('ensureMaterialSheet: no spreadsheetId yet');
      return { ok: false, reason: 'no_spreadsheet' };
    }
    // 1) list sheets
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}?fields=sheets(properties(title,sheetId))`;
    const metaRes = await authFetch(metaUrl);
    if (!metaRes.ok) {
      return { ok: false, status: metaRes.status, text: await metaRes.text() };
    }
    const meta = await metaRes.json();
    const exists = (meta.sheets || []).some(s => s.properties?.title === SHEET_NAME);
    if (!exists) {
      // 2) create sheet
      const buRes = await authFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME, gridProperties: { frozenRowCount: 1 } } } }] }),
        }
      );
      if (!buRes.ok) return { ok: false, status: buRes.status, text: await buRes.text() };

      // 3) header row
      const header = [['sheetGid','matUuid','matName','schemaVer','props','updatedAt']];
      const upRes = await authFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A1:F1?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: header }),
        }
      );
      if (!upRes.ok) return { ok: false, status: upRes.status, text: await upRes.text() };
      log('created', SHEET_NAME);
    } else {
      log(SHEET_NAME, 'exists');
    }
    return { ok: true };
  }

  // ===== Upsert one material row by matUuid =====
  async function upsertProps({ matUuid, matName, props }) {
    if (!state.spreadsheetId) throw new Error('no_spreadsheet');
    await ensureMaterialSheet();

    const payload = [
      String(state.sheetGid ?? ''),
      String(matUuid ?? ''),
      String(matName ?? ''),
      SCHEMA_VER,
      JSON.stringify(props ?? {}),
      new Date().toISOString(),
    ];

    // read col B (matUuid) to find existing row
    const readRes = await authFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!B2:B`
    );
    const readJson = await readRes.json();
    const rows = (readJson.values || []).map(r => r[0]);
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] === matUuid) { rowIndex = i + 2; break; }
    }
    if (rowIndex > 0) {
      const range = `${SHEET_NAME}!A${rowIndex}:F${rowIndex}`;
      const putRes = await authFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [payload] }),
        }
      );
      if (!putRes.ok) throw new Error('upsert_update_failed');
      log('upsert UPDATE', { row: rowIndex, matName });
    } else {
      const appRes = await authFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A2:F:append?valueInputOption=RAW`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [payload] }),
        }
      );
      if (!appRes.ok) throw new Error('upsert_append_failed');
      log('upsert APPEND', { matName });
    }
  }

  // ===== UI capture (explicit IDs first) =====
  function captureUI() {
    state.ui.dropdown = document.querySelector('#pm-material') || document.querySelector('#lm-material-select');
    state.ui.perMatSlider = document.querySelector('#pm-opacity-range') || document.querySelector('input[type="range"][data-lm="permat-opacity"]');
  }

  async function saveCurrentOpacity() {
    if (!state.ui.dropdown || !state.ui.perMatSlider) return;
    if (!state.spreadsheetId || state.sheetGid == null) { warn('save skipped: no sheet context'); return; }
    const opt = state.ui.dropdown.options[state.ui.dropdown.selectedIndex];
    if (!opt) return;
    const matUuid = opt.getAttribute('data-uuid') || opt.value || '';
    const matName = opt.textContent || '';
    const opacity = Number(state.ui.perMatSlider.value);
    if (!matUuid || Number.isNaN(opacity)) return;
    await upsertProps({ matUuid, matName, props: { opacity } });
    log('saved opacity', { matName, opacity, VERSION_TAG });
  }

  function wireUIOnce() {
    captureUI();
    if (state.ui.perMatSlider) {
      // 最低限の2イベント（変更確定で保存）
      state.ui.perMatSlider.addEventListener('change', saveCurrentOpacity, { passive: true });
      state.ui.perMatSlider.addEventListener('pointerup', saveCurrentOpacity, { passive: true });
    }
  }

  // モデル準備完了後にUIを再キャプチャ（Materialタブが描画済みになっている）
  window.addEventListener('lm:model-ready', wireUIOnce);

  // ===== Public API =====
  window.lmMaterials = Object.freeze({
    setCurrentSheetContext,
    ensureMaterialSheet,
    upsertProps,
    saveCurrentOpacity,
    report() { return { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid, ui: { hasSelect: !!state.ui.dropdown, hasSlider: !!state.ui.perMatSlider }, VERSION_TAG }; },
  });

  log('loaded', VERSION_TAG);
})();