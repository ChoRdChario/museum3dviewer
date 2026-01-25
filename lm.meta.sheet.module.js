// lm.meta.sheet.module.js
// Minimal metadata store for drive.file mode.
// Stores key/value pairs in a dedicated tab: __LM_META (columns A=key, B=value)
//
// Current keys:
//   - glbFileId
//
// Exports:
//   - readMeta(spreadsheetId) -> Map
//   - getGlbFileId(spreadsheetId) -> string|null
//   - ensureMetaSheet(spreadsheetId) -> void
//   - writeMeta(spreadsheetId, key, value) -> void

const TAG='[lm-meta]';
const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }

async function getAuthFetch(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  try{
    const m = await import('./auth.fetch.bridge.js');
    const fn = m && (m.default || m.ensureAuthBridge || m);
    if (typeof fn === 'function') return await fn();
  }catch(_e){}
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  throw new Error('auth fetch missing');
}

async function listSheets(spreadsheetId){
  const fetchJSON = await getAuthFetch();
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`;
  const data = await fetchJSON(url);
  return (data?.sheets||[]).map(s=>({
    gid: s?.properties?.sheetId,
    title: s?.properties?.title || ''
  })).filter(s=>s.gid!=null && s.title);
}

export async function ensureMetaSheet(spreadsheetId){
  if (!spreadsheetId) return;
  const sheets = await listSheets(spreadsheetId);
  if (sheets.some(s=>s.title === '__LM_META')) return;

  const fetchJSON = await getAuthFetch();
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  try{
    await fetchJSON(url, {
      method: 'POST',
      json: { requests: [{ addSheet: { properties: { title: '__LM_META', gridProperties: { rowCount: 50, columnCount: 2 } } } }] }
    });
    // Initialize header row (optional)
    await fetchJSON(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent('__LM_META!A1:B1')}?valueInputOption=RAW`, {
      method: 'PUT',
      json: { values: [['key','value']] }
    });
    log('created __LM_META');
  }catch(e){
    warn('ensureMetaSheet failed', e);
  }
}

export async function readMeta(spreadsheetId){
  const map = new Map();
  if (!spreadsheetId) return map;
  const fetchJSON = await getAuthFetch();
  const range = '__LM_META!A1:B50';
  try{
    const res = await fetchJSON(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
    const rows = Array.isArray(res?.values) ? res.values : [];
    // Skip header if present
    for (let i=0;i<rows.length;i++){
      const r = rows[i];
      if (!Array.isArray(r) || r.length < 2) continue;
      const k = String(r[0]??'').trim();
      const v = String(r[1]??'').trim();
      if (!k) continue;
      if (i===0 && (k === 'key' || k === 'Key')) continue;
      if (v) map.set(k, v);
    }
  }catch(_e){
    // Missing sheet is common for older datasets; treat as empty.
  }
  return map;
}

export async function getGlbFileId(spreadsheetId){
  const map = await readMeta(spreadsheetId);
  return map.get('glbFileId') || null;
}

export async function writeMeta(spreadsheetId, key, value){
  if (!spreadsheetId || !key) return;
  await ensureMetaSheet(spreadsheetId);

  const fetchJSON = await getAuthFetch();
  const range = '__LM_META!A2:B50';
  // Read existing keys to find row
  let rowIndex = null;
  try{
    const res = await fetchJSON(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
    const rows = Array.isArray(res?.values) ? res.values : [];
    for (let i=0;i<rows.length;i++){
      const r = rows[i];
      const k = String((r && r[0]) ?? '').trim();
      if (k === key){ rowIndex = 2 + i; break; }
    }
  }catch(_e){}

  if (rowIndex == null){
    // append at first empty row
    rowIndex = 2;
    try{
      const res = await fetchJSON(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
      const rows = Array.isArray(res?.values) ? res.values : [];
      rowIndex = 2 + rows.length;
    }catch(_e){}
  }

  const putRange = `__LM_META!A${rowIndex}:B${rowIndex}`;
  await fetchJSON(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(putRange)}?valueInputOption=RAW`, {
    method: 'PUT',
    json: { values: [[String(key), String(value ?? '')]] }
  });
  log('meta updated', key, '->', String(value||''));
}
