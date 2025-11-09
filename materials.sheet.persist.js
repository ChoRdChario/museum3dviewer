// [materials.sheet.persist.js] v1.4(+sgid) PATCH:
// - ensureSheetExists_(): create __LM_MATERIALS if missing
// - ensureHeaders_(): guarantees header row A:N
// - setCtx(): invokes ensureHeaders_() pre-emptively
// - upsert(): calls ensureHeaders_() before write
// - uses boot A1-safe helpers when available

(function(){
  if (window.__LM_MATERIALS_PERSIST__ && window.__LM_MATERIALS_PERSIST__.__patchTag === 'v1.4+sgid+ensure') {
    console.log('[mat-sheet-persist] already patched');
    return;
  }

  function assertAuthShim() {
    if (typeof window.__lm_fetchJSONAuth !== 'function') {
      throw new Error('__lm_fetchJSONAuth missing');
    }
  }

  async function sheetsMeta_(spreadsheetId) {
    assertAuthShim();
    return window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  }

  async function ensureSheetExists_(spreadsheetId, title='__LM_MATERIALS') {
    const meta = await sheetsMeta_(spreadsheetId);
    const has = (meta.sheets||[]).some(s => s.properties?.title === title);
    if (has) return true;
    await window.__lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title } } }] } }
    );
    return true;
  }

  async function updateValuesRaw_(spreadsheetId, sheetName, a1Range, values2D) {
    // prefer boot's safe helper if present
    if (typeof window.updateValues === 'function' && typeof window.encodeA1Safe === 'function') {
      return window.updateValues(spreadsheetId, sheetName, a1Range, values2D);
    }
    // fallback inline
    const needsQuote = /[^A-Za-z0-9_]/.test(String(sheetName));
    const rngNamed = `${needsQuote?`'${sheetName}'`:sheetName}!${a1Range}`;
    const rng = encodeURIComponent(rngNamed);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rng}?valueInputOption=RAW`;
    return window.__lm_fetchJSONAuth(url, { method:'PUT', body:{ values: values2D } });
  }

  async function getColumnA_(spreadsheetId, sheetName) {
    if (typeof window.getValues === 'function') {
      return window.getValues(spreadsheetId, sheetName, 'A:A');
    }
    const needsQuote = /[^A-Za-z0-9_]/.test(String(sheetName));
    const rngNamed = `${needsQuote?`'${sheetName}'`:sheetName}!A:A`;
    const rng = encodeURIComponent(rngNamed);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rng}`;
    return window.__lm_fetchJSONAuth(url);
  }

  async function putRange_(spreadsheetId, sheetName, a1Range, values2D) {
    return updateValuesRaw_(spreadsheetId, sheetName, a1Range, values2D);
  }

  async function ensureHeaders_(spreadsheetId, title='__LM_MATERIALS') {
    await ensureSheetExists_(spreadsheetId, title);
    const headers = [[
      'materialKey','opacity','doubleSided','unlitLike',
      'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
      'roughness','metalness','emissiveHex','updatedAt','updatedBy','sheetGid'
    ]];
    await putRange_(spreadsheetId, title, 'A1:N1', headers);
  }

  async function upsert_({ materialKey, opacity=1, doubleSided=false, unlitLike=false, sheetGid=0 }) {
    const ctx = window.__LM_SHEET_CTX || {};
    const spreadsheetId = ctx.spreadsheetId;
    if (!spreadsheetId) throw new Error('no spreadsheetId in ctx');
    await ensureHeaders_(spreadsheetId);

    // find key in colA
    const colA = await getColumnA_(spreadsheetId, '__LM_MATERIALS');
    const rows = (colA && colA.values) ? colA.values : [];
    let rowNumber = rows.findIndex(r => (r[0]||'') === materialKey);
    if (rowNumber <= 0) {
      rowNumber = rows.length; // 0-based
    }
    // convert to 1-based data row (>=2)
    rowNumber = Math.max(rowNumber + 1, 2);

    const iso = new Date().toISOString();
    const values = [[
      materialKey, opacity, !!doubleSided, !!unlitLike,
      false, '#000000', 0, 0,
      '', '', '', iso, 'persist', sheetGid
    ]];
    await putRange_(spreadsheetId, '__LM_MATERIALS', `A${rowNumber}:N${rowNumber}`, values);
    return { rowNumber };
  }

  const API = {
    __patchTag: 'v1.4+sgid+ensure',
    setCtx({ spreadsheetId, sheetGid }) {
      window.__LM_SHEET_CTX = { spreadsheetId, sheetGid };
      ensureHeaders_(spreadsheetId).catch(err => console.warn('[persist.ensureHeaders early]', err));
      console.log('[mat-sheet-persist v1.4+sgid] ctx set', { spreadsheetId, sheetGid });
    },
    ensureHeaders() {
      const sid = window.__LM_SHEET_CTX?.spreadsheetId;
      if (!sid) throw new Error('no spreadsheetId in ctx');
      return ensureHeaders_(sid);
    },
    upsert: upsert_
  };

  window.__LM_MATERIALS_PERSIST__ = API;
  console.log('[mat-sheet-persist v1.4+sgid+ensure] loaded & exposed API');
})();