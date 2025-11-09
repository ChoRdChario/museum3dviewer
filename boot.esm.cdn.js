// boot.esm.cdn.js — LociMyu boot (clean full build, overlay image + Sheets delete fixes)

// ---------- Globals (palette & helpers) ----------
window.LM_PALETTE = window.LM_PALETTE || ["#ef9368","#e9df5d","#a8e063","#8bb6ff","#b38bff","#86d2c4","#d58cc1","#9aa1a6"];
window.currentPinColor = window.currentPinColor || window.LM_PALETTE[0];

function lm_hexToRgb(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex||"000000"));
  return { r:parseInt((m&&m[1])||"00",16), g:parseInt((m&&m[2])||"00",16), b:parseInt((m&&m[3])||"00",16) };
}
window.nearestPalette = window.nearestPalette || function nearestPalette(hex){
  const P=window.LM_PALETTE;
  const base=P[0];
  const c=lm_hexToRgb(hex||base); let best=base,score=1e9;
  for(const q of P){ const t=lm_hexToRgb(q); const d=(c.r-t.r)**2+(c.g-t.g)**2+(c.b-t.b)**2; if(d<score){score=d;best=q;} }
  return best;
};
function lmCanonicalColor(hex){
  try{ return window.nearestPalette(hex||window.currentPinColor||window.LM_PALETTE[0]); }
  catch(_){ return hex||window.LM_PALETTE[0]; }
}

// ---------- Imports ----------
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, setPinSelected, onPinSelect,
  loadGlbFromDrive, onRenderTick, projectPoint, clearPins, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken, getLastAuthError } from './gauth.module.js';

// ---------- DOM helpers ----------
const $ = (id)=>document.getElementById(id);
const setEnabled = (on, ...els)=> els.forEach(el=>{ if(el) el.disabled = !on; });
const textOrEmpty = (v)=> v==null ? '' : String(v);
const clamp = (n,min,max)=> Math.min(Math.max(n,min),max);

// ---------- Boot viewer & auth ----------
ensureViewer({ canvas: $('gl') });

const __LM_CLIENT_ID = (window.GIS_CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
const __LM_API_KEY   = (window.GIS_API_KEY   || '');
const __LM_SCOPES    = (window.GIS_SCOPES    || 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets');

function onSigned(signed){
  document.documentElement.classList.toggle('signed-in', !!signed);
  setEnabled(!!signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('save-target-rename'), $('rename-input'));
}
setupAuth($('auth-signin'), onSigned, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });

function ensureToken() {
  const t = getAccessToken();
  if (!t) {
    const err = (typeof getLastAuthError === 'function') ? getLastAuthError() : null;
    if (err) console.warn('[auth] last error:', err);
    alert('Google サインインが必要です。「Sign in」をクリックしてください。');
    throw new Error('token_missing');
  }
  return t;
}

// ---------- Drive helpers ----------
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
function getFileBlobUrl(fileId, token){
  if(!fileId || !token) return Promise.reject(new Error('missing fileId/token'));
  const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization: 'Bearer '+token } })
    .then(r => {
      if(!r.ok) throw new Error('media '+r.status);
      const ct = (r.headers.get('Content-Type')||'').toLowerCase();
      if(/image\/(heic|heif)/.test(ct)) throw new Error('unsupported image format: HEIC');
      return r.blob();
    })
    .then(blob => URL.createObjectURL(blob));
}
function getParentFolderId(fileId, token){
  const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=parents&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization:'Bearer '+token } })
    .then(r => r.ok ? r.json() : null)
    .then(j => (j && j.parents && j.parents[0]) ? j.parents[0] : null);
}

// ---------- Global state ----------
let lastGlbFileId = null;
let currentSpreadsheetId = null;
let currentSheetId = null;
let currentSheetTitle = null;
let selectedPinId = null;

const captionsIndex = new Map();  // id -> { rowIndex }
const captionDomById = new Map(); // id -> element
const rowCache = new Map();       // id -> row
const overlays = new Map();       // id -> { root, imgEl, zoom }
let  filterMode = 'all';          // 'all' | 'selected' | 'color:#rrggbb'

// ---------- Quick styles ----------
(()=>{
  const st=document.createElement('style');
  st.textContent = `
  .caption-item{display:flex;gap:.5rem;padding:.5rem;border-bottom:1px solid #1116;cursor:pointer}
  .caption-item.is-selected{outline:2px solid #fff;outline-offset:-2px;border-radius:6px}
  .caption-item.is-hidden{display:none}
  .cap-overlay{user-select:none}
  .cap-overlay button{font:inherit}
  .thumb{width:64px;height:64px;background-size:cover;background-position:center;border-radius:8px;cursor:pointer;margin:4px;display:inline-block}
  .cap-title{font-weight:700}
  .cap-body.hint{opacity:.8;font-size:12px}
  .cap-del{margin-left:auto;background:transparent;border:1px solid #334155;color:#eee;border-radius:6px;padding:0 .5rem;cursor:pointer}
  .chip{--chip:#ccc; inline-size:28px; block-size:20px; border-radius:999px; border:1px solid #0006; background:var(--chip); cursor:pointer; margin:2px}
  .chip-color.is-active{outline:2px solid #fff; outline-offset:1px}
  .chip-actions{display:flex; gap:.5rem; margin:.25rem 0}
  .chip-action{padding:.25rem .5rem; border-radius:8px; border:1px solid #334155; background:#0b0f14; color:#e5e7eb; cursor:pointer}
  .chip-filter .mark{display:none; font-weight:700}
  .chip-filter.is-on .mark{display:inline}
  `;
  document.head.appendChild(st);
})();

// ---------- Overlay helpers ----------
let lineLayer = null;
function ensureLineLayer(){
  if(lineLayer) return lineLayer;
  const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('width','100vw'); s.setAttribute('height','100vh');
  s.style.position='fixed'; s.style.left='0'; s.style.top='0';
  s.style.pointerEvents='none'; s.style.zIndex='999';
  document.body.appendChild(s);
  lineLayer = s; return s;
}
function getOrMakeLine(id){
  const l = ensureLineLayer();
  let el = l.querySelector('line[data-id="'+id+'"]');
  if(!el){
    el = document.createElementNS('http://www.w3.org/2000/svg','line');
    el.setAttribute('data-id', id);
    el.setAttribute('stroke', '#ffffffaa');
    el.setAttribute('stroke-width', '2');
    l.appendChild(el);
  }
  return el;
}
function removeLine(id){
  if(!lineLayer) return;
  const el = lineLayer.querySelector('line[data-id="'+id+'"]');
  if(el) el.remove();
}
function removeCaptionOverlay(id){
  const o = overlays.get(id);
  if(!o) return;
  o.root.remove();
  overlays.delete(id);
  removeLine(id);
}

