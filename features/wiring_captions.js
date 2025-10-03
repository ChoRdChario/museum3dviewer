// features/wiring_captions.js  (robust Drive ID + OAuth fetch + cloud wiring)
// NOTE: does NOT import loadPins from sheets_io.js anymore.
//       Instead, implements local loadPinsFromSheets() via gapi.sheets.

import { ensureLoaded, isAuthed } from './auth.js';
import { ensureSheetContext } from './sheets_io.js';
import { listSiblingImages } from './drive_images.js';

function log(...a){ console.log('[wiring]', ...a); }
function warn(...a){ console.warn('[wiring]', ...a); }

export function extractDriveId(input){
  if (!input) return null;
  let s = String(input).trim();
  s = s.replace(/[<>"'\s]/g, '');
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/^([a-zA-Z0-9_-]{10,})$/);
  if (m) return m[1];
  return null;
}

async function downloadGlbBlobOAuth(fileId){
  const tk = gapi.client.getToken()?.access_token;
  if(!tk) throw new Error('no OAuth token');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
  if(!res.ok){
    const text = await res.text().catch(()=>'');
    const err = new Error(`http ${res.status}`);
    err.responseText = text;
    throw err;
  }
  return await res.blob();
}

// --- Local Pins loader (Sheets API) --------------------------
async function loadPinsFromSheets(spreadsheetId, sheetName='captions'){
  try{
    const resp = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:Z9999`,
      majorDimension: 'ROWS'
    });
    const rows = resp.result.values || [];
    if (rows.length <= 1) return [];
    const header = rows[0].map(h => (h || '').toLowerCase().trim());
    const idx = (name) => header.indexOf(name);
    const out = [];
    for (let i=1; i<rows.length; i++){
      const r = rows[i];
      // defensive access
      const get = (name) => {
        const j = idx(name);
        return j >= 0 ? (r[j] ?? '') : '';
      };
      // Accept common columns; fall back gracefully.
      out.push({
        id: get('id') || `${i}`,
        x: parseFloat(get('x')) || 0,
        y: parseFloat(get('y')) || 0,
        z: parseFloat(get('z')) || 0,
        title: get('title') || get('name') || '',
        body: get('body') || get('desc') || '',
        imageId: get('imageid') || get('image_id') || get('image') || ''
      });
    }
    return out;
  }catch(err){
    warn('sheets values.get failed', err);
    return [];
  }
}
// -------------------------------------------------------------

export async function startCloudBootstrap(fileIdRaw){
  await ensureLoaded();
  if (!isAuthed()) { warn('not authed'); return; }
  let raw = fileIdRaw || new URLSearchParams(location.search).get('id');
  const fileId = extractDriveId(raw);
  if (!fileId){ warn('invalid id input', fileIdRaw); return; }

  try{
    const blob = await downloadGlbBlobOAuth(fileId);
    document.dispatchEvent(new CustomEvent('lmy:load-glb-blob', { detail: { blob } }));
    log('glb ok');
  }catch(err){
    warn('glb load failed', err);
    return;
  }

  let ctx;
  try{
    ctx = await ensureSheetContext(fileId);
    log('ctx', ctx);
  }catch(err){
    warn('ensureSheetContext failed', err);
    return;
  }

  try{
    const images = await listSiblingImages(ctx.folderId);
    log('images', images.length);
    const pins = await loadPinsFromSheets(ctx.spreadsheetId, ctx.sheetName || 'captions');
    log('pins loaded', pins.length);
    window.__LMY_ctx = ctx;
    document.dispatchEvent(new CustomEvent('lmy:cloud-ready', { detail: { ctx, images, pins } }));
  }catch(err){
    warn('list/load failed', err);
  }
}

export async function bootstrapWithIdFromInput(){
  const v = document.getElementById('cloud_glb_id')?.value || '';
  await startCloudBootstrap(v);
}
