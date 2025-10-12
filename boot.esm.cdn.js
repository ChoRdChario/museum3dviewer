
// boot.esm.cdn.js — COMPLETE (robust row ensure + overlay drag/close + list sync + image attach/detach + Sheets I/O + sheet rename hook + HEIC fallback)
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, clearPins,
  setPinSelected, onPinSelect, loadGlbFromDrive, onRenderTick,
  projectPoint, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

// ---------- DOM helpers ----------
const $ = (id)=>document.getElementById(id);
const enable=(on,...els)=>els.forEach(el=>{ if(el) el.disabled=!on; });
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);

// ---------- Viewer & Auth boot ----------
ensureViewer({ canvas: $('gl') });

const __LM_CLIENT_ID=(window.GIS_CLIENT_ID||'595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
const __LM_API_KEY  =(window.GIS_API_KEY  ||'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI');
const __LM_SCOPES   =(window.GIS_SCOPES   ||('https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets'));
const signedSwitch=(signed)=>{
  document.documentElement.classList.toggle('signed-in',!!signed);
  enable(!!signed,$('btnGlb'),$('glbUrl'),$('save-target-sheet'),$('save-target-create'),$('btnRefreshImages'),$('save-target-rename'),$('rename-input'));
};
setupAuth($('auth-signin'), signedSwitch, { clientId:__LM_CLIENT_ID, apiKey:__LM_API_KEY, scopes:__LM_SCOPES });

// ---------- Drive utils ----------
function extractDriveId(input){
  if(!input) return null;
  const s=String(input).trim();
  const bare=s.match(/^[A-Za-z0-9_-]{25,}$/); if(bare) return bare[0];
  try{
    const u=new URL(s);
    const q=u.searchParams.get('id'); if(q && /^[A-Za-z0-9_-]{25,}$/.test(q)) return q;
    const seg=u.pathname.split('/').filter(Boolean); const ix=seg.indexOf('d');
    if(ix!==-1 && seg[ix+1] && /^[A-Za-z0-9_-]{25,}$/.test(seg[ix+1])) return seg[ix+1];
    const any=(u.href||'').match(/[A-Za-z0-9_-]{25,}/); if(any) return any[0];
  }catch(_){}
  const any2=s.match(/[A-Za-z0-9_-]{25,}/); return any2?any2[0]:null;
}
async function getFileThumbUrl(fileId, token, size=1024){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error('thumb meta '+r.status);
  const j=await r.json(); if(!j.thumbnailLink) throw new Error('no thumbnailLink');
  const sz=Math.max(64,Math.min(2048,size|0)); const sep=(j.thumbnailLink.indexOf('?')>=0)?'&':'?';
  return j.thumbnailLink+sep+'sz=s'+String(sz);
}
async function resolveThumbUrl(fileId,size=256){
  const token=getAccessToken(); if(!token||!fileId) return '';
  try{
    const meta=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`}});
    if(!meta.ok) return '';
    const j=await meta.json(); if(!j.thumbnailLink) return '';
    const sz=Math.max(64,Math.min(2048,size|0));
    return j.thumbnailLink.replace(/=s\d+(?:-c)?$/, '=s'+String(sz)+'-c');
  }catch(_){ return ''; }
}
async function getFileBlobUrl(fileId, token){
  if(!fileId || !token) throw new Error('missing fileId/token');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('media ' + r.status);
  const ct = (r.headers.get('Content-Type') || '').toLowerCase();
  if (/image\/(heic|heif)/.test(ct)) {
    // HEIC/HEIF は <img> で扱えないので、呼び出し側でサムネにフォールバックさせる
    throw new Error('unsupported image format: HEIC');
  }
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}
async function getParentFolderId(fileId, token){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) return null; const j=await r.json(); return (j.parents||[])[0]||null;
}

// ---------- Global states ----------
let lastGlbFileId=null, currentSpreadsheetId=null, currentSheetId=null, currentSheetTitle=null;
let currentHeaders=[], currentHeaderIdx={};
let currentPinColor='#ff6b6b'; let selectedPinId=null;
const captionsIndex=new Map(); // id -> { rowIndex }
const captionDomById=new Map(); // id -> element
const rowCache=new Map(); // id -> row
const overlays=new Map(); // id -> { root, imgEl }
const pendingUpdates=new Map(); // id -> fields (to flush when indexing ready)

// ---------- Selection style ----------
(function(){ const css=`.caption-item.is-selected{outline:2px solid #fff; outline-offset:-2px; border-radius:6px;}`; const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st); })();

// ---------- Overlay: line layer & drag ----------
let lineLayer=null;
function ensureLineLayer(){ if(lineLayer) return lineLayer; const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); Object.assign(s.style,{position:'fixed',left:'0',top:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'999'}); document.body.appendChild(s); lineLayer=s; return s; }
function getOrMakeLine(id){ const l=ensureLineLayer(); let el=l.querySelector('line[data-id="'+id+'"]'); if(!el){ el=document.createElementNS('http://www.w3.org/2000/svg','line'); el.setAttribute('data-id',id); el.setAttribute('stroke','#ffffffaa'); el.setAttribute('stroke-width','2'); l.appendChild(el);} return el; }
function removeLine(id){ if(!lineLayer) return; const el=lineLayer.querySelector('line[data-id="'+id+'"]'); if(el) el.remove(); }

function removeCaptionOverlay(id){ const o=overlays.get(id); if(!o) return; o.root.remove(); overlays.delete(id); removeLine(id); }
function createCaptionOverlay(id,data){
  removeCaptionOverlay(id);
  const root=document.createElement('div'); root.className='cap-overlay';
  Object.assign(root.style,{position:'fixed',zIndex:'1000',background:'#0b0f14ef',color:'#e5e7eb',padding:'10px 12px',borderRadius:'10px',boxShadow:'0 8px 24px #000a',minWidth:'200px',maxWidth:'300px'});
  const topbar=document.createElement('div'); Object.assign(topbar.style,{display:'flex',gap:'10px',justifyContent:'flex-end',marginBottom:'6px'});
  const mkBtn=(txt,title)=>{const b=document.createElement('button'); b.textContent=txt; b.title=title||''; Object.assign(b.style,{border:'none',background:'transparent',color:'#ddd',cursor:'pointer'}); return b;};
  const bClose=mkBtn('×','閉じる'); topbar.appendChild(bClose);
  const t=document.createElement('div'); t.className='cap-title'; t.style.fontWeight='700'; t.style.marginBottom='6px';
  const body=document.createElement('div'); body.className='cap-body'; Object.assign(body.style,{fontSize:'12px',opacity:'.95',whiteSpace:'pre-wrap',marginBottom:'6px'});
  const img=document.createElement('img'); img.className='cap-img'; img.alt=''; Object.assign(img.style,{display:'none',width:'100%',height:'auto',borderRadius:'8px'});

  const safeTitle=(data&&data.title?String(data.title).trim():'')||'(untitled)';
  const safeBody =(data&&data.body ?String(data.body ).trim():'')||'(no description)';
  t.textContent=safeTitle; body.textContent=safeBody;

  // overlay drag
  let dragging=false, startX=0,startY=0,baseLeft=0,baseTop=0;
  topbar.style.cursor='move';
  topbar.addEventListener('pointerdown',(ev)=>{ dragging=true; startX=ev.clientX; startY=ev.clientY; baseLeft=parseFloat(root.style.left||'0'); baseTop=parseFloat(root.style.top||'0'); if(root.setPointerCapture) root.setPointerCapture(ev.pointerId); ev.stopPropagation(); });
  window.addEventListener('pointermove',(ev)=>{ if(!dragging) return; const dx=ev.clientX-startX, dy=ev.clientY-startY; root.style.left=(baseLeft+dx)+'px'; root.style.top=(baseTop+dy)+'px'; });
  window.addEventListener('pointerup',()=>{ dragging=false; });

  (async ()=>{
    const token=getAccessToken(); const row=rowCache.get(id);
    if(token && row && row.imageFileId){
      try{ img.src=await getFileBlobUrl(row.imageFileId, token); img.style.display='block'; }
      catch(_){ try{ img.src=await getFileThumbUrl(row.imageFileId, token, 1024); img.style.display='block'; }catch(__){} }
    }
  })();

  bClose.addEventListener('click', (e)=>{ e.stopPropagation(); removeCaptionOverlay(id); });

  root.appendChild(topbar); root.appendChild(t); root.appendChild(body); root.appendChild(img);
  document.body.appendChild(root); overlays.set(id,{root,imgEl:img});
  applyOverlayZoom(id,1.0); updateOverlayPosition(id,true);
}
function applyOverlayZoom(id,z){ const o=overlays.get(id); if(!o) return; const root=o.root; const BASE=260; root.style.maxWidth=(BASE*z)+'px'; root.style.minWidth=(200*z)+'px'; updateOverlayPosition(id); }
function updateOverlayPosition(id,initial=false){
  const o=overlays.get(id); if(!o) return; const d=rowCache.get(id); if(!d) return; const p=projectPoint(d.x,d.y,d.z);
  if(!p.visible){ o.root.style.display='none'; removeLine(id); return; }
  o.root.style.display='block'; if(initial&&!o.root.style.left){ o.root.style.left=(p.x+14)+'px'; o.root.style.top=(p.y+14)+'px'; }
  const r=o.root.getBoundingClientRect(); const line=getOrMakeLine(id);
  const cx=Math.min(Math.max(p.x,r.left), r.right); const cy=Math.min(Math.max(p.y,r.top), r.bottom);
  line.setAttribute('x1',String(cx)); line.setAttribute('y1',String(cy)); line.setAttribute('x2',String(p.x)); line.setAttribute('y2',String(p.y));
}
onRenderTick(()=>{ overlays.forEach(function(_,id){ updateOverlayPosition(id,false); }); });

// ---------- Selection / overlay helpers ----------
function __lm_markListSelected(id){
  const host=$('caption-list'); if(!host) return;
  const selected=host.querySelectorAll('.caption-item.is-selected');
  for(let i=0;i<selected.length;i++){ selected[i].classList.remove('is-selected'); }
  const el=host.querySelector('.caption-item[data-id="'+CSS.escape(id)+'"]'); if(el) el.classList.add('is-selected');
}
function __lm_fillFormFromCaption(id){ const row=rowCache.get(id)||{}; const t=$('caption-title'), b=$('caption-body'); if(t) t.value=row.title||''; if(b) b.value=row.body||''; }
function selectCaption(id){ selectedPinId=id; __lm_markListSelected(id); __lm_fillFormFromCaption(id); setPinSelected(id,true); createCaptionOverlay(id,rowCache.get(id)||{}); }

onPinSelect((id)=>{ selectCaption(id); });

// ---------- Sheets I/O ----------
const LOCIMYU_HEADERS=['id','title','body','color','x','y','z','imageFileId','createdAt','updatedAt'];

async function putValues(spreadsheetId, rangeA1, values, token){ 
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`,{
    method:'PUT', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({values})
  });
}
async function appendValues(spreadsheetId, rangeA1, values, token){ 
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({values})
  });
}
async function getValues(spreadsheetId, rangeA1, token){ 
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`,{headers:{Authorization:`Bearer ${token}`} });
  if(!r.ok) throw new Error('values.get '+r.status); const d=await r.json(); return d.values||[]; 
}
function colA1(i0){ let n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }

async function isLociMyuSpreadsheet(spreadsheetId, token){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); if(!res.ok) return false;
  const data=await res.json(); if(!Array.isArray(data.sheets)) return false;
  for(let i=0;i<data.sheets.length;i++){
    const s=data.sheets[i];
    const row=((s||{}).data||[])[0]?((s||{}).data||[])[0].rowData:[];
    const vals=(row[0]||{}).values||[];
    const headers=[]; for(let j=0;j<vals.length;j++){ const v=vals[j]; const fv=(v&&v.formattedValue)?String(v.formattedValue).trim().toLowerCase():''; if(fv) headers.push(fv); }
    if(headers.indexOf('title')!==-1 && headers.indexOf('body')!==-1 && headers.indexOf('color')!==-1) return true;
  }
  return false;
}
async function createLociMyuSpreadsheet(parentFolderId, token, opts){
  const glbId=(opts&&opts.glbId)?opts.glbId:''; const name=('LociMyu_Save_'+glbId).replace(/_+$/,'');
  const r=await fetch('https://www.googleapis.com/drive/v3/files',{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({name,mimeType:'application/vnd.google-apps.spreadsheet',parents:parentFolderId?[parentFolderId]:undefined})
  });
  if(!r.ok) throw new Error('Drive files.create failed: '+r.status);
  const file=await r.json(); const spreadsheetId=file.id; await putValues(spreadsheetId,'A1:Z1',[LOCIMYU_HEADERS],token); return spreadsheetId;
}
async function findOrCreateLociMyuSpreadsheet(parentFolderId, token, opts){
  if(!parentFolderId) throw new Error('parentFolderId required');
  const q=encodeURIComponent("'" + parentFolderId + "' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok) throw new Error('Drive list spreadsheets failed: '+r.status);
  const d=await r.json(); const files=d.files||[];
  for(let i=0;i<files.length;i++){ const f=files[i]; if(await isLociMyuSpreadsheet(f.id, token)) return f.id; }
  return await createLociMyuSpreadsheet(parentFolderId, token, opts||{});
}
async function populateSheetTabs(spreadsheetId, token){
  const sel=$('save-target-sheet'); if(!sel||!spreadsheetId) return; sel.innerHTML='<option value="">Loading…</option>';
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok){ sel.innerHTML='<option value="">(error)</option>'; return; }
  const data=await r.json(); const sheets=(data.sheets||[]).map(function(s){ return s.properties; }).sort(function(a,b){ return a.index-b.index; });
  sel.innerHTML=''; for(let i=0;i<sheets.length;i++){ const p=sheets[i]; const opt=document.createElement('option'); opt.value=String(p.sheetId); opt.textContent=p.title; opt.dataset.title=p.title; sel.appendChild(opt); }
  const first=sheets[0]; currentSheetId=first?first.sheetId:null; currentSheetTitle=first?first.title:null; if(currentSheetId) sel.value=String(currentSheetId);
}
if($('save-target-sheet')) $('save-target-sheet').addEventListener('change',function(e){ const sel=e.target; const opt=(sel && sel.selectedOptions && sel.selectedOptions[0])?sel.selectedOptions[0]:null; currentSheetId=(opt&&opt.value)?Number(opt.value):null; currentSheetTitle=(opt&&opt.dataset)?(opt.dataset.title||null):null; loadCaptionsFromSheet(); });
if($('save-target-create')) $('save-target-create').addEventListener('click', async function(){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({requests:[{addSheet:{properties:{title}}}]})
  });
  if(!r.ok){ console.error('[Sheets addSheet] failed', r.status); return; }
  await populateSheetTabs(currentSpreadsheetId, token); await loadCaptionsFromSheet();
});
if($('save-target-rename')) $('save-target-rename').addEventListener('click', async function(){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetId) return;
  const input=$('rename-input'); const newTitle=(input&&input.value)?input.value.trim():''; if(!newTitle) return;
  const body={ requests:[{ updateSheetProperties:{ properties:{ sheetId: currentSheetId, title:newTitle }, fields:'title' } }] };
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  if(!r.ok){ console.error('[Sheets rename] failed', r.status); return; }
  await populateSheetTabs(currentSpreadsheetId, token); await loadCaptionsFromSheet();
});

