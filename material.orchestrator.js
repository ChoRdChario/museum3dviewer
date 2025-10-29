// material.orchestrator.js
// Robust, idempotent orchestrator for Material tab.
// - Populate material list after model truly ready
// - Save per-material opacity to __LM_MATERIALS (per sheet)
// - Auto ensure sheet after lm:sheet-context + auth fallback

const VERSION_TAG = 'V6_10_AUTH_UI_ENSURE';
const SHEET_TITLE = '__LM_MATERIALS';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly';

const log = (...a)=>console.log('[mat-orch]', ...a);
const warn = (...a)=>console.warn('[mat-orch]', ...a);
log('loaded VERSION_TAG:'+VERSION_TAG);

// --- DOM refs
const $ = (s)=>document.querySelector(s);
const ui = {
  sel: $('#pm-material'),
  range: $('#pm-opacity-range'),
  out: $('#pm-opacity-val'),
  flagDouble: $('#pm-flag-doublesided'),
  flagUnlit: $('#pm-flag-unlit'),
  ckEnable: $('#pm-chroma-enable'),
  ckColor: $('#pm-chroma-color'),
  ckTol:   $('#pm-chroma-tol'),
  ckFea:   $('#pm-chroma-feather'),
  authSlot: $('#material-auth-slot'),
};

// --- sheet context (from sheet.ctx.bridge.js)
const ctx = { spreadsheetId:null, sheetGid:null };

// --- Token helpers
let _tokenClient;   // GIS client
let _cachedToken;   // last token

async function getAccessToken({prompt}={}){
  // 1) user-provided accessor
  if (typeof window.__lm_getAccessToken === 'function'){
    const t = await window.__lm_getAccessToken();
    if (t) return t;
  }
  // 2) legacy gauth
  if (window.gauth?.getAccessToken){
    try{
      const t = await window.gauth.getAccessToken();
      if (t) return t;
    }catch{}
  }
  // 3) GIS
  if (!_tokenClient){
    await ensureGisLoaded();
    const clientId = window.__LM_CLIENT_ID || window.gauth?.CLIENT_ID || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp)=>{ _cachedToken = resp?.access_token || null; }
    });
  }
  _cachedToken = null;
  try{
    _tokenClient.requestAccessToken({ prompt: prompt || 'consent' });
  }catch(e){
    // Popup blocked → surface UI guidance and rethrow
    throw new Error('popup_blocked');
  }
  // wait up to ~2s
  const until = performance.now()+2500;
  while(!_cachedToken && performance.now()<until){
    await new Promise(r=>setTimeout(r,40));
  }
  if (!_cachedToken) throw new Error('token_missing');
  return _cachedToken;
}

function authUI(show){
  if (!ui.authSlot) return;
  ui.authSlot.innerHTML = '';
  if (!show) return;
  const wrap = document.createElement('div');
  wrap.className = 'auth-tip';
  wrap.innerHTML = `
    <div>Google Sheets へのアクセス許可が必要です。<br>
    ブラウザがポップアップをブロックしている場合は解除してください。</div>
    <button class="auth-btn" id="mat-auth-btn">Authorize Google Sheets</button>
  `;
  ui.authSlot.appendChild(wrap);
  wrap.querySelector('#mat-auth-btn')?.addEventListener('click', async ()=>{
    try{
      await getAccessToken({prompt:'consent'});
      authUI(false);
      if (ctx.spreadsheetId) await ensureMaterialSheet();
    }catch(e){
      warn('auth failed', e?.message||e);
    }
  });
}

