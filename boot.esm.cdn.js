// boot.esm.cdn.js — stabilized M1 (selection highlight + form editing + attach/detach + overlay view)
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, clearPins,
  setPinSelected, onPinSelect, loadGlbFromDrive, onRenderTick,
  projectPoint, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

/* ------------------------- small DOM helpers ------------------------- */
const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => { if (el) el.disabled = !on; });
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* --------------------------- viewer bootstrap ------------------------ */
ensureViewer({ canvas: $('gl') });

/* ------------------------------ auth -------------------------------- */
const __LM_CLIENT_ID = (window.GIS_CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
const __LM_API_KEY   = (window.GIS_API_KEY   || 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI');
const __LM_SCOPES    = (window.GIS_SCOPES    || [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' '));

const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', !!signed);
  enable(!!signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
setupAuth($('auth-signin'), signedSwitch, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });

/* ---------------------------- Drive utils ---------------------------- */
function extractDriveId(v){
  if (!v) return null;
  const s = String(v).trim();
  try {
    const u = new URL(s);
    const q = u.searchParams.get('id');
    if (q && /[-\w]{25,}/.test(q)) return q;
    const seg = u.pathname.split('/').filter(Boolean);
    const dIdx = seg.indexOf('d');
    if (dIdx !== -1 && seg[dIdx + 1] && /[-\w]{25,}/.test(seg[dIdx + 1])) return seg[dIdx + 1];
  } catch (e) {}
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : null;
}
async function getParentFolderId(fileId, token) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=parents&supportsAllDrives=true', { headers:{Authorization:'Bearer '+token} });
  if (!res.ok) throw new Error('Drive meta failed: '+res.status);
  const meta = await res.json(); return (Array.isArray(meta.parents)&&meta.parents[0])||null;
}
async function listImagesForGlb(fileId, token) {
  const parent = await getParentFolderId(fileId, token); if(!parent) return [];
  const q = encodeURIComponent("'" + parent + "' in parents and (mimeType contains 'image/') and trashed=false");
  const url = 'https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,mimeType,thumbnailLink)&pageSize=200&supportsAllDrives=true';
  const r = await fetch(url, { headers:{Authorization:'Bearer '+token} });
  if(!r.ok) throw new Error('Drive list failed: '+r.status);
  const d = await r.json(); return d.files||[];
}
async function getFileThumbUrl(fileId, token, size=512) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=thumbnailLink&supportsAllDrives=true', { headers:{Authorization:'Bearer '+token} });
  if (!r.ok) throw new Error('thumb meta '+r.status);
  const j = await r.json(); if (!j.thumbnailLink) throw new Error('no thumbnailLink');
  const sz = Math.max(64, Math.min(2048, size|0));
  const sep = (j.thumbnailLink.indexOf('?')>=0)?'&':'?';
  return j.thumbnailLink + sep + 'sz=s'+String(sz) + '&access_token=' + encodeURIComponent(token);
}
async function getFileBlobUrl(fileId, token) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media&supportsAllDrives=true', { headers:{Authorization:'Bearer '+token} });
  if (!r.ok) throw new Error('media '+r.status);
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}

/* ------------------------------ state -------------------------------- */
let lastGlbFileId = null;
let currentSpreadsheetId = null;
let currentSheetId = null;
let currentSheetTitle = null;
let currentHeaders = [];
let currentHeaderIdx = {};
let currentPinColor = '#ff6b6b';
let selectedPinId = null;
let selectedImage = null;
const captionsIndex = new Map();
const captionDomById = new Map();
const rowCache = new Map();

// hide "+Pin" button completely if present（Shift+クリックで統一）
const pinAddBtn = $('pin-add'); if (pinAddBtn) pinAddBtn.style.display = 'none';

