/* boot.esm.cdn.js — LociMyu boot (Save Layer v2, delete + image preview fixed)
   - UIは即時反映、Sheetsは単一キューで保存（upsert/attach/delete）
   - 画像プレビューは右ペイン＆オーバーレイとも常に1枚
   - キャプションの × で tombstone 設定＋可能なら deleteDimension、削除後 ensureIndex 再構築
*/

// ===== Imports =====
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, setPinSelected, onPinSelect,
  loadGlbFromDrive, onRenderTick, projectPoint, clearPins, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken, getLastAuthError } from './gauth.module.js';

// ===== Small helpers =====
const $  = (id)=>document.getElementById(id);
const qs = (sel,root=document)=>root.querySelector(sel);
const qsa= (sel,root=document)=>Array.from(root.querySelectorAll(sel));
const textOrEmpty = (v)=> v==null ? '' : String(v);
const clamp = (n,min,max)=> Math.min(Math.max(n,min),max);

// Debug toggle
const DEBUG = /(?:\?|&)debug=1(?:&|$)/.test(location.search);
const dlog  = (...a)=>{ if (DEBUG) console.log('[LM]', ...a); };
const dwarn = (...a)=>console.warn('[LM]', ...a);
const derr  = (...a)=>console.error('[LM]', ...a);

// ===== Boot viewer & auth =====
ensureViewer({ canvas: $('gl') });

const __LM_CLIENT_ID = (window.GIS_CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
const __LM_API_KEY   = (window.GIS_API_KEY   || '');
const __LM_SCOPES    = (window.GIS_SCOPES    || 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets');

function onSigned(signed){
  document.documentElement.classList.toggle('signed-in', !!signed);
  const enable = (...els)=>els.forEach(el=>{ if(el) el.disabled = !signed; });
  enable($('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('save-target-rename'), $('rename-input'));
}
setupAuth($('auth-signin'), onSigned, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });

function ensureToken() {
  const t = getAccessToken && getAccessToken();
  if (!t) {
    const err = (typeof getLastAuthError === 'function') ? getLastAuthError() : null;
    if (err) console.warn('[auth] last error:', err);
    alert('Google サインインが必要です。「Sign in」をクリックしてください。');
    throw new Error('token_missing');
  }
  return t;
}

// ===== Drive helpers =====
function extractDriveId(input){
  if(!input) return null;
  const s = String(input).trim();
  const m = s.match(/^[A-Za-z0-9_-]{25,}$/);
  if(m) return m[0];
  try{
    const u = new URL(s);
    const q = u.searchParams.get('id');
    if(q && /^[A-Za-z0-9_-]{25,}$/.test(q)) return q;
    const seg = u.pathname.split('/').filter(Boolean);
    const ix = seg.indexOf('d');
    if(ix!==-1 && seg[ix+1] && /^[A-Za-z0-9_-]{25,}$/.test(seg[ix+1])) return seg[ix+1];
    const any = (u.href||'').match(/[A-Za-z0-9_-]{25,}/);
    if(any) return any[0];
  }catch(_){}
  const any2 = s.match(/[A-Za-z0-9_-]{25,}/);
  return any2? any2[0] : null;
}

function getFileThumbUrl(fileId, token, size){
  size = size|0; if(!size) size=1024;
  const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=thumbnailLink&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization: 'Bearer '+token } })
    .then(r => { if(!r.ok) throw new Error('thumb meta '+r.status); return r.json(); })
    .then(j => {
      if(!j.thumbnailLink) throw new Error('no thumbnailLink');
      const sz = clamp(size,64,2048);
      const sep = j.thumbnailLink.includes('?') ? '&' : '?';
      return j.thumbnailLink + sep + 'sz=s'+String(sz);
    });
}

// ============================================================================
// Save Layer v2 — single-writer queue, vertical sheet
// ============================================================================
const LM_HEADERS_V2 = ["id","x","y","z","title","body","color","imageFileId","updatedAt","tombstone"];

let currentSpreadsheetId = null; // set elsewhere when decided
let currentSheetId       = null; // numeric sheet id
let captionsIndex        = new Map(); // id -> {rowIndex, a1}
let rowCache             = new Map(); // id -> row
let selectedPinId        = null;

let saveQueue = [];
let saving = false;

function nowIso(){ return new Date().toISOString(); }
function a1Row(r){ return `A${r}:J${r}`; } // J = tombstone

