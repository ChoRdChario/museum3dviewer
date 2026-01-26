// dataset.open.ui.js
// UI: "Open sheet" button (Drive.file mode)
// - Opens Google Picker to select a spreadsheet
// - Reads __LM_META to resolve glbFileId (or prompts user to select GLB in Edit mode)
// - Sets sheet-context (spreadsheetId + default caption sheet gid)
// - Loads GLB via existing GLB loader bridge

import './persist.guard.js';
import { getGlbFileId } from './lm.meta.sheet.read.module.js';
import './picker.bridge.module.js';

const TAG='[dataset.open.ui]';
const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }


function extractSpreadsheetId(input){
  const s = String(input || '').trim();
  if (!s) return '';
  // If user pastes just the ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && !s.includes('/')) return s;
  // Google Sheets URL: .../spreadsheets/d/<ID>/...
  let m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  // Drive open?id=<ID> or other query param id=
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  // Drive file URL: .../file/d/<ID>/...
  m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  return '';
}

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

async function openSpreadsheetPicker(prefillSpreadsheetId){
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.SPREADSHEETS || (Picker?.ViewId?.DOCS || undefined);
  const opts = {
    title: 'Select caption spreadsheet',
    viewId,
    multiselect: false
  };
  if (prefillSpreadsheetId) opts.fileIds = [prefillSpreadsheetId];
  const res = await window.__lm_openPicker(opts);
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
  // Guard against double-invocation if an existing build already attached
  // listeners to the Open button.
  if (window.__LM_OPEN_DATASET_FLOW_RUNNING){
    warn('openDatasetFlow already running');
    return;
  }
  window.__LM_OPEN_DATASET_FLOW_RUNNING = true;

  const status = document.getElementById('lm-open-status');
  const setStatus = (s)=>{ if (status) status.textContent = s; };

  const input = document.getElementById('lmSpreadsheetUrlInput');
  const prefillId = extractSpreadsheetId(input ? input.value : '');

  try{
    setStatus('Opening picker…');
    const spreadsheetId = await openSpreadsheetPicker(prefillId);
    if (!spreadsheetId && prefillId){
      setStatus('');
      alert('このスプレッドシートは、このGoogleアカウントでは選択できない可能性があります。共有されたアカウントでログインしているか、URL/IDが正しいか確認してください。');
      return;
    }
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
        const m = await import('./lm.meta.sheet.module.js');
        if (m && typeof m.writeMeta === 'function') await m.writeMeta(spreadsheetId, 'glbFileId', glbId);
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
  }finally{
    window.__LM_OPEN_DATASET_FLOW_RUNNING = false;
  }
}

function installUI(){
  // IMPORTANT:
  // The existing "Select sheet…" dropdown is for a worksheet (gid) INSIDE the
  // active spreadsheet (caption sheet selector). We must not mix that control
  // with the spreadsheet file (Drive) selection UI.
  // Therefore, we insert a *separate* row above the worksheet selector.

  // Prefer augmenting an existing Open spreadsheet button if one already exists
  // (older builds installed a button-only UI).
  const existingBtn = document.getElementById('btnPickSpreadsheet')
    || Array.from(document.querySelectorAll('button')).find(b=>String(b.textContent||'').trim()==='Open spreadsheet…');

  if (existingBtn){
    // Ensure input exists next to it.
    if (!document.getElementById('lmSpreadsheetUrlInput')){
      const inp = document.createElement('input');
      inp.id = 'lmSpreadsheetUrlInput';
      inp.type = 'text';
      inp.placeholder = 'Paste spreadsheet URL or ID…';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.style.flex = '1';
      inp.style.minWidth = '260px';
      inp.style.padding = '4px 6px';
      // Try to insert after the button within the same row if possible.
      const parent = existingBtn.parentElement;
      if (parent){
        existingBtn.id = 'btnPickSpreadsheet';
        parent.insertBefore(inp, existingBtn.nextSibling);
      }
    }

    // Ensure status element exists.
    if (!document.getElementById('lm-open-status')){
      const st = document.createElement('span');
      st.id = 'lm-open-status';
      st.className = 'muted';
      st.style.marginLeft = '4px';
      st.style.fontSize = '12px';
      existingBtn.parentElement?.appendChild(st);
    }

    // Attach handler (guarded) for click + Enter.
    existingBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); openDatasetFlow(); });
    const inp = document.getElementById('lmSpreadsheetUrlInput');
    if (inp){
      inp.addEventListener('keydown', (ev)=>{
        if (ev.key === 'Enter'){ ev.preventDefault(); openDatasetFlow(); }
      });
    }

    log('UI augmented (existing button)');
    return;
  }

  const anchor = document.querySelector('.row.ctrl-row.sheet-row');
  if (!anchor) return;

  const row = document.createElement('div');
  row.className = 'row ctrl-row';
  row.style.marginTop = '8px';
  row.style.gap = '6px';

  const btn = document.createElement('button');
  btn.id = 'btnPickSpreadsheet';
  btn.type = 'button';
  btn.textContent = 'Open spreadsheet…';
btn.className = 'mini';

const inp = document.createElement('input');
inp.id = 'lmSpreadsheetUrlInput';
inp.type = 'text';
inp.placeholder = 'Paste spreadsheet URL or ID…';
inp.autocomplete = 'off';
inp.spellcheck = false;
inp.style.flex = '1';
inp.style.minWidth = '260px';
inp.style.padding = '4px 6px';

const st = document.createElement('span');
  st.id = 'lm-open-status';
  st.className = 'muted';
  st.style.marginLeft = '4px';
  st.style.fontSize = '12px';

  row.appendChild(btn);
  row.appendChild(inp);
  row.appendChild(st);

  // Insert the new row above the worksheet (gid) selector row.
  anchor.parentNode.insertBefore(row, anchor);

  btn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    openDatasetFlow();
  });

inp.addEventListener('keydown', (ev)=>{
  if (ev.key === 'Enter'){
    ev.preventDefault();
    openDatasetFlow();
  }
});


  log('UI installed');
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', installUI, { once: true });
} else {
  installUI();
}
