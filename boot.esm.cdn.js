
// boot.esm.cdn.js — LociMyu boot (full build)
// Includes: selection highlight, overlay drag/close, right-pane thumbnail attach, list-side detach (×),
// Sheets I/O with ensureRow/ensureIndex, HEIC fallback, and GLB load with token retry (401→re-auth→retry once).
//
// This file is designed to run in non-module script context; avoid optional chaining / top-level await.

/* ======================== Imports (via global modules) ======================== */
// Expect these ESMs to be available at the same paths used in index.html
// viewer: canvas setup, glb loader, pin markers, selection callback, projectPoint
// auth: Google Identity helper
import { ensureViewer, onCanvasShiftPick, addPinMarker, setPinSelected, onPinSelect, loadGlbFromDrive, onRenderTick, projectPoint } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken, requestAccessTokenInteractive, ensureFreshToken } from './gauth.module.js';

/* ======================== Small DOM helpers ======================== */
function $(id){ return document.getElementById(id); }
function setEnabled(on){ for(var i=1;i<arguments.length;i++){ var el=arguments[i]; if(el) el.disabled = !on; } }
function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function textOrEmpty(v){ return (v==null?'':String(v)); }
function clamp(n,min,max){ return Math.min(Math.max(n,min),max); }

/* ======================== Auth & viewer boot ======================== */
ensureViewer({ canvas: $('gl') });

var __LM_CLIENT_ID = (window.GIS_CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
var __LM_API_KEY   = (window.GIS_API_KEY   || 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI');
var __LM_SCOPES    = (window.GIS_SCOPES    || 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets');

function onSigned(signed){
  document.documentElement.classList.toggle('signed-in', !!signed);
  setEnabled(!!signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('save-target-rename'), $('rename-input'));
}
setupAuth($('auth-signin'), onSigned, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });

/* ======================== Drive helpers ======================== */
function extractDriveId(input){
  if(!input) return null;
  var s = String(input).trim();
  var m = s.match(/^[A-Za-z0-9_-]{25,}$/);
  if(m) return m[0];
  try{
    var u = new URL(s);
    var q = u.searchParams.get('id');
    if(q && /^[A-Za-z0-9_-]{25,}$/.test(q)) return q;
    var seg = u.pathname.split('/').filter(Boolean);
    var ix = seg.indexOf('d');
    if(ix!==-1 && seg[ix+1] && /^[A-Za-z0-9_-]{25,}$/.test(seg[ix+1])) return seg[ix+1];
    var any = (u.href||'').match(/[A-Za-z0-9_-]{25,}/);
    if(any) return any[0];
  }catch(e){}
  var any2 = s.match(/[A-Za-z0-9_-]{25,}/);
  return any2? any2[0] : null;
}

function fetchJSON(url, opts){ return fetch(url, opts).then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.json(); }); }

function getFileThumbUrl(fileId, token, size){
  size = size|0; if(!size) size=1024;
  var url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=thumbnailLink&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization: 'Bearer '+token } }).then(function(r){
    if(!r.ok) throw new Error('thumb meta '+r.status);
    return r.json();
  }).then(function(j){
    if(!j.thumbnailLink) throw new Error('no thumbnailLink');
    var sz = clamp(size,64,2048);
    var sep = j.thumbnailLink.indexOf('?')>=0 ? '&' : '?';
    return j.thumbnailLink + sep + 'sz=s'+String(sz);
  });
}

function getFileBlobUrl(fileId, token){
  if(!fileId || !token) return Promise.reject(new Error('missing fileId/token'));
  var url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization: 'Bearer '+token } }).then(function(r){
    if(!r.ok) throw new Error('media '+r.status);
    var ct = (r.headers.get('Content-Type')||'').toLowerCase();
    if(/image\/(heic|heif)/.test(ct)){
      // Let caller fall back to thumbnail
      throw new Error('unsupported image format: HEIC');
    }
    return r.blob();
  }).then(function(blob){
    return URL.createObjectURL(blob);
  });
}

function getParentFolderId(fileId, token){
  var url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=parents&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization:'Bearer '+token } }).then(function(r){
    if(!r.ok) return null;
    return r.json();
  }).then(function(j){
    var parents = (j && j.parents) || [];
    return parents[0] || null;
  });
}

