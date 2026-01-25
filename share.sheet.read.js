// share.sheet.read.js
// Share-mode read-only sheet reader (drive.file flow):
// - Uses a user-selected spreadsheet (lm:sheet-context)
// - Lists caption sheets (non __LM_* sheets) and populates dropdown
// - Loads captions from selected sheet and feeds __LM_CAPTION_UI.setItems()

const TAG = '[share.sheet.read]';
const gate = window.__LM_READY_GATE__;
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }
function err(...a){ console.error(TAG, ...a); }

function isSystemSheetTitle(title){
  if (!title) return false;
  return String(title).startsWith('__LM_');
}

function setStatus(msg){
  const el = document.querySelector('#save-status') || document.querySelector('#images-status');
  if (el) el.textContent = msg;
}

function setOptions(selectEl, opts){
  if (!selectEl) return;
  const cur = selectEl.value;
  selectEl.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Select sheet…';
  selectEl.appendChild(def);
  (opts||[]).forEach(o=>{
    const op=document.createElement('option');
    op.value = String(o.gid);
    op.textContent = o.title;
    selectEl.appendChild(op);
  });
  // restore if possible
  if (cur && Array.from(selectEl.options).some(o=>o.value===cur)) selectEl.value = cur;
}

async function listSheets(spreadsheetId){
  const fetchJSON = window.__lm_fetchJSONAuth;
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`;
  const data = await fetchJSON(url);
  const sheets = (data?.sheets || []).map(s=>({
    gid: s?.properties?.sheetId,
    title: s?.properties?.title || ''
  })).filter(s=>s.gid!=null && s.title);
  return sheets;
}

function dispatchSheetContext(spreadsheetId, sheetGid){
  try{
    window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail:{ spreadsheetId, sheetGid } }));
  }catch(_e){}
}

async function readSheetDisplayNameMap(spreadsheetId){
  // Reads optional displayName registry sheet: __LM_SHEET_NAMES
  // NOTE: The column order is defined by sheet-rename.module.js and may evolve.
  // Current canonical header is:
  // A: sheetGid, B: displayName, C: sheetTitle, D: updatedAt
  const map = new Map();
  if(!spreadsheetId) return map;

  const fetchJSON = window.__lm_fetchJSONAuth;
  if(typeof fetchJSON !== 'function') return map;

  // Read header row as well so we can resolve the column indices robustly.
  const range = '__LM_SHEET_NAMES!A1:D';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;

  try{
    const res = await fetchJSON(url);
    const rows = Array.isArray(res?.values) ? res.values : [];
    if(!rows.length) return map;

    // Header-aware parsing (preferred)
    const header = (rows[0] || []).map(v=>String(v||'').trim());
    const hasHeader = header.includes('sheetGid') || header.includes('displayName');

    let startRow = 0;
    let iGid = 0;
    let iDisplayName = 2; // historical fallback

    if(hasHeader){
      startRow = 1;
      const idx = (name)=> header.findIndex(h=>h===name);
      const gi = idx('sheetGid');
      const di = idx('displayName');
      if(gi >= 0) iGid = gi;
      if(di >= 0) iDisplayName = di;
    }

    for(const r of rows.slice(startRow)){
      if(!Array.isArray(r) || r.length < 2) continue;
      const gid = String(r[iGid] ?? '').trim();
      let displayName = String(r[iDisplayName] ?? '').trim();

      // If no header and the historical index doesn't produce a value,
      // try the canonical (sheet-rename.module.js) index=1.
      if(!hasHeader && !displayName && r.length >= 2){
        displayName = String(r[1] ?? '').trim();
      }

      if(gid && displayName) map.set(gid, displayName);
    }
  }catch(e){
    // Registry sheet may not exist; ignore.
  }
  return map;
}

async function readCaptionRows(spreadsheetId, sheetTitle){
  const fetchJSON = window.__lm_fetchJSONAuth;
  const range = `${sheetTitle}!A1:J`;
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const data = await fetchJSON(url);
  const values = data?.values || [];
  if (!values.length) return [];
  const header = (values[0] || []).map(v=>String(v||'').trim());
  const idx = (name)=>{
    const i = header.findIndex(h=>h===name);
    return i >= 0 ? i : -1;
  };
  const iId = idx('id');
  const iTitle = idx('title');
  const iBody = idx('body');
  const iColor = idx('color');
  const iX = idx('posX');
  const iY = idx('posY');
  const iZ = idx('posZ');
  const iImg = idx('imageFileId');

  const items = [];
  for (let r=1; r<values.length; r++){
    const row = values[r] || [];
    const id = (iId>=0 ? row[iId] : null) || ('row_' + (r+1));
    const title = (iTitle>=0 ? row[iTitle] : '') || '';
    const body = (iBody>=0 ? row[iBody] : '') || '';
    const color = (iColor>=0 ? row[iColor] : null) || null;
    const x = iX>=0 ? Number(row[iX]) : NaN;
    const y = iY>=0 ? Number(row[iY]) : NaN;
    const z = iZ>=0 ? Number(row[iZ]) : NaN;
    const pos = (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) ? { x, y, z } : null;
    const imageFileId = (iImg>=0 ? row[iImg] : null) || null;
    // skip empty rows
    if (!title && !body && !pos && !imageFileId) continue;
    items.push({ id:String(id), title:String(title), body:String(body), color: color ? String(color) : undefined, pos, imageFileId });
  }
  return items;
}

let currentSpreadsheetId = '';
let currentSheetGid = '';

async function hydrateSheetList(){
  const select = document.querySelector('#save-target-sheet');
  if (!currentSpreadsheetId){
    setOptions(select, []);
    return;
  }

  const rawSheets = await listSheets(currentSpreadsheetId);
  const displayNameMap = await readSheetDisplayNameMap(currentSpreadsheetId);

  const captionSheets = rawSheets
    .filter(s=>!isSystemSheetTitle(s.title))
    .map(s=>({
      gid: s.gid,
      title: displayNameMap.get(String(s.gid)) || s.title
    }));

  setOptions(select, captionSheets);

  // Choose a default gid if not set
  if (!currentSheetGid){
    currentSheetGid = captionSheets[0] ? String(captionSheets[0].gid) : '';
  }
  if (select && currentSheetGid) select.value = currentSheetGid;

  if (currentSheetGid){
    dispatchSheetContext(currentSpreadsheetId, currentSheetGid);
  }
}

async function loadCaptionsForCurrent(){
  const ui = window.__LM_CAPTION_UI;
  if (!ui || typeof ui.setItems !== 'function') return;
  if (!currentSpreadsheetId || !currentSheetGid){
    ui.setItems([]);
    return;
  }
  try{
    const gid = currentSheetGid;
    // Resolve sheet title from gid
    const rawSheets = await listSheets(currentSpreadsheetId);
    const s = rawSheets.find(x=>String(x.gid)===String(gid));
    const sheetTitle = s?.title;
    if (!sheetTitle){
      ui.setItems([]);
      return;
    }
    const rows = await readCaptionRows(currentSpreadsheetId, sheetTitle);
    ui.setItems(rows);
    try{ gate?.mark?.('captions'); }catch(_e){}
  }catch(e){
    err('load captions failed', e);
  }
}

function wireSelect(){
  const select = document.querySelector('#save-target-sheet');
  if (!select) return;
  if (select.dataset && select.dataset.lmWiredShareSelect) return;
  select.dataset.lmWiredShareSelect = '1';
  select.addEventListener('change', ()=>{
    currentSheetGid = select.value || '';
    if (currentSpreadsheetId && currentSheetGid){
      dispatchSheetContext(currentSpreadsheetId, currentSheetGid);
    }
    loadCaptionsForCurrent();
  }, { passive:true });
}

function arm(){
  wireSelect();

  // When a spreadsheet is chosen (drive.file flow), this event will fire.
  window.addEventListener('lm:sheet-context', (ev)=>{
    const d = ev?.detail || {};
    const sid = String(d.spreadsheetId || '');
    const gid = String(d.sheetGid || '');
    if (!sid) return;

    const changed = (sid !== currentSpreadsheetId);
    currentSpreadsheetId = sid;
    if (gid) currentSheetGid = gid;

    if (changed){
      hydrateSheetList().then(loadCaptionsForCurrent).catch(e=>err('hydrate failed', e));
    } else {
      loadCaptionsForCurrent();
    }
  });

  // If ctx already exists, boot from it.
  const sid0 = window.__LM_ACTIVE_SPREADSHEET_ID || '';
  const gid0 = window.__LM_ACTIVE_SHEET_GID || '';
  if (sid0){
    currentSpreadsheetId = String(sid0);
    currentSheetGid = String(gid0||'');
    hydrateSheetList().then(loadCaptionsForCurrent).catch(e=>err('boot hydrate failed', e));
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', arm, { once:true });
} else {
  arm();
}

// NOTE:
// Older Share mode implementations relied on Drive folder scanning (restricted scope) to locate
// the spreadsheet from a GLB id. In drive.file mode, spreadsheet selection becomes explicit
// (Picker) and is handled by dataset.open.ui.js.
