// boot.esm.cdn.js — LociMyu boot (full build, no ensureFreshToken import)
// - selection highlight, overlay drag/close
// - right-pane thumbnail attach (click) + list-side detach (×)
// - Sheets I/O with ensureRow/ensureIndex, HEIC fallback
// - GLB load: tokenチェック + 401はサインイン促しのフォールバック
//
// 前提: index.html で ESM として読み込まれる（type="module"）
// 依存: viewer.module.cdn.js / gauth.module.js / locimyu.config.js（window.GIS_*）
//      gauth.module.js は setupAuth(), getAccessToken(), getLastAuthError() を提供する。

import {
  ensureViewer, onCanvasShiftPick, addPinMarker, setPinSelected, onPinSelect,
  loadGlbFromDrive, onRenderTick, projectPoint, clearPins, removePinMarker
} from './viewer.module.cdn.js';

import { setupAuth, getAccessToken, getLastAuthError } from './gauth.module.js';

/* ---------------- DOM helpers ---------------- */
const $ = (id)=>document.getElementById(id);
const setEnabled = (on, ...els)=> els.forEach(el=>{ if(el) el.disabled = !on; });
const uid = ()=> Math.random().toString(36).slice(2)+Date.now().toString(36);
const textOrEmpty = (v)=> v==null ? '' : String(v);
const clamp = (n,min,max)=> Math.min(Math.max(n,min),max);

/* ---------------- Boot viewer & auth ---------------- */
ensureViewer({ canvas: $('gl') });

const __LM_CLIENT_ID = (window.GIS_CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
const __LM_API_KEY   = (window.GIS_API_KEY   || '');
const __LM_SCOPES    = (window.GIS_SCOPES    || 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets');

function onSigned(signed){
  document.documentElement.classList.toggle('signed-in', !!signed);
  setEnabled(!!signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('save-target-rename'), $('rename-input'));
}
setupAuth($('auth-signin'), onSigned, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });

/* ---------------- Simple token helper (no ensureFreshToken) ---------------- */
function ensureToken() {
  const t = getAccessToken();
  if (!t) {
    const err = getLastAuthError?.();
    if (err) console.warn('[auth] last error:', err);
    alert('Google サインインが必要です。「Sign in」をクリックしてください。');
    throw new Error('token_missing');
  }
  return t;
}

/* ---------------- Drive helpers ---------------- */
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
    .then(j => (j?.parents?.[0] || null));
}

/* ---------------- Global states ---------------- */
let lastGlbFileId = null;
let currentSpreadsheetId = null;
let currentSheetId = null;
let currentSheetTitle = null;
let currentHeaders = [];
let currentHeaderIdx = {};
let currentPinColor = '#ff6b6b';
let selectedPinId = null;
let filterMode = 'all'; // 'all' | 'selected' | 'color'
let filterColor = currentPinColor;
const PIN_PALETTE = ['#ff6b6b','#ffd166','#06d6a0','#118ab2','#a78bfa','#f472b6'];

// indices & caches
const captionsIndex = new Map();  // id -> { rowIndex }
const captionDomById = new Map(); // id -> element
const rowCache = new Map();       // id -> row
const overlays = new Map();       // id -> { root, imgEl }
const pendingUpdates = new Map(); // id -> fields

/* ---------------- Inline style for selection ---------------- */
(() => {
  const st = document.createElement('style');
  st.textContent = ".caption-item.is-selected{outline:2px solid #fff;outline-offset:-2px;border-radius:6px}";
  document.head.appendChild(st);
})();

