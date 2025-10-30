/* ==========================================================================
 * LociMyu Material Orchestrator — consolidated (2025-10-31)
 * VERSION_TAG: V6_12_MATERIAL_UPSERT_GATE
 *
 * What this file guarantees:
 *  - Does NOT break existing UI
 *  - Waits for both: {sheet-context(spreadsheetId)} AND {valid token}
 *  - Ensures __LM_MATERIALS sheet + header
 *  - Debounced, idempotent upsert on opacity changes
 *  - Works with existing events:
 *      - 'lm:scene-ready', 'lm:model-ready' (viewer side)
 *      - 'lm:sheet-context'              (sheet.ctx.bridge.js)
 *  - Compatible with: getAccessToken() sync/async, ensureToken({interactive:false})
 *  - Uses actual UI selectors: #pm-material (select), #pm-opacity-range (range)
 * -------------------------------------------------------------------------- */
(function(){
  const VER = 'V6_12_MATERIAL_UPSERT_GATE';
  const NS  = '[mat-orch]';
  const log = (...a)=>console.log(NS, ...a);
  const warn= (...a)=>console.warn(NS, ...a);

  log('loaded VERSION_TAG:'+VER);

  // ---------- State ---------------------------------------------------------
  const st = (window.__lm_materialState = window.__lm_materialState || {
    spreadsheetId: null,
    sheetGid: null,
    modelKey: null,
    currentMaterialKey: null,
    modelReady: false,
    sceneReady: false
  });

  // ---------- Events wiring (robust: listen on both window & document) ------
  function onSheetCtx(ev){
    const d = ev?.detail || {};
    if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
    log('sheet context set', {spreadsheetId: st.spreadsheetId, sheetGid: st.sheetGid});
    tryAutoEnsure();
    tryFlush();
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  function onScene(){ st.sceneReady = true; }
  window.addEventListener('lm:scene-ready', onScene);
  document.addEventListener('lm:scene-ready', onScene);

  function onModel(){
    st.modelReady = true;
    // absorb optional model key if provided by host
    if (!st.modelKey && typeof window.__lm_modelKey === 'string') st.modelKey = window.__lm_modelKey;
    tryAutoEnsure();
    tryFlush();
  }
  window.addEventListener('lm:model-ready', onModel);
  document.addEventListener('lm:model-ready', onModel);

  // ---------- Token helpers -------------------------------------------------
  let gateTokenReady = false;
  async function getAccessTokenSafe(){
    // 1) Accept sync/async getAccessToken
    try{
      if (typeof getAccessToken === 'function'){
        const v = getAccessToken();
        const t = (v && typeof v.then==='function') ? await v : v;
        if (t){ gateTokenReady = true; return t; }
      }
    }catch(e){/* ignore */}
    // 2) Silent refresh if already consented
    try{
      if (typeof ensureToken === 'function'){
        const v2 = ensureToken({ interactive:false });
        const t2 = (v2 && typeof v2.then==='function') ? await v2 : v2;
        if (t2){ gateTokenReady = true; return t2; }
      }
    }catch(e){/* ignore */}
    gateTokenReady = false;
    throw new Error('token_missing');
  }

  // ---------- Sheets ensure (__LM_MATERIALS + header) -----------------------
  const SHEET_TITLE = '__LM_MATERIALS';
  const HEADER = ["key","modelKey","materialKey","opacity","doubleSided","unlit","chromaEnable","chromaColor","chromaTolerance","chromaFeather","updatedAt","updatedBy","spreadsheetId","sheetGid"];
  const RANGE_A1 = SHEET_TITLE + '!A1:N1';

  async function authFetch(url, opt={}){
    const token = await getAccessTokenSafe();
    opt.headers = Object.assign({}, opt.headers, { 'Authorization': 'Bearer '+token });
    return fetch(url, opt);
  }

  async function spreadsheetGetA1(a1){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(a1)}`;
    return authFetch(url);
  }

  async function batchUpdate(requests){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}:batchUpdate`;
    const r = await authFetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({requests}) });
    if (!r.ok){ throw new Error('batch_update_failed:'+r.status); }
    return r.json();
  }

  async function ensureMaterialSheet(){
    if (!st.spreadsheetId) return false;
    // Check header exists
    const r0 = await spreadsheetGetA1(RANGE_A1);
    if (r0.ok){
      const js = await r0.json();
      if (js?.values?.[0]?.[0]) return true; // already present
    }
    // ensure sheet exists (addSheet no-op if already there? -> guarded by try header PUT anyway)
    try{
      await batchUpdate([{ addSheet:{ properties:{ title:SHEET_TITLE } } }]);
    }catch(e){
      // addSheet may fail if sheet already exists → ignore 400 with duplicate, continue
    }
    // ensure header (idempotent)
    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(RANGE_A1)}?valueInputOption=RAW`;
    const body   = JSON.stringify({ range:RANGE_A1, majorDimension:'ROWS', values:[HEADER] });
    const r1 = await authFetch(putUrl, { method:'PUT', headers:{'Content-Type':'application/json'}, body });
    if (r1.ok){ log('created __LM_MATERIALS'); return true; }
    return false;
  }

  // auto ensure once both contexts are available (sheet id + token)
  let ensuredOnce = false;
  async function tryAutoEnsure(){
    if (ensuredOnce) return;
    if (!st.spreadsheetId) return;
    try{
      await ensureMaterialSheet();
      ensuredOnce = true;
    }catch(e){
      // token missing is common before consent; just log
      warn('ensureMaterialSheet deferred:', e?.message||e);
    }
  }

  // ---------- Populate materials (non-fatal) --------------------------------
  async function populateWhenReady(){
    // Wait until scene/model ready; then try list
    const START = Date.now();
    const retryMax = 30, interval = 200;
    for (let i=0;i<retryMax;i++){
      try{
        const materials = await listMaterialsHybrid();
        if (materials && materials.length){
          buildMaterialSelect(materials);
          return;
        }
      }catch(e){/*ignore*/}
      await new Promise(r=>setTimeout(r, interval));
    }
    warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
  }
  function listMaterialsHybrid(){
    // Try a few well-known bridges
    try{
      if (window.viewer && typeof window.viewer.listMaterials === 'function'){
        const arr = window.viewer.listMaterials();
        if (arr && arr.length) return Promise.resolve(arr);
      }
    }catch(e){}
    // Fallback traverse if host exposes scene
    try{
      const THREE = window.THREE;
      const scene = (window.viewer && window.viewer.scene) || window.__lm_scene;
      const set = new Set();
      if (scene && THREE){
        scene.traverse?.((obj)=>{
          const m = obj && obj.material;
          if (m){
            if (Array.isArray(m)) m.forEach(x=>x && set.add(x.name||x.uuid||'material'));
            else set.add(m.name||m.uuid||'material');
          }
        });
        return Promise.resolve(Array.from(set));
      }
    }catch(e){}
    return Promise.resolve([]);
  }
  function buildMaterialSelect(list){
    // Prefer your actual UI: #pm-material
    const sel = document.querySelector('#pm-material') || document.querySelector('[data-lm="material-select"]') || document.querySelector('#lm-material-select') || document.querySelector('#material-select');
    if (!sel) return;
    // If it's a <select> with options array of strings:
    if (sel.tagName === 'SELECT'){
      // Clear then populate
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      list.forEach(k=>{
        const opt = document.createElement('option');
        opt.value = String(k);
        opt.textContent = String(k);
        sel.appendChild(opt);
      });
    }
    // Keep state in sync
    if (sel.value) st.currentMaterialKey = sel.value;
    sel.addEventListener('change', ()=>{ st.currentMaterialKey = sel.value; }, true);
  }

  // ---------- Opacity Upsert (hardened + gated) -----------------------------
  let gateCtxReady = false;
  let pendingOpacity = null;
  let flushedOnce = false;

  function onCtxMaybeReady(){
    gateCtxReady = !!st.spreadsheetId;
    tryFlush();
  }

  async function getTokenMaybe(){
    try{ await getAccessTokenSafe(); }catch(e){/* keep false */}
  }

  function tryFlush(){
    if (gateCtxReady && gateTokenReady && pendingOpacity!=null && !flushedOnce){
      flushedOnce = true;
      saveOpacity(pendingOpacity);
      pendingOpacity = null;
    }
  }

  window.addEventListener('lm:sheet-context', onCtxMaybeReady);
  document.addEventListener('lm:sheet-context', onCtxMaybeReady);

  // helper: debounce
  function debounce(fn, ms){ let h; return (...a)=>{ clearTimeout(h); h=setTimeout(()=>fn(...a), ms); }; }

  // resolve current material according to actual UI
  function resolveCurrentMaterial(){
    if (st.currentMaterialKey) return st.currentMaterialKey;
    const sel = document.querySelector('#pm-material') || document.querySelector('[data-lm="material-select"]') || document.querySelector('#lm-material-select') || document.querySelector('#material-select') || document.querySelector('select[name="material"]');
    if (sel && sel.value) return sel.value;
    if (sel && sel.options && sel.selectedIndex>=0){
      const opt = sel.options[sel.selectedIndex];
      if (opt?.text) return opt.text.trim();
    }
    return null;
  }

  function buildPayload(opacity){
    const spreadsheetId = st.spreadsheetId || '';
    const sheetGid = (st.sheetGid==null? '': st.sheetGid);
    const materialKey = resolveCurrentMaterial() || '';
    const modelKey = st.modelKey || '';
    const now = new Date().toISOString();
    const user = (window.__lm_userEmail || window.__lm_user || '');
    const key = [spreadsheetId, modelKey, materialKey].join(':');
    return [key, modelKey, materialKey, String(opacity), '', '', '', '', '', '', now, user, spreadsheetId, String(sheetGid)];
  }

  async function ensureHeader(){
    // reused by upsert
    const token = await getAccessTokenSafe(); // sets gateTokenReady
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(RANGE_A1)}`;
    const r0 = await fetch(getUrl, { headers:{'Authorization':'Bearer '+token} });
    if (r0.ok){
      const js = await r0.json();
      if (js?.values?.[0]?.[0]) return true;
    }
    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(RANGE_A1)}?valueInputOption=RAW`;
    const body   = JSON.stringify({ range:RANGE_A1, majorDimension:'ROWS', values:[HEADER] });
    const r1 = await fetch(putUrl, { method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}, body });
    return r1.ok;
  }

  async function findRowIndexByKey(key){
    const token = await getAccessTokenSafe();
    const range = SHEET_TITLE + '!A:A';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(range)}`;
    const r = await fetch(url, { headers:{'Authorization':'Bearer '+token} });
    if (!r.ok) return null;
    const js = await r.json();
    const rows = (js?.values) ? js.values.map(v=>v[0]||'') : [];
    for (let i=0;i<rows.length;i++) if (rows[i]===key) return i+1;
    return null;
  }

  async function upsertRow(payload){
    const token = await getAccessTokenSafe();
    await ensureHeader();
    const key = payload[0];
    const row = await findRowIndexByKey(key);
    if (row){
      const a1 = `${SHEET_TITLE}!A${row}:N${row}`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(a1)}?valueInputOption=RAW`;
      const body = JSON.stringify({ range:a1, majorDimension:'ROWS', values:[payload] });
      const r = await fetch(url, { method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}, body });
      return r.ok;
    }else{
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(SHEET_TITLE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const body = JSON.stringify({ range:SHEET_TITLE, majorDimension:'ROWS', values:[payload] });
      const r = await fetch(url, { method:'POST', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}, body });
      return r.ok;
    }
  }

  async function saveOpacity(nowVal){
    if (!st.spreadsheetId){ pendingOpacity = nowVal; gateCtxReady=true; return; }
    try{
      const ok = await upsertRow(buildPayload(nowVal));
      console.log('[mat-upsert] opacity saved', ok);
    }catch(e){
      console.warn('[mat-upsert] save failed', e?.message||e);
      // keep one retry in buffer
      pendingOpacity = nowVal;
    }
  }
  const saveOpacityDebounced = debounce(saveOpacity, 250);

  // Input listener — real selectors
  function isOpacityInput(el){
    return !!(el && el.matches && (
      el.matches('#pm-opacity-range') ||
      el.matches('[data-lm="mat-opacity"]') ||
      el.matches('#lm-opacity') ||
      el.matches('input[type="range"].lm-opacity') ||
      el.matches('input[type="range"][name="opacity"]')
    ));
  }
  document.addEventListener('input', (e)=>{
    const t = e.target;
    if (!isOpacityInput(t)) return;
    const v = (typeof t.value === 'string') ? parseFloat(t.value) : (t.value || 0);
    if (!isNaN(v)) saveOpacityDebounced(v);
  }, true);

  // Prime token (silent) and flush if something was buffered
  getTokenMaybe().then(()=>tryFlush());
  function getTokenMaybe(){ return getAccessTokenSafe().catch(()=>null); }

  // ---------- Kick-offs -----------------------------------------------------
  // Populate materials lazily
  setTimeout(populateWhenReady, 50);

})();