/* ======================== Global states ======================== */
var lastGlbFileId = null;
var currentSpreadsheetId = null;
var currentSheetId = null;
var currentSheetTitle = null;
var currentHeaders = [];
var currentHeaderIdx = {};
var currentPinColor = '#ff6b6b';
var selectedPinId = null;

// indices & caches
var captionsIndex = new Map(); // id -> { rowIndex }
var captionDomById = new Map(); // id -> element
var rowCache = new Map(); // id -> row
var overlays = new Map(); // id -> { root, imgEl }
var pendingUpdates = new Map(); // id -> fields

/* ======================== Inline style for selection ======================== */
(function(){
  var st = document.createElement('style');
  st.textContent = ".caption-item.is-selected{outline:2px solid #fff;outline-offset:-2px;border-radius:6px}";
  document.head.appendChild(st);
})();

/* ======================== Overlay (drag, close, line) ======================== */
var lineLayer = null;
function ensureLineLayer(){
  if(lineLayer) return lineLayer;
  var s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('width','100vw'); s.setAttribute('height','100vh');
  s.style.position='fixed'; s.style.left='0'; s.style.top='0';
  s.style.pointerEvents='none'; s.style.zIndex='999';
  document.body.appendChild(s);
  lineLayer = s;
  return s;
}
function getOrMakeLine(id){
  var l = ensureLineLayer();
  var el = l.querySelector('line[data-id="'+id+'"]');
  if(!el){
    el = document.createElementNS('http://www.w3.org/2000/svg','line');
    el.setAttribute('data-id', id);
    el.setAttribute('stroke', '#ffffffaa');
    el.setAttribute('stroke-width', '2');
    l.appendChild(el);
  }
  return el;
}
function removeLine(id){
  if(!lineLayer) return;
  var el = lineLayer.querySelector('line[data-id="'+id+'"]');
  if(el) el.remove();
}

function removeCaptionOverlay(id){
  var o = overlays.get(id);
  if(!o) return;
  o.root.remove();
  overlays.delete(id);
  removeLine(id);
}

function createCaptionOverlay(id, data){
  removeCaptionOverlay(id);
  var root = document.createElement('div'); root.className='cap-overlay';
  root.style.position='fixed'; root.style.zIndex='1000';
  root.style.background='#0b0f14ef'; root.style.color='#e5e7eb';
  root.style.padding='10px 12px'; root.style.borderRadius='10px';
  root.style.boxShadow='0 8px 24px #000a'; root.style.minWidth='200px'; root.style.maxWidth='300px';

  var topbar = document.createElement('div');
  topbar.style.display='flex'; topbar.style.gap='10px'; topbar.style.justifyContent='flex-end';
  topbar.style.marginBottom='6px'; topbar.style.cursor='move';

  var bClose = document.createElement('button'); bClose.textContent='×';
  bClose.style.border='none'; bClose.style.background='transparent'; bClose.style.color='#ddd'; bClose.style.cursor='pointer';
  topbar.appendChild(bClose);

  var t = document.createElement('div'); t.className='cap-title'; t.style.fontWeight='700'; t.style.marginBottom='6px';
  var body = document.createElement('div'); body.className='cap-body'; body.style.fontSize='12px'; body.style.opacity='.95'; body.style.whiteSpace='pre-wrap'; body.style.marginBottom='6px';
  var img = document.createElement('img'); img.className='cap-img'; img.alt=''; img.style.display='none'; img.style.width='100%'; img.style.height='auto'; img.style.borderRadius='8px';

  var safeTitle = (data && data.title ? String(data.title).trim() : '') || '(untitled)';
  var safeBody  = (data && data.body  ? String(data.body ).trim() : '') || '(no description)';
  t.textContent = safeTitle; body.textContent = safeBody;

  // drag
  var dragging=false, startX=0, startY=0, baseLeft=0, baseTop=0;
  topbar.addEventListener('pointerdown', function(ev){
    dragging=true; startX=ev.clientX; startY=ev.clientY;
    baseLeft=parseFloat(root.style.left||'0'); baseTop=parseFloat(root.style.top||'0');
    if(root.setPointerCapture) root.setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  });
  window.addEventListener('pointermove', function(ev){
    if(!dragging) return;
    var dx=ev.clientX-startX, dy=ev.clientY-startY;
    root.style.left=(baseLeft+dx)+'px'; root.style.top=(baseTop+dy)+'px';
  });
  window.addEventListener('pointerup', function(){ dragging=false; });

  // load image if any
  (function(){
    try{
      var token = getAccessToken();
      var row = rowCache.get(id);
      if(token && row && row.imageFileId){
        getFileBlobUrl(row.imageFileId, token).then(function(url){
          img.src=url; img.style.display='block';
        }).catch(function(){
          return getFileThumbUrl(row.imageFileId, token, 1024).then(function(url){
            img.src=url; img.style.display='block';
          }).catch(function(){});
        });
      }
    }catch(e){}
  })();

  bClose.addEventListener('click', function(e){ e.stopPropagation(); removeCaptionOverlay(id); });

  root.appendChild(topbar); root.appendChild(t); root.appendChild(body); root.appendChild(img);
  document.body.appendChild(root);
  overlays.set(id, { root:root, imgEl:img });
  applyOverlayZoom(id, 1.0);
  updateOverlayPosition(id, true);
}

