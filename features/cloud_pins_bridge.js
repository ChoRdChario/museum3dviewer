// features/cloud_pins_bridge.js
// Bridge Sheets <-> App pins, plus image blob URL resolver
import { ensureLoaded, isAuthed } from './auth.js';
import { ensureSheetContext, loadPins, appendPin } from './sheets_io.js';

const state = {
  ctx: null,
  pins: [], // {id,x,y,z,title,body,imageId}
  imagesIndex: new Map(), // id -> {id,name,thumbnailLink}
};
function log(...a){ console.log('[cloud-pins]', ...a); }
function warn(...a){ console.warn('[cloud-pins]', ...a); }

// Receive cloud-ready context (from wiring_captions.js)
document.addEventListener('lmy:cloud-ready', async (e)=>{
  state.ctx = e.detail?.ctx || null;
  const images = e.detail?.images || [];
  state.imagesIndex.clear();
  images.forEach(it => state.imagesIndex.set(it.id, it));
  state.pins = e.detail?.pins || [];
  log('ready: pins', state.pins.length, 'images', images.length);
  // Notify viewer/app that pins are available
  document.dispatchEvent(new CustomEvent('lmy:pins-ready', { detail: { pins: state.pins } }));
});

// Public helpers
export function getPins(){ return state.pins.slice(); }
export function getCtx(){ return state.ctx; }

// App -> save a new pin (debounced write)
let saveTimer=null;
export async function saveNewPin(pin){
  if(!state.ctx) return warn('no ctx');
  // allocate id if empty
  if(!pin.id){ pin.id = String(Date.now()); }
  state.pins.push(pin);
  scheduleFlush(pin);
  // echo to overlay/select
  document.dispatchEvent(new CustomEvent('lmy:select-pin', { detail: await decoratePin(pin) }));
  return pin.id;
}

function scheduleFlush(pin){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{
      await ensureLoaded();
      if(!isAuthed()) return warn('not authed');
      await appendPin(state.ctx.spreadsheetId, pin);
      log('saved pin', pin.id);
    }catch(err){ warn('append failed', err); }
  }, 800);
}

export async function decoratePin(pin){
  // attach image blob url if present
  let imgUrl = null;
  if(pin.imageId){
    try{
      const res = await gapi.client.drive.files.get({
        fileId: pin.imageId, alt:'media', supportsAllDrives:true
      });
      const blob = new Blob([res.body]);
      imgUrl = URL.createObjectURL(blob);
    }catch(err){ /* ignore */ }
  }
  return { ...pin, imgUrl, meta: pin.id ? `#${pin.id}` : '' };
}

// Global back-compat hook for app
if(!window.__LMY_cloudPins){
  window.__LMY_cloudPins = {
    getPins, getCtx, saveNewPin, decoratePin
  };
}