/* ---------------- Overlay (drag, close, line) ---------------- */
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

  const topbar = document.createElement('div');
  topbar.style.display='flex'; topbar.style.gap='10px'; topbar.style.justifyContent='flex-end';
  topbar.style.marginBottom='6px'; topbar.style.cursor='move';
  const bClose = document.createElement('button'); bClose.textContent='×';
  bClose.style.border='none'; bClose.style.background='transparent'; bClose.style.color='#ddd'; bClose.style.cursor='pointer';
  topbar.appendChild(bClose);

  const t = document.createElement('div'); t.className='cap-title'; t.style.fontWeight='700'; t.style.marginBottom='6px';
  const body = document.createElement('div'); body.className='cap-body'; body.style.fontSize='12px'; body.style.opacity='.95'; body.style.whiteSpace='pre-wrap'; body.style.marginBottom='6px';
  const img = document.createElement('img'); img.className='cap-img'; img.alt=''; img.style.display='none'; img.style.width='100%'; img.style.height='auto'; img.style.borderRadius='8px';

  const safeTitle = (data?.title ? String(data.title).trim() : '') || '(untitled)';
  const safeBody  = (data?.body  ? String(data.body ).trim() : '') || '(no description)';
  t.textContent = safeTitle; body.textContent = safeBody;

  // drag
  let dragging=false, startX=0, startY=0, baseLeft=0, baseTop=0;
  topbar.addEventListener('pointerdown', (ev)=>{
    dragging=true; startX=ev.clientX; startY=ev.clientY;
    baseLeft=parseFloat(root.style.left||'0'); baseTop=parseFloat(root.style.top||'0');
    root.setPointerCapture?.(ev.pointerId);
    ev.stopPropagation();
  });
  window.addEventListener('pointermove', (ev)=>{
    if(!dragging) return;
    const dx=ev.clientX-startX, dy=ev.clientY-startY;
    root.style.left=(baseLeft+dx)+'px'; root.style.top=(baseTop+dy)+'px';
  });
  window.addEventListener('pointerup', ()=>{ dragging=false; });

  // load image if any
  (()=>{
    try{
      const token = getAccessToken();
      const row = rowCache.get(id);
      if(token && row?.imageFileId){
        getFileBlobUrl(row.imageFileId, token).then((url)=>{
          img.src=url; img.style.display='block';
        }).catch(()=>{
          return getFileThumbUrl(row.imageFileId, token, 1024).then((url)=>{
            img.src=url; img.style.display='block';
          }).catch(()=>{});
        });
      }
    }catch(_){}
  })();

  bClose.addEventListener('click', (e)=>{ e.stopPropagation(); removeCaptionOverlay(id); });

  root.appendChild(topbar); root.appendChild(t); root.appendChild(body); root.appendChild(img);
  document.body.appendChild(root);
  overlays.set(id, { root, imgEl:img });
  applyOverlayZoom(id, 1.0);
  updateOverlayPosition(id, true);
}

// Inject +/- into overlay topbar (left) and keep it fixed when size changes.
(function(){
  const orig = createCaptionOverlay;
  createCaptionOverlay = function(id, data){
    orig(id, data);
    const o = overlays.get(id); if(!o) return;
    // Rebuild topbar to have left(zoom) & right(close)
    const root = o.root;
    const bars = root.querySelectorAll(':scope > div');
    const topbar = bars[0];
    if(topbar && !topbar.dataset.zoomified){
      topbar.dataset.zoomified = '1';
      topbar.style.justifyContent='space-between';
      const left = document.createElement('div');
      left.style.display='flex'; left.style.gap='6px'; left.style.alignItems='center';
      const minus = document.createElement('button'); minus.textContent='−'; minus.title='Zoom out';
      const plus  = document.createElement('button'); plus.textContent='＋'; plus.title='Zoom in';
      [minus,plus].forEach(b=>{ b.style.border='none'; b.style.background='transparent'; b.style.color='#ddd'; b.style.cursor='pointer'; b.style.fontWeight='700'; b.style.fontSize='16px'; });
      left.appendChild(minus); left.appendChild(plus);
      topbar.prepend(left);
      // keep zoom in overlays map
      if(o.zoom==null) o.zoom = 1.0;
      const setZ = (z)=>{ o.zoom = Math.max(0.6, Math.min(2.0, z)); applyOverlayZoom(id, o.zoom); };
      minus.addEventListener('click', (e)=>{ e.stopPropagation(); setZ((o.zoom||1)-0.1); });
      plus .addEventListener('click', (e)=>{ e.stopPropagation(); setZ((o.zoom||1)+0.1); });
    }
  };
})();

