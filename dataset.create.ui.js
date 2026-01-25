// dataset.create.ui.js
// UI: "(collapsible) New LociMyu dataset" (Edit mode only)
//
// drive.file mode constraints:
//  - No folder traversal, no Drive search, no auto placement in My Drive root.
//  - Users must explicitly select: destination folder + GLB.
//  - App creates a spreadsheet in that folder and seeds required system sheets.

import './persist.guard.js';
import './picker.bridge.module.js';
import { writeMeta, ensureMetaSheet } from './lm.meta.sheet.module.js';

const TAG='[dataset.create.ui]';
const DRIVE_BASE='https://www.googleapis.com/drive/v3';
const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }

function isEditMode(){
  try{ if (window.__LM_IS_VIEW_MODE === true) return false; }catch(_e){}
  try{ if (typeof window.__lm_isShareMode === 'function' && window.__lm_isShareMode()) return false; }catch(_e){}
  if (window.__LM_MODE === 'share') return false;
  return true;
}

async function getAuthFetch(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  try{ const m = await import('./auth.fetch.bridge.js'); if (typeof m.default === 'function') return await m.default(); }catch(_e){}
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

function pickDefaultCaptionSheet(sheets){
  const nonSystem = (sheets||[]).filter(s=>!String(s.title).startsWith('__LM_'));
  return nonSystem[0] || sheets?.[0] || null;
}

async function setSheetContext(spreadsheetId){
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

async function waitForLoadGlbFn(timeoutMs = 8000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    if (typeof window.__LM_LOAD_GLB_BY_ID === 'function') return window.__LM_LOAD_GLB_BY_ID;
    await new Promise(r=>setTimeout(r, 50));
  }
  throw new Error('__LM_LOAD_GLB_BY_ID not ready');
}

async function openFolderPicker(){
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.FOLDERS || 'FOLDERS';
  const res = await window.__lm_openPicker({
    title: 'Select destination folder',
    viewId,
    multiselect: false,
    allowSharedDrives: true,
    includeFolders: true,
  });
  const doc = res?.docs?.[0];
  return doc ? { id: doc.id, name: doc.name || '' } : null;
}

async function openGlbPicker(){
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.DOCS || 'DOCS';
  const res = await window.__lm_openPicker({
    title: 'Select GLB file',
    viewId,
    multiselect: false,
    allowSharedDrives: true,
    // We intentionally do not mime-filter here; some GLB files may have generic mimeTypes.
  });
  const doc = res?.docs?.[0];
  return doc ? { id: doc.id, name: doc.name || '' } : null;
}

function sanitizeName(name){
  const n = String(name||'').trim();
  if (!n) return '';
  return n.replace(/[\r\n\t]+/g,' ').slice(0, 90);
}

function defaultDatasetName(){
  const d = new Date();
  const pad = (x)=>String(x).padStart(2,'0');
  return `LociMyu Data ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

async function createSpreadsheetInFolder(folderId, name){
  const fetchJSON = await getAuthFetch();
  const url = `${DRIVE_BASE}/files?supportsAllDrives=true&fields=id,name,webViewLink,parents`;
  const body = {
    name: sanitizeName(name) || defaultDatasetName(),
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: [String(folderId)]
  };
  return await fetchJSON(url, { method: 'POST', json: body });
}

async function ensureSheet(spreadsheetId, title, { hidden=true, rowCount=1000, columnCount=8 } = {}){
  if (!spreadsheetId) return;
  const sheets = await listSheets(spreadsheetId);
  if (sheets.some(s=>s.title === title)) return;

  const fetchJSON = await getAuthFetch();
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  await fetchJSON(url, {
    method: 'POST',
    json: {
      requests: [{
        addSheet: {
          properties: {
            title,
            hidden: !!hidden,
            gridProperties: { rowCount, columnCount }
          }
        }
      }]
    }
  });
}

async function seedImageStashHeaders(spreadsheetId){
  const fetchJSON = await getAuthFetch();
  const range = encodeURIComponent('__LM_IMAGE_STASH!A1:D1');
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`;
  await fetchJSON(url, {
    method: 'PUT',
    json: { values: [['fileId','name','mimeType','addedAt']] }
  });
}

async function initNewDataset({ folderId, folderName, glbId, datasetName }){
  // 1) Create spreadsheet in chosen folder
  const created = await createSpreadsheetInFolder(folderId, datasetName);
  const spreadsheetId = created?.id;
  if (!spreadsheetId) throw new Error('Spreadsheet creation failed (no id)');

  // 2) Ensure system sheets
  // __LM_META is required (glbFileId)
  await ensureMetaSheet(spreadsheetId);

  // Candidate images list (user-manageable)
  await ensureSheet(spreadsheetId, '__LM_IMAGE_STASH', { hidden: true, rowCount: 2000, columnCount: 6 });
  try{ await seedImageStashHeaders(spreadsheetId); }catch(_e){}

  // 3) Bind GLB to dataset metadata
  await writeMeta(spreadsheetId, 'glbFileId', glbId);

  // 4) Persist last-used selections for convenience
  try{
    localStorage.setItem('LM_LAST_DATASET_FOLDER_ID', String(folderId||''));
    localStorage.setItem('LM_LAST_DATASET_FOLDER_NAME', String(folderName||''));
  }catch(_e){}

  // 5) Activate spreadsheet context + load GLB
  await setSheetContext(spreadsheetId);
  try{ window.__LM_ACTIVE_GLB_ID = glbId; }catch(_e){}
  try{ window.__LM_CURRENT_GLB_ID__ = glbId; }catch(_e){}

  const loadFn = await waitForLoadGlbFn();
  await loadFn(glbId);

  return { spreadsheetId, webViewLink: created?.webViewLink || '', name: created?.name || '' };
}

function installUI(){
  if (!isEditMode()) return;
  const pane = document.getElementById('pane-caption');
  if (!pane) return;
  if (document.getElementById('lm-new-dataset-panel')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'lm-new-dataset-panel';
  wrapper.className = 'grp';

  // Collapsible panel (closed by default)
  const details = document.createElement('details');
  details.open = false;
  details.style.border = '1px solid var(--line)';
  details.style.borderRadius = '10px';
  details.style.padding = '10px';
  details.style.background = 'rgba(255,255,255,0.02)';

  const summary = document.createElement('summary');
  summary.textContent = 'New LociMyu dataset (create caption spreadsheet)';
  summary.style.cursor = 'pointer';
  summary.style.userSelect = 'none';
  summary.style.fontWeight = '600';

  const body = document.createElement('div');
  body.style.marginTop = '10px';
  body.style.display = 'grid';
  body.style.gap = '8px';

  // Folder row
  const folderRow = document.createElement('div');
  folderRow.className = 'row';
  folderRow.style.gap = '8px';
  const btnFolder = document.createElement('button');
  btnFolder.type = 'button';
  btnFolder.className = 'mini';
  btnFolder.textContent = 'Choose folder…';
  const folderLabel = document.createElement('span');
  folderLabel.className = 'muted';
  folderLabel.style.fontSize = '12px';
  folderLabel.textContent = 'No folder selected';
  folderRow.appendChild(btnFolder);
  folderRow.appendChild(folderLabel);

  // GLB row
  const glbRow = document.createElement('div');
  glbRow.className = 'row';
  glbRow.style.gap = '8px';
  const btnGlb = document.createElement('button');
  btnGlb.type = 'button';
  btnGlb.className = 'mini';
  btnGlb.textContent = 'Choose GLB…';
  const glbLabel = document.createElement('span');
  glbLabel.className = 'muted';
  glbLabel.style.fontSize = '12px';
  glbLabel.textContent = 'No GLB selected';
  glbRow.appendChild(btnGlb);
  glbRow.appendChild(glbLabel);

  // Name row
  const nameRow = document.createElement('div');
  nameRow.className = 'row';
  nameRow.style.gap = '8px';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Spreadsheet file name (optional)';
  nameInput.value = '';
  nameInput.style.flex = '1 1 auto';
  nameRow.appendChild(nameInput);

  // Action row
  const actionRow = document.createElement('div');
  actionRow.className = 'row';
  actionRow.style.gap = '8px';
  const btnCreate = document.createElement('button');
  btnCreate.type = 'button';
  btnCreate.className = 'full';
  btnCreate.textContent = 'Create dataset';
  btnCreate.disabled = true;
  actionRow.appendChild(btnCreate);

  const status = document.createElement('div');
  status.className = 'hint';
  status.style.marginTop = '2px';
  status.textContent = '';

  body.appendChild(folderRow);
  body.appendChild(glbRow);
  body.appendChild(nameRow);
  body.appendChild(actionRow);
  body.appendChild(status);

  details.appendChild(summary);
  details.appendChild(body);
  wrapper.appendChild(details);

  // Prepend to caption pane (top)
  pane.insertBefore(wrapper, pane.firstChild);

  const state = {
    folderId: '', folderName: '',
    glbId: '', glbName: ''
  };

  // Restore last folder hint (non-authoritative)
  try{
    const fid = localStorage.getItem('LM_LAST_DATASET_FOLDER_ID') || '';
    const fn  = localStorage.getItem('LM_LAST_DATASET_FOLDER_NAME') || '';
    if (fid) {
      state.folderId = fid;
      state.folderName = fn;
      folderLabel.textContent = fn ? `Last: ${fn}` : 'Last folder selected (id cached)';
    }
  }catch(_e){}

  function refreshEnable(){
    btnCreate.disabled = !(state.folderId && state.glbId);
  }

  btnFolder.addEventListener('click', async (ev)=>{
    ev.preventDefault();
    try{
      status.textContent = 'Opening folder picker…';
      const picked = await openFolderPicker();
      if (!picked){ status.textContent = ''; return; }
      state.folderId = picked.id;
      state.folderName = picked.name || '';
      folderLabel.textContent = picked.name ? picked.name : picked.id;
      status.textContent = '';
      refreshEnable();
    }catch(e){
      warn('folder pick failed', e);
      status.textContent = '';
      try{ alert('Folder pick failed: ' + (e?.message||String(e))); }catch(_e){}
    }
  });

  btnGlb.addEventListener('click', async (ev)=>{
    ev.preventDefault();
    try{
      status.textContent = 'Opening GLB picker…';
      const picked = await openGlbPicker();
      if (!picked){ status.textContent = ''; return; }
      state.glbId = picked.id;
      state.glbName = picked.name || '';
      glbLabel.textContent = picked.name ? picked.name : picked.id;
      status.textContent = '';
      refreshEnable();
    }catch(e){
      warn('glb pick failed', e);
      status.textContent = '';
      try{ alert('GLB pick failed: ' + (e?.message||String(e))); }catch(_e){}
    }
  });

  btnCreate.addEventListener('click', async (ev)=>{
    ev.preventDefault();
    if (!state.folderId || !state.glbId) return;
    btnCreate.disabled = true;

    try{
      const name = sanitizeName(nameInput.value) || defaultDatasetName();
      status.textContent = 'Creating spreadsheet…';
      const res = await initNewDataset({
        folderId: state.folderId,
        folderName: state.folderName,
        glbId: state.glbId,
        datasetName: name,
      });
      status.textContent = 'Done.';
      log('dataset created', res);
      // Close panel after success to reduce clutter.
      try{ details.open = false; }catch(_e){}
      setTimeout(()=>{ status.textContent = ''; }, 1500);
    }catch(e){
      warn('create failed', e);
      status.textContent = '';
      try{ alert('Create failed: ' + (e?.message||String(e))); }catch(_e){}
    } finally {
      refreshEnable();
    }
  });

  refreshEnable();
  log('UI installed');
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', installUI, { once: true });
} else {
  installUI();
}
