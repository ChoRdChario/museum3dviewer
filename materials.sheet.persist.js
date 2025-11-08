// materials.sheet.persist.js v1.5
// Responsibilities:
// - Keep __LM_MATERIALS sheet present with headers A:M
// - Upsert row by materialKey writing B..M including flags
// - Read row by key to sync UI
//
// Public API (attached to window.__LM_MAT_PERSIST):
//   ensure()             -> ensure sheet + headers
//   upsert(payload)      -> write one row (B..M); creates new row if needed
//   readByKey(key)       -> {hit, rowNumber, values:{opacity, doubleSided, unlitLike, ...}}
//   ctx()                -> current ctx
//
(function(){
  const LOG_TAG = '[mat-sheet-persist v1.5]';
  const MAT_SHEET = '__LM_MATERIALS';

  function log(...args){ console.log(LOG_TAG, ...args); }
  function warn(...args){ console.warn(LOG_TAG, ...args); }

  function getCtx(){
    const c = window.__LM_SHEET_CTX;
    if (!c || !c.spreadsheetId) throw new Error('no spreadsheetId in __LM_SHEET_CTX');
    return c;
  }

  async function fetchJSONAuth(url, init={}){
    if (typeof window.__lm_fetchJSONAuth !== 'function') throw new Error('__lm_fetchJSONAuth not present');
    return window.__lm_fetchJSONAuth(url, init);
  }

  async function ensureHeaders(spreadsheetId){
    const headers = [
      'materialKey','opacity','doubleSided','unlitLike',
      'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
      'roughness','metalness','emissiveHex',
      'updatedAt','updatedBy'
    ]; // A..M
    await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A1:M1')}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[headers] } }
    );
    log('headers ensured A:M');
  }

  async function ensureSheet(){
    const { spreadsheetId } = getCtx();
    const meta = await fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const titles = (meta.sheets||[]).map(s => s.properties.title);
    if (!titles.includes(MAT_SHEET)){
      await fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title: MAT_SHEET } } }] } }
      );
      log('created sheet & headers');
    }else{
      log('sheet exists');
    }
    await ensureHeaders(spreadsheetId);
  }

  async function upsert(payload){
    const { spreadsheetId } = getCtx();
    const {
      materialKey, opacity,
      doubleSided=false, unlitLike=false,
      chromaEnable=false, chromaColor='#000000',
      chromaTolerance=0, chromaFeather=0,
      roughness='', metalness='', emissiveHex='',
      updatedBy='mat-ui'
    } = payload || {};
    if (!materialKey) throw new Error('materialKey required');

    // Ensure headers at least once per session (cheap PUT)
    await ensureHeaders(spreadsheetId);

    // Find or create row by key in column A
    const colA = await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A:A')}`
    );
    const rows = colA.values || [];
    let rowIndex = rows.findIndex(r => (r[0]||'') === materialKey);
    let rowNumber;
    if (rowIndex <= 0){
      rowNumber = rows.length + 1;
      await fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${MAT_SHEET}!A${rowNumber}:A${rowNumber}`)}?valueInputOption=RAW`,
        { method:'PUT', body:{ values:[[materialKey]] } }
      );
    }else{
      rowNumber = rowIndex + 1;
    }

    const iso = new Date().toISOString();
    const rowValues = [
      opacity ?? '',
      (doubleSided ? 'TRUE' : 'FALSE'),
      (unlitLike ? 'TRUE' : 'FALSE'),
      (chromaEnable ? 'TRUE' : 'FALSE'),
      chromaColor || '',
      String(chromaTolerance ?? ''),
      String(chromaFeather ?? ''),
      String(roughness ?? ''),
      String(metalness ?? ''),
      emissiveHex || '',
      iso,
      updatedBy
    ];
    const rangeBM = `${MAT_SHEET}!B${rowNumber}:M${rowNumber}`;
    await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rangeBM)}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[rowValues] } }
    );
    log('persisted', {rowNumber, materialKey, opacity, doubleSided, unlitLike});
    return { rowNumber };
  }

  async function readByKey(materialKey){
    const { spreadsheetId } = getCtx();
    if (!materialKey) return { hit:0, rowNumber: -1, values:null };
    // Read row range A:M and parse
    // First find the row index via A:A
    const colA = await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A:A')}`
    );
    const rows = colA.values || [];
    const rowIndex = rows.findIndex(r => (r[0]||'') === materialKey);
    if (rowIndex <= 0){
      return { hit:0, rowNumber:-1, values:null };
    }
    const rowNumber = rowIndex + 1;
    const range = `${MAT_SHEET}!A${rowNumber}:M${rowNumber}`;
    const resp = await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`
    );
    const vs = (resp.values && resp.values[0]) || [];
    const get = (i, d='') => (vs[i] ?? d);
    const truthy = (s) => String(s).toUpperCase() === 'TRUE';

    const values = {
      materialKey: get(0,''),
      opacity: parseFloat(get(1,'1')),
      doubleSided: truthy(get(2,'FALSE')),
      unlitLike: truthy(get(3,'FALSE')),
      chromaEnable: truthy(get(4,'FALSE')),
      chromaColor: get(5,''),
      chromaTolerance: parseFloat(get(6,'0')),
      chromaFeather: parseFloat(get(7,'0')),
      roughness: get(8,''),
      metalness: get(9,''),
      emissiveHex: get(10,''),
      updatedAt: get(11,''),
      updatedBy: get(12,'')
    };
    log('read', {rowNumber, values});
    return { hit:1, rowNumber, values };
  }

  // Wire sheet-context so we can log ctx
  window.addEventListener('lm:sheet-context', (e) => {
    const d = e && e.detail;
    if (d && d.spreadsheetId){
      log('ctx set', d);
    }else{
      warn('bad sheet-context detail', d);
    }
  });

  window.__LM_MAT_PERSIST = {
    ensure: ensureSheet,
    upsert,
    readByKey,
    ctx: () => { try { return getCtx(); } catch { return null; } }
  };
  log('loaded');
})();