function applyOverlayZoom(id, z){
  const o = overlays.get(id); if(!o) return;
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

/* ---------------- Selection helpers ---------------- */
function __lm_markListSelected(id){
  const host = $('caption-list'); if(!host) return;
  host.querySelectorAll('.caption-item.is-selected').forEach(n=>n.classList.remove('is-selected'));
  const el = host.querySelector('.caption-item[data-id="'+CSS.escape(id)+'"]');
  if(el) el.classList.add('is-selected');
}
function __lm_fillFormFromCaption(id){
  const row = rowCache.get(id) || {};
  const t=$('caption-title'), b=$('caption-body');
  if(t) t.value = row.title || '';
  if(b) b.value = row.body  || '';
}
function selectCaption(id){
  selectedPinId = id;
  __lm_markListSelected(id);
  __lm_fillFormFromCaption(id);
  setPinSelected(id, true);
  createCaptionOverlay(id, rowCache.get(id) || {});
}
onPinSelect((id)=> selectCaption(id));

/* ---------------- Sheets I/O ---------------- */
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId','createdAt','updatedAt'];

function putValues(spreadsheetId, rangeA1, values, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
  return fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) });
}
function appendValues(spreadsheetId, rangeA1, values, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) });
}
function getValues(spreadsheetId, rangeA1, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } })
    .then(r=>{ if(!r.ok) throw new Error('values.get '+r.status); return r.json(); })
    .then(d=> d.values||[]);
}
function colA1(i0){ let n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }

function isLociMyuSpreadsheet(spreadsheetId, token){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } })
    .then(res=> res.ok ? res.json() : false)
    .then(data=>{
      if(!data || !Array.isArray(data.sheets)) return false;
      for(const s of data.sheets){
        const d = s?.data||[]; if(!d[0]) continue;
        const row = d[0].rowData || []; const vals = (row[0]||{}).values || [];
        const headers = [];
        for(const v of vals){
          const fv = v?.formattedValue ? String(v.formattedValue).trim().toLowerCase() : '';
          if(fv) headers.push(fv);
        }
        if(headers.includes('title') && headers.includes('body') && headers.includes('color')) return true;
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
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    .then(r=>{ if(!r.ok) throw new Error('Drive files.create '+r.status); return r.json(); })
    .then(file=>{
      const spreadsheetId = file.id;
      return putValues(spreadsheetId, 'A1:Z1', [LOCIMYU_HEADERS], token).then(()=> spreadsheetId);
    });
}
function findOrCreateLociMyuSpreadsheet(parentFolderId, token, opts){
  if(!parentFolderId) return Promise.reject(new Error('parentFolderId required'));
  const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } })
    .then(r=>{ if(!r.ok) throw new Error('Drive list spreadsheets '+r.status); return r.json(); })
    .then(d=>{
      const files = d.files || [];
      function next(i){
        if(i>=files.length) return createLociMyuSpreadsheet(parentFolderId, token, opts||{});
        return isLociMyuSpreadsheet(files[i].id, token).then(ok=> ok ? files[i].id : next(i+1));
      }
      return next(0);
    });
}

