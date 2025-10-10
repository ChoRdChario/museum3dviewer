// boot.esm.cdn.js — GLB + Sheets + Pins + Filters + Images + CaptionOverlay
import { ensureViewer, onCanvasShiftPick, addPinMarker, clearPins, setPinSelected, onPinSelect, loadGlbFromDrive, onRenderTick, projectPoint } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- Viewer ----------
ensureViewer({ canvas: $('gl') });

// ---------- Auth ----------
const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
btnAuth && setupAuth(btnAuth, signedSwitch);

// ---------- Utils ----------
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

// ---------- State ----------
let lastGlbFileId = null;
let currentSpreadsheetId = null;
let currentSheetId = null;
let currentSheetTitle = null;
let currentPinColor = '#ff6b6b';
let selectedPinId = null;
let selectedImage = null;
let captionsIndex = new Map(); // id -> {rowIndex}
const captionDomById = new Map();
const rowCache = new Map(); // id -> {id,title,body,color,x,y,z,imageFileId,imageUrl}

// ---------- Caption Overlay (draggable + tether) ----------
const overlayHost = document.body;
const overlays = new Map(); // id -> {root,imgEl}
function removeCaptionOverlay(id){ const o=overlays.get(id); if(!o) return; o.root.remove(); overlays.delete(id); }
function createCaptionOverlay(id, data){
  removeCaptionOverlay(id);
  const root = document.createElement('div');
  root.className = 'cap-overlay';
  root.innerHTML = `
    <button class="cap-close" title="Close">×</button>
    <div class="cap-title"></div>
    <div class="cap-body"></div>
    <img class="cap-img" alt="" />
    <svg class="cap-line" width="0" height="0"><line x1="0" y1="0" x2="0" y2="0"/></svg>
  `;
  overlayHost.appendChild(root);
  const safeTitle = (data.title||'').trim() || '(untitled)';
  const safeBody  = (data.body ||'').trim() || '(no description)';
  root.querySelector('.cap-title').textContent = safeTitle;
  root.querySelector('.cap-body').textContent  = safeBody;
  const imgEl = root.querySelector('.cap-img');
  if (data.imageUrl){ imgEl.src = data.imageUrl; imgEl.style.display='block'; } else { imgEl.style.display='none'; }
  root.querySelector('.cap-close').addEventListener('click', ()=> removeCaptionOverlay(id));
  // drag
  let dragging=false, sx=0, sy=0, left=0, top=0;
  const onDown = (e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; const r=root.getBoundingClientRect(); left=r.left; top=r.top; e.preventDefault(); };
  const onMove = (e)=>{ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy; root.style.left=(left+dx)+'px'; root.style.top=(top+dy)+'px'; };
  const onUp = ()=> dragging=false;
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
    o.root.style.left = (p.x + 16) + 'px';
    o.root.style.top  = (p.y + 16) + 'px';
  }
  const r = o.root.getBoundingClientRect();
  const svg = o.root.querySelector('.cap-line'); const line = svg.querySelector('line');
  const x1 = 0, y1 = r.height; // box 左下
  const x2 = p.x - r.left, y2 = p.y - r.top;
  svg.setAttribute('width', String(Math.max(x1,x2)+2));
  svg.setAttribute('height', String(Math.max(y1,y2)+2));
  line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
}
onRenderTick(()=>{ overlays.forEach((_, id)=> updateOverlayPosition(id)); });
function showOverlayFor(id){
  const d = rowCache.get(id); if(!d) return;
  createCaptionOverlay(id, d);
  setPinSelected(id, true);
}

// ---------- Pins: selection/placement ----------
onPinSelect((id) => { selectedPinId = id; showOverlayFor(id); });

onCanvasShiftPick(async (pt) => {
  const title = $('caption-title')?.value || '';
  const body = $('caption-body')?.value || '';
  const imageFileId = selectedImage?.id || '';
  const id = uid();
  const row = { id, title, body, color: currentPinColor, x: pt.x, y: pt.y, z: pt.z, imageFileId };
  await savePinToSheet(row);
  addPinMarker({ id, x: pt.x, y: pt.y, z: pt.z, color: currentPinColor });
  const enriched = await enrichRow(row);
  appendCaptionItem(enriched);
  selectedPinId = id; setPinSelected(id, true);
  showOverlayFor(id);
  const ti = $('caption-title'); if (ti) ti.focus();
});

// ---------- GLB load (Drive fileId) ----------
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
    await refreshImagesGrid(); // ← GLB読込直後に自動実行
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

// ---------- Pin colors & filters ----------
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

// ---------- Drive helpers ----------
async function getParentFolderId(fileId, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`, { headers:{Authorization:`Bearer ${token}`} });
  if (!res.ok) throw new Error(`Drive meta failed: ${res.status}`);
  const meta = await res.json(); return (Array.isArray(meta.parents)&&meta.parents[0])||null;
}
async function listImagesForGlb(fileId, token) {
  const parent = await getParentFolderId(fileId, token); if(!parent) return [];
  const q = encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/') and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&pageSize=200&supportsAllDrives=true`;
  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}`} }); if(!r.ok) throw new Error(`Drive list failed: ${r.status}`);
  const d = await r.json(); return d.files||[];
}
async function getFileThumbUrl(fileId, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`, { headers:{Authorization:`Bearer ${token}` } });
  if (!r.ok) throw new Error(`thumb meta ${r.status}`);
  const j = await r.json(); if (!j.thumbnailLink) throw new Error('no thumbnailLink');
  const sep = j.thumbnailLink.includes('?') ? '&' : '?';
  return `${j.thumbnailLink}${sep}access_token=${encodeURIComponent(token)}`;
}