// ---------- Indexing / ensure row ----------
async function ensureIndex(){
  captionsIndex.clear();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return false;
  let values=[];
  try{
    values=await getValues(currentSpreadsheetId,"'"+currentSheetTitle+"'!A1:Z9999", token);
  }catch(e){
    console.warn('[ensureIndex] values.get failed, best-effort continue', e);
    return false;
  }
  if(!values.length) return false;
  currentHeaders=values[0].map(function(v){ return (v||'').toString().trim(); }); currentHeaderIdx={}; for(let i=0;i<currentHeaders.length;i++){ const h=currentHeaders[i]; currentHeaderIdx[h.toLowerCase()]=i; }
  const iId=(currentHeaderIdx['id']!=null)?currentHeaderIdx['id']:-1;
  for(let r=1;r<values.length;r++){ const row=values[r]||[]; const id=row[iId]; if(!id) continue; captionsIndex.set(String(id),{rowIndex:r+1}); }
  return true;
}
async function sheetsAppendRow(spreadsheetId, sheetTitle, obj){
  const token=getAccessToken(); if(!token) return;
  const range="'"+sheetTitle+"'!A:Z";
  const now=new Date().toISOString();
  const vals=[[ obj.id, obj.title||'', obj.body||'', obj.color||currentPinColor, obj.x||0, obj.y||0, obj.z||0, obj.imageFileId||'', obj.createdAt||now, obj.updatedAt||now ]];
  await appendValues(spreadsheetId, range, vals, token);
  await ensureIndex();
}
async function ensureRow(id, seed) {
  if (rowCache.has(id)) return rowCache.get(id);
  const ok = await ensureIndex();
  if (captionsIndex.has(id)) { const cur=rowCache.get(id)||{id}; rowCache.set(id,Object.assign(cur,seed||{})); return rowCache.get(id); }

  if(!currentSpreadsheetId){
    console.warn('[ensureRow] no spreadsheet set, caching only');
    const row = Object.assign({ id }, seed||{});
    rowCache.set(id,row);
    return row;
  }
  const sheetTitle=currentSheetTitle||'シート1';
  const row = Object.assign({
    id,
    title:'',
    body:'',
    color:currentPinColor,
    x:0,y:0,z:0,
    imageFileId:'',
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  }, seed||{});
  await sheetsAppendRow(currentSpreadsheetId, sheetTitle, row);
  rowCache.set(id,row);
  return row;
}