function createCaptionOverlay(id, data){
  removeCaptionOverlay(id);
  const root = document.createElement('div'); root.className='cap-overlay';
  root.style.position='fixed'; root.style.zIndex='1000';
  root.style.background='#0b0f14ef'; root.style.color='#e5e7eb';
  root.style.padding='10px 12px'; root.style.borderRadius='10px';
  root.style.boxShadow='0 8px 24px #000a'; root.style.minWidth='200px'; root.style.maxWidth='300px';
  root.style.paddingTop = '40px'; // fixed control area

  // controls
  const ctrl = document.createElement('div');
  ctrl.style.position='absolute'; ctrl.style.left='10px'; ctrl.style.top='8px';
  ctrl.style.display='flex'; ctrl.style.gap='8px';
  const bZoomOut = document.createElement('button'); bZoomOut.textContent='–';
  const bZoomIn  = document.createElement('button'); bZoomIn .textContent='+';
  const bClose   = document.createElement('button'); bClose  .textContent='×';
  [bZoomOut,bZoomIn,bClose].forEach(b=>{
    b.style.border='none'; b.style.background='transparent'; b.style.color='#ddd'; b.style.cursor='pointer';
    b.style.fontWeight='700';
  });
  ctrl.append(bZoomOut,bZoomIn,bClose);
  root.appendChild(ctrl);

  // drag handle
  const topbar = document.createElement('div');
  topbar.style.height='20px'; topbar.style.marginBottom='6px'; topbar.style.cursor='move';
  root.appendChild(topbar);

  const t = document.createElement('div'); t.className='cap-title'; t.style.marginBottom='6px';
  const body = document.createElement('div'); body.className='cap-body'; body.style.fontSize='12px'; body.style.opacity='.95'; body.style.whiteSpace='pre-wrap'; body.style.marginBottom='6px';
  const img = document.createElement('img'); img.className='cap-img'; img.alt=''; img.style.display='none'; img.style.width='100%'; img.style.height='auto'; img.style.borderRadius='8px';

  const safeTitle = (data && data.title ? String(data.title).trim() : '') || '(untitled)';
  const safeBody  = (data && data.body  ? String(data.body ).trim() : '') || '(no description)';
  t.textContent = safeTitle; body.textContent = safeBody;

  // drag move
  let dragging=false, startX=0, startY=0, baseLeft=0, baseTop=0;
  topbar.addEventListener('pointerdown', (ev)=>{
    dragging=true; startX=ev.clientX; startY=ev.clientY;
    baseLeft=parseFloat(root.style.left||'0'); baseTop=parseFloat(root.style.top||'0');
    root.setPointerCapture && root.setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  });
  window.addEventListener('pointermove', (ev)=>{
    if(!dragging) return;
    const dx=ev.clientX-startX, dy=ev.clientY-startY;
    root.style.left=(baseLeft+dx)+'px'; root.style.top=(baseTop+dy)+'px';
  });
  window.addEventListener('pointerup', ()=>{ dragging=false; });

  // image fill now & on changes
  overlays.set(id, { root, imgEl:img, zoom:1.0 });
  document.body.appendChild(root);
  applyOverlayZoom(id, 1.0);
  updateOverlayPosition(id, true);
  refreshOverlayImage(id); // ← 初期表示時に反映

  // zoom & close
  bZoomIn .addEventListener('click', (e)=>{ e.stopPropagation(); applyOverlayZoom(id, Math.min(2.0, (overlays.get(id)?.zoom||1)+0.1)); });
  bZoomOut.addEventListener('click', (e)=>{ e.stopPropagation(); applyOverlayZoom(id, Math.max(0.6, (overlays.get(id)?.zoom||1)-0.1)); });
  bClose  .addEventListener('click', (e)=>{ e.stopPropagation(); removeCaptionOverlay(id); });

  root.append(t, body, img);
}
function applyOverlayZoom(id, z){
  const o = overlays.get(id); if(!o) return;
  o.zoom = z;
  const BASE=260;
  o.root.style.maxWidth = (BASE*z)+'px';
  o.root.style.minWidth = (200*z)+'px';
  updateOverlayPosition(id);
}
function updateOverlayPosition(id, initial){
  const o = overlays.get(id); if(!o) return;
  const d = rowCache.get(id); if(!d) return;
  const p = projectPoint(d.x, d.y, d.z);
  if(!p.visible){ o.root.style.display='none'; removeLine(id); return; }
  o.root.style.display='block';
  if(initial && !o.root.style.left){
    o.root.style.left=(p.x+14)+'px'; o.root.style.top=(p.y+14)+'px';
  }
  const r = o.root.getBoundingClientRect();
  const line = getOrMakeLine(id);
  const cx = Math.min(Math.max(p.x, r.left), r.right);
  const cy = Math.min(Math.max(p.y, r.top ), r.bottom);
  line.setAttribute('x1', String(cx));
  line.setAttribute('y1', String(cy));
  line.setAttribute('x2', String(p.x));
  line.setAttribute('y2', String(p.y));
}
onRenderTick(()=>{ overlays.forEach((_,id)=> updateOverlayPosition(id,false)); });

function refreshOverlayImage(id){
  const o = overlays.get(id); if(!o) return;
  const row = rowCache.get(id)||{};
  const token = getAccessToken();
  const img = o.imgEl;
  if(!img) return;
  img.style.display='none';
  if(!row.imageFileId || !token){ img.removeAttribute('src'); return; }
  // try blob first, then thumb
  getFileBlobUrl(row.imageFileId, token).then((url)=>{
    img.src=url; img.style.display='block';
  }).catch(()=>{
    return getFileThumbUrl(row.imageFileId, token, 1024).then((url)=>{ img.src=url; img.style.display='block'; }).catch(()=>{});
  });
}

// ---------- Selection helpers ----------
function markListSelected(id){
  const host = $('caption-list'); if(!host) return;
  host.querySelectorAll('.caption-item.is-selected').forEach(n=>n.classList.remove('is-selected'));
  const el = host.querySelector('.caption-item[data-id="'+CSS.escape(id)+'"]');
  if(el) el.classList.add('is-selected');
}
function fillFormFromCaption(id){
  const row = rowCache.get(id) || {};
  const t=$('caption-title'), b=$('caption-body');
  if(t) t.value = row.title || '';
  if(b) b.value = row.body  || '';
  const col = $('pinColor'); if(col && row.color) col.value = row.color;
}
function selectCaption(id){
  selectedPinId = id;
  markListSelected(id);
  fillFormFromCaption(id);
  setPinSelected(id, true);
  createCaptionOverlay(id, rowCache.get(id) || {});
}
onPinSelect((id)=> selectCaption(id));

// ---------- Sheets I/O ----------
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId','createdAt','updatedAt'];

