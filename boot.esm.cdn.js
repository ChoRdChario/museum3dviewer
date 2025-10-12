// boot.esm.cdn.js — COMPLETE build (overlay-edit + selection sync + images + sheets write)
// This file replaces the existing boot.esm.cdn.js 1:1.
// It expects viewer.module.cdn.js and gauth.module.js as shipped in the repo.

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
const __LM_SCOPES    = (window.GIS_SCOPES    || (
  'https://www.googleapis.com/auth/drive.readonly ' +
  'https://www.googleapis.com/auth/drive.file ' +
  'https://www.googleapis.com/auth/drive.metadata.readonly ' +
  'https://www.googleapis.com/auth/spreadsheets'
));
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', !!signed);
  enable(!!signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
setupAuth($('auth-signin'), signedSwitch, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });

/* ---------------------------- Drive utils ---------------------------- */
function extractDriveId(input){
  if (!input) return null;
  const s = String(input).trim();
  const bare = s.match(new RegExp('^[A-Za-z0-9_-]{25,}$'));
  if (bare) return bare[0];
  try{
    const u = new URL(s);
    const q = u.searchParams.get('id');
    if (q && new RegExp('^[A-Za-z0-9_-]{25,}$').test(q)) return q;
    const seg = u.pathname.split('/').filter(Boolean);
    const dIdx = seg.indexOf('d');
    if (dIdx !== -1 && seg[dIdx + 1] && new RegExp('^[A-Za-z0-9_-]{25,}$').test(seg[dIdx + 1])) return seg[dIdx + 1];
    const any = (u.href||'').match(new RegExp('[A-Za-z0-9_-]{25,}'));
    if (any) return any[0];
  }catch(_){}
  const any2 = s.match(new RegExp('[A-Za-z0-9_-]{25,}'));
  return any2 ? any2[0] : null;
}
async function resolveThumbUrl(fileId, size=256){
  try{
    const token = getAccessToken();
    if (!fileId || !token) return '';
    const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=thumbnailLink&supportsAllDrives=true';
    const r = await fetch(url, { headers:{ Authorization:'Bearer '+token } });
    if (!r.ok) return '';
    const j = await r.json();
    if (!j || !j.thumbnailLink) return '';
    const sz = Math.max(64, Math.min(2048, size|0));
    return j.thumbnailLink.replace(new RegExp('=s\\d+(?:-c)?$'), '=s'+String(sz)+'-c');
  }catch(e){ console.warn('[resolveThumbUrl failed]', e); return ''; }
}
async function getFileThumbUrl(fileId, token, size=1024) {
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
async function getParentFolderId(fileId, token){
  const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=parents&supportsAllDrives=true';
  const r = await fetch(url, { headers:{Authorization:'Bearer '+token} });
  if(!r.ok) return null;
  const j = await r.json(); const p=(j.parents||[])[0]; return p||null;
}
async function listImagesForGlb(fileId){
  const token = getAccessToken();
  const parent = await getParentFolderId(fileId, token); if(!parent) return [];
  const q = encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/') and trashed=false`);
  const url = 'https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,mimeType,thumbnailLink)&pageSize=200&supportsAllDrives=true';
  const r = await fetch(url, { headers:{Authorization:'Bearer '+token} });
  if(!r.ok) throw new Error('Drive list failed: '+r.status);
  const d = await r.json(); return d.files||[];
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
  svg.style.position = 'fixed';
  svg.style.left = '0'; svg.style.top = '0';
  svg.style.width = '100vw'; svg.style.height = '100vh';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '999'; // overlay: 1000
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
const overlays = new Map(); // id -> {root,imgEl,zoom}

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
  root.style.position = 'fixed';
  root.style.zIndex = '1000';
  root.style.background = '#0b0f14ef';
  root.style.color = '#e5e7eb';
  root.style.padding = '10px 12px 12px 12px';
  root.style.borderRadius = '10px';
  root.style.boxShadow = '0 8px 24px #000a';
  root.style.minWidth = '200px';
  root.style.maxWidth = '300px';

  // 固定位置のズームバー（左上）
  const fixedZoomBar = document.createElement('div');
  fixedZoomBar.style.position = 'absolute';
  fixedZoomBar.style.left = '8px';
  fixedZoomBar.style.top = '8px';
  fixedZoomBar.style.display = 'flex';
  fixedZoomBar.style.gap = '6px';
  function zbtn(label, title){
    const z = document.createElement('button');
    z.textContent = label; z.title = title;
    z.style.width = '24px'; z.style.height = '24px';
    z.style.borderRadius = '6px';
    z.style.border = 'none';
    z.style.background = '#1118';
    z.style.color = '#fff';
    z.style.cursor = 'pointer';
    return z;
  }
  const zIn  = zbtn('+', '拡大');
  const zOut = zbtn('−', '縮小');
  fixedZoomBar.appendChild(zIn); fixedZoomBar.appendChild(zOut);
  root.appendChild(fixedZoomBar);

  const topbar = document.createElement('div');
  topbar.style.display = 'flex'; topbar.style.gap = '10px';
  topbar.style.justifyContent = 'flex-end'; topbar.style.marginBottom = '6px';
  function mkBtn(txt, cls, title){
    const b = document.createElement('button');
    b.textContent = txt; b.className = cls; b.title = title||'';
    b.style.border='none'; b.style.background='transparent'; b.style.color='#ddd'; b.style.cursor='pointer';
    return b;
  }
  const bDel   = mkBtn('🗑', 'cap-del', '削除');
  const bClose = mkBtn('×',  'cap-close', '閉じる');
  topbar.appendChild(bDel); topbar.appendChild(bClose);

  const t = document.createElement('div'); t.className='cap-title'; t.style.fontWeight='700'; t.style.marginBottom='6px';
  const body = document.createElement('div'); body.className='cap-body'; body.style.fontSize='12px'; body.style.opacity='.95'; body.style.whiteSpace='pre-wrap'; body.style.marginBottom='6px';

  const img = document.createElement('img'); img.className='cap-img'; img.alt=''; img.style.display='none';
  img.style.width='100%'; img.style.height='auto'; img.style.borderRadius='8px';

  const safeTitle = (data && data.title ? String(data.title).trim() : '') || '(untitled)';
  const safeBody  = (data && data.body  ? String(data.body).trim()  : '') || '(no description)';
  t.textContent = safeTitle; body.textContent = safeBody;

  (async ()=>{
    const token = getAccessToken();
    const row = rowCache.get(id);
    if (token && row && row.imageFileId){
      try {
        const full = await getFileBlobUrl(row.imageFileId, token);
        img.src = full; img.style.display='block';
      } catch(e) {
        try {
          const th = await getFileThumbUrl(row.imageFileId, token, 1024);
          img.src = th; img.style.display='block';
        } catch(_){}
      }
    }
  })();

  // ダブルクリックで編集 → blur/Enter/Ctrl+Enter で保存
  let editing = false;
  function enterEdit(){
    if (editing) return; editing = true;
    t.contentEditable = 'true'; body.contentEditable = 'true';
    t.style.outline = '1px dashed #fff3'; body.style.outline = '1px dashed #fff3';
    t.focus();
  }
  function exitEdit(save){
    if (!editing) return; editing = false;
    t.contentEditable = 'false'; body.contentEditable = 'false';
    t.style.outline = ''; body.style.outline = '';
    if (save){
      const newTitle = (t.textContent || '').trim();
      const newBody  = (body.textContent || '').trim();
      updateCaptionForPin(id, { title: newTitle, body: newBody }).catch(()=>{});
    } else {
      const cur = rowCache.get(id) || {};
      t.textContent = (cur.title || '').trim() || '(untitled)';
      body.textContent = (cur.body  || '').trim() || '(no description)';
    }
  }
  t.addEventListener('dblclick', enterEdit);
  body.addEventListener('dblclick', enterEdit);
  t.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); exitEdit(true);} });
  body.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && e.ctrlKey){ e.preventDefault(); exitEdit(true);} });
  t.addEventListener('blur', ()=>{ if (editing) exitEdit(true); });
  body.addEventListener('blur', ()=>{ if (editing) exitEdit(true); });

  bClose.addEventListener('click', () => removeCaptionOverlay(id));
  bDel.addEventListener('click', async () => {
    if (!confirm('このキャプションを削除しますか？')) return;
    try{
      await deleteCaptionForPin(id);
      removePinMarker(id);
      const dom = captionDomById.get(id); if (dom) dom.remove();
      captionDomById.delete(id);
      rowCache.delete(id);
      removeCaptionOverlay(id);
      selectedPinId = null;
    } catch(e){ console.error('[caption delete] failed', e); alert('Failed to delete caption row.'); }
  });

  // ドラッグ移動
  let dragging=false,sx=0,sy=0,left=0,top=0;
  const onDown=(e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; const r=root.getBoundingClientRect(); left=r.left; top=r.top; e.preventDefault(); };
  const onMove=(e)=>{ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy; root.style.left=(left+dx)+'px'; root.style.top=(top+dy)+'px'; updateOverlayPosition(id); };
  const onUp=()=>{ dragging=false; };
  root.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  // ズーム
  const BASE_W = 260;
  const state = { zoom: 1.0 };
  function applyZoom(){
    const z = Math.max(0.75, Math.min(2.0, state.zoom));
    root.style.maxWidth = (BASE_W * z) + 'px';
    root.style.minWidth = (200 * z) + 'px';
    updateOverlayPosition(id);
  }
  zIn.addEventListener('click', ()=>{ state.zoom *= 1.15; applyZoom(); });
  zOut.addEventListener('click', ()=>{ state.zoom /= 1.15; applyZoom(); });

  root.appendChild(topbar);
  root.appendChild(t);
  root.appendChild(body);
  root.appendChild(img);

  document.body.appendChild(root);
  overlays.set(id, { root, imgEl: img, zoom: state.zoom });
  applyZoom();
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
  const x2 = p.x; const y2 = p.y;
  const cx = Math.min(Math.max(x2, r.left), r.right);
  const cy = Math.min(Math.max(y2, r.top ), r.bottom);
  line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy));
  line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
}
onRenderTick(() => { overlays.forEach((_, id) => updateOverlayPosition(id, false)); });

