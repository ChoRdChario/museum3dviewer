/* views.ui.controller.js — Phase 1 (runtime-only)
 * Bind Views tab UI to viewer bridge APIs.
 */
(function(){
  const TAG='[views.ui]';
  const log=(...a)=>{ try{console.log(TAG,...a);}catch(_){} };
  const warn=(...a)=>{ try{console.warn(TAG,...a);}catch(_){} };

  const $ = (id)=>document.getElementById(id);

  function normHex(hex){
    if (hex == null) return null;
    let s = String(hex).trim();
    if (!s) return null;
    if (s.startsWith('#')) s = s.slice(1);
    if (s.length === 3) s = s.split('').map(c=>c+c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return '#' + s.toLowerCase();
  }

  function rgbToHex(rgb){
    if (!rgb) return null;
    const m = String(rgb).match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map(s=>s.trim());
    if (parts.length < 3) return null;
    const r = Math.max(0, Math.min(255, parseInt(parts[0], 10)));
    const g = Math.max(0, Math.min(255, parseInt(parts[1], 10)));
    const b = Math.max(0, Math.min(255, parseInt(parts[2], 10)));
    const to2 = (n)=>n.toString(16).padStart(2,'0');
    return '#' + to2(r) + to2(g) + to2(b);
  }

  function getDefaultCssBg(){
    const stage = document.getElementById('stage') || document.body;
    const c = getComputedStyle(stage).backgroundColor;
    return rgbToHex(c) || '#202124';
  }

  function getBridge(){
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

// ---- Phase 2: Persist last view per caption sheet (best-effort) ----
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

async function ensureAuthFetch(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
  try{
    const mod = await import('./auth.fetch.bridge.js');
    if (typeof mod?.default === 'function'){
      const fn = await mod.default();
      if (typeof fn === 'function') return fn;
    }
  }catch(e){ /* ignore */ }
  if (typeof window.__lm_fetchJSONAuth !== 'function'){
    throw new Error('__lm_fetchJSONAuth not available');
  }
  return window.__lm_fetchJSONAuth;
}

async function ensureViewsHeader(spreadsheetId){
  const fn = window.__lm_ensureViewsHeader || window.ensureViewsHeader;
  if (typeof fn !== 'function') return;
  await fn(spreadsheetId);
}

function ctxKey(ctx){
  if (!ctx) return '';
  // sheetGid can be 0 (first sheet). Preserve 0 by avoiding || fallback.
  const sid = (ctx.spreadsheetId == null) ? '' : String(ctx.spreadsheetId);
  const gid = (ctx.sheetGid == null) ? '' : String(ctx.sheetGid);
  return sid + ":" + gid;
}

async function readAllViewsRows(ctx){
  const fetchAuth = await ensureAuthFetch();
  const range = encodeURIComponent("__LM_VIEWS!A:Q");
  const url = `${SHEETS}/${encodeURIComponent(ctx.spreadsheetId)}/values/${range}`;
  const res = await fetchAuth(url, { method:'GET', rawResponse:true });
  if (!res.ok) throw new Error("[views.sheet] read failed "+res.status);
  const json = await res.json();
  return (json.values || []);
}

async function updateRow(ctx, rowIndex1, row){
  const fetchAuth = await ensureAuthFetch();
  const range = `__LM_VIEWS!A${rowIndex1}:Q${rowIndex1}`;
  const url = `${SHEETS}/${encodeURIComponent(ctx.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const body = { range, majorDimension:"ROWS", values:[row] };
  const res = await fetchAuth(url, { method:'PUT', json: body, rawResponse:true });
  if (!res.ok) throw new Error("[views.sheet] update failed "+res.status);
  return true;
}

async function appendRow(ctx, row){
  const fetchAuth = await ensureAuthFetch();
  const range = encodeURIComponent("__LM_VIEWS!A:Q");
  const url = `${SHEETS}/${encodeURIComponent(ctx.spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const body = { majorDimension:"ROWS", values:[row] };
  const res = await fetchAuth(url, { method:'POST', json: body, rawResponse:true });
  if (!res.ok) throw new Error("[views.sheet] append failed "+res.status);
  return true;
}

function mkId(){
  const rnd = Math.random().toString(36).slice(2,10);
  return "v_" + Date.now().toString(36) + "_" + rnd;
}

function toNum(v){
  const n = Number(v);
  return (isFinite(n) ? n : '');
}
function parseNum(v, fallback=0){
  const n = Number(v);
  return (isFinite(n) ? n : fallback);
}

function rowToState(row){
  if (!row || row.length < 15) return null;
  const cameraType = String(row[4]||'').toLowerCase();
  const eye = { x: parseNum(row[5]), y: parseNum(row[6]), z: parseNum(row[7]) };
  const target = { x: parseNum(row[8]), y: parseNum(row[9]), z: parseNum(row[10]) };
  const up = { x: parseNum(row[11], 0), y: parseNum(row[12], 1), z: parseNum(row[13], 0) };
  const fov = (row[14] === '' || row[14] == null) ? undefined : parseNum(row[14], undefined);
  const bgColor = normHex(row[3] || '') || null;
  const st = { type: cameraType || undefined, eye, target, up };
  if (typeof fov === 'number' && isFinite(fov)) st.fov = fov;
  return { state: st, bgColor };
}

async function loadLastView(ctx){
  try{
    if (!ctx || !ctx.spreadsheetId || !ctx.sheetGid) return false;
    await ensureViewsHeader(ctx.spreadsheetId);
    const rows = await readAllViewsRows(ctx);
    if (!rows || rows.length < 2) return false;

    const gid = String(ctx.sheetGid);
    let best = null;
    for (let i=1; i<rows.length; i++){
      const r = rows[i] || [];
      const rgid = String(r[1]||'');
      const name = String(r[2]||'');
      if (rgid === gid && name === "__last"){
        const upd = String(r[16]||'');
        if (!best || (upd && upd > best.upd)){
          best = { row: r, upd, rowIndex1: i+1 };
        }
      }
    }
    if (!best) return false;
    const parsed = rowToState(best.row);
    if (!parsed) return false;

    const b = getBridge();
    if (!b || typeof b.setCameraState !== 'function' || typeof b.setBackgroundColor !== 'function') return false;

    if (parsed.bgColor) { try{ b.setBackgroundColor(parsed.bgColor); }catch(e){} }
    else { try{ b.setBackgroundColor(''); }catch(e){} }
    try{ b.setCameraState(parsed.state); }catch(e){}
    return true;
  }catch(e){
    warn('loadLastView failed', e);
    return false;
  }
}

async function saveLastView(ctx){
  const b = getBridge();
  if (!ctx || !ctx.spreadsheetId || !ctx.sheetGid) return false;
  if (!b || typeof b.getCameraState !== 'function' || typeof b.getBackgroundColor !== 'function') return false;

  try{
    await ensureViewsHeader(ctx.spreadsheetId);

    const cam = b.getCameraState();
    const bg  = b.getBackgroundColor(); // null => unset
    if (!cam || !cam.eye || !cam.target || !cam.up) return false;

    const now = new Date().toISOString();
    const gid = String(ctx.sheetGid);
    const name = "__last";

    const rows = await readAllViewsRows(ctx);
    let found = null;
    for (let i=1; i<(rows||[]).length; i++){
      const r = rows[i] || [];
      if (String(r[1]||'') === gid && String(r[2]||'') === name){
        const createdAt = String(r[15]||'') || now;
        const id = String(r[0]||'') || mkId();
        found = { rowIndex1: i+1, createdAt, id };
        break;
      }
    }

    const row = [
      (found && found.id) || mkId(),
      gid,
      name,
      (bg ? bg : ''),
      (cam.type || 'perspective'),
      toNum(cam.eye.x), toNum(cam.eye.y), toNum(cam.eye.z),
      toNum(cam.target.x), toNum(cam.target.y), toNum(cam.target.z),
      toNum(cam.up.x), toNum(cam.up.y), toNum(cam.up.z),
      (cam.type === 'perspective' ? toNum(cam.fov) : (cam.fov != null ? toNum(cam.fov) : '')),
      (found && found.createdAt) || now,
      now
    ];

    if (found) await updateRow(ctx, found.rowIndex1, row);
    else await appendRow(ctx, row);

    return true;
  }catch(e){
    warn('saveLastView failed', e);
    return false;
  }
}


  const elOrtho = $('proj-ortho');
  const elSave  = $('view-save');
  const elBgColor = $('bg-color');
  const elBgHex   = $('bg-hex');
  const elBgReset = $('bg-reset');
  const dirBtns = Array.from(document.querySelectorAll('#pane-views .vdir'));

// Active sheet context (for Phase 2 persistence)
let __views_ctx = window.__LM_SHEET_CTX || null;
let __views_lastLoadedKey = '';
let __views_saving = false;
let __views_saveTimer = null;
let __views_pendingSave = false;

function canPersist(){
  const b = getBridge();
  return !!(__views_ctx && __views_ctx.spreadsheetId && __views_ctx.sheetGid && b && typeof b.getCameraState === 'function');
}

function setSaveEnabled(enabled){
  if (!elSave) return;
  try{ elSave.disabled = !enabled; }catch(_){}
}

function scheduleSave(ms=2500){
  if (!canPersist()) { setSaveEnabled(false); return; }
  setSaveEnabled(true);
  if (__views_saveTimer) clearTimeout(__views_saveTimer);
  __views_saveTimer = setTimeout(()=>{ doSave(false); }, ms);
}

async function doSave(fromButton){
  if (!canPersist()) return;
  if (__views_saving){
    __views_pendingSave = true;
    return;
  }
  __views_saving = true;
  try{
    await saveLastView(__views_ctx);
    log(fromButton ? 'saved (button)' : 'saved (debounced)', { ctx: __views_ctx });
  }catch(e){
    warn('save failed', e);
  }finally{
    __views_saving = false;
    if (__views_pendingSave){
      __views_pendingSave = false;
      scheduleSave(1200);
    }
  }
}

async function maybeLoad(){
  if (!__views_ctx || !__views_ctx.spreadsheetId || !__views_ctx.sheetGid) return;
  // Only load when viewer seems ready (bounds available)
  const b = getBridge();
  if (!b || typeof b.getModelBounds !== 'function') return;
  const bd = b.getModelBounds();
  if (!bd || !bd.center || !bd.size) return;

  const key = ctxKey(__views_ctx);
  if (key && key === __views_lastLoadedKey) return;

  __views_lastLoadedKey = key;
  const ok = await loadLastView(__views_ctx);
  if (ok){
    // Sync UI after applying persisted state
    try{ syncFromViewer(); }catch(_){}
    log('loaded last view', { ctx: __views_ctx });
  }
  setSaveEnabled(canPersist());
}


  if (!elOrtho || !elBgColor || !elBgHex || !elBgReset) {
    warn('Views UI elements not found; abort.');
    return;
  }

  function setEnabled(enabled){
    const dis = !enabled;
    try{ elOrtho.disabled = dis; }catch(_){}
    try{ elBgColor.disabled = dis; }catch(_){}
    try{ elBgHex.disabled = dis; }catch(_){}
    try{ elBgReset.disabled = dis; }catch(_){}
    try{ dirBtns.forEach(b=>b.disabled = dis); }catch(_){}
  }

  // init.ready.gate.js temporarily disables all controls in #ui while async
  // loads are settling, then restores each control's previous disabled state.
  // If Views enables controls during the gate window, the gate may later revert
  // them back to disabled. To avoid "perma-grey" in Edit mode, we:
  //  - delay enabling while the gate is active, and
  //  - retry enabling on lm:ready-gate-done.

  function isGateBusy(){
    try{
      const ui = document.getElementById('ui');
      if (!ui) return false;
      return ui.classList.contains('lm-busy') || ui.getAttribute('aria-busy') === 'true';
    }catch(_){
      return false;
    }
  }

  function clearGateRestoreMarkers(){
    try{
      const list = [elOrtho, elBgColor, elBgHex, elBgReset, ...dirBtns];
      list.forEach(el=>{
        if (el && el.dataset && el.dataset.lmPrevDisabled != null){
          delete el.dataset.lmPrevDisabled;
        }
      });
    }catch(_){ }
  }

  let __views_wantsEnabled = false;

  function setBgUiUnset(){
    elBgHex.value = '';
    elBgHex.placeholder = 'unset';
    elBgColor.value = getDefaultCssBg();
    elBgColor.dataset.unset = '1';
  }

  function setBgUiHex(hex){
    const n = normHex(hex);
    if (!n) return setBgUiUnset();
    elBgHex.value = n;
    elBgHex.placeholder = '';
    elBgColor.value = n;
    delete elBgColor.dataset.unset;
  }

  function syncFromViewer(){
    const b = getBridge();
    if (!b) return;
    try{
      if (typeof b.getCameraState === 'function'){
        const cs = b.getCameraState();
        if (cs && cs.type) elOrtho.checked = (cs.type === 'orthographic');
      }
      if (typeof b.getBackgroundColor === 'function'){
        const bg = b.getBackgroundColor();
        if (bg) setBgUiHex(bg);
        else setBgUiUnset();
      } else {
        setBgUiUnset();
      }
    }catch(e){
      warn('syncFromViewer failed', e);
    }
  }

  function enableIfReady(){
    const b = getBridge();
    if (!b) { setEnabled(false); return; }

    function markReadyAndMaybeEnable(){
      __views_wantsEnabled = true;
      // If the ready-gate is active, do not enable now; the gate would later
      // restore the previous disabled state and we would end up perma-grey.
      if (isGateBusy()) return;
      clearGateRestoreMarkers();
      setEnabled(true);
      syncFromViewer();
      scheduleSave();
    }

    // GLB loaded => we should have bounds
    if (typeof b.getModelBounds === 'function'){
      const bd = b.getModelBounds();
      if (bd && bd.center && bd.size){
        markReadyAndMaybeEnable();
        return;
      }
    }
    // fallback: if scene has meshes
    if (typeof b.getScene === 'function'){
      const sc = b.getScene();
      let meshes = 0;
      try{ sc && sc.traverse(o=>{ if(o && o.isMesh) meshes++; }); }catch(_){}
      if (meshes > 0){
        markReadyAndMaybeEnable();
        return;
      }
    }
    setEnabled(false);
  }

  function applyProjection(){
    const b = getBridge();
    if (!b || typeof b.setProjection !== 'function') return;
    try{
      b.setProjection(elOrtho.checked ? 'orthographic' : 'perspective');
    }catch(e){ warn('setProjection failed', e); }
    syncFromViewer();
  }

  function applyBgHex(hex){
    const b = getBridge();
    if (!b || typeof b.setBackgroundColor !== 'function') return;
    const n = normHex(hex);
    if (!n) return;
    try{ b.setBackgroundColor(n); }catch(e){ warn('setBackgroundColor failed', e); }
    setBgUiHex(n);
  }

  function resetBg(){
    const b = getBridge();
    if (!b || typeof b.setBackgroundColor !== 'function') return;
    try{ b.setBackgroundColor(''); }catch(e){ warn('reset background failed', e); }
    setBgUiUnset();
    scheduleSave();
  }

  function vecLen(a,b){
    const dx = (a.x||0) - (b.x||0);
    const dy = (a.y||0) - (b.y||0);
    const dz = (a.z||0) - (b.z||0);
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  function applyDirection(dir){
    const b = getBridge();
    if (!b || typeof b.setCameraState !== 'function' || typeof b.getCameraState !== 'function') return;

    const bounds = (typeof b.getModelBounds === 'function') ? b.getModelBounds() : null;
    const cs = b.getCameraState();
    if (!bounds || !bounds.center || !bounds.size || !cs || !cs.eye || !cs.target) {
      warn('bounds/camera state not ready');
      return;
    }

    const center = { x:+bounds.center.x, y:+bounds.center.y, z:+bounds.center.z };
    const maxDim = Math.max(+bounds.size.x || 0, +bounds.size.y || 0, +bounds.size.z || 0, 1.0);

    const curDist = vecLen(cs.eye, cs.target);
    const dist = Math.max(curDist || 0, maxDim * 1.6, 1.0);

    let axis = { x:0, y:0, z:0 };
    switch(String(dir).toLowerCase()){
      case '+x': axis = {x:+1,y:0,z:0}; break;
      case '-x': axis = {x:-1,y:0,z:0}; break;
      case '+y': axis = {x:0,y:+1,z:0}; break;
      case '-y': axis = {x:0,y:-1,z:0}; break;
      case '+z': axis = {x:0,y:0,z:+1}; break;
      case '-z': axis = {x:0,y:0,z:-1}; break;
      default: return;
    }

    const eye = { x:center.x + axis.x*dist, y:center.y + axis.y*dist, z:center.z + axis.z*dist };

    // For top/bottom, use Z-up to reduce roll surprises.
    const up = (dir === '+y' || dir === '-y') ? {x:0,y:0,z:1} : {x:0,y:1,z:0};

    try{
      b.setCameraState({ eye, target:center, up });
    }catch(e){ warn('setCameraState failed', e); }
    try{ syncFromViewer(); }catch(_){ }
    scheduleSave();
  }

  // Bind events
  elOrtho.addEventListener('change', applyProjection);

  dirBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      applyDirection(btn.dataset.vdir);
    });
  });

  elBgColor.addEventListener('input', ()=>{
    applyBgHex(elBgColor.value);
  });

  elBgHex.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Enter'){
      const n = normHex(elBgHex.value);
      if (n) applyBgHex(n);
      else syncFromViewer();
      elBgHex.blur();
    }
  });
  elBgHex.addEventListener('blur', ()=>{
    const n = normHex(elBgHex.value);
    if (n) applyBgHex(n);
    else syncFromViewer();
  });

  elBgReset.addEventListener('click', resetBg);

  if (elSave) {
    elSave.addEventListener('click', ()=>{ doSave(true); });
  }

  // Initial state: disabled until scene is ready
  setEnabled(false);
  setBgUiUnset();

  // When the readiness gate releases the UI, re-apply Views enablement.
  // (Gate events are dispatched on `document`, not on `window`.)
  document.addEventListener('lm:ready-gate-done', ()=>{
    if (!__views_wantsEnabled) return;
    setTimeout(enableIfReady, 0);
  });


// Track sheet context changes (caption sheet switch)
window.addEventListener('lm:sheet-context', (ev)=>{
  __views_ctx = (ev && ev.detail) ? ev.detail : (window.__LM_SHEET_CTX || null);
  __views_lastLoadedKey = ''; // allow reload on next maybeLoad
  setSaveEnabled(canPersist());
  setTimeout(maybeLoad, 0);
});

  // Enable on scene-ready (fires at init and after GLB load; we re-check readiness)
  window.addEventListener('lm:scene-ready', ()=>{ setTimeout(enableIfReady, 0); setTimeout(maybeLoad, 0); });

  // Also re-check after GLB load signal if present
  window.addEventListener('lm:glb-loaded', ()=>{ setTimeout(enableIfReady, 0); setTimeout(maybeLoad, 0); });

  // Try a couple times on startup (in case bridge is late)
  setTimeout(enableIfReady, 800);
  setTimeout(maybeLoad, 900);
  setTimeout(enableIfReady, 2000);
  setTimeout(maybeLoad, 2100);

  log('armed');
})();