async function ensureVerticalSheet(spreadsheetId, sheetId){
  const token = ensureToken();
  // read header
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=${encodeURIComponent('A1:J1')}`;
  const metaRes = await fetch(metaUrl, { headers: { Authorization:'Bearer '+token }});
  if(!metaRes.ok){ throw new Error('metadata '+metaRes.status); }
  const meta = await metaRes.json();
  const row0 = (((meta||{}).sheets||[])[0]||{}).data?.[0]?.rowData?.[0]?.values || [];
  const headers = row0.map(v=> (v.effectiveValue?.stringValue ?? '').trim());
  const ok = LM_HEADERS_V2.every((h,i)=> (headers[i]||'')===h);
  if(ok){ dlog('sheet headers OK'); return; }

  const body = { values: [LM_HEADERS_V2] };
  const url  = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent('A1:J1')}?valueInputOption=RAW`;
  const r = await fetch(url, { method:'PUT', headers: { Authorization:'Bearer '+token,'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if(!r.ok) throw new Error('write headers '+r.status);
  dlog('sheet headers updated to V2');
}

async function ensureIndex(){
  const token = ensureToken();
  if(!currentSpreadsheetId) return;
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}/values/${encodeURIComponent('A2:J')}`;
  const res = await fetch(readUrl, { headers: { Authorization:'Bearer '+token }});
  if(!res.ok) throw new Error('read values '+res.status);
  const js = await res.json();
  const values = js.values || [];

  captionsIndex.clear();
  rowCache.clear();

  for(let i=0;i<values.length;i++){
    const rowIndex = i+2;
    const [id,x,y,z,title,body,color,imageFileId,updatedAt,tombstone] = values[i];
    if(!id) continue;
    captionsIndex.set(id, { rowIndex, a1: a1Row(rowIndex) });
    rowCache.set(id, {
      id,
      x: Number(x)||0, y: Number(y)||0, z: Number(z)||0,
      title: title||'', body: body||'',
      color: color||'', imageFileId: imageFileId||'',
      updatedAt: updatedAt||'', tombstone: String(tombstone||'').toUpperCase()==='TRUE'
    });
  }
  dlog('index built', {count: captionsIndex.size});
}

async function processQueue(){
  if(saving) return;
  saving = true;
  try{
    while(saveQueue.length){
      const job = saveQueue.shift();
      try{
        if(job.type==='upsert')      await _upsertRow(job.id, job.payload);
        else if(job.type==='attach') await _attachImage(job.id, job.payload);
        else if(job.type==='delete') await _deleteRow(job.id, job.payload);
      }catch(e){
        derr('queue job failed', job, e);
        job._retry = (job._retry||0)+1;
        if(job._retry <= 2){ saveQueue.unshift(job); await new Promise(r=>setTimeout(r, 400*job._retry)); }
        else dwarn('drop job after retry', job);
      }
    }
  }finally{
    saving = false;
  }
}

const saveApi = {
  upsert(id, payload){ saveQueue.push({type:'upsert', id, payload}); processQueue(); },
  attachImage(id, fileId){ saveQueue.push({type:'attach', id, payload:{imageFileId:fileId}}); processQueue(); },
  delete(id, opt){ saveQueue.push({type:'delete', id, payload:(opt||{})}); processQueue(); }
};

async function _upsertRow(id, payload){
  const token = ensureToken();
  const meta = captionsIndex.get(id);
  const row = Object.assign({}, rowCache.get(id)||{ id, x:0,y:0,z:0, title:'',body:'',color:'',imageFileId:'',tombstone:false }, payload, {updatedAt: nowIso()});
  rowCache.set(id, row);

  const values = [[
    row.id, row.x, row.y, row.z, row.title, row.body, row.color, row.imageFileId, row.updatedAt, row.tombstone? 'TRUE':'FALSE'
  ]];

  if(meta && meta.rowIndex){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}/values/${encodeURIComponent(meta.a1)}?valueInputOption=RAW`;
    const res = await fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token,'Content-Type':'application/json' }, body: JSON.stringify({values}) });
    if(!res.ok) throw new Error('values.update '+res.status);
  }else{
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}/values/${encodeURIComponent('A2')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token,'Content-Type':'application/json' }, body: JSON.stringify({values}) });
    if(!res.ok) throw new Error('values.append '+res.status);
  }
  await ensureIndex();
}

async function _attachImage(id, payload){
  const meta = rowCache.get(id) || {};
  meta.imageFileId = payload.imageFileId || '';
  await _upsertRow(id, meta);
}

