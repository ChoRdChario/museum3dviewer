// boot.esm.cdn.js — LociMyu boot (clean full build, overlay image + Sheets delete fixes)
// === LM helpers injected (auth + drive fetch) ===
;(function(){
  if (typeof window === 'undefined') return;
  if (window.__lm_fetchDrive) return; // already defined

  window.__lm_getAuth = window.__lm_getAuth || function __lm_getAuth() {
    return {
      ensureToken: (window.__LM_auth && window.__LM_auth.ensureToken) || (window.ensureToken) || (async () => window.__LM_TOK),
      getAccessToken: (window.__LM_auth && window.__LM_auth.getAccessToken) || (window.getAccessToken) || (() => window.__LM_TOK)
    };
  };

  window.__lm_fetchDrive = async function __lm_fetchDrive(url, init) {
    init = init || {};
    const g = window.__lm_getAuth();
    let tok = (g.getAccessToken && g.getAccessToken()) || window.__LM_TOK || null;
    if (!tok && g.ensureToken) {
      try { tok = await g.ensureToken({ prompt: undefined }); } catch (e) {}
      if (!tok && g.getAccessToken) tok = g.getAccessToken();
    }
    const baseHeaders = new Headers(init.headers || {});
    if (tok && !baseHeaders.has('Authorization')) {
      baseHeaders.set('Authorization', 'Bearer ' + tok);
    }
    async function doFetch() { return fetch(url, Object.assign({}, init, { headers: baseHeaders })); }
    let res = await doFetch();
    if (res.status === 401 && g.ensureToken) {
      try {
        const fresh = await g.ensureToken({ prompt: undefined });
        if (fresh) {
          baseHeaders.set('Authorization', 'Bearer ' + fresh);
          res = await doFetch();
        }
      } catch (e) {}
    }
    return res;
  };
})(); 
// === end injected helpers ===

// --- LM auth resolver without dynamic import (classic-safe) ---
function __lm_getAuth() {
  return {
    ensureToken: (window.__LM_auth && window.__LM_auth.ensureToken) || (window.ensureToken) || (async function(){ return window.__LM_TOK; }),
    getAccessToken: (window.__LM_auth && window.__LM_auth.getAccessToken) || (window.getAccessToken) || (function(){ return window.__LM_TOK; })
  };
}
// --- end resolver ---

// ---------- Globals (palette & helpers) ----------
window.LM_PALETTE = window.LM_PALETTE || ["#ef9368","#e9df5d","#a8e063","#8bb6ff","#b38bff","#86d2c4","#d58cc1","#9aa1a6"];
window.currentPinColor = window.currentPinColor || window.LM_PALETTE[0];

function lm_hexToRgb(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex||"000000"));
  return { r:parseInt((m&&m[1])||"00",16), g:parseInt((m&&m[2])||"00",16), b:parseInt((m&&m[3])||"00",16) };
}
window.nearestPalette = window.nearestPalette || function nearestPalette(hex){
  const P=window.LM_PALETTE;
  const base=P[0];
  const c=lm_hexToRgb(hex||base); let best=base,score=1e9;
  for(const q of P){ const t=lm_hexToRgb(q); const d=(c.r-t.r)**2+(c.g-t.g)**2+(c.b-t.b)**2; if(d<score){score=d;best=q;} }
  return best;
};
function lmCanonicalColor(hex){
  try{ return window.nearestPalette(hex||window.currentPinColor||window.LM_PALETTE[0]); }
  catch(_){ return hex||window.LM_PALETTE[0]; }
}

// ---------- Imports ----------
import {
  ensureViewer, onCanvasShiftPick, addPinMarker, setPinSelected, onPinSelect,
  loadGlbFromDrive, onRenderTick, projectPoint, clearPins, removePinMarker
} from './viewer.module.cdn.js';
import { setupAuth, getAccessToken, getLastAuthError } from './gauth.module.js';

// ---------- DOM helpers ----------
const $ = (id)=>document.getElementById(id);
const setEnabled = (on, ...els)=> els.forEach(el=>{ if(el) el.disabled = !on; });
const textOrEmpty = (v)=> v==null ? '' : String(v);
const clamp = (n,min,max)=> Math.min(Math.max(n,min),max);

// ---------- Boot viewer & auth ----------
ensureViewer({ canvas: $('gl') });

const __LM_CLIENT_ID = (window.GIS_CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com');
const __LM_API_KEY   = (window.GIS_API_KEY   || '');
const __LM_SCOPES    = (window.GIS_SCOPES    ||  'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive.file' );

function onSigned(signed){
  document.documentElement.classList.toggle('signed-in', !!signed);
  setEnabled(!!signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('save-target-rename'), $('rename-input'));
}
// --- LM client_id bridge (minimal, non-destructive) ---
(function __lm_bridge_client_id(){
  try{
    const meta = document.querySelector('meta[name="google-signin-client_id"],meta[name="google-oauth-client_id"]');
    const cid  = window.GIS_CLIENT_ID || window.__LM_CLIENT_ID || (meta && meta.content) || "";
    if (cid){
      window.__LM_CLIENT_ID = cid;
      if (window.__LM_auth && typeof window.__LM_auth.setupClientId === 'function') {
  // (disabled to avoid popup before user gesture)
  // window.__LM_auth.setupClientId(cid);
}
    }
  }catch(_) {}
})();
// --- end bridge ---

// --- LM scopes union (ensure Drive Readonly is included) ---
(function __lm_union_scopes(){
  try{
    const NEED = [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly"
    ];
    // prefer window.__LM_SCOPES, then <meta data-lm-scopes>, else default spreadsheets only
    let scopes = window.__LM_SCOPES
      || (document.querySelector('meta[name="lm-scopes"]')?.content)
      || "https://www.googleapis.com/auth/spreadsheets";
    const set = new Set(String(scopes).split(/\s+/).filter(Boolean));
    for (const s of NEED) set.add(s);
    window.__LM_SCOPES = Array.from(set).join(" ");
    // optional: expose for gauth implementations that look here
    if (!window.GIS_SCOPES) window.GIS_SCOPES = window.__LM_SCOPES;
    console.log("[auth] scopes:", window.__LM_SCOPES);
  }catch(e){ console.warn("[auth] scopes union warn:", e); }
})();
// --- end scopes union ---

setupAuth($('auth-signin'), onSigned, { clientId: __LM_CLIENT_ID, apiKey: __LM_API_KEY, scopes: __LM_SCOPES });


// === Sign-in hint visibility control ===
function setSigninHint(visible) {
  const el = document.getElementById('auth-hint');
  if (!el) return;
  el.style.display = visible ? '' : 'none';
}
async function refreshSigninHint() {
  try {
    const g = await import('./gauth.module.js');
    const tok = await g.getAccessToken();
    setSigninHint(!tok); // hide when token exists
  } catch {
    setSigninHint(true);
  }
}
// Keep UI in sync with auth state and on boot
window.addEventListener('materials:authstate', refreshSigninHint);
document.addEventListener('DOMContentLoaded', refreshSigninHint, { once: true });




// === LM signin click patch (popup-safe): run setupClientId & ensureToken on user gesture ===
(function lm_click_patch_popup_safe(){
  try{
    const btn = document.getElementById('auth-signin') || document.querySelector('[data-lm-signin]');
    if (!btn || btn.__lm_clickPatch2) return;
    btn.__lm_clickPatch2 = true;
    btn.addEventListener('click', async (e) => {
      // we must stay within the user gesture to avoid popup blocking
      // don't cancel existing handlers: only early-return if already prevented
      if (e.defaultPrevented) return;
      try {
        const meta = document.querySelector('meta[name=\"google-signin-client_id\"],meta[name=\"google-oauth-client_id\"]');
        const cid  = window.GIS_CLIENT_ID || window.__LM_CLIENT_ID || (meta && meta.content) || "";
        if (cid) {
          // initialize gauth only now (under user gesture) if implementation exposes it
          if (window.__LM_auth && typeof window.__LM_auth.setupClientId === 'function') {
            try { window.__LM_auth.setupClientId(cid); } catch(_) {}
          } else {
            // at least mirror to the global
            window.__LM_CLIENT_ID = cid;
          }
        }
        // dynamically import to ensure module is ready
        const g = __lm_getAuth();
        // prefer '{prompt:\"consent\"}' then fallbacks
        let tok;
        try { tok = await g.ensureToken({ prompt: 'consent' }); }
        catch { try { tok = await g.ensureToken(true); } catch { tok = await g.ensureToken(); } }
        if (tok) {
          console.log('[signin] token ok (popup-safe)');
          document.documentElement.classList.add('signed-in','lm-signed');
          if (document.body) document.body.classList.add('signed-in');
          window.dispatchEvent(new CustomEvent('lm:signed', { detail: { signed: true } }));
        }
      } catch (err) {
        console.error('[signin] popup-safe ensureToken failed', err);
      }
    }, { passive: true });
  }catch(e){ console.error('[signin] click patch install failed', e); }
})();
function ensureToken() {
  const t = getAccessToken();
  if (!t) {
    const err = (typeof getLastAuthError === 'function') ? getLastAuthError() : null;
    if (err) console.warn('[auth] last error:', err);
    alert('Google サインインが必要です。「Sign in」をクリックしてください。');
    throw new Error('token_missing');
  }
  return t;
}

// ---------- Drive helpers ----------
function extractDriveId(input){
  if(!input) return null;
  const s = String(input).trim();
  const m = s.match(/^[A-Za-z0-9_-]{25,}$/);
  if(m) return m[0];
  try{
    const u = new URL(s);
    const q = u.searchParams.get('id');
    if(q && /^[A-Za-z0-9_-]{25,}$/.test(q)) return q;
    const seg = u.pathname.split('/').filter(Boolean);
    const ix = seg.indexOf('d');
    if(ix!==-1 && seg[ix+1] && /^[A-Za-z0-9_-]{25,}$/.test(seg[ix+1])) return seg[ix+1];
    const any = (u.href||'').match(/[A-Za-z0-9_-]{25,}/);
    if(any) return any[0];
  }catch(_){}
  const any2 = s.match(/[A-Za-z0-9_-]{25,}/);
  return any2? any2[0] : null;
}
function getFileThumbUrl(fileId, token, size){
  size = size|0; if(!size) size=1024;
  const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=thumbnailLink&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization: 'Bearer '+token } })
    .then(r => { if(!r.ok) throw new Error('thumb meta '+r.status); return r.json(); })
    .then(j => {
      if(!j.thumbnailLink) throw new Error('no thumbnailLink');
      const sz = clamp(size,64,2048);
      const sep = j.thumbnailLink.includes('?') ? '&' : '?';
      return j.thumbnailLink + sep + 'sz=s'+String(sz);
    });
}
function getFileBlobUrl(fileId, token){
  if(!fileId || !token) return Promise.reject(new Error('missing fileId/token'));
  const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media&supportsAllDrives=true';
  return fetch(url, { headers: { Authorization: 'Bearer '+token } })
    .then(r => {
      if(!r.ok) throw new Error('media '+r.status);
      const ct = (r.headers.get('Content-Type')||'').toLowerCase();
      if(/image\/(heic|heif)/.test(ct)) throw new Error('unsupported image format: HEIC');
      return r.blob();
    })
    .then(blob => URL.createObjectURL(blob));
}
function getParentFolderId(fileId, token){
  const url = 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=parents&supportsAllDrives=true';
  return (async () => {
    try {
      const j = await (window.__lm_fetchJSONAuth ? window.__lm_fetchJSONAuth(url) : fetch(url).then(r=>r.json()));
      return (j && j.parents && j.parents[0]) ? j.parents[0] : null;
    } catch (e) {
      // fallback (non-auth) just in case
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const j = await r.json().catch(()=>null);
        return (j && j.parents && j.parents[0]) ? j.parents[0] : null;
      } catch {
        return null;
      }
    }
  })();
}