/* -------------------------- back-line layer -------------------------- */
let lineLayer = null;
function ensureLineLayer(){
  if (lineLayer) return lineLayer;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  Object.assign(svg.style, { position:'fixed', left:'0', top:'0', width:'100vw', height:'100vh', pointerEvents:'none', zIndex:'999' });
  document.body.appendChild(svg);
  lineLayer = svg; return svg;
}
function getOrMakeLine(id){
  const layer = ensureLineLayer();
  let el = layer.querySelector('line[data-id="'+id+'"]');
  if (!el){
    el = document.createElementNS('http://www.w3.org/2000/svg','line');
    el.setAttribute('data-id', id);
    el.setAttribute('stroke','#ffffffaa');
    el.setAttribute('stroke-width','2');
    layer.appendChild(el);
  }
  return el;
}
function removeLine(id){
  if (!lineLayer) return;
  const el = lineLayer.querySelector('line[data-id="'+id+'"]');
  if (el) el.remove();
}

/* --------------------------- overlays (UI) --------------------------- */
const overlays = new Map(); // id -> {root,imgEl}

function removeCaptionOverlay(id){
  const o = overlays.get(id);
  if (!o) return;
  o.root.remove();
  overlays.delete(id);
  removeLine(id);
}

function createCaptionOverlay(id, data){
  removeCaptionOverlay(id);
  const root = document.createElement('div');
  root.className = 'cap-overlay';
  Object.assign(root.style, {
    position:'fixed', zIndex:'1000', background:'#0b0f14ef', color:'#e5e7eb',
    padding:'10px 12px 12px 12px', borderRadius:'10px', boxShadow:'0 8px 24px #000a',
    minWidth:'200px', maxWidth:'300px'
  });

  const topbar = document.createElement('div');
  Object.assign(topbar.style, { display:'flex', gap:'10px', justifyContent:'flex-end', marginBottom:'6px' });
  const mkBtn = (txt, title) => {
    const b = document.createElement('button');
    b.textContent = txt; b.title = title||'';
    Object.assign(b.style, { border:'none', background:'transparent', color:'#ddd', cursor:'pointer' });
    return b;
  };
  const bClose = mkBtn('×','閉じる');
  bClose.addEventListener('click', ()=> removeCaptionOverlay(id));
  topbar.appendChild(bClose);

  const t = document.createElement('div'); t.className='cap-title'; t.style.fontWeight='700'; t.style.marginBottom='6px';
  const body = document.createElement('div'); body.className='cap-body'; body.style.fontSize='12px'; body.style.opacity='.95'; body.style.whiteSpace='pre-wrap'; body.style.marginBottom='6px';
  const img = document.createElement('img'); img.className='cap-img'; img.alt=''; img.style.display='none'; img.style.width='100%'; img.style.borderRadius='8px';

  const safeTitle = (data && data.title ? String(data.title).trim() : '') || '(untitled)';
  const safeBody  = (data && data.body  ? String(data.body).trim()  : '') || '(no description)';
  t.textContent = safeTitle; body.textContent = safeBody;

  (async()=>{
    try{
      const token = getAccessToken();
      if (token && data && data.imageFileId){
        try {
          const full = await getFileBlobUrl(data.imageFileId, token);
          img.src = full; img.style.display='block';
        } catch (e) {
          const th = await getFileThumbUrl(data.imageFileId, token, 1024);
          img.src = th; img.style.display='block';
        }
      }
    }catch(e){ console.warn('[overlay image]', e); }
  })();

  root.appendChild(topbar);
  root.appendChild(t);
  root.appendChild(body);
  root.appendChild(img);

  document.body.appendChild(root);
  overlays.set(id, { root, imgEl: img });
  updateOverlayPosition(id, true);
}

function updateOverlayPosition(id, initial=false){
  const o = overlays.get(id); if (!o) return;
  const d = rowCache.get(id); if (!d) return;
  const p = projectPoint(d.x, d.y, d.z);
  if (!p.visible){ o.root.style.display='none'; removeLine(id); return; }
  o.root.style.display='block';
  if (initial && !o.root.style.left){ o.root.style.left = (p.x + 14) + 'px'; o.root.style.top  = (p.y + 14) + 'px'; }
  const r = o.root.getBoundingClientRect();
  const line = getOrMakeLine(id);
  const x2 = p.x, y2 = p.y;
  const cx = Math.min(Math.max(x2, r.left), r.right);
  const cy = Math.min(Math.max(y2, r.top ), r.bottom);
  line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy));
  line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
}
onRenderTick(() => { overlays.forEach((_, id) => updateOverlayPosition(id, false)); });

