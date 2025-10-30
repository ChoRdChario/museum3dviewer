// material.orchestrator.js  (V6_12c_MATERIAL_ENUM_FIX_HIDE_MAT_SHEET)
(function () {
  const VER = 'V6_12c_MATERIAL_ENUM_FIX_HIDE_MAT_SHEET';
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

  // ---------- Events wiring -------------------------------------------------
  function onSheetCtx(ev){
    const d = ev?.detail || {};
    if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
    log('sheet context set', {spreadsheetId: st.spreadsheetId, sheetGid: st.sheetGid});
    hideMaterialsSheetInPicker();     // ← 追加：UIから __LM_* を隠す
    tryAutoEnsure();
  }
  window.addEventListener('lm:sheet-context', onSheetCtx);
  document.addEventListener('lm:sheet-context', onSheetCtx);

  function onScene(){ st.sceneReady = true; }
  window.addEventListener('lm:scene-ready', onScene);
  document.addEventListener('lm:scene-ready', onScene);

  function onModel(){
    st.modelReady = true;
    if (!st.modelKey && typeof window.__lm_modelKey === 'string') st.modelKey = window.__lm_modelKey;
    // モデル準備後にマテリアル列挙
    populateWhenReady().catch(()=>{});
  }
  window.addEventListener('lm:model-ready', onModel);
  document.addEventListener('lm:model-ready', onModel);

  // ---------- Token helpers -------------------------------------------------
  let gateTokenReady = false;
  async function getAccessTokenSafe(){
    try{
      if (typeof getAccessToken === 'function'){
        const v = getAccessToken();
        const t = (v && typeof v.then==='function') ? await v : v;
        if (t){ gateTokenReady = true; return t; }
      }
    }catch(e){}
    try{
      if (typeof ensureToken === 'function'){
        const v2 = ensureToken({ interactive:false });
        const t2 = (v2 && typeof v2.then==='function') ? await v2 : v2;
        if (t2){ gateTokenReady = true; return t2; }
      }
    }catch(e){}
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
    // 既存ヘッダー確認
    const r0 = await spreadsheetGetA1(RANGE_A1);
    if (r0.ok){
      const js = await r0.json();
      if (js?.values?.[0]?.[0]) return true;
    }
    // シート本体（存在時は400想定→握りつぶし）
    try{
      await batchUpdate([{ addSheet:{ properties:{ title:SHEET_TITLE } } }]);
    }catch(_e){}
    // ヘッダー投入（冪等）
    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${st.spreadsheetId}/values/${encodeURIComponent(RANGE_A1)}?valueInputOption=RAW`;
    const body   = JSON.stringify({ range:RANGE_A1, majorDimension:'ROWS', values:[HEADER] });
    const r1 = await authFetch(putUrl, { method:'PUT', headers:{'Content-Type':'application/json'}, body });
    if (r1.ok){ log('created __LM_MATERIALS'); return true; }
    return false;
  }

  let ensuredOnce = false;
  async function tryAutoEnsure(){
    if (ensuredOnce) return;
    if (!st.spreadsheetId) return;
    try{
      await ensureMaterialSheet();
      ensuredOnce = true;
    }catch(e){
      warn('ensureMaterialSheet deferred:', e?.message||e);
    }
  }

  // ---------- Material enumeration (robust) ---------------------------------
  async function populateWhenReady(){
    // model-ready 後に複数経路で列挙を試みる
    const retryMax = 30, interval = 200;
    for (let i=0;i<retryMax;i++){
      const materials = await listMaterialsHybrid().catch(()=>null);
      if (materials && materials.length){
        buildMaterialSelect(materials);
        return;
      }
      await new Promise(r=>setTimeout(r, interval));
    }
    warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
  }

  function listMaterialsHybrid(){
    // 1) 既存ブリッジ関数
    try{
      if (typeof window.__lm_listMaterials === 'function'){
        const r = window.__lm_listMaterials();
        if (r && r.length) return Promise.resolve(r);
      }
    }catch(_e){}

    // 2) viewer.bridge.module.js 側API（仮名の網羅）
    try{
      const b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
      if (b && typeof b.listMaterials === 'function'){
        const r = b.listMaterials();
        if (r && r.length) return Promise.resolve(r);
      }
    }catch(_e){}

    // 3) THREEシーンを直接走査（最終フォールバック）
    try{
      const scene = (window.__lm_getScene && window.__lm_getScene()) ||
                    (window.__lm_viewer && window.__lm_viewer.scene) ||
                    (window.viewer && window.viewer.scene) ||
                    null;
      const THREE = window.THREE || null;
      if (!scene || !THREE) return Promise.resolve([]);

      const set = new Set();
      scene.traverse(obj=>{
        const m = obj && obj.material;
        if (!m) return;
        if (Array.isArray(m)){
          m.forEach(mi=>collectMaterial(mi, set));
        }else{
          collectMaterial(m, set);
        }
      });
      return Promise.resolve(Array.from(set));
    }catch(_e){
      return Promise.resolve([]);
    }
  }
  function collectMaterial(mat, set){
    if (!mat) return;
    const name = (mat.name && String(mat.name).trim()) || `material.${mat.id ?? ''}`;
    set.add(name);
  }

  function buildMaterialSelect(materials){
    // セレクタ候補を総当り（既存UIを壊さない）
    const sel =
      document.querySelector('[data-lm="material-select"]') ||
      document.querySelector('#lm-material-select') ||
      document.querySelector('select[name="material"]') ||
      document.querySelector('#material-select') ||
      createMaterialSelectSlot();

    // クリア
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const add = (val, txt)=>{ const o=document.createElement('option'); o.value=val; o.textContent=txt; sel.appendChild(o); };
    add('', '— Select —');
    materials.forEach(m => add(m, m));

    // 変更時に state に反映
    sel.addEventListener('change', ()=>{ st.currentMaterialKey = sel.value; }, { once:false });

    log('materials populated', materials.length);
  }

  function createMaterialSelectSlot(){
    // 「Material」タブ内に select が無い場合は安全に生成
    const box = document.querySelector('[data-lm="material-tab"], #lm-material-tab') || document.body;
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '8px';
    const sel = document.createElement('select');
    sel.id = 'lm-material-select';
    sel.style.width='100%';
    wrap.appendChild(sel);
    box.prepend(wrap);
    return sel;
  }

  // ---------- Hide __LM_* from sheet pickers --------------------------------
  function hideMaterialsSheetInPicker(){
    const HIDE = (opt) => {
      const txt = (opt.textContent || opt.value || '').trim();
      if (!txt) return false;
      if (txt === '__LM_MATERIALS' || txt.startsWith('__LM_')) { opt.remove(); return true; }
      return false;
    };

    // 既存select全てを対象（タイトル/値どちらでも検出）
    document.querySelectorAll('select option').forEach(HIDE);

    // 以後のUI更新にも追従（軽いdebounce付き）
    if (!hideMaterialsSheetInPicker._armed){
      hideMaterialsSheetInPicker._armed = true;
      let t=null;
      const mo = new MutationObserver(()=>{
        if (t) clearTimeout(t);
        t = setTimeout(()=>document.querySelectorAll('select option').forEach(HIDE), 60);
      });
      mo.observe(document.body, { childList:true, subtree:true });
    }
  }

  // kick (遅延で安全起動)
  setTimeout(()=>{ hideMaterialsSheetInPicker(); if (st.modelReady) populateWhenReady(); }, 0);
})();