function applyOverlayZoom(id, z){
  var o = overlays.get(id); if(!o) return;
  var BASE=260;
  o.root.style.maxWidth = (BASE*z)+'px';
  o.root.style.minWidth = (200*z)+'px';
  updateOverlayPosition(id);
}

function updateOverlayPosition(id, initial){
  var o = overlays.get(id); if(!o) return;
  var d = rowCache.get(id); if(!d) return;
  var p = projectPoint(d.x, d.y, d.z);
  if(!p.visible){
    o.root.style.display='none'; removeLine(id); return;
  }
  o.root.style.display='block';
  if(initial && !o.root.style.left){
    o.root.style.left=(p.x+14)+'px'; o.root.style.top=(p.y+14)+'px';
  }
  var r = o.root.getBoundingClientRect();
  var line = getOrMakeLine(id);
  var cx = Math.min(Math.max(p.x, r.left), r.right);
  var cy = Math.min(Math.max(p.y, r.top ), r.bottom);
  line.setAttribute('x1', String(cx));
  line.setAttribute('y1', String(cy));
  line.setAttribute('x2', String(p.x));
  line.setAttribute('y2', String(p.y));
}

onRenderTick(function(){ overlays.forEach(function(_,id){ updateOverlayPosition(id,false); }); });

/* ======================== Selection helpers ======================== */
function __lm_markListSelected(id){
  var host = $('caption-list'); if(!host) return;
  var olds = host.querySelectorAll('.caption-item.is-selected');
  for(var i=0;i<olds.length;i++){ olds[i].classList.remove('is-selected'); }
  var el = host.querySelector('.caption-item[data-id="'+CSS.escape(id)+'"]');
  if(el) el.classList.add('is-selected');
}
function __lm_fillFormFromCaption(id){
  var row = rowCache.get(id) || {};
  var t=$('caption-title'), b=$('caption-body');
  if(t) t.value = row.title || '';
  if(b) b.value = row.body  || '';
}
function selectCaption(id){
  selectedPinId = id;
  __lm_markListSelected(id);
  __lm_fillFormFromCaption(id);
  setPinSelected(id, true);
  createCaptionOverlay(id, rowCache.get(id) || {});
}

onPinSelect(function(id){ selectCaption(id); });

/* ======================== Sheets I/O ======================== */
var LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId','createdAt','updatedAt'];

function putValues(spreadsheetId, rangeA1, values, token){
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent(rangeA1)+'?valueInputOption=RAW';
  return fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values: values }) });
}
function appendValues(spreadsheetId, rangeA1, values, token){
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent(rangeA1)+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values: values }) });
}
function getValues(spreadsheetId, rangeA1, token){
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent(rangeA1);
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(function(r){ if(!r.ok) throw new Error('values.get '+r.status); return r.json(); }).then(function(d){ return d.values||[]; });
}
function colA1(i0){ var n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }

function isLociMyuSpreadsheet(spreadsheetId, token){
  var url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))';
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(function(res){
    if(!res.ok) return false; return res.json();
  }).then(function(data){
    if(!data || !Array.isArray(data.sheets)) return false;
    for(var i=0;i<data.sheets.length;i++){
      var s = data.sheets[i];
      var d = (s&&s.data)||[]; if(!d[0]) continue;
      var row = d[0].rowData || []; var vals = (row[0]||{}).values || [];
      var headers = [];
      for(var j=0;j<vals.length;j++){
        var v = vals[j]; var fv = v && v.formattedValue ? String(v.formattedValue).trim().toLowerCase() : '';
        if(fv) headers.push(fv);
      }
      if(headers.indexOf('title')>=0 && headers.indexOf('body')>=0 && headers.indexOf('color')>=0) return true;
    }
    return false;
  });
}
function createLociMyuSpreadsheet(parentFolderId, token, opts){
  var glbId = (opts && opts.glbId) ? opts.glbId : '';
  var name = ('LociMyu_Save_'+glbId).replace(/_+$/,'');
  var url = 'https://www.googleapis.com/drive/v3/files';
  var body = { name:name, mimeType:'application/vnd.google-apps.spreadsheet' };
  if(parentFolderId) body.parents = [ parentFolderId ];
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
  .then(function(r){ if(!r.ok) throw new Error('Drive files.create '+r.status); return r.json(); })
  .then(function(file){
    var spreadsheetId = file.id;
    return putValues(spreadsheetId, 'A1:Z1', [LOCIMYU_HEADERS], token).then(function(){ return spreadsheetId; });
  });
}
function findOrCreateLociMyuSpreadsheet(parentFolderId, token, opts){
  if(!parentFolderId) return Promise.reject(new Error('parentFolderId required'));
  var q = encodeURIComponent("'"+parentFolderId+"' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  var url='https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true';
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(function(r){
    if(!r.ok) throw new Error('Drive list spreadsheets '+r.status);
    return r.json();
  }).then(function(d){
    var files = d.files || [];
    function next(i){
      if(i>=files.length) return createLociMyuSpreadsheet(parentFolderId, token, opts||{});
      return isLociMyuSpreadsheet(files[i].id, token).then(function(ok){
        return ok ? files[i].id : next(i+1);
      });
    }
    return next(0);
  });
}

function populateSheetTabs(spreadsheetId, token){
  var sel = $('save-target-sheet'); if(!sel||!spreadsheetId) return Promise.resolve();
  sel.innerHTML = '<option value="">Loading…</option>';
  var url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'?fields=sheets(properties(title,sheetId,index))';
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(function(r){
    if(!r.ok){ sel.innerHTML='<option value="">(error)</option>'; return null; }
    return r.json();
  }).then(function(data){
    if(!data) return;
    var sheets = (data.sheets||[]).map(function(s){ return s.properties; }).sort(function(a,b){ return a.index-b.index; });
    sel.innerHTML='';
    for(var i=0;i<sheets.length;i++){
      var p = sheets[i];
      var opt = document.createElement('option');
      opt.value = String(p.sheetId);
      opt.textContent = p.title;
      opt.dataset.title = p.title;
      sel.appendChild(opt);
    }
    var first = sheets[0];
    currentSheetId = first ? first.sheetId : null;
    currentSheetTitle = first ? first.title : null;
    if(currentSheetId) sel.value = String(currentSheetId);
  });
}
var sheetSel = $('save-target-sheet');
if(sheetSel){
  sheetSel.addEventListener('change', function(e){
    var sel = e.target;
    var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    currentSheetId = opt && opt.value ? Number(opt.value) : null;
    currentSheetTitle = (opt && opt.dataset && opt.dataset.title) ? opt.dataset.title : null;
    loadCaptionsFromSheet();
  });
}
var btnCreate = $('save-target-create');
if(btnCreate){
  btnCreate.addEventListener('click', function(){
    var token = getAccessToken(); if(!token||!currentSpreadsheetId) return;
    var title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    var url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(currentSpreadsheetId)+':batchUpdate';
    var body={ requests:[{ addSheet:{ properties:{ title: title } } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    .then(function(r){ if(!r.ok) throw new Error(String(r.status)); })
    .then(function(){ return populateSheetTabs(currentSpreadsheetId, token); })
    .then(function(){ return loadCaptionsFromSheet(); })
    .catch(function(e){ console.error('[Sheets addSheet] failed', e); });
  });
}
var btnRename = $('save-target-rename');
if(btnRename){
  btnRename.addEventListener('click', function(){
    var token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetId) return;
    var input=$('rename-input'); var newTitle = input && input.value ? String(input.value).trim() : '';
    if(!newTitle) return;
    var url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(currentSpreadsheetId)+':batchUpdate';
    var body={ requests:[{ updateSheetProperties:{ properties:{ sheetId: currentSheetId, title: newTitle }, fields: 'title' } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    .then(function(r){ if(!r.ok) throw new Error(String(r.status)); })
    .then(function(){ return populateSheetTabs(currentSpreadsheetId, token); })
    .then(function(){ return loadCaptionsFromSheet(); })
    .catch(function(e){ console.error('[Sheets rename] failed', e); });
  });
}

/* ======================== Index / ensure row ======================== */
function ensureIndex(){
  captionsIndex.clear();
  var token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return Promise.resolve(false);
  return getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token).then(function(values){
    if(!values.length) return false;
    currentHeaders = values[0].map(function(v){ return textOrEmpty(v).trim(); });
    currentHeaderIdx = {};
    for(var i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()] = i; }
    var iId = (currentHeaderIdx['id']!=null) ? currentHeaderIdx['id'] : -1;
    for(var r=1;r<values.length;r++){
      var row=values[r]||[]; var id=row[iId];
      if(!id) continue;
      captionsIndex.set(String(id), { rowIndex: r+1 });
    }
    return true;
  }).catch(function(e){
    console.warn('[ensureIndex] values.get failed, continue', e);
    return false;
  });
}

function sheetsAppendRow(spreadsheetId, sheetTitle, obj){
  var token=getAccessToken(); if(!token) return Promise.resolve();
  var now=new Date().toISOString();
  var vals=[[ obj.id, obj.title||'', obj.body||'', obj.color||currentPinColor, obj.x||0, obj.y||0, obj.z||0, obj.imageFileId||'', obj.createdAt||now, obj.updatedAt||now ]];
  return appendValues(spreadsheetId, "'"+sheetTitle+"'!A:Z", vals, token).then(function(){ return ensureIndex(); });
}

function ensureRow(id, seed){
  if(rowCache.has(id)) return Promise.resolve(rowCache.get(id));
  return ensureIndex().then(function(ok){
    if(captionsIndex.has(id)){
      var cur=rowCache.get(id)||{id:id};
      var merged=Object.assign({}, cur, seed||{}); rowCache.set(id, merged);
      return merged;
    }
    if(!currentSpreadsheetId){
      console.warn('[ensureRow] no spreadsheet, cache only');
      var rowOnly=Object.assign({id:id}, seed||{}); rowCache.set(id,rowOnly);
      return rowOnly;
    }
    var sheetTitle=currentSheetTitle||'シート1';
    var row=Object.assign({
      id:id, title:'', body:'', color:currentPinColor,
      x:0,y:0,z:0, imageFileId:'',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    }, seed||{});
    return sheetsAppendRow(currentSpreadsheetId, sheetTitle, row).then(function(){
      rowCache.set(id,row); return row;
    });
  });
}

/* ======================== Caption list UI ======================== */
function clearCaptionList(){
  var host=$('caption-list'); if(host) host.innerHTML='';
  captionDomById.clear();
}
function appendCaptionItem(row){
  var host=$('caption-list'); if(!host||!row) return;
  var div=document.createElement('div'); div.className='caption-item'; div.dataset.id=row.id;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  var safeTitle=(row.title||'').trim()||'(untitled)';
  var safeBody =(row.body ||'').trim()||'(no description)';
  var img;
  if(row.imageUrl){
    img=document.createElement('img'); img.src=row.imageUrl; img.alt=''; div.appendChild(img);
  }
  var txt=document.createElement('div'); txt.className='cap-txt';
  var t=document.createElement('div'); t.className='cap-title'; t.textContent=safeTitle;
  var b=document.createElement('div'); b.className='cap-body hint'; b.textContent=safeBody;
  txt.appendChild(t); txt.appendChild(b); div.appendChild(txt);
  // detach ×
  var detach=document.createElement('button'); detach.className='c-del'; detach.title='Detach image'; detach.textContent='×';
  detach.addEventListener('click', function(e){ e.stopPropagation(); updateImageForPin(row.id, null); });
  div.appendChild(detach);
  div.addEventListener('click', function(){ selectCaption(row.id); });
  host.appendChild(div); captionDomById.set(row.id, div);
}
function enrichRow(row){
  var token=getAccessToken(); var p=Promise.resolve('');
  if(row.imageFileId){
    p = getFileThumbUrl(row.imageFileId, token, 256).catch(function(){ return ''; });
  }
  return p.then(function(imageUrl){
    var enriched=Object.assign({}, row, { imageUrl:imageUrl });
    rowCache.set(row.id, enriched);
    return enriched;
  });
}

/* ======================== Save / Update / Delete ======================== */
function reflectRowToUI(id){
  var row=rowCache.get(id)||{};
  // form (only if selected)
  if(selectedPinId===id){
    var t=$('caption-title'), b=$('caption-body');
    if(t && document.activeElement!==t) t.value=row.title||'';
    if(b && document.activeElement!==b) b.value=row.body||'';
  }
  var host=$('caption-list'); if(!host) return;
  var div=captionDomById.get(id);
  if(!div){ appendCaptionItem(Object.assign({id:id}, row)); div=captionDomById.get(id); }
  if(!div) return;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  var img=div.querySelector('img');
  if(row.imageFileId){
    if(!img){ img=document.createElement('img'); img.alt=''; div.insertBefore(img, div.firstChild); }
    var token=getAccessToken();
    getFileThumbUrl(row.imageFileId, token, 256).then(function(url){ img.src=url; }).catch(function(){ if(img) img.remove(); });
  }else{
    if(img) img.remove();
  }
}

function updateCaptionForPin(id, fields){
  var cached=rowCache.get(id)||{id:id};
  var seed=Object.assign({}, cached, fields||{});
  return ensureRow(id, seed).then(function(){
    return ensureIndex();
  }).then(function(){
    var meta=captionsIndex.get(id);
    if(!meta && currentSpreadsheetId){
      var sheetTitle=currentSheetTitle||'シート1';
      return sheetsAppendRow(currentSpreadsheetId, sheetTitle, {
        id:id,
        title:seed.title||'',
        body:seed.body||'',
        color:seed.color||currentPinColor,
        x:('x' in seed)?seed.x:0, y:('y' in seed)?seed.y:0, z:('z' in seed)?seed.z:0,
        imageFileId:seed.imageFileId||''
      }).then(function(){ meta=captionsIndex.get(id); return meta; });
    }
    return meta;
  }).then(function(meta){
    if(!meta){
      var prev=pendingUpdates.get(id)||{}; pendingUpdates.set(id, Object.assign(prev, fields||{}));
      var cached=rowCache.get(id)||{id:id}; Object.assign(cached, fields||{}); rowCache.set(id,cached);
      reflectRowToUI(id);
      throw new Error('row not found');
    }
    var token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
    var rowIdx=meta.rowIndex;
    return getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A"+rowIdx+":Z"+rowIdx, token).then(function(values){
      var row=(values[0]||[]).slice();
      var lower=(currentHeaders||[]).map(function(h){ return String(h||'').toLowerCase(); });
      function idx(name){ return lower.indexOf(name); }
      function put(col,val){ var i=idx(col); if(i>=0){ row[i]= (val==null?'':String(val)); } }
      if(fields && ('title' in fields)) put('title', fields.title);
      if(fields && ('body'  in fields)) put('body',  fields.body);
      if(fields && ('color' in fields)) put('color', fields.color);
      if(fields && ('x' in fields)) put('x', fields.x);
      if(fields && ('y' in fields)) put('y', fields.y);
      if(fields && ('z' in fields)) put('z', fields.z);
      if(fields && ('imageFileId' in fields)) put('imagefileid', fields.imageFileId);
      put('updatedat', new Date().toISOString());
      var lastCol = Math.max(row.length-1, 9);
      return putValues(currentSpreadsheetId,"'"+currentSheetTitle+"'!A"+rowIdx+":"+colA1(lastCol)+rowIdx,[row], token);
    }).then(function(){
      var cached=rowCache.get(id)||{id:id};
      Object.assign(cached, fields||{}); rowCache.set(id,cached);
      reflectRowToUI(id);
    });
  });
}

function updateImageForPin(id, fileId){
  var token=getAccessToken(); if(!token) return Promise.resolve();
  var cached=rowCache.get(id)||{id:id}; cached.imageFileId = fileId||''; rowCache.set(id,cached);
  reflectRowToUI(id);
  var o=overlays.get(id);
  if(o && fileId){
    return getFileBlobUrl(fileId, token).then(function(url){
      o.imgEl.src=url; o.imgEl.style.display='block';
    }).catch(function(){
      return getFileThumbUrl(fileId, token, 1024).then(function(url){
        o.imgEl.src=url; o.imgEl.style.display='block';
      }).catch(function(){ o.imgEl.style.display='none'; });
    }).then(function(){ return updateCaptionForPin(id, { imageFileId: fileId||'' }); });
  }else if(o && !fileId){
    o.imgEl.style.display='none';
  }
  return updateCaptionForPin(id, { imageFileId: fileId||'' });
}

/* ======================== Load captions from sheet ======================== */
function loadCaptionsFromSheet(){
  clearCaptionList(); captionsIndex.clear();
  var token=getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return Promise.resolve();
  return getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token).then(function(values){
    if(!values.length) return;
    currentHeaders=values[0].map(function(v){ return textOrEmpty(v).trim(); });
    currentHeaderIdx={}; for(var i=0;i<currentHeaders.length;i++){ currentHeaderIdx[currentHeaders[i].toLowerCase()] = i; }
    var H=currentHeaderIdx;
    function at(h){ var i=H[h]; return (i==null?-1:i); }
    for(var r=1;r<values.length;r++){
      var row=values[r]||[];
      var rec={
        id: row[at('id')]||uid(),
        title: row[at('title')]||'',
        body: row[at('body')]||'',
        color: row[at('color')]||currentPinColor,
        x: Number(row[at('x')]||0),
        y: Number(row[at('y')]||0),
        z: Number(row[at('z')]||0),
        imageFileId: row[at('imagefileid')]||row[at('imageFileId')]||''
      };
      captionsIndex.set(String(rec.id), { rowIndex: r+1 });
      rowCache.set(String(rec.id), rec);
    }
    // Enrich & render
    var ids = Array.from(rowCache.keys());
    function step(i){
      if(i>=ids.length) return;
      var id=ids[i]; var rec=rowCache.get(id);
      enrichRow(rec).then(function(enriched){
        appendCaptionItem(enriched);
        addPinMarker(enriched.id, enriched.x, enriched.y, enriched.z, enriched.color||currentPinColor);
        step(i+1);
      }).catch(function(){ step(i+1); });
    }
    step(0);
  });
}

/* ======================== GLB load with token retry ======================== */
function doLoad(){
  var input = $('glbUrl') && $('glbUrl').value ? $('glbUrl').value : '';
  var fileId = extractDriveId(input);
  if(!fileId){ console.warn('[GLB] missing token or fileId'); alert('トークンかファイルIDがありません。サインインしてID/URLを入力してください'); return; }

  // Token: use existing or ensure
  var token = getAccessToken();
  function runLoad(tok){
    return loadGlbFromDrive(fileId, { token: tok }).then(function(){
      lastGlbFileId = fileId;
      return getParentFolderId(fileId, tok).then(function(parentId){
        return findOrCreateLociMyuSpreadsheet(parentId, tok, { glbId: fileId.slice(0,6) });
      }).then(function(ssId){
        currentSpreadsheetId = ssId;
        return populateSheetTabs(ssId, tok);
      }).then(function(){ return loadCaptionsFromSheet(); })
      .then(function(){ console.info('[LociMyu ESM/CDN] boot overlay-edit+fixed-zoom build loaded (401-retry版)'); });
    });
  }

  function after401(){
    // If helper exists, request interactive token; else ask user to Sign in
    if(typeof requestAccessTokenInteractive === 'function'){
      return requestAccessTokenInteractive('consent').then(function(tok){
        if(!tok) throw new Error('re-auth failed');
        return runLoad(tok);
      });
    }else{
      alert('認可が必要です。右上の Sign in を押して再ログインしてください。');
      throw new Error('no interactive reauth available');
    }
  }

  var ensure = (typeof ensureFreshToken==='function') ? ensureFreshToken({ interactive:false }) : Promise.resolve(token);
  ensure.then(function(tok){ return tok || token; }).then(function(tok){
    if(!tok){
      if(typeof requestAccessTokenInteractive==='function'){
        return requestAccessTokenInteractive('consent');
      }else{
        alert('サインインしてください'); throw new Error('no token');
      }
    }
    return tok;
  }).then(function(tok){
    return runLoad(tok);
  }).catch(function(e){
    var msg = String(e && e.message || e);
    if(msg.indexOf('GLB fetch failed 401')>=0 || msg.indexOf('http 401')>=0 || msg.indexOf('media 401')>=0){
      console.warn('[GLB] 401 → re-auth and retry once');
      return after401();
    }
    console.error('[GLB] load error', e);
    alert('GLBの読み込みに失敗しました: '+msg);
  });
}

var btnGlb = $('btnGlb');
if(btnGlb){ btnGlb.addEventListener('click', doLoad); }
var glbUrlInput = $('glbUrl');
if(glbUrlInput){ glbUrlInput.addEventListener('keydown', function(e){ if(e.key==='Enter') doLoad(); }); }

/* ======================== Inputs & autosave ======================== */
function debounce(fn,ms){ var t=null; return function(){ var ctx=this, args=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(ctx,args); }, ms); }; }
var autoSave = debounce(function(){
  if(!selectedPinId) return;
  var t=$('caption-title'), b=$('caption-body');
  updateCaptionForPin(selectedPinId, { title: (t&&t.value)?t.value:'', body: (b&&b.value)?b.value:'' })
  .catch(function(e){ console.warn('[caption autosave failed]', e); });
}, 600);
var ti = $('caption-title'); if(ti) ti.addEventListener('input', autoSave);
var bi = $('caption-body'); if(bi) bi.addEventListener('input', autoSave);