function populateSheetTabs(spreadsheetId, token){
  const sel = $('save-target-sheet'); if(!sel||!spreadsheetId) return Promise.resolve();
  sel.innerHTML = '<option value="">Loading…</option>';
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } })
    .then(r=> r.ok ? r.json() : null)
    .then(data=>{
      if(!data) { sel.innerHTML='<option value="">(error)</option>'; return; }
      const sheets = (data.sheets||[]).map(s=>s.properties).sort((a,b)=> a.index-b.index);
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
    });
}
const sheetSel = $('save-target-sheet');
if(sheetSel){
  sheetSel.addEventListener('change', (e)=>{
    const sel = e.target;
    const opt = sel?.selectedOptions?.[0];
    currentSheetId = opt?.value ? Number(opt.value) : null;
    currentSheetTitle = opt?.dataset?.title || null;
    loadCaptionsFromSheet();
  });
}
const btnCreate = $('save-target-create');
if(btnCreate){
  btnCreate.addEventListener('click', ()=>{
    const token = ensureToken(); if(!currentSpreadsheetId) return;
    const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
    const body={ requests:[{ addSheet:{ properties:{ title } } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      .then(r=>{ if(!r.ok) throw new Error(String(r.status)); })
      .then(()=> populateSheetTabs(currentSpreadsheetId, token))
      .then(()=> loadCaptionsFromSheet())
      .catch(e=> console.error('[Sheets addSheet] failed', e));
  });
}
const btnRename = $('save-target-rename');
if(btnRename){
  btnRename.addEventListener('click', ()=>{
    const token = ensureToken(); if(!currentSpreadsheetId||!currentSheetId) return;
    const input=$('rename-input'); const newTitle = input && input.value ? String(input.value).trim() : '';
    if(!newTitle) return;
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
    const body={ requests:[{ updateSheetProperties:{ properties:{ sheetId: currentSheetId, title: newTitle }, fields: 'title' } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      .then(r=>{ if(!r.ok) throw new Error(String(r.status)); })
      .then(()=> populateSheetTabs(currentSpreadsheetId, token))
      .then(()=> loadCaptionsFromSheet())
      .catch(e=> console.error('[Sheets rename] failed', e));
  });
}

/* ---------------- Index / ensure row ---------------- */
function ensureIndex(){
  captionsIndex.clear();
  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return Promise.resolve(false);
  return getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token).then(values=>{
    if(!values.length) return false;
    currentHeaders = values[0].map(v=> textOrEmpty(v).trim());
    currentHeaderIdx = {};
    currentHeaders.forEach((h,i)=> currentHeaderIdx[h.toLowerCase()] = i);
    const iId = (currentHeaderIdx['id']!=null) ? currentHeaderIdx['id'] : -1;
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
  const vals=[[ obj.id, obj.title||'', obj.body||'', obj.color||currentPinColor, obj.x||0, obj.y||0, obj.z||0, obj.imageFileId||'', obj.createdAt||now, obj.updatedAt||now ]];
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
      id, title:'', body:'', color:currentPinColor,
      x:0,y:0,z:0, imageFileId:'',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    }, seed||{});
    return sheetsAppendRow(currentSpreadsheetId, sheetTitle, row).then(()=>{
      rowCache.set(id,row); return row;
    });
  });
}

/* ---------------- Caption list UI ---------------- */
function clearCaptionList(){
  const host=$('caption-list'); if(host) host.innerHTML='';
  captionDomById.clear();
}
function appendCaptionItem(row){
  const host=$('caption-list'); if(!host||!row) return;
  const div=document.createElement('div'); div.className='caption-item'; div.dataset.id=row.id;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  const safeTitle=(row.title||'').trim()||'(untitled)';
  const safeBody =(row.body ||'').trim()||'(no description)';

  let img;
  if(row.imageUrl){
    img=document.createElement('img'); img.src=row.imageUrl; img.alt=''; div.appendChild(img);
  }
  const txt=document.createElement('div'); txt.className='cap-txt';
  const t=document.createElement('div'); t.className='cap-title'; t.textContent=safeTitle;
  const b=document.createElement('div'); b.className='cap-body hint'; b.textContent=safeBody;
  txt.appendChild(t); txt.appendChild(b); div.appendChild(txt);

  // detach ×
  const detach=document.createElement('button'); detach.className='c-del'; detach.title='Detach image'; detach.textContent='×';
  detach.addEventListener('click', (e)=>{ e.stopPropagation(); updateImageForPin(row.id, null); });
  div.appendChild(detach);

  div.addEventListener('click', ()=> selectCaption(row.id));
  host.appendChild(div); captionDomById.set(row.id, div);
}
function enrichRow(row){
  const token=getAccessToken(); let p=Promise.resolve('');
  if(row.imageFileId){
    p = getFileThumbUrl(row.imageFileId, token, 256).catch(()=> '');
  }
  return p.then(imageUrl=>{
    const enriched=Object.assign({}, row, { imageUrl });
    rowCache.set(row.id, enriched);
    return enriched;
  });
}

/* ---------------- Save / Update / Delete ---------------- */
function reflectRowToUI(id){
  const row=rowCache.get(id)||{};
  if(selectedPinId===id){
    const t=$('caption-title'), b=$('caption-body');
    if(t && document.activeElement!==t) t.value=row.title||'';
    if(b && document.activeElement!==b) b.value=row.body||'';
  }
  const host=$('caption-list'); if(!host) return;
  let div=captionDomById.get(id);
  if(!div){ appendCaptionItem(Object.assign({id}, row)); div=captionDomById.get(id); }
  if(!div) return;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  let img=div.querySelector('img');
  if(row.imageFileId){
    if(!img){ img=document.createElement('img'); img.alt=''; div.insertBefore(img, div.firstChild); }
    const token=getAccessToken();
    getFileThumbUrl(row.imageFileId, token, 256).then(url=>{ img.src=url; }).catch(()=>{ if(img) img.remove(); });
  }else{
    if(img) img.remove();
  }
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
        color:seed.color||currentPinColor,
        x:seed.x||0, y:seed.y||0, z:seed.z||0,
        imageFileId:seed.imageFileId||'',
        createdAt:seed.createdAt||new Date().toISOString(),
        updatedAt:new Date().toISOString()
      }).then(()=>{ rowCache.set(id, seed); reflectRowToUI(id); });
    }else{
      // update existing row via batchUpdate (values.update)
      const token = ensureToken();
      const rowIndex = meta?.rowIndex || 2;
      const headers = LOCIMYU_HEADERS;
      const values = headers.map(h=>{
        const key = h;
        if(key==='updatedAt') return new Date().toISOString();
        const v = seed[key]; return (v==null?'':String(v));
      });
      const rangeA1 = `'${currentSheetTitle||'シート1'}'!A${rowIndex}:`+String(colA1(headers.length-1))+String(rowIndex);
      return putValues(currentSpreadsheetId, rangeA1, [values], token)
        .then(()=>{ rowCache.set(id, seed); reflectRowToUI(id); })
        .catch(e=>{ console.error('[values.update] failed', e); throw e; });
    }
  });
}

