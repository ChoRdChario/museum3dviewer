// materials.sheet.persist.js
// v1.3 — ensures __LM_MATERIALS exists (A:M headers) and exposes upsert()
// Expects window.__lm_fetchJSONAuth (v2) installed by index.html before this script.

(function(){
  const TAG = '[mat-sheet-persist v1.3]';
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  // Expose version flag for diagnostics
  window.__LM_MAT_PERSIST_VERSION__ = '1.3';

  const MAT_SHEET = '__LM_MATERIALS';
  const HEADERS = [
    'materialKey','opacity','doubleSided','unlitLike',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'roughness','metalness','emissiveHex',
    'updatedAt','updatedBy'
  ]; // A..M

  function getSheetId(){
    return (window.__LM_SHEET_CTX && window.__LM_SHEET_CTX.spreadsheetId) || null;
  }

  async function fetchJSONAuth(url, init){
    if (typeof window.__lm_fetchJSONAuth !== 'function') {
      throw new Error('__lm_fetchJSONAuth not present');
    }
    return window.__lm_fetchJSONAuth(url, init);
  }

  async function ensureSheet(spreadsheetId){
    // 1) List sheets
    const meta = await fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const titles = (meta.sheets||[]).map(s => s.properties.title);
    // 2) Add if missing
    if (!titles.includes(MAT_SHEET)) {
      await fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title: MAT_SHEET } } }] } }
      );
      log('created sheet & headers (phase:add)');
    } else {
      log('sheet exists');
    }
    // 3) Put headers (idempotent)
    await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A1:M1')}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[HEADERS] } }
    );
    log('headers ensured A:M');
  }

  async function upsertRow(spreadsheetId, payload){
    const {
      materialKey, opacity, doubleSided=false, unlitLike=false,
      chromaEnable=false, chromaColor='#000000', chromaTolerance=0, chromaFeather=0,
      roughness='', metalness='', emissiveHex='', updatedBy='mat-ui'
    } = payload;
    if (!materialKey) throw new Error('materialKey required');

    // Find row in A:A
    const colA = await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A:A')}`
    );
    const rows = colA.values || [];
    let rowIndex = rows.findIndex(r => (r[0]||'') === materialKey);
    let rowNumber;
    if (rowIndex <= 0) {
      rowNumber = rows.length + 1; // append after header
      await fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${MAT_SHEET}!A${rowNumber}:A${rowNumber}`)}?valueInputOption=RAW`,
        { method:'PUT', body:{ values:[[materialKey]] } }
      );
    } else {
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
    log('persisted', { key: materialKey, row: rowNumber });
  }

  // Public API
  const API = {
    async ensureReady(){
      const id = getSheetId();
      if (!id) throw new Error('no spreadsheetId in __LM_SHEET_CTX');
      await ensureSheet(id);
      return true;
    },
    async upsert(payload){
      const id = getSheetId();
      if (!id) throw new Error('no spreadsheetId in __LM_SHEET_CTX');
      await upsertRow(id, payload);
    }
  };
  window.LM_MaterialsPersist = API;

  // Auto-init on events
  function onCtx(){
    API.ensureReady().catch(e=>warn('ensureSheet error:', e.message||e));
  }
  window.addEventListener('lm:auth-ready', onCtx);
  window.addEventListener('lm:sheet-context', onCtx);

  log('loaded');
})();