/* ======================== Right pane images grid (attach by click) ======================== */
var imagesGrid = $('images-grid');
if(imagesGrid){
  imagesGrid.addEventListener('click', function(ev){
    var t = ev.target;
    if(!t || t.tagName!=='IMG') return;
    if(!selectedPinId){ alert('先にキャプション（ピン）を選択してください'); return; }
    var fid = t.getAttribute('data-file-id') || t.dataset.fileId || '';
    var id = extractDriveId(fid);
    if(!id){ console.warn('[attach] invalid file id', fid); return; }
    updateImageForPin(selectedPinId, id);
  });
}

/* ======================== Create pin from canvas (Shift+pick) ======================== */
onCanvasShiftPick(function(pos){
  var id=uid();
  ensureRow(id, { id:id, x:pos.x, y:pos.y, z:pos.z, color:currentPinColor, title:'', body:'' }).then(function(){
    addPinMarker(id, pos.x, pos.y, pos.z, currentPinColor);
    selectCaption(id);
    return updateCaptionForPin(id, { x:pos.x, y:pos.y, z:pos.z });
  });
});

/* ======================== Flush pending ======================== */
function flushPending(){
  if(!pendingUpdates.size) return;
  ensureIndex().then(function(ok){
    if(!ok) return;
    var entries = Array.from(pendingUpdates.entries());
    function step(i){
      if(i>=entries.length) return;
      var pair = entries[i];
      updateCaptionForPin(pair[0], pair[1]).then(function(){ pendingUpdates.delete(pair[0]); step(i+1); }).catch(function(){ step(i+1); });
    }
    step(0);
  });
}
setInterval(flushPending, 2000);

/* ======================== Debug exports ======================== */
window.__lm_selectPin = selectCaption;
window.__lm_markListSelected = __lm_markListSelected;
window.__lm_fillFormFromCaption = __lm_fillFormFromCaption;