// ---------- Global state ----------
let lastGlbFileId = null;
let currentSpreadsheetId = null;
let currentSheetId = null;
let currentSheetTitle = null;
let selectedPinId = null;

const captionsIndex = new Map();  // id -> { rowIndex }
const captionDomById = new Map(); // id -> element
const rowCache = new Map();       // id -> row
const overlays = new Map();       // id -> { root, imgEl, zoom }
let  filterMode = 'all';          // 'all' | 'selected' | 'color:#rrggbb'

// ---------- Quick styles ----------
(()=>{
  const st=document.createElement('style');
  st.textContent = `
  .caption-item{display:flex;gap:.5rem;padding:.5rem;border-bottom:1px solid #1116;cursor:pointer}
  .caption-item.is-selected{outline:2px solid #fff;outline-offset:-2px;border-radius:6px}
  .caption-item.is-hidden{display:none}
  .cap-overlay{user-select:none}
  .cap-overlay button{font:inherit}
  .thumb{width:64px;height:64px;background-size:cover;background-position:center;border-radius:8px;cursor:pointer;margin:4px;display:inline-block}
  .cap-title{font-weight:700}
  .cap-body.hint{opacity:.8;font-size:12px}
  .cap-del{margin-left:auto;background:transparent;border:1px solid #334155;color:#eee;border-radius:6px;padding:0 .5rem;cursor:pointer}
  .chip{--chip:#ccc; inline-size:28px; block-size:20px; border-radius:999px; border:1px solid #0006; background:var(--chip); cursor:pointer; margin:2px}
  .chip-color.is-active{outline:2px solid #fff; outline-offset:1px}
  .chip-actions{display:flex; gap:.5rem; margin:.25rem 0}
  .chip-action{padding:.25rem .5rem; border-radius:8px; border:1px solid #334155; background:#0b0f14; color:#e5e7eb; cursor:pointer}
  .chip-filter .mark{display:none; font-weight:700}
  .chip-filter.is-on .mark{display:inline}
  `;
  document.head.appendChild(st);
})();

// ---------- Overlay helpers ----------
let lineLayer = null;
function ensureLineLayer(){
  if(lineLayer) return lineLayer;
  const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('width','100vw'); s.setAttribute('height','100vh');
  s.style.position='fixed'; s.style.left='0'; s.style.top='0';
  s.style.pointerEvents='none'; s.style.zIndex='999';
  document.body.appendChild(s);
  lineLayer = s; return s;
}
function getOrMakeLine(id){
  const l = ensureLineLayer();
  let el = l.querySelector('line[data-id="'+id+'"]');
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
  const el = lineLayer.querySelector('line[data-id="'+id+'"]');
  if(el) el.remove();
}
function removeCaptionOverlay(id){
  const o = overlays.get(id);
  if(!o) return;
  o.root.remove();
  overlays.delete(id);
  removeLine(id);
}

function createCaptionOverlay(id, data){
  removeCaptionOverlay(id);
  const root = document.createElement('div'); root.className='cap-overlay';
  root.style.position='fixed'; root.style.zIndex='1000';
  root.style.background='#0b0f14ef'; root.style.color='#e5e7eb';
  root.style.padding='10px 12px'; root.style.borderRadius='10px';
  root.style.boxShadow='0 8px 24px #000a'; root.style.minWidth='200px'; root.style.maxWidth='300px';
  root.style.paddingTop = '40px'; // fixed control area

  // controls
  const ctrl = document.createElement('div');
  ctrl.style.position='absolute'; ctrl.style.left='10px'; ctrl.style.top='8px';
  ctrl.style.display='flex'; ctrl.style.gap='8px';
  const bZoomOut = document.createElement('button'); bZoomOut.textContent='–';
  const bZoomIn  = document.createElement('button'); bZoomIn .textContent='+';
  const bClose   = document.createElement('button'); bClose  .textContent='×';
  [bZoomOut,bZoomIn,bClose].forEach(b=>{
    b.style.border='none'; b.style.background='transparent'; b.style.color='#ddd'; b.style.cursor='pointer';
    b.style.fontWeight='700';
  });
  ctrl.append(bZoomOut,bZoomIn,bClose);
  root.appendChild(ctrl);

  // drag handle
  const topbar = document.createElement('div');
  topbar.style.height='20px'; topbar.style.marginBottom='6px'; topbar.style.cursor='move';
  root.appendChild(topbar);

  const t = document.createElement('div'); t.className='cap-title'; t.style.marginBottom='6px';
  const body = document.createElement('div'); body.className='cap-body'; body.style.fontSize='12px'; body.style.opacity='.95'; body.style.whiteSpace='pre-wrap'; body.style.marginBottom='6px';
  const img = document.createElement('img'); img.className='cap-img'; img.alt=''; img.style.display='none'; img.style.width='100%'; img.style.height='auto'; img.style.borderRadius='8px';

  const safeTitle = (data && data.title ? String(data.title).trim() : '') || '(untitled)';
  const safeBody  = (data && data.body  ? String(data.body ).trim() : '') || '(no description)';
  t.textContent = safeTitle; body.textContent = safeBody;

  // drag move
  let dragging=false, startX=0, startY=0, baseLeft=0, baseTop=0;
  topbar.addEventListener('pointerdown', (ev)=>{
    dragging=true; startX=ev.clientX; startY=ev.clientY;
    baseLeft=parseFloat(root.style.left||'0'); baseTop=parseFloat(root.style.top||'0');
    root.setPointerCapture && root.setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  });
  window.addEventListener('pointermove', (ev)=>{
    if(!dragging) return;
    const dx=ev.clientX-startX, dy=ev.clientY-startY;
    root.style.left=(baseLeft+dx)+'px'; root.style.top=(baseTop+dy)+'px';
  });
  window.addEventListener('pointerup', ()=>{ dragging=false; });

  // image fill now & on changes
  overlays.set(id, { root, imgEl:img, zoom:1.0 });
  document.body.appendChild(root);
  applyOverlayZoom(id, 1.0);
  updateOverlayPosition(id, true);
  refreshOverlayImage(id); // ← 初期表示時に反映

  // zoom & close
  bZoomIn .addEventListener('click', (e)=>{ e.stopPropagation(); applyOverlayZoom(id, Math.min(2.0, (overlays.get(id)?.zoom||1)+0.1)); });
  bZoomOut.addEventListener('click', (e)=>{ e.stopPropagation(); applyOverlayZoom(id, Math.max(0.6, (overlays.get(id)?.zoom||1)-0.1)); });
  bClose  .addEventListener('click', (e)=>{ e.stopPropagation(); removeCaptionOverlay(id); });

  root.append(t, body, img);
}
function applyOverlayZoom(id, z){
  const o = overlays.get(id); if(!o) return;
  o.zoom = z;
  const BASE=260;
  o.root.style.maxWidth = (BASE*z)+'px';
  o.root.style.minWidth = (200*z)+'px';
  updateOverlayPosition(id);
}
function updateOverlayPosition(id, initial){
  const o = overlays.get(id); if(!o) return;
  const d = rowCache.get(id); if(!d) return;
  const p = projectPoint(d.x, d.y, d.z);
  if(!p.visible){ o.root.style.display='none'; removeLine(id); return; }
  o.root.style.display='block';
  if(initial && !o.root.style.left){
    o.root.style.left=(p.x+14)+'px'; o.root.style.top=(p.y+14)+'px';
  }
  const r = o.root.getBoundingClientRect();
  const line = getOrMakeLine(id);
  const cx = Math.min(Math.max(p.x, r.left), r.right);
  const cy = Math.min(Math.max(p.y, r.top ), r.bottom);
  line.setAttribute('x1', String(cx));
  line.setAttribute('y1', String(cy));
  line.setAttribute('x2', String(p.x));
  line.setAttribute('y2', String(p.y));
}
onRenderTick(()=>{ overlays.forEach((_,id)=> updateOverlayPosition(id,false)); });

