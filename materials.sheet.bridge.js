
/* materials.sheet.bridge.js — V6_15i_FIX_PACK
 * Exposes window.materialsSheetBridge { ensureSheet, loadAll, upsertOne }
 * Listens to 'lm:sheet-context' and emits 'lm:materials-bridge-ready' on first bind.
 */
(function(){
  const LOG = '[mat-sheet]';
  const SHEET_NAME = '__LM_MATERIALS';
  const HEADER = [
    'materialKey','name','opacity','unlit','doubleSided',
    'chromaColor','chromaThreshold','chromaFeather',
    'updatedAt','updatedBy','sheetGid','modelKey'
  ];
  let ctx = { spreadsheetId:null, sheetGid:null };
  let ready = false;
  let ensuring = null;

  const log  = (...a)=>{ try{ console.log(LOG, ...a);}catch(e){} };
  const warn = (...a)=>{ try{ console.warn(LOG, ...a);}catch(e){} };

  function fjson(url, opts={}){
    if (typeof window.__lm_fetchJSONAuth !== 'function'){
      throw new Error('__lm_fetchJSONAuth missing');
    }
    return window.__lm_fetchJSONAuth(url, opts);
  }

  async function getOrCreateSheet(spreadsheetId){
    const murl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`;
    const meta = await fjson(murl, { method:'GET' });
    const sheets = (meta && meta.sheets) ? meta.sheets : [];
    for (const s of sheets){
      const p = s.properties;
      if (p && p.title === SHEET_NAME) return p.sheetId;
    }
    const burl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const body = { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] };
    const r = await fjson(burl, { method:'POST', body: JSON.stringify(body) });
    const added = r && r.replies && r.replies[0] && r.replies[0].addSheet && r.replies[0].addSheet.properties;
    return added ? added.sheetId : null;
  }

  async function ensureHeader(spreadsheetId){
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!1:1?majorDimension=ROWS`;
    const got = await fjson(getUrl, { method:'GET' });
    const row = (got && got.values && got.values[0]) ? got.values[0] : [];
    const same = HEADER.length === row.length && HEADER.every((h,i)=> String(row[i]||'')===h);
    if (same) return true;
    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!1:1?valueInputOption=RAW`;
    const body = { range:`${SHEET_NAME}!1:1`, majorDimension:'ROWS', values:[HEADER] };
    await fjson(putUrl, { method:'PUT', body: JSON.stringify(body) });
    return true;
  }

  async function ensureSheet(){
    if (!ctx.spreadsheetId) throw new Error('spreadsheetId missing');
    if (ensuring) return ensuring;
    ensuring = (async ()=>{
      await getOrCreateSheet(ctx.spreadsheetId);
      await ensureHeader(ctx.spreadsheetId);
      return true;
    })();
    return ensuring;
  }

  async function loadAll(){
    await ensureSheet();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ctx.spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}?majorDimension=ROWS`;
    const j = await fjson(url, { method:'GET' });
    const rows = (j && j.values) ? j.values : [];
    if (rows.length <= 1) return new Map();
    const map = new Map();
    for (let r=1; r<rows.length; r++){
      const row = rows[r];
      const obj = {};
      HEADER.forEach((h,i)=> obj[h] = row[i] ?? '');
      if (obj.opacity !== '') obj.opacity = Number(obj.opacity);
      obj.unlit = obj.unlit === '' ? '' : Number(obj.unlit);
      obj.doubleSided = obj.doubleSided === '' ? '' : Number(obj.doubleSided);
      const key = obj.materialKey || obj.name || `row${r}`;
      map.set(key, obj); // last wins
    }
    return map;
  }

  async function upsertOne(record){
    await ensureSheet();
    const row = [
      record.materialKey ?? '',
      record.name ?? '',
      record.opacity ?? '',
      record.unlit ?? '',
      record.doubleSided ?? '',
      record.chromaColor ?? '',
      record.chromaThreshold ?? '',
      record.chromaFeather ?? '',
      new Date().toISOString(),
      'ui',
      String(ctx.sheetGid ?? ''),
      record.modelKey ?? ''
    ];
    const range = `${SHEET_NAME}!A:A`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ctx.spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const body = { range, majorDimension:'ROWS', values:[row] };
    return await fjson(url, { method:'POST', body: JSON.stringify(body) });
  }

  function onSheetContext(ev){
    const d = ev && ev.detail ? ev.detail : ev;
    if (!d || !d.spreadsheetId) return;
    ctx.spreadsheetId = d.spreadsheetId;
    ctx.sheetGid = d.sheetGid ?? d.gid ?? null;
    log('sheet-context bound:', ctx.spreadsheetId, 'gid=', ctx.sheetGid||0);
    if (!ready){
      ready = true;
      document.dispatchEvent(new CustomEvent('lm:materials-bridge-ready'));
      log('ready');
    }
  }

  // Expose API
  window.materialsSheetBridge = window.materialsSheetBridge || { ensureSheet, loadAll, upsertOne };

  // Bind listeners
  document.addEventListener('lm:sheet-context', onSheetContext);
  if (window.__lm_last_sheet_context){
    try { onSheetContext({ detail: window.__lm_last_sheet_context }); } catch(e){}
  }

  log('cache wrapper installed');
})();
