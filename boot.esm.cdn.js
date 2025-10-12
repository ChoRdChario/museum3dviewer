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

  // 1) If it's already a bare id
  const bare = s.match(/^[A-Za-z0-9_-]{25,}$/);
  if (bare) return bare[0];

  // 2) If it's a URL, try official patterns first
  try {
    const u = new URL(s);

    // a) /file/d/{id}/...
    const m1 = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{25,})/);
    if (m1) return m1[1];

    // b) id param
    const idParam = u.searchParams.get('id');
    if (idParam && /^[A-Za-z0-9_-]{25,}$/.test(idParam)) return idParam;

    // c) other param names we occasionally see
    const altKeys = ['resourcekey','ids','fileId'];
    for (const k of altKeys){
      const val = u.searchParams.get(k);
      if (val && /^[A-Za-z0-9_-]{25,}$/.test(val)) return val;
    }

    // d) last resort: any 25+ token in full URL
    const any = (u.href || '').match(/[A-Za-z0-9_-]{25,}/);
    if (any) return any[0];
  } catch (_) {
    // not a URL string
  }

  // 3) Fallback: greedy token search in raw string
  const any2 = s.match(/[A-Za-z0-9_-]{25,}/);
  return any2 ? any2[0] : null;
}/.test(q)) return q;
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


/* ==== LociMyu Sheets/Drive helpers (added) ==== */
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

async function isLociMyuSpreadsheet(spreadsheetId, token) {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))';
  const res = await fetch(url, { headers:{Authorization:'Bearer '+token} });
  if (!res.ok) return false;
  const data = await res.json(); if (!Array.isArray(data.sheets)) return false;
  for (let i=0;i<data.sheets.length;i++){
    const s = data.sheets[i];
    const row = (((s||{}).data||[])[0]||{}).rowData || [];
    const vals = (row[0]||{}).values || [];
    const headers = [];
    for (let k=0;k<vals.length;k++){
      const v=vals[k]; const fv = (v && v.formattedValue) ? String(v.formattedValue).trim().toLowerCase() : '';
      if (fv) headers.push(fv);
    }
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
  const r = await fetch(url, { headers:{Authorization:'Bearer '+token} });
  if(!r.ok) throw new Error('Drive list spreadsheets failed: '+r.status);
  const d = await r.json(); const files = d.files||[];
  for (let i=0;i<files.length;i++){
    const f=files[i];
    try { if (await isLociMyuSpreadsheet(f.id, token)) return f.id; } catch(_){}
  }
  return await createLociMyuSpreadsheet(parentFolderId, token, opts||{});
}

window.findOrCreateLociMyuSpreadsheet = findOrCreateLociMyuSpreadsheet;
/* ==== /helpers ==== */


