// materials.sheet.bridge.js
// Sheets bridge with auth wait + header enforcement, append-only writes.

(() => {
  const SHEET_NAME = '__LM_MATERIALS';
  const HEADERS = ['key', 'materialKey', 'opacity', 'updatedAt'];

  function currentCtx() {
    const ctx = window.__lm_sheetCtx || {};
    return {
      spreadsheetId: ctx.spreadsheetId || null,
      sheetGid: ctx.sheetGid || null,
    };
  }

  async function waitAuth(timeoutMs = 12000) {
    const t0 = performance.now();
    while (!window.__lm_fetchJSONAuth) {
      if (performance.now() - t0 > timeoutMs) {
        throw new Error('__lm_fetchJSONAuth missing');
      }
      await new Promise(r => setTimeout(r, 120));
    }
    return window.__lm_fetchJSONAuth;
  }

  async function fjson(url, opts) {
    const fx = await waitAuth();
    return fx(url, opts);
  }

  async function ensureSheet() {
    const { spreadsheetId } = currentCtx();
    if (!spreadsheetId) throw new Error('spreadsheetId missing');

    // 1) spreadsheet meta
    const meta = await fjson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
    );

    // 2) ensure sheet exists
    let sheetId = null;
    let found = (meta.sheets || []).find(s => s.properties && s.properties.title === SHEET_NAME);
    if (!found) {
      const req = { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] };
      const res = await fjson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        { method: 'POST', body: JSON.stringify(req) }
      );
      const add = (res.replies || [])[0]?.addSheet?.properties;
      sheetId = add?.sheetId ?? null;
    } else {
      sheetId = found.properties.sheetId;
    }

    // 3) enforce header row (A1)
    const range = `${SHEET_NAME}!A1:${String.fromCharCode(64 + HEADERS.length)}1`;
    await fjson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [HEADERS] }) }
    );

    return { spreadsheetId, sheetId, title: SHEET_NAME };
  }

  async function loadAll() {
    const { spreadsheetId } = currentCtx();
    if (!spreadsheetId) throw new Error('spreadsheetId missing');

    await ensureSheet();
    const range = `${SHEET_NAME}!A2:D`;
    const res = await fjson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
    );
    const rows = (res.values || []);
    const map = new Map();
    for (const row of rows) {
      const [key, materialKey, opacityStr, updatedAt] = row;
      const opacity = Number(opacityStr);
      map.set(materialKey, { key, materialKey, opacity, updatedAt });
    }
    return map;
  }

  async function upsertOne(rec) {
    const { spreadsheetId } = currentCtx();
    if (!spreadsheetId) throw new Error('spreadsheetId missing');

    await ensureSheet();
    const range = `${SHEET_NAME}!A1:D1:append`;
    const row = [
      rec.key ?? 'opacity',
      rec.materialKey ?? '',
      typeof rec.opacity === 'number' ? rec.opacity : '',
      rec.updatedAt ?? new Date().toISOString(),
    ];
    await fjson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );
  }

  console.log('[mat-sheet] ready');
  window.materialsSheetBridge = { ensureSheet, loadAll, upsertOne };
})();
