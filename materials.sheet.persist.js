
/*!
 * materials.sheet.persist.js v1.4
 * - Listens to `lm:sheet-context` and uses e.detail if provided
 * - Falls back to window.__LM_SHEET_CTX
 * - Waits for __lm_fetchJSONAuth and ctx before doing work
 * - Idempotent sheet creation + A:M headers
 * - Safe to call upsert() before ctx/auth are fully ready (will retry)
 */
(function(){
  const LOG = (...a)=>console.log('[mat-sheet-persist v1.4]', ...a);
  const WARN = (...a)=>console.warn('[mat-sheet-persist v1.4]', ...a);

  const MAT_SHEET = '__LM_MATERIALS';
  const HEADERS_AM = [
    'materialKey','opacity','doubleSided','unlitLike',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'roughness','metalness','emissiveHex',
    'updatedAt','updatedBy'
  ]; // A..M

  let ctx = null;         // { spreadsheetId, sheetGid }
  let readyCtxResolve;
  const readyCtx = new Promise(res=>readyCtxResolve=res);

  let authResolve;
  const readyAuth = new Promise(res=>authResolve=res);

  // expose version
  try { window.__LM_MAT_PERSIST_VERSION__ = '1.4'; } catch(e){}

  // Detect/await auth helper (__lm_fetchJSONAuth)
  function waitAuthHelper(timeoutMs=15000){
    if (typeof window.__lm_fetchJSONAuth === 'function') return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const t0 = performance.now();
      const iv = setInterval(()=>{
        if (typeof window.__lm_fetchJSONAuth === 'function'){
          clearInterval(iv); resolve();
        } else if (performance.now() - t0 > timeoutMs){
          clearInterval(iv); reject(new Error('__lm_fetchJSONAuth not present'));
        }
      }, 50);
    });
  }

  async function fetchJSON(url, init){ return window.__lm_fetchJSONAuth(url, init); }

  // Context handling
  function setCtx(cand){
    if (!cand) cand = window.__LM_SHEET_CTX || null;
    if (cand && cand.spreadsheetId){
      ctx = { spreadsheetId: cand.spreadsheetId, sheetGid: cand.sheetGid || 0 };
      readyCtxResolve?.(ctx);
      LOG('ctx set', ctx);
      return true;
    }
    return false;
  }

  window.addEventListener('lm:sheet-context', (e)=>{
    const ok = setCtx(e && e.detail);
    if (!ok) WARN('sheet-context received but invalid detail', e && e.detail);
    else { /* kick ensure on fresh ctx */ ensureSheetAndHeaders().catch(()=>{}); }
  }, {capture:true});

  // In case event fired earlier
  setCtx();

  // Some apps also signal auth-ready; we resolve the helper wait here too
  window.addEventListener('lm:auth-ready', ()=>{
    waitAuthHelper().then(()=>authResolve()).catch(WARN);
  }, {capture:true});

  // Also proactively try
  waitAuthHelper().then(()=>authResolve()).catch(WARN);

  async function ensureSheetAndHeaders(){
    await readyCtx;
    await readyAuth;

    const SHEET_ID = ctx?.spreadsheetId;
    if (!SHEET_ID) throw new Error('no spreadsheetId in __LM_SHEET_CTX');

    // get spreadsheet meta
    const meta = await fetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`);
    const titles = (meta.sheets||[]).map(s=>s.properties.title);

    // add sheet if missing
    if (!titles.includes(MAT_SHEET)){
      try{
        await fetchJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
          { method:'POST', body:{ requests:[{ addSheet:{ properties:{ title: MAT_SHEET } } }] } }
        );
        LOG('created sheet');
      }catch(err){
        // if already exists (race), ignore
        const msg = (''+err).toLowerCase();
        if (!msg.includes('already exists') && !msg.includes('すでに存在')) throw err;
        LOG('sheet exists (race)');
      }
    } else {
      LOG('sheet exists');
    }

    // write headers (A:M)
    await fetchJSON(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MAT_SHEET+'!A1:M1')}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[HEADERS_AM] } }
    );
    LOG('headers ensured A:M');
  }

  async function upsertCore({ materialKey, opacity= '', doubleSided=false, unlitLike=false,
    chromaEnable=false, chromaColor='#000000', chromaTolerance=0, chromaFeather=0,
    roughness='', metalness='', emissiveHex='', updatedBy='mat-ui' }){

    await ensureSheetAndHeaders();

    const SHEET_ID = ctx?.spreadsheetId;
    if (!SHEET_ID) throw new Error('no spreadsheetId in __LM_SHEET_CTX');
    if (!materialKey) throw new Error('materialKey required');

    // A列 fetch
    const colA = await fetchJSON(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MAT_SHEET+'!A:A')}`
    );
    const rows = colA.values || [];
    let rowIndex = rows.findIndex(r => (r[0]||'') === materialKey);
    let rowNumber;
    if (rowIndex <= 0){
      rowNumber = rows.length + 1;
      await fetchJSON(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${MAT_SHEET}!A${rowNumber}:A${rowNumber}`)}?valueInputOption=RAW`,
        { method:'PUT', body:{ values:[[materialKey]] } }
      );
    } else {
      rowNumber = rowIndex + 1;
    }

    const iso = new Date().toISOString();
    const rowValues = [
      opacity,
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
    await fetchJSON(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rangeBM)}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[rowValues] } }
    );
    LOG('persisted', {rowNumber, materialKey, opacity});
  }

  // public API
  window.LM_MaterialsPersist = {
    ensure: ensureSheetAndHeaders,
    setContext: setCtx,
    upsert: (payload)=> upsertCore(payload).catch(err=>{ WARN('upsert failed', err); throw err; }),
  };

  LOG('loaded');
})();
