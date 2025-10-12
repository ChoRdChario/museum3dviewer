// boot.esm.cdn.js — COMPLETE (robust row ensure + overlay drag/close + list sync + image attach/detach + Sheets I/O + sheet rename hook)
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
    return j.thumbnailLink.replace(/=s\d+(?:-c)?$/, `=s${String(sz)}-c`);
  }catch(_){ return ''; }
}
async function getFileBlobUrl(fileId, token){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error('media '+r.status);
  const blob=await r.blob(); return URL.createObjectURL(blob);
}
async function getParentFolderId(fileId, token){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) return null; const j=await r.json(); return (j.parents||[])[0]||null;
}

// ---------- Global states ----------
let lastGlbFileId=null, currentSpreadsheetId=null, currentSheetId=null, currentSheetTitle=null;
let currentHeaders=[], currentHeaderIdx={};
let currentPinColor='#ff6b6b'; let selectedPinId=null; let selectedImage=null;
const captionsIndex=new Map(); // id -> { rowIndex }
const captionDomById=new Map(); // id -> element
const rowCache=new Map(); // id -> row
const overlays=new Map(); // id -> { root, imgEl }

// ---------- Selection style ----------
(function(){ const css=`.caption-item.is-selected{outline:2px solid #fff; outline-offset:-2px; border-radius:6px;}`; const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st); })();

// ---------- Overlay: line layer & drag ----------
let lineLayer=null;
function ensureLineLayer(){ if(lineLayer) return lineLayer; const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); Object.assign(s.style,{position:'fixed',left:'0',top:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'999'}); document.body.appendChild(s); lineLayer=s; return s; }
function getOrMakeLine(id){ const l=ensureLineLayer(); let el=l.querySelector(`line[data-id="${id}"]`); if(!el){ el=document.createElementNS('http://www.w3.org/2000/svg','line'); el.setAttribute('data-id',id); el.setAttribute('stroke','#ffffffaa'); el.setAttribute('stroke-width','2'); l.appendChild(el);} return el; }
function removeLine(id){ if(!lineLayer) return; const el=lineLayer.querySelector(`line[data-id="${id}"]`); if(el) el.remove(); }

