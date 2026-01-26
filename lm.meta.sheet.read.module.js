// lm.meta.sheet.read.module.js
// Read-only metadata access for drive.file mode.
// Purpose: allow Share mode to read minimal dataset metadata without importing any write-capable code.
//
// Reads key/value pairs from dedicated tab: __LM_META (A=key, B=value)
//
// Exports:
//   - readMeta(spreadsheetId) -> Map
//   - getGlbFileId(spreadsheetId) -> string|null

const TAG='[lm-meta-ro]';
const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';

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

export async function readMeta(spreadsheetId){
  const map = new Map();
  if (!spreadsheetId) return map;
  const fetchJSON = await getAuthFetch();
  const range = '__LM_META!A1:B50';
  try{
    const res = await fetchJSON(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
    const rows = Array.isArray(res?.values) ? res.values : [];
    for (let i=0;i<rows.length;i++){
      const r = rows[i];
      if (!Array.isArray(r) || r.length < 2) continue;
      const k = String(r[0]??'').trim();
      const v = String(r[1]??'').trim();
      if (!k) continue;
      if (i===0 && (k === 'key' || k === 'Key')) continue;
      if (v) map.set(k, v);
    }
  }catch(e){
    // Missing sheet / access issues: treat as empty (caller handles absence).
    warn('readMeta failed', e);
  }
  return map;
}

export async function getGlbFileId(spreadsheetId){
  const map = await readMeta(spreadsheetId);
  return map.get('glbFileId') || null;
}