/* ---------------- Image attach/detach ---------------- */
function updateImageForPin(id, fileIdOrNull){
  const token = ensureToken();
  const patch = { imageFileId: fileIdOrNull ? String(fileIdOrNull) : '' };
  return updateCaptionForPin(id, patch).then(()=>{
    // right-pane preview
    const box = $('currentImageThumb');
    if(box){
      box.innerHTML = '';
      if(patch.imageFileId){
        getFileThumbUrl(patch.imageFileId, token, 256)
          .then(url=>{
            const img=document.createElement('img'); img.src=url; box.appendChild(img);
          })
          .catch(()=>{ box.innerHTML='<div class="placeholder">No Image</div>'; });
      }else{
        box.innerHTML='<div class="placeholder">No Image</div>';
      }
    }
  });
}

/* ---------------- Load captions from sheet ---------------- */
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
        color: textOrEmpty(row[map['color']||3]) || currentPinColor,
        x: Number(row[map['x']||4]||0), y: Number(row[map['y']||5]||0), z: Number(row[map['z']||6]||0),
        imageFileId: textOrEmpty(row[map['imagefileid']||7]),
        createdAt: textOrEmpty(row[map['createdat']||8]),
        updatedAt: textOrEmpty(row[map['updatedat']||9]),
      };
      rowCache.set(id, obj);
      captionsIndex.set(id, { rowIndex: r+1 });
      enrichRow(obj).then(appendCaptionItem);
      addPinMarker({ id, x:obj.x, y:obj.y, z:obj.z, color:obj.color });
    }
  }).catch(e=> console.warn('[loadCaptionsFromSheet] failed', e));
}