function colA1(i0){ let n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }
function putValues(spreadsheetId, rangeA1, values, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
  return fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) }).then(r=>{ if(!r.ok) throw new Error('values.update '+r.status); });
}
function appendValues(spreadsheetId, rangeA1, values, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) }).then(r=>{ if(!r.ok) throw new Error('values.append '+r.status); });
}
function getValues(spreadsheetId, rangeA1, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(r=>{ if(!r.ok) throw new Error('values.get '+r.status); return r.json(); }).then(d=> d.values||[]);
}
function isLociMyuSpreadsheet(spreadsheetId, token){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(res=> res.ok ? res.json() : false).then(data=>{
      if(!data || !Array.isArray(data.sheets)) return false;
      for(const s of data.sheets){
        const d = s && s.data || []; if(!d[0]) continue;
        const row = d[0].rowData || []; const vals = (row[0]||{}).values || [];
        const headers = [];
        for(const v of vals){
          const fv = v && v.formattedValue ? String(v.formattedValue).trim().toLowerCase() : '';
          if(fv) headers.push(fv);
        }
        if(headers.includes('title') && headers.includes('body') && headers.includes('color')){
          return true;
        }
      }
      return false;
    });
}
function createLociMyuSpreadsheet(parentFolderId, token, opts){
  const glbId = (opts && opts.glbId) ? opts.glbId : '';
  const name = ('LociMyu_Save_'+glbId).replace(/_+$/,'');
  const url = 'https://www.googleapis.com/drive/v3/files';
  const body = { name, mimeType:'application/vnd.google-apps.spreadsheet' };
  if(parentFolderId) body.parents = [ parentFolderId ];
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) }).then(r=>{ if(!r.ok) throw new Error('Drive files.create '+r.status); return r.json(); }).then(file=>{
      const spreadsheetId = file.id;
      return putValues(spreadsheetId, 'A1:Z1', [LOCIMYU_HEADERS], token).then(()=> spreadsheetId);
    });
}
function findOrCreateLociMyuSpreadsheet(parentFolderId, token, opts){
  if(!parentFolderId) return Promise.reject(new Error('parentFolderId required'));
  const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(r=>{ if(!r.ok) throw new Error('Drive list spreadsheets '+r.status); return r.json(); }).then(d=>{
      const files = d.files || [];
      function next(i){
        if(i>=files.length) return createLociMyuSpreadsheet(parentFolderId, token, opts||{});
        return isLociMyuSpreadsheet(files[i].id, token).then(ok=> ok ? files[i].id : next(i+1));
      }
      return next(0);
    });
}

// ---------- Index / ensure row ----------
function ensureIndex(){
  captionsIndex.clear();
  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return Promise.resolve(false);
  return getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token).then(values=>{
    if(!values.length) return false;
    const headers = values[0].map(v=> textOrEmpty(v).trim());
    const idx = {}; headers.forEach((h,i)=> idx[h.toLowerCase()] = i);
    const iId = (idx['id']!=null) ? idx['id'] : -1;
    for(let r=1;r<values.length;r++){
      const row=values[r]||[]; const id=row[iId];
      if(!id) continue;
      captionsIndex.set(String(id), { rowIndex: r+1 });
    }
    return true;
  }).catch(e=>{
    console.warn('[ensureIndex] values.get failed, continue', e);
    return false;
  });
}

function sheetsAppendRow(spreadsheetId, sheetTitle, obj){
  const token=getAccessToken(); if(!token) return Promise.resolve();
  const now=new Date().toISOString();
  const vals=[[ obj.id, obj.title||'', obj.body||'', obj.color||window.currentPinColor, obj.x||0, obj.y||0, obj.z||0, obj.imageFileId||'', obj.createdAt||now, obj.updatedAt||now ]];
  return appendValues(spreadsheetId, "'"+sheetTitle+"'!A:Z", vals, token).then(()=> ensureIndex());
}

function ensureRow(id, seed){
  if(rowCache.has(id)) return Promise.resolve(rowCache.get(id));
  return ensureIndex().then(ok=>{
    if(captionsIndex.has(id)){
      const cur=rowCache.get(id)||{id};
      const merged=Object.assign({}, cur, seed||{}); rowCache.set(id, merged);
      return merged;
    }
    if(!currentSpreadsheetId){
      console.warn('[ensureRow] no spreadsheet, cache only');
      const rowOnly=Object.assign({id}, seed||{}); rowCache.set(id,rowOnly);
      return rowOnly;
    }
    const sheetTitle=currentSheetTitle||'シート1';
    const row=Object.assign({
      id, title:'', body:'', color:window.currentPinColor,
      x:0,y:0,z:0, imageFileId:'',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    }, seed||{});
    return sheetsAppendRow(currentSpreadsheetId, sheetTitle, row).then(()=>{
      rowCache.set(id,row); return row;
    });
  });
}

// ---------- Caption list UI ----------
function clearCaptionList(){
  const host=$('caption-list'); if(host) host.innerHTML='';
  captionDomById.clear();
}
async function deleteCaptionRowFromSheet(spreadsheetId, sheetId, rowIndex1based, token){
  try{
    if(!spreadsheetId || !sheetId || !rowIndex1based || !token) return false;
    const body = {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: Number(sheetId),
            dimension: "ROWS",
            startIndex: rowIndex1based-1,
            endIndex: rowIndex1based
          }
        }
      }]
    };
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const r = await fetch(url, {
      method:'POST',
      headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    if(!r.ok){
      console.error('[Sheets deleteDimension] HTTP', r.status);
      return false;
    }
    await ensureIndex();
    return true;
  }catch(e){
    console.error('[Sheets deleteDimension] failed', e);
    return false;
  }
}
function appendCaptionItem(row){
  const host=$('caption-list'); if(!host||!row) return;
  const div=document.createElement('div'); div.className='caption-item'; div.dataset.id=row.id;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  const safeTitle=(row.title||'').trim()||'(untitled)';
  const safeBody =(row.body ||'').trim()||'(no description)';
  const txt=document.createElement('div'); txt.className='cap-txt';
  const t=document.createElement('div'); t.className='cap-title'; t.textContent=safeTitle;
  const b=document.createElement('div'); b.className='cap-body hint'; b.textContent=safeBody;
  txt.appendChild(t); txt.appendChild(b);
  const del=document.createElement('button'); del.className='cap-del'; del.textContent='×'; del.title='Delete pin';
  del.addEventListener('click', async (ev)=>{  ev.stopPropagation();
  if(!confirm('このキャプションを削除しますか？')) return;

  const id = row.id;

  try{ removePinMarker(id); }catch(_){}
  try{ removeCaptionOverlay && removeCaptionOverlay(id); }catch(_){}

  const meta = captionsIndex.get(id);
  let ok = true;
  if (currentSpreadsheetId && currentSheetId && meta && meta.rowIndex){
    try{
      const token = ensureToken();
      ok = await deleteCaptionRowFromSheet(currentSpreadsheetId, currentSheetId, meta.rowIndex, token);
      if(!ok) throw new Error('Sheets API returned non-ok');
      await ensureIndex();
    }catch(e){
      console.error('[delete row failed]', e);
      alert('スプレッドシートからの削除に失敗しました: ' + (e && e.message || 'unknown'));
      ok = false;
    }
  }
  if(!ok){ return; }

  const el = host.querySelector('[data-id="'+CSS.escape(id)+'"]');
  if(el) el.remove();
  captionsIndex.delete(id);
  rowCache.delete(id);
  if(selectedPinId === id){
    selectedPinId = null;
    const t=document.getElementById('caption-title'), b=document.getElementById('caption-body');
    if(t) t.value='';
    if(b) b.value='';
    renderCurrentImageThumb();
  }});
  div.appendChild(txt); div.appendChild(del);
  div.addEventListener('click', ()=> selectCaption(row.id));
  host.appendChild(div); captionDomById.set(row.id, div);
}

