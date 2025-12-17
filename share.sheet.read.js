// share.sheet.read.js
// Share-mode read-only sheet reader:
// - After GLB load: locate save spreadsheet (find-only)
// - List caption sheets (non __LM_* sheets) and populate dropdown
// - Load captions from selected sheet and feed __LM_CAPTION_UI.setItems()

import { findExistingSaveSheetByGlbId, dispatchSheetContext } from './save.locator.share.js';

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

function applyItems(items){
  const ui = window.__LM_CAPTION_UI;
  if (!ui || typeof ui.setItems !== 'function') return;
  ui.setItems(items || []);
  if (typeof ui.refreshList === 'function') ui.refreshList();
}

async function loadForSelectedSheet(spreadsheetId, sheets){
  const sel = document.querySelector('#save-target-sheet');
  if (!sel) return;
  const gid = sel.value ? Number(sel.value) : null;
  const picked = sheets.find(s=>Number(s.gid)===gid) || sheets.find(s=>!isSystemSheetTitle(s.title)) || sheets[0];
  if (!picked){
    applyItems([]);
    return;
  }
  if (!sel.value) sel.value = String(picked.gid);

  // Update sheet context for downstream consumers (views/materials).
  try{
    const baseCtx = window.__LM_SHEET_CTX__ || {};
    dispatchSheetContext(Object.assign({}, baseCtx, { sheetGid: picked.gid, sheetTitle: picked.title }));
  }catch(_e){}
  setStatus(`Loading captions from ${picked.title}…`);
  try{
    const items = await readCaptionRows(spreadsheetId, picked.title);
    applyItems(items);
    setStatus(`Captions: ${items.length}`);
    log('loaded captions', items.length, 'from', picked.title);
    try{ gate?.mark?.('captions'); }catch(_e){}
  }catch(e){
    err('failed to read captions', e);
    setStatus('Captions: failed to load (read-only)');
    applyItems([]);
    try{ gate?.mark?.('captions'); }catch(_e){}
  }
}

async function start(glbFileId){
  setStatus('Locating spreadsheet…');
  let ctx = null;
  try{
    ctx = await findExistingSaveSheetByGlbId(glbFileId);
  }catch(e){
    err('locator failed', e);
    setStatus('Spreadsheet: lookup failed');
    return;
  }

  if (!ctx?.spreadsheetId){
    dispatchSheetContext({ mode:'share', glbFileId, spreadsheetId:null, parentId:ctx?.parentId||null });
    try{ gate?.mark?.('sheet'); }catch(_e){}
    setStatus('Spreadsheet: not found (read-only)');
    applyItems([]);
    try{ gate?.mark?.('captions'); }catch(_e){}
    return;
  }

  dispatchSheetContext({ mode:'share', glbFileId, spreadsheetId:ctx.spreadsheetId, parentId:ctx.parentId||null });

  try{ gate?.mark?.('sheet'); }catch(_e){}

  setStatus('Spreadsheet: found. Listing sheets…');
  let sheets = [];
  try{
    sheets = await listSheets(ctx.spreadsheetId);
  }catch(e){
    err('failed to list sheets', e);
    setStatus('Spreadsheet: cannot list sheets');
    return;
  }

  const sel = document.querySelector('#save-target-sheet');
  setOptions(sel, sheets.filter(s=>!isSystemSheetTitle(s.title)));
  // In Share mode, Create is disabled already; ensure anyway
  const createBtn = document.querySelector('#save-target-create');
  if (createBtn) createBtn.disabled = true;

  // bind change handler once
  if (sel && !sel.__lmShareBound){
    sel.__lmShareBound = true;
    sel.addEventListener('change', ()=>{
      loadForSelectedSheet(ctx.spreadsheetId, sheets);
    });
  }

  await loadForSelectedSheet(ctx.spreadsheetId, sheets);
}

// hook to GLB loaded event
(function(){
  if (window.__LM_SHARE_SHEET_READER_READY__) return;
  window.__LM_SHARE_SHEET_READER_READY__ = true;
  document.addEventListener('lm:glb-loaded', (ev)=>{
    try{
      const glbFileId = ev?.detail?.glbFileId || ev?.detail?.fileId || window.__LM_CURRENT_GLB_ID__ || null;
      if (!glbFileId) return;
      start(String(glbFileId));
    }catch(e){
      err('start failed', e);
    }
  });
})();
