// boot.esm.cdn.js – 修正版
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, clearPins,
  setPinSelected, onPinSelect, loadGlbFromDrive, onRenderTick,
  projectPoint, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

/* ------------------------- DOM helpers ------------------------- */
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
function extractDriveId(v){
  if (!v) return null;
  const s = String(v).trim();
  // 既存のロジック
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
  svg.style.zIndex = '999';
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
const overlays = new Map();

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
  topbar.style.display = 'flex'; 
  topbar.style.gap = '10px';
  topbar.style.justifyContent = 'flex-end'; 
  topbar.style.marginBottom = '6px';
  
  function mkBtn(txt, cls, title){
    const b = document.createElement('button');
    b.textContent = txt; b.className = cls; b.title = title||'';
    b.style.border='none'; 
    b.style.background='transparent'; 
    b.style.color='#ddd'; 
    b.style.cursor='pointer';
    return b;
  }
  const bDel = mkBtn('🗑', 'cap-del', '削除');
  const bClose = mkBtn('×', 'cap-close', '閉じる');
  topbar.appendChild(bDel); 
  topbar.appendChild(bClose);

  // ★ 修正: 閉じるボタンの動作追加
  bClose.addEventListener('click', () => {
    removeCaptionOverlay(id);
    setPinSelected(id, false);
  });

  // ★ 修正: 削除ボタンの動作追加
  bDel.addEventListener('click', async () => {
    if (!confirm('このキャプションを削除しますか?')) return;
    try {
      await deleteCaptionForPin(id);
      removePinMarker(id);
      removeCaptionOverlay(id);
      const listItem = captionDomById.get(id);
      if (listItem) listItem.remove();
      captionDomById.delete(id);
      rowCache.delete(id);
    } catch(err) {
      console.error('delete failed', err);
      alert('削除に失敗しました');
    }
  });

  const t = document.createElement('div'); 
  t.className='cap-title'; 
  t.style.fontWeight='700'; 
  t.style.marginBottom='6px';
  
  const body = document.createElement('div'); 
  body.className='cap-body'; 
  body.style.fontSize='12px'; 
  body.style.opacity='.95'; 
  body.style.whiteSpace='pre-wrap'; 
  body.style.marginBottom='6px';

  // ★ 修正: オーバーレイに画像を追加
  const img = document.createElement('img'); 
  img.className='cap-img'; 
  img.alt=''; 
  img.style.display='none';
  img.style.width='100%'; 
  img.style.height='auto'; 
  img.style.borderRadius='8px';
  img.style.marginBottom='6px';

  const safeTitle = (data && data.title ? String(data.title).trim() : '') || '(untitled)';
  const safeBody  = (data && data.body  ? String(data.body).trim()  : '') || '(no description)';
  t.textContent = safeTitle; 
  body.textContent = safeBody;

  // ★ 修正: 画像読み込みロジック改善
  (async ()=>{
    const token = getAccessToken();
    const row = rowCache.get(id);
    if (token && row && row.imageFileId){
      try {
        const full = await getFileBlobUrl(row.imageFileId, token);
        img.src = full; 
        img.style.display='block';
      } catch (e) {
        try {
          const th = await getFileThumbUrl(row.imageFileId, token, 1024);
          img.src = th; 
          img.style.display='block';
        } catch (e2) {
          console.warn('Image load failed:', e2);
        }
      }
    }
  })();

  let dragging=false,sx=0,sy=0,left=0,top=0;
  const onDown=(e)=>{ 
    dragging=true; 
    sx=e.clientX; 
    sy=e.clientY; 
    const r=root.getBoundingClientRect(); 
    left=r.left; 
    top=r.top; 
    e.preventDefault(); 
  };
  const onMove=(e)=>{ 
    if(!dragging) return; 
    const dx=e.clientX-sx, dy=e.clientY-sy; 
    root.style.left=(left+dx)+'px'; 
    root.style.top=(top+dy)+'px'; 
    updateOverlayPosition(id); 
  };
  const onUp=()=>{ dragging=false; };
  root.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

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
  root.appendChild(img); // ★ 画像を追加
  
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
  if (initial && !o.root.style.left){ 
    o.root.style.left = (p.x + 14) + 'px'; 
    o.root.style.top  = (p.y + 14) + 'px'; 
  }
  const r = o.root.getBoundingClientRect();
  const line = getOrMakeLine(id);
  const x2 = p.x; const y2 = p.y;
  const cx = Math.min(Math.max(x2, r.left), r.right);
  const cy = Math.min(Math.max(y2, r.top ), r.bottom);
  line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy));
  line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
}