function showOverlayFor(id){
  const d=rowCache.get(id); if(!d) return;
  __lm_markListSelected(id);
  createCaptionOverlay(id, d);
  setPinSelected(id, true);
}

/* ----------------------- Pin selection & add ------------------------ */
onPinSelect((id) => { if (id){ selectedPinId = id; showOverlayFor(id); } });
onCanvasShiftPick(async (pt) => {
  const title = ($('caption-title')?.value || '');
  const body  = ($('caption-body')?.value  || '');
  const imageFileId = selectedImage ? (selectedImage.id || '') : '';
  const id = uid();
  const row = { id, title, body, color: currentPinColor, x: pt.x, y: pt.y, z: pt.z, imageFileId };
  await savePinToSheet(row);
  addPinMarker({ id, x: pt.x, y: pt.y, z: pt.z, color: currentPinColor });
  const enriched = await enrichRow(row);
  appendCaptionItem(enriched);
  selectedPinId = id; setPinSelected(id, true);
  showOverlayFor(id);
  $('caption-title')?.focus();
});

/* ----------------------------- GLB Load ----------------------------- */
async function doLoad(){
  const token = getAccessToken();
  const fileId = extractDriveId($('glbUrl') ? $('glbUrl').value : '');
  if (!token || !fileId) { console.warn('[GLB] missing token or fileId'); return; }
  try {
    $('btnGlb') && ($('btnGlb').disabled = true);
  } catch(e) {}
  try {
    await loadGlbFromDrive(fileId, { token });
    lastGlbFileId = fileId;
    const parentId = await getParentFolderId(fileId, token);
    currentSpreadsheetId = await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId: fileId });
    await populateSheetTabs(currentSpreadsheetId, token);
    await loadCaptionsFromSheet();
    await refreshImagesGrid();
  } catch (e) {
    console.error('[GLB] load error', e);
  } finally {
    $('btnGlb') && ($('btnGlb').disabled = false);
  }
}
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doLoad(); });
$('glbUrl')?.addEventListener('input', ()=>{ const ok = !!extractDriveId($('glbUrl').value||''); if ($('btnGlb')) $('btnGlb').disabled = !ok; });
$('glbUrl')?.dispatchEvent(new Event('input'));

/* ------------------------ Colors & Filter UI ------------------------ */
const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#94a3b8'];
const pinColorsHost = $('pin-colors');
if (pinColorsHost){
  pinColorsHost.innerHTML = '';
  COLORS.forEach((c, idx) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.color = c;
    b.title = c;
    b.style.background = c;
    b.addEventListener('click', () => {
      const chips = pinColorsHost.querySelectorAll('.chip');
      for (let i=0;i<chips.length;i++){ chips[i].style.outline = ''; }
      b.style.outline = '2px solid #fff4';
      currentPinColor = c;
    });
    pinColorsHost.appendChild(b);
    if (idx===0) b.click();
  });
}
const selectedColors = new Set(COLORS);
const pinFilterHost = $('pin-filter');
pinFilterHost?.addEventListener('change', ()=>{
  const selected = Array.from(pinFilterHost.querySelectorAll('input[type="checkbox"]')).filter(x=>x.checked).map(x=>x.dataset.color);
  document.dispatchEvent(new CustomEvent('pinFilterChange', { detail:{ selected } }));
});