function __lm_markListSelected(id){
  const host = $('caption-list'); if (!host) return;
  host.querySelectorAll('.caption-item.is-selected').forEach(el => el.classList.remove('is-selected'));
  const el = host.querySelector(`.caption-item[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('is-selected');
}

function showOverlayFor(id){
  const d = rowCache.get(id); if (!d) return;
  __lm_markListSelected(id);
  try{ setPinSelected(id, true); }catch(_){}
  createCaptionOverlay(id, d);
  setPinSelected(id, true);
}

/* ----------------------- Pin selection & add ------------------------ */
onPinSelect((id) => { selectedPinId = id; showOverlayFor(id); });
onCanvasShiftPick(async (pt) => {
  const titleEl = $('caption-title');
  const bodyEl  = $('caption-body');
  const title = titleEl ? (titleEl.value || '') : '';
  const body  = bodyEl  ? (bodyEl.value  || '') : '';
  const imageFileId = selectedImage ? (selectedImage.id || '') : '';
  const id = uid();
  const row = { id, title, body, color: currentPinColor, x: pt.x, y: pt.y, z: pt.z, imageFileId, createdAt: new Date().toISOString() };
  await savePinToSheet(row);
  addPinMarker({ id, x: pt.x, y: pt.y, z: pt.z, color: currentPinColor });
  const enriched = await enrichRow(row);
  appendCaptionItem(enriched);
  selectedPinId = id; setPinSelected(id, true);
  showOverlayFor(id);
  if (titleEl) titleEl.focus();
});

/* ----------------------------- GLB Load ----------------------------- */
async function doLoad(){
  const token = getAccessToken();
  const urlEl = $('glbUrl');
  const fileId = extractDriveId(urlEl ? (urlEl.value||'') : '');
  if (!token || !fileId) { console.warn('[GLB] missing token or fileId'); return; }
  try {
    if ($('btnGlb')) $('btnGlb').disabled = true;
    await loadGlbFromDrive(fileId, { token });
    lastGlbFileId = fileId;
    const parentId = await getParentFolderId(fileId, token);
    currentSpreadsheetId = await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId: fileId });
    await populateSheetTabs(currentSpreadsheetId, token);
    await loadCaptionsFromSheet();
    await refreshImagesGrid();
  } catch(e) { console.error('[GLB] load error', e); }
  finally { if ($('btnGlb')) $('btnGlb').disabled = false; }
}
if ($('btnGlb')) $('btnGlb').addEventListener('click', doLoad);
if ($('glbUrl')) $('glbUrl').addEventListener('keydown', (e)=>{ if (e.key==='Enter') doLoad(); });
if ($('glbUrl')) $('glbUrl').addEventListener('input', ()=>{ if ($('btnGlb')) $('btnGlb').disabled = !extractDriveId($('glbUrl').value||''); });
if ($('glbUrl')) $('glbUrl').dispatchEvent(new Event('input'));

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
if (pinFilterHost){
  pinFilterHost.innerHTML = '';
  COLORS.forEach((c) => {
    const label = document.createElement('label'); label.className='filter-chip';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.dataset.color=c; cb.checked=true;
    const span = document.createElement('span'); span.className='chip'; span.style.background=c;
    label.appendChild(cb); label.appendChild(span);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedColors.add(c); else selectedColors.delete(c);
      document.dispatchEvent(new CustomEvent('pinFilterChange', { detail:{ selected: Array.from(selectedColors) } }));
    });
    pinFilterHost.appendChild(label);
  });
}

/* ---------------------------- Sheets I/O ---------------------------- */
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId','createdAt','updatedAt'];
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
  const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
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
if ($('save-target-sheet')) $('save-target-sheet').addEventListener('change', (e)=>{
  const sel = e.target; const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
  currentSheetId = opt && opt.value ? Number(opt.value) : null;
  currentSheetTitle = (opt && opt.dataset) ? (opt.dataset.title || null) : null;
  loadCaptionsFromSheet();
});
if ($('save-target-create')) $('save-target-create').addEventListener('click', async ()=>{
  const token = getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(currentSpreadsheetId)+':batchUpdate', {
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({ requests:[{ addSheet:{ properties:{ title } } }] })
  });
  if (!r.ok){ console.error('[Sheets addSheet] failed', r.status); return; }
  await populateSheetTabs(currentSpreadsheetId, token); await loadCaptionsFromSheet();
});

function clearCaptionList(){ const host=$('caption-list'); if (host) host.innerHTML=''; captionDomById.clear(); }

function appendCaptionItem(row){
  const host = $('caption-list'); if (!host || !row) return;
  const id=row.id, title=row.title, body=row.body, color=row.color, imageUrl=row.imageUrl||'';
  const div=document.createElement('div');
  div.className='caption-item';
  div.dataset.id=id;
  if (row.imageFileId) div.dataset.imageFileId=row.imageFileId;

  if (color) div.style.borderLeft='3px solid '+color;

  const safeTitle=(title||'').trim()||'(untitled)';
  const safeBody=(body||'').trim()||'(no description)';

  if (imageUrl){
    const img=document.createElement('img'); img.src=imageUrl; img.alt='';
    div.appendChild(img);
  }
  const txt=document.createElement('div'); txt.className='cap-txt';
  const t=document.createElement('div'); t.className='cap-title'; t.textContent=safeTitle;
  const b=document.createElement('div'); b.className='cap-body'; b.classList.add('hint'); b.textContent=safeBody;
  txt.appendChild(t); txt.appendChild(b); div.appendChild(txt);

  // Delete button
  const del=document.createElement('button'); del.className='c-del'; del.title='Delete'; del.textContent='🗑';
  del.addEventListener('click', async (e)=>{
    e.stopPropagation();
    if (!confirm('このキャプションを削除しますか？')) return;
    try{
      await deleteCaptionForPin(id);
      removePinMarker(id);
      div.remove(); captionDomById.delete(id); rowCache.delete(id);
      removeCaptionOverlay(id);
    } catch(err){ console.error('delete failed', err); alert('Delete failed'); }
  });
  div.appendChild(del);

  // Select behavior
  div.addEventListener('click', ()=>{
    __lm_onListItemClick(id);
  });

  host.appendChild(div); captionDomById.set(id, div);
  try{ div.scrollIntoView({block:'nearest'}); }catch(_){}
}

function __lm_onListItemClick(id){
  selectedPinId = id;
  __lm_markListSelected(id);
  __lm_fillFormFromCaption(id);
  try{ setPinSelected(id, true); }catch(_){}
  createCaptionOverlay(id, rowCache.get(id) || {});
}

async function enrichRow(row){
  const token=getAccessToken(); let imageUrl='';
  if(row.imageFileId){
    try{ imageUrl=await getFileThumbUrl(row.imageFileId, token, 256);}catch(_){}
  }
  const enriched = { id:row.id, title:row.title, body:row.body, color:row.color, x:row.x, y:row.y, z:row.z, imageFileId:row.imageFileId, imageUrl, createdAt:row.createdAt, updatedAt:row.updatedAt };
  rowCache.set(row.id, enriched);
  return enriched;
}

async function savePinToSheet(obj){
  const id=obj.id, title=obj.title, body=obj.body, color=obj.color, x=obj.x, y=obj.y, z=obj.z, imageFileId=obj.imageFileId;
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  const sheetTitle=currentSheetTitle||'シート1'; const range="'"+sheetTitle+"'!A:Z";
  try {
    const existed=await getValues(currentSpreadsheetId, "'"+sheetTitle+"'!A1:Z1", token);
    currentHeaders = (existed[0]||[]).map(h=>(h||'').toString().trim());
    currentHeaderIdx = {}; for (let i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()] = i; }
    const lower = currentHeaders.map(h=>h.toLowerCase());
    const hasTitle = lower.indexOf('title')>=0, hasBody = lower.indexOf('body')>=0, hasColor=lower.indexOf('color')>=0;
    if(!(hasTitle && hasBody && hasColor)) await putValues(currentSpreadsheetId, "'"+sheetTitle+"'!A1:Z1", [LOCIMYU_HEADERS], token);
  }catch(_){}
  const now = new Date().toISOString();
  await appendValues(currentSpreadsheetId, range, [[id,title,body,color,x,y,z,imageFileId, now, now ]], token);
}
async function ensureIndex(){
  captionsIndex.clear();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const values=await getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token); if(!values.length) return;
  currentHeaders = values[0].map(v=>(v||'').toString().trim());
  currentHeaderIdx = {}; for (let i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()] = i; }
  const iId=(currentHeaderIdx['id']!=null)?currentHeaderIdx['id']:-1;
  for (let r=1; r<values.length; r++){ const row=values[r]||[]; const id=row[iId]; if(!id) continue; captionsIndex.set(id, { rowIndex:r+1 }); }
}

async function updateCaptionForPin(id, fields){
  await ensureIndex();
  const meta = captionsIndex.get(id); if (!meta) throw new Error('row not found');
  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const rowIdx = meta.rowIndex;
  const values = await getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A"+rowIdx+":Z"+rowIdx, token);
  const row = (values[0]||[]).slice();
  const lower = (currentHeaders||[]).map(h=>String(h||'').toLowerCase());
  const idx = (name)=> lower.indexOf(name);
  function put(col, val){
    const i = idx(col); if (i<0) return;
    row[i] = (val==null?'':String(val));
  }
  if ('title' in fields) put('title', fields.title);
  if ('body'  in fields) put('body',  fields.body);
  if ('color' in fields) put('color', fields.color);
  if ('x' in fields) put('x', fields.x);
  if ('y' in fields) put('y', fields.y);
  if ('z' in fields) put('z', fields.z);
  if ('imageFileId' in fields) put('imagefileid', fields.imageFileId);
  put('updatedat', new Date().toISOString());

  await putValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A"+rowIdx+":"+colA1(Math.max(row.length-1,9))+rowIdx, [row], token);
  // cache update
  const cached = rowCache.get(id) || { id };
  Object.assign(cached, fields);
  rowCache.set(id, cached);

  // UI 更新
  const item = captionDomById.get(id);
  if (item){
    const t = item.querySelector('.cap-title'); if (t && ('title' in fields)) t.textContent = fields.title || '(untitled)';
    const b = item.querySelector('.cap-body');  if (b && ('body'  in fields)) b.textContent = fields.body  || '(no description)';
    if ('imageFileId' in fields){
      if (!fields.imageFileId){
        const img = item.querySelector('img'); if (img) img.src='';
      }else{
        resolveThumbUrl(fields.imageFileId, 128).then(url => {
          if (!url) return;
          let img = item.querySelector('img');
          if (!img){ img=document.createElement('img'); item.insertBefore(img, item.firstChild); }
          img.src = url;
        });
      }
    }
  }
  if (overlays.has(id)) createCaptionOverlay(id, rowCache.get(id));
}

async function deleteCaptionForPin(id){
  await ensureIndex();
  const meta = captionsIndex.get(id); if (!meta) return;
  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const rowIdx = meta.rowIndex;
  const blanks = new Array(Math.max(LOCIMYU_HEADERS.length, 10)).fill('');
  await putValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A"+rowIdx+":"+colA1(blanks.length-1)+rowIdx, [blanks], token);
  captionsIndex.delete(id);
}

async function loadCaptionsFromSheet(){
  clearCaptionList();
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if (!currentSheetTitle){
    await populateSheetTabs(currentSpreadsheetId, token);
    if (!currentSheetTitle) return;
  }
  const values=await getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token);
  if (!values.length) return;
  currentHeaders = values[0].map(v=>(v||'').toString().trim());
  currentHeaderIdx = {}; for (let i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()] = i; }
  const idx = (name)=> (currentHeaderIdx[name] != null ? currentHeaderIdx[name] : -1);
  const iId=idx('id'), iTitle=idx('title'), iBody=idx('body'), iColor=idx('color'), iX=idx('x'), iY=idx('y'), iZ=idx('z'), iImg=idx('imagefileid');
  captionsIndex.clear();
  for (let r=1;r<values.length;r++){
    const row=values[r]||[];
    const id=row[iId]; if(!id) continue;
    const obj={
      id: String(id),
      title: row[iTitle]||'',
      body: row[iBody]||'',
      color: row[iColor]||'#ff6b6b',
      x: Number(row[iX]||0), y: Number(row[iY]||0), z: Number(row[iZ]||0),
      imageFileId: row[iImg]||''
    };
    const enriched = await enrichRow(obj);
    appendCaptionItem(enriched);
    addPinMarker({ id: enriched.id, x: enriched.x, y: enriched.y, z: enriched.z, color: enriched.color });
    captionsIndex.set(enriched.id, { rowIndex: r+1 });
  }
}

// images grid & buttons
async function refreshImagesGrid(){
  const host = $('images-grid'); if (!host) return;
  host.innerHTML = '';
  if (!lastGlbFileId) return;
  const token = getAccessToken(); if (!token) return;
  const parent = await getParentFolderId(lastGlbFileId, token); if(!parent) return;
  const q = encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/') and trashed=false`);
  const url = 'https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,mimeType,thumbnailLink)&pageSize=200&supportsAllDrives=true';
  const r = await fetch(url, { headers:{Authorization:'Bearer '+token} });
  if (!r.ok) return;
  const d = await r.json(); const files = d.files||[];
  for (const f of files){
    const div = document.createElement('div'); div.className='thumb';
    div.title = f.name||'';
    const th = await resolveThumbUrl(f.id, 128);
    if (th) div.style.backgroundImage = 'url("'+th+'")';
    div.addEventListener('click', async ()=>{
      selectedImage = { id: f.id, name: f.name };
      host.querySelectorAll('.thumb[data-selected="true"]').forEach(n=>n.removeAttribute('data-selected'));
      div.setAttribute('data-selected','true');
      const slot = $('currentImageThumb');
      if (slot) slot.innerHTML = th ? '<img alt="" src="'+th+'">' : '<div class="placeholder">No Image</div>';
      if (selectedPinId) await updateImageForPin(selectedPinId, f.id);
    });
    host.appendChild(div);
  }
}

