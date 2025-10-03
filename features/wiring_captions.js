// features/wiring_captions.js  (v2 — robust Drive ID, auth-gated, proper blob fetch)
import { ensureLoaded, isAuthed } from './auth.js';
import { ensureSheetContext, loadPins } from './sheets_io.js';
import { listSiblingImages } from './drive_images.js';

function log(...a){ console.log('[wiring]', ...a); }
function warn(...a){ console.warn('[wiring]', ...a); }

// ---- Drive fileId extractor (URL / id / <id> / open?id=... / uc?id=... 全対応) ----
export function extractDriveId(input){
  if (!input) return null;
  let s = String(input).trim();
  // remove angle brackets & quotes and whitespace
  s = s.replace(/[<>"'\s]/g, '');
  // /file/d/<id>/... pattern
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  // ?id=<id> pattern (open, uc 等)
  m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  // plain id
  m = s.match(/^([a-zA-Z0-9_-]{10,})$/);
  if (m) return m[1];
  return null;
}

// ---- GLB download using OAuth Bearer (binary-safe) ----
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

export async function startCloudBootstrap(fileIdRaw){
  await ensureLoaded();
  if (!isAuthed()) { warn('not authed'); return; }

  // allow ?id= on URL as fallback when no arg
  let raw = fileIdRaw || new URLSearchParams(location.search).get('id');
  const fileId = extractDriveId(raw);
  if (!fileId){ warn('invalid id input', fileIdRaw); return; }

  // 1) Load GLB -> viewer
  try{
    const blob = await downloadGlbBlobOAuth(fileId);
    document.dispatchEvent(new CustomEvent('lmy:load-glb-blob', { detail: { blob } }));
    log('glb ok');
  }catch(err){
    warn('glb load failed', err);
    return; // GLBが出ないと以降のUIテストが進まないので打ち切り
  }

  // 2) Ensure ctx (spreadsheet at same folder)
  let ctx;
  try{
    ctx = await ensureSheetContext(fileId);
    log('ctx', ctx);
  }catch(err){
    warn('ensureSheetContext failed', err);
    return;
  }

  // 3) Images & pins
  try{
    const images = await listSiblingImages(ctx.folderId);
    log('images', images.length);
    const pins = await loadPins(ctx.spreadsheetId);
    log('pins loaded', pins.length);
    // broadcast
    window.__LMY_ctx = ctx;
    document.dispatchEvent(new CustomEvent('lmy:cloud-ready', { detail: { ctx, images, pins } }));
  }catch(err){
    warn('list/load failed', err);
  }
}

// Manual button → call with textbox
export async function bootstrapWithIdFromInput(){
  const v = document.getElementById('cloud_glb_id')?.value || '';
  await startCloudBootstrap(v);
}