/* ---------------------------- Sheets I/O ---------------------------- */
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId'];
async function putValues(spreadsheetId, rangeA1, values, token) {
  return fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent(rangeA1)+'?valueInputOption=RAW', {
    method:'PUT', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:JSON.stringify({ values })
  });
}
async function appendValues(spreadsheetId, rangeA1, values, token) {
  return fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent(rangeA1)+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:JSON.stringify({ values })
  });
}
async function getValues(spreadsheetId, rangeA1, token) {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent(rangeA1), { headers:{Authorization:'Bearer '+token} });
  if (!r.ok) throw new Error('values.get '+r.status);
  const d = await r.json(); return d.values||[];
}
function colA1(i0){ let n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }

async function isLociMyuSpreadsheet(spreadsheetId, token) {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))';
  const res = await fetch(url, { headers:{Authorization:'Bearer '+token} });
  if (!res.ok) return false;
  const data = await res.json(); if (!Array.isArray(data.sheets)) return false;
  for (let i=0;i<data.sheets.length;i++){
    const s = data.sheets[i];
    const row = (((s||{}).data||[])[0]||{}).rowData || [];
    const vals = (row[0]||{}).values || [];
    const headers = []; for (let k=0;k<vals.length;k++){ const v=vals[k]; const fv = (v && v.formattedValue) ? String(v.formattedValue).trim().toLowerCase() : ''; if (fv) headers.push(fv); }
    const hasTitle = headers.indexOf('title')>=0;
    const hasBody  = headers.indexOf('body')>=0;
    const hasColor = headers.indexOf('color')>=0;
    if (hasTitle && hasBody && hasColor) return true;
  }
  return false;
}
async function createLociMyuSpreadsheet(parentFolderId, token, opts) {
  const glbId = (opts && opts.glbId) ? opts.glbId : '';
  const name = ('LociMyu_Save_'+glbId).replace(/_+$/,'');
  const r = await fetch('https://www.googleapis.com/drive/v3/files', {
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({ name, mimeType:'application/vnd.google-apps.spreadsheet', parents: parentFolderId?[parentFolderId]:undefined })
  });
  if (!r.ok) throw new Error('Drive files.create failed: '+r.status);
  const file = await r.json(); const spreadsheetId = file.id;
  await putValues(spreadsheetId, 'A1:Z1', [LOCIMYU_HEADERS], token);
  return spreadsheetId;
}
async function findOrCreateLociMyuSpreadsheet(parentFolderId, token, opts) {
  if (!parentFolderId) throw new Error('parentFolderId required');
  const q = encodeURIComponent("'" + parentFolderId + "' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const url = 'https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true';
  const r = await fetch(url, { headers:{Authorization:'Bearer '+token} }); if(!r.ok) throw new Error('Drive list spreadsheets failed: '+r.status);
  const d = await r.json(); const files = d.files||[];
  for (let i=0;i<files.length;i++){ const f=files[i]; if (await isLociMyuSpreadsheet(f.id, token)) return f.id; }
  return await createLociMyuSpreadsheet(parentFolderId, token, opts||{});
}
async function populateSheetTabs(spreadsheetId, token) {
  const sel = $('save-target-sheet'); if (!sel || !spreadsheetId) return;
  sel.innerHTML = '<option value="">Loading…</option>';
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?fields=sheets(properties(title,sheetId,index))', { headers:{Authorization:'Bearer '+token} });
  if (!r.ok) { sel.innerHTML = '<option value="">(error)</option>'; return; }
  const data = await r.json();
  const sheets = (data.sheets||[]).map(s=>s.properties).sort((a,b)=>a.index-b.index);
  sel.innerHTML = '';
  for (let i=0;i<sheets.length;i++){
    const p = sheets[i];
    const opt = document.createElement('option');
    opt.value = String(p.sheetId);
    opt.textContent = p.title;
    opt.dataset.title = p.title;
    sel.appendChild(opt);
  }
  const first = sheets[0]; currentSheetId = first ? first.sheetId : null; currentSheetTitle = first ? first.title : null;
  if (currentSheetId) sel.value = String(currentSheetId);
}
$('save-target-sheet')?.addEventListener('change', (e)=>{
  const sel = e.target; const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
  currentSheetId = opt && opt.value ? Number(opt.value) : null;
  currentSheetTitle = (opt && opt.dataset) ? (opt.dataset.title || null) : null;
  loadCaptionsFromSheet();
});
$('save-target-create')?.addEventListener('click', async ()=>{
  const token = getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(currentSpreadsheetId)+':batchUpdate', {
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({ requests:[{ addSheet:{ properties:{ title } } }] })
  });
  if (!r.ok){ console.error('[Sheets addSheet] failed', r.status); return; }
  await populateSheetTabs(currentSpreadsheetId, token); await loadCaptionsFromSheet();
});