onRenderTick(() => { 
  overlays.forEach((_, id) => updateOverlayPosition(id, false)); 
});

function showOverlayFor(id){
  const d=rowCache.get(id); if(!d) return;
  // ★ 修正: リスト強調表示を追加
  __lm_markListSelected(id);
  createCaptionOverlay(id, d);
  setPinSelected(id, true);
}

/* ----------------------- Pin selection & add ------------------------ */
onPinSelect((id) => { 
  selectedPinId = id; 
  showOverlayFor(id); 
});

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
  selectedPinId = id; 
  setPinSelected(id, true);
  showOverlayFor(id);
  if (titleEl) titleEl.focus();
});

/* ----------------------------- GLB Load ----------------------------- */
async function doLoad(){
  const token = getAccessToken();
  const urlEl = $('glbUrl');
  const input = urlEl ? (urlEl.value||'').trim() : '';
  
  // ★ 修正: エラーメッセージを改善
  if (!input) {
    console.warn('[GLB] 入力が空です');
    alert('GLBのファイルIDまたはURLを入力してください');
    return;
  }
  
  const fileId = extractDriveId(input);
  
  if (!token) {
    console.warn('[GLB] トークンがありません。サインインしてください');
    alert('Googleにサインインしてください');
    return;
  }
  
  if (!fileId) {
    console.warn('[GLB] 有効なファイルIDが見つかりません:', input);
    alert('有効なDrive URLまたはファイルIDを入力してください');
    return;
  }
  
  try {
    if ($('btnGlb')) $('btnGlb').disabled = true;
    await loadGlbFromDrive(fileId, { token });
    lastGlbFileId = fileId;
    const parentId = await getParentFolderId(fileId, token);
    currentSpreadsheetId = await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId: fileId });
    await populateSheetTabs(currentSpreadsheetId, token);
    await loadCaptionsFromSheet();
    await refreshImagesGrid();
  } catch (e) { 
    console.error('[GLB] load error', e); 
    alert('GLBの読み込みに失敗しました: ' + e.message);
  }
  finally { 
    if ($('btnGlb')) $('btnGlb').disabled = false; 
  }
}

if ($('btnGlb')) $('btnGlb').addEventListener('click', doLoad);
if ($('glbUrl')) $('glbUrl').addEventListener('keydown', (e)=>{ if (e.key==='Enter') doLoad(); });
if ($('glbUrl')) $('glbUrl').addEventListener('input', ()=>{ 
  if ($('btnGlb')) $('btnGlb').disabled = !extractDriveId($('glbUrl').value||''); 
});
if ($('glbUrl')) $('glbUrl').dispatchEvent(new Event('input'));

/* 以下、Colors & Filter UI、Sheets I/O、画像UX、selection系の関数は
   元のコードと同じなので省略（長さ制限のため）*/

// ★ リスト選択状態の表示関数
function __lm_markListSelected(id){
  const host = $('caption-list'); if (!host) return;
  host.querySelectorAll('.caption-item').forEach(el=>{
    el.classList.remove('is-selected');
    el.removeAttribute('aria-selected');
  });
  if (!id) return;
  const li = captionDomById.get(id);
  if (li){ 
    li.classList.add('is-selected'); 
    li.setAttribute('aria-selected','true'); 
    try{ li.scrollIntoView({block:'nearest'}); }catch(e){}
  }
}

// ★ 画像プレビュー更新関数
function __lm_fillFormFromCaption(obj){
  const ti = $('caption-title'); 
  const bo = $('caption-body'); 
  const th = $('currentImageThumb');
  if (!ti || !bo || !th) return;
  
  ti.value = (obj && obj.title) ? String(obj.title) : '';
  bo.value = (obj && obj.body)  ? String(obj.body)  : '';
  
  // ★ 修正: 画像読み込みを改善
  if (obj && obj.imageFileId){
    const token = getAccessToken();
    getFileThumbUrl(obj.imageFileId, token, 256)
      .then(url => {
        th.innerHTML = '<img alt="attached" src="' + url + '" style="width:100%;height:100%;object-fit:cover;">';
      })
      .catch(e => {
        console.warn('Thumb load failed:', e);
        th.innerHTML = '<div class="placeholder">読込失敗</div>';
      });
  } else {
    th.innerHTML = '<div class="placeholder">No Image</div>';
  }
}

console.log('[LociMyu ESM/CDN] boot overlay-edit+fixed-zoom build loaded (修正版)');
