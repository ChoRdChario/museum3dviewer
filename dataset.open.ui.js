// dataset.open.ui.js
// UI: "Open sheet" button (Drive.file mode)
// - Opens Google Picker to select a spreadsheet
// - Reads __LM_META to resolve glbFileId (or prompts user to select GLB in Edit mode)
// - Sets sheet-context (spreadsheetId + default caption sheet gid)
// - Loads GLB via existing GLB loader bridge

import './persist.guard.js';
import { getGlbFileId, writeMeta } from './lm.meta.sheet.module.js';
import './picker.bridge.module.js';

const TAG='[dataset.open.ui]';
const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }

async function getAuthFetch(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  try{ const m = await import('./auth.fetch.bridge.js'); if (typeof m.default === 'function') return await m.default(); }catch(_e){}
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  throw new Error('auth fetch missing');
}

function isEditMode(){
  // Share mode sets explicit flags and/or armed guards.
  try{ if (window.__LM_IS_VIEW_MODE === true) return false; }catch(_e){}
  try{ if (typeof window.__lm_isShareMode === 'function' && window.__lm_isShareMode()) return false; }catch(_e){}
  if (window.__LM_MODE === 'share') return false;
  return true;
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

function pickDefaultCaptionSheet(sheets){
  // Prefer first non-system sheet
  const nonSystem = (sheets||[]).filter(s=>!String(s.title).startsWith('__LM_'));
  return nonSystem[0] || sheets?.[0] || null;
}

async function waitForLoadGlbFn(timeoutMs = 8000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    if (typeof window.__LM_LOAD_GLB_BY_ID === 'function') return window.__LM_LOAD_GLB_BY_ID;
    await new Promise(r=>setTimeout(r, 50));
  }
  throw new Error('__LM_LOAD_GLB_BY_ID not ready');
}

async function openSpreadsheetPicker(){
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.SPREADSHEETS || (Picker?.ViewId?.DOCS || undefined);
  const res = await window.__lm_openPicker({
    title: 'Select caption spreadsheet',
    viewId,
    multiselect: false
  });
  const doc = res?.docs?.[0];
  return doc?.id || '';
}

async function openGlbPicker(){
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.DOCS || undefined;
  const res = await window.__lm_openPicker({
    title: 'Select GLB file',
    viewId,
    multiselect: false
  });
  const doc = res?.docs?.[0];
  return doc?.id || '';
}

async function setSheetContext(spreadsheetId){
  // Determine default caption sheet and publish lm:sheet-context.
  const sheets = await listSheets(spreadsheetId);
  const def = pickDefaultCaptionSheet(sheets);
  const gidStr = def ? String(def.gid) : '';

  try{ window.__LM_ACTIVE_SPREADSHEET_ID = spreadsheetId; }catch(_e){}
  try{ window.currentSpreadsheetId = spreadsheetId; }catch(_e){}
  try{ if (gidStr) window.__LM_ACTIVE_SHEET_GID = gidStr; }catch(_e){}

  if (typeof window.setSheetContext === 'function'){
    window.setSheetContext({ spreadsheetId, sheetGid: gidStr });
  } else {
    window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail: { spreadsheetId, sheetGid: gidStr } }));
  }

  return { sheets, defaultSheet: def };
}

async function openDatasetFlow(){
  const status = document.getElementById('lm-open-status');
  const setStatus = (s)=>{ if (status) status.textContent = s; };

  try{
    setStatus('Opening picker…');
    const spreadsheetId = await openSpreadsheetPicker();
    if (!spreadsheetId){ setStatus(''); return; }

    setStatus('Reading spreadsheet…');
    await setSheetContext(spreadsheetId);

    // Resolve GLB id
    let glbId = await getGlbFileId(spreadsheetId);
    if (!glbId){
      if (!isEditMode()){
        setStatus('GLB not configured in this sheet');
        alert('このスプレッドシートには GLB の参照（__LM_META / glbFileId）がありません。編集者に、GLB を設定したシートを共有してもらってください。');
        return;
      }
      setStatus('Select GLB…');
      glbId = await openGlbPicker();
      if (!glbId){ setStatus(''); return; }
      try{
        // Store for future use
        await writeMeta(spreadsheetId, 'glbFileId', glbId);
      }catch(e){ warn('writeMeta failed', e); }
    }

    setStatus('Loading GLB…');
    try{ window.__LM_ACTIVE_GLB_ID = glbId; }catch(_e){}
    try{ window.__LM_CURRENT_GLB_ID__ = glbId; }catch(_e){}

    const loadFn = await waitForLoadGlbFn();
    await loadFn(glbId);

    setStatus('');
    log('dataset opened', { spreadsheetId, glbId });
  }catch(e){
    warn('openDatasetFlow failed', e);
    try{ alert('Open failed: ' + (e?.message||String(e))); }catch(_e){}
    const status = document.getElementById('lm-open-status');
    if (status) status.textContent = '';
  }
}

function installUI(){
  // IMPORTANT:
  // The existing "Select sheet…" dropdown is for a worksheet (gid) INSIDE the
  // active spreadsheet (caption sheet selector). We must not mix that control
  // with the spreadsheet file (Drive) selection UI.
  // Therefore, we insert a *separate* row above the worksheet selector.

  const anchor = document.querySelector('.row.ctrl-row.sheet-row');
  if (!anchor) return;
  if (document.getElementById('btnPickSpreadsheet')) return;

  const row = document.createElement('div');
  row.className = 'row ctrl-row';
  row.style.marginTop = '8px';
  row.style.gap = '6px';

  const btn = document.createElement('button');
  btn.id = 'btnPickSpreadsheet';
  btn.type = 'button';
  btn.textContent = 'Open spreadsheet…';
  btn.className = 'mini';

  const st = document.createElement('span');
  st.id = 'lm-open-status';
  st.className = 'muted';
  st.style.marginLeft = '4px';
  st.style.fontSize = '12px';

  row.appendChild(btn);
  row.appendChild(st);

  // Insert the new row above the worksheet (gid) selector row.
  anchor.parentNode.insertBefore(row, anchor);

  btn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    openDatasetFlow();
  });

  log('UI installed');
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', installUI, { once: true });
} else {
  installUI();
}