function refreshOverlayImage(id){
  const o = overlays.get(id); if(!o) return;
  const row = rowCache.get(id)||{};
  const token = getAccessToken();
  const img = o.imgEl;
  if(!img) return;
  img.style.display='none';
  if(!row.imageFileId || !token){ img.removeAttribute('src'); return; }
  // try blob first, then thumb
  getFileBlobUrl(row.imageFileId, token).then((url)=>{
    img.src=url; img.style.display='block';
  }).catch(()=>{
    return getFileThumbUrl(row.imageFileId, token, 1024).then((url)=>{ img.src=url; img.style.display='block'; }).catch(()=>{});
  });
}

// ---------- Selection helpers ----------
function markListSelected(id){
  const host = $('caption-list'); if(!host) return;
  host.querySelectorAll('.caption-item.is-selected').forEach(n=>n.classList.remove('is-selected'));
  const el = host.querySelector('.caption-item[data-id="'+CSS.escape(id)+'"]');
  if(el) el.classList.add('is-selected');
}
function fillFormFromCaption(id){
  const row = rowCache.get(id) || {};
  const t=$('caption-title'), b=$('caption-body');
  if(t) t.value = row.title || '';
  if(b) b.value = row.body  || '';
  const col = $('pinColor'); if(col && row.color) col.value = row.color;
}
function selectCaption(id){
  selectedPinId = id;
  markListSelected(id);
  fillFormFromCaption(id);
  setPinSelected(id, true);
  createCaptionOverlay(id, rowCache.get(id) || {});
}
onPinSelect((id)=> selectCaption(id));

// ---------- Sheets I/O ----------
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z','imageFileId','createdAt','updatedAt'];

