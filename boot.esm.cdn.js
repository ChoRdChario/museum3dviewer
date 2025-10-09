// boot.esm.cdn.js — pins rendered + selectable + image attach to selected pin
import { ensureViewer, onCanvasShiftPick, addPinMarker, clearPins, setPinSelected, onPinSelect } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

ensureViewer({ canvas: $('gl') });

// ---- state ----
let currentSpreadsheetId = null;
let currentSheetTitle = null;
let lastGlbFileId = null;
let currentPinColor = '#ff6b6b';
let captionsIndex = new Map(); // id -> {row,rowIndex}
let selectedPinId = null;
let selectedImage = null;

// propagate viewer pin selection -> highlight + remember
onPinSelect((id) => {
  selectedPinId = id;
  setPinSelected(id, true);
});

// shift+click to place pin (x,y,z from viewer)
onCanvasShiftPick(async (pt) => {
  const title = $('caption-title')?.value || '';
  const body = $('caption-body')?.value || '';
  const imageFileId = selectedImage?.id || '';
  const id = uid();
  const row = { id, title, body, color: currentPinColor, x: pt.x, y: pt.y, z: pt.z, imageFileId };
  await savePinRow(row);
  // UI/3D反映
  await ensureIndex(); // refresh index to know rowIndex
  addPinMarker({ id, x: pt.x, y: pt.y, z: pt.z, color: currentPinColor });
  appendCaptionItem(await enrichRow(row));
  selectedPinId = id;
  setPinSelected(id, true);
});

// ---------- Auth ----------
const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
btnAuth && setupAuth(btnAuth, signedSwitch);

// ---------- GLB load ----------
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

$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('input', () => {$('btnGlb').disabled = !extractDriveId($('glbUrl')?.value||'');});
$('glbUrl')?.dispatchEvent(new Event('input'));

async function doLoad(){
  const token = getAccessToken();
  const fileId = extractDriveId($('glbUrl')?.value||'');
  if (!token || !fileId) return;
  try {
    $('btnGlb').disabled = true;
    // GLB
    const { loadGlbFromDrive } = await import('./viewer.module.cdn.js');
    await loadGlbFromDrive(fileId, { token });
    lastGlbFileId = fileId;
    // Sheets 準備
    const parentId = await getParentFolderId(fileId, token);
    currentSpreadsheetId = await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId: fileId });
    await populateSheetTabs(currentSpreadsheetId, token);
    await loadCaptionsFromSheet(); // 3Dピンも描画される
    await refreshImagesGrid();
  } catch (e) {
    console.error('[GLB] load error', e);
  } finally {
    $('btnGlb').disabled = false;
  }
}

// ---------- UI: colors ----------
const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#94a3b8'];
const pinColorsHost = $('pin-colors');
if (pinColorsHost) {
  pinColorsHost.innerHTML = COLORS.map(c => `<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('');
  const select = (el) => { pinColorsHost.querySelectorAll('.chip').forEach(x => (x.style.outline = '')); el.style.outline = '2px solid #fff4'; currentPinColor = el.dataset.color; };
  pinColorsHost.addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; select(b); });
  const first = pinColorsHost.querySelector('.chip'); first && select(first);
}

// ---------- Images grid ----------
$('btnRefreshImages')?.addEventListener('click', refreshImagesGrid);
async function refreshImagesGrid(){
  const token = getAccessToken();
  const fileId = lastGlbFileId || extractDriveId($('glbUrl')?.value||'');
  if (!token || !fileId) return;
  $('images-status').textContent = 'Loading images…';
  const grid = $('images-grid'); grid.innerHTML=''; selectedImage=null;
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
          if (selectedPinId){ // 画像を選択中のピンに即アタッチ
            await updateImageForPin(selectedPinId, f.id);
            // UI更新：caption listのサムネを差し替え
            await loadCaptionsFromSheet();
            setPinSelected(selectedPinId, true);
          }
        });
        grid.appendChild(btn);
      }catch(_){}
    }
  }catch(e){
    $('images-status').textContent = `Error: ${e.message}`;
  }
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
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`, { headers:{Authorization:`Bearer ${token}`} });
  if (!r.ok) throw new Error(`thumb meta ${r.status}`);
  const j = await r.json(); if (!j.thumbnailLink) throw new Error('no thumbnailLink');
  const sep = j.thumbnailLink.includes('?') ? '&' : '?';
  return `${j.thumbnailLink}${sep}access_token=${encodeURIComponent(token)}`;
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

async function findOrCreateLociMyuSpreadsheet(parentFolderId, token, { glbId }={}) {
  if (!parentFolderId) throw new Error('parentFolderId required');
  const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true`;
  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}`} }); if(!r.ok) throw new Error(`Drive list spreadsheets failed: ${r.status}`);
  const d = await r.json(); const files = d.files||[];
  for (const f of files) { if (await isLociMyuSpreadsheet(f.id, token)) return f.id; }
  return await createLociMyuSpreadsheet(parentFolderId, token, { glbId });
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

