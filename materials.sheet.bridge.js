/* materials.sheet.bridge.js
 * LociMyu - Materials Sheet Bridge (create-if-missing / load / upsert one)
 * Requires:
 *  - Authenticated fetch function. Prefers window.__lm_fetchJSONAuth; if absent,
 *    falls back to dynamic import('./gauth.module.js') and uses getAccessToken().
 *  - Event 'lm:sheet-context' with { spreadsheetId, sheetGid? }.
 */
(function(){
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);
  const err  = (...a)=>console.error('[mat-sheet]', ...a);

  const SHEET_TITLE = '__LM_MATERIALS';
  const HEADER = [
    'key','modelKey','materialKey','opacity','doubleSided','unlit',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'updatedAt','updatedBy','spreadsheetId','sheetGid'
  ];

  const S = {
    spreadsheetId: null,
    sheetGid: null,
    title: SHEET_TITLE,
    sheetId: null, // numeric
    headerReady: false,
  };

  function nowIso(){ return new Date().toISOString(); }
  function toBool(x){ if (typeof x==='boolean') return x; if (x==null) return false;
    const s=String(x).toLowerCase(); return s==='1'||s==='true'||s==='yes'; }
  function asFloat(x, def=null){ const n=parseFloat(x); return Number.isFinite(n)?n:def; }

  // ---- Authenticated fetch resolver ---------------------------------------
  async function getAuthFetch(){
    // 1) Preferred: provided by boot
    const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
    for (let i=0;i<100;i++){ // up to ~10s
      if (typeof window.__lm_fetchJSONAuth === 'function'){
        return window.__lm_fetchJSONAuth;
      }
      await wait(100);
    }
    // 2) Fallback: dynamic import gauth.module.js and use token
    try{
      const g = await import('./gauth.module.js');
      if (typeof g.getAccessToken === 'function'){
        return async (url, init={})=>{
          const tok = await g.getAccessToken();
          const headers = new Headers(init.headers||{});
          headers.set('Authorization', 'Bearer ' + tok);
          headers.set('Accept', 'application/json');
          const res = await fetch(url, {...init, headers});
          if (!res.ok){
            const text = await res.text().catch(()=>'');
            throw new Error(`fetch ${res.status}: ${text.slice(0,200)}`);
          }
          return res.json();
        };
      }
    }catch(e){
      warn('gauth fallback failed', e);
    }
    throw new Error('__lm_fetchJSONAuth missing');
  }

  function gv(base, params){
    const usp = new URLSearchParams(params);
    return `${base}?${usp.toString()}`;
  }

  // ===== Sheet ensure =====
  async function ensureSheet(){
    if (!S.spreadsheetId) throw new Error('spreadsheetId missing');
    const fjson = await getAuthFetch();

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
    S.sheetId = target?.properties?.sheetId ?? S.sheetId;

    // 2) header row check
    const hdr = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {}), { method:'GET' });
    const row = (hdr?.values && hdr.values[0]) || [];
    const same = HEADER.length === row.length && HEADER.every((h,i)=>row[i]===h);
    if (!same){
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {
        valueInputOption:'RAW'
      }), {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ values:[HEADER] })
      });
      log('header initialized for', S.title);
    }
    S.headerReady = true;
  }

  // ===== Load all -> map by materialKey =====
  async function loadAll(){
    await ensureSheet();
    const fjson = await getAuthFetch();
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
    const fjson = await getAuthFetch();

    // 0) derive row values
    const row = [
      item.key || `${item.modelKey||''}:${item.materialKey||''}`,
      item.modelKey || '',
      item.materialKey || '',
      item.opacity==null ? '' : String(item.opacity),
      item.doubleSided ? '1' : '',
      item.unlit ? '1' : '',
      item.chromaEnable ? '1' : '',
      item.chromaColor || '',
      item.chromaTolerance==null ? '' : String(item.chromaTolerance),
      item.chromaFeather==null ? '' : String(item.chromaFeather),
      item.updatedAt || nowIso(),
      item.updatedBy || 'app',
      S.spreadsheetId || '',
      String(S.sheetGid ?? '')
    ];

    // 1) find existing row index by reading materialKey column
    const rangeAll = `${S.title}!C2:C`; // materialKey
    const res = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(rangeAll)}`, {}), { method:'GET' });
    const keys = (res?.values || []).map(v=>v[0]);
    const idx = keys.indexOf(item.materialKey); // 0-based within C2:C

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
    if (d.sheetGid != null) S.sheetGid = d.sheetGid;
    log('sheet-context bound:', S.spreadsheetId, 'gid=', S.sheetGid);
  }, { once:false });

  // ===== export =====
  window.materialsSheetBridge = {
    ensureSheet,
    loadAll,
    upsertOne,
    config: S,
  };
})();