function reflectRowToUI(id){
  const row=rowCache.get(id)||{};
  if(selectedPinId===id){
    const t=$('caption-title'), b=$('caption-body');
    if(t && document.activeElement!==t) t.value=row.title||'';
    if(b && document.activeElement!==b) b.value=row.body||'';
    const col=$('pinColor'); if(col && row.color) col.value=row.color;
    renderCurrentImageThumb();
    refreshOverlayImage(id); // ← オーバーレイにも反映
  }
  const host=$('caption-list'); if(!host) return;
  let div=captionDomById.get(id);
  if(!div){ appendCaptionItem(Object.assign({id}, row)); div=captionDomById.get(id); }
  if(!div) return;
  // update visible title/body in list item
  const tEl = div.querySelector('.cap-title');
  const bEl = div.querySelector('.cap-body');
  const safeTitle = ((row.title||'').trim()) || '(untitled)';
  const safeBody  = ((row.body ||'').trim()) || '(no description)';
  if(tEl && tEl.textContent !== safeTitle) tEl.textContent = safeTitle;
  if(bEl && bEl.textContent !== safeBody)  bEl.textContent = safeBody;
  // border accent by pin color
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  // refresh small list thumb if helper exists
  if (typeof refreshListThumb === 'function') { try{ refreshListThumb(id); }catch(_){ } }
}

// ---------- Save / Update ----------
function putRowToSheet(seed, meta){
  const token = ensureToken();
  const headers = LOCIMYU_HEADERS;
  const rowIndex = meta ? meta.rowIndex : 2;
  const values = headers.map(h=>{
    if(h==='updatedAt') return new Date().toISOString();
    const v = seed[h]; return (v==null?'':String(v));
  });
  const rangeA1 = `'${currentSheetTitle||'シート1'}'!A${rowIndex}:`+String(colA1(headers.length-1))+String(rowIndex);
  return putValues(currentSpreadsheetId, rangeA1, [values], token);
}
function refreshPinMarkerFromRow(id){
  const row=rowCache.get(id); if(!row) return;
  removePinMarker(id);
  addPinMarker({ id, x:row.x||0, y:row.y||0, z:row.z||0, color:row.color||window.currentPinColor });
}
function updateCaptionForPin(id, fields){
  const cached=rowCache.get(id)||{id};
  const seed=Object.assign({}, cached, fields||{});
  return ensureRow(id, seed).then(()=> ensureIndex()).then(()=>{
    const meta=captionsIndex.get(id);
    if(!meta && currentSpreadsheetId){
      const sheetTitle=currentSheetTitle||'シート1';
      return sheetsAppendRow(currentSpreadsheetId, sheetTitle, {
        id,
        title:seed.title||'',
        body:seed.body||'',
        color:seed.color||window.currentPinColor,
        x:seed.x||0, y:seed.y||0, z:seed.z||0,
        imageFileId:seed.imageFileId||'',
        createdAt:seed.createdAt||new Date().toISOString(),
        updatedAt:new Date().toISOString()
      }).then(()=>{ rowCache.set(id, seed); reflectRowToUI(id); refreshPinMarkerFromRow(id); });
    }else{
      return putRowToSheet(seed, meta).then(()=>{ rowCache.set(id, seed); reflectRowToUI(id); refreshPinMarkerFromRow(id); }).catch(e=>{ console.error('[values.update] failed', e); throw e; });
    }
  });
}

// ---------- Image attach/detach (right pane) ----------
let _thumbReq = 0;
function renderCurrentImageThumb(){
  const box = document.getElementById('currentImageThumb');
  if(!box) return;

  box.innerHTML = '';

  const row = selectedPinId ? (rowCache.get(selectedPinId)||{}) : null;
  if(!row || !row.imageFileId){
    box.innerHTML = '<div class="placeholder">No Image</div>';
    return;
  }

  const token = (typeof getAccessToken === 'function') ? getAccessToken() : null;
  if(!token){
    box.innerHTML = '<div class="placeholder">No Image</div>';
    return;
  }

  getFileThumbUrl(row.imageFileId, token, 512).then((url)=>{
    box.innerHTML = '';

    const wrap=document.createElement('div');
    wrap.className='current-image-wrap';
    wrap.style.position='relative';
    wrap.style.display='inline-block';

    const img=document.createElement('img');
    img.src=url; img.alt='';
    img.style.borderRadius='12px';
    img.style.maxWidth='100%';
    img.style.display='block';

    const x=document.createElement('button');
    x.textContent='×';
    x.title='Detach image';
    x.style.position='absolute';
    x.style.right='6px';
    x.style.top='6px';
    x.style.border='none';
    x.style.width='28px';
    x.style.height='28px';
    x.style.borderRadius='999px';
    x.style.background='#000a';
    x.style.color='#fff';
    x.style.cursor='pointer';

    x.addEventListener('click', (e)=>{
      e.stopPropagation();
      Promise.resolve(updateImageForPin(selectedPinId, null))
        .then(renderCurrentImageThumb)
        .catch(()=>{});
    });

    wrap.appendChild(img);
    wrap.appendChild(x);
    box.appendChild(wrap);
  }).catch(()=>{
    box.innerHTML = '<div class="placeholder">No Image</div>';
  });
}
function updateImageForPin(id, fileIdOrNull){
  const token = ensureToken();
  const patch = { imageFileId: fileIdOrNull ? String(fileIdOrNull) : '' };
  return updateCaptionForPin(id, patch).then(()=>{ renderCurrentImageThumb(); refreshOverlayImage(id); });
}

// ---------- Load captions from sheet ----------
function loadCaptionsFromSheet(){
  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const range = `'${currentSheetTitle}'!A1:Z9999`;
  getValues(currentSpreadsheetId, range, token).then(values=>{
    clearCaptionList();
    rowCache.clear(); captionsIndex.clear();
    if(!values.length) return;
    const headers = values[0].map(v=> textOrEmpty(v).trim());
    const map = {}; headers.forEach((h,i)=> map[h.toLowerCase()] = i);
    for(let r=1;r<values.length;r++){
      const row=values[r]||[];
      const id = textOrEmpty(row[map['id']||0]);
      if(!id) continue;
      const obj = {
        id,
        title: textOrEmpty(row[map['title']||1]),
        body : textOrEmpty(row[map['body'] ||2]),
        color: textOrEmpty(row[map['color']||3]) || window.currentPinColor,
        x: Number(row[map['x']||4]||0), y: Number(row[map['y']||5]||0), z: Number(row[map['z']||6]||0),
        imageFileId: textOrEmpty(row[map['imagefileid']||7]),
        createdAt: textOrEmpty(row[map['createdat']||8]),
        updatedAt: textOrEmpty(row[map['updatedat']||9])
      };
      rowCache.set(id, obj);
      captionsIndex.set(id, { rowIndex: r+1 });
      appendCaptionItem(obj);
      addPinMarker({ id, x:obj.x, y:obj.y, z:obj.z, color:obj.color||window.currentPinColor });
    }
    applyColorFilter();
  }).catch(e=> console.warn('[loadCaptionsFromSheet] failed', e));
}

