// boot.esm.cdn.js — HEIC/HEIF thumbnails via Drive thumbnailLink + Shift+Click pin drop
import { ensureViewer, onCanvasShiftPick } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- Viewer ----------
ensureViewer({ canvas: $('gl') });
onCanvasShiftPick(async (pt) => {
  const title = $('caption-title')?.value || '';
  const body = $('caption-body')?.value || '';
  const imageFileId = selectedImage?.id || '';
  const id = uid();
  await savePinToSheet({ id, title, body, color: currentPinColor, x: pt.x, y: pt.y, z: pt.z, imageFileId });
  let imageUrl=''; if (imageFileId) try { imageUrl = await getFileThumbUrl(imageFileId, getAccessToken()); } catch(_){}
  appendCaptionItem({ title, body, color: currentPinColor, imageUrl });
});

// ---------- Auth ----------
const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
btnAuth && setupAuth(btnAuth, signedSwitch);

// ---------- GLB load (Drive API) ----------
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

const doLoad = async () => {
  const token = getAccessToken();
  if (!token) { console.warn('[GLB] token missing. Please sign in.'); return; }
  const raw = $('glbUrl')?.value?.trim();
  const fileId = extractDriveId(raw);
  if (!fileId) { const hint=$('glb-hint'); if (hint) hint.textContent='No fileId found.'; return; }
  try {
    $('btnGlb').disabled = true; const hint=$('glb-hint'); if (hint) hint.textContent='';
    await loadGlbFromDrive(fileId, { token });
    lastGlbFileId = fileId;

    const parentId = await getParentFolderId(fileId, token);
    currentSpreadsheetId = await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId: fileId });
    await populateSheetTabs(currentSpreadsheetId, token);
    await loadCaptionsFromSheet();
    await refreshImagesGrid();
  } catch (e) {
    const hint=$('glb-hint'); if (hint) hint.textContent = `Load failed: ${e?.message || e}`;
    console.error('[GLB] load error', e);
  } finally {
    $('btnGlb').disabled = false;
  }
};
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('input', () => {$('btnGlb').disabled = !extractDriveId($('glbUrl')?.value||'');});
$('glbUrl')?.dispatchEvent(new Event('input'));

