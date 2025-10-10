// boot.esm.cdn.js — ESM/CDN runtime: GLB + Sheets + Image grid + Pins + Caption overlay
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, clearPins,
  setPinSelected, onPinSelect, loadGlbFromDrive, onRenderTick,
  projectPoint, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

// --- client id fallback (inline) ---
const __LM_CLIENT_ID = (window.GIS_CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
const __LM_API_KEY   = (window.GIS_API_KEY   || 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI');
const __LM_SCOPES    = (window.GIS_SCOPES    || [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' '));


const $  = (id) => document.getElementById(id);
const $$ = (sel,root=document) => Array.from(root.querySelectorAll(sel));
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

ensureViewer({ canvas: $('gl') });

const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
setupAuth($('auth-signin'), signedSwitch, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });

const extractDriveId = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  try {
    const u = new URL(s);
    const q = u.searchParams.get('id');
    if (q && /[-\w]{25,}/.test(q)) return q;
    const seg = u.pathname.split('/').filter(Boolean);
    const dIdx = seg.indexOf('d');
    if (dIdx !== -1 && seg[dIdx + 1] && /[-\w]{25,}/.test(seg[dIdx + 1])) return seg[dIdx + 1];
  } catch (_) {}
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : null;
};

let lastGlbFileId = null;
let currentSpreadsheetId = null;
let currentSheetId = null;
let currentSheetTitle = null;
let currentHeaders = [];
let currentHeaderIdx = {};
let currentPinColor = '#ff6b6b';
let selectedPinId = null;
let selectedImage = null;
let captionsIndex = new Map();
const captionDomById = new Map();
const rowCache = new Map();

