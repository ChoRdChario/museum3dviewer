// [mat-sheet-persist v1.4-compatible SINGLE FILE]
// Defines window.__LM_MATERIALS_PERSIST__ with { setCtx, ensureHeaders, upsert }.
// Classic (non-module) script, idempotent. Auto-wires to lm:sheet-context to keep ctx fresh.
//
// Columns layout ensured: A..N
// A: key (sheetGid::materialKey), B:opacity, C:doubleSided, D:unlitLike,
// E:chromaEnable, F:chromaColor, G:chromaTolerance, H:chromaFeather,
// I:roughness, J:metalness, K:emissiveHex, L:updatedAt, M:updatedBy, N:sheetGid
//
(function(){
  if (window.__LM_MATERIALS_PERSIST__) {
    console.log('[mat-sheet-persist v1.4] already defined; skipping reinit');
    return;
  }

  const STATE = {
    spreadsheetId: null,
    sheetGid: null,
    sheetTitle: '__LM_MATERIALS',
  };

  function assertAuthShim() {
    if (typeof window.__lm_fetchJSONAuth !== 'function') {
      throw new Error('__lm_fetchJSONAuth missing');
    }
  }

  function setCtx(ctx) {
    if (!ctx || !ctx.spreadsheetId) {
      console.warn('[mat-sheet-persist v1.4] setCtx ignored (no spreadsheetId)', ctx);
      return;
    }
    STATE.spreadsheetId = ctx.spreadsheetId;
    if (typeof ctx.sheetGid === 'number') STATE.sheetGid = ctx.sheetGid;
    console.log('[mat-sheet-persist v1.4] ctx set', { spreadsheetId: STATE.spreadsheetId, sheetGid: STATE.sheetGid });
  }

  async function ensureSheet() {
    assertAuthShim();
    const sid = STATE.spreadsheetId;
    if (!sid) throw new Error('no spreadsheetId in context');

    // 1) get meta
    const meta = await __lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${sid}`);
    const titles = (meta.sheets||[]).map(s => s.properties.title);
    if (!titles.includes(STATE.sheetTitle)) {
      await __lm_fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}:batchUpdate`,
        { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title: STATE.sheetTitle } } }] } }
      );
      console.log('[mat-sheet-persist v1.4] added sheet', STATE.sheetTitle);
    }
  }

  async function ensureHeaders() {
    assertAuthShim();
    const sid = STATE.spreadsheetId;
    if (!sid) throw new Error('no spreadsheetId in context');
    await ensureSheet();

    const headers = [
      'key','opacity','doubleSided','unlitLike',
      'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
      'roughness','metalness','emissiveHex','updatedAt','updatedBy','sheetGid'
    ]; // A..N
    const range = encodeURIComponent(`${STATE.sheetTitle}!A1:N1`);
    await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[headers] } }
    );
    console.log('[mat-sheet-persist v1.4] headers ensured A:N');
  }

  async function upsert(payload) {
    assertAuthShim();
    const sid = STATE.spreadsheetId;
    if (!sid) throw new Error('no spreadsheetId in context');

    const {
      materialKey,
      opacity,
      doubleSided = false,
      unlitLike   = false,
      chromaEnable = false,
      chromaColor = '#000000',
      chromaTolerance = 0,
      chromaFeather   = 0,
      roughness = '',
      metalness = '',
      emissiveHex = '',
      updatedBy = 'mat-ui',
      sheetGid, // optional; falls back to STATE.sheetGid
    } = payload || {};

    const sgid = (typeof sheetGid === 'number' ? sheetGid : STATE.sheetGid) ?? 0;
    if (!materialKey) throw new Error('materialKey required');

    const key = `${sgid}::${materialKey}`;

    await ensureHeaders();

    // A列を見て key を探す
    const colA = await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(STATE.sheetTitle+'!A:A')}`
    );
    const rows = colA.values || []; // [[header],[key],...]
    let rowIndex = rows.findIndex(r => (r[0]||'') === key);
    let rowNumber;
    if (rowIndex <= 0) {
      rowNumber = rows.length + 1; // append
      await __lm_fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(`${STATE.sheetTitle}!A${rowNumber}:A${rowNumber}`)}?valueInputOption=RAW`,
        { method:'PUT', body:{ values:[[key]] } }
      );
    } else {
      rowNumber = rowIndex + 1;
    }

    const iso = new Date().toISOString();
    const rowValues = [
      opacity ?? '',
      (doubleSided ? 'TRUE' : 'FALSE'),
      (unlitLike   ? 'TRUE' : 'FALSE'),
      (chromaEnable ? 'TRUE' : 'FALSE'),
      chromaColor || '',
      String(chromaTolerance ?? ''),
      String(chromaFeather   ?? ''),
      String(roughness ?? ''),
      String(metalness ?? ''),
      emissiveHex || '',
      iso,
      updatedBy,
      String(sgid)
    ];
    const rangeBN = `${STATE.sheetTitle}!B${rowNumber}:N${rowNumber}`;
    await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(rangeBN)}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[rowValues] } }
    );

    console.log('[mat-sheet-persist v1.4] upsert', { rowNumber, key, sheetGid: sgid, materialKey });
    return { rowNumber, key, sheetGid: sgid, materialKey };
  }

  // expose
  window.__LM_MATERIALS_PERSIST__ = { setCtx, ensureHeaders, upsert };

  // auto-wire to sheet-context
  window.addEventListener('lm:sheet-context', (e) => {
    const d = e && e.detail || {};
    setCtx(d);
  });

  console.log('[mat-sheet-persist v1.4] loaded & exposed API');
})();