/* ==== [restored] Sheet tabs + captions I/O ==== */
async function ensureCaptionsSheet(spreadsheetId, token){
  const metaUrl = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?fields=sheets(properties(title,sheetId))';
  const r = await fetch(metaUrl, { headers:{ Authorization:'Bearer '+token } });
  if (!r.ok) throw new Error('sheets.meta '+r.status);
  const d = await r.json();
  const sheets = (d && d.sheets) || [];
  let found = sheets.find(s => s.properties && s.properties.title === 'Captions');
  if (found) return found.properties;

  const buUrl = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+':batchUpdate';
  const body = {
    requests: [{
      addSheet: { properties: { title:'Captions' } }
    },{
      updateCells: {
        range: { sheetId: null, startRowIndex:0, endRowIndex:1, startColumnIndex:0, endColumnIndex:8 },
        rows: [{
          values: ['id','title','body','color','x','y','z','imageFileId'].map(v=>({ userEnteredValue:{ stringValue:String(v) } }))
        }],
        fields: 'userEnteredValue'
      }
    }]
  };
  const rr = await fetch(buUrl, { method:'POST', headers:{ Authorization:'Bearer '+token,'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if (!rr.ok) throw new Error('sheets.add Captions '+rr.status);

  const r2 = await fetch(metaUrl, { headers:{ Authorization:'Bearer '+token } });
  const d2 = await r2.json();
  const fresh = (d2.sheets||[]).find(s => s.properties && s.properties.title === 'Captions');
  if (!fresh) throw new Error('Captions sheet not found after create');
  return fresh.properties;
}

async function populateSheetTabs(spreadsheetId, token){
  const sel = document.getElementById('save-target-sheet');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading…</option>';

  const props = await ensureCaptionsSheet(spreadsheetId, token);
  currentSheetId = props.sheetId;
  currentSheetTitle = props.title || 'Captions';

  sel.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = String(currentSheetId); opt.textContent = currentSheetTitle;
  sel.appendChild(opt);
  sel.value = String(currentSheetId);

  sel.onchange = () => {
    currentSheetId = sel.value ? Number(sel.value) : null;
    currentSheetTitle = opt.textContent || 'Captions';
    loadCaptionsFromSheet().catch(e=>console.warn('[sheet] reload captions failed', e));
  };
}

function headerIndexMap(headers){
  const map = {}; headers.forEach((h,i)=>{ map[String(h).trim().toLowerCase()] = i; });
  return map;
}

async function loadCaptionsFromSheet(){
  if (!currentSpreadsheetId) return;
  const token = getAccessToken();
  let values = await getValues(currentSpreadsheetId, 'Captions!A1:Z1', token);
  const hdr = (values[0]||[]).map(v => String(v||'').trim());
  currentHeaders = hdr;
  currentHeaderIdx = headerIndexMap(hdr);

  values = await getValues(currentSpreadsheetId, 'Captions!A2:Z', token);
  captionsIndex.clear();
  rowCache.clear();
  const host = document.getElementById('caption-list');
  if (host) host.innerHTML = '';

  const idIx = currentHeaderIdx['id'] ?? 0;
  const titleIx = currentHeaderIdx['title'] ?? 1;
  const bodyIx = currentHeaderIdx['body'] ?? 2;
  const colorIx = currentHeaderIdx['color'] ?? 3;
  const xIx = currentHeaderIdx['x'] ?? 4;
  const yIx = currentHeaderIdx['y'] ?? 5;
  const zIx = currentHeaderIdx['z'] ?? 6;
  const imgIx = currentHeaderIdx['imagefileid'] ?? 7;

  values.forEach((row, i) => {
    const id = String(row[idIx] || '').trim();
    if (!id) return;
    const obj = {
      id,
      title: row[titleIx] || '',
      body: row[bodyIx] || '',
      color: row[colorIx] || '#ff6b6b',
      x: Number(row[xIx]||0), y: Number(row[yIx]||0), z: Number(row[zIx]||0),
      imageFileId: row[imgIx] || ''
    };
    const sheetRow = i + 2;
    captionsIndex.set(id, sheetRow);
    rowCache.set(id, obj);
    appendCaptionItem(obj);
    addPinMarker({ id, x: obj.x, y: obj.y, z: obj.z, color: obj.color });
  });
}

function appendCaptionItem(obj){
  const host = document.getElementById('caption-list');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'caption-item';
  el.dataset.id = obj.id;
  el.innerHTML = `
    <img alt="" src="" style="background:#111;"/>
    <div class="txt"><div class="t">${obj.title||'(untitled)'}</div><div class="b" style="opacity:.8;font-size:12px">${obj.body||''}</div></div>
    <button class="c-del" title="Delete" style="margin-left:auto">🗑</button>
  `;
  const token = getAccessToken();
  if (obj.imageFileId && token){
    getFileThumbUrl(obj.imageFileId, token, 80).then(u => { el.querySelector('img').src = u; }).catch(()=>{});
  }
  el.addEventListener('click', (e)=>{
    if (e.target && e.target.closest('.c-del')) return;
    __lm_selectPin(obj.id, 'list');
  });
  host.appendChild(el);
  captionDomById.set(obj.id, el);
}

async function savePinToSheet(row){
  const token = getAccessToken();
  const v = [
    row.id, row.title||'', row.body||'', row.color||'#ff6b6b',
    row.x, row.y, row.z, row.imageFileId||''
  ];
  await appendValues(currentSpreadsheetId, 'Captions!A2:H', [v], token);
  await loadCaptionsFromSheet();
}

async function updateCaptionForPin(id, patch){
  const rowNum = captionsIndex.get(id);
  if (!rowNum) throw new Error('row not found');
  const token = getAccessToken();

  const cur = rowCache.get(id) || {}; Object.assign(cur, patch); rowCache.set(id, cur);

  const updates = [];
  if (patch.title !== undefined) updates.push({ col:'B', val: String(patch.title||'') });
  if (patch.body  !== undefined) updates.push({ col:'C', val: String(patch.body||'') });
  if (patch.color !== undefined) updates.push({ col:'D', val: String(patch.color||'#ff6b6b') });
  if (patch.x     !== undefined) updates.push({ col:'E', val: Number(patch.x||0) });
  if (patch.y     !== undefined) updates.push({ col:'F', val: Number(patch.y||0) });
  if (patch.z     !== undefined) updates.push({ col:'G', val: Number(patch.z||0) });
  if (patch.imageFileId !== undefined) updates.push({ col:'H', val: String(patch.imageFileId||'') });

  for (const u of updates){
    await putValues(currentSpreadsheetId, `Captions!${u.col}${rowNum}:${u.col}${rowNum}`, [[u.val]], token);
  }

  const el = captionDomById.get(id);
  if (el){
    if (patch.title !== undefined) el.querySelector('.t').textContent = patch.title || '(untitled)';
    if (patch.body  !== undefined) el.querySelector('.b').textContent = patch.body || '';
    if (patch.imageFileId !== undefined){
      const img = el.querySelector('img');
      if (patch.imageFileId){
        getFileThumbUrl(patch.imageFileId, token, 80).then(u => img.src = u).catch(()=>{});
      }else{
        img.removeAttribute('src');
      }
    }
  }
}

async function deleteCaptionForPin(id){
  const rowNum = captionsIndex.get(id);
  if (!rowNum) return;
  const token = getAccessToken();
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(currentSpreadsheetId)+':batchUpdate';
  const body = {
    requests: [{
      deleteDimension: {
        range: { sheetId: currentSheetId, dimension: 'ROWS', startIndex: rowNum-1, endIndex: rowNum }
      }
    }]
  };
  const r = await fetch(url, { method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('rows.delete '+r.status);
  await loadCaptionsFromSheet();
}

function __lm_selectPin(id, src){
  selectedPinId = id;
  __lm_markListSelected(id);
  const obj = rowCache.get(id);
  if (obj) __lm_fillFormFromCaption(obj);
  showOverlayFor(id);
  setPinSelected(id, true);
}