// ---------- Right-pane images grid ----------
(function wireImagesGrid(){
  const grid = $('images-grid'); if(!grid) return;
  grid.addEventListener('click', (e)=>{
    const cell = e.target.closest('.thumb'); if(!cell) return;
    if(!selectedPinId) { alert('先にキャプションを選択してください。'); return; }
    const fileId = cell.dataset.fileId;
    updateImageForPin(selectedPinId, fileId).catch(err=>{
      console.error('attach failed', err);
    });
  });
  const btn = $('btnRefreshImages');
  if(btn) btn.addEventListener('click', ()=> refreshImagesGrid().catch(()=>{}));
})();
function refreshImagesGrid(){
  const token = ensureToken(); if(!lastGlbFileId) return Promise.resolve();
  return getParentFolderId(lastGlbFileId, token).then(parent=>{
    if(!parent){
      const stat=$('images-status');
      if(stat) stat.textContent='親フォルダが見つかりません';
      return;
    }
    const q = encodeURIComponent(`'${parent}' in parents and mimeType contains 'image/' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&orderBy=modifiedTime desc&pageSize=200&supportsAllDrives=true`;
    return fetch(url, { headers:{ Authorization:'Bearer '+token } })
      .then(r=>r.json())
      .then(d=>{
        const grid = $('images-grid'); const stat = $('images-status');
        if(grid) grid.innerHTML = '';
        const files = d.files|| [];
        files.forEach(f=>{
          const div = document.createElement('div');
          div.className = 'thumb';
          div.dataset.fileId = f.id;
          const thumb = (f.thumbnailLink ? (f.thumbnailLink + (f.thumbnailLink.includes('?')?'&':'?') + 'sz=s256') : '');
          if(thumb) div.style.backgroundImage = `url("${thumb}")`;
          if(grid) grid.appendChild(div);
        });
        if(stat) stat.textContent = `${files.length} images`;
      });
  });
}

// ---------- Form autosave ----------
(function wireForm(){
  const t=$('caption-title'), b=$('caption-body');
  let timer=null;
  function reflectOverlayImmediate(){
    if(!selectedPinId) return;
    const o = overlays.get(selectedPinId);
    if(!o) return;
    const tEl = o.root.querySelector('.cap-title');
    const bEl = o.root.querySelector('.cap-body');
    if(tEl && t) tEl.textContent = (t.value||'(untitled)');
    if(bEl && b) bEl.textContent = (b.value||'(no description)');
  }
  function schedule(){
    if(!selectedPinId) return;
    clearTimeout(timer);
    const title = t ? (t.value||'') : '';
    const body  = b ? (b.value||'') : '';
    reflectOverlayImmediate();
    timer=setTimeout(function(){
      updateCaptionForPin(selectedPinId, { title, body }).catch(function(e){ console.warn('[caption autosave failed]', e); });
    }, 600);
  }
  if(t) t.addEventListener('input', schedule);
  if(b) b.addEventListener('input', schedule);
})();

// ---------- Color chips & filters ----------
function setPinColor(hex){
  window.currentPinColor = hex;
  const host=document.getElementById('pinColorChips');
  if(host){
    host.querySelectorAll('.chip-color').forEach(el=>{
      const v = getComputedStyle(el).getPropertyValue('--chip').trim();
      el.classList.toggle('is-active', v===hex);
    });
  }
  if(selectedPinId){
    const row=rowCache.get(selectedPinId)||{id:selectedPinId};
    row.color=hex; rowCache.set(selectedPinId,row);
    try{ refreshPinMarkerFromRow(selectedPinId); }catch(_){}
    try{ updateCaptionForPin(selectedPinId,{ color:hex }); }catch(_){}
  }
}
function renderColorChips(){
  const host = document.getElementById('pinColorChips'); if(!host) return;
  host.innerHTML = '';
  window.LM_PALETTE.forEach(function(hex){
    const b=document.createElement('button');
    b.className='chip chip-color'; b.style.setProperty('--chip', hex); b.title=hex;
    if(window.nearestPalette(window.currentPinColor)===hex) b.classList.add('is-active');
    b.addEventListener('click', function(){ setPinColor(hex); });
    host.appendChild(b);
  });
}

let lmFilterSet = (function(){ try{ const s=JSON.parse(localStorage.getItem('lmFilterColors')||'[]'); return new Set(s.length?s:window.LM_PALETTE); }catch(_){ return new Set(window.LM_PALETTE);} })();
function saveFilter(){ try{ localStorage.setItem('lmFilterColors', JSON.stringify(Array.from(lmFilterSet))); }catch(_){ } }
function rowPassesColorFilter(row){
  if(!row) return false; if(lmFilterSet.size===0) return true;
  return lmFilterSet.has(window.nearestPalette(row.color||window.LM_PALETTE[0]));
}
function applyColorFilter(){
  const listHost=document.getElementById('caption-list');
  if(listHost){
    listHost.querySelectorAll('.caption-item').forEach(function(div){
      const id=div.dataset.id; const row=rowCache.get(id);
      const ok=rowPassesColorFilter(row||{});
      div.classList.toggle('is-hidden', !ok);
    });
  }
  try{ document.dispatchEvent(new CustomEvent('pinFilterChange',{ detail:{ selected:Array.from(lmFilterSet) } })); }catch(_){}
}
function renderFilterChips(){
  const host = document.getElementById('pinFilterChips'); if(!host) return;
  if(!host.previousElementSibling || !host.previousElementSibling.classList || !host.previousElementSibling.classList.contains('chip-actions')){
    const bar=document.createElement('div'); bar.className='chip-actions';
    const a=document.createElement('button'); a.id='filterAll'; a.className='chip-action'; a.textContent='All';
    const n=document.createElement('button'); n.id='filterNone'; n.className='chip-action'; n.textContent='None';
    a.addEventListener('click', function(){ lmFilterSet=new Set(window.LM_PALETTE); saveFilter(); applyColorFilter(); renderFilterChips(); });
    n.addEventListener('click', function(){ lmFilterSet=new Set(); saveFilter(); applyColorFilter(); renderFilterChips(); });
    host.parentNode.insertBefore(bar, host); bar.appendChild(a); bar.appendChild(n);
  }
  host.innerHTML='';
  window.LM_PALETTE.forEach(function(hex){
    const b=document.createElement('button');
    b.className='chip chip-filter'; b.style.setProperty('--chip', hex); b.title='filter '+hex;
    const mark=document.createElement('span'); mark.className='mark'; mark.textContent='✓'; b.appendChild(mark);
    if(lmFilterSet.has(hex)) b.classList.add('is-on');
    b.addEventListener('click', function(){ if(lmFilterSet.has(hex)) lmFilterSet.delete(hex); else lmFilterSet.add(hex); saveFilter(); applyColorFilter(); renderFilterChips(); });
    host.appendChild(b);
  });
}

// ---------- GLB load ----------
function doLoad(){
  try{
    const token = ensureToken();
    const raw = ($('glbUrl') && $('glbUrl').value) || '';
    const fileId = extractDriveId(raw);
    if(!fileId){ console.warn('[GLB] missing fileId'); return; }
    if($('btnGlb')) $('btnGlb').disabled = true;

    return loadGlbFromDrive(fileId, { token }).then(function(){
      lastGlbFileId = fileId;
      return getParentFolderId(fileId, token).then(function(parent){
        return findOrCreateLociMyuSpreadsheet(parent, token, { glbId:fileId });
      }).then(function(spreadsheetId){
        currentSpreadsheetId = spreadsheetId;
        return populateSheetTabs(spreadsheetId, token).then(function(){ loadCaptionsFromSheet(); });
      }).then(function(){ refreshImagesGrid(); });
    }).catch(function(e){
      console.error('[GLB] load error', e);
      if(String(e).includes('401')){
        alert('認可が必要です。右上の「Sign in」を押して権限を付与してください。');
      }
    }).finally(function(){
      if($('btnGlb')) $('btnGlb').disabled = false;
    });
  }catch(e){
    console.warn('[GLB] token missing or other error', e);
  }
}
if($('btnGlb')) $('btnGlb').addEventListener('click', doLoad);
if($('glbUrl')) $('glbUrl').addEventListener('keydown', function(e){ if(e.key==='Enter') doLoad(); });

// ---------- Sheet tabs & rename ----------
function populateSheetTabs(spreadsheetId, token){
  const sel = $('save-target-sheet'); if(!sel||!spreadsheetId) return Promise.resolve();
  sel.innerHTML = '<option value="">Loading…</option>';
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(function(r){ return r.ok ? r.json() : null; }).then(function(data){
      if(!data) { sel.innerHTML='<option value="">(error)</option>'; return; }
      const sheets = (data.sheets||[]).map(function(s){ return s.properties; }).sort(function(a,b){ return a.index-b.index; });
      sel.innerHTML='';
      for(const p of sheets){
        const opt = document.createElement('option');
        opt.value = String(p.sheetId);
        opt.textContent = p.title;
        opt.dataset.title = p.title;
        sel.appendChild(opt);
      }
      const first = sheets[0];
      currentSheetId = first ? first.sheetId : null;
      currentSheetTitle = first ? first.title : null;
      if(currentSheetId) sel.value = String(currentSheetId);
    
try {
  // expose sheet context and notify listeners (hotfix ensures __LM_MATERIALS)
  window.__LM_SHEET_CTX = { spreadsheetId, sheetGid: currentSheetId };
  window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail: window.__LM_SHEET_CTX }));
} catch (_){}
});
}
const sheetSel = $('save-target-sheet');
if(sheetSel){
  sheetSel.addEventListener('change', function(e){
    const sel = e.target;
    const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    currentSheetId = (opt && opt.value) ? Number(opt.value) : null;
    currentSheetTitle = (opt && opt.dataset && opt.dataset.title) ? opt.dataset.title : null;
    
try {
  window.__LM_SHEET_CTX = { spreadsheetId: currentSpreadsheetId, sheetGid: currentSheetId };
  window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail: window.__LM_SHEET_CTX }));
} catch (_){}
clearPins(); overlays.forEach(function(_,id){ removeCaptionOverlay(id); }); overlays.clear();
    clearCaptionList(); rowCache.clear(); captionsIndex.clear(); selectedPinId=null;
    loadCaptionsFromSheet();
  });
}
const btnCreate = $('save-target-create');
if(btnCreate){
  btnCreate.addEventListener('click', function(){
    const token = ensureToken(); if(!currentSpreadsheetId) return;
    const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
    const body={ requests:[{ addSheet:{ properties:{ title } } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      .then(function(r){ if(!r.ok) throw new Error(String(r.status)); })
      .then(function(){ return populateSheetTabs(currentSpreadsheetId, token); })
      .then(function(){ loadCaptionsFromSheet(); })
      .catch(function(e){ console.error('[Sheets addSheet] failed', e); });
  });
}
const btnRename = $('save-target-rename');
if(btnRename){
  btnRename.addEventListener('click', function(){
    const token = ensureToken(); if(!currentSpreadsheetId||!currentSheetId) return;
    const input=$('rename-input'); const newTitle = input && input.value ? String(input.value).trim() : '';
    if(!newTitle) return;
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
    const body={ requests:[{ updateSheetProperties:{ properties:{ sheetId: currentSheetId, title: newTitle }, fields: 'title' } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      .then(function(r){ if(!r.ok) throw new Error(String(r.status)); })
      .then(function(){ return populateSheetTabs(currentSpreadsheetId, token); })
      .then(function(){ loadCaptionsFromSheet(); })
      .catch(function(e){ console.error('[Sheets rename] failed', e); });
  });
}

console.log('[LociMyu ESM/CDN] boot clean full build loaded');

// ---------- Chips init on DOM ready ----------
document.addEventListener('DOMContentLoaded', function(){
  try{ renderColorChips(); renderFilterChips(); applyColorFilter(); }catch(e){ console.warn('[chips init]', e); }
});

// ---------- Shift+click add pin ----------
onCanvasShiftPick(function(pos){
  const id = 'pin_'+Date.now();
  const color = lmCanonicalColor(window.currentPinColor);
  const row = { id, title:'', body:'', color, x:pos.x, y:pos.y, z:pos.z, imageFileId:'', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  rowCache.set(id, row);
  appendCaptionItem(row);
  addPinMarker({ id, x:pos.x, y:pos.y, z:pos.z, color });
  selectCaption(id);
  ensureRow(id, row).then(function(){ updateCaptionForPin(id, row); });
});



// =====================================================
// == Materials Opacity Module (sheet-scoped, non-breaking)
// == - Stores per-material opacity per "parent save sheet" (gid = currentSheetId)
// == - Uses a single sheet named "materials" inside the same spreadsheet
// == - Columns: gid, material, opacity, updatedAt
// == - Emits a CustomEvent('materials:apply', {detail:{ opacities: Map<string, number> }})
// == - No UI assumptions: if #mat-list exists, render sliders; otherwise just persists.
// =====================================================

(function MaterialsOpacityModule(){
  const MAT_SHEET_TITLE = 'materials';
  const MAT_HEADERS = ['gid','material','opacity','updatedAt'];

  // In-memory cache: { materialName: { opacity:number } }
  let matCache = new Map();

  function matColA1(i0){ let n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }
  function matGetValues(spreadsheetId, rangeA1, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`;
    return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(r=>{ if(!r.ok) throw new Error('mat.values.get '+r.status); return r.json(); }).then(d=> d.values||[]);
  }
  function matPutValues(spreadsheetId, rangeA1, values, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
    return fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) }).then(r=>{ if(!r.ok) throw new Error('mat.values.update '+r.status); });
  }
  function matAppend(spreadsheetId, rangeA1, values, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) }).then(r=>{ if(!r.ok) throw new Error('mat.values.append '+r.status); });
  }

  async function ensureMaterialsSheetExists(){
    if(!currentSpreadsheetId) return false;
    const token = (typeof getAccessToken==='function') ? getAccessToken() : null;
    if(!token) return false;
    // Try fetch header
    try{
      const hdr = await matGetValues(currentSpreadsheetId, `'${MAT_SHEET_TITLE}'!A1:D1`, token);
      const h0 = (hdr && hdr[0]) || [];
      if(h0.length >= 3) return true;
    }catch(_){}
    // Create sheet + header
    try{
      const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
      const body={ requests:[{ addSheet:{ properties:{ title: MAT_SHEET_TITLE } } }] };
      await fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    }catch(_){ /* already exists */ }
    try{
      await matPutValues(currentSpreadsheetId, `'${MAT_SHEET_TITLE}'!A1:D1`, [MAT_HEADERS], token);
      return true;
    }catch(e){ console.warn('[materials] ensure header failed', e); return false; }
  }

  function emitApply(){
    try{
      const map = new Map(matCache);
      document.dispatchEvent(new CustomEvent('materials:apply',{ detail:{ opacities: map, gid: currentSheetId } }));
    }catch(_){}
  }

  async function loadMaterialsForCurrentSheet(){
    matCache.clear();
    if(!currentSpreadsheetId || !currentSheetId) return;
    const token = (typeof getAccessToken==='function') ? getAccessToken() : null;
    if(!token) return;
    try{
      await ensureMaterialsSheetExists();
      const all = await matGetValues(currentSpreadsheetId, `'${MAT_SHEET_TITLE}'!A2:D9999`, token);
      for(const row of all){
        const gid = Number(row[0]||0);
        if(!gid || gid!==Number(currentSheetId)) continue;
        const name = String(row[1]||'').trim();
        const op = Math.max(0, Math.min(1, parseFloat(row[2]||'1')));
        if(name) matCache.set(name, { opacity: op });
      }
      renderMaterialsUI();
      emitApply();
    }catch(e){
      console.warn('[materials] load failed', e);
    }
  }

  async function upsertMaterialOpacity(name, opacity){
    if(!name) return;
    opacity = Math.max(0, Math.min(1, Number(opacity)||0));
    const token = (typeof getAccessToken==='function') ? getAccessToken() : null;
    if(!token || !currentSpreadsheetId || !currentSheetId) return;

    // Load all, find row
    const all = await matGetValues(currentSpreadsheetId, `'${MAT_SHEET_TITLE}'!A1:D9999`, token);
    const headers = (all[0]||[]).map(v=>String(v||'').trim().toLowerCase());
    const idx = {}; headers.forEach((h,i)=> idx[h]=i);
    const records = all.slice(1);

    let foundRow = -1;
    for(let i=0;i<records.length;i++){
      const row = records[i]||[];
      const gid = Number(row[idx['gid']||0]||0);
      const mat = String(row[idx['material']||1]||'').trim();
      if(gid===Number(currentSheetId) && mat===name){ foundRow = i+2; break; } // +2 => header + 1-based
    }

    const now = new Date().toISOString();
    if(foundRow>0){
      const range = `'${MAT_SHEET_TITLE}'!A${foundRow}:D${foundRow}`;
      await matPutValues(currentSpreadsheetId, range, [[ currentSheetId, name, opacity, now ]], token);
    }else{
      await matAppend(currentSpreadsheetId, `'${MAT_SHEET_TITLE}'!A:D`, [[ currentSheetId, name, opacity, now ]], token);
    }
    matCache.set(name, { opacity });
    emitApply();
  }

  // --------- Minimal UI binding (optional) ---------
  function renderMaterialsUI(){
    const host = document.getElementById('mat-list');
    if(!host) return; // no UI present → nothing to render
    host.innerHTML = '';

    // We don't know model materials; show rows from cache only.
    // If you want to bootstrap from model, dispatch an event to request names.
    const names = Array.from(matCache.keys()).sort((a,b)=> a.localeCompare(b));
    if(!names.length){
      const div = document.createElement('div');
      div.style.opacity = '0.8';
      div.textContent = 'No material entries yet. Adjust in viewer or import list.';
      host.appendChild(div);
      return;
    }

    for(const name of names){
      const row = matCache.get(name)||{opacity:1};
      const wrap = document.createElement('div');
      wrap.className = 'mat-item';
      wrap.style.display = 'grid';
      wrap.style.gridTemplateColumns = '1fr 120px 52px';
      wrap.style.gap = '8px';
      wrap.style.alignItems = 'center';
      wrap.style.padding = '6px 0';

      const label = document.createElement('div');
      label.textContent = name;
      label.style.overflow='hidden'; label.style.whiteSpace='nowrap'; label.style.textOverflow='ellipsis';

      const slider = document.createElement('input');
      slider.type='range'; slider.min='0'; slider.max='1'; slider.step='0.01'; slider.value=String(row.opacity ?? 1);

      const val = document.createElement('div');
      val.style.textAlign='right';
      val.textContent = String((row.opacity ?? 1).toFixed(2));

      slider.addEventListener('input', (ev)=>{
        const v = Number(ev.target.value||'1');
        val.textContent = String(v.toFixed(2));
        upsertMaterialOpacity(name, v).catch(()=>{});
      });

      wrap.append(label, slider, val);
      host.appendChild(wrap);
    }
  }

  // Listen external hints to seed material names
  document.addEventListener('materials:seed', (ev)=>{
    const list = (ev && ev.detail && ev.detail.names) || [];
    let changed = false;
    for(const nm of list){
      if(!matCache.has(nm)){ matCache.set(nm, { opacity:1 }); changed = true; }
    }
    if(changed){ renderMaterialsUI(); emitApply(); }
  });

  // Hook sheet tab changes and GLB loads
  document.addEventListener('DOMContentLoaded', ()=>{ loadMaterialsForCurrentSheet(); });
  // When sheet is changed in the existing code, loadCaptionsFromSheet() is called; hook into that flow:
  const origLoadCaps = (typeof loadCaptionsFromSheet === 'function') ? loadCaptionsFromSheet : null;
  if(origLoadCaps){
    window.loadCaptionsFromSheet = function(...args){
      const r = origLoadCaps.apply(this, args);
      try{ loadMaterialsForCurrentSheet(); }catch(_){}
      return r;
    };
  }
  // When GLB is loaded and spreadsheet / currentSheetId changes (doLoad), load afterwards
  const origDoLoad = (typeof doLoad === 'function') ? doLoad : null;
  if(origDoLoad){
    window.doLoad = function(...args){
      const p = origDoLoad.apply(this, args);
      Promise.resolve(p).then(()=>{ try{ loadMaterialsForCurrentSheet(); }catch(_){ } });
      return p;
    };
  }

  // Expose a tiny API (optional)
  window.LM_Materials = {
    get cache(){ return new Map(matCache); },
    get currentGid(){ return currentSheetId; },
    setOpacity: upsertMaterialOpacity,
    refreshUI: renderMaterialsUI,
    reload: loadMaterialsForCurrentSheet
  };
})();


/* === LM Sheets Hardening Hotfix v1.3 ===
   - Ensures __LM_MATERIALS auto-create after sheet context
   - Defers until __lm_fetchJSONAuth is available
   - Fixes caption writes by resolving current sheet *title* from GID
   - Provides gid-safe wrappers for values.get / values.append helpers when present
   - Non-destructive: only appends; guarded by __LM_SHEETS_HOTFIX_APPLIED flag
*/
(function(){
  if (window.__LM_SHEETS_HOTFIX_APPLIED__) return;
  window.__LM_SHEETS_HOTFIX_APPLIED__ = true;

  const waitFor = (pred, ms=15000, step=50) => new Promise((res, rej)=>{
    const t0=performance.now(); const id=setInterval(()=>{
      try {
        if (pred()) { clearInterval(id); res(true); return; }
      } catch(_) {}
      if (performance.now()-t0>ms){ clearInterval(id); rej(new Error('timeout')); }
    }, step);
  });

  const fetchJSON = async (url, init)=>{
    await waitFor(()=> typeof window.__lm_fetchJSONAuth === 'function', 20000);
    return window.__lm_fetchJSONAuth(url, init);
  };

  const TITLE_CACHE = Object.create(null); // { [spreadsheetId]: { [gid]: title } }

  async function refreshTitleCache(spreadsheetId){
    const meta = await fetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const map = Object.create(null);
    for (const s of (meta.sheets||[])) {
      const gid = String(s.properties.sheetId);
      map[gid] = s.properties.title;
    }
    TITLE_CACHE[spreadsheetId] = map;
    return map;
  }

  async function getTitleByGid(spreadsheetId, gid){
    const gidStr = String(gid ?? '');
    const cache = TITLE_CACHE[spreadsheetId] || await refreshTitleCache(spreadsheetId);
    if (cache[gidStr]) return cache[gidStr];
    const map = await refreshTitleCache(spreadsheetId);
    return map[gidStr];
  }

  function encA1(spreadsheetId, title, a1){
    const quoted = `'${String(title).replace(/'/g, "''")}'!${a1}`;
    return encodeURIComponent(quoted);
  }

  async function ensureMaterialsSheet(spreadsheetId){
    // check exist
    const meta = await fetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const exists = (meta.sheets||[]).some(s => s.properties.title === '__LM_MATERIALS');
    if (!exists) {
      // create via batchUpdate with sheetId auto
      await fetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method:'POST',
        body:{ requests:[{ addSheet:{ properties:{ title:'__LM_MATERIALS' } } }]}
      });
      console.log('[hotfix] __LM_MATERIALS created');
    }
    // ensure headers A1:M1
    await fetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encA1(spreadsheetId,'__LM_MATERIALS','A1:M1')}?valueInputOption=RAW`, {
      method:'PUT',
      body:{ values:[['materialKey','opacity','doubleSided','unlitLike','chromaEnable','chromaColor','chromaTolerance','chromaFeather','roughness','metalness','emissiveHex','updatedAt','updatedBy','sheetGid']] }
    });
    console.log('[hotfix] __LM_MATERIALS ensured');
  }

  // Re-arm on sheet-context
  window.addEventListener('lm:sheet-context', async (e)=>{
    const ctx = e && e.detail || window.__LM_SHEET_CTX;
    if (!ctx || !ctx.spreadsheetId) return;
    try {
      await waitFor(()=> typeof window.__lm_fetchJSONAuth === 'function', 20000);
      await ensureMaterialsSheet(ctx.spreadsheetId);
    } catch(err) {
      console.warn('[hotfix] ensureMaterialsSheet failed', err);
    }
  }, { once:false });

  // Optional: wrap global helpers if present to fix “staircase / 400 Bad Request when renamed”
  const tryWrapValuesHelpers = ()=>{
    const g = window;
    const hasGet = typeof g.getValues === 'function';
    const hasAppend = typeof g.appendValues === 'function' || typeof g.sheetsAppendRow === 'function';

    if (hasGet) {
      const orig = g.getValues;
      g.getValues = async function(rangeOrSheet, a1Maybe){
        // two calling styles: getValues("'Title'!A1:Z9999") or getValues(spreadsheetId, "'Title'!A1:Z9999")
        try {
          const ctx = g.__LM_SHEET_CTX || {};
          const spreadsheetId = typeof rangeOrSheet === 'string' && rangeOrSheet.includes('!') ? (ctx.spreadsheetId||'') : rangeOrSheet;
          const range = typeof rangeOrSheet === 'string' && rangeOrSheet.includes('!') ? rangeOrSheet : (a1Maybe||'');
          if (spreadsheetId && ctx.sheetGid != null && /^'Sheet_/.test(range)) {
            // replace timestamp title with real title resolved from gid
            const title = await getTitleByGid(spreadsheetId, ctx.sheetGid);
            const fixed = `'${String(title).replace(/'/g,"''")}'!` + range.split('!')[1];
            return orig.call(this, spreadsheetId, fixed);
          }
        } catch (e) { console.warn('[hotfix:getValues] wrapper note', e); }
        return orig.apply(this, arguments);
      };
    }

    // prefer sheetsAppendRow if present
    const targetName = typeof g.sheetsAppendRow === 'function' ? 'sheetsAppendRow'
                        : (typeof g.appendValues === 'function' ? 'appendValues' : null);
    if (targetName) {
      const orig = g[targetName];
      g[targetName] = async function(spreadsheetId, rangeOrRow, rowMaybe){
        try {
          const ctx = g.__LM_SHEET_CTX || {};
          let range, row;
          if (Array.isArray(rangeOrRow) && rowMaybe === undefined) {
            // legacy style: sheetsAppendRow(spreadsheetId, rowArray) -> use ctx.gid and A:Z
            row = rangeOrRow;
            if (ctx.sheetGid != null) {
              const title = await getTitleByGid(spreadsheetId, ctx.sheetGid);
              range = `'${String(title).replace(/'/g,"''")}'!A:Z`;
              return orig.call(this, spreadsheetId, range, row);
            }
          } else {
            range = rangeOrRow; row = rowMaybe;
            if (ctx.sheetGid != null && /^'Sheet_/.test(range)) {
              const title = await getTitleByGid(spreadsheetId, ctx.sheetGid);
              const suffix = range.split('!')[1] || 'A:Z';
              const fixed = `'${String(title).replace(/'/g,"''")}'!` + suffix;
              return orig.call(this, spreadsheetId, fixed, row);
            }
          }
        } catch (e) { console.warn('[hotfix:append] wrapper note', e); }
        return orig.apply(this, arguments);
      };
    }
  };

  tryWrapValuesHelpers();
  // also refresh wrapping after auth comes up (some apps define helpers late)
  setTimeout(tryWrapValuesHelpers, 2000);
  document.addEventListener('DOMContentLoaded', ()=> setTimeout(tryWrapValuesHelpers, 1000));

})();
/* === /LM Sheets Hardening Hotfix v1.3 === */


