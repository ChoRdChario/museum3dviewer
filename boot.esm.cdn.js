// boot.esm.cdn.js — overlay-edit + fixed zoom controls (top-left), always full-res image (scaled), caption highlight, clearer attach UX, hide +Pin
// This file replaces the previous placeholder. It expects viewer.module.cdn.js and gauth.module.js to expose the same public API as earlier builds.
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, clearPins,
  setPinSelected, onPinSelect, loadGlbFromDrive, onRenderTick,
  projectPoint, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

/* ------------------------- small DOM helpers ------------------------- */
const $ = (id) => document.getElementById(id);
const enable = (on, els) => els.forEach(el => { if (el) el.disabled = !on; });
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

// --- Drive thumbnail helpers (Promise-safe) ---
async function resolveThumbUrl(fileId, size = 256) {
  try {
    const token = getAccessToken && getAccessToken();
    if (!fileId || !token) return '';
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink&supportsAllDrives=true`;
    const res = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return '';
    const meta = await res.json();
    if (!meta || !meta.thumbnailLink) return '';
    return meta.thumbnailLink.replace(/=s\d+(?:-c)?$/, `=s${size}-c`);
  } catch(e){ console.warn('[thumb resolve failed]', e); return ''; }
}

function buildFileBlobUrl(fileId) {
  try {
    const token = getAccessToken && getAccessToken();
    if (!fileId || !token) return '';
    return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&access_token=${encodeURIComponent(token)}`;
  } catch(e){ return ''; }
}


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

  // 固定位置のズームバー（左上・ウィンドウ拡縮でも位置が変わらない）
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

  // タイトル・本文・画像
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

  // 画像は最初から full-res を取りに行き、描画は CSS で縮小（失敗時は thumb にフォールバック）
  (async ()=>{
    const token = getAccessToken();
    const row = rowCache.get(id);
    if (token && row && row.imageFileId){
      try {
        const full = await getFileBlobUrl(row.imageFileId, token);
        img.src = full; img.style.display='block';
      } catch (e) {
        try {
          const th = await getFileThumbUrl(row.imageFileId, token, 1024);
          img.src = th; img.style.display='block';
        } catch (e2) {}
      }
    }
  })();

  // 編集モード（タイトル/本文ともにピン設置後も編集可能）
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
  bEdit.addEventListener('click', () => { if (editing) exitEdit(true); else enterEdit(); });
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
    }catch(e){ console.error('[caption delete] failed', e); alert('Failed to delete caption row.'); }
  });

  // ドラッグ
  let dragging=false,sx=0,sy=0,left=0,top=0;
  const onDown=(e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; const r=root.getBoundingClientRect(); left=r.left; top=r.top; e.preventDefault(); };
  const onMove=(e)=>{ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy; root.style.left=(left+dx)+'px'; root.style.top=(top+dy)+'px'; updateOverlayPosition(id); };
  const onUp=()=>{ dragging=false; };
  root.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  // ズーム（固定バーの [+][-]）
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