async function _deleteRow(id, opt){
  const token = ensureToken();
  const meta  = captionsIndex.get(id);

  // 1) tombstone=TRUE
  const row = Object.assign({}, rowCache.get(id)||{id}, {tombstone:true, updatedAt:nowIso()});
  const values = [[ row.id, row.x||0,row.y||0,row.z||0, row.title||'',row.body||'',row.color||'',row.imageFileId||'', row.updatedAt, 'TRUE' ]];

  if(meta && meta.rowIndex){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}/values/${encodeURIComponent(meta.a1)}?valueInputOption=RAW`;
    const res = await fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token,'Content-Type':'application/json' }, body: JSON.stringify({values}) });
    if(!res.ok) dwarn('tombstone update failed', res.status);
  }else{
    dwarn('delete: row not indexed, skip tombstone');
  }

  // 2) hard delete (best-effort)
  if(opt && opt.hard && meta && meta.rowIndex){
    try{
      const body = { requests:[{ deleteDimension:{ range:{ sheetId:Number(currentSheetId), dimension:'ROWS', startIndex:meta.rowIndex-1, endIndex:meta.rowIndex } } }] };
      const url  = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
      const r = await fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token,'Content-Type':'application/json' }, body: JSON.stringify(body) });
      if(!r.ok) dwarn('deleteDimension failed', r.status);
    }catch(e){ dwarn('hard delete error', e); }
  }

  // local clear
  rowCache.delete(id);
  captionsIndex.delete(id);

  await ensureIndex();
}

// ===== UI Wiring (only the parts that touch saving layer) =====
window.updateCaptionForPin = function(id, fields){
  if(!id) return;
  const row = Object.assign({}, rowCache.get(id)||{id}, fields);
  rowCache.set(id, row);
  try{ reflectRowToUI(row); }catch(_){}
  try{ refreshPinMarkerFromRow(id); }catch(_){}
  saveApi.upsert(id, row);
};

window.updateImageForPin = function(id, imageFileId){
  if(!id) return Promise.resolve();
  const row = Object.assign({}, rowCache.get(id)||{id}, { imageFileId: imageFileId||'' });
  rowCache.set(id, row);
  try{ renderCurrentImageThumb(); }catch(_){}
  saveApi.attachImage(id, imageFileId||'');
  return Promise.resolve();
};

// 右ペインの現行画像プレビュー（常に1枚）
window.renderCurrentImageThumb = function(){
  const box = $('currentImageThumb');
  if(!box) return;
  box.innerHTML = '';

  const row = selectedPinId ? (rowCache.get(selectedPinId)||{}) : null;
  if(!row || !row.imageFileId){
    box.innerHTML = '<div class="placeholder">No Image</div>';
    return;
  }
  let token = null;
  try{ token = ensureToken(); }catch(_){}
  if(!token){
    box.innerHTML = '<div class="placeholder">No Image</div>';
    return;
  }
  const id = row.imageFileId;
  getFileThumbUrl(id, token, 512).then(url=>{
    box.innerHTML='';
    const wrap = document.createElement('div');
    wrap.className='current-image-wrap';
    wrap.style.position='relative';
    wrap.style.display='inline-block';

    const img = document.createElement('img');
    img.src = url; img.alt=''; img.style.borderRadius='12px'; img.style.maxWidth='100%';

    const x = document.createElement('button');
    x.textContent = '×'; x.title = 'Detach image';
    Object.assign(x.style, { position:'absolute', right:'6px', top:'6px',
      border:'none', width:'28px', height:'28px', borderRadius:'999px',
      background:'#000a', color:'#fff', cursor:'pointer' });
    x.addEventListener('click', (e)=>{ e.stopPropagation(); updateImageForPin(selectedPinId, null).then(renderCurrentImageThumb); });

    wrap.appendChild(img); wrap.appendChild(x);
    box.appendChild(wrap);
  }).catch(()=>{ box.innerHTML='<div class="placeholder">No Image</div>'; });
};

// キャプションリスト項目の削除ハンドラ（例：appendCaptionItem 内で利用）
window.__wireDeleteForItem = function(hostEl, row){
  // hostEl: caption list container; row: current row object
  const delBtn = hostEl.querySelector('[data-action="delete"]');
  if(!delBtn) return;
  delBtn.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    const id = row.id;
    if(!id) return;

    // 即時UI消し
    try{ removePinMarker(id); }catch(_){}
    try{ removeCaptionOverlay(id); }catch(_){}
    const el = hostEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if(el) el.remove();

    // Sheets tombstone + 可能なら物理削除
    saveApi.delete(id, { hard:true });
  });
};

// ===== App boot log =====
console.info('[LociMyu ESM/CDN] boot clean full build loaded');

// ===== Example: after spreadsheet/sheet decided =====
// await ensureVerticalSheet(currentSpreadsheetId, currentSheetId);
// await ensureIndex();