/* [boot.ensure-materials trigger v1] 
   If another module fires 'lm:glb-loaded' on first GLB load, make sure sheet-context is dispatched
   so that the hotfix can ensure __LM_MATERIALS immediately.
*/
(function(){
  function trigger(){
    try{
      if (window.__LM_SHEET_CTX && window.__LM_SHEET_CTX.spreadsheetId) {
        window.dispatchEvent(new CustomEvent('lm:sheet-context', { detail: window.__LM_SHEET_CTX }));
      }
    }catch(_){}
  }
  window.addEventListener('lm:glb-loaded', trigger);
  // also on DOM ready as a fallback
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(trigger, 0);
  } else {
    window.addEventListener('DOMContentLoaded', ()=> setTimeout(trigger,0), { once:true });
  }
})();



/* === [LM dropdown filter v1] hide internal sheets (__LM_*) ==================
   - Removes options whose dataset.title or text starts with "__LM_" (e.g., "__LM_MATERIALS")
   - Runs after DOM ready and on 'lm:sheet-context'/'lm:sheet-changed' to catch repopulations
============================================================================= */
(function(){
  const TAG='[lm-dropdown-filter v1]';
  function hideInternalOptions(sel){
    if (!sel) return;
    let removed = 0;
    const opts = Array.from(sel.querySelectorAll('option'));
    for (const o of opts){
      const t = (o.dataset && o.dataset.title) || o.textContent || '';
      if (t.startsWith('__LM_')){
        if (o.selected) o.selected = false;
        o.remove();
        removed++;
      }
    }
    if (removed){
      // ensure a valid selection
      const vis = sel.querySelector('option');
      if (vis){
        if (!sel.value || !sel.querySelector(`option[value="${sel.value}"]`)){
          sel.value = vis.value;
          try { sel.dispatchEvent(new Event('change', { bubbles:true })); } catch(_){}
        }
      }
      console.log(TAG, 'removed', removed, 'internal option(s)');
    }
  }
  function run(){
    const sel = document.querySelector('#save-target-sheet, select[data-role="sheet-target"], select#sheet-target');
    if (sel) hideInternalOptions(sel);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(run, 0);
  } else {
    window.addEventListener('DOMContentLoaded', ()=> setTimeout(run,0), { once:true });
  }
  window.addEventListener('lm:sheet-context', run);
  window.addEventListener('lm:sheet-changed', run);
})();