const overlays = new Map();
function removeCaptionOverlay(id){ const o=overlays.get(id); if(!o) return; o.root.remove(); overlays.delete(id); }
function createCaptionOverlay(id, data){
  removeCaptionOverlay(id);
  const root = document.createElement('div');
  root.className = 'cap-overlay';
  Object.assign(root.style, {
    position:'fixed', zIndex:'1000', background:'#0b0f14ef', color:'#e5e7eb',
    padding:'10px 12px', borderRadius:'10px', boxShadow:'0 8px 24px #000a',
    minWidth:'180px', maxWidth:'260px'
  });
  root.innerHTML = `
    <div style="display:flex; gap:6px; justify-content:flex-end; margin-bottom:4px;">
      <button class="cap-edit" title="Edit" style="border:none;background:#0000;color:#ddd;cursor:pointer">✎</button>
      <button class="cap-del"  title="Delete" style="border:none;background:#0000;color:#ddd;cursor:pointer">🗑</button>
      <button class="cap-close" title="Close" style="border:none;background:#0000;color:#ddd;cursor:pointer">×</button>
    </div>
    <div class="cap-title" style="font-weight:700; margin-bottom:6px;"></div>
    <div class="cap-body"  style="font-size:12px; opacity:.95; white-space:pre-wrap; margin-bottom:6px;"></div>
    <img class="cap-img" alt="" style="display:none; width:100%; border-radius:8px; margin-bottom:2px" />
    <svg class="cap-line" width="0" height="0" style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none">
      <line x1="0" y1="0" x2="0" y2="0" style="stroke:#ffffffaa; stroke-width:2"/>
    </svg>
  `;
  document.body.appendChild(root);

  const safeTitle = (data.title||'').trim() || '(untitled)';
  const safeBody  = (data.body ||'').trim()  || '(no description)';
  root.querySelector('.cap-title').textContent = safeTitle;
  root.querySelector('.cap-body').textContent  = safeBody;
  const imgEl = root.querySelector('.cap-img');
  if (data.imageUrl){ imgEl.src = data.imageUrl; imgEl.style.display='block'; }

  root.querySelector('.cap-close').addEventListener('click', ()=> removeCaptionOverlay(id));
  root.querySelector('.cap-edit').addEventListener('click', async ()=>{
    const cur = rowCache.get(id) || {};
    const newTitle = window.prompt('Caption title', cur.title||'');
    if (newTitle===null) return;
    const newBody  = window.prompt('Caption body', cur.body||'');
    if (newBody===null) return;
    try{ await updateCaptionForPin(id, { title:newTitle, body:newBody });
      root.querySelector('.cap-title').textContent = (newTitle||'').trim() || '(untitled)';
      root.querySelector('.cap-body').textContent  = (newBody ||'').trim() || '(no description)';
    }catch(e){ console.error('[caption edit] failed', e); alert('Failed to update caption on the sheet.'); }
  });
  root.querySelector('.cap-del').addEventListener('click', async ()=>{
    if (!confirm('このキャプションを削除しますか？')) return;
    try{
      await deleteCaptionForPin(id);
      removePinMarker(id);
      captionDomById.get(id)?.remove();
      captionDomById.delete(id); rowCache.delete(id);
      removeCaptionOverlay(id); selectedPinId = null;
    }catch(e){ console.error('[caption delete] failed', e); alert('Failed to delete caption row.'); }
  });

  let dragging=false, sx=0, sy=0, left=0, top=0;
  const onDown = (e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; const r=root.getBoundingClientRect(); left=r.left; top=r.top; e.preventDefault(); };
  const onMove = (e)=>{ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy; root.style.left=(left+dx)+'px'; root.style.top=(top+dy)+'px'; updateOverlayPosition(id); };
  const onUp   = ()=> dragging=false;
  root.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  overlays.set(id, { root, imgEl });
  updateOverlayPosition(id, true);
}
function updateOverlayPosition(id, initial=false){
  const o = overlays.get(id); if(!o) return;
  const d = rowCache.get(id); if(!d) return;
  const p = projectPoint(d.x, d.y, d.z);
  if (!p.visible){ o.root.style.display='none'; return; }
  o.root.style.display='block';
  if (initial && !o.root.style.left){
    o.root.style.left = (p.x + 14) + 'px';
    o.root.style.top  = (p.y + 14) + 'px';
  }
  const r = o.root.getBoundingClientRect();
  const svg = o.root.querySelector('.cap-line'); const line = svg.querySelector('line');
  const x1 = 0, y1 = r.height;
  const x2 = p.x - r.left, y2 = p.y - r.top;
  svg.setAttribute('width',  String(Math.max(x1,x2)+2));
  svg.setAttribute('height', String(Math.max(y1,y2)+2));
  line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
}
onRenderTick(()=>{ overlays.forEach((_, id)=> updateOverlayPosition(id)); });
function showOverlayFor(id){ const d=rowCache.get(id); if(!d) return; createCaptionOverlay(id, d); setPinSelected(id, true); }

