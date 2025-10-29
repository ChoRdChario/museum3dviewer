/* material.orchestrator.js
 * LociMyu – Material Orchestrator (v6.8 AUTH-FIX)
 * PURPOSE
 *   - Populate/select materials (existing behavior kept)
 *   - Persist per-material props to Google Sheets
 *   - **Permanently** handle Google Identity Services (GIS) loading & token acquisition
 *
 * WHAT'S NEW (v6.8):
 *   - VERSION_TAG:V6_8_AUTHFIX
 *   - getAccessToken(): falls back to GIS on-demand (auto-load gsi/client if missing)
 *   - Uses window.__LM_CLIENT_ID if present (recommended to define in HTML), otherwise
 *     keeps compatibility with existing gauth.getAccessToken()
 *   - Keeps all public API surface: window.lmMaterials.{setCurrentSheetContext,ensureMaterialSheet,upsertProps,saveCurrentOpacity,report}
 */

(() => {
  const SHEET_NAME = '__LM_MATERIALS';
  const SCHEMA_VER = '1';
  const VERSION_TAG = 'VERSION_TAG:V6_8_AUTHFIX';

  const log  = (...a) => console.log('[mat-orch]', ...a);
  const warn = (...a) => console.warn('[mat-orch]', ...a);
  const err  = (...a) => console.error('[mat-orch]', ...a);

  // ----------------- GIS loader (on-demand) -----------------
  async function ensureGISLoaded() {
    if (window.google?.accounts?.oauth2) return true;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return !!(window.google?.accounts?.oauth2);
  }

  // ----------------- Token acquisition (robust) -----------------
  async function getAccessToken() {
    // 1) Preferred local hook (kept for compatibility)
    try {
      if (typeof window.__lm_getAccessToken === 'function') {
        const tok = await window.__lm_getAccessToken();
        if (tok) return tok;
      }
    } catch {}

    // 2) Legacy gauth path (kept for compatibility)
    try {
      if (window.gauth && typeof window.gauth.getAccessToken === 'function') {
        const tok = await window.gauth.getAccessToken();
        if (tok) return tok;
      }
    } catch {}

    // 3) GIS fallback (permanent fix)
    const ok = await ensureGISLoaded();
    if (!ok) throw new Error('gis_not_loaded');

    // Use provided client id if defined; you can define this in HTML:
    // <script>window.__LM_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"</script>
    const clientId =
      window.__LM_CLIENT_ID ||
      window.gauth?.CLIENT_ID ||
      '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com'; // fallback (replace with yours if needed)

    // Cache token client
    if (!window.__lm_tokenClient) {
      window.__lm_token = undefined;
      window.__lm_tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
        callback: (resp) => {
          if (resp?.access_token) window.__lm_token = resp.access_token;
        }
      });
    }

    // Try silent first
    window.__lm_tokenClient.requestAccessToken({ prompt: '' });
    for (let i = 0; i < 25 && !window.__lm_token; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (window.__lm_token) return window.__lm_token;

    // Fallback to consent prompt
    window.__lm_tokenClient.requestAccessToken({ prompt: 'consent' });
    for (let i = 0; i < 50 && !window.__lm_token; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (window.__lm_token) return window.__lm_token;

    throw new Error('token_missing');
  }

  async function authFetch(url, init = {}) {
    const tok = await getAccessToken();
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${tok}`);
    return fetch(url, { ...init, headers });
  }

  // ----------------- State -----------------
  const state = {
    spreadsheetId: null,
    sheetGid: null,
    ui: { dropdown: null, perMatSlider: null },
  };

  function setCurrentSheetContext({ spreadsheetId, sheetGid }) {
    state.spreadsheetId = spreadsheetId || null;
    state.sheetGid = (typeof sheetGid === 'number') ? sheetGid :
      (typeof sheetGid === 'string' && sheetGid !== '' ? Number(sheetGid) : null);
    log('sheet context set', { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid });
  }

  // ----------------- Ensure __LM_MATERIALS -----------------
  async function ensureMaterialSheet() {
    if (!state.spreadsheetId) {
      warn('ensureMaterialSheet: no spreadsheetId');
      return { ok: false, reason: 'no_spreadsheet' };
    }
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}?fields=sheets(properties(title,sheetId))`;
    const metaRes = await authFetch(metaUrl);
    if (!metaRes.ok) return { ok: false, status: metaRes.status, text: await metaRes.text() };
    const meta = await metaRes.json();
    const exists = (meta.sheets || []).some(s => s.properties?.title === SHEET_NAME);
    if (!exists) {
      const buRes = await authFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME, gridProperties: { frozenRowCount: 1 } } } }] }),
        }
      );
      if (!buRes.ok) return { ok: false, status: buRes.status, text: await buRes.text() };
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

  // ----------------- Upsert by matUuid -----------------
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

    const readRes = await authFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!B2:B`
    );
    const readJson = await readRes.json();
    const rows = (readJson.values || []).map(r => r[0]);
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i] === matUuid) { rowIndex = i + 2; break; }

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

  // ----------------- UI hooks (non-intrusive) -----------------
  function captureUI() {
    state.ui.dropdown     = document.querySelector('#pm-material') || document.querySelector('#lm-material-select');
    state.ui.perMatSlider = document.querySelector('#pm-opacity-range') || document.querySelector('input[type="range"][data-lm="permat-opacity"]');
  }
  async function saveCurrentOpacity() {
    captureUI();
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
      state.ui.perMatSlider.addEventListener('change', saveCurrentOpacity, { passive: true });
      state.ui.perMatSlider.addEventListener('pointerup', saveCurrentOpacity, { passive: true });
    }
  }
  window.addEventListener('lm:model-ready', wireUIOnce);

  // ----------------- Public API -----------------
  window.lmMaterials = Object.freeze({
    setCurrentSheetContext,
    ensureMaterialSheet,
    upsertProps,
    saveCurrentOpacity,
    report() {
      return {
        spreadsheetId: state.spreadsheetId,
        sheetGid: state.sheetGid,
        ui: { hasSelect: !!state.ui.dropdown, hasSlider: !!state.ui.perMatSlider },
        VERSION_TAG,
      };
    },
  });

  log('loaded', VERSION_TAG);
})();