function colA1(i0){ let n=i0+1,s=''; while(n){ n--; s=String.fromCharCode(65+(n%26))+s; n=(n/26)|0; } return s; }
function putValues(spreadsheetId, rangeA1, values, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
  return fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) }).then(r=>{ if(!r.ok) throw new Error('values.update '+r.status); });
}
function appendValues(spreadsheetId, rangeA1, values, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ values }) }).then(r=>{ if(!r.ok) throw new Error('values.append '+r.status); });
}
function getValues(spreadsheetId, rangeA1, token){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(r=>{ if(!r.ok) throw new Error('values.get '+r.status); return r.json(); }).then(d=> d.values||[]);
}
function isLociMyuSpreadsheet(spreadsheetId, token){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(res=> res.ok ? res.json() : false).then(data=>{
      if(!data || !Array.isArray(data.sheets)) return false;
      for(const s of data.sheets){
        const d = s && s.data || []; if(!d[0]) continue;
        const row = d[0].rowData || []; const vals = (row[0]||{}).values || [];
        const headers = [];
        for(const v of vals){
          const fv = v && v.formattedValue ? String(v.formattedValue).trim().toLowerCase() : '';
          if(fv) headers.push(fv);
        }
        if(headers.includes('title') && headers.includes('body') && headers.includes('color')){
          return true;
        }
      }
      return false;
    });
}
function createLociMyuSpreadsheet(parentFolderId, token, opts){
  const glbId = (opts && opts.glbId) ? opts.glbId : '';
  const name = ('LociMyu_Save_'+glbId).replace(/_+$/,'');
  const url = 'https://www.googleapis.com/drive/v3/files';
  const body = { name, mimeType:'application/vnd.google-apps.spreadsheet' };
  if(parentFolderId) body.parents = [ parentFolderId ];
  return fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) }).then(r=>{ if(!r.ok) throw new Error('Drive files.create '+r.status); return r.json(); }).then(file=>{
      const spreadsheetId = file.id;
      return putValues(spreadsheetId, 'A1:Z1', [LOCIMYU_HEADERS], token).then(()=> spreadsheetId);
    });
}
function findOrCreateLociMyuSpreadsheet(parentFolderId, token, opts){
  if(!parentFolderId) return Promise.reject(new Error('parentFolderId required'));
  const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime&includeItemsFromAllDrives=true desc&pageSize=10&supportsAllDrives=true`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(r=>{ if(!r.ok) throw new Error('Drive list spreadsheets '+r.status); return r.json(); }).then(d=>{
      const files = d.files || [];
      function next(i){
        if(i>=files.length) return createLociMyuSpreadsheet(parentFolderId, token, opts||{});
        return isLociMyuSpreadsheet(files[i].id, token).then(ok=> ok ? files[i].id : next(i+1));
      }
      return next(0);
    });
}

// ---------- Index / ensure row ----------
function ensureIndex(){
  captionsIndex.clear();
  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return Promise.resolve(false);
  return getValues(currentSpreadsheetId, "'"+currentSheetTitle+"'!A1:Z9999", token).then(values=>{
    if(!values.length) return false;
    const headers = values[0].map(v=> textOrEmpty(v).trim());
    const idx = {}; headers.forEach((h,i)=> idx[h.toLowerCase()] = i);
    const iId = (idx['id']!=null) ? idx['id'] : -1;
    for(let r=1;r<values.length;r++){
      const row=values[r]||[]; const id=row[iId];
      if(!id) continue;
      captionsIndex.set(String(id), { rowIndex: r+1 });
    }
    return true;
  }).catch(e=>{
    console.warn('[ensureIndex] values.get failed, continue', e);
    return false;
  });
}

function sheetsAppendRow(spreadsheetId, sheetTitle, obj){
  const token=getAccessToken(); if(!token) return Promise.resolve();
  const now=new Date().toISOString();
  const vals=[[ obj.id, obj.title||'', obj.body||'', obj.color||window.currentPinColor, obj.x||0, obj.y||0, obj.z||0, obj.imageFileId||'', obj.createdAt||now, obj.updatedAt||now ]];
  return appendValues(spreadsheetId, "'"+sheetTitle+"'!A:Z", vals, token).then(()=> ensureIndex());
}

function ensureRow(id, seed){
  if(rowCache.has(id)) return Promise.resolve(rowCache.get(id));
  return ensureIndex().then(ok=>{
    if(captionsIndex.has(id)){
      const cur=rowCache.get(id)||{id};
      const merged=Object.assign({}, cur, seed||{}); rowCache.set(id, merged);
      return merged;
    }
    if(!currentSpreadsheetId){
      console.warn('[ensureRow] no spreadsheet, cache only');
      const rowOnly=Object.assign({id}, seed||{}); rowCache.set(id,rowOnly);
      return rowOnly;
    }
    const sheetTitle=currentSheetTitle||'シート1';
    const row=Object.assign({
      id, title:'', body:'', color:window.currentPinColor,
      x:0,y:0,z:0, imageFileId:'',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    }, seed||{});
    return sheetsAppendRow(currentSpreadsheetId, sheetTitle, row).then(()=>{
      rowCache.set(id,row); return row;
    });
  });
}

// ---------- Caption list UI ----------
function clearCaptionList(){
  const host=$('caption-list'); if(host) host.innerHTML='';
  captionDomById.clear();
}
async function deleteCaptionRowFromSheet(spreadsheetId, sheetId, rowIndex1based, token){
  try{
    if(!spreadsheetId || !sheetId || !rowIndex1based || !token) return false;
    const body = {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: Number(sheetId),
            dimension: "ROWS",
            startIndex: rowIndex1based-1,
            endIndex: rowIndex1based
          }
        }
      }]
    };
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const r = await fetch(url, {
      method:'POST',
      headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    if(!r.ok){
      console.error('[Sheets deleteDimension] HTTP', r.status);
      return false;
    }
    await ensureIndex();
    return true;
  }catch(e){
    console.error('[Sheets deleteDimension] failed', e);
    return false;
  }
}
function appendCaptionItem(row){
  const host=$('caption-list'); if(!host||!row) return;
  const div=document.createElement('div'); div.className='caption-item'; div.dataset.id=row.id;
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  const safeTitle=(row.title||'').trim()||'(untitled)';
  const safeBody =(row.body ||'').trim()||'(no description)';
  const txt=document.createElement('div'); txt.className='cap-txt';
  const t=document.createElement('div'); t.className='cap-title'; t.textContent=safeTitle;
  const b=document.createElement('div'); b.className='cap-body hint'; b.textContent=safeBody;
  txt.appendChild(t); txt.appendChild(b);
  const del=document.createElement('button'); del.className='cap-del'; del.textContent='×'; del.title='Delete pin';
  del.addEventListener('click', async (ev)=>{  ev.stopPropagation();
  if(!confirm('このキャプションを削除しますか？')) return;

  const id = row.id;

  try{ removePinMarker(id); }catch(_){}
  try{ removeCaptionOverlay && removeCaptionOverlay(id); }catch(_){}

  const meta = captionsIndex.get(id);
  let ok = true;
  if (currentSpreadsheetId && currentSheetId && meta && meta.rowIndex){
    try{
      const token = ensureToken();
      ok = await deleteCaptionRowFromSheet(currentSpreadsheetId, currentSheetId, meta.rowIndex, token);
      if(!ok) throw new Error('Sheets API returned non-ok');
      await ensureIndex();
    }catch(e){
      console.error('[delete row failed]', e);
      alert('スプレッドシートからの削除に失敗しました: ' + (e && e.message || 'unknown'));
      ok = false;
    }
  }
  if(!ok){ return; }

  const el = host.querySelector('[data-id="'+CSS.escape(id)+'"]');
  if(el) el.remove();
  captionsIndex.delete(id);
  rowCache.delete(id);
  if(selectedPinId === id){
    selectedPinId = null;
    const t=document.getElementById('caption-title'), b=document.getElementById('caption-body');
    if(t) t.value='';
    if(b) b.value='';
    renderCurrentImageThumb();
  }});
  div.appendChild(txt); div.appendChild(del);
  div.addEventListener('click', ()=> selectCaption(row.id));
  host.appendChild(div); captionDomById.set(row.id, div);
}

function reflectRowToUI(id){
  const row=rowCache.get(id)||{};
  if(selectedPinId===id){
    const t=$('caption-title'), b=$('caption-body');
    if(t && document.activeElement!==t) t.value=row.title||'';
    if(b && document.activeElement!==b) b.value=row.body||'';
    const col=$('pinColor'); if(col && row.color) col.value=row.color;
    renderCurrentImageThumb();
    refreshOverlayImage(id); // ← オーバーレイにも反映
  }
  const host=$('caption-list'); if(!host) return;
  let div=captionDomById.get(id);
  if(!div){ appendCaptionItem(Object.assign({id}, row)); div=captionDomById.get(id); }
  if(!div) return;
  // update visible title/body in list item
  const tEl = div.querySelector('.cap-title');
  const bEl = div.querySelector('.cap-body');
  const safeTitle = ((row.title||'').trim()) || '(untitled)';
  const safeBody  = ((row.body ||'').trim()) || '(no description)';
  if(tEl && tEl.textContent !== safeTitle) tEl.textContent = safeTitle;
  if(bEl && bEl.textContent !== safeBody)  bEl.textContent = safeBody;
  // border accent by pin color
  if(row.color) div.style.borderLeft='3px solid '+row.color;
  // refresh small list thumb if helper exists
  if (typeof refreshListThumb === 'function') { try{ refreshListThumb(id); }catch(_){ } }
}

// ---------- Save / Update ----------
function putRowToSheet(seed, meta){
  const token = ensureToken();
  const headers = LOCIMYU_HEADERS;
  const rowIndex = meta ? meta.rowIndex : 2;
  const values = headers.map(h=>{
    if(h==='updatedAt') return new Date().toISOString();
    const v = seed[h]; return (v==null?'':String(v));
  });
  const rangeA1 = `'${currentSheetTitle||'シート1'}'!A${rowIndex}:`+String(colA1(headers.length-1))+String(rowIndex);
  return putValues(currentSpreadsheetId, rangeA1, [values], token);
}
function refreshPinMarkerFromRow(id){
  const row=rowCache.get(id); if(!row) return;
  removePinMarker(id);
  addPinMarker({ id, x:row.x||0, y:row.y||0, z:row.z||0, color:row.color||window.currentPinColor });
}
function updateCaptionForPin(id, fields){
  const cached=rowCache.get(id)||{id};
  const seed=Object.assign({}, cached, fields||{});
  return ensureRow(id, seed).then(()=> ensureIndex()).then(()=>{
    const meta=captionsIndex.get(id);
    if(!meta && currentSpreadsheetId){
      const sheetTitle=currentSheetTitle||'シート1';
      return sheetsAppendRow(currentSpreadsheetId, sheetTitle, {
        id,
        title:seed.title||'',
        body:seed.body||'',
        color:seed.color||window.currentPinColor,
        x:seed.x||0, y:seed.y||0, z:seed.z||0,
        imageFileId:seed.imageFileId||'',
        createdAt:seed.createdAt||new Date().toISOString(),
        updatedAt:new Date().toISOString()
      }).then(()=>{ rowCache.set(id, seed); reflectRowToUI(id); refreshPinMarkerFromRow(id); });
    }else{
      return putRowToSheet(seed, meta).then(()=>{ rowCache.set(id, seed); reflectRowToUI(id); refreshPinMarkerFromRow(id); }).catch(e=>{ console.error('[values.update] failed', e); throw e; });
    }
  });
}

// ---------- Image attach/detach (right pane) ----------
let _thumbReq = 0;
function renderCurrentImageThumb(){
  const box = document.getElementById('currentImageThumb');
  if(!box) return;

  box.innerHTML = '';

  const row = selectedPinId ? (rowCache.get(selectedPinId)||{}) : null;
  if(!row || !row.imageFileId){
    box.innerHTML = '<div class="placeholder">No Image</div>';
    return;
  }

  const token = (typeof getAccessToken === 'function') ? getAccessToken() : null;
  if(!token){
    box.innerHTML = '<div class="placeholder">No Image</div>';
    return;
  }

  getFileThumbUrl(row.imageFileId, token, 512).then((url)=>{
    box.innerHTML = '';

    const wrap=document.createElement('div');
    wrap.className='current-image-wrap';
    wrap.style.position='relative';
    wrap.style.display='inline-block';

    const img=document.createElement('img');
    img.src=url; img.alt='';
    img.style.borderRadius='12px';
    img.style.maxWidth='100%';
    img.style.display='block';

    const x=document.createElement('button');
    x.textContent='×';
    x.title='Detach image';
    x.style.position='absolute';
    x.style.right='6px';
    x.style.top='6px';
    x.style.border='none';
    x.style.width='28px';
    x.style.height='28px';
    x.style.borderRadius='999px';
    x.style.background='#000a';
    x.style.color='#fff';
    x.style.cursor='pointer';

    x.addEventListener('click', (e)=>{
      e.stopPropagation();
      Promise.resolve(updateImageForPin(selectedPinId, null))
        .then(renderCurrentImageThumb)
        .catch(()=>{});
    });

    wrap.appendChild(img);
    wrap.appendChild(x);
    box.appendChild(wrap);
  }).catch(()=>{
    box.innerHTML = '<div class="placeholder">No Image</div>';
  });
}
function updateImageForPin(id, fileIdOrNull){
  const token = ensureToken();
  const patch = { imageFileId: fileIdOrNull ? String(fileIdOrNull) : '' };
  return updateCaptionForPin(id, patch).then(()=>{ renderCurrentImageThumb(); refreshOverlayImage(id); });
}

// ---------- Load captions from sheet ----------
async function loadCaptionsFromSheet(){
  // token guard
  const __lm_token_guard_loadCaptionsFromSheet = (await (async ()=>{try{const g=await import('./gauth.module.js');let v=g.getAccessToken?.();return (v&&typeof v.then==='function')?await v:v;}catch(e){return null}})());

  const token = getAccessToken(); if(!token||!currentSpreadsheetId||!currentSheetTitle) return;
  const range = `'${currentSheetTitle}'!A1:Z9999`;
  getValues(currentSpreadsheetId, range, token).then(values=>{
    clearCaptionList();
    rowCache.clear(); captionsIndex.clear();
    if(!values.length) return;
    const headers = values[0].map(v=> textOrEmpty(v).trim());
    const map = {}; headers.forEach((h,i)=> map[h.toLowerCase()] = i);
    for(let r=1;r<values.length;r++){
      const row=values[r]||[];
      const id = textOrEmpty(row[map['id']||0]);
      if(!id) continue;
      const obj = {
        id,
        title: textOrEmpty(row[map['title']||1]),
        body : textOrEmpty(row[map['body'] ||2]),
        color: textOrEmpty(row[map['color']||3]) || window.currentPinColor,
        x: Number(row[map['x']||4]||0), y: Number(row[map['y']||5]||0), z: Number(row[map['z']||6]||0),
        imageFileId: textOrEmpty(row[map['imagefileid']||7]),
        createdAt: textOrEmpty(row[map['createdat']||8]),
        updatedAt: textOrEmpty(row[map['updatedat']||9])
      };
      rowCache.set(id, obj);
      captionsIndex.set(id, { rowIndex: r+1 });
      appendCaptionItem(obj);
      addPinMarker({ id, x:obj.x, y:obj.y, z:obj.z, color:obj.color||window.currentPinColor });
    }
    applyColorFilter();
  }).catch(e=> console.warn('[loadCaptionsFromSheet] failed', e));
}

// ---------- Right-pane images grid ----------
(function wireImagesGrid(){
  const grid = $('images-grid'); if(!grid) return;
  grid.addEventListener('click', (e)=>{
    const cell = e.target.closest('.thumb'); if(!cell) return;
    if(!selectedPinId) { alert('先にキャプションを選択してください。'); return; }
    const fileId = cell.dataset.fileId;
    updateImageForPin(selectedPinId, fileId).catch(err=>{
      console.error('attach failed', err);
    });
  });
  const btn = $('btnRefreshImages');
  if(btn) btn.addEventListener('click', ()=> refreshImagesGrid().catch(()=>{}));
})();
async function refreshImagesGrid(){
  // token guard
  const __lm_token_guard_refreshImagesGrid = (await (async ()=>{try{const g=await import('./gauth.module.js');let v=g.getAccessToken?.();return (v&&typeof v.then==='function')?await v:v;}catch(e){return null}})());

  const token = ensureToken(); if(!lastGlbFileId) return Promise.resolve();
  return getParentFolderId(lastGlbFileId, token).then(parent=>{
    if(!parent){
      const stat=$('images-status');
      if(stat) stat.textContent='親フォルダが見つかりません';
      return;
    }
    const q = encodeURIComponent(`'${parent}' in parents and mimeType contains 'image/' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&orderBy=modifiedTime&includeItemsFromAllDrives=true desc&pageSize=200&supportsAllDrives=true`;
    return fetch(url, { headers:{ Authorization:'Bearer '+token } })
      .then(r=>r.json())
      .then(d=>{
        const grid = $('images-grid'); const stat = $('images-status');
        if(grid) grid.innerHTML = '';
        const files = d.files|| [];
        files.forEach(f=>{
          const div = document.createElement('div');
          div.className = 'thumb';
          div.dataset.fileId = f.id;
          const thumb = (f.thumbnailLink ? (f.thumbnailLink + (f.thumbnailLink.includes('?')?'&':'?') + 'sz=s256') : '');
          if(thumb) div.style.backgroundImage = `url("${thumb}")`;
          if(grid) grid.appendChild(div);
        });
        if(stat) stat.textContent = `${files.length} images`;
      });
  });
}

// ---------- Form autosave ----------
(function wireForm(){
  const t=$('caption-title'), b=$('caption-body');
  let timer=null;
  function reflectOverlayImmediate(){
    if(!selectedPinId) return;
    const o = overlays.get(selectedPinId);
    if(!o) return;
    const tEl = o.root.querySelector('.cap-title');
    const bEl = o.root.querySelector('.cap-body');
    if(tEl && t) tEl.textContent = (t.value||'(untitled)');
    if(bEl && b) bEl.textContent = (b.value||'(no description)');
  }
  function schedule(){
    if(!selectedPinId) return;
    clearTimeout(timer);
    const title = t ? (t.value||'') : '';
    const body  = b ? (b.value||'') : '';
    reflectOverlayImmediate();
    timer=setTimeout(function(){
      updateCaptionForPin(selectedPinId, { title, body }).catch(function(e){ console.warn('[caption autosave failed]', e); });
    }, 600);
  }
  if(t) t.addEventListener('input', schedule);
  if(b) b.addEventListener('input', schedule);
})();

// ---------- Color chips & filters ----------
function setPinColor(hex){
  window.currentPinColor = hex;
  const host=document.getElementById('pinColorChips');
  if(host){
    host.querySelectorAll('.chip-color').forEach(el=>{
      const v = getComputedStyle(el).getPropertyValue('--chip').trim();
      el.classList.toggle('is-active', v===hex);
    });
  }
  if(selectedPinId){
    const row=rowCache.get(selectedPinId)||{id:selectedPinId};
    row.color=hex; rowCache.set(selectedPinId,row);
    try{ refreshPinMarkerFromRow(selectedPinId); }catch(_){}
    try{ updateCaptionForPin(selectedPinId,{ color:hex }); }catch(_){}
  }
}
function renderColorChips(){
  const host = document.getElementById('pinColorChips'); if(!host) return;
  host.innerHTML = '';
  window.LM_PALETTE.forEach(function(hex){
    const b=document.createElement('button');
    b.className='chip chip-color'; b.style.setProperty('--chip', hex); b.title=hex;
    if(window.nearestPalette(window.currentPinColor)===hex) b.classList.add('is-active');
    b.addEventListener('click', function(){ setPinColor(hex); });
    host.appendChild(b);
  });
}

let lmFilterSet = (function(){ try{ const s=JSON.parse(localStorage.getItem('lmFilterColors')||'[]'); return new Set(s.length?s:window.LM_PALETTE); }catch(_){ return new Set(window.LM_PALETTE);} })();
function saveFilter(){ try{ localStorage.setItem('lmFilterColors', JSON.stringify(Array.from(lmFilterSet))); }catch(_){ } }
function rowPassesColorFilter(row){
  if(!row) return false; if(lmFilterSet.size===0) return true;
  return lmFilterSet.has(window.nearestPalette(row.color||window.LM_PALETTE[0]));
}
function applyColorFilter(){
  const listHost=document.getElementById('caption-list');
  if(listHost){
    listHost.querySelectorAll('.caption-item').forEach(function(div){
      const id=div.dataset.id; const row=rowCache.get(id);
      const ok=rowPassesColorFilter(row||{});
      div.classList.toggle('is-hidden', !ok);
    });
  }
  try{ document.dispatchEvent(new CustomEvent('pinFilterChange',{ detail:{ selected:Array.from(lmFilterSet) } })); }catch(_){}
}
function renderFilterChips(){
  const host = document.getElementById('pinFilterChips'); if(!host) return;
  if(!host.previousElementSibling || !host.previousElementSibling.classList || !host.previousElementSibling.classList.contains('chip-actions')){
    const bar=document.createElement('div'); bar.className='chip-actions';
    const a=document.createElement('button'); a.id='filterAll'; a.className='chip-action'; a.textContent='All';
    const n=document.createElement('button'); n.id='filterNone'; n.className='chip-action'; n.textContent='None';
    a.addEventListener('click', function(){ lmFilterSet=new Set(window.LM_PALETTE); saveFilter(); applyColorFilter(); renderFilterChips(); });
    n.addEventListener('click', function(){ lmFilterSet=new Set(); saveFilter(); applyColorFilter(); renderFilterChips(); });
    host.parentNode.insertBefore(bar, host); bar.appendChild(a); bar.appendChild(n);
  }
  host.innerHTML='';
  window.LM_PALETTE.forEach(function(hex){
    const b=document.createElement('button');
    b.className='chip chip-filter'; b.style.setProperty('--chip', hex); b.title='filter '+hex;
    const mark=document.createElement('span'); mark.className='mark'; mark.textContent='✓'; b.appendChild(mark);
    if(lmFilterSet.has(hex)) b.classList.add('is-on');
    b.addEventListener('click', function(){ if(lmFilterSet.has(hex)) lmFilterSet.delete(hex); else lmFilterSet.add(hex); saveFilter(); applyColorFilter(); renderFilterChips(); });
    host.appendChild(b);
  });
}

// ---------- GLB load ----------
async function doLoad(){
  // token guard
  const __lm_token_guard_doLoad = (await (async ()=>{try{const g=await import('./gauth.module.js');let v=g.getAccessToken?.();return (v&&typeof v.then==='function')?await v:v;}catch(e){return null}})());

  try{
    const token = ensureToken();
    const raw = ($('glbUrl') && $('glbUrl').value) || '';
    const fileId = extractDriveId(raw);
    if(!fileId){ console.warn('[GLB] missing fileId'); return; }
    if($('btnGlb')) $('btnGlb').disabled = true;

    return loadGlbFromDrive(fileId, { token }).then(function(){
      lastGlbFileId = fileId;
      return getParentFolderId(fileId, token).then(function(parent){
        return findOrCreateLociMyuSpreadsheet(parent, token, { glbId:fileId });
      }).then(function(spreadsheetId){
        currentSpreadsheetId = spreadsheetId;
        return populateSheetTabs(spreadsheetId, token).then(function(){ loadCaptionsFromSheet(); });
      }).then(function(){ refreshImagesGrid(); });
    }).catch(function(e){
      console.error('[GLB] load error', e);
      if(String(e).includes('401')){
        alert('認可が必要です。右上の「Sign in」を押して権限を付与してください。');
      }
    }).finally(function(){
      if($('btnGlb')) $('btnGlb').disabled = false;
    });
  }catch(e){
    console.warn('[GLB] token missing or other error', e);
  }
}
if($('btnGlb')) $('btnGlb').addEventListener('click', doLoad);
if($('glbUrl')) $('glbUrl').addEventListener('keydown', function(e){ if(e.key==='Enter') doLoad(); });

// ---------- Sheet tabs & rename ----------
function populateSheetTabs(spreadsheetId, token){
  const sel = $('save-target-sheet'); if(!sel||!spreadsheetId) return Promise.resolve();
  sel.innerHTML = '<option value="">Loading…</option>';
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`;
  return fetch(url, { headers:{ Authorization:'Bearer '+token } }).then(function(r){ return r.ok ? r.json() : null; }).then(function(data){
      if(!data) { sel.innerHTML='<option value="">(error)</option>'; return; }
      const sheets = (data.sheets||[]).map(function(s){ return s.properties; }).sort(function(a,b){ return a.index-b.index; });
      sel.innerHTML='';
      for(const p of sheets){
        const opt = document.createElement('option');
        opt.value = String(p.sheetId);
        opt.textContent = p.title;
        opt.dataset.title = p.title;
        sel.appendChild(opt);
      }
      const first = sheets[0];
      currentSheetId = first ? first.sheetId : null;
      currentSheetTitle = first ? first.title : null;
      if(currentSheetId) sel.value = String(currentSheetId);
    });
}
const sheetSel = $('save-target-sheet');
if(sheetSel){
  sheetSel.addEventListener('change', function(e){
    const sel = e.target;
    const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    currentSheetId = (opt && opt.value) ? Number(opt.value) : null;
    currentSheetTitle = (opt && opt.dataset && opt.dataset.title) ? opt.dataset.title : null;
    clearPins(); overlays.forEach(function(_,id){ removeCaptionOverlay(id); }); overlays.clear();
    clearCaptionList(); rowCache.clear(); captionsIndex.clear(); selectedPinId=null;
    loadCaptionsFromSheet();
  });
}
const btnCreate = $('save-target-create');
if(btnCreate){
  btnCreate.addEventListener('click', function(){
    const token = ensureToken(); if(!currentSpreadsheetId) return;
    const title='Sheet_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
    const body={ requests:[{ addSheet:{ properties:{ title } } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      .then(function(r){ if(!r.ok) throw new Error(String(r.status)); })
      .then(function(){ return populateSheetTabs(currentSpreadsheetId, token); })
      .then(function(){ loadCaptionsFromSheet(); })
      .catch(function(e){ console.error('[Sheets addSheet] failed', e); });
  });
}
const btnRename = $('save-target-rename');
if(btnRename){
  btnRename.addEventListener('click', function(){
    const token = ensureToken(); if(!currentSpreadsheetId||!currentSheetId) return;
    const input=$('rename-input'); const newTitle = input && input.value ? String(input.value).trim() : '';
    if(!newTitle) return;
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`;
    const body={ requests:[{ updateSheetProperties:{ properties:{ sheetId: currentSheetId, title: newTitle }, fields: 'title' } }] };
    fetch(url,{ method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      .then(function(r){ if(!r.ok) throw new Error(String(r.status)); })
      .then(function(){ return populateSheetTabs(currentSpreadsheetId, token); })
      .then(function(){ loadCaptionsFromSheet(); })
      .catch(function(e){ console.error('[Sheets rename] failed', e); });
  });
}

console.log('[LociMyu ESM/CDN] boot clean full build loaded');

// ---------- Chips init on DOM ready ----------
document.addEventListener('DOMContentLoaded', function(){
  try{ renderColorChips(); renderFilterChips(); applyColorFilter(); }catch(e){ console.warn('[chips init]', e); }
});

// ---------- Shift+click add pin ----------
onCanvasShiftPick(function(pos){
  const id = 'pin_'+Date.now();
  const color = lmCanonicalColor(window.currentPinColor);
  const row = { id, title:'', body:'', color, x:pos.x, y:pos.y, z:pos.z, imageFileId:'', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  rowCache.set(id, row);
  appendCaptionItem(row);
  addPinMarker({ id, x:pos.x, y:pos.y, z:pos.z, color });
  selectCaption(id);
  ensureRow(id, row).then(function(){ updateCaptionForPin(id, row); });
});


// === Tabs wiring (Caption / Material / Views) ===
(function(){
  function setActive(tab){
    const name = tab?.getAttribute('data-tab');
    if(!name) return;
    document.querySelectorAll('nav.tabs [role="tab"]').forEach(btn=>{
      btn.setAttribute('aria-selected', String(btn===tab));
    });
    document.querySelectorAll('.pane').forEach(p=>{
      p.removeAttribute('data-active');
    });
    const pane = document.querySelector(`#pane-${name}`);
    if(pane) pane.setAttribute('data-active','true');
  try{ window.relocateCaptionBar && window.relocateCaptionBar(); }catch(_){}
  try{ window.applyCaptionBarPolicy && window.applyCaptionBarPolicy(name); }catch(_){}
}
  function initTabs(){
    const nav = document.querySelector('nav.tabs');
    if(!nav) return;
    nav.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('[role="tab"][data-tab]');
      if(!btn) return;
      ev.preventDefault();
      setActive(btn);
    }, { passive:false });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initTabs, { once:true });
  } else { initTabs(); }
})();