onPinSelect((id) => { selectedPinId = id; showOverlayFor(id); });
onCanvasShiftPick(async (pt) => {
  const title = $('caption-title')?.value || '';
  const body  = $('caption-body')?.value  || '';
  const imageFileId = selectedImage?.id || '';
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

async function doLoad(){
  const token = getAccessToken();
  const fileId = extractDriveId($('glbUrl')?.value||'');
  if (!token || !fileId) { console.warn('[GLB] missing token or fileId'); return; }
  try {
    $('btnGlb').disabled = true;
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
    $('btnGlb').disabled = false;
  }
}
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown', (e)=> e.key==='Enter' && doLoad());
$('glbUrl')?.addEventListener('input', ()=>{ $('btnGlb').disabled = !extractDriveId($('glbUrl')?.value||''); });
$('glbUrl')?.dispatchEvent(new Event('input'));

const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#94a3b8'];
const pinColorsHost = $('pin-colors');
if (pinColorsHost) {
  pinColorsHost.innerHTML = COLORS.map(c => `<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('');
  const select = (el) => { pinColorsHost.querySelectorAll('.chip').forEach(x => (x.style.outline = '')); el.style.outline = '2px solid #fff4'; currentPinColor = el.dataset.color; };
  pinColorsHost.addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; select(b); });
  const first = pinColorsHost.querySelector('.chip'); first && select(first);
}
const selectedColors = new Set(COLORS);
const pinFilterHost = $('pin-filter');
if (pinFilterHost) {
  pinFilterHost.innerHTML = COLORS.map(c => (`<label class="filter-chip"><input type="checkbox" data-color="${c}" checked /><span class="chip" style="background:${c}"></span></label>`)).join('');
  pinFilterHost.addEventListener('change', (e)=>{
    const cb = e.target.closest('input[type=checkbox][data-color]'); if(!cb) return;
    const c = cb.dataset.color; cb.checked ? selectedColors.add(c) : selectedColors.delete(c);
    document.dispatchEvent(new CustomEvent('pinFilterChange',{detail:{selected:[...selectedColors]}}));
  });
}

async function getParentFolderId(fileId, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`, { headers:{Authorization:`Bearer ${token}`} });
  if (!res.ok) throw new Error(`Drive meta failed: ${res.status}`);
  const meta = await res.json(); return (Array.isArray(meta.parents)&&meta.parents[0])||null;
}
async function listImagesForGlb(fileId, token) {
  const parent = await getParentFolderId(fileId, token); if(!parent) return [];
  const q = encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/') and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&pageSize=200&supportsAllDrives=true`;
  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}` } }); if(!r.ok) throw new Error(`Drive list failed: ${r.status}`);
  const d = await r.json(); return d.files||[];
}
async function getFileThumbUrl(fileId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`, { headers:{Authorization:`Bearer ${token}` } });
  if (!r.ok) throw new Error(`thumb meta ${r.status}`);
  const j = await r.json(); if (!j.thumbnailLink) throw new Error('no thumbnailLink');
  const sep = j.thumbnailLink.includes('?') ? '&' : '?';
  return `${j.thumbnailLink}${sep}access_token=${encodeURIComponent(token)}`;
}

$('btnRefreshImages')?.addEventListener('click', refreshImagesGrid);
async function refreshImagesGrid(){
  const token = getAccessToken();
  const fileId = lastGlbFileId || extractDriveId($('glbUrl')?.value||'');
  const s=$('images-status'); const grid = $('images-grid'); if (grid) grid.innerHTML='';
  if (!token || !fileId) { if(s) s.textContent='Sign in & load a GLB first.'; return; }
  if (s) s.textContent = 'Loading images…';
  try{
    const files = await listImagesForGlb(fileId, token);
    if (s) s.textContent = `${files.length} image(s) found in the GLB folder`;
    for (const f of files){
      try{
        const url = await getFileThumbUrl(f.id, token);
        const btn = document.createElement('button');
        btn.className='thumb'; btn.style.backgroundImage='url('+url+')'; btn.title=f.name; btn.dataset.id=f.id;
        btn.addEventListener('click', async ()=>{
          $('images-grid')?.querySelectorAll('.thumb').forEach(x=>x.dataset.selected='false'); btn.dataset.selected='true';
          selectedImage = {id:f.id, url};
          if (selectedPinId){
            await updateImageForPin(selectedPinId, f.id);
            const target = captionDomById.get(selectedPinId);
            if (target) {
              const img = target.querySelector('img');
              if (img) img.src = url;
              else { const im = document.createElement('img'); im.src = url; target.prepend(im); }
            }
            const ov = overlays.get(selectedPinId);
            if (ov){ ov.imgEl.src = url; ov.imgEl.style.display='block'; }
          }
        });
        grid?.appendChild(btn);
      }catch(_){}
    }
  }catch(e){ if (s) s.textContent = 'Error: '+e.message; }
}

const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId'];
const REQUIRED_MIN_HEADERS = new Set(['title','body','color']);

