// materials.sheet.persist.js
// LociMyu per-material persistence (Sheets/local) — v1.4
(function(){
  const TAG = '[mat-sheet-persist v1.4]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);
  const err  = (...a)=>console.error(TAG, ...a);

  // Public surface
  const API = { ctx:null, ensure: ensureSheetAndHeaders, upsert };

  // Expose version and API
  window.__LM_MAT_PERSIST_VERSION__ = '1.4';
  window.__LM_MAT_PERSIST = API;
  log('loaded');

  // Listen sheet context
  window.addEventListener('lm:sheet-context', (e)=>{
    const ctx = e?.detail || window.__LM_SHEET_CTX || null;
    if (ctx && ctx.spreadsheetId) {
      API.ctx = { spreadsheetId: ctx.spreadsheetId, sheetGid: ctx.sheetGid || 0 };
      log('ctx set', API.ctx);
      ensureSheetAndHeaders().catch(err);
    } else {
      warn('ensureSheet error: no spreadsheetId in __LM_SHEET_CTX');
    }
  });

  // Try ensure on auth-ready too (in case context was set before)
  window.addEventListener('lm:auth-ready', ()=> {
    if (API.ctx?.spreadsheetId) ensureSheetAndHeaders().catch(err);
  });

  async function fetchJSONAuth(url, init={}){
    if (typeof window.__lm_fetchJSONAuth !== 'function'){
      // Wait briefly for shim injection
      await new Promise(r => setTimeout(r, 50));
      if (typeof window.__lm_fetchJSONAuth !== 'function'){
        throw new Error('__lm_fetchJSONAuth not present');
      }
    }
    return window.__lm_fetchJSONAuth(url, init);
  }

  async function ensureSheetAndHeaders(){
    const sheetId = API.ctx?.spreadsheetId;
    if (!sheetId) throw new Error('no spreadsheetId in __LM_SHEET_CTX');

    // Check sheets
    const meta = await fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`);
    const titles = (meta.sheets||[]).map(s => s.properties.title);
    const MAT_SHEET = '__LM_MATERIALS';

    if (!titles.includes(MAT_SHEET)){
      try {
        await fetchJSONAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title: MAT_SHEET } } }] } }
        );
        log('created sheet & headers');
      } catch (e){
        // Allow "already exists" error to pass
        err(e);
      }
    } else {
      log('sheet exists');
    }

    // Ensure headers A..M (reserve future columns)
    const headers = [
      'materialKey','opacity','doubleSided','unlitLike',
      'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
      'roughness','metalness','emissiveHex',
      'updatedAt','updatedBy'
    ];
    await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('__LM_MATERIALS!A1:M1')}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[headers] } }
    );
    log('headers ensured A:M');
  }

  // Upsert a row for a given materialKey
  async function upsert(payload){
    const sheetId = API.ctx?.spreadsheetId;
    if (!sheetId) throw new Error('no spreadsheetId in __LM_SHEET_CTX');

    const {
      materialKey, opacity,
      doubleSided=false, unlitLike=false,
      chromaEnable=false, chromaColor='#000000', chromaTolerance=0, chromaFeather=0,
      roughness='', metalness='', emissiveHex='', updatedBy='mat-ui'
    } = payload || {};
    if (!materialKey) throw new Error('materialKey required');

    // Make sure header exists before writing any row
    await ensureSheetAndHeaders();

    // Read column A keys
    const colA = await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('__LM_MATERIALS!A:A')}`
    );
    const rows = colA.values || []; // [[header],[key],...]
    let rowIndex = rows.findIndex(r => (r[0]||'') === materialKey);
    let rowNumber;
    if (rowIndex <= 0) {
      rowNumber = rows.length + 1;
      await fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`__LM_MATERIALS!A${rowNumber}:A${rowNumber}`)}?valueInputOption=RAW`,
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
    const rangeBM = `__LM_MATERIALS!B${rowNumber}:M${rowNumber}`;
    await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(rangeBM)}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[rowValues] } }
    );
    log('persisted', {rowNumber, materialKey, opacity});
  }
})();