function removeCaptionOverlay(id){ const o=overlays.get(id); if(!o) return; o.root.remove(); overlays.delete(id); removeLine(id); }
function createCaptionOverlay(id,data){
  removeCaptionOverlay(id);
  const root=document.createElement('div'); root.className='cap-overlay';
  Object.assign(root.style,{position:'fixed',zIndex:'1000',background:'#0b0f14ef',color:'#e5e7eb',padding:'10px 12px',borderRadius:'10px',boxShadow:'0 8px 24px #000a',minWidth:'200px',maxWidth:'300px'});
  const topbar=document.createElement('div'); Object.assign(topbar.style,{display:'flex',gap:'10px',justifyContent:'flex-end',marginBottom:'6px'});
  const mkBtn=(txt,title)=>{const b=document.createElement('button'); b.textContent=txt; b.title=title||''; Object.assign(b.style,{border:'none',background:'transparent',color:'#ddd',cursor:'pointer'}); return b;};
  const bDel=mkBtn('🗑','削除'), bClose=mkBtn('×','閉じる'); topbar.appendChild(bDel); topbar.appendChild(bClose);
  const t=document.createElement('div'); t.className='cap-title'; t.style.fontWeight='700'; t.style.marginBottom='6px';
  const body=document.createElement('div'); body.className='cap-body'; Object.assign(body.style,{fontSize:'12px',opacity:'.95',whiteSpace:'pre-wrap',marginBottom:'6px'});
  const img=document.createElement('img'); img.className='cap-img'; img.alt=''; Object.assign(img.style,{display:'none',width:'100%',height:'auto',borderRadius:'8px'});

  const safeTitle=(data&&data.title?String(data.title).trim():'')||'(untitled)';
  const safeBody =(data&&data.body ?String(data.body ).trim():'')||'(no description)';
  t.textContent=safeTitle; body.textContent=safeBody;

  // overlay drag
  let dragging=false, startX=0,startY=0,baseLeft=0,baseTop=0;
  topbar.style.cursor='move';
  topbar.addEventListener('pointerdown',(ev)=>{ dragging=true; startX=ev.clientX; startY=ev.clientY; baseLeft=parseFloat(root.style.left||'0'); baseTop=parseFloat(root.style.top||'0'); root.setPointerCapture?.(ev.pointerId); ev.stopPropagation(); });
  window.addEventListener('pointermove',(ev)=>{ if(!dragging) return; const dx=ev.clientX-startX, dy=ev.clientY-startY; root.style.left=(baseLeft+dx)+'px'; root.style.top=(baseTop+dy)+'px'; });
  window.addEventListener('pointerup',()=>{ dragging=false; });

  (async ()=>{
    const token=getAccessToken(); const row=rowCache.get(id);
    if(token && row && row.imageFileId){
      try{ img.src=await getFileBlobUrl(row.imageFileId, token); img.style.display='block'; }
      catch(_){ try{ img.src=await getFileThumbUrl(row.imageFileId, token, 1024); img.style.display='block'; }catch(__){} }
    }
  })();

  // inline edit (ダブルクリック)
  let editing=false;
  const enterEdit=()=>{ if(editing) return; editing=true; t.contentEditable='true'; body.contentEditable='true'; t.style.outline='1px dashed #fff3'; body.style.outline='1px dashed #fff3'; t.focus(); };
  const exitEdit=(save)=>{
    if(!editing) return; editing=false; t.contentEditable='false'; body.contentEditable='false'; t.style.outline=''; body.style.outline='';
    if(save){ updateCaptionForPin(id,{ title:(t.textContent||'').trim(), body:(body.textContent||'').trim() }).catch(()=>{}); }
    else{ const cur=rowCache.get(id)||{}; t.textContent=(cur.title||'').trim()||'(untitled)'; body.textContent=(cur.body||'').trim()||'(no description)'; }
  };
  t.addEventListener('dblclick', enterEdit); body.addEventListener('dblclick', enterEdit);
  t.addEventListener('keydown', (e)=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); exitEdit(true);} });
  body.addEventListener('keydown', (e)=>{ if(e.key==='Enter'&&e.ctrlKey){ e.preventDefault(); exitEdit(true);} });
  t.addEventListener('blur', ()=>{ if(editing) exitEdit(true); }); body.addEventListener('blur', ()=>{ if(editing) exitEdit(true); });
  bClose.addEventListener('click', (e)=>{ e.stopPropagation(); removeCaptionOverlay(id); });
  bDel.addEventListener('click', async (e)=>{
    e.stopPropagation();
    if(!confirm('このキャプションを削除しますか？')) return;
    try{ await deleteCaptionForPin(id); removePinMarker(id); const dom=captionDomById.get(id); if(dom) dom.remove(); captionDomById.delete(id); rowCache.delete(id); removeCaptionOverlay(id); selectedPinId=null; }
    catch(e){ console.error('[caption delete] failed',e); alert('Failed to delete caption row.'); }
  });

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
onRenderTick(()=>{ overlays.forEach((_,id)=>updateOverlayPosition(id,false)); });

// ---------- Selection / overlay helpers ----------
function __lm_markListSelected(id){
  const host=$('caption-list'); if(!host) return;
  host.querySelectorAll('.caption-item.is-selected').forEach(el=>el.classList.remove('is-selected'));
  const el=host.querySelector(`.caption-item[data-id="${CSS.escape(id)}"]`); if(el) el.classList.add('is-selected');
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
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error('values.get '+r.status); const d=await r.json(); return d.values||[]; 
}
function colA1(i0){ let n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }

async function isLociMyuSpreadsheet(spreadsheetId, token){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); if(!res.ok) return false;
  const data=await res.json(); if(!Array.isArray(data.sheets)) return false;
  for(const s of data.sheets){
    const row=(((s||{}).data||[])[0]||{}).rowData||[]; const vals=(row[0]||{}).values||[];
    const headers=[]; for(const v of vals){ const fv=(v&&v.formattedValue)?String(v.formattedValue).trim().toLowerCase():''; if(fv) headers.push(fv); }
    if(headers.includes('title') && headers.includes('body') && headers.includes('color')) return true;
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
  const q=encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok) throw new Error('Drive list spreadsheets failed: '+r.status);
  const d=await r.json(); for(const f of (d.files||[])){ if(await isLociMyuSpreadsheet(f.id, token)) return f.id; }
  return await createLociMyuSpreadsheet(parentFolderId, token, opts||{});
}
async function populateSheetTabs(spreadsheetId, token){
  const sel=$('save-target-sheet'); if(!sel||!spreadsheetId) return; sel.innerHTML='<option value="">Loading…</option>';
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok){ sel.innerHTML='<option value="">(error)</option>'; return; }
  const data=await r.json(); const sheets=(data.sheets||[]).map(s=>s.properties).sort((a,b)=>a.index-b.index);
  sel.innerHTML=''; for(const p of sheets){ const opt=document.createElement('option'); opt.value=String(p.sheetId); opt.textContent=p.title; opt.dataset.title=p.title; sel.appendChild(opt); }
  const first=sheets[0]; currentSheetId=first?first.sheetId:null; currentSheetTitle=first?first.title:null; if(currentSheetId) sel.value=String(currentSheetId);
}
$('save-target-sheet')?.addEventListener('change',(e)=>{ const sel=e.target; const opt=sel?.selectedOptions?.[0]; currentSheetId=opt&&opt.value?Number(opt.value):null; currentSheetTitle=(opt&&opt.dataset)?(opt.dataset.title||null):null; loadCaptionsFromSheet(); });
$('save-target-create')?.addEventListener('click', async ()=>{
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({requests:[{addSheet:{properties:{title}}}]})
  });
  if(!r.ok){ console.error('[Sheets addSheet] failed', r.status); return; }
  await populateSheetTabs(currentSpreadsheetId, token); await loadCaptionsFromSheet();
});
// (New) Rename current sheet if #save-target-rename and #rename-input exist
$('save-target-rename')?.addEventListener('click', async ()=>{
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetId) return;
  const newTitle=($('rename-input')?.value||'').trim(); if(!newTitle) return;
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
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  let values=[];
  try{
    values=await getValues(currentSpreadsheetId,`'${currentSheetTitle}'!A1:Z9999`, token);
  }catch(e){
    console.warn('[ensureIndex] values.get failed, best-effort continue', e);
    return;
  }
  if(!values.length) return;
  currentHeaders=values[0].map(v=>(v||'').toString().trim()); currentHeaderIdx={}; currentHeaders.forEach((h,i)=> currentHeaderIdx[h.toLowerCase()]=i);
  const iId=(currentHeaderIdx['id']!=null)?currentHeaderIdx['id']:-1;
  for(let r=1;r<values.length;r++){ const row=values[r]||[]; const id=row[iId]; if(!id) continue; captionsIndex.set(String(id),{rowIndex:r+1}); }
}
async function sheetsAppendRow(spreadsheetId, sheetTitle, obj){
  const token=getAccessToken(); if(!token) return;
  const range=`'${sheetTitle}'!A:Z`;
  const now=new Date().toISOString();
  const vals=[[ obj.id, obj.title||'', obj.body||'', obj.color||currentPinColor, obj.x||0, obj.y||0, obj.z||0, obj.imageFileId||'', obj.createdAt||now, obj.updatedAt||now ]];
  await appendValues(spreadsheetId, range, vals, token);
  await ensureIndex();
}
async function ensureRow(id, seed = {}) {
  // use cache if exists
  if (rowCache.has(id)) return rowCache.get(id);
  await ensureIndex();
  if (captionsIndex.has(id)) return rowCache.get(id)||{ id, ...seed };

  if(!currentSpreadsheetId){
    console.warn('[ensureRow] no spreadsheet set, caching only');
    const row = { id, ...seed };
    rowCache.set(id,row);
    return row;
  }
  const sheetTitle=currentSheetTitle||'シート1';
  const row = {
    id,
    title:seed.title||'',
    body:seed.body||'',
    color:seed.color||currentPinColor,
    x:('x' in seed)?seed.x:0, y:('y' in seed)?seed.y:0, z:('z' in seed)?seed.z:0,
    imageFileId:seed.imageFileId||'',
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
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
  const del=document.createElement('button'); del.className='c-del'; del.title='Delete'; del.textContent='🗑';
  del.addEventListener('click', async (e)=>{ e.stopPropagation(); if(!confirm('このキャプションを削除しますか？')) return; try{ await deleteCaptionForPin(row.id); removePinMarker(row.id); div.remove(); captionDomById.delete(row.id); rowCache.delete(row.id); removeCaptionOverlay(row.id);}catch(err){ console.error('delete failed',err); alert('Delete failed'); } });
  div.appendChild(del);
  div.addEventListener('click', ()=>{ selectCaption(row.id); });
  host.appendChild(div); captionDomById.set(row.id, div);
}

async function enrichRow(row){
  const token=getAccessToken(); let imageUrl='';
  if(row.imageFileId){ try{ imageUrl=await getFileThumbUrl(row.imageFileId, token, 256);}catch(_){ } }
  const enriched={ ...row, imageUrl }; rowCache.set(row.id, enriched); return enriched;
}

// ---------- Save / Update / Delete ----------
async function updateCaptionForPin(id, fields){
  // First ensure row; if it doesn't exist in Sheets, create it.
  const seedFromCache = rowCache.get(id) || { id };
  const seed = { ...seedFromCache, ...fields };
  await ensureRow(id, seed);

  await ensureIndex();
  let meta=captionsIndex.get(id);
  // If still not found (e.g., Sheets indexing delayed or empty sheet), try to create explicitly then re-index
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
  if(!meta) throw new Error('row not found');

  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const rowIdx=meta.rowIndex;
  const values=await getValues(currentSpreadsheetId,`'${currentSheetTitle}'!A${rowIdx}:Z${rowIdx}`, token);
  const row=(values[0]||[]).slice();
  const lower=(currentHeaders||[]).map(h=>String(h||'').toLowerCase());
  const idx=(name)=> lower.indexOf(name);
  const put=(col,val)=>{ const i=idx(col); if(i>=0) row[i]=(val==null?'':String(val)); };
  if('title' in fields) put('title', fields.title);
  if('body'  in fields) put('body',  fields.body);
  if('color' in fields) put('color', fields.color);
  if('x' in fields) put('x', fields.x);
  if('y' in fields) put('y', fields.y);
  if('z' in fields) put('z', fields.z);
  if('imageFileId' in fields) put('imagefileid', fields.imageFileId);
  put('updatedat', new Date().toISOString());

  await putValues(currentSpreadsheetId,`'${currentSheetTitle}'!A${rowIdx}:${colA1(Math.max(row.length-1,9))}${rowIdx}`, [row], token);

  // cache & UI reflect
  const cached=rowCache.get(id) || { id };
  Object.assign(cached, fields);
  if('imageFileId' in fields && !fields.imageFileId){ delete cached.imageFileId; delete cached.imageUrl; }
  rowCache.set(id, cached);

  const item=captionDomById.get(id);
  if(item){
    if('title' in fields){ const t=item.querySelector('.cap-title'); if(t) t.textContent=fields.title||'(untitled)'; }
    if('body'  in fields){ const b=item.querySelector('.cap-body');  if(b) b.textContent=fields.body ||'(no description)'; }
    if('imageFileId' in fields){
      let img=item.querySelector('img');
      if(!fields.imageFileId){ if(img) img.remove(); item.removeAttribute('data-image-file-id'); }
      else{
        const th=await resolveThumbUrl(fields.imageFileId,128);
        if(th){ if(!img){ img=document.createElement('img'); item.insertBefore(img,item.firstChild); } img.src=th; item.setAttribute('data-image-file-id', fields.imageFileId); }
      }
    }
  }
  if(overlays.has(id)){
    const o=overlays.get(id);
    if('title' in fields){ const t=o.root.querySelector('.cap-title'); if(t) t.textContent=fields.title||'(untitled)'; }
    if('body'  in fields){ const b=o.root.querySelector('.cap-body');  if(b) b.textContent=fields.body ||'(no description)'; }
    if('imageFileId' in fields){
      const img=o.root.querySelector('.cap-img');
      if(!fields.imageFileId){ if(img){ img.style.display='none'; img.removeAttribute('src'); } }
      else{
        const token=getAccessToken();
        try{ img.src=await getFileBlobUrl(fields.imageFileId, token); img.style.display='block'; }
        catch(_){ try{ img.src=await getFileThumbUrl(fields.imageFileId, token, 1024); img.style.display='block'; }catch(__){ if(img){ img.style.display='none'; img.removeAttribute('src'); } } }
      }
    }
  }
}
async function updateImageForPin(id, fileId){
  // ensure row, then update field; also refresh overlay explicitly
  await ensureRow(id,{ imageFileId:fileId });
  await updateCaptionForPin(id,{ imageFileId:fileId });
}

// Save new pin
async function savePinToSheet(obj){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range=`'${sheetTitle}'!A:Z`;
  try{
    const existed=await getValues(currentSpreadsheetId,`'${sheetTitle}'!A1:Z1`, token);
    currentHeaders=(existed[0]||[]).map(h=>(h||'').toString().trim());
    currentHeaderIdx={}; currentHeaders.forEach((h,i)=> currentHeaderIdx[h.toLowerCase()]=i);
    const lower=currentHeaders.map(h=>h.toLowerCase());
    if(!(lower.includes('title')&&lower.includes('body')&&lower.includes('color'))){
      await putValues(currentSpreadsheetId,`'${sheetTitle}'!A1:Z1`,[LOCIMYU_HEADERS], token);
      currentHeaders=LOCIMYU_HEADERS.slice();
      currentHeaderIdx={}; currentHeaders.forEach((h,i)=> currentHeaderIdx[h.toLowerCase()]=i);
    }
  }catch(_){ /* A1 header init best-effort */ }
  const now=new Date().toISOString();
  await appendValues(currentSpreadsheetId, range, [[obj.id,obj.title,obj.body,obj.color,obj.x,obj.y,obj.z,obj.imageFileId||'', now, now ]], token);
  await ensureIndex();
}

async function deleteCaptionForPin(id){
  await ensureIndex();
  const meta=captionsIndex.get(id); if(!meta) return;
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const rowIdx=meta.rowIndex; const blanks=new Array(Math.max(LOCIMYU_HEADERS.length,10)).fill('');
  await putValues(currentSpreadsheetId,`'${currentSheetTitle}'!A${rowIdx}:${colA1(blanks.length-1)}${rowIdx}`,[blanks], token);
  captionsIndex.delete(id);
}

// ---------- Load captions from sheet ----------
async function loadCaptionsFromSheet(){
  clearCaptionList();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if(!currentSheetTitle){ await populateSheetTabs(currentSpreadsheetId, token); if(!currentSheetTitle) return; }
  const values=await getValues(currentSpreadsheetId,`'${currentSheetTitle}'!A1:Z9999`, token); if(!values.length) return;
  currentHeaders=values[0].map(v=>(v||'').toString().trim()); currentHeaderIdx={}; currentHeaders.forEach((h,i)=> currentHeaderIdx[h.toLowerCase()]=i);
  const idx=(name)=> (currentHeaderIdx[name]!=null?currentHeaderIdx[name]:-1);
  const iId=idx('id'), iTitle=idx('title'), iBody=idx('body'), iColor=idx('color'), iX=idx('x'), iY=idx('y'), iZ=idx('z'), iImg=idx('imagefileid');
  captionsIndex.clear();
  clearPins();
  for(let r=1;r<values.length;r++){
    const row=values[r]||[]; const id=row[iId]; if(!id) continue;
    const obj={ id:String(id), title:row[iTitle]||'', body:row[iBody]||'', color:row[iColor]||'#ff6b6b', x:Number(row[iX]||0), y:Number(row[iY]||0), z:Number(row[iZ]||0), imageFileId:row[iImg]||'' };
    const enriched=await enrichRow(obj); appendCaptionItem(enriched); addPinMarker({ id:enriched.id, x:enriched.x, y:enriched.y, z:enriched.z, color:enriched.color }); captionsIndex.set(enriched.id,{rowIndex:r+1}); rowCache.set(enriched.id,enriched);
  }
}

// ---------- Images grid & buttons ----------
async function refreshImagesGrid(){
  const host=$('images-grid'); if(!host) return; host.innerHTML='';
  if(!lastGlbFileId) return; const token=getAccessToken(); if(!token) return;
  const parent=await getParentFolderId(lastGlbFileId, token); if(!parent) return;
  const q=encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/') and trashed=false`);
  const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&pageSize=200&supportsAllDrives=true`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok) return;
  const d=await r.json(); const files=d.files||[];
  for(const f of files){
    const div=document.createElement('div'); div.className='thumb'; div.title=f.name||'';
    const th=await resolveThumbUrl(f.id,128); if(th) div.style.backgroundImage=`url("${th}")`;
    div.addEventListener('click', async ()=>{
      selectedImage={ id:f.id, name:f.name };
      host.querySelectorAll('.thumb[data-selected="true"]').forEach(n=>n.removeAttribute('data-selected'));
      div.setAttribute('data-selected','true');
      const slot=$('currentImageThumb'); if(slot) slot.innerHTML = th ? `<img alt="" src="${th}">` : '';
      // ここでは自動アタッチは行わず、Attachボタンで反映（誤タップ防止）
    });
    host.appendChild(div);
  }
}
$('btnRefreshImages')?.addEventListener('click', refreshImagesGrid);
// Attach/Detach 操作
$('btnAttachImage')?.addEventListener('click', ()=>{ if(!selectedPinId||!selectedImage) return; updateImageForPin(selectedPinId, selectedImage.id).catch(()=>{}); });
$('btnDetachImage')?.addEventListener('click', ()=>{ if(!selectedPinId) return; selectedImage=null; updateCaptionForPin(selectedPinId,{ imageFileId:'' }).catch(()=>{}); const slot=$('currentImageThumb'); if(slot) slot.innerHTML=''; });

// ---------- Form autosave (debounced) ----------
(function(){ const t=$('caption-title'), b=$('caption-body'); let h=null; function q(){ if(h) clearTimeout(h); h=setTimeout(async ()=>{ if(!selectedPinId) return; try{ await ensureRow(selectedPinId,{ title:t?t.value:'', body:b?b.value:'' }); await updateCaptionForPin(selectedPinId,{ title:t?t.value:'', body:b?b.value:'' }); }catch(e){ console.warn('[caption autosave failed]',e); } }, 500); } t&&t.addEventListener('input', q); b&&b.addEventListener('input', q); })();

// ---------- Create pin by Shift+click ----------
onCanvasShiftPick(async (pt)=>{
  const title=($('caption-title')?.value||''), body=($('caption-body')?.value||'');
  const imageFileId=selectedImage ? (selectedImage.id||'') : '';
  const id=uid();
  const row={ id, title, body, color:currentPinColor, x:pt.x, y:pt.y, z:pt.z, imageFileId, createdAt:new Date().toISOString() };
  await savePinToSheet(row);
  addPinMarker({ id, x:pt.x, y:pt.y, z:pt.z, color:currentPinColor });
  const enriched=await enrichRow(row); appendCaptionItem(enriched);
  selectedPinId=id; setPinSelected(id,true); selectCaption(id);
  $('caption-title')?.focus();
});

// ---------- Color & filter chips ----------
const COLORS=['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#94a3b8'];
let selectedColors=new Set(COLORS);
(function initColors(){
  const host=$('pin-colors'); if(!host) return; host.innerHTML='';
  COLORS.forEach((c,i)=>{ const b=document.createElement('button'); b.className='chip'; b.dataset.color=c; b.style.background=c; b.addEventListener('click',()=>{ host.querySelectorAll('.chip').forEach(x=>x.style.outline=''); b.style.outline='2px solid #fff4'; currentPinColor=c; }); host.appendChild(b); if(i===0) b.click(); });
  const fHost=$('pin-filter'); if(!fHost) return; fHost.innerHTML='';
  COLORS.forEach((c)=>{ const label=document.createElement('label'); label.className='filter-chip'; const cb=document.createElement('input'); cb.type='checkbox'; cb.dataset.color=c; cb.checked=true; const span=document.createElement('span'); span.className='chip'; span.style.background=c; label.appendChild(cb); label.appendChild(span); cb.addEventListener('change',()=>{ if(cb.checked) selectedColors.add(c); else selectedColors.delete(c); document.dispatchEvent(new CustomEvent('pinFilterChange',{detail:{selected:[...selectedColors]}})); }); fHost.appendChild(label); });
})();

// ---------- Load GLB flow ----------
async function doLoad(){
  const token=getAccessToken(); const fileId=extractDriveId($('glbUrl')?.value||'');
  if(!token||!fileId){ console.warn('[GLB] missing token or fileId'); return; }
  try{
    $('btnGlb') && ($('btnGlb').disabled=true);
    await loadGlbFromDrive(fileId,{token}); lastGlbFileId=fileId;
    const parentId=await getParentFolderId(fileId, token);
    currentSpreadsheetId=await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId:fileId });
    await populateSheetTabs(currentSpreadsheetId, token);
    await loadCaptionsFromSheet();
    await refreshImagesGrid();
  }catch(e){ console.error('[GLB] load error', e); }
  finally{ $('btnGlb') && ($('btnGlb').disabled=false); }
}
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown',(e)=>{ if(e.key==='Enter') doLoad(); });
$('glbUrl')?.addEventListener('input',()=>{ if($('btnGlb')) $('btnGlb').disabled=!extractDriveId($('glbUrl').value||''); });
$('glbUrl')?.dispatchEvent(new Event('input'));

console.log('[LociMyu ESM/CDN] boot overlay-edit+fixed-zoom build loaded (完全版+image-fix+row-ensure+rename)');