// ---------- Caption: colors & filter ----------
const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#94a3b8'];
let currentPinColor = COLORS[0];
const pinColorsHost = $('pin-colors');
if (pinColorsHost) {
  pinColorsHost.innerHTML = COLORS.map(c => `<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('');
  const select = (el) => { pinColorsHost.querySelectorAll('.chip').forEach(x => (x.style.outline = '')); el.style.outline = '2px solid #fff4'; currentPinColor = el.dataset.color; };
  pinColorsHost.addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; select(b); });
  const first = pinColorsHost.querySelector('.chip'); first && select(first);
}
const pinFilterHost = $('pin-filter'); const selectedColors = new Set(COLORS);
if (pinFilterHost) {
  pinFilterHost.innerHTML = COLORS.map(c => (`<label style="display:flex;align-items:center;gap:6px;margin:2px 8px 2px 0"><input type="checkbox" data-color="${c}" checked /><span class="chip" style="width:14px;height:14px;background:${c}"></span></label>`)).join('');
  pinFilterHost.addEventListener('change', (e)=>{const cb=e.target.closest('input[type=checkbox][data-color]'); if(!cb)return; const color=cb.dataset.color; cb.checked?selectedColors.add(color):selectedColors.delete(color); document.dispatchEvent(new CustomEvent('pinFilterChange',{detail:{selected:[...selectedColors]}}));});
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

// ---------- Images grid & caption attach ----------
let selectedImage = null; // {id, url}
async function refreshImagesGrid() {
  const token = getAccessToken();
  const fileId = lastGlbFileId || extractDriveId($('glbUrl')?.value || '');
  if (!token || !fileId) { $('images-status').textContent='Sign in & load a GLB first.'; return; }
  $('images-status').textContent = 'Loading images…';
  const grid = $('images-grid'); grid.innerHTML=''; selectedImage=null;
  try {
    const files = await listImagesForGlb(fileId, token);
    $('images-status').textContent = `${files.length} image(s) found in the GLB folder`;
    for (const f of files) {
      try {
        const url = await getFileThumbUrl(f.id, token);
        const btn = document.createElement('button');
        btn.className='thumb'; btn.style.backgroundImage=`url(${url})`; btn.title=f.name; btn.dataset.id=f.id;
        btn.addEventListener('click', ()=>{grid.querySelectorAll('.thumb').forEach(x=>x.dataset.selected='false'); btn.dataset.selected='true'; selectedImage={id:f.id,url};});
        grid.appendChild(btn);
      } catch(e){ console.warn('thumb err', f, e); }
    }
  } catch (e) {
    $('images-status').textContent = `Error: ${e.message}`;
    console.error('[images grid] error', e);
  }
}
$('btnRefreshImages')?.addEventListener('click', refreshImagesGrid);

// ---------- Sheets ----------
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId'];
const REQUIRED_MIN_HEADERS = new Set(['title','body','color']);

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

// Captions
function clearCaptionList(){ const host=$('caption-list'); if(host) host.innerHTML=''; }
function appendCaptionItem({title, body, color, imageUrl}){
  const host=$('caption-list'); const div=document.createElement('div'); div.className='caption-item';
  div.innerHTML = `${imageUrl?`<img src="${imageUrl}" alt="">`:''}<div><div style="font-weight:600">${title||''}</div><div class="hint" style="white-space:pre-wrap">${body||''}</div></div>`; host.appendChild(div);
}
async function savePinToSheet({ id, title, body, color, x, y, z, imageFileId }){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range=`'${sheetTitle}'!A:Z`;
  try { const existed=await getValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, token); const headers=existed[0]||[]; const lower=headers.map(h=>(h||'').toString().trim().toLowerCase()); const ok=REQUIRED_MIN_HEADERS.size===new Set(lower.filter(h=>REQUIRED_MIN_HEADERS.has(h))).size; if(!ok) await putValues(currentSpreadsheetId, `'${sheetTitle}'!A1:Z1`, [LOCIMYU_HEADERS], token); } catch(_){}
  const row=[id,title,body,color,x,y,z,imageFileId]; await appendValues(currentSpreadsheetId, range, [row], token);
}
async function loadCaptionsFromSheet(){
  clearCaptionList(); const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  try {
    const values=await getValues(currentSpreadsheetId, `'${currentSheetTitle}'!A1:Z9999`, token); if(!values.length) return;
    const headers=values[0].map(v=>(v||'').toString().trim().toLowerCase()); const idx=(n)=>headers.indexOf(n);
    const iTitle=idx('title'), iBody=idx('body'), iColor=idx('color'), iImg=idx('imagefileid');
    for (let r=1; r<values.length; r++){ const row=values[r]; if(!row) continue; const title=row[iTitle]||''; const body=row[iBody]||''; const color=row[iColor]||''; const imageFileId=row[iImg]||''; let imageUrl=''; if(imageFileId) try{ imageUrl=await getFileThumbUrl(imageFileId, token);}catch(_){}
      appendCaptionItem({ title, body, color, imageUrl }); }
  } catch(e){ console.warn('[loadCaptionsFromSheet] failed', e); }
}

// +Pin button
$('pin-add')?.addEventListener('click', async ()=>{
  const title=$('caption-title')?.value||''; const body=$('caption-body')?.value||''; const imageFileId=selectedImage?.id||''; const id=uid();
  const [x,y,z]=[0,0,0];
  try { await savePinToSheet({ id, title, body, color: currentPinColor, x, y, z, imageFileId });
    let imageUrl=''; if (imageFileId) try{ imageUrl=await getFileThumbUrl(imageFileId,getAccessToken()); }catch(_){}
    appendCaptionItem({ title, body, color: currentPinColor, imageUrl });
    if ($('caption-title')) $('caption-title').value=''; if ($('caption-body')) $('caption-body').value='';
  } catch(e){ console.error('[+Pin] save failed', e); }
});
$('pin-clear')?.addEventListener('click', ()=>{ if($('caption-title')) $('caption-title').value=''; if($('caption-body')) $('caption-body').value=''; });

console.log('[LociMyu ESM/CDN] boot complete');