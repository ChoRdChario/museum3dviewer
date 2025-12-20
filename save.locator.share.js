// save.locator.share.js
// Share-mode: find-only save sheet locator (NO create, NO headers).
// Finds a spreadsheet next to the GLB (same folder) with name containing 'LociMyu Save'.
// Exposes a minimal sheet context for downstream read-only consumers.

const TAG = '[save.locator/share]';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

function log(...a){ console.log(TAG, ...a); }
function warn(...a){ console.warn(TAG, ...a); }
function err(...a){ console.error(TAG, ...a); }

export async function findExistingSaveSheetByGlbId(glbFileId){
  if (!glbFileId) return null;
  const fetchJSON = window.__lm_fetchJSONAuth;
  if (typeof fetchJSON !== 'function'){
    throw new Error(TAG + ' missing __lm_fetchJSONAuth (auth boot not loaded?)');
  }

  // 1) resolve GLB parent folder
  let parentId = null;
  try{
    const glbMeta = await fetchJSON(`${DRIVE_BASE}/files/${encodeURIComponent(glbFileId)}?fields=name,parents`);
    parentId = glbMeta?.parents?.[0] || null;
  }catch(e){
    warn('failed to resolve glb parent; continue with root search', e);
  }

  // 2) find existing "LociMyu Save" spreadsheet in same folder
  let q = `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name contains 'LociMyu Save'`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const url = `${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)`;
  const res = await fetchJSON(url);
  const file = res?.files?.[0] || null;
  if (!file){
    log('no save sheet found for glb', glbFileId, 'parent', parentId);
    return { spreadsheetId:null, parentId };
  }
  log('found save sheet', file.id, file.name);
  return { spreadsheetId: file.id, parentId, fileName: file.name };
}

export function dispatchSheetContext(ctx){
  // Share mode needs to interop with modules that listen on BOTH window and document.
  // Also keep both global aliases in sync.
  try{
    const v = (ctx && typeof ctx === 'object') ? ctx : {};
    window.__LM_SHEET_CTX__ = v;
    window.__LM_SHEET_CTX = v;

    const ev1 = new CustomEvent('lm:sheet-context', { detail: v });
    const ev2 = new CustomEvent('lm:sheet-context', { detail: v });
    window.dispatchEvent(ev1);
    document.dispatchEvent(ev2);
  }catch(e){
    // non-fatal
  }
}
