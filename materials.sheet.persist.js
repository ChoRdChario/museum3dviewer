// [mat-sheet-persist v1.6] sheet context wait + robust I/O
(function(){
  const TAG = '[mat-sheet-persist v1.6]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);
  const err  = (...a)=>console.error(TAG, ...a);

  // ctx acquisition utilities
  function getCtxNow(){
    return (window.__LM_SHEET_CTX_HUB && window.__LM_SHEET_CTX_HUB.get()) || window.__LM_SHEET_CTX || null;
  }
  function waitCtx(timeout=8000){
    const now = getCtxNow();
    if (now) return Promise.resolve(now);
    return new Promise((resolve, reject)=>{
      const t = setTimeout(()=>{ reject(new Error('ctx timeout')); }, timeout);
      const handler = (e)=>{ clearTimeout(t); window.removeEventListener('lm:sheet-context', handler, true); resolve(e.detail); };
      window.addEventListener('lm:sheet-context', handler, { capture:true, once:true });
    });
  }

  async function fetchJSONAuth(url, init={}){
    if (typeof window.__lm_fetchJSONAuth !== 'function') throw new Error('__lm_fetchJSONAuth missing');
    return window.__lm_fetchJSONAuth(url, init);
  }

  const MAT_SHEET = '__LM_MATERIALS';

  async function ensureSheetAndHeaders(spreadsheetId){
    // check meta
    const meta = await fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const titles = (meta.sheets||[]).map(s=>s.properties.title);
    if (!titles.includes(MAT_SHEET)) {
      await fetchJSONAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title: MAT_SHEET } } }] } }
      );
      log('created sheet', MAT_SHEET);
    } else {
      log('sheet exists');
    }
    const headers = [
      'materialKey','opacity','doubleSided','unlitLike',
      'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
      'roughness','metalness','emissiveHex','updatedAt','updatedBy'
    ];
    await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A1:M1')}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[headers] } }
    );
    log('headers ensured A:M');
  }

  async function upsert(spreadsheetId, payload){
    const {
      materialKey, opacity,
      doubleSided=false, unlitLike=false,
      chromaEnable=false, chromaColor='#000000', chromaTolerance=0, chromaFeather=0,
      roughness='', metalness='', emissiveHex='',
      updatedBy='mat-ui'
    } = payload || {};

    if (!spreadsheetId) throw new Error('spreadsheetId missing');
    if (!materialKey) throw new Error('materialKey required');

    // A col scan
    const colA = await fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MAT_SHEET+'!A:A')}`
    );
    const rows = colA.values || [];
    let rowIndex = rows.findIndex(r => (r[0]||'') === materialKey);
    let rowNumber;
    if (rowIndex <= 0) {
      rowNumber = rows.length + 1;
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
    log('persisted', {rowNumber, materialKey, opacity});
    return rowNumber;
  }

  // public API
  const API = {
    async setCtx(ctx){
      if (ctx) {
        window.__LM_SHEET_CTX = ctx; // keep mirrored
        if (window.__LM_SHEET_CTX_HUB) window.__LM_SHEET_CTX_HUB.onCtx(ctx);
      }
      return getCtxNow();
    },
    async ensure(){
      const ctx = await waitCtx();
      const sid = ctx && ctx.spreadsheetId;
      if (!sid) throw new Error('no spreadsheetId in ctx');
      await ensureSheetAndHeaders(sid);
      return sid;
    },
    async upsert(payload){
      const ctx = await waitCtx();
      const sid = ctx && ctx.spreadsheetId;
      if (!sid) throw new Error('no spreadsheetId in ctx');
      await ensureSheetAndHeaders(sid);
      return upsert(sid, payload);
    }
  };

  // expose
  window.__LM_MAT_PERSIST = API;

  // auto-wire to reflect incoming ctx events
  window.addEventListener('lm:sheet-context', (e)=>{ API.setCtx(e.detail); }, { capture:true });

  log('loaded');
})();