function clearCaptionList(){ const host=$('caption-list'); if (host) host.innerHTML=''; captionDomById.clear(); captionsIndex.clear(); }

function appendCaptionItem(args){
  const host = $('caption-list'); if (!host || !args) return;
  const id = String(args.id || '').trim(); if (!id) return;
  const title = (args.title || '').toString();
  const body  = (args.body  || '').toString();
  const color = (args.color || '').toString();
  const imageUrl = (args.imageUrl || '').toString();

  const div = document.createElement('div');
  div.className = 'caption-item';
  div.dataset.id = id;
  if (args.imageFileId) div.dataset.imageFileId = args.imageFileId;
  if (color) div.style.setProperty('--pin-color', color);

  const safeTitle = title.trim() || '(untitled)';
  const safeBody  = body.trim()  || '(no description)';

  if (imageUrl){
    const img = document.createElement('img');
    img.src = imageUrl; img.alt = '';
    div.appendChild(img);
  }

  const txt  = document.createElement('div'); txt.className='cap-txt';
  const t    = document.createElement('div'); t.className='c-title'; t.textContent=safeTitle;
  const b    = document.createElement('div'); b.className='c-body'; b.classList.add('hint'); b.textContent=safeBody;
  txt.appendChild(t); txt.appendChild(b); div.appendChild(txt);

  div.addEventListener('click', (e)=>{
    if (e.target && e.target.closest && e.target.closest('.c-del')) return;
    __lm_selectPin(id, 'list');
  });

  const del = document.createElement('button');
  del.className = 'c-del'; del.title = 'Delete'; del.textContent = '🗑';
  del.addEventListener('click', async (e)=>{
    e.stopPropagation();
    if (!confirm('このキャプションを削除しますか？')) return;
    try{
      await deleteCaptionForPin(id);
      removePinMarker(id);
      div.remove();
      captionDomById.delete(id);
      rowCache.delete(id);
      overlays.delete(id);
      removeLine(id);
    }catch(err){
      console.error('delete failed', err);
      alert('Delete failed');
    }
  });
  div.appendChild(del);

  host.appendChild(div);
  captionDomById.set(id, div);
  try{ div.scrollIntoView({block:'nearest'}); }catch(e){}
}

async function enrichRow(row){
  const token=getAccessToken(); let imageUrl='';
  if(row.imageFileId){
    try{ imageUrl=await getFileThumbUrl(row.imageFileId, token, 256);}catch(e){}
  }
  const enriched = { id:row.id, title:row.title, body:row.body, color:row.color, x:row.x, y:row.y, z:row.z, imageFileId:row.imageFileId, imageUrl };
  rowCache.set(row.id, enriched);
  return enriched;
}

async function savePinToSheet(obj){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range="'"+sheetTitle+"'!A:Z";
  try {
    const existed=await getValues(currentSpreadsheetId, "'"+sheetTitle+"'!A1:Z1", token);
    currentHeaders = (existed[0]||[]).map(h=>(h||'').toString().trim());
    currentHeaderIdx = {}; for (let i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()] = i; }
    const lower = currentHeaders.map(h=>h.toLowerCase());
    const hasTitle = lower.indexOf('title')>=0, hasBody = lower.indexOf('body')>=0, hasColor=lower.indexOf('color')>=0;
    if(!(hasTitle && hasBody && hasColor)) await putValues(currentSpreadsheetId, "'"+sheetTitle+"'!A1:Z1", [LOCIMYU_HEADERS], token);
  } catch(e){}
  await appendValues(currentSpreadsheetId, range, [[obj.id, obj.title, obj.body, obj.color, obj.x, obj.y, obj.z, obj.imageFileId]], token);
}

