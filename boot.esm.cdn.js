// boot.esm.cdn.js — Drive GLB + Sheets + Pins + Filters + Images
import { ensureViewer, onCanvasShiftPick, addPinMarker, clearPins, setPinSelected, onPinSelect, loadGlbFromDrive } from './viewer.module.cdn.js';
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

// ---------- Pins: selection/placement ----------
onPinSelect((id) => { selectedPinId = id; setPinSelected(id, true); });

onCanvasShiftPick(async (pt) => {
  const title = $('caption-title')?.value || '';
  const body = $('caption-body')?.value || '';
  const imageFileId = selectedImage?.id || '';
  const id = uid();
  await savePinToSheet({ id, title, body, color: currentPinColor, x: pt.x, y: pt.y, z: pt.z, imageFileId });
  addPinMarker({ id, x: pt.x, y: pt.y, z: pt.z, color: currentPinColor });
  const row = await enrichRow({ id, title, body, color: currentPinColor, imageFileId });
  appendCaptionItem(row);
  selectedPinId = id; setPinSelected(id, true);
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
  if (!token || !fileId) { $('images-status').textContent='Sign in & load a GLB first.'; return; }
  $('images-status').textContent = 'Loading images…';
  const grid = $('images-grid'); grid.innerHTML='';
  try{
    const files = await listImagesForGlb(fileId, token);
    $('images-status').textContent = `${files.length} image(s) found in the GLB folder`;
    for (const f of files){
      try{
        const url = await getFileThumbUrl(f.id, token);
        const btn = document.createElement('button');
        btn.className='thumb'; btn.style.backgroundImage=`url(${url})`; btn.title=f.name; btn.dataset.id=f.id;
        btn.addEventListener('click', async ()=>{
          grid.querySelectorAll('.thumb').forEach(x=>x.dataset.selected='false'); btn.dataset.selected='true';
          selectedImage = {id:f.id, url};
          if (selectedPinId){ // 画像を選択中のピンに即アタッチ（リストは消さない）
            await updateImageForPin(selectedPinId, f.id);
            const target = captionDomById.get(selectedPinId);
            if (target) {
              const img = target.querySelector('img');
              if (img) img.src = url;
              else { const im = document.createElement('img'); im.src = url; target.prepend(im); }
            }
          }
        });
        grid.appendChild(btn);
      }catch(_){}
    }
  }catch(e){
    $('images-status').textContent = `Error: ${e.message}`;
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

// ---------- Caption list (no full reload on attach) ----------
function clearCaptionList(){ const host=$('caption-list'); host && (host.innerHTML=''); captionDomById.clear(); }
function appendCaptionItem({id,title,body,color,imageUrl}){
  const host=$('caption-list'); const div=document.createElement('div'); div.className='caption-item'; div.dataset.id=id;
  div.innerHTML = `${imageUrl?`<img src="${imageUrl}" alt="">`:''}<div><div style="font-weight:600">${title||''}</div><div class="hint" style="white-space:pre-wrap">${body||''}</div></div>`;
  div.addEventListener('click', ()=>{ selectedPinId=id; setPinSelected(id, true); });
  host.appendChild(div); captionDomById.set(id, div);
}
async function enrichRow(row){
  const token=getAccessToken(); let imageUrl=''; if(row.imageFileId) try{ imageUrl=await getFileThumbUrl(row.imageFileId, token);}catch(_){}
  return { ...row, imageUrl };
}

// ---------- Save / Load captions ----------
async function savePinToSheet({ id, title, body, color, x, y, z, imageFileId }){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range=`'${sheetTitle}'!A:Z`;
  // ensure header
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
}

async function loadCaptionsFromSheet(){
  clearCaptionList(); clearPins(); await ensureIndex();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  try {
    const values=await getValues(currentSpreadsheetId, `'${currentSheetTitle}'!A1:Z9999`, token); if(!values.length) return;
    const headers=values[0].map(v=>(v||'').toString().trim().toLowerCase()); const idx=(n)=>headers.indexOf(n);
    const iId=idx('id'), iTitle=idx('title'), iBody=idx('body'), iColor=idx('color'), iX=idx('x'), iY=idx('y'), iZ=idx('z'), iImg=idx('imagefileid');
    for (let r=1; r<values.length; r++){ const row=values[r]; if(!row) continue;
      const data = { id: row[iId]||uid(), title: row[iTitle]||'', body: row[iBody]||'', color: row[iColor]||COLORS[0], x: Number(row[iX]||0), y: Number(row[iY]||0), z: Number(row[iZ]||0), imageFileId: row[iImg]||'' };
      addPinMarker({ id: data.id, x: data.x, y: data.y, z: data.z, color: data.color });
      appendCaptionItem(await enrichRow(data));
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
  appendCaptionItem(await enrichRow(row));
  selectedPinId = id; setPinSelected(id, true);
  if ($('caption-title')) $('caption-title').value=''; if ($('caption-body')) $('caption-body').value='';
});
$('pin-clear')?.addEventListener('click', ()=>{ if ($('caption-title')) $('caption-title').value=''; if ($('caption-body')) $('caption-body').value=''; });

console.log('[LociMyu ESM/CDN] boot complete');