// === Active Tab state + caption-only bar control ===
(function(){
  function setBodyActiveTab(name){
    try{ document.body.setAttribute('data-active-tab', String(name||'')); }catch(_){}
  }
  function findCaptionBars(){
    const list = [];
    const ids = ['caption-image-row', 'images-status'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) list.push(el); });
    // Also include a row that contains a "Refresh images" label/button
    const ref = Array.from(document.querySelectorAll('.row, button, a')).find(n => /refresh images/i.test(n.textContent||''));
    if (ref){
      const row = ref.closest('.row') || ref.parentElement;
      if (row) list.push(row);
    }
    return Array.from(new Set(list));
  }
  function applyCaptionBarPolicy(activeTab){
    const bars = findCaptionBars();
    const isCaption = activeTab === 'caption';
    const mode = (window.UI_IMAGE_BAR_MODE || 'hide'); // 'hide' | 'disable'
    bars.forEach(el => {
      if (isCaption){
        el.style.display = '';
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.classList.remove('caption-bar--disabled');
      } else {
        if (mode === 'hide'){
          el.style.display = 'none';
        } else {
          // disable but keep layout
          el.style.display = '';
          el.style.pointerEvents = 'none';
          el.style.opacity = '0.4';
          el.classList.add('caption-bar--disabled');
        }
      }
    });
  }

  // Hook into existing tab wiring if present
  const NAV_SEL = 'nav.tabs';
  function wireActiveTab(){
    const nav = document.querySelector(NAV_SEL);
    if(!nav || nav.__lmActiveTabWired) return;
    nav.__lmActiveTabWired = true;
    nav.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('[role="tab"][data-tab]');
      if(!btn) return;
      const name = btn.getAttribute('data-tab');
      setBodyActiveTab(name);
      applyCaptionBarPolicy(name);
    }, { passive:true });

    // initialize from current aria-selected tab
    const current = nav.querySelector('[role="tab"][aria-selected="true"]') || nav.querySelector('[role="tab"][data-tab="caption"]');
    const name = current ? current.getAttribute('data-tab') : 'caption';
    setBodyActiveTab(name);
    applyCaptionBarPolicy(name);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wireActiveTab, { once:true });
  } else { wireActiveTab(); }

  // Re-apply policy on DOM mutations (images list loads async)
  const mo = new MutationObserver(()=>applyCaptionBarPolicy(document.body.getAttribute('data-active-tab')));
  mo.observe(document.body, { childList:true, subtree:true });
})();