/* ---------------- Wire right-pane image grid (attach on click) ---------------- */
(function wireImagesGrid(){
  const grid = $('images-grid'); if(!grid) return;
  grid.addEventListener('click', (e)=>{
    const cell = e.target.closest('.thumb'); if(!cell) return;
    if(!selectedPinId) { alert('先にキャプションを選択してください。'); return; }
    const fileId = cell.dataset.fileId;
    updateImageForPin(selectedPinId, fileId).catch(e=>{
      console.error('attach failed', e);
      alert('画像の添付に失敗しました。サインイン状態と権限を確認してください。');
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
    return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(r=>r.json()).then(d=>{
      const grid = $('images-grid'); const stat = $('images-status');
      if(grid) grid.innerHTML = '';
      const files = d.files||[];
      files.forEach(f=>{
        const div = document.createElement('div');
        div.className = 'thumb';
        div.dataset.fileId = f.id;
        const thumb = (f.thumbnailLink ? (f.thumbnailLink + (f.thumbnailLink.includes('?')?'&':'?') + 'sz=s256') : '');
        if(thumb) div.style.backgroundImage = `url("${thumb}")`;
        grid?.appendChild(div);
      });
      stat && (stat.textContent = `${files.length} images`);
    });
  });
}

/* ---------------- Form autosave ---------------- */
(function wireForm(){
  const t=$('caption-title'), b=$('caption-body');
  let timer=null;
  function schedule(){
    if(!selectedPinId) return;
    clearTimeout(timer);
    timer=setTimeout(()=>{
      updateCaptionForPin(selectedPinId, { title: t?.value||'', body: b?.value||'' })
        .catch(e=> console.warn('[caption autosave failed]', e));
    }, 600);
  }
  t?.addEventListener('input', schedule);
  b?.addEventListener('input', schedule);
})();

/* ---------------- GLB load (with simple 401 handling) ---------------- */
function doLoad(){
  try{
    const token = ensureToken();
    const raw = $('glbUrl')?.value || '';
    const fileId = extractDriveId(raw);
    if(!fileId){ console.warn('[GLB] missing token or fileId'); return; }
    $('btnGlb') && ($('btnGlb').disabled = true);

    // try load once; if 401, ask user to Sign in again
    return loadGlbFromDrive(fileId, { token }).then(()=>{
      lastGlbFileId = fileId;
      // シートを確保
      return getParentFolderId(fileId, token)
        .then(parent => findOrCreateLociMyuSpreadsheet(parent, token, { glbId:fileId }))
        .then(spreadsheetId=>{
          currentSpreadsheetId = spreadsheetId;
          return populateSheetTabs(spreadsheetId, token).then(()=> loadCaptionsFromSheet());
        })
        .then(()=> refreshImagesGrid());
    }).catch(e=>{
      console.error('[GLB] load error', e);
      if(String(e).includes('401')){
        alert('認可が必要です。右上の「Sign in」を押して権限を付与してください。');
      }
    }).finally(()=>{
      $('btnGlb') && ($('btnGlb').disabled = false);
    });

  }catch(e){
    console.warn('[GLB] token missing or other error', e);
  }
}
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doLoad(); });


function __passesFilter(row){
  if(!row) return false;
  if(filterMode==='all') return true;
  if(filterMode==='selected') return selectedPinId && row.id===selectedPinId;
  if(filterMode==='color') return (row.color||'').toLowerCase() === (filterColor||'').toLowerCase();
  return true;
}
function __applyFilterToList(){
  const host = $('caption-list'); if(!host) return;
  host.querySelectorAll('.caption-item').forEach(el=>{
    const id = el.dataset.id;
    const row = rowCache.get(id);
    el.classList.toggle('is-hidden', !__passesFilter(row));
  });
}
function __rebuildPinsFiltered(){
  try{
    clearPins();
  }catch(e){}
  rowCache.forEach(row=>{
    if(__passesFilter(row)){
      addPinMarker({ id:row.id, x:row.x, y:row.y, z:row.z, color:row.color||currentPinColor });
    }
  });
  // keep selection scale
  if(selectedPinId) setPinSelected(selectedPinId, true);
}
function applyFilter(mode, color){
  filterMode = mode || 'all';
  if(mode==='color' && color) filterColor = color;
  __applyFilterToList();
  __rebuildPinsFiltered();
}

console.log('[LociMyu ESM/CDN] +chips+filter wiring loaded');


document.addEventListener('DOMContentLoaded', ()=>{
  try{ wireColorChips(); }catch(e){}
  try{ wireFilterChips(); }catch(e){}
});
