// dataset.open.ui.js
// UI: "Open spreadsheet…" button (Drive.file mode)
// - Accepts spreadsheet URL/ID input (validated via Sheets API).
// - Falls back to Picker browsing when needed.
// - Resolves GLB fileId from __LM_META.
// - In drive.file mode, triggers a Picker selection step to grant access to:
//   - GLB (required)
//   - Caption candidate image attachments from __LM_IMAGE_STASH (optional)
// - Sets sheet-context (spreadsheetId + default caption sheet gid)
// - Loads GLB via existing GLB loader bridge

import './persist.guard.js';
import { getGlbFileId } from './lm.meta.sheet.read.module.js';
import './picker.bridge.module.js';

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

// Public-file probe: for "anyone with link" files, Picker may not list them even if accessible in-browser.
// We treat those as "public" and skip the access-grant Picker, then rely on viewer/module public fetch fallback.
const __lm_publicProbeCache = new Map(); // fileId -> boolean

async function isPublicDriveFile(fileId){
  const id = String(fileId||'').trim();
  if (!id) return false;
  if (__lm_publicProbeCache.has(id)) return __lm_publicProbeCache.get(id);

  const key = getApiKey();
  if (!key){
    __lm_publicProbeCache.set(id, false);
    return false;
  }

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id&supportsAllDrives=true&key=${encodeURIComponent(key)}`;
  try{
    const res = await fetch(url, { method: 'GET' });
    const ok = !!res && res.ok;
    __lm_publicProbeCache.set(id, ok);
    return ok;
  }catch(_e){
    __lm_publicProbeCache.set(id, false);
    return false;
  }
}

async function filterIdsRequiringPicker(ids){
  const list = uniq(ids);
  if (!list.length) return [];
  const out = [];
  // Sequential: keep it lightweight, avoids bursts in early init.
  for (const id of list){
    const pub = await isPublicDriveFile(id);
    if (!pub) out.push(id);
  }
  return out;
}


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

async function getAuthFetch(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  try{
    const m = await import(new URL('./auth.fetch.bridge.js', import.meta.url));
    if (typeof m.default === 'function') return await m.default();
  }catch(_e){}
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

async function readImageStashFileIds(spreadsheetId){
  // Deprecated: older plan used __LM_IMAGE_STASH. Kept as a no-op for compatibility.
  // Current implementation reads attachment fileIds from each caption sheet's column H (imageFileId).
  return [];
}

async function readCaptionSheetGids(spreadsheetId){
  // __LM_SHEET_NAMES has A=sheetGid, B=displayName, C=sheetTitle, D=updatedAt
  // We rely on gid because the user can rename sheets freely.
  const fetchJSON = await getAuthFetch();
  const range = encodeURIComponent('__LM_SHEET_NAMES!A:A');
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
    params.append('ranges', `${s.title}!H:H`);
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

async function openAccessGrantPicker(fileIds){
  const ids = uniq(fileIds).slice(0, 50);
  if (!ids.length) return null;
  const Picker = window.google?.picker;
  const viewId = Picker?.ViewId?.DOCS || undefined;
  // Multi-select so user can grant access to multiple required files in one step.
  const res = await window.__lm_openPicker({
    title: 'Grant access to files',
    viewId,
    multiselect: true,
    allowSharedDrives: true,
    fileIds: ids
  });
  return res;
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
    let spreadsheetId = '';

    // 1) Direct open path: validate the pasted id via Sheets API.
    if (prefillId){
      setStatus('Checking spreadsheet…');
      try{
        await listSheets(prefillId);
        spreadsheetId = prefillId;
      }catch(e){
        warn('prefill spreadsheet check failed', e);
      }
    }

    // 2) Picker fallback.
    if (!spreadsheetId){
      setStatus('Opening picker…');
      spreadsheetId = await openSpreadsheetPicker(prefillId || '');
    }

    if (!spreadsheetId){
      setStatus('');
      if (prefillId){
        alert('このスプレッドシートは、現在のGoogleアカウントでは選択できない可能性があります。\n\n確認事項:\n- 同じGoogleアカウントでサインインしているか\n- URL/IDが正しいか\n-（ドメイン制限等がある場合）アクセス権があるか');
      }
      return;
    }

    setStatus('Reading spreadsheet…');
    const ctx = await setSheetContext(spreadsheetId);

    // Resolve candidate image attachments (drive.file mode: permission is per-file).
    // Attachments are stored in each caption sheet column H (imageFileId).
    setStatus('Reading attachments…');
    const imageIds = await readAttachmentFileIdsFromCaptionSheets(spreadsheetId, ctx?.sheets||[]);
    try{ window.__LM_CANDIDATE_IMAGE_FILEIDS = imageIds; }catch(_e){}
    try{ window.dispatchEvent(new CustomEvent('lm:refresh-images')); }catch(_e){}

    // Resolve GLB id.
    let glbId = await getGlbFileId(spreadsheetId);
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
    if (window.__LM_POLICY_DRIVEFILE_ONLY){
      const ids = uniq([glbId, ...(imageIds||[])]).filter(Boolean);
      if (ids.length){
        // Picker cannot reliably list "anyone-with-link" public files even if they open in a browser.
        // If a file looks public, skip the grant picker and rely on public fetch fallback in viewer/images loader.
        const needPicker = await filterIdsRequiringPicker(ids);
        if (needPicker.length){
          setStatus('Granting access…');
          log('grant picker: requesting access for', needPicker);
          await openAccessGrantPicker(needPicker);
          try{ window.dispatchEvent(new CustomEvent('lm:refresh-images')); }catch(_e){}
        }else{
          log('grant picker: skipped (all files look public)', ids);
        }
      }
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
        const needPicker = await filterIdsRequiringPicker([glbId, ...(imageIds||[])]);
        if (needPicker.length){
          setStatus('Grant access…');
          log('grant picker (retry): requesting access for', needPicker);
          await openAccessGrantPicker(needPicker);
          setStatus('Loading GLB…');
          await loadFn(glbId);
        } else {
          // If the file looks public, Picker will likely be empty. Let the original error surface.
          throw e;
        }
      } else {
        throw e;
      }
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
      inp.style.flex = '1 1 0';
      inp.style.minWidth = '0';
      inp.style.width = '100%';
      inp.style.maxWidth = '100%';
      inp.style.boxSizing = 'border-box';

      // Match GLB row: input first, button second.
      if (parent) parent.insertBefore(inp, existingBtn);
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