async function ensureGisLoaded(){
  if (window.google?.accounts?.oauth2) return;
  await new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// --- Sheets API helpers
async function authFetch(url, init={}){
  let tok;
  // try silent first (no prompt)
  try{
    tok = await getAccessToken({prompt:''});
  }catch(e){
    // if popup was blocked or no token, surface UI and rethrow
    authUI(true);
    throw e;
  }
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${tok}`);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(url, {...init, headers});
  if (!res.ok){
    const msg = await res.text().catch(()=>String(res.status));
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return res.json().catch(()=>({}));
}

function assertCtx(){
  if (!ctx.spreadsheetId) throw new Error('no_spreadsheet');
}

// -- Ensure __LM_MATERIALS exists (idempotent)
async function ensureMaterialSheet(){
  assertCtx();
  const id = ctx.spreadsheetId;

  // 1) list sheets
  const meta = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}`);
  const has = (meta.sheets||[]).some(s=>s.properties?.title === SHEET_TITLE);
  if (!has){
    // add sheet
    await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method:'POST',
      body: JSON.stringify({
        requests:[{ addSheet:{ properties:{ title:SHEET_TITLE }}}]
      })
    });
    // header row
    await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(SHEET_TITLE)}!A1:F?valueInputOption=RAW`, {
      method:'PUT',
      body: JSON.stringify({ values: [[ 'sheetGid','matUuid','matName','schemaVer','props','updatedAt' ]] })
    });
    log('created', SHEET_TITLE);
  }
}

// -- Save current opacity (append)
let _saveTimer=null;
function scheduleSave(){ clearTimeout(_saveTimer); _saveTimer=setTimeout(saveCurrentOpacity, 400); }

async function saveCurrentOpacity(){
  if (!ctx.spreadsheetId) { warn('save skipped: no sheet context'); return; }
  const name = ui.sel?.value || '';
  if (!name) return;

  // Read current opacity from scene if possible
  const v = Number(ui.range?.value ?? 1);
  const props = { opacity: v };
  const row = [
    String(ctx.sheetGid ?? ''),
    '',          // matUuid (未来で拡張)
    name,
    1,           // schemaVer
    JSON.stringify(props),
    new Date().toISOString()
  ];
  const id = ctx.spreadsheetId;
  await ensureMaterialSheet();
  await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(SHEET_TITLE)}!A1:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method:'POST',
    body: JSON.stringify({ values:[row] })
  });
  // ok
}

// --- Populate materials after model truly ready
function listFromScene(){
  const s = window.__LM_SCENE;
  const set = new Set();
  s?.traverse(o=>{
    if (!o?.isMesh || !o.material) return;
    const arr = Array.isArray(o.material)?o.material:[o.material];
    arr.forEach(m=>m?.name && set.add(m.name));
  });
  return [...set];
}
async function listFromViewer(){
  try{
    const mod = await import('./viewer.module.cdn.js');
    return (mod?.listMaterials?.() || []).map(m=>m?.name).filter(Boolean);
  }catch{return []}
}
function dedup(names){ return [...new Set(names)].filter(n=>!/^#\d+$/.test(n)); }

function fillSelect(names){
  const sel = ui.sel; if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select material —</option>' +
    names.map(n=>`<option value="${n}">${n}</option>`).join('');
  if (cur && names.includes(cur)) sel.value = cur;
  updateValueDisplay();
}

function updateValueDisplay(){
  const name = ui.sel?.value;
  let v = 1;
  if (name){
    // try to read from scene
    const s = window.__LM_SCENE;
    let found=null;
    s?.traverse(o=>{
      if (found!=null || !o?.isMesh || !o.material) return;
      const arr = Array.isArray(o.material)?o.material:[o.material];
      arr.some(m=>{
        if ((m?.name||'')===name){ found = Number(m.opacity ?? 1); return true; }
        return false;
      });
    });
    v = (found==null)?1:Math.max(0,Math.min(1,found));
  }
  if (ui.range) ui.range.value = v;
  if (ui.out)   ui.out.textContent = (Number(v)||1).toFixed(2);
}

function setOpacityByName(name, v){
  v = Math.max(0, Math.min(1, Number(v)));
  import('./viewer.module.cdn.js').then(viewer=>{
    if (viewer?.applyMaterialPropsByName){
      viewer.applyMaterialPropsByName(name, { opacity:v });
      return;
    }
    const s = window.__LM_SCENE;
    s?.traverse(o=>{
      if (!o?.isMesh || !o.material) return;
      (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
        if ((m?.name||'')===name){
          m.transparent = v<1;
          m.opacity = v;
          m.depthWrite = v>=1;
          m.needsUpdate = true;
        }
      });
    });
  }).catch(()=>{});
}

async function populateWhenReady(){
  // wait scene
  if (!window.__LM_SCENE){
    await new Promise(r=>document.addEventListener('lm:scene-ready', r, {once:true}));
  }
  await new Promise(r=>setTimeout(r,50));
  let tries=0, names=[];
  while (tries++<30){
    const a = await listFromViewer();
    const b = listFromScene();
    names = dedup([...a, ...b]);
    if (names.length) break;
    await new Promise(r=>setTimeout(r,200));
  }
  if (names.length){ fillSelect(names); }
  else { warn('hotfix] materials still empty after retries (non-fatal)'); }
}

// --- Wire UI
ui.sel?.addEventListener('change', updateValueDisplay);
ui.range?.addEventListener('input', ()=>{
  const n = ui.sel?.value; if (!n) return;
  const v = Number(ui.range.value||1);
  if (ui.out) ui.out.textContent = v.toFixed(2);
  setOpacityByName(n, v);
  scheduleSave();
}, {passive:true});

function fire(type, payload){
  const name = ui.sel?.value; if (!name) return;
  document.dispatchEvent(new CustomEvent(type, { detail: { name, ...payload }}));
}
ui.flagDouble?.addEventListener('change', e=>fire('pm:flag-change', { doubleSided: e.target.checked }));
ui.flagUnlit?.addEventListener('change',  e=>fire('pm:flag-change', { unlitLike:   e.target.checked }));

ui.ckEnable?.addEventListener('change', ()=>fire('pm:chroma-change', {
  enabled: ui.ckEnable.checked,
  color: ui.ckColor?.value || '#000000',
  tolerance: Number(ui.ckTol?.value||0),
  feather:   Number(ui.ckFea?.value||0),
}));
[ui.ckColor, ui.ckTol, ui.ckFea].forEach(el=>{
  el?.addEventListener('input', ()=>{
    if (!ui.ckEnable?.checked) return;
    fire('pm:chroma-change', {
      enabled: true,
      color: ui.ckColor?.value || '#000000',
      tolerance: Number(ui.ckTol?.value||0),
      feather:   Number(ui.ckFea?.value||0),
    });
  }, {passive:true});
});

// --- Sheet context bridge
function setCurrentSheetContext({spreadsheetId, sheetGid}){
  ctx.spreadsheetId = spreadsheetId || null;
  ctx.sheetGid = (typeof sheetGid==='number' || typeof sheetGid==='string') ? Number(sheetGid) : null;
  log('sheet context set', {spreadsheetId:ctx.spreadsheetId, sheetGid:ctx.sheetGid});
}
async function ensureIfCtx(){
  if (!ctx.spreadsheetId) return;
  try{
    await ensureMaterialSheet();
  }catch(e){
    warn('auto-ensure failed', e);
    if (String(e?.message||e).includes('popup_blocked') || String(e?.message||e).includes('token_missing')){
      authUI(true);
    }
  }
}

document.addEventListener('lm:sheet-context', (ev)=>{
  const det = ev?.detail || {};
  setCurrentSheetContext(det);
  ensureIfCtx();
});

// --- Start
populateWhenReady();
document.addEventListener('lm:model-ready', populateWhenReady);
document.getElementById('tab-material')?.addEventListener('click', populateWhenReady);

export const lmMaterials = {
  setCurrentSheetContext,
  ensureMaterialSheet,
  saveCurrentOpacity,
  report(){ return { ...ctx, VERSION_TAG:'VERSION_TAG:'+VERSION_TAG }; }
};
// expose for console debug
window.lmMaterials = lmMaterials;