// === Safety pin: ensure caption image bar stays under #pane-caption ===
(function(){
  function relocateCaptionBar(){
    const pane = document.getElementById('pane-caption');
    if(!pane) return;
    const ids = ['images-grid-wrapper','images-status','caption-image-row','btnRefreshImages'];
    ids.forEach(id=>{
      const el = document.getElementById(id);
      if (el && !pane.contains(el)){
        if(id === 'images-grid-wrapper'){
          let grp = el.closest('.grp');
          if(!grp){ grp = document.createElement('div'); grp.className = 'grp'; grp.appendChild(el); }
          pane.appendChild(grp);
        } else {
          pane.appendChild(el);
        }
      }
    });
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', relocateCaptionBar, { once:true });
  } else { relocateCaptionBar(); }
  const mo = new MutationObserver(relocateCaptionBar);
  mo.observe(document.body, { childList:true, subtree:true });
  window.relocateCaptionBar = relocateCaptionBar;
})();

// ===== LM-PATCH-A6 :: Materials module appended =====
// Self-contained: creates/reads 'materials' sheet, populates #mat-target, saves UI changes.
// Does not depend on top-level functions being on window; uses fetch fallbacks.
// Safe to include multiple times (boot guard).

(function(){
  if (window.__LM_MATERIALS_PATCH_APPLIED) {
    console.debug('[materials] overlay already applied');
    return;
  }
  window.__LM_MATERIALS_PATCH_APPLIED = 'LM-PATCH-A6';

  const MATERIALS_TITLE = 'materials';
  const DEFAULTS = { unlit:false, doubleSided:false, opacity:1, white2alpha:false, whiteThr:0.92, black2alpha:false, blackThr:0.08 };

  // --- helpers ---
  function log(...a){ try{ console.log('[materials]', ...a); }catch(_){} }
  function warn(...a){ try{ console.warn('[materials]', ...a); }catch(_){} }

  // spreadsheet id & active sheet id detection (works with existing tabs UI)
  function getActiveSheetId(){
    const g = window;
    const cand = [g.currentSheetId, g.activeSheetId, g.sheetId, g.currentGid, g.currentSheetGid]
      .find(v => (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && /^\d+$/.test(v)));
    if(cand!=null) return Number(cand);
    try{
      const sel = document.querySelector('nav select, #save-target-sheet, #sheet-select, select[name="sheet"], select[data-role="sheet"]');
      if(sel && sel.value && /^\d+$/.test(sel.value)) return Number(sel.value);
      const any = document.querySelector('select option:checked');
      if(any && /^\d+$/.test(any.value)) return Number(any.value);
    }catch(e){}
    return 0;
  }
  async function ensureAuth(){
    try{
      // our boot defines ensureToken() that throws when missing
      if (typeof window.ensureToken === 'function'){ window.ensureToken(); }
    }catch(e){ throw e; }
    if (typeof window.getAccessToken === 'function'){
      const t = window.getAccessToken();
      if (t && typeof t === 'string') return t;
    }
    throw new Error('no_token');
  }
  async function GV(ssid, rangeA1, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`;
    const r = await fetch(url, { headers:{ Authorization:'Bearer '+token } });
    if(!r.ok) throw new Error('values.get '+r.status);
    const j = await r.json(); return j.values||[];
  }
  async function PV(ssid, rangeA1, rows, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
    const body = { range: rangeA1, majorDimension:'ROWS', values: rows };
    const r = await fetch(url, { method:'PUT', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('values.update '+r.status+' '+t); }
  }
  async function AV(ssid, rangeA1, rows, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const body = { range: rangeA1, majorDimension:'ROWS', values: rows };
    const r = await fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('values.append '+r.status+' '+t); }
  }

  const idxMap = new Map();  // "sheetId::matKey" -> { rowIndex }
  const cache  = new Map();  // same key -> settings object
  const K = (sid, key)=> `${sid}::${key}`;

  async function ensureMaterialsSheet(token){
    const ssid = window.currentSpreadsheetId;
    if(!ssid) return false;
    const headers = ['sheetId','materialKey','unlit','doubleSided','opacity','white2alpha','whiteThr','black2alpha','blackThr','updatedAt','updatedBy'];
    try{
      // try read header
      const vals = await GV(ssid, `'${MATERIALS_TITLE}'!A1:K1`, token);
      if(!vals || !vals.length || !(vals[0]||[]).length){
        await PV(ssid, `'${MATERIALS_TITLE}'!A1:K1`, [headers], token);
      }
      return true;
    }catch(_e){
      // create sheet then write header
      const body = { requests:[{ addSheet:{ properties:{ title: MATERIALS_TITLE } } }] };
      const url  = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}:batchUpdate`;
      const r = await fetch(url, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      if(!r.ok){ const t = await r.text().catch(()=> ''); warn('addSheet failed', r.status, t); return false; }
      await PV(ssid, `'${MATERIALS_TITLE}'!A1:K1`, [headers], token);
      return true;
    }
  }

  async function ensureIndex(){
    idxMap.clear(); cache.clear();
    const token = await ensureAuth().catch(()=>null);
    const ssid  = window.currentSpreadsheetId;
    const sid   = getActiveSheetId();
    if(!token || !ssid || !sid) return false;
    const ok = await ensureMaterialsSheet(token);
    if(!ok) return false;
    const values = await GV(ssid, `'${MATERIALS_TITLE}'!A1:K9999`, token).catch(e=>{ warn('GV failed', e); return []; });
    if(!values || !values.length) return true;
    const headers = values[0].map(v => (v||'').toString().trim());
    const idx = {}; headers.forEach((h,i)=> idx[h.toLowerCase()] = i);
    const iSheetId = idx['sheetid'], iKey = idx['materialkey'];
    for(let r=1;r<values.length;r++){
      const row = values[r]||[]; const s = Number(row[iSheetId]||0); const mkey = (row[iKey]||'').toString();
      if(!s || !mkey) continue;
      const key = K(s, mkey);
      idxMap.set(key, { rowIndex: r+1 });
      function getB(name, def){ const i=idx[name]; if(i==null) return def; const v=row[i]; return (String(v).trim()==='1'||String(v).toLowerCase()==='true'); }
      function getN(name, def){ const i=idx[name]; if(i==null) return def; const n=Number(row[i]); return isFinite(n)?n:def; }
      cache.set(key, {
        unlit: getB('unlit', false),
        doubleSided: getB('doublesided', false),
        opacity: getN('opacity', 1),
        white2alpha: getB('white2alpha', false),
        whiteThr: getN('whitethr', 0.92),
        black2alpha: getB('black2alpha', false),
        blackThr: getN('blackthr', 0.08),
      });
    }
    return true;
  }

  async function upsertSheetRow(sheetId, materialKey, settings){
    const token = await ensureAuth();
    const ssid  = window.currentSpreadsheetId;
    const key = K(sheetId, materialKey);
    const now = new Date().toISOString();
    const by  = (window.gapiUserEmail || 'unknown');
    const row = [ sheetId, materialKey,
      settings.unlit?1:0, settings.doubleSided?1:0, settings.opacity,
      settings.white2alpha?1:0, settings.whiteThr, settings.black2alpha?1:0, settings.blackThr,
      now, by
    ];
    const hit = idxMap.get(key);
    if(hit && hit.rowIndex){
      const range = `'${MATERIALS_TITLE}'!A${hit.rowIndex}:K${hit.rowIndex}`;
      await PV(ssid, range, [row], token);
    }else{
      await AV(ssid, `'${MATERIALS_TITLE}'!A2:K9999`, [row], token);
      await ensureIndex();
    }
    cache.set(key, { ...settings });
    log('saved', { sheetId, materialKey });
  }

  // scene/materials discovery
  function detectScene(){ return window.gltfScene || window.scene || (window.viewer && (window.viewer.scene || window.viewer.gltfScene)) || null; }
  function collectCands(scene){
    const out=[]; if(!scene||!scene.traverse) return out;
    scene.traverse(obj=>{
      try{
        if(obj && obj.isMesh){
          const meshName = obj.name || 'Mesh';
          const pushOne = (mat)=>{
            if(!mat) return;
            const mName = mat.name || 'Material';
            const key   = `${meshName}/${mName}`;
            const label = `${mName} — ${meshName}`;
            out.push({ key, label });
          };
          if(Array.isArray(obj.material)) obj.material.forEach(pushOne); else pushOne(obj.material);
        }
      }catch(_){}
    });
    const uniq = new Map(); out.forEach(o=> uniq.set(o.key, o));
    const arr = Array.from(uniq.values());
    if(!arr.length) arr.push({ key:'GLOBAL', label:'GLOBAL (all materials)' });
    return arr;
  }
  function populateTarget(cands){
    const sel = document.getElementById('mat-target'); if(!sel) return false;
    const prev = sel.value; sel.innerHTML='';
    cands.forEach(c=>{ const opt=document.createElement('option'); opt.value=c.key; opt.textContent=c.label; sel.appendChild(opt); });
    if(prev && cands.some(c=>c.key===prev)) sel.value=prev; else if(cands.length) sel.value=cands[0].key;
    sel.dispatchEvent(new Event('change'));
    return true;
  }

  function readUI(){
    const get = (id)=> document.getElementById(id);
    const v = {
      materialKey: (get('mat-target')?.value || ''),
      unlit: !!get('mat-unlit')?.checked,
      doubleSided: !!get('mat-doubleside')?.checked,
      opacity: Number(get('mat-opacity')?.value ?? 1),
      white2alpha: !!get('mat-white2alpha')?.checked,
      whiteThr: Number(get('mat-white-thr')?.value ?? 0.92),
      black2alpha: !!get('mat-black2alpha')?.checked,
      blackThr: Number(get('mat-black-thr')?.value ?? 0.08),
    };
    return v;
  }
  function writeUI(s){
    const set=(id,fn)=>{ const el=document.getElementById(id); if(el) fn(el); };
    set('mat-unlit', el=> el.checked = !!s.unlit);
    set('mat-doubleside', el=> el.checked = !!s.doubleSided);
    set('mat-opacity', el=> el.value = Number(s.opacity ?? 1));
    set('mat-white2alpha', el=> el.checked = !!s.white2alpha);
    set('mat-white-thr', el=> el.value = Number(s.whiteThr ?? 0.92));
    set('mat-black2alpha', el=> el.checked = !!s.black2alpha);
    set('mat-black-thr', el=> el.value = Number(s.blackThr ?? 0.08));
    const wOut = document.getElementById('mat-white-thr-val'); if(wOut) wOut.textContent = String((s.whiteThr ?? 0.92).toFixed(2));
    const bOut = document.getElementById('mat-black-thr-val'); if(bOut) bOut.textContent = String((s.blackThr ?? 0.08).toFixed(2));
  }

  function notifyApply(materialKey, settings){
    try{
      const detail = { materialKey, settings, sheetId: getActiveSheetId() };
      window.dispatchEvent(new CustomEvent('materials:apply', { detail }));
      if(typeof window.materialsApplyHook === 'function'){ window.materialsApplyHook(detail); }
    }catch(_){}
  }

  function onUIChanged(){
    const s = readUI();
    if(!s.materialKey) return;
    const merged = Object.assign({}, DEFAULTS, s);
    const key = K(getActiveSheetId(), s.materialKey);
    cache.set(key, merged);
    notifyApply(s.materialKey, merged);
    if(onUIChanged._t) clearTimeout(onUIChanged._t);
    onUIChanged._t = setTimeout(()=>{
      upsertSheetRow(getActiveSheetId(), s.materialKey, merged).catch(e=> warn('save failed', e));
    }, 220);
  }
  function wireUI(){
    const ids = ['mat-target','mat-unlit','mat-doubleside','mat-opacity','mat-white2alpha','mat-white-thr','mat-black2alpha','mat-black-thr'];
    ids.forEach(id=>{
      const el = document.getElementById(id); if(!el) return;
      el.addEventListener(el.tagName==='SELECT'?'change':'input', onUIChanged);
    });
    const r1 = document.getElementById('mat-reset-one');
    const rAll = document.getElementById('mat-reset-all');
    if(r1) r1.addEventListener('click', ()=>{ writeUI(DEFAULTS); onUIChanged(); });
    if(rAll) rAll.addEventListener('click', ()=>{ writeUI(DEFAULTS); onUIChanged(); });
  }

  async function bootOnce(){
    if(bootOnce._done) return;
    bootOnce._done = true;
    log('bootOnce');

    // wait spreadsheet & active gid
    let tries=0;
    while((!window.currentSpreadsheetId || !getActiveSheetId()) && tries<60){
      await new Promise(r=> setTimeout(r, 250)); tries++;
    }
    log('ids', { spreadsheet: window.currentSpreadsheetId||null, sheetId: getActiveSheetId(), waited: tries });

    await ensureIndex();

    // collect materials after GLB is attached
    let sTries=0;
    while(true){
      const sc = detectScene();
      const cands = collectCands(sc);
      if(cands && cands.length){
        populateTarget(cands);
        break;
      }
      if(sTries++ > 60) { populateTarget([{ key:'GLOBAL', label:'GLOBAL (all materials)' }]); break; }
      await new Promise(r=> setTimeout(r, 250));
    }

    wireUI();

    // set UI from cache if exists
    const mk = (document.getElementById('mat-target')?.value || 'GLOBAL');
    const key = K(getActiveSheetId(), mk);
    writeUI(cache.get(key) || DEFAULTS);
    notifyApply(mk, cache.get(key) || DEFAULTS);
  }

  // bootstrap
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootOnce, { once:true });
  else setTimeout(bootOnce, 0);

  // external trigger
  window.addEventListener('materials:refresh', ()=> setTimeout(bootOnce, 0));

  log('overlay applied', window.__LM_MATERIALS_PATCH_APPLIED);
})();
// ===== end LM-PATCH-A6 =====
/* === LM HOTFIX APPEND-ONLY (do not edit above) ============================ */
(async function LM_HOTFIX_APPEND_ONLY(){
  // 1) client_id をメタと __LM_CLIENT_ID にバインド（既に入っていても上書きしない）
  try {
    const meta = document.querySelector("meta[name='google-signin-client_id']");
    const cid  = (window.GIS_CLIENT_ID || window.__LM_CLIENT_ID || (meta && meta.content) || "").trim();
    if (cid) {
      if (!meta) {
        const m = document.createElement('meta');
        m.setAttribute('name','google-signin-client_id');
        m.setAttribute('content', cid);
        document.head.appendChild(m);
      } else if (!meta.getAttribute('content')) {
        meta.setAttribute('content', cid);
      }
      window.__LM_CLIENT_ID = window.__LM_CLIENT_ID || cid;
      // gauth に通知
      try { window.dispatchEvent(new CustomEvent('materials:clientId',{detail:{client_id:cid}})); } catch {}
      console.log('[boot.hotfix] client_id bridged');
    }
  } catch(e) { console.warn('[boot.hotfix] bind client_id failed', e); }

  // 2) Sign in ボタンをポップアップ・セーフに結線（既存ハンドラはそのまま・重複防止）
  try {
    const btn = document.getElementById('auth-signin') || document.querySelector('[data-lm-signin]');
    if (btn && !btn.__lm_clickPatch2) {
      btn.__lm_clickPatch2 = true;
      btn.addEventListener('click', async (ev)=>{
        try {
          const g = await import('./gauth.module.js');
          await g.signIn(); // prompt:'consent'
          console.log('[signin] token ok (popup-safe)');
          window.dispatchEvent(new CustomEvent('materials:auth',{detail:{authed:true}}));
        } catch(err) {
          console.warn('[signin] failed', err);
          alert('Google サインインに失敗しました。ポップアップを許可してください。');
        }
      }, { passive:true });
      console.log('[boot.hotfix] signin wired');
    }
  } catch(e) { console.warn('[boot.hotfix] signin wire failed', e); }

  // 3) 認可付き fetch ヘルパ（既存コードは変更せず、必要箇所のみこれを呼べるように export）
  if (!window.__lm_fetchJSONAuth) {
    window.__lm_fetchJSONAuth = async function(url, init={}){
      const g = await import('./gauth.module.js');
      const tok = await g.getAccessToken();
      if (!tok) throw new Error('no_token');
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Bearer ${tok}`);
      headers.set('Accept', 'application/json');
      const res = await fetch(url, { ...init, headers });
      if (!res.ok) {
        const t = await res.text().catch(()=> '');
        console.warn('[boot.hotfix] fetchJSONAuth fail', res.status, url, t.slice(0,200));
        throw new Error(`HTTP ${res.status}`);
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res;
    };
    console.log('[boot.hotfix] __lm_fetchJSONAuth ready');
  }

  // 4) GLB→親フォルダ→スプレッドシート検索/作成の“補助ライン”
  //    既存実装が失敗した時だけ働く。成功時は何もしない（materials:spreadsheetId 未発火の場合の保険）
  let spreadsheetSignaled = false;
  window.addEventListener('materials:spreadsheetId', ()=> { spreadsheetSignaled = true; }, { once:true });

  window.addEventListener('viewer:glbLoaded', async (ev)=>{
    if (spreadsheetSignaled) return; // 既存が成功していれば何もしない
    try {
      const glbId = ev?.detail?.fileId || ev?.detail?.driveFileId;
      const fetchJSONAuth = window.__lm_fetchJSONAuth;

      // LM_PARENT_FOLDER_ID があればそれを、無ければ GLB の親を取得
      let parentId = (window.LM_PARENT_FOLDER_ID || '').trim();
      if (!parentId && glbId) {
        const json = await fetchJSONAuth(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(glbId)}?fields=parents&supportsAllDrives=true`
        );
        parentId = json?.parents?.[0] || '';
      }
      if (!parentId) throw new Error('parentFolderId required');

      // 同フォルダのスプレッドシート検索
      const q = encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
      const urlList = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime&includeItemsFromAllDrives=true desc&pageSize=10&supportsAllDrives=true`;
      const list = await fetchJSONAuth(urlList);
      let ssid = list?.files?.[0]?.id || '';

      // 無ければ作成 → 親へ移動
      if (!ssid) {
        const created = await fetchJSONAuth('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties:{ title:'LociMyu Captions' } })
        });
        ssid = created?.spreadsheetId || '';
        if (ssid) {
          try {
            const moveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ssid)}?addParents=${encodeURIComponent(parentId)}&supportsAllDrives=true`;
            await fetchJSONAuth(moveUrl, { method:'PATCH' });
          } catch(e) { console.warn('[boot.hotfix] move spreadsheet failed (non-fatal)', e); }
        }
      }

      if (ssid) {
        try { localStorage.setItem('lm:ssid', ssid); } catch {}
        window.currentSpreadsheetId = ssid;
        window.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail:{ id: ssid } }));
        console.log('[boot.hotfix] spreadsheet ensured', ssid);
      }
    } catch(e) {
      console.warn('[boot.hotfix] spreadsheet ensure fallback failed', e);
    }
  });

  console.log('[boot.hotfix] append-only patch active');
})();

