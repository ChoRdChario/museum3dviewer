// features/wiring_captions.js
// Bootstrap captions: Drive sibling images grid, HEIC handling, pins overlay,
// and Sheets load/save with debounced autosave.

import { listSiblingImages, downloadImageBlobIfNeeded } from './drive_images.js';
import { loadPinsFromSheet, savePinsDiff, ensureSheetContext } from './sheets_io.js';

const LOG = (...a)=>console.log('[wiring]', ...a);
const WARN = (...a)=>console.warn('[wiring]', ...a);

// simple toast
function toast(msg, type='info', ms=1400){
  let box = document.getElementById('lmy-toast');
  if(!box){
    box = document.createElement('div');
    box.id = 'lmy-toast';
    Object.assign(box.style, {position:'fixed', right:'16px', bottom:'16px', zIndex:2147483000,
      display:'flex', flexDirection:'column', gap:'8px'});
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  Object.assign(t.style, {padding:'8px 10px', background: type==='error'?'#b42334':'#1f6feb',
    color:'#fff', borderRadius:'8px', fontSize:'12px', boxShadow:'0 6px 18px rgba(0,0,0,.35)'});
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(()=> t.remove(), ms);
}

function getParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

// in-memory
const state = {
  glbId: null,
  folderId: null,
  sheetId: null,
  sheetName: null,
  pins: [],           // [{id,x,y,z,title,body,imageFileId,imageURL,material,updatedAt}]
  selectedPinId: null,
  saving: false,
};

// Exposed entry from init_cloud_boot.js
export async function startCloudBootstrap(){
  // Require ?id=<glbFileId> to resolve siblings/sheet
  state.glbId = getParam('id');
  if(!state.glbId){
    WARN('no ?id: skip cloud bootstrap');
    toast('No ?id: running offline', 'info', 1600);
    return;
  }
  // ensure Drive/Sheets context (folder + spreadsheet + sheet name)
  const ctx = await ensureSheetContext(state.glbId).catch(e=>{WARN('ensureSheetContext failed', e);});
  if(!ctx){ toast('Drive/Sheets init failed', 'error'); return; }
  Object.assign(state, { folderId: ctx.folderId, sheetId: ctx.spreadsheetId, sheetName: ctx.sheetName });
  LOG('ctx', ctx);
  toast('Drive/Sheets ready', 'info', 900);

  // 1) Images grid
  try {
    const images = await listSiblingImages(state.folderId);
    LOG('images', images?.length);
    // Render via phase2a patch API if present
    if(window.__LMY_renderImageGrid){
      window.__LMY_renderImageGrid(images);
    }
  } catch(e){ WARN('listSiblingImages failed', e); }

  // 2) Load pins from Sheets
  try{
    state.pins = await loadPinsFromSheet(state.sheetId, state.sheetName);
    LOG('pins loaded', state.pins.length);
    // optional: tell pins system to render loaded pins
    document.dispatchEvent(new CustomEvent('lmy:pins-loaded', {detail: state.pins}));
  }catch(e){
    WARN('load pins failed', e);
  }

  // 3) Wire events
  wireEvents();
}

function wireEvents(){
  // image picked from grid
  document.addEventListener('lmy:image-picked', async (e)=>{
    const file = e.detail; // {id,name,thumbnailLink,...}
    if(!state.selectedPinId){ toast('Pick a pin first', 'error'); return; }
    try{
      const imgURL = await downloadImageBlobIfNeeded(file.id);
      const pin = state.pins.find(p=>p.id===state.selectedPinId);
      if(pin){
        pin.imageFileId = file.id;
        pin.imageURL = imgURL;
        pin.updatedAt = new Date().toISOString();
        showOverlayForPin(pin);
        scheduleSave();
      }
    }catch(err){
      WARN('image attach failed', err);
      toast('Image attach failed', 'error');
    }
  });

  // add pin via Shift+click (phase2a emits lmy:add-pin with canvas coord)
  document.addEventListener('lmy:add-pin', (e)=>{
    const { id, position } = e.detail || {};
    // id may be provided by app; otherwise make one
    const pinId = id || `pin_${Math.random().toString(36).slice(2,8)}`;
    const pin = { id: pinId, x: position?.x ?? 0, y: position?.y ?? 0, z: position?.z ?? 0,
      title:'', body:'', imageFileId:'', imageURL:'', material:'', updatedAt:new Date().toISOString() };
    state.pins.push(pin);
    state.selectedPinId = pinId;
    // show overlay minimal
    showOverlayForPin(pin);
    scheduleSave();
  });

  // pick existing pin (phase2a emits lmy:pick-pin)
  document.addEventListener('lmy:pick-pin', (e)=>{
    const { id } = e.detail || {};
    state.selectedPinId = id || null;
    const pin = state.pins.find(p=>p.id===state.selectedPinId);
    if(pin) showOverlayForPin(pin); else hideOverlay();
  });

  // simple overlay bindings (app/UI can call these too)
  document.addEventListener('lmy:update-caption', (e)=>{
    const { id, title, body } = e.detail || {};
    const pin = state.pins.find(p=>p.id===id);
    if(!pin) return;
    if(typeof title==='string') pin.title = title;
    if(typeof body==='string') pin.body = body;
    pin.updatedAt = new Date().toISOString();
    showOverlayForPin(pin);
    scheduleSave();
  });
}

function showOverlayForPin(pin){
  if(window.__LMY_overlay?.showOverlay){
    window.__LMY_overlay.showOverlay({ title: pin.title||'', body: pin.body||'', imgUrl: pin.imageURL||'' });
  }
}
function hideOverlay(){
  if(window.__LMY_overlay?.hideOverlay){ window.__LMY_overlay.hideOverlay(); }
}

// debounce save
let saveTimer = null;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{
      await savePinsDiff(state.sheetId, state.sheetName, state.pins);
      toast('Saved', 'info', 800);
    }catch(e){
      WARN('save failed', e);
      toast('Save failed', 'error');
    }
  }, 1200);
}