// ---------- Caption list UI ----------
function clearCaptionList(){ const host=$('caption-list'); if(host) host.innerHTML=''; captionDomById.clear(); }
function appendCaptionItem(row){
  const host=$('caption-list'); if(!host||!row) return;
  const div=document.createElement('div'); div.className='caption-item'; div.dataset.id=row.id; if(row.imageFileId) div.dataset.imageFileId=row.imageFileId;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  const safeTitle=(row.title||'').trim()||'(untitled)'; const safeBody=(row.body||'').trim()||'(no description)';
  if(row.imageUrl){ const img=document.createElement('img'); img.src=row.imageUrl; img.alt=''; div.appendChild(img); }
  const txt=document.createElement('div'); txt.className='cap-txt'; const t=document.createElement('div'); t.className='cap-title'; t.textContent=safeTitle; const b=document.createElement('div'); b.className='cap-body hint'; b.textContent=safeBody; txt.appendChild(t); txt.appendChild(b); div.appendChild(txt);
  // small detach button
  const detach=document.createElement('button'); detach.className='c-del'; detach.title='Detach image'; detach.textContent='×';
  detach.addEventListener('click', async function(e){ e.stopPropagation(); await updateImageForPin(row.id, null); });
  div.appendChild(detach);
  div.addEventListener('click', function(){ selectCaption(row.id); });
  host.appendChild(div); captionDomById.set(row.id, div);
}

