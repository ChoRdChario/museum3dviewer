// share.views.read.js
// Read-only loader for __LM_VIEWS (applies last saved view for the currently selected caption sheet).
// - NO header ensure
// - NO writes
// - Applies: camera state (incl projection), background color
//
// Expects: window.__lm_fetchJSONAuth (GET-only in share), and viewer bridge exports on window.__LM_VIEWER_BRIDGE__.

const TAG='[share.views.read]';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }

function getBridge(){
  return window.__LM_VIEWER_BRIDGE__ || window.__lm_viewer_bridge || window.__lm_viewerBridge || window.__lm_viewer || null;
}

function parseNum(v, fallback=0){
  const n = Number(v);
  return (isFinite(n) ? n : fallback);
}

function normHex(hex){
  if (hex == null) return null;
  let s = String(hex).trim();
  if (!s) return null;
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s.split('').map(c=>c+c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#'+s.toLowerCase();
}

function rowToState(row){
  if (!row || row.length < 15) return null;
  const cameraType = String(row[4]||'').toLowerCase();
  const eye = { x: parseNum(row[5]), y: parseNum(row[6]), z: parseNum(row[7]) };
  const target = { x: parseNum(row[8]), y: parseNum(row[9]), z: parseNum(row[10]) };
  const up = { x: parseNum(row[11], 0), y: parseNum(row[12], 1), z: parseNum(row[13], 0) };
  const fov = (row[14] === '' || row[14] == null) ? undefined : parseNum(row[14], undefined);
  const bgColor = normHex(row[3] || '') || null;
  const st = { type: cameraType || undefined, eye, target, up };
  if (typeof fov === 'number' && isFinite(fov)) st.fov = fov;
  return { state: st, bgColor };
}

async function readAllViewsRows(spreadsheetId){
  const fetchJSON = window.__lm_fetchJSONAuth;
  if (typeof fetchJSON !== 'function') throw new Error(TAG+' missing __lm_fetchJSONAuth');
  const range = encodeURIComponent('__LM_VIEWS!A:Q');
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const data = await fetchJSON(url);
  return (data?.values || []);
}

async function applyLastView(ctx){
  try{
    const b = getBridge();
    if (!b) return false;
    if (!ctx || !ctx.spreadsheetId || ctx.sheetGid == null) return false;

    const rows = await readAllViewsRows(ctx.spreadsheetId);
    if (!rows || rows.length < 2) return false;

    const gid = String(ctx.sheetGid);
    let best = null;
    for (let i=1; i<rows.length; i++){
      const r = rows[i] || [];
      const rgid = String(r[1]||'');
      const name = String(r[2]||'');
      if (rgid === gid && (name === '__last' || name === '_last' || name === 'last')){
        const upd = String(r[16]||'');
        if (!best || (upd && upd > best.upd)){
          best = { row: r, upd };
        }
      }
    }
    if (!best) return false;

    const parsed = rowToState(best.row);
    if (!parsed || !parsed.state) return false;

    if (typeof b.setCameraState === 'function'){
      try{ b.setCameraState(parsed.state); }catch(e){ warn('setCameraState failed', e); }
    }
    if (typeof b.setBackgroundColor === 'function'){
      try{ b.setBackgroundColor(parsed.bgColor ? parsed.bgColor : ''); }catch(e){ warn('setBackgroundColor failed', e); }
    }
    log('applied __LM_VIEWS last', { sheetGid: ctx.sheetGid });
    return true;
  }catch(e){
    warn('applyLastView failed', e);
    return false;
  }
}

let __lastKey = '';
function keyOf(ctx){
  if (!ctx) return '';
  // sheetGid can be 0 (first sheet). Preserve 0 by avoiding || fallback.
  const sid = (ctx.spreadsheetId == null) ? '' : String(ctx.spreadsheetId);
  const gid = (ctx.sheetGid == null) ? '' : String(ctx.sheetGid);
  return sid + ':' + gid;
}

function scheduleApply(ctx){
  // delay until viewer is likely ready; retry a few times.
  const delays = [250, 800, 2000];
  delays.forEach((ms)=>{
    setTimeout(()=>{ try{ applyLastView(ctx); }catch(_e){} }, ms);
  });
}

document.addEventListener('lm:sheet-context', (ev)=>{
  const ctx = ev?.detail || window.__LM_SHEET_CTX__ || null;
  const k = keyOf(ctx);
  if (!k || k === __lastKey) return;
  __lastKey = k;
  scheduleApply(ctx);
});

log('armed');