async function ensureIndex(){
  captionsIndex.clear();
  for (const [id, row] of rowCache.entries()){
    captionsIndex.set(id, row);
  }
}

async function loadCaptionsFromSheet(){
  const token = getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1';
  try{
    clearPins(); clearCaptionList(); overlays.clear();
    const values = await getValues(currentSpreadsheetId, "'"+sheetTitle+"'!A1:Z10000", token);
    if (!values || !values.length) return;
    const headers = values[0]||[];
    const idx = (name) => {
      const i = headers.findIndex(h => String(h||'').toLowerCase() === name);
      return (i>=0) ? i : -1;
    };
    const iId=idx('id'), iTitle=idx('title'), iBody=idx('body'), iColor=idx('color'), iX=idx('x'), iY=idx('y'), iZ=idx('z'), iImg=idx('imagefileid');
    for (let r=1; r<values.length; r++){
      const row=values[r]||[];
      const data = {
        id: (row[iId]||uid()), title: row[iTitle]||'', body: row[iBody]||'', color: row[iColor]||'#ff6b6b',
        x: Number(row[iX]||0), y: Number(row[iY]||0), z: Number(row[iZ]||0), imageFileId: row[iImg]||''
      };
      addPinMarker({ id: data.id, x: data.x, y: data.y, z: data.z, color: data.color });
      const enriched = await enrichRow(data);
      appendCaptionItem(enriched);
    }
    await ensureIndex();
  } catch(e){ console.warn('[loadCaptionsFromSheet] failed', e); }
}

/* --------------------------- Images UX --------------------------- */
$('btnRefreshImages')?.addEventListener('click', refreshImagesGrid);
async function refreshImagesGrid(){
  const token = getAccessToken();
  const fileId = lastGlbFileId || extractDriveId($('glbUrl')?$('glbUrl').value:'');
  const s=$('images-status'); const grid = $('images-grid'); if (grid) grid.innerHTML='';
  const hint=$('images-hint');
  if (!token || !fileId) { if(s) s.textContent='Sign in & load a GLB first.'; return; }
  if (s) s.textContent = 'Loading images…';
  try{
    const files = await listImagesForGlb(fileId, token);
    if (s) s.textContent = String(files.length) + ' image(s) found in the GLB folder';
    for (let i=0;i<files.length;i++){
      const f = files[i];
      try{
        const url = await getFileThumbUrl(f.id, token, 256);
        const btn = document.createElement('button');
        btn.className='thumb'; btn.style.backgroundImage='url('+url+')'; btn.title=f.name; btn.dataset.id=f.id;
        btn.addEventListener('click', async ()=>{
          if (!selectedPinId){
            if (hint) hint.textContent = 'Select a caption from the list, then click a thumbnail to attach it.';
            return;
          }
          const all = grid ? grid.querySelectorAll('.thumb') : [];
          for (let k=0;k<all.length;k++){ all[k].dataset.selected='false'; }
          btn.dataset.selected='true';
          selectedImage = {id:f.id, url:url};
          await updateImageForPin(selectedPinId, f.id);
          if (hint) hint.textContent = 'Attached to the selected caption.';
        });
        if (grid) grid.appendChild(btn);
      }catch(e){}
    }
  }catch(e){ if (s) s.textContent = 'Error: '+e.message; }
}

/* ===== v6.7 selection + form editing & attach/detach ===== */
function __lm_markListSelected(id){
  const host = $('caption-list'); if (!host) return;
  host.querySelectorAll('.caption-item.is-selected,[aria-selected="true"]').forEach(el=>{
    el.classList.remove('is-selected'); el.removeAttribute('aria-selected');
  });
  if (!id) return;
  const li = host.querySelector(`.caption-item[data-id="${CSS.escape(id)}"]`);
  if (li){ li.classList.add('is-selected'); li.setAttribute('aria-selected','true'); li.scrollIntoView({block:'nearest'}); }
}

