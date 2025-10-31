
/* materials.sheet.bridge.js
 * LociMyu - Materials Sheet Bridge (create-if-missing / load / upsert one)
 * Requires:
 *  - window.__lm_fetchJSONAuth(url, init) (provided by boot)
 *  - event 'lm:sheet-context' with { spreadsheetId, sheetGid? }
 */
(function(){
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);

  const SheetTitle = 'materials';
  const Header = [
    'materialKey','name','opacity','unlit','doubleSided',
    'chromaColor','chromaThreshold','chromaFeather','updatedAt','updatedBy'
  ];

  const S = {
    spreadsheetId: null,
    title: SheetTitle,
    sheetId: null,
    headerReady: false,
  };

  function nowIso(){ return new Date().toISOString(); }
  function toBool(x){ if (typeof x==='boolean') return x; if (x==null) return false;
    const s=String(x).toLowerCase(); return s==='1'||s==='true'||s==='yes'; }
  function asFloat(x, def=null){ const n=parseFloat(x); return Number.isFinite(n)?n:def; }

  function fjson(url, init){
    if (typeof window.__lm_fetchJSONAuth !== 'function'){
      throw new Error('__lm_fetchJSONAuth missing');
    }
    return window.__lm_fetchJSONAuth(url, init);
  }

  function gv(base, params){
    const usp = new URLSearchParams(params);
    return `${base}?${usp.toString()}`;
  }

  // ===== Sheet ensure =====
  async function ensureSheet(){
    if (!S.spreadsheetId) throw new Error('spreadsheetId missing');
    const meta = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}`, {
      includeGridData: false
    }), { method:'GET' });

    const sheets = meta?.sheets || [];
    let target = sheets.find(s => s?.properties?.title === S.title);
    if (!target){
      const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: S.title } } }] })
      });
      target = (res?.replies?.[0]?.addSheet) || null;
      log('sheet created:', S.title);
    }
    S.sheetId = target?.properties?.sheetId;

    // header row
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
    const res = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A2:J')}`, {}), { method:'GET' });
    const rows = res?.values || [];
    const map = new Map();
    for (const r of rows){
      const [
        materialKey='', name='', opacity='', unlit='', doubleSided='',
        chromaColor='', chromaThreshold='', chromaFeather='', updatedAt='', updatedBy=''
      ] = r;
      if (!materialKey) continue;
      map.set(materialKey, {
        materialKey,
        name,
        opacity: asFloat(opacity, null),
        unlit: toBool(unlit),
        doubleSided: toBool(doubleSided),
        chromaColor: chromaColor || '',
        chromaThreshold: asFloat(chromaThreshold, null),
        chromaFeather: asFloat(chromaFeather, null),
        updatedAt, updatedBy
      });
    }
    return map;
  }

  // ===== Upsert one (by materialKey) =====
  async function upsertOne(item){
    await ensureSheet();
    // find existing rowIndex by reading materialKey column
    const rangeAll = `${S.title}!A2:A`;
    const res = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(rangeAll)}`, {}), { method:'GET' });
    const keys = (res?.values || []).map(v=>v[0]);
    const idx = keys.indexOf(item.materialKey);

    const row = [
      item.materialKey || '',
      item.name || '',
      item.opacity==null ? '' : String(item.opacity),
      item.unlit ? '1':'',
      item.doubleSided ? '1':'',
      item.chromaColor || '',
      item.chromaThreshold==null ? '' : String(item.chromaThreshold),
      item.chromaFeather==null ? '' : String(item.chromaFeather),
      item.updatedAt || nowIso(),
      item.updatedBy || 'app'
    ];

    if (idx >= 0){
      const rowNum = idx + 2;
      const range = `${S.title}!A${rowNum}:J${rowNum}`;
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(range)}`, {
        valueInputOption:'RAW'
      }), {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ values: [row] })
      });
      log('updated row', rowNum, item.materialKey);
    } else {
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A:J')}`, {
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
    log('sheet-context bound:', S.spreadsheetId);
  }, { once:false });

  window.materialsSheetBridge = {
    ensureSheet, loadAll, upsertOne, config: S,
  };
})();