async function putValues(spreadsheetId, rangeA1, values, token) {
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`, { method:'PUT', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({ values }) });
}
async function appendValues(spreadsheetId, rangeA1, values, token) {
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({ values }) });
}
async function getValues(spreadsheetId, rangeA1, token) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`, { headers:{Authorization:`Bearer ${token}`} });
  if (!r.ok) throw new Error(`values.get ${r.status}`); const d = await r.json(); return d.values||[];
}
const colA1 = (i0)=>{ let n = i0 + 1, s = ''; while(n){ n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n/26); } return s; };

async function isLociMyuSpreadsheet(spreadsheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  const res = await fetch(url, { headers:{Authorization:`Bearer ${token}`]});
  if (!res.ok) return false;
  const data = await res.json(); if (!Array.isArray(data.sheets)) return false;
  for (const s of data.sheets) {
    const row = s.data?.[0]?.rowData?.[0]?.values || [];
    const headers = row.map(v => (v?.formattedValue || '').toString().trim().toLowerCase()).filter(Boolean);
    const set = new Set(headers);
    let ok = true; for (const h of REQUIRED_MIN_HEADERS) if (!set.has(h)) ok = false;
    if (ok) return true;
  }
  return false;
}
async function createLociMyuSpreadsheet(parentFolderId, token, { glbId }={}) {
  const name = `LociMyu_Save_${glbId || ''}`.replace(/_+$/,'');
  const r = await fetch('https://www.googleapis.com/drive/v3/files', { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({ name, mimeType:'application/vnd.google-apps.spreadsheet', parents: parentFolderId?[parentFolderId]:undefined }) });
  if (!r.ok) throw new Error(`Drive files.create failed: ${r.status}`);
  const file = await r.json(); const spreadsheetId = file.id;
  await putValues(spreadsheetId, 'A1:Z1', [LOCIMYU_HEADERS], token);
  return spreadsheetId;
}
async function findOrCreateLociMyuSpreadsheet(parentFolderId, token, { glbId }={}) {
  if (!parentFolderId) throw new Error('parentFolderId required');
  const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true`;
  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}`} }); if(!r.ok) throw new Error(`Drive list spreadsheets failed: ${r.status}`);
  const d = await r.json(); const files = d.files||[];
  for (const f of files) { if (await isLociMyuSpreadsheet(f.id, token)) return f.id; }
  return await createLociMyuSpreadsheet(parentFolderId, token, { glbId });
}
async function populateSheetTabs(spreadsheetId, token) {
  const sel = $('save-target-sheet'); if (!sel || !spreadsheetId) return;
  sel.innerHTML = `<option value="">Loading…</option>`;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`, { headers:{Authorization:`Bearer ${token}` } });
  if (!r.ok) { sel.innerHTML = `<option value="">(error)</option>`; return; }
  const data = await r.json();
  const sheets = (data.sheets||[]).map(s=>s.properties).sort((a,b)=>a.index-b.index);
  sel.innerHTML = sheets.map(p=>`<option value="${p.sheetId}" data-title="${p.title}">${p.title}</option>`).join('');
  const first = sheets[0]; currentSheetId = first?.sheetId||null; currentSheetTitle = first?.title||null;
  if (currentSheetId) sel.value = String(currentSheetId);
}
$('save-target-sheet')?.addEventListener('change', (e)=>{ const opt=e.target.selectedOptions[0]; currentSheetId = opt?.value?Number(opt.value):null; currentSheetTitle=opt?.dataset?.title||null; loadCaptionsFromSheet(); });
$('save-target-create')?.addEventListener('click', async ()=>{
  const token = getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify({ requests:[{ addSheet:{ properties:{ title } } }] }) });
  if (!r.ok){ console.error('[Sheets addSheet] failed', r.status, await r.text().catch(()=>'')); return; }
  await populateSheetTabs(currentSpreadsheetId, token); await loadCaptionsFromSheet();
});

function clearCaptionList(){ const host=$('caption-list'); if (host) host.innerHTML=''; captionDomById.clear(); }
function appendCaptionItem({id,title,body,color,imageUrl}){
  const host=$('caption-list'); if (!host) return;
  const div=document.createElement('div'); div.className='caption-item'; div.dataset.id=id;
  const safeTitle=(title||'').trim()||'(untitled)'; const safeBody=(body||'').trim()||'(no description)';
  const imgHtml = imageUrl ? ('<img src="'+imageUrl+'" alt="">') : '';
  div.innerHTML = imgHtml + `
    <div class="cap-txt">
      <div class="c-title">${safeTitle}</div>
      <div class="c-body hint">${safeBody}</div>
    </div>
    <button class="c-del" title="Delete">🗑</button>`;
  div.addEventListener('click', (e)=>{
    if (e.target.closest('.c-del')) return;
    selectedPinId=id; showOverlayFor(id);
  });
  div.querySelector('.c-del').addEventListener('click', async (e)=>{
    e.stopPropagation();
    if (!confirm('このキャプションを削除しますか？')) return;
    try{
      await deleteCaptionForPin(id);
      removePinMarker(id);
      div.remove(); captionDomById.delete(id); rowCache.delete(id);
      removeCaptionOverlay(id);
    }catch(err){ console.error('delete failed', err); alert('Delete failed'); }
  });
  host.appendChild(div); captionDomById.set(id, div);
  div.scrollIntoView({block:'nearest'});
}
async function enrichRow(row){
  const token=getAccessToken(); let imageUrl=''; if(row.imageFileId) try{ imageUrl=await getFileThumbUrl(row.imageFileId, token);}catch(_){}
  const enriched = { ...row, imageUrl }; rowCache.set(row.id, enriched); return enriched;
}

async function savePinToSheet({ id, title, body, color, x, y, z, imageFileId }){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range=`'${sheetTitle}'!A:Z`;
  try {
    const existed=await getValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, token);
    currentHeaders = (existed[0]||[]).map(h=>(h||'').toString().trim());
    currentHeaderIdx = Object.fromEntries(currentHeaders.map((h,i)=>[h.toLowerCase(), i]));
    const lower=currentHeaders.map(h=>h.toLowerCase());
    const ok=[...REQUIRED_MIN_HEADERS].every(h=>lower.includes(h));
    if(!ok) await putValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, [LOCIMYU_HEADERS], token);
  } catch(_){}
  await appendValues(currentSpreadsheetId, range, [[id,title,body,color,x,y,z,imageFileId]], token);
}
async function ensureIndex(){
  captionsIndex.clear();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const values=await getValues(currentSpreadsheetId, `'${currentSheetTitle}'!A1:Z9999`, token); if(!values.length) return;
  currentHeaders = values[0].map(v=>(v||'').toString().trim());
  currentHeaderIdx = Object.fromEntries(currentHeaders.map((h,i)=>[h.toLowerCase(), i]));
  const iId=currentHeaderIdx['id'] ?? -1;
  for (let r=1; r<values.length; r++){ const row=values[r]; const id=row?.[iId]; if(!id) continue; captionsIndex.set(id, { rowIndex:r+1 }); }
}
async function updateImageForPin(id, imageFileId){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if (!captionsIndex.size) await ensureIndex();
  const hit=captionsIndex.get(id); if(!hit) return;
  const ci = (currentHeaderIdx['imagefileid'] ?? 7);
  const a1 = `'${currentSheetTitle||'シート1'}'!${colA1(ci)}${hit.rowIndex}`;
  await putValues(currentSpreadsheetId, a1, [[imageFileId]], token);
  const cached = rowCache.get(id); if (cached){ cached.imageFileId = imageFileId; }
}
async function updateCaptionForPin(id, { title, body, color }){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if (!captionsIndex.size) await ensureIndex();
  const hit=captionsIndex.get(id); if(!hit) throw new Error('row not found');
  const updates = [];
  const st = currentSheetTitle || 'シート1';
  const colA = (name)=> colA1( currentHeaderIdx[name] ?? -1 );
  if (typeof title === 'string' && currentHeaderIdx['title']!=null) updates.push(putValues(currentSpreadsheetId, `'${st}'!${colA('title')}${hit.rowIndex}`, [[title]], token));
  if (typeof body  === 'string' && currentHeaderIdx['body'] !=null) updates.push(putValues(currentSpreadsheetId, `'${st}'!${colA('body')}${hit.rowIndex}`,  [[body]],  token));
  if (typeof color === 'string' && currentHeaderIdx['color']!=null) updates.push(putValues(currentSpreadsheetId, `'${st}'!${colA('color')}${hit.rowIndex}`, [[color]], token));
  await Promise.all(updates);
  const cached = rowCache.get(id) || {};
  if (typeof title === 'string') cached.title = title;
  if (typeof body  === 'string') cached.body  = body;
  if (typeof color === 'string') cached.color = color;
  rowCache.set(id, cached);
  const dom = captionDomById.get(id);
  if (dom){
    const t = dom.querySelector('.c-title'); if (t) t.textContent = (cached.title||'').trim() || '(untitled)';
    const b = dom.querySelector('.c-body');  if (b) b.textContent = (cached.body ||'').trim() || '(no description)';
  }
}
async function deleteCaptionForPin(id){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetId) return;
  if (!captionsIndex.size) await ensureIndex();
  const hit=captionsIndex.get(id); if(!hit) throw new Error('row not found');
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`, {
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: currentSheetId, dimension: 'ROWS', startIndex: hit.rowIndex-1, endIndex: hit.rowIndex } } }] })
  });
  if (!r.ok) throw new Error(`delete row ${r.status}`);
  captionsIndex.delete(id);
}