async function enrichRow(row){
  const token=getAccessToken(); let imageUrl='';
  if(row.imageFileId){ try{ imageUrl=await getFileThumbUrl(row.imageFileId, token, 256);}catch(_){ } }
  const enriched=Object.assign({}, row, { imageUrl }); rowCache.set(row.id, enriched); return enriched;
}

// ---------- Save / Update / Delete ----------
async function updateCaptionForPin(id, fields){
  const seedFromCache = rowCache.get(id) || { id };
  const seed = Object.assign({}, seedFromCache, fields||{});
  await ensureRow(id, seed);

  await ensureIndex();
  let meta=captionsIndex.get(id);
  if(!meta && currentSpreadsheetId){
    const sheetTitle=currentSheetTitle||'シート1';
    await sheetsAppendRow(currentSpreadsheetId, sheetTitle, {
      id,
      title:seed.title||'',
      body:seed.body||'',
      color:seed.color||currentPinColor,
      x:('x' in seed)?seed.x:0, y:('y' in seed)?seed.y:0, z:('z' in seed)?seed.z:0,
      imageFileId:seed.imageFileId||''
    });
    await ensureIndex();
    meta=captionsIndex.get(id);
  }
  if(!meta){
    // defer until index ready; update cache & UI
    const prev=pendingUpdates.get(id)||{}; pendingUpdates.set(id, Object.assign(prev, fields||{}));
    const cached=rowCache.get(id)||{id}; Object.assign(cached, fields||{}); rowCache.set(id,cached);
    reflectRowToUI(id);
    throw new Error('row not found');
  }

  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const rowIdx=meta.rowIndex;
  const values=await getValues(currentSpreadsheetId,"'"+currentSheetTitle+"'!A"+rowIdx+":Z"+rowIdx, token);
  const row=(values[0]||[]).slice();
  const lower=(currentHeaders||[]).map(function(h){ return String(h||'').toLowerCase(); });
  const idx=function(name){ return lower.indexOf(name); };
  const put=function(col,val){ const i=idx(col); if(i>=0){ row[i]=(val==null?'':String(val)); } };
  if(fields && ('title' in fields)) put('title', fields.title);
  if(fields && ('body'  in fields)) put('body',  fields.body);
  if(fields && ('color' in fields)) put('color', fields.color);
  if(fields && ('x' in fields)) put('x', fields.x);
  if(fields && ('y' in fields)) put('y', fields.y);
  if(fields && ('z' in fields)) put('z', fields.z);
  if(fields && ('imageFileId' in fields)) put('imagefileid', fields.imageFileId);
  put('updatedat', new Date().toISOString());

  const lastCol = Math.max(row.length-1, 9);
  await putValues(currentSpreadsheetId,"'"+currentSheetTitle+"'!A"+rowIdx+":"+colA1(lastCol)+rowIdx, [row], token);

  // cache & UI reflect
  const cached=rowCache.get(id) || { id };
  Object.assign(cached, fields||{});
  rowCache.set(id,cached);
  reflectRowToUI(id);
}