async function __lm_fillFormFromCaption(obj){
  const ti = $('caption-title'); const bo = $('caption-body'); const th = $('currentImageThumb');
  if (!ti || !bo || !th) return;
  ti.value = (obj && obj.title) ? String(obj.title) : '';
  bo.value = (obj && obj.body)  ? String(obj.body)  : '';
  if (obj && obj.imageFileId){
    try{
      const url = await getFileThumbUrl(obj.imageFileId, getAccessToken(), 256);
      th.innerHTML = `<img alt="attached" src="${url}">`;
    }catch(e){
      console.warn('[thumb fail]', e); th.innerHTML = `<div class="placeholder">No Image</div>`;
    }
  } else {
    th.innerHTML = `<div class="placeholder">No Image</div>`;
  }
}

function __lm_getCaptionDataById(id){
  const li = document.querySelector(`#caption-list .caption-item[data-id="${CSS.escape(id)}"]`);
  if (!li) return null;
  const titleEl = li.querySelector('.c-title'); const bodyEl = li.querySelector('.c-body');
  const imageFileId = (li.dataset.imageFileId || '');
  return { id, title: titleEl ? titleEl.textContent : '', body: bodyEl ? bodyEl.textContent : '', imageFileId };
}

function __lm_selectPin(id, source='unknown'){
  selectedPinId = id;
  setPinSelected(id, true);
  __lm_markListSelected(id);
  const obj = rowCache.get(id) || __lm_getCaptionDataById(id);
  __lm_fillFormFromCaption(obj);
  if (source === 'viewer') { $('caption-title')?.focus(); }
}

// viewer -> selection
onPinSelect((id)=>{ if (id) __lm_selectPin(id, 'viewer'); });

// list -> selection
(function(){
  const host = $('caption-list');
  if (!host) return;
  host.addEventListener('click', (e)=>{
    const item = e.target && e.target.closest ? e.target.closest('.caption-item[data-id]') : null;
    if (!item) return;
    if (e.target.closest && e.target.closest('.c-del')) return;
    __lm_selectPin(item.dataset.id, 'list');
  }, {capture:true});
})();

// form -> update (debounced)
let __lm_deb;
['caption-title','caption-body'].forEach(id=>{
  const el = $(id); if (!el) return;
  el.addEventListener('input', ()=>{
    if (!selectedPinId) return;
    clearTimeout(__lm_deb);
    __lm_deb = setTimeout(async ()=>{
      const title = $('caption-title').value.trim();
      const body  = $('caption-body').value.trim();
      try{
        await updateCaptionForPin(selectedPinId, { title, body });
        const li = document.querySelector(`#caption-list .caption-item[data-id="${CSS.escape(selectedPinId)}"]`);
        if (li){
          const t = li.querySelector('.c-title'); if (t) t.textContent = title || '(untitled)';
          const b = li.querySelector('.c-body');  if (b) b.textContent = body  || '(no description)';
        }
        const cur = rowCache.get(selectedPinId) || {};
        rowCache.set(selectedPinId, { ...cur, title, body });
      }catch(e){ console.warn('[caption autosave failed]', e); }
    }, 500);
  });
});

