// dataset.open.ui.js
// UI: "Open spreadsheet…" button (Drive.file mode)
// - Accepts spreadsheet URL/ID input (validated via Sheets API).
// - Falls back to Picker browsing when needed.
// - Resolves GLB fileId from __LM_META.
// - In drive.file mode, triggers a Picker selection step to grant access to:
//   - GLB (required)
//   - Caption attachment fileIds gathered from each caption sheet's column H (imageFileId)
// - Sets sheet-context (spreadsheetId + default caption sheet gid)
// - Loads GLB via existing GLB loader bridge

import './persist.guard.js';
import { getGlbFileId } from './lm.meta.sheet.read.module.js';
import './picker.bridge.module.js';

console.log('[dataset.open.ui] v02q loaded');

const TAG='[dataset.open.ui]';
const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }

function uniq(list){
  const out=[];
  const seen=new Set();
  (list||[]).forEach(v=>{
    const s=String(v||'').trim();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
}
function getApiKey(){
  try{
    if (typeof window.__LM_API_KEY === 'string' && window.__LM_API_KEY.trim()) return window.__LM_API_KEY.trim();
    const m = document.querySelector('meta[name="google-api-key"]');
    if (m && m.content && m.content.trim()) return m.content.trim();
  }catch(_e){}
  return '';
}

// NOTE:
// We intentionally do NOT attempt to "detect public files" to skip Picker.
// Under the drive.file policy, the safest behavior is:
//   - Treat related files as requiring explicit user selection/authorization via Picker.
//   - Fall back to an explicit picker retry if a Drive fetch fails.


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

function extractDriveFileId(input){
  const s = String(input || '').trim();
  if (!s) return '';
  // If user pastes just the ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && !s.includes('/')) return s;
  // Drive file URL: .../file/d/<ID>/...
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  // Sheets URL: .../spreadsheets/d/<ID>/...
  m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  // open?id=<ID> or other query param id=
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  return '';
}

function extractDriveFileIdAndResourceKey(input){
  const s = String(input || '').trim();
  if (!s) return { fileId: '', resourceKey: '' };

  // Resource keys appear in shared links as a query param: ...?resourcekey=0-XXXX
  let resourceKey = '';
  try{
    const m = s.match(/[?&]resourcekey=([^&#]+)/i);
    if (m && m[1]) resourceKey = decodeURIComponent(m[1]);
  }catch(_e){}

  // Optional compact form: <fileId>|<resourceKey>
  if (!resourceKey && s.includes('|')) {
    const parts = s.split('|');
    if (parts.length >= 2) {
      const rk = String(parts[1] || '').trim();
      if (rk) resourceKey = rk;
    }
  }

  const fileId = extractDriveFileId(s);

  // Persist mapping globally so Drive fetchers can attach the header when needed
  if (fileId && resourceKey) {
    try{
      window.__lm_driveResourceKeys = window.__lm_driveResourceKeys || {};
      window.__lm_driveResourceKeys[fileId] = resourceKey;
    }catch(_e){}
  }

  return { fileId, resourceKey };
}

// Asset folder URL (Drive) - collected via the top input (#glbUrl) and stored in localStorage.
// This folder is expected to contain (directly) all GLB / image assets referenced by the dataset.
const ASSET_FOLDER_LS_KEY = 'lmAssetFolderUrl';


// Stage B: approved asset folder id (Picker-selected folder; drive.file "entry")
const ASSET_FOLDER_APPROVED_ID_LS_KEY = 'lmAssetFolderApprovedId';

function getApprovedAssetFolderId(){
  try{
    if (typeof window.__LM_ASSET_FOLDER_APPROVED_ID === 'string' && window.__LM_ASSET_FOLDER_APPROVED_ID.trim()){
      return window.__LM_ASSET_FOLDER_APPROVED_ID.trim();
    }
    const v = localStorage.getItem(ASSET_FOLDER_APPROVED_ID_LS_KEY) || '';
    return String(v||'').trim();
  }catch(_e){ return ''; }
}

function setApprovedAssetFolderId(folderId){
  try{
    const id = String(folderId||'').trim();
    if (!id) return;
    window.__LM_ASSET_FOLDER_APPROVED_ID = id;
    localStorage.setItem(ASSET_FOLDER_APPROVED_ID_LS_KEY, id);
  }catch(_e){}
}

function clearApprovedAssetFolderId(){
  try{ window.__LM_ASSET_FOLDER_APPROVED_ID = ''; }catch(_e){}
  try{ localStorage.removeItem(ASSET_FOLDER_APPROVED_ID_LS_KEY); }catch(_e){}
}


function extractDriveFolderId(input){
  const s = String(input || '').trim();
  if (!s) return '';
  // If user pastes just the ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && !s.includes('/')) return s;
  // Drive folder URL: .../drive/folders/<ID>
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  // Alternative: .../folderview?id=<ID>
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  return '';
}

function getAssetFolderUrl(){
  try{
    // Prefer explicit global set by UI bridge; fall back to localStorage.
    if (typeof window.__LM_ASSET_FOLDER_URL === 'string' && window.__LM_ASSET_FOLDER_URL.trim()) {
      return window.__LM_ASSET_FOLDER_URL.trim();
    }
    const v = localStorage.getItem(ASSET_FOLDER_LS_KEY) || '';
    return String(v || '').trim();
  }catch(_e){
    return '';
  }
}

function getAssetFolderId(){
  const url = getAssetFolderUrl();
  const id = extractDriveFolderId(url);
  return id;
}

// Dataset guard: we only treat a spreadsheet as a LociMyu dataset if ALL required internal sheets exist.
// (No auto-creation in Open flow; if missing, we error out.)
const REQUIRED_INTERNAL_SHEETS = ['__LM_META','__LM_SHEET_NAMES','__LM_MATERIALS','__LM_VIEWS'];

function missingDatasetSheets(sheets){
  const titles = new Set((sheets||[]).map(s=>String(s?.title||'').trim()).filter(Boolean));
  const missing = [];
  for (const t of REQUIRED_INTERNAL_SHEETS){
    if (!titles.has(t)) missing.push(t);
  }
  return missing;
}

function isDatasetSpreadsheet(sheets){
  return missingDatasetSheets(sheets).length === 0;
}

async function getAuthFetch(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  try{
    const m = await import(new URL('./auth.fetch.bridge.js', import.meta.url));
    if (typeof m.default === 'function') return await m.default();
  }catch(_e){}
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  throw new Error('auth fetch missing');
}


async function resolvePickedAssetFolderId(pickedDoc){
  // pickedDoc: google.picker.DocumentObject
  const id = pickedDoc?.id ? String(pickedDoc.id) : '';
  if (!id) return '';
  const mt = String(pickedDoc?.mimeType || '').toLowerCase();

  // If user picked a shortcut, resolve to its target folder id via Drive API (allowed because user explicitly picked it).
  if (mt === 'application/vnd.google-apps.shortcut'){
    try{
      const authFetch = await getAuthFetch();
      const fields = 'id,mimeType,shortcutDetails(targetId,targetMimeType)';
      const params = new URLSearchParams({ fields, supportsAllDrives:'true' });
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${params.toString()}`;
      const meta = await authFetch(url);
      const targetId = meta?.shortcutDetails?.targetId ? String(meta.shortcutDetails.targetId) : '';
      const targetMt = String(meta?.shortcutDetails?.targetMimeType || '').toLowerCase();
      if (targetId && targetMt === 'application/vnd.google-apps.folder') return targetId;
      // If targetMimeType is missing, still accept targetId as folder id (best effort).
      if (targetId) return targetId;
    }catch(e){
      try{ console.warn('[dataset.open.ui] shortcut resolve failed', e); }catch(_e){}
    }
    // As a last resort, return the shortcut id (may not work for listing children).
    return id;
  }

  // Normal folder
  return id;
}


function looksLikeGlb(file){
  const mt = String(file?.mimeType || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (mt === 'model/gltf-binary') return true;
  if (mt === 'application/octet-stream' && name.endsWith('.glb')) return true;
  return false;
}
function looksLikeImage(file){
  const mt = String(file?.mimeType || '').toLowerCase();
  return mt.startsWith('image/');
}

async function listFolderChildrenDirect(folderId){
  const authFetch = await getAuthFetch();
  const q = `'${String(folderId)}' in parents and trashed=false`;
  const fields = 'files(id,name,mimeType,resourceKey,shortcutDetails),nextPageToken';
  const params = new URLSearchParams({
    q,
    fields,
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  });
  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
  const json = await authFetch(url);

  // shortcut を軽く解決（targetId を採用）
  const files = (json?.files || []).map(f=>{
    if (f?.mimeType === 'application/vnd.google-apps.shortcut' && f?.shortcutDetails?.targetId){
      return { ...f, id: f.shortcutDetails.targetId };
    }
    return f;
  });
  return files;
}



function isEditMode(){
  // Share mode sets explicit flags and/or armed guards.
  try{ if (window.__LM_IS_VIEW_MODE === true) return false; }catch(_e){}
  try{ if (typeof window.__lm_isShareMode === 'function' && window.__lm_isShareMode()) return false; }catch(_e){}
  if (window.__LM_MODE === 'share') return false;
  return true;
}

function a1Sheet(sheetTitle){
  // Always quote sheet titles for A1 notation.
  // Google Sheets A1 escaping: single quote inside title is doubled.
  const t = String(sheetTitle || '').replace(/'/g, "''");
  return `'${t}'`;
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

async function readImageStashFileIds(spreadsheetId){
  // Deprecated: older plan used __LM_IMAGE_STASH. Kept as a no-op for compatibility.
  // Current implementation reads attachment fileIds from each caption sheet's column H (imageFileId).
  return [];
}

async function readCaptionSheetGids(spreadsheetId){
  // __LM_SHEET_NAMES has A=sheetGid, B=displayName, C=sheetTitle, D=updatedAt
  // We rely on gid because the user can rename sheets freely.
  const fetchJSON = await getAuthFetch();
  const range = encodeURIComponent(`${a1Sheet('__LM_SHEET_NAMES')}!A:A`);
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}?majorDimension=COLUMNS`;
  try{
    const data = await fetchJSON(url);
    const col = (data?.values && data.values[0]) ? data.values[0] : [];
    const gids = col
      .map(v=>String(v||'').trim())
      .filter(Boolean)
      .filter(v=>!/^(sheetgid|gid)$/i.test(v));
    return uniq(gids);
  }catch(e){
    warn('readCaptionSheetGids failed (non-fatal)', e);
    return [];
  }
}

async function readAttachmentFileIdsFromCaptionSheets(spreadsheetId, sheets){
  // Each caption sheet has column H header = imageFileId; values are Drive fileIds (or URLs) for attachments.
  const fetchJSON = await getAuthFetch();
  const gids = await readCaptionSheetGids(spreadsheetId);
  const gidSet = new Set((gids||[]).map(g=>String(g)));
  const targets = (sheets||[]).filter(s=>gidSet.has(String(s.gid)));
  if (!targets.length) return [];

  const params = new URLSearchParams();
  params.set('majorDimension', 'COLUMNS');
  for (const s of targets){
    // Use sheet title for A1 notation.
    params.append('ranges', `${a1Sheet(s.title)}!H:H`);
  }
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`;
  try{
    const data = await fetchJSON(url);
    const vrs = Array.isArray(data?.valueRanges) ? data.valueRanges : [];
    const out = [];
    for (const vr of vrs){
      const col = (vr?.values && vr.values[0]) ? vr.values[0] : [];
      for (const cell of col){
        const raw = String(cell||'').trim();
        if (!raw) continue;
        if (/^(imagefileid|image_file_id|fileid|file_id|id)$/i.test(raw)) continue;
        const id = extractDriveFileId(raw);
        if (id) out.push(id);
      }
    }
    return uniq(out);
  }catch(e){
    warn('readAttachmentFileIdsFromCaptionSheets failed (non-fatal)', e);
    return [];
  }
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

function isLikelyDriveFileAccessError(err){
  const msg = String(err?.message || err || '').toLowerCase();
  // viewer.module.cdn.js currently surfaces Drive fetch failures via message.
  return msg.includes('drive fetch failed') && (msg.includes('404') || msg.includes('403'));
}

async function openSpreadsheetPicker(prefillSpreadsheetId){
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.DOCS || undefined;
  const opts = {
    title: 'Select caption spreadsheet',
    viewId,
    mimeTypes: 'application/vnd.google-apps.spreadsheet',
    multiselect: false,
    allowSharedDrives: true
  };
  if (prefillSpreadsheetId) opts.fileIds = [prefillSpreadsheetId];
  const res = await window.__lm_openPicker(opts);
  const doc = res?.docs?.[0];
  return doc?.id || '';
}

async function openGlbPicker(prefillGlbId){
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.DOCS || undefined;
  const opts = {
    title: 'Select GLB file',
    viewId,
    // Prefer the actual GLB mimeType; allow octet-stream as a fallback.
    mimeTypes: 'model/gltf-binary,application/octet-stream',
    multiselect: false,
    allowSharedDrives: true
  };
  if (prefillGlbId) opts.fileIds = [prefillGlbId];
  const res = await window.__lm_openPicker(opts);
  const doc = res?.docs?.[0];
  return doc?.id || '';
}

async function openAssetFolderPicker(){
  const Picker = window.google?.picker;

  // Prefer pre-navigated consent when we already know a folderId (e.g. from URL).
  // This avoids relying on My Drive indexing/shortcuts and works better for "anyone with link" folders
  // (requires Developer Key, which picker.bridge.js enforces).
  const hintedFolderId = (typeof getAssetFolderId === 'function' ? getAssetFolderId() : '') || '';
  if (hintedFolderId && hintedFolderId.trim()){
    const viewId = Picker?.ViewId?.DOCS || undefined;
    const opts = {
      title: 'Select Asset Folder',
      viewId,
      // show just the folder (or folder shortcut) item we want the user to consent to
      fileIds: [hintedFolderId.trim()],
      mimeTypes: 'application/vnd.google-apps.folder,application/vnd.google-apps.shortcut',
      multiselect: false,
      includeFolders: true,
      allowSharedDrives: false,
      ownedByMe: false,
      navHidden: true
    };
    const res = await window.__lm_openPicker(opts);
    const doc = res?.docs?.[0];
    if (doc?.id) return await resolvePickedAssetFolderId(doc);

    // If pre-navigated view rendered empty, fall back to browse mode.
    try{ console.warn('[dataset.open.ui] pre-navigated folder picker returned empty; falling back to browse'); }catch(_e){}
  }

  // Fallback: allow browsing. (Shortcuts to folders may not be selectable; prefer hintedFolderId path.)
  const viewId = Picker?.ViewId?.FOLDERS || undefined;
  const opts = {
    title: 'Select Asset Folder',
    viewId,
    multiselect: false,
    includeFolders: true,
    allowSharedDrives: false,
    ownedByMe: false
  };
  const res = await window.__lm_openPicker(opts);
  const doc = res?.docs?.[0];
  if (doc?.id) return await resolvePickedAssetFolderId(doc);
  return '';
}


async function ensureAssetFolderApproved(setStatus){
  const approved = getApprovedAssetFolderId();
  if (approved) return approved;

  if (setStatus) setStatus('Select Asset Folder…');
  const pickedId = await openAssetFolderPicker();
  if (!pickedId) throw new Error('Asset folder not selected');

  setApprovedAssetFolderId(pickedId);

  // Best-effort: persist into __LM_META when we can (edit mode only)
  try{
    if (isEditMode() && window.__LM_ACTIVE_SPREADSHEET_ID){
      const m = await import(new URL('./lm.meta.sheet.module.js', import.meta.url));
      if (m && typeof m.writeMeta === 'function') await m.writeMeta(window.__LM_ACTIVE_SPREADSHEET_ID, 'assetFolderId', pickedId);
    }
  }catch(_e){}

  return pickedId;
}



async function openAccessGrantPicker(fileIds, opts = {}){
  // NOTE: Under drive.file, the only reliable way to grant Drive API access is user selection in Picker.
  // We intentionally do NOT skip this step even if a file "looks public" (public probing can be wrong).
  const ids = uniq(fileIds || []).filter(Boolean);

  // If parentId is provided, we can still open a folder-rooted Picker even when we have no seed ids.
  // Without parentId, we need at least one id to request access.
  const parentId = opts?.parentId || undefined;
  if (!ids.length && !parentId) return { pickedIds: [] };

  // Local safety cap: when using setFileIds, seed only the first 50 ids (UI/compat reasons).
  const limited = ids.length > 50 ? ids.slice(0, 50) : ids;

  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.DOCS || undefined;
  const title = opts?.title || 'Grant access to files';
  const requiredIds = uniq(opts?.requiredIds || []).filter(Boolean);
  const allowPartial = opts?.allowPartial !== false; // default true

  // If an Asset Folder is provided, open Picker rooted at that folder.
  // NOTE: Picker DocsView does NOT allow using setParent and setFileIds together reliably.
  const mimeTypes = opts?.mimeTypes || (
    // GLB can be stored as model/gltf-binary OR sometimes falls back to octet-stream.
    // Keep common image mimes too.
    'model/gltf-binary,model/gltf+json,application/octet-stream,image/png,image/jpeg,image/webp,image/gif'
  );

  const pickerReq = {
    title,
    viewId,
    multiselect: true,
    allowSharedDrives: true,
    mimeTypes
  };

  // Folder-rooted mode: setParent only (no setFileIds).
  if (parentId) {
    pickerReq.parentId = parentId;
  } else if (limited.length) {
    // Seed mode: setFileIds only (no setParent).
    pickerReq.fileIds = limited;
  }

  const res = await window.__lm_openPicker(pickerReq);

  // If Picker returns resourceKey, cache it for subsequent Drive API calls.
  try{
    const docs = res?.docs || [];
    if (docs && docs.length){
      window.__lm_driveResourceKeys = window.__lm_driveResourceKeys || {};
      docs.forEach(d => {
        const id = d?.id;
        const rk = d?.resourceKey;
        if (id && rk && !window.__lm_driveResourceKeys[id]){
          window.__lm_driveResourceKeys[id] = rk;
        }
      });
    }
  }catch(_e){}

  const picked = uniq((res?.docs || []).map(d=>d?.id).filter(Boolean));

  // Enforce required IDs if configured.
  if (requiredIds.length){
    const missing = requiredIds.filter(id => !picked.includes(id));
    if (missing.length){
      if (allowPartial){
        warn('grant picker: required file not selected (continuing)', { missing, picked });
      }else{
        throw new Error('Required file(s) not selected in Picker: ' + missing.join(', '));
      }
    }
  }

  return { res, pickedIds: picked, requestedIds: limited };
}

async function setSheetContext(spreadsheetId, opts = {}){
  // Determine default caption sheet and publish lm:sheet-context.
  const source = opts?.source || 'unknown';
  const sheets = await listSheets(spreadsheetId);

  // Safety: never bind to arbitrary spreadsheets.
  // Open flow must ensure required internal sheets exist. No auto-create here.
  if (!isDatasetSpreadsheet(sheets)){
    const missing = missingDatasetSheets(sheets);
    alert(
      'このスプレッドシートは LociMyu データセットではありません。\n' +
      '必要な内部シートが見つかりません: ' + missing.join(', ') + '\n\n' +
      '(source: ' + source + ')'
    );
    return null;
  }
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
  if (window.__LM_OPEN_DATASET_FLOW_RUNNING){
    warn('openDatasetFlow already running');
    return;
  }
  window.__LM_OPEN_DATASET_FLOW_RUNNING = true;

  const status = document.getElementById('lm-open-status');
  const setStatus = (s)=>{ if (status) status.textContent = s; };
  const input = document.getElementById('lmSpreadsheetUrlInput');
  const rawInput = (input ? String(input.value||'') : '').trim();
  const prefillId = extractSpreadsheetId(rawInput);
  const source = prefillId ? 'url' : 'picker';

  try{
    let spreadsheetId = '';
    let sheets = null;

    // 1) URL/ID direct open (safe-by-default).
    // If the user pasted something but we cannot parse a spreadsheet id, do NOT fall back to picker.
    if (rawInput && !prefillId){
      setStatus('');
      alert('スプレッドシートのURL/IDが正しく解析できませんでした。\n\n入力例:\n- https://docs.google.com/spreadsheets/d/<ID>/edit\n- <ID>');
      return;
    }

    if (prefillId){
      setStatus('Checking spreadsheet…');
      // Validate that the current user can access THIS spreadsheet id.
      // If validation fails, stop (avoid accidentally opening a different spreadsheet via picker).
      sheets = await listSheets(prefillId);
      // Strict: do NOT auto-create any __LM_* sheets during Open.
      // If required internal sheets are missing, treat as non-dataset.
      if (!isDatasetSpreadsheet(sheets)){
        const missing = missingDatasetSheets(sheets);
        setStatus('');
        alert(
          'このスプレッドシートは LociMyu データセットではありません。\n' +
          '必要な内部シートが見つかりません: ' + missing.join(', ') + '\n\n' +
          'データセットとして作成されたスプレッドシートURLを入力してください。'
        );
        return;
      }
      spreadsheetId = prefillId;
    }

    // 2) Picker path: only when the input is empty (explicit user intent).
    if (!spreadsheetId){
      setStatus('Opening picker…');
      spreadsheetId = await openSpreadsheetPicker('');
      if (!spreadsheetId){
        setStatus('');
        return;
      }
      // Re-check & validate the chosen spreadsheet.
      setStatus('Checking spreadsheet…');
      sheets = await listSheets(spreadsheetId);
      if (!isDatasetSpreadsheet(sheets)){
        const missing = missingDatasetSheets(sheets);
        setStatus('');
        alert(
          '選択されたスプレッドシートは LociMyu データセットではありません。\n' +
          '必要な内部シートが見つかりません: ' + missing.join(', ') + '\n\n' +
          'データセット用スプレッドシートを選択してください。'
        );
        return;
      }
    }

    setStatus('Reading spreadsheet…');
    const ctx = await setSheetContext(spreadsheetId, { source });
    try{ window.__LM_ACTIVE_SPREADSHEET_ID = spreadsheetId; }catch(_e){}
    if (!ctx){
      setStatus('');
      return;
    }

    // Resolve candidate image attachments (drive.file mode: permission is per-file).
    // Attachments are stored in each caption sheet column H (imageFileId).
    setStatus('Reading attachments…');
    const imageIdsRaw = await readAttachmentFileIdsFromCaptionSheets(spreadsheetId, ctx?.sheets||[]);
    const imageIds = (imageIdsRaw || [])
      .map(v => extractDriveFileIdAndResourceKey(v).fileId)
      .filter(Boolean);
    try{ window.__LM_CANDIDATE_IMAGE_FILEIDS = imageIds; }catch(_e){}
    try{ window.dispatchEvent(new CustomEvent('lm:refresh-images')); }catch(_e){}

    // Resolve GLB id.
    let glbIdRaw = await getGlbFileId(spreadsheetId);
    let glbId = extractDriveFileIdAndResourceKey(glbIdRaw).fileId;
    if (glbId && glbId === spreadsheetId) glbId = '';

    if (!glbId){
      if (!isEditMode()){
        setStatus('GLB not configured in this sheet');
        alert('このスプレッドシートには GLB の参照（__LM_META / glbFileId）がありません。編集者に、GLB を設定したシートを共有してもらってください。');
        return;
      }
      setStatus('Select GLB…');
      glbId = await openGlbPicker('');
      if (!glbId){ setStatus(''); return; }

      // Store for future use (Edit-only).
      try{
        const m = await import(new URL('./lm.meta.sheet.module.js', import.meta.url));
        if (m && typeof m.writeMeta === 'function') await m.writeMeta(spreadsheetId, 'glbFileId', glbId);
      }catch(e){ warn('writeMeta failed', e); }
    }

// In drive.file policy, request access to GLB and image attachments upfront.
// We do NOT attempt to "detect public" files; we prefer explicit, user-granted access.
if (window.__LM_POLICY_DRIVEFILE_ONLY){
  const pickerMimeTypes = 'model/gltf-binary,model/gltf+json,application/octet-stream,image/png,image/jpeg,image/webp,image/gif';

  // Stage B: Folder selection via Picker (drive.file entry)
  let approvedFolderId = '';
  try{
    approvedFolderId = await ensureAssetFolderApproved(setStatus);
  }catch(e){
    // User cancelled or selection failed.
    setStatus('');
    warn('asset folder approval cancelled/failed', e);
    return;
  }

  // Stage C: (optional) bounded listing (direct children only) for hints/diagnostics.
  // IMPORTANT: Under drive.file, listing can still 404/403 until the user explicitly grants access.
  // We must NOT block on listing. The Picker rooted at the folder is the actual grant step.
  let candidateFromFolder = [];
  try{
    setStatus('Scanning asset folder (direct children)…');
    const children = await listFolderChildrenDirect(approvedFolderId);
    candidateFromFolder = (children || [])
      .filter(f => looksLikeGlb(f) || looksLikeImage(f))
      .map(f => f.id)
      .filter(Boolean);
  }catch(e){
    warn('listFolderChildrenDirect failed (continuing to Picker anyway)', e);
  }

  setStatus('Granting access (select files)…');
  log('grant picker: requesting access', { folder: approvedFolderId, glb: glbId, images: (imageIds||[]).length, folderCandidates: candidateFromFolder.length });

  // Folder-rooted Picker (MULTISELECT): user selects GLB + images.
  // NOTE: In folder-rooted mode we do not seed fileIds; user must select within the folder UI.
  await openAccessGrantPicker([], {
    title: 'Select GLB and images (multi-select)',
    requiredIds: [glbId],
    allowPartial: false,
    parentId: approvedFolderId,
    mimeTypes: pickerMimeTypes
  });
  try{ window.dispatchEvent(new CustomEvent('lm:refresh-images')); }catch(_e){}
}

setStatus('Loading GLB…');

    try{ window.__LM_ACTIVE_GLB_ID = glbId; }catch(_e){}
    try{ window.__LM_CURRENT_GLB_ID__ = glbId; }catch(_e){}

    const loadFn = await waitForLoadGlbFn();

    try{
      await loadFn(glbId);
    }catch(e){
      // Common failure mode under drive.file: Drive API returns 404/403 until the user
      // explicitly selects the file in Picker.
      if (window.__LM_POLICY_DRIVEFILE_ONLY && isLikelyDriveFileAccessError(e)){
        // Retry with an explicit "grant access" picker for the GLB only.
        setStatus('Grant access…');
        log('grant picker (retry): requesting access for GLB', glbId);
        const assetFolderId = getApprovedAssetFolderId() || undefined;
        const pickerMimeTypes = 'model/gltf-binary,model/gltf+json,application/octet-stream,image/png,image/jpeg,image/webp,image/gif';
        await openAccessGrantPicker([glbId], { requiredIds: [glbId], allowPartial: false, parentId: assetFolderId, mimeTypes: pickerMimeTypes });
        setStatus('Loading GLB…');
        await loadFn(glbId);
      }
      throw e;
    }

    setStatus('');
    log('dataset opened', { spreadsheetId, glbId, imageIds: (imageIds||[]).length });
  }catch(e){
    warn('openDatasetFlow failed', e);
    try{ alert('Open failed: ' + (e?.message||String(e))); }catch(_e){}
    const status2 = document.getElementById('lm-open-status');
    if (status2) status2.textContent = '';
  }finally{
    window.__LM_OPEN_DATASET_FLOW_RUNNING = false;
  }
}

function installUI(){
  // IMPORTANT:
  // The existing "Select sheet…" dropdown is for a worksheet (gid) INSIDE the
  // active spreadsheet (caption sheet selector). We must not mix that control
  // with the spreadsheet file selection UI.

  const existingBtn = document.getElementById('btnPickSpreadsheet')
    || Array.from(document.querySelectorAll('button')).find(b=>String(b.textContent||'').trim()==='Open spreadsheet…');

  if (existingBtn){
    const parent = existingBtn.parentElement;
    if (parent){
      parent.style.display = 'flex';
      parent.style.alignItems = 'center';
      parent.style.gap = '8px';
      parent.style.flexWrap = 'wrap';
      parent.style.width = '100%';
      parent.style.boxSizing = 'border-box';
    }

    existingBtn.id = 'btnPickSpreadsheet';
    try{ existingBtn.classList.add('mini'); }catch(_e){}
    existingBtn.style.flex = '0 0 auto';

    // Ensure input exists in the same row.
    if (!document.getElementById('lmSpreadsheetUrlInput')){
      const inp = document.createElement('input');
      inp.id = 'lmSpreadsheetUrlInput';
      inp.type = 'text';
      inp.placeholder = 'Paste spreadsheet URL or ID…';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.style.flex = '1 1 0';
      inp.style.minWidth = '0';
      inp.style.width = '100%';
      inp.style.maxWidth = '100%';
      inp.style.boxSizing = 'border-box';

      // Match GLB row: input first, button second.
      if (parent) parent.insertBefore(inp, existingBtn);
    }



// Stage B: "Select Asset Folder" button (drive.file entry)
if (!document.getElementById('btnPickAssetFolder')){
  const btnF = document.createElement('button');
  btnF.id = 'btnPickAssetFolder';
  btnF.type = 'button';
  btnF.textContent = 'Select Asset Folder';
  try{ btnF.classList.add('mini'); }catch(_e){}
  btnF.style.flex = '0 0 auto';

  // Place next to "Open spreadsheet…" button.
  parent?.insertBefore(btnF, document.getElementById('lm-open-status') || null);

  btnF.addEventListener('click', async (ev)=>{
    ev.preventDefault();
    const status = document.getElementById('lm-open-status');
    const setStatus = (s)=>{ if (status) status.textContent = s; };

    try{
      setStatus('Select Asset Folder…');
      const id = await openAssetFolderPicker();
      if (!id){ setStatus(''); return; }
      setApprovedAssetFolderId(id);
      setStatus('Asset folder selected.');
    }catch(e){
      warn('asset folder picker failed', e);
      setStatus('');
    }
  }, { passive: false });
}

    // Ensure status element exists (on its own line to avoid overflow).
    if (!document.getElementById('lm-open-status')){
      const st = document.createElement('div');
      st.id = 'lm-open-status';
      st.className = 'muted';
      st.style.marginTop = '2px';
      st.style.fontSize = '12px';
      st.style.whiteSpace = 'nowrap';
      st.style.overflow = 'hidden';
      st.style.textOverflow = 'ellipsis';
      st.style.maxWidth = '100%';
      st.style.flex = '1 1 100%';
      st.style.order = '99';
      parent?.appendChild(st);
    }

    existingBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); openDatasetFlow(); }, { passive: false });
    const inp = document.getElementById('lmSpreadsheetUrlInput');
    if (inp){
      inp.addEventListener('keydown', (ev)=>{
        if (ev.key === 'Enter'){ ev.preventDefault(); openDatasetFlow(); }
      }, { passive: false });
    }

    log('UI augmented (existing button)');
    return;
  }

  const anchor = document.querySelector('.row.ctrl-row.sheet-row');
  if (!anchor) return;

  const row = document.createElement('div');
  row.className = 'row ctrl-row';
  row.style.marginTop = '8px';
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '8px';
  row.style.flexWrap = 'wrap';
  row.style.width = '100%';
  row.style.boxSizing = 'border-box';

  const inp = document.createElement('input');
  inp.id = 'lmSpreadsheetUrlInput';
  inp.type = 'text';
  inp.placeholder = 'Paste spreadsheet URL or ID…';
  inp.autocomplete = 'off';
  inp.spellcheck = false;

  const btn = document.createElement('button');
  btn.id = 'btnPickSpreadsheet';
  btn.type = 'button';
  btn.textContent = 'Open spreadsheet…';
  btn.className = 'mini';

  // Match GLB row ordering: input -> button
  row.appendChild(inp);
  row.appendChild(btn);

  const st = document.createElement('div');
  st.id = 'lm-open-status';
  st.className = 'muted';
  st.style.marginTop = '2px';
  st.style.fontSize = '12px';
  st.style.whiteSpace = 'nowrap';
  st.style.overflow = 'hidden';
  st.style.textOverflow = 'ellipsis';
  st.style.maxWidth = '100%';

  anchor.parentNode.insertBefore(row, anchor);
  anchor.parentNode.insertBefore(st, anchor);

  btn.addEventListener('click', (ev)=>{ ev.preventDefault(); openDatasetFlow(); }, { passive: false });
  inp.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Enter'){ ev.preventDefault(); openDatasetFlow(); }
  }, { passive: false });

  log('UI installed');
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', installUI, { once: true });
} else {
  installUI();
}