function __lm_fillFormFromCaption(id){
  const row = rowCache.get(id);
  const t = $('caption-title'); const b = $('caption-body');
  if (t) t.value = row ? (row.title||'') : '';
  if (b) b.value = row ? (row.body||'') : '';
}
function __lm_selectPin(id, src='pin'){
  selectedPinId = id;
  __lm_fillFormFromCaption(id);
  __lm_markListSelected(id);
  if (src !== 'list') showOverlayFor(id);
}

if ($('caption-list')) $('caption-list').addEventListener('click', (e)=>{
  const item = e.target && e.target.closest ? e.target.closest('.caption-item') : null;
  if (!item) return;
  const id = item.dataset.id;
  if (id) __lm_selectPin(id, 'list');
});

// debounced autosave
(function(){
  const t = $('caption-title'), b = $('caption-body');
  let h = null;
  function queue(){
    if (h) clearTimeout(h);
    h = setTimeout(async ()=>{
      if (!selectedPinId) return;
      try{
        await updateCaptionForPin(selectedPinId, { title: t ? t.value : '', body: b ? b.value : '' });
      }catch(e){ console.warn('[caption autosave failed]', e); }
    }, 500);
  }
  if (t) t.addEventListener('input', queue);
  if (b) b.addEventListener('input', queue);
})();

if ($('btnRefreshImages')) $('btnRefreshImages').addEventListener('click', refreshImagesGrid);
const btnAttach = $('btnAttachImage');
if (btnAttach) btnAttach.addEventListener('click', ()=>{
  if (!selectedPinId || !selectedImage) return;
  updateCaptionForPin(selectedPinId, { imageFileId: selectedImage.id }).catch(()=>{});
});
const btnDetach = $('btnDetachImage');
if (btnDetach) btnDetach.addEventListener('click', ()=>{
  if (!selectedPinId) return;
  selectedImage = null;
  updateCaptionForPin(selectedPinId, { imageFileId: '' }).catch(()=>{});
  const slot = $('currentImageThumb');
  if (slot) slot.innerHTML = '<div class="placeholder">No Image</div>';
});

console.log('[LociMyu ESM/CDN] boot overlay-edit+fixed-zoom build loaded (完全版)');
