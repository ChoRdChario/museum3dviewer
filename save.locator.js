// save.locator.js (ESM) — v2.0 (exports + window alias)
// Responsibilities:
//  - Given a GLB Drive fileId (glbId) and its display name, locate a spreadsheet
//    in the same Drive folder for LociMyu saves. If none exists, create it.
//  - Ensure a __LM_MATERIALS sheet with headers exists.
//  - Ensure a default caption sheet exists and return both gids.
// Works with either:
//  - window.__lm_fetchJSONAuth shim (if present), or
//  - gauth.module.js:getAccessToken() fallback.

import { getAccessToken } from './gauth.module.js';

const DRIVE_V3 = 'https://www.googleapis.com/drive/v3';
const SHEETS_V4 = 'https://sheets.googleapis.com/v4';

function log(...args){ try{ console.log('[save.locator]', ...args); }catch(_){} }
function warn(...args){ try{ console.warn('[save.locator]', ...args); }catch(_){} }

async function fetchAuthJSON(url, options={}) {
  if (typeof window.__lm_fetchJSONAuth === 'function') {
    return window.__lm_fetchJSONAuth(url, options);
  }
  const token = await getAccessToken();
  const headers = Object.assign({}, options.headers || {}, {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if (!res.ok) {
    const t = await res.text().catch(()=>'');
    throw new Error(`HTTP ${res.status} @ ${url} :: ${t.slice(0,200)}`);
  }
  return res.json();
}

async function driveGetFile(fileId, fields='id,name,parents,mimeType') {
  const url = `${DRIVE_V3}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  return fetchAuthJSON(url);
}

async function driveListInParent(parentId, qExtra) {
  const q = [`'${parentId}' in parents`, 'trashed=false'];
  if (qExtra) q.push(qExtra);
  const url = `${DRIVE_V3}/files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name,mimeType)&supportsAllDrives=true`;
  const out = await fetchAuthJSON(url);
  return out.files || [];
}

async function driveMoveToParent(fileId, parentId) {
  // lightweight: add parent without removing existing
  const url = `${DRIVE_V3}/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(parentId)}&supportsAllDrives=true`;
  return fetchAuthJSON(url, { method: 'PATCH' });
}

async function sheetsCreate(title) {
  const url = `${SHEETS_V4}/spreadsheets`;
  const body = { properties: { title } };
  return fetchAuthJSON(url, { method: 'POST', body: JSON.stringify(body) });
}

async function sheetsGet(spreadsheetId) {
  const url = `${SHEETS_V4}/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  return fetchAuthJSON(url);
}

async function sheetsBatchUpdate(spreadsheetId, requests) {
  const url = `${SHEETS_V4}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  return fetchAuthJSON(url, { method: 'POST', body: JSON.stringify({ requests }) });
}

async function sheetsValuesUpdate(spreadsheetId, rangeA1, values) {
  const url = `${SHEETS_V4}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
  return fetchAuthJSON(url, { method: 'PUT', body: JSON.stringify({ values }) });
}

const MATERIAL_HEADERS = [
  'materialKey','opacity','doubleSided','unlitLike',
  'chromakey','chromaTolerance','chromaFeather',
  'noteA','noteB','noteC','updatedAt','updatedBy','sheetGid'
];

function pickSheetByTitle(sheets, title){
  return (sheets||[]).find(s => s.properties?.title === title);
}

async function ensureMaterialsSheet(spreadsheetId, sheetsMeta){
  let mat = pickSheetByTitle(sheetsMeta, '__LM_MATERIALS');
  if (!mat) {
    const add = await sheetsBatchUpdate(spreadsheetId, [{
      addSheet: { properties: { title: '__LM_MATERIALS', gridProperties: { frozenRowCount: 1 } } }
    }]);
    const r = add?.replies?.[0]?.addSheet?.properties;
    mat = { properties: r };
  }
  const gid = mat.properties.sheetId;
  // write headers
  await sheetsValuesUpdate(spreadsheetId, '__LM_MATERIALS!A1:N1', [MATERIAL_HEADERS]);
  return gid;
}


