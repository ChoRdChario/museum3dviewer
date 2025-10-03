// features/wiring_captions.js  (v6.6.1)
import { getParentFolderId } from './drive_ctx.js';
import { renderImagesGrid, downloadFileBlob } from './images_siblings.js';
import { findOrCreateSpreadsheetInSameFolder, loadCaptions, upsertCaption } from './sheets_captions.js';

const state = { folderId:null, sheetId:null, debounceTimer:null, currentPinId:null };
function qsId(){ try{ return new URL(location.href).searchParams.get('id'); }catch{ return null; } }
function debounce(fn, ms){ return (...a)=>{ clearTimeout(state.debounceTimer); state.debounceTimer=setTimeout(()=>fn(...a), ms); }; }

async function boot(){
  try{
    const glbId = qsId(); if(!glbId) { console.warn('[wiring] no ?id; skip cloud bootstrap'); return; }
    state.folderId = await getParentFolderId(glbId);
    await renderImagesGrid(state.folderId);
    state.sheetId = await findOrCreateSpreadsheetInSameFolder(state.folderId);
    const rows = await loadCaptions(state.sheetId);
    if (window.pins?.load) window.pins.load(rows);
    console.log('[wiring] captions loaded:', rows.length);
  }catch(e){ console.warn('[wiring] bootstrap skipped:', e?.message||e); }
}

document.addEventListener('lmy:image-picked', async (e)=>{
  const file = e.detail;
  try{
    const blob = await downloadFileBlob(file.id);
    const url = URL.createObjectURL(blob);
    if (window.__LMY_overlay?.showOverlay && state.currentPinId) window.__LMY_overlay.showOverlay({ imgUrl:url });
    if (state.sheetId && state.currentPinId){
      const pin = window.pins?.getById ? window.pins.getById(state.currentPinId) : null;
      const row = { pinId: state.currentPinId, matKey: pin?.matKey||'', position: pin?.position||[0,0,0], title: pin?.title||'', body: pin?.body||'', imageId:file.id, imageURL:'' };
      debounce((sid,r)=>upsertCaption(sid,r),1500)(state.sheetId,row);
    }
  }catch(err){ console.warn('[wiring] image pick failed', err); }
});

document.addEventListener('lmy:add-pin', (e)=>{ state.currentPinId = null; });
document.addEventListener('lmy:pick-pin', (e)=>{ const pin=e.detail?.pin||null; state.currentPinId = pin?.pinId||pin?.id||null; });

export async function startCloudBootstrap(){ await boot(); }