// ---------- Images grid ----------
$('btnRefreshImages')?.addEventListener('click', refreshImagesGrid);
async function refreshImagesGrid(){
  const token = getAccessToken();
  const fileId = lastGlbFileId || extractDriveId($('glbUrl')?.value||'');
  if (!token || !fileId) { const s=$('images-status'); if(s) s.textContent='Sign in & load a GLB first.'; return; }
  const s=$('images-status'); if(s) s.textContent = 'Loading images…';
  const grid = $('images-grid'); if(grid) grid.innerHTML='';
  try{
    const files = await listImagesForGlb(fileId, token);
    if (s) s.textContent = `${files.length} image(s) found in the GLB folder`;
    for (const f of files){
      try{
        const url = await getFileThumbUrl(f.id, token);
        const btn = document.createElement('button');
        btn.className='thumb'; btn.style.backgroundImage=`url(${url})`; btn.title=f.name; btn.dataset.id=f.id;
        btn.addEventListener('click', async ()=>{
          grid?.querySelectorAll('.thumb').forEach(x=>x.dataset.selected='false'); btn.dataset.selected='true';
          selectedImage = {id:f.id, url};
          if (selectedPinId){ // 画像を選択中のピンに即アタッチ（リストは消さない）
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
  }catch(e){
    if (s) s.textContent = `Error: ${e.message}`;
  }
}

// ---------- Sheets helpers ----------
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

async function isLociMyuSpreadsheet(spreadsheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  const res = await fetch(url, { headers:{Authorization:`Bearer ${token}`} });
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
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`, { headers:{Authorization:`Bearer ${token}`} });
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

// ---------- Caption list (placeholders + selection) ----------
function clearCaptionList(){ const host=$('caption-list'); host && (host.innerHTML=''); captionDomById.clear(); }
function appendCaptionItem({id,title,body,color,imageUrl,x,y,z}){
  const host=$('caption-list'); const div=document.createElement('div'); div.className='caption-item'; div.dataset.id=id;
  const safeTitle = (title||'').trim() || '(untitled)';
  const safeBody  = (body ||'').trim() || '(no description)';
  div.innerHTML = `${imageUrl?`<img src="${imageUrl}" alt="">`:''}<div><div class="c-title" style="font-weight:600">${safeTitle}</div><div class="c-body hint" style="white-space:pre-wrap">${safeBody}</div></div>`;
  div.addEventListener('click', ()=>{ selectedPinId=id; showOverlayFor(id); });
  host?.appendChild(div); captionDomById.set(id, div);
  div.scrollIntoView({block:'nearest'});
}
async function enrichRow(row){
  const token=getAccessToken(); let imageUrl=''; if(row.imageFileId) try{ imageUrl=await getFileThumbUrl(row.imageFileId, token);}catch(_){}
  const enriched = { ...row, imageUrl };
  rowCache.set(row.id, enriched);
  return enriched;
}

// ---------- Save / Load captions ----------
async function savePinToSheet({ id, title, body, color, x, y, z, imageFileId }){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range=`'${sheetTitle}'!A:Z`;
  try { const existed=await getValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, token); const headers=existed[0]||[]; const lower=headers.map(h=>(h||'').toString().trim().toLowerCase()); const ok=REQUIRED_MIN_HEADERS.size===new Set(lower.filter(h=>REQUIRED_MIN_HEADERS.has(h))).size; if(!ok) await putValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, [LOCIMYU_HEADERS], token); } catch(_){}
  await appendValues(currentSpreadsheetId, range, [[id,title,body,color,x,y,z,imageFileId]], token);
}
async function ensureIndex(){
  captionsIndex.clear();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const values=await getValues(currentSpreadsheetId, `'${currentSheetTitle}'!A1:Z9999`, token); if(!values.length) return;
  const headers=values[0].map(v=>(v||'').toString().trim().toLowerCase());
  const iId=headers.indexOf('id');
  for (let r=1; r<values.length; r++){ const row=values[r]; const id=row?.[iId]; if(!id) continue; captionsIndex.set(id, { rowIndex:r+1 }); }
}
async function updateImageForPin(id, imageFileId){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if (!captionsIndex.size) await ensureIndex();
  const hit=captionsIndex.get(id); if(!hit) return;
  const a1 = `'${currentSheetTitle||'シート1'}'!H${hit.rowIndex}`;
  await putValues(currentSpreadsheetId, a1, [[imageFileId]], token);
  const cached = rowCache.get(id); if (cached){ cached.imageFileId = imageFileId; }
}

async function loadCaptionsFromSheet(){
  clearCaptionList(); clearPins(); rowCache.clear(); await ensureIndex();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  try {
    const values=await getValues(currentSpreadsheetId, `'${currentSheetTitle}'!A1:Z9999`, token); if(!values.length) return;
    const headers=values[0].map(v=>(v||'').toString().trim().toLowerCase()); const idx=(n)=>headers.indexOf(n);
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

// ---------- Buttons ----------
$('pin-add')?.addEventListener('click', async ()=>{
  const id=uid();
  const row = { id, title: $('caption-title')?.value||'', body: $('caption-body')?.value||'', color: currentPinColor, x:0, y:0, z:0, imageFileId: selectedImage?.id||'' };
  await savePinToSheet(row);
  addPinMarker({ id, x:0, y:0, z:0, color: currentPinColor });
  const enriched = await enrichRow(row);
  appendCaptionItem(enriched);
  selectedPinId = id; setPinSelected(id, true);
  showOverlayFor(id);
  const ti = $('caption-title'); if (ti) ti.focus();
});
$('pin-clear')?.addEventListener('click', ()=>{ if ($('caption-title')) $('caption-title').value=''; if ($('caption-body')) $('caption-body').value=''; });

console.log('[LociMyu ESM/CDN] boot complete');