function updateOverlayPosition(id, initial){
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
function showOverlayFor(id){
  const d = rowCache.get(id); if (!d) return;
  __lm_markListSelected(id);
  try{ setPinSelected(id, true); }catch(e){}
  createCaptionOverlay(id, d);
}
/* ----------------------- Pin selection & add ------------------------ */
onPinSelect((id)=>{ if (!id) return; try{ __lm_selectPin(id,'viewer'); }catch(e){} try{ if (typeof showOverlayFor==='function') showOverlayFor(id); }catch(e){} });
onCanvasShiftPick(async (pt) => {
  const titleEl = $('caption-title');
  const bodyEl  = $('caption-body');
  const title = titleEl ? (titleEl.value || '') : '';
  const body  = bodyEl  ? (bodyEl.value  || '') : '';
  const imageFileId = selectedImage ? (selectedImage.id || '') : '';
  const id = uid();
  const row = { id, title, body, color: currentPinColor, x: pt.x, y: pt.y, z: pt.z, imageFileId };
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
  } catch (e) { console.error('[GLB] load error', e); }
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
  sel.innerHTML = '<option value=\"\">Loading…</option>';
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?fields=sheets(properties(title,sheetId,index))', { headers:{Authorization:'Bearer '+token} });
  if (!r.ok) { sel.innerHTML = '<option value=\"\">(error)</option>'; return; }
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
  const id = row.id, title = row.title, body = row.body, color = row.color, imageUrl = row.imageUrl || '';
  const div = document.createElement('div');
  div.className = 'caption-item';
  div.dataset.id = id;
  if (row.imageFileId) div.dataset.imageFileId = row.imageFileId;
  // left color bar
  if (color) div.style.borderLeft = '3px solid ' + color;

  const safeTitle = (title||'').trim() || '(untitled)';
  const safeBody  = (body ||'').trim() || '(no description)';

  if (imageUrl){
    const img = document.createElement('img'); img.src = imageUrl; img.alt = '';
    div.appendChild(img);
  }
  const txt = document.createElement('div'); txt.className = 'cap-txt';
  const t   = document.createElement('div'); t.className = 'c-title'; t.textContent = safeTitle;
  const b   = document.createElement('div'); b.className = 'c-body';  b.classList.add('hint'); b.textContent = safeBody;
  txt.appendChild(t); txt.appendChild(b); div.appendChild(txt);

  // delete button
  const del = document.createElement('button'); del.className='c-del'; del.title='Delete'; del.textContent='🗑';
  del.addEventListener('click', async (e)=>{
    e.stopPropagation();
    if (!confirm('このキャプションを削除しますか？')) return;
    try{
      await deleteCaptionForPin(id);
      removePinMarker(id);
      div.remove(); captionDomById.delete(id); rowCache.delete(id);
      removeCaptionOverlay(id);
    }catch(err){ console.error('delete failed', err); alert('Delete failed'); }
  });
  div.appendChild(del);

  host.appendChild(div); captionDomById.set(id, div);
  try{ div.scrollIntoView({block:'nearest'}); }catch(e){}
}

// robust list click delegation (works with any [data-id] item)
;(function(){
  const host = $('caption-list'); if (!host) return;
  host.addEventListener('click', (e)=>{
    const item = (e.target && e.target.closest) ? e.target.closest('[data-id]') : null;
    if (!item) return;
    if (e.target.closest && e.target.closest('.c-del')) return;
    const id = item.dataset.id;
    try{ __lm_selectPin(id,'list'); }catch(e){}
    try{ if (typeof showOverlayFor==='function') showOverlayFor(id); }catch(e){}
  }, {capture:true});
})();


async function enrichRow(row){
  const token=getAccessToken(); let imageUrl='';
  if(row.imageFileId){
    try{ imageUrl=await getFileThumbUrl(row.imageFileId, token, 512);}catch(e){}
  }
  const enriched = { id:row.id, title:row.title, body:row.body, color:row.color, x:row.x, y:row.y, z:row.z, imageFileId:row.imageFileId, imageUrl };
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
  } catch(e){}
  await appendValues(currentSpreadsheetId, range, [[id,title,body,color,x,y,z,imageFileId]], token);
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
async function updateImageForPin(id, imageFileId){
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if (!captionsIndex.size) await ensureIndex();
  const hit=captionsIndex.get(id); if(!hit) return;
  const ci = (currentHeaderIdx['imagefileid']!=null)?currentHeaderIdx['imagefileid']:7;
  const a1 = "'"+(currentSheetTitle||'シート1')+"'!"+colA1(ci)+String(hit.rowIndex);
  await putValues(currentSpreadsheetId, a1, [[imageFileId]], token);
  const cached = rowCache.get(id) || {};
  cached.imageFileId = imageFileId; rowCache.set(id, cached);
  // list thumb
  try{ const turl = await getFileThumbUrl(imageFileId, token, 1024); const dom = captionDomById.get(id); if (dom){ const i=dom.querySelector('img'); if(i) i.src=turl; else{ const im=document.createElement('img'); im.src=turl; dom.prepend(im);} } }catch(e){}
  // overlay full-res (scaled)
  try{ const full = await getFileBlobUrl(imageFileId, token); const ov=overlays.get(id); if(ov){ ov.imgEl.src=full; ov.imgEl.style.display='block'; } }catch(e){}
}
async function updateCaptionForPin(id, args){
  const title = args.title; const body = args.body; const color = args.color;
  const token=getAccessToken(); if(!token||!currentSpreadsheetId) return;
  if (!captionsIndex.size) await ensureIndex();
  const hit=captionsIndex.get(id); if(!hit) throw new Error('row not found');
  const st = currentSheetTitle || 'シート1';
  function col(name){ const i=(currentHeaderIdx[name]!=null)?currentHeaderIdx[name]:-1; return colA1(i); }
  const reqs = [];
  if (typeof title === 'string' && currentHeaderIdx['title']!=null) reqs.push( putValues(currentSpreadsheetId, "'"+st+"'!"+col('title')+String(hit.rowIndex), [[title]], token) );
  if (typeof body  === 'string' && currentHeaderIdx['body'] !=null) reqs.push( putValues(currentSpreadsheetId, "'"+st+"'!"+col('body') +String(hit.rowIndex), [[body ]], token) );
  if (typeof color === 'string' && currentHeaderIdx['color']!=null) reqs.push( putValues(currentSpreadsheetId, "'"+st+"'!"+col('color')+String(hit.rowIndex), [[color]], token) );
  await Promise.all(reqs);
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
  const token = getAccessToken && getAccessToken();
  if (!token || !currentSpreadsheetId) throw new Error('no auth');
  if (typeof ensureIndex === 'function') await ensureIndex();
  const rowIndex = captionsIndex && captionsIndex.get ? captionsIndex.get(id) : null;

  if (rowIndex == null) {
    try{ await updateCaptionForPin(id, { title: '', body: '', color: '', imageFileId: '' }); }catch(e){}

async function loadCaptionsFromSheet(){
  clearCaptionList(); clearPins(); rowCache.clear();
  overlays.forEach((_,id)=>removeCaptionOverlay(id)); overlays.clear();
  if (lineLayer) lineLayer.innerHTML='';
  const token = getAccessToken(); if (!token || !currentSpreadsheetId || !currentSheetTitle) return;
  try {
    const range = `'${currentSheetTitle}'!A1:Z9999`;
    const values = await getValues(currentSpreadsheetId, range, token);
    if (!values || !values.length) return;
    currentHeaders = values[0].map(v => (v||'').toString().trim());
    currentHeaderIdx = {};
    for (let i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()] = i; }
    const idx = (n)=>{ const k=(n||'').toLowerCase(); return (currentHeaderIdx[k]!=null)?currentHeaderIdx[k]:-1; };
    const iId=idx('id'), iTitle=idx('title'), iBody=idx('body'), iColor=idx('color'),
          iX=idx('x'), iY=idx('y'), iZ=idx('z'), iImg=idx('imagefileid');

    for (let r=1; r<values.length; r++){
      const row = values[r] || [];
      const data = {
        id: (row[iId]||uid()),
        title: row[iTitle]||'',
        body: row[iBody]||'',
        color: row[iColor]||'#ff6b6b',
        x: Number(row[iX]||0),
        y: Number(row[iY]||0),
        z: Number(row[iZ]||0),
        imageFileId: row[iImg]||''
      };
      addPinMarker({ id: data.id, x: data.x, y: data.y, z: data.z, color: data.color });
      const enriched = await enrichRow(data);
      appendCaptionItem(enriched);
    }
    await ensureIndex();
  } catch(e){
    console.warn('[loadCaptionsFromSheet] failed', e);
  }
}
/* --------------------------- Images UX --------------------------- */
if ($('btnRefreshImages')) $('btnRefreshImages').addEventListener('click', refreshImagesGrid);
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

function __lm_fillFormFromCaption(obj){
  const ti=$('caption-title'), bo=$('caption-body'), th=$('currentImageThumb');
  if (ti) ti.value = (obj && obj.title) ? String(obj.title) : '';
  if (bo) bo.value = (obj && obj.body)  ? String(obj.body)  : '';
  if (!th) return;
  const fid = obj && obj.imageFileId;
  if (!fid) { th.innerHTML = `<div class="placeholder">No Image</div>`; return; }
  (async () => {
    const url = await resolveThumbUrl(fid, 256);
    th.innerHTML = url ? `<img alt="attached" src="${url}">` : `<div class="placeholder">No Image</div>`;
  })();
}

function __lm_getCaptionDataById(id){
  // We can reconstruct from current DOM and cache rowCache if present
  const li = document.querySelector(`#caption-list .caption-item[data-id="${CSS.escape(id)}"]`);
  if (!li) return null;
  const titleEl = li.querySelector('.c-title'); const bodyEl = li.querySelector('.c-body');
  const thumb = li.querySelector('img');
  const imageFileId = (li.dataset.imageFileId || '');
  return { id, title: titleEl ? titleEl.textContent : '', body: bodyEl ? bodyEl.textContent : '', imageFileId };
}

function __lm_selectPin(id, source='unknown'){
  selectedPinId = id;
  setPinSelected(id, true);
  __lm_markListSelected(id);
  const obj = rowCache.get(id) || __lm_getCaptionDataById(id);
  __lm_fillFormFromCaption(obj);
  // focus title for quick edit when coming from viewer
  if (source === 'viewer') { $('caption-title')?.focus(); }
}

// viewer -> selection
onPinSelect((id)=>{ if (id) __lm_selectPin(id, 'viewer'); });

// list -> selection (augment existing handler by also syncing the form)
(function(){
  const host = $('caption-list');
  if (!host) return;
  host.addEventListener('click', (e)=>{
    const item = e.target && e.target.closest ? e.target.closest('.caption-item[data-id]') : null;
    if (!item) return;
    // keep existing delete handler functional
    if (e.target.closest && e.target.closest('.c-del')) return;
    __lm_selectPin(item.dataset.id, 'list');
  }, {capture:true});
})();

// form -> update (debounced)
let __lm_deb;
['caption-title','caption-body'].forEach(id=>{
  const el = $(id); if (!el) return;
  el.addEventListener('input', ()=>{ if (!selectedPinId) return; if (!(rowCache && rowCache.has && rowCache.has(selectedPinId))) return;
    clearTimeout(__lm_deb);
    __lm_deb = setTimeout(async ()=>{
      const title = $('caption-title').value.trim();
      const body  = $('caption-body').value.trim();
      try{
        await updateCaptionForPin(selectedPinId, { title, body });
        // reflect to list item
        const li = document.querySelector(`#caption-list .caption-item[data-id="${CSS.escape(selectedPinId)}"]`);
        if (li){
          li.querySelector('.c-title').textContent = title || '(untitled)';
          const bEl = li.querySelector('.c-body'); if (bEl) bEl.textContent = body || '(no description)';
        }
        // update cache
        const cur = rowCache.get(selectedPinId) || {};
        rowCache.set(selectedPinId, { cur, title, body });
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
      // Scroll images grid into view and hint the user to select a thumbnail
      grid?.scrollIntoView({behavior:'smooth', block:'nearest'});
      if (hint) hint.textContent = '画像を選ぶと選択キャプションに添付されます。';
    });
  }
  if (detach){
    detach.addEventListener('click', async ()=>{
      if (!selectedPinId){ alert('キャプションを選択してください'); return; }
      try{
        await updateImageForPin(selectedPinId, '');
        // Update preview
        $('currentImageThumb').innerHTML = '<div class="placeholder">No Image</div>';
        const li = document.querySelector(`#caption-list .caption-item[data-id="${CSS.escape(selectedPinId)}"] img`);
        if (li) li.src = '';
        // update cache
        const cur = rowCache.get(selectedPinId) || {};
        rowCache.set(selectedPinId, { cur, imageFileId: '' });
      }catch(e){ console.warn('[detach image failed]', e); }
    });
  }
})();

// When images-grid click attaches image (existing behavior), also update preview
(function(){
  const g = $('images-grid'); if (!g) return;
  g.addEventListener('click', (e)=>{
  const btn = e.target && e.target.closest ? e.target.closest('.thumb[data-id]') : null;
  if (!btn || !selectedPinId) return;
  const fid = btn.dataset.id;
  (async () => {
    const url = await resolveThumbUrl(fid, 256);
    if ($('currentImageThumb')) $('currentImageThumb').innerHTML = url ? `<img alt="attached" src="${url}">` : `<div class="placeholder">No Image</div>`;
    const liImg = document.querySelector(`#caption-list .caption-item[data-id="${CSS.escape(selectedPinId)}"] img`);
    if (liImg) {
      const u128 = await resolveThumbUrl(fid, 128);
      if (u128) liImg.src = u128;
    }
    const cur = rowCache.get(selectedPinId) || {};
    rowCache.set(selectedPinId, { cur, imageFileId: fid });
  })();
}, {capture:true});
})();
/* ===== end v6.7 injection ===== */
console.log('[LociMyu ESM/CDN] boot overlay-edit+fixed-zoom build loaded');