async function deleteCaptionForPin(id){
  await ensureIndex();
  const meta=captionsIndex.get(id); if(!meta) return;
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetId) return;
  const req={ requests:[{ deleteDimension:{ range:{ sheetId: currentSheetId, dimension:'ROWS', startIndex: meta.rowIndex-1, endIndex: meta.rowIndex } } }] };
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`,{ method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify(req) });
  if(!r.ok) throw new Error('delete row failed '+r.status);
  await loadCaptionsFromSheet();
}

async function updateImageForPin(id, fileId){
  const token=getAccessToken(); if(!token) return;
  // Update cache & UI fast
  const cached=rowCache.get(id)||{id}; cached.imageFileId=fileId||''; rowCache.set(id,cached);
  reflectRowToUI(id);
  const o=overlays.get(id); if(o && fileId){
    try{ o.imgEl.src=await getFileBlobUrl(fileId, token); o.imgEl.style.display='block'; }
    catch(_){ try{ o.imgEl.src=await getFileThumbUrl(fileId, token, 1024); o.imgEl.style.display='block'; }catch(__){ o.imgEl.style.display='none'; } }
  }else if(o && !fileId){ o.imgEl.style.display='none'; }

  await updateCaptionForPin(id, { imageFileId: fileId||'' });
}

// reflect one row into list item & form
function reflectRowToUI(id){
  const row=rowCache.get(id)||{};
  // form (only if currently selected)
  if(selectedPinId===id){ const t=$('caption-title'); const b=$('caption-body'); if(t && document.activeElement!==t) t.value=row.title||''; if(b && document.activeElement!==b) b.value=row.body||''; }
  // list
  const host=$('caption-list'); if(!host) return;
  let div=captionDomById.get(id);
  if(!div){ appendCaptionItem(Object.assign({id:id}, row)); div=captionDomById.get(id); }
  if(!div) return;
  div.dataset.id=id;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  let img=div.querySelector('img');
  if(row.imageFileId){
    if(!img){ img=document.createElement('img'); img.alt=''; div.insertBefore(img, div.firstChild); }
    // refresh thumb asynchronously
    (async function(){
      const token=getAccessToken(); try{ img.src=await getFileThumbUrl(row.imageFileId, token, 256);}catch(_){ img.remove(); }
    })();
  }else{
    if(img) img.remove();
  }
}

async function loadCaptionsFromSheet(){
  clearCaptionList(); captionsIndex.clear();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const values=await getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token);
  if(!values.length) return;
  currentHeaders=values[0].map(function(v){ return (v||'').toString().trim(); });
  currentHeaderIdx={}; for(let i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()]=i; }
  const H=currentHeaderIdx;
  for(let r=1;r<values.length;r++){
    const row=values[r]||[];
    const rec={
      id: row[H.id]||row[H.ID]||uid(),
      title: row[H.title]||'',
      body: row[H.body]||'',
      color: row[H.color]||currentPinColor,
      x: Number(row[H.x]||0),
      y: Number(row[H.y]||0),
      z: Number(row[H.z]||0),
      imageFileId: row[H.imagefileid]||row[H.imageFileId]||''
    };
    captionsIndex.set(String(rec.id), { rowIndex: r+1 });
    rowCache.set(String(rec.id), rec);
    const enriched=await enrichRow(rec);
    appendCaptionItem(enriched);
    addPinMarker(rec.id, rec.x, rec.y, rec.z, rec.color||currentPinColor);
  }
}

// ---------- GLB load flow ----------
async function doLoad(){
  const token=getAccessToken();
  const input=($('glbUrl')&&$('glbUrl').value)?$('glbUrl').value:'';
  const fileId=extractDriveId(input);
  if(!token || !fileId){ console.warn('[GLB] missing token or fileId'); alert('トークンかファイルIDがありません。サインインしてID/URLを入力してください'); return; }
  try{
    await loadGlbFromDrive(fileId, token);
    lastGlbFileId=fileId;
    const parentId=await getParentFolderId(fileId, token);
    currentSpreadsheetId=await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId:fileId.slice(0,6) });
    await populateSheetTabs(currentSpreadsheetId, token);
    await loadCaptionsFromSheet();
    console.info('[LociMyu ESM/CDN] boot overlay-edit+fixed-zoom build loaded (完全版)');
  }catch(err){
    console.error('[GLB] load error', err);
    alert('GLBの読み込みに失敗しました: '+(err && err.message ? err.message : String(err)));
  }
}
if($('btnGlb')) $('btnGlb').addEventListener('click', function(){ doLoad(); });

// ---------- Inputs & autosave ----------
function debounce(fn,ms){ let t=null; return function(){ const ctx=this, args=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(ctx,args); }, ms); }; }
const autoSave=debounce(async function(){
  if(!selectedPinId) return;
  const t=$('caption-title'), b=$('caption-body');
  try{
    await updateCaptionForPin(selectedPinId, { title:(t&&t.value)?t.value:'', body:(b&&b.value)?b.value:'' });
  }catch(e){ console.warn('[caption autosave failed]', e); }
}, 600);
if($('caption-title')) $('caption-title').addEventListener('input', autoSave);
if($('caption-body')) $('caption-body').addEventListener('input', autoSave);

// attach by clicking image in grid or by button (prompt Drive URL/ID)
if($('btnAttachImage')) $('btnAttachImage').addEventListener('click', async function(){
  if(!selectedPinId){ alert('先にキャプション（ピン）を選択してください'); return; }
  const s=prompt('Drive の画像 URL または fileId を入力'); if(!s) return;
  const fileId=extractDriveId(s); if(!fileId) return alert('無効なURL/IDです');
  await updateImageForPin(selectedPinId, fileId);
});
if($('btnDetachImage')) $('btnDetachImage').addEventListener('click', async function(){
  if(!selectedPinId) return; await updateImageForPin(selectedPinId, null);
});

// image grid click attach (if images-grid populated elsewhere)
const imagesGrid=$('images-grid');
if(imagesGrid){
  imagesGrid.addEventListener('click', async function(ev){
    const t=ev.target;
    if(t && t.tagName==='IMG'){
      if(!selectedPinId){ alert('先にキャプション（ピン）を選択してください'); return; }
      const fid=t.dataset.fileId||t.getAttribute('data-file-id')||'';
      if(!fid) return;
      await updateImageForPin(selectedPinId, fid);
    }
  });
}

// ---------- Create pin from canvas pick ----------
onCanvasShiftPick(async function(pos){
  const id=uid();
  const row=await ensureRow(id, { id, x:pos.x, y:pos.y, z:pos.z, color:currentPinColor, title:'', body:'' });
  addPinMarker(id, pos.x, pos.y, pos.z, currentPinColor);
  selectCaption(id);
  await updateCaptionForPin(id, { x:pos.x, y:pos.y, z:pos.z });
});

// ---------- Flush pending when possible ----------
async function flushPending(){
  if(!pendingUpdates.size) return;
  const ok=await ensureIndex(); if(!ok) return;
  const entries=Array.from(pendingUpdates.entries());
  for(let i=0;i<entries.length;i++){
    const kv=entries[i]; const id=kv[0]; const fields=kv[1];
    try{ await updateCaptionForPin(id, fields); pendingUpdates.delete(id); }
    catch(e){ /* keep pending */ }
  }
}
setInterval(flushPending, 2000);

// ---------- Export some helpers (debug) ----------
window.__lm_selectPin = selectCaption;
window.__lm_markListSelected = __lm_markListSelected;
window.__lm_fillFormFromCaption = __lm_fillFormFromCaption;

// done