async function ensureDefaultCaptionSheet(spreadsheetId){
  // Do NOT auto-create "Captions" any more.
  // 1) Prefer LM_SHEET_GIDMAP if available and try to resolve by title (legacy installs).
  try{
    if (window.LM_SHEET_GIDMAP && LM_SHEET_GIDMAP.resolveTitleToGid){
      const gid = await LM_SHEET_GIDMAP.resolveTitleToGid(spreadsheetId, "Captions");
      if (gid != null) return gid;
    }
  }catch(e){
    console.warn("[save.locator] gidmap lookup failed (non-fatal)", e);
  }
  // 2) Fallback: fetch metadata and look for an existing sheet named "Captions".
  try{
    const meta = await fetchSpreadsheetMeta(spreadsheetId);
    const found = (meta && meta.sheets || []).find(s => (s.properties||{}).title === "Captions");
    if (found) return found.properties.sheetId;
  }catch(e){
    console.warn("[save.locator] meta lookup failed (non-fatal)", e);
  }
  // 3) No existing caption sheet: return null and let UI guide the user to create/choose.
  console.log("[save.locator] no existing 'Captions' sheet; skip auto-create");
  return null;
}
  return cap.properties.sheetId;
}

/**
 * Main entry (expected by glb.btn.bridge.v3.js)
 * @param {string} glbId - Drive fileId of the GLB
 * @param {string} glbName - Display name of the GLB file
 * @returns {Promise<{spreadsheetId:string, materialsGid:number, defaultCaptionGid:number}>}
 */
export async function findOrCreateSaveSheetByGlbId(glbId, glbName='GLB'){
  log('begin', { glbId, glbName });
  if (!glbId) throw new Error('glbId required');

  // 1) GLB metadata -> parent folder
  const meta = await driveGetFile(glbId, 'id,name,parents');
  const parentId = (meta.parents || [])[0];
  if (!parentId) throw new Error('GLB has no parent folder');

  // 2) Search existing spreadsheet in the same folder
  const candidates = await driveListInParent(parentId, 'mimeType="application/vnd.google-apps.spreadsheet"');
  let file = candidates.find(f => /LociMyu Save/i.test(f.name)) || candidates[0];

  // 3) Create if missing
  if (!file){
    const title = `${glbName} — LociMyu Save`;
    const created = await sheetsCreate(title);
    const sid = created.spreadsheetId;
    await driveMoveToParent(sid, parentId);
    file = { id: sid, name: title, mimeType: 'application/vnd.google-apps.spreadsheet' };
  }
  const spreadsheetId = file.id;

  // 4) Ensure required sheets
  const sheetMeta = await sheetsGet(spreadsheetId);
  const sheets = sheetMeta.sheets || [];
  const materialsGid = await ensureMaterialsSheet(spreadsheetId, sheets);
  const defaultCaptionGid = await ensureDefaultCaptionSheet(spreadsheetId, sheets);

  log('ready', { spreadsheetId, materialsGid, defaultCaptionGid });

  // --- [LM] expose sheet context for listeners (gid-safe) ---
  try {
    window.__lm_ctx = window.__lm_ctx || {};
    Object.assign(window.__lm_ctx, {
      spreadsheetId,
      materialsGid,
      defaultCaptionGid: (typeof defaultCaptionGid !== 'undefined' && defaultCaptionGid != null) ? defaultCaptionGid : null
    });
    document.dispatchEvent(new CustomEvent("lm:sheet-context", {
      detail: {
        spreadsheetId,
        materialsGid,
        defaultCaptionGid: (typeof defaultCaptionGid !== 'undefined' && defaultCaptionGid != null) ? defaultCaptionGid : null
      }
    }));
  } catch (e) {
    console.warn("[save.locator] ctx emit failed", e);
  }
  // --- [/LM] ---

  return { spreadsheetId, materialsGid, defaultCaptionGid };
}

// Back-compat global alias (optional)
if (!window.loc) window.loc = {};
window.loc.findOrCreateSaveSheetByGlbId = findOrCreateSaveSheetByGlbId;

log('module loaded (ESM export active)');