// attach / detach UI
(function(){
  const attach = $('btnAttachImage');
  const detach = $('btnDetachImage');
  const grid   = $('images-grid');
  const hint   = $('images-status');
  if (attach){
    attach.addEventListener('click', ()=>{
      if (!selectedPinId){ alert('キャプションを選択してください'); return; }
      grid?.scrollIntoView({behavior:'smooth', block:'nearest'});
      if (hint) hint.textContent = '画像を選ぶと選択キャプションに添付されます。';
    });
  }
  if (detach){
    detach.addEventListener('click', async ()=>{
      if (!selectedPinId){ alert('キャプションを選択してください'); return; }
      try{
        await updateImageForPin(selectedPinId, '');
        $('currentImageThumb').innerHTML = '<div class="placeholder">No Image</div>';
        const im = document.querySelector(`#caption-list .caption-item[data-id="${CSS.escape(selectedPinId)}"] img`);
        if (im) im.remove();
        const cur = rowCache.get(selectedPinId) || {};
        rowCache.set(selectedPinId, { ...cur, imageFileId:'' , imageUrl:'' });
      }catch(e){ console.warn('[detach failed]', e); }
    });
  }
})();

/* --------------------- Update helpers (Sheets row ops) --------------- */
function buildHeaderIndex(headers){
  const idx = {}; for (let i=0;i<headers.length;i++){ idx[String(headers[i]||'').toLowerCase()] = i; } return idx;
}
async function ensureHeadersAndIndex(sheetTitle, token){
  const existed=await getValues(currentSpreadsheetId, "'"+sheetTitle+"'!A1:Z1", token);
  currentHeaders = (existed[0]||[]).map(h=>(h||'').toString().trim());
  if (!currentHeaders.length){ await putValues(currentSpreadsheetId, "'"+sheetTitle+"'!A1:Z1", [LOCIMYU_HEADERS], token); currentHeaders = LOCIMYU_HEADERS.slice(); }
  currentHeaderIdx = buildHeaderIndex(currentHeaders);
}
async function updateCaptionForPin(id, { title, body }){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) throw new Error('no sheet');
  const sheetTitle=currentSheetTitle||'シート1';
  await ensureHeadersAndIndex(sheetTitle, token);
  const range = "'"+sheetTitle+"'!A1:Z10000";
  const rows = await getValues(currentSpreadsheetId, range, token);
  const idx = currentHeaderIdx;
  let rowIndex = -1;
  for (let i=1;i<rows.length;i++){ if ((rows[i][idx.id]||'')===id){ rowIndex = i; break; } }
  if (rowIndex<0) throw new Error('row not found');
  rows[rowIndex][idx.title] = title;
  rows[rowIndex][idx.body]  = body;
  const startCol = 0; const endCol = Math.max(rows[rowIndex].length-1, LOCIMYU_HEADERS.length-1);
  const a1 = "'"+sheetTitle+"'!"+colA1(startCol)+String(rowIndex+1)+":"+colA1(endCol)+String(rowIndex+1);
  await putValues(currentSpreadsheetId, a1, [rows[rowIndex]], token);
}
async function updateImageForPin(id, imageFileId){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) throw new Error('no sheet');
  const sheetTitle=currentSheetTitle||'シート1';
  await ensureHeadersAndIndex(sheetTitle, token);
  const range = "'"+sheetTitle+"'!A1:Z10000";
  const rows = await getValues(currentSpreadsheetId, range, token);
  const idx = currentHeaderIdx;
  let rowIndex = -1;
  for (let i=1;i<rows.length;i++){ if ((rows[i][idx.id]||'')===id){ rowIndex = i; break; } }
  if (rowIndex<0) throw new Error('row not found');
  rows[rowIndex][idx.imagefileid] = imageFileId || '';
  const startCol = 0; const endCol = Math.max(rows[rowIndex].length-1, LOCIMYU_HEADERS.length-1);
  const a1 = "'"+sheetTitle+"'!"+colA1(startCol)+String(rowIndex+1)+":"+colA1(endCol)+String(rowIndex+1);
  await putValues(currentSpreadsheetId, a1, [rows[rowIndex]], token);
}

/* ------------------------------ Export small API (for tests) -------- */
window.__lm_debug = {
  extractDriveId, __lm_markListSelected, __lm_fillFormFromCaption, __lm_selectPin,
  updateCaptionForPin, updateImageForPin, listImagesForGlb
};

console.log('[LociMyu ESM/CDN] boot overlay-edit+fixed-zoom build loaded');