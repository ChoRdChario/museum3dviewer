/* materials.sheet.bridge.js
 * LociMyu - Materials Sheet Bridge (ensure/create, load, upsert)
 * Requires:
 *  - window.__lm_fetchJSONAuth(url, init) provided by boot after sign-in
 *  - event 'lm:sheet-context' with { spreadsheetId, sheetGid? }
 */
(function(){
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);
  const err  = (...a)=>console.error('[mat-sheet]', ...a);

  const SheetTitle   = '__LM_MATERIALS';
  const Header = [
    'key','modelKey','materialKey','opacity','doubleSided','unlit',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'updatedAt','updatedBy','spreadsheetId','sheetGid'
  ];

  const S = {
    spreadsheetId: null,
    title: SheetTitle,
    sheetId: null, // numeric
    headerReady: false,
  };

  // ===== Utils =====
  function nowIso(){ return new Date().toISOString(); }
  function toBool(x){ if (typeof x==='boolean') return x; if (x==null) return false;
    const s=String(x).toLowerCase(); return s==='1'||s==='true'||s==='yes'; }
  function asFloat(x, def=null){ const n=parseFloat(x); return Number.isFinite(n)?n:def; }

  async function waitAuthFetch(ms=10000) {
    const t0 = Date.now();
    while (typeof window.__lm_fetchJSONAuth !== 'function') {
      await new Promise(r => setTimeout(r, 100));
      if (Date.now() - t0 > ms) break;
    }
    return window.__lm_fetchJSONAuth || null;
  }

  async function fjson(url, init){
    const fx = await waitAuthFetch(10000);
    if (!fx) throw new Error('__lm_fetchJSONAuth missing');
    return fx(url, init);
  }

  function gv(base, params){
    const usp = new URLSearchParams(params);
    return `${base}?${usp.toString()}`;
  }

  // ===== Sheet ensure =====
  async function ensureSheet(){
    if (!S.spreadsheetId) throw new Error('spreadsheetId missing');
    // 1) get spreadsheet metadata
    const meta = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}`, {
      includeGridData: false
    }), { method:'GET' });

    const sheets = meta?.sheets || [];
    let target = sheets.find(s => s?.properties?.title === S.title);
    if (!target){
      // create
      const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: S.title } } }] })
      });
      target = (res?.replies?.[0]?.addSheet) || null;
      log('sheet created:', S.title);
    }
    S.sheetId = target?.properties?.sheetId;

    // 2) header row check
    const hdr = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {}), { method:'GET' });
    const row = (hdr?.values && hdr.values[0]) || [];
    const same = Header.length === row.length && Header.every((h,i)=>row[i]===h);
    if (!same){
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {
        valueInputOption:'RAW'
      }), {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ values:[Header] })
      });
      log('header initialized for', S.title);
    }
    S.headerReady = true;
  }

  // ===== Load all -> map by materialKey =====
  async function loadAll(){
    await ensureSheet();
    const res = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A2:N')}`, {}), { method:'GET' });
    const rows = res?.values || [];
    const map = new Map();
    for (const r of rows){
      const [
        key='', modelKey='', materialKey='', opacity='', doubleSided='',
        unlit='', chromaEnable='', chromaColor='', chromaTolerance='',
        chromaFeather='', updatedAt='', updatedBy='', spreadsheetId='', sheetGid=''
      ] = r;
      if (!materialKey) continue;
      map.set(materialKey, {
        key, modelKey, materialKey,
        opacity: asFloat(opacity, null),
        doubleSided: toBool(doubleSided),
        unlit: toBool(unlit),
        chromaEnable: toBool(chromaEnable),
        chromaColor: chromaColor || '',
        chromaTolerance: asFloat(chromaTolerance, null),
        chromaFeather: asFloat(chromaFeather, null),
        updatedAt, updatedBy, spreadsheetId, sheetGid
      });
    }
    return map;
  }

  // ===== Upsert one (by materialKey) =====
  async function upsertOne(item){
    await ensureSheet();
    // 1) find existing row index by reading materialKey column
    const rangeAll = `${S.title}!C2:C`;
    const res = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(rangeAll)}`, {}), { method:'GET' });
    const keys = (res?.values || []).map(v=>v[0]);
    const idx = keys.indexOf(item.materialKey); // 0-based within C2:C

    const row = [
      item.key || `${item.modelKey||''}:${item.materialKey||''}`,
      item.modelKey || '',
      item.materialKey || '',
      item.opacity==null ? '' : String(item.opacity),
      item.doubleSided ? '1':'',
      item.unlit ? '1':'',
      item.chromaEnable ? '1':'',
      item.chromaColor || '',
      item.chromaTolerance==null ? '' : String(item.chromaTolerance),
      item.chromaFeather==null ? '' : String(item.chromaFeather),
      item.updatedAt || nowIso(),
      item.updatedBy || 'app',
      S.spreadsheetId || '',
      String(S.sheetId ?? '')
    ];

    if (idx >= 0){
      // update at row (C2 is rowIndex=0 -> sheet row = 2)
      const rowNum = idx + 2;
      const range = `${S.title}!A${rowNum}:N${rowNum}`;
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(range)}`, {
        valueInputOption:'RAW'
      }), {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ values: [row] })
      });
      log('updated row', rowNum, item.materialKey);
    } else {
      // append
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A:N')}`, {
        valueInputOption:'RAW',
        insertDataOption:'INSERT_ROWS'
      }), {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ values: [row], majorDimension: 'ROWS' })
      });
      log('appended', item.materialKey);
    }
  }

  // ===== Listen sheet-context =====
  window.addEventListener('lm:sheet-context', (ev)=>{
    const d = ev?.detail || ev;
    if (!d?.spreadsheetId) { warn('sheet-context missing spreadsheetId'); return; }
    S.spreadsheetId = d.spreadsheetId;
    if (Number.isFinite(+d.sheetGid)) S.sheetId = +d.sheetGid;
    log('sheet-context bound:', S.spreadsheetId, 'gid=', S.sheetId||0);
  }, { once:false });

  // ===== export =====
  window.materialsSheetBridge = {
    ensureSheet,
    loadAll,
    upsertOne,
    config: S,
  };
})();