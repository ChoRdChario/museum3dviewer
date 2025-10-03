// features/wiring_captions.js  (v1d: also loads GLB from Drive)
import { listSiblingImages, downloadImageBlobIfNeeded } from './drive_images.js';
import { loadPinsFromSheet, savePinsDiff, ensureSheetContext } from './sheets_io.js';
import { downloadGlbBlob } from './drive_glb.js';   // ← existing util（なければ同梱版を使う）
import './viewer_bridge.js';                        // ← adapter への橋渡し

const LOG = (...a)=>console.log('[wiring]', ...a);
const WARN = (...a)=>console.warn('[wiring]', ...a);

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

// --- accept full Drive URL or raw id
export function extractFileId(raw){
  if(!raw) return null;
  raw = String(raw).trim();
  if(/^[a-zA-Z0-9_-]{12,}$/.test(raw)) return raw; // already id
  try{
    const u = new URL(raw);
    const m1 = u.pathname.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if(m1) return m1[1];
    const idq = u.searchParams.get('id');
    if(idq) return idq;
  }catch{}
  const m2 = raw.match(/([a-zA-Z0-9_-]{10,})/);
  return m2 ? m2[1] : null;
}

function getParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}
function setParam(name, value){
  const u = new URL(location.href);
  if(value==null || value===''){ u.searchParams.delete(name); }
  else { u.searchParams.set(name, value); }
  history.replaceState({}, '', u.toString());
}

const state = {
  glbId: null,
  folderId: null,
  sheetId: null,
  sheetName: null,
  pins: [],
  selectedPinId: null,
};

window.__LMY_startWithFileId = async (input)=>{
  const id = extractFileId(input);
  if(!id){ toast('Invalid GLB id/URL', 'error'); return; }
  await bootstrapWithId(id);
};

export async function startCloudBootstrap(){
  try { if(window.__LMY_renderImageGrid) window.__LMY_renderImageGrid([]); } catch {}
  ensureManualBox();

  const raw = getParam('id');
  const id = extractFileId(raw);
  if(!id){
    WARN('no ?id (or unparsable): waiting for manual start');
    toast('Cloud: paste GLB fileId or URL', 'info', 1600);
    return;
  }
  await bootstrapWithId(id);
}

async function bootstrapWithId(glbFileId){
  state.glbId = glbFileId;
  setParam('id', glbFileId);

  // 0) まずモデルをロード（視覚的フィードバック）
  try{
    toast('Loading GLB from Drive...', 'info', 1200);
    const blob = await downloadGlbBlob(glbFileId);
    await window.__LMY_loadGlbBlob(blob); // viewer_bridge が吸収
    LOG('glb loaded');
  }catch(e){
    WARN('glb load failed', e);
    toast('GLB load failed', 'error', 1600);
    // 失敗しても Cloud 連携は継続
  }

  // 1) Drive/Sheets context
  let ctx;
  try{
    ctx = await ensureSheetContext(state.glbId);
  }catch(e){
    WARN('ensureSheetContext failed', e);
    toast('Drive/Sheets init failed', 'error');
    return;
  }
  Object.assign(state, { folderId: ctx.folderId, sheetId: ctx.spreadsheetId, sheetName: ctx.sheetName });
  LOG('ctx', ctx);
  toast('Drive/Sheets ready', 'info', 900);

  // 2) 画像列挙
  try {
    const images = await listSiblingImages(state.folderId);
    LOG('images', images?.length);
    if(window.__LMY_renderImageGrid) window.__LMY_renderImageGrid(images);
  } catch(e){ WARN('listSiblingImages failed', e); }

  // 3) ピン読み込み
  try{
    state.pins = await loadPinsFromSheet(state.sheetId, state.sheetName);
    LOG('pins loaded', state.pins.length);
    document.dispatchEvent(new CustomEvent('lmy:pins-loaded', {detail: state.pins}));
  }catch(e){ WARN('load pins failed', e); }

  wireEvents();
}

function ensureManualBox(){
  const side = document.getElementById('side');
  if(!side) return;
  let box = document.getElementById('lmy-cloud-bootstrap');
  if(box) return;
  box = document.createElement('section');
  box.id = 'lmy-cloud-bootstrap';
  box.innerHTML = `
    <h4 style="margin:.75rem 0 .5rem">Cloud</h4>
    <div style="display:flex;gap:6px;align-items:center">
      <input id="lmy-fileid" placeholder="GLB fileId or Drive URL" style="flex:1;background:#0f0f10;border:1px solid #222;border-radius:8px;color:#ddd;padding:6px 8px"/>
      <button id="lmy-fileid-start" style="background:#1f6feb;color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer">Start</button>
    </div>
    <p style="opacity:.6;font-size:12px;margin:.35rem 0 0">id または Drive の共有URLを貼って Start。</p>
  `;
  side.appendChild(box);
  box.querySelector('#lmy-fileid-start').onclick = async ()=>{
    const id = extractFileId(box.querySelector('#lmy-fileid').value);
    if(!id){ toast('Invalid GLB id/URL', 'error'); return; }
    await bootstrapWithId(id);
  };
}

let wired = false;
function wireEvents(){
  if(wired) return; wired = true;

  document.addEventListener('lmy:image-picked', async (e)=>{
    const file = e.detail;
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
      console.warn('image attach failed', err);
      toast('Image attach failed', 'error');
    }
  });

  document.addEventListener('lmy:add-pin', (e)=>{
    const { id, position } = e.detail || {};
    const pinId = id || `pin_${Math.random().toString(36).slice(2,8)}`;
    const pin = { id: pinId, x: position?.x ?? 0, y: position?.y ?? 0, z: position?.z ?? 0,
      title:'', body:'', imageFileId:'', imageURL:'', material:'', updatedAt:new Date().toISOString() };
    state.pins.push(pin);
    state.selectedPinId = pinId;
    showOverlayForPin(pin);
    scheduleSave();
  });

  document.addEventListener('lmy:pick-pin', (e)=>{
    const { id } = e.detail || {};
    state.selectedPinId = id || null;
    const pin = state.pins.find(p=>p.id===state.selectedPinId);
    if(pin) showOverlayForPin(pin); else hideOverlay();
  });

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

let saveTimer = null;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{
      await savePinsDiff(state.sheetId, state.sheetName, state.pins);
      toast('Saved', 'info', 800);
    }catch(e){ console.warn('save failed', e); toast('Save failed', 'error'); }
  }, 1200);
}