// index build (id -> rowIndex)
async function ensureIndex(){
  captionsIndex.clear();
  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const values = await getValues(currentSpreadsheetId, `'${currentSheetTitle}'!A1:Z9999`, token);
  if (!values.length) return;
  const headers = values[0].map(v=>(v||'').toString().trim().toLowerCase());
  const iId = headers.indexOf('id');
  for (let r=1; r<values.length; r++){
    const row = values[r]; const id = row?.[iId]; if(!id) continue;
    captionsIndex.set(id, { row, rowIndex: r+1 }); // 1-based
  }
}

async function savePinRow({ id, title, body, color, x, y, z, imageFileId }){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range=`'${sheetTitle}'!A:Z`;
  // ensure header
  try { const existed=await getValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, token); const headers=existed[0]||[]; const lower=headers.map(h=>(h||'').toString().trim().toLowerCase()); const ok=REQUIRED_MIN_HEADERS.size===new Set(lower.filter(h=>REQUIRED_MIN_HEADERS.has(h))).size; if(!ok) await putValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, [LOCIMYU_HEADERS], token); } catch(_){}
  await appendValues(currentSpreadsheetId, range, [[id,title,body,color,x,y,z,imageFileId]], token);
}

async function updateImageForPin(id, imageFileId){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if (!captionsIndex.size) await ensureIndex();
  if (!captionsIndex.has(id)) await ensureIndex();
  const hit = captionsIndex.get(id);
  if (!hit) return;
  const a1 = `'${currentSheetTitle||'シート1'}'!H${hit.rowIndex}`; // col H = imageFileId
  await putValues(currentSpreadsheetId, a1, [[imageFileId]], token);
}

function clearCaptionList(){ const host=$('caption-list'); if(host) host.innerHTML=''; }
function appendCaptionItem({id,title,body,color,imageUrl}){
  const host=$('caption-list'); const div=document.createElement('div'); div.className='caption-item';
  div.dataset.id = id;
  div.innerHTML = `${imageUrl?`<img src="${imageUrl}" alt="">`:''}<div><div style="font-weight:600">${title||''}</div><div class="hint" style="white-space:pre-wrap">${body||''}</div></div>`;
  div.addEventListener('click', ()=>{ selectedPinId=id; setPinSelected(id, true); });
  host.appendChild(div);
}

async function enrichRow(row){
  const token=getAccessToken(); let imageUrl='';
  if (row.imageFileId) try{ imageUrl=await getFileThumbUrl(row.imageFileId, token);}catch(_){}
  return { ...row, imageUrl };
}

async function loadCaptionsFromSheet(){
  clearCaptionList(); clearPins();
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

// +Pin (originに置く従来機能は残す)
$('pin-add')?.addEventListener('click', async ()=>{
  const id=uid();
  const row = { id, title: $('caption-title')?.value||'', body: $('caption-body')?.value||'', color: currentPinColor, x:0, y:0, z:0, imageFileId: selectedImage?.id||'' };
  await savePinRow(row);
  addPinMarker({ id, x:0, y:0, z:0, color: currentPinColor });
  appendCaptionItem(await enrichRow(row));
  selectedPinId = id; setPinSelected(id, true);
  if ($('caption-title')) $('caption-title').value=''; if ($('caption-body')) $('caption-body').value='';
});

console.log('[LociMyu ESM/CDN] boot complete');