async function loadCaptionsFromSheet(){
  clearCaptionList(); clearPins(); rowCache.clear(); overlays.forEach((_,id)=>removeCaptionOverlay(id)); overlays.clear();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  try {
    const values=await getValues(currentSpreadsheetId, `'${currentSheetTitle}'!A1:Z9999`, token); if(!values.length) return;
    currentHeaders = values[0].map(v=>(v||'').toString().trim());
    currentHeaderIdx = Object.fromEntries(currentHeaders.map((h,i)=>[h.toLowerCase(), i]));
    const idx=(n)=>currentHeaderIdx[n] ?? -1;
    const iId=idx('id'), iTitle=idx('title'), iBody=idx('body'), iColor=idx('color'), iX=idx('x'), iY=idx('y'), iZ=idx('z'), iImg=idx('imagefileid');
    for (let r=1; r<values.length; r++){ const row=values[r]; if(!row) continue;
      const data = { id: (row[iId]||uid()), title: row[iTitle]||'', body: row[iBody]||'', color: row[iColor]||'#ff6b6b', x: Number(row[iX]||0), y: Number(row[iY]||0), z: Number(row[iZ]||0), imageFileId: row[iImg]||'' };
      addPinMarker({ id: data.id, x: data.x, y: data.y, z: data.z, color: data.color });
      const enriched = await enrichRow(data);
      appendCaptionItem(enriched);
    }
    await ensureIndex();
  } catch(e){ console.warn('[loadCaptionsFromSheet] failed', e); }
}

$('btnGlb')?.addEventListener('click', ()=> (selectedPinId=null));
$('pin-add')?.addEventListener('click', async ()=>{
  const id=uid();
  const row = { id, title: $('caption-title')?.value||'', body: $('caption-body')?.value||'', color: currentPinColor, x:0, y:0, z:0, imageFileId: selectedImage?.id||'' };
  await savePinToSheet(row);
  addPinMarker({ id, x:0, y:0, z:0, color: currentPinColor });
  const enriched = await enrichRow(row);
  appendCaptionItem(enriched);
  selectedPinId = id; setPinSelected(id, true);
  showOverlayFor(id);
  $('caption-title')?.focus();
});
$('pin-clear')?.addEventListener('click', ()=>{ const t=$('caption-title'); if(t) t.value=''; const b=$('caption-body'); if(b) b.value=''; });

console.log('[LociMyu ESM/CDN] boot complete (clientId-injected)');
