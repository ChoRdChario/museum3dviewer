// material.orchestrator.js v4.0
// - Material タブ UI を 1 箇所で束ねる
// - per-material state を保持し、localStorage + Sheets に保存
// - マテリアル選択時に scene から現在値を推定して UI に反映
(function(){
  const TAG = '[mat-orch v4.0]';

  /** key: materialKey -> state */
  const stateByKey = new Map();
  /** sheet-context {spreadsheetId, sheetGid} */
  let sheetCtx = null;
  /** 現在選択中の materialKey */
  let currentKey = '';

  function log(...a){ console.log(TAG, ...a); }
  function warn(...a){ console.warn(TAG, ...a); }

  function $(id){ return document.getElementById(id); }

  function getCurrentSheetCtx(){
    if (sheetCtx) return sheetCtx;
    const ssid = window.__LM_ACTIVE_SPREADSHEET_ID;
    const gid  = window.__LM_ACTIVE_SHEET_GID;
    if (!ssid) return null;
    return { spreadsheetId:String(ssid), sheetGid: gid!=null ? String(gid) : '' };
  }

  // ---- default state ----
  function defaultState(){
    return {
      opacity: 1,
      doubleSided: false,
      unlitLike: false,
      chromaEnable: false,
      chromaColor: '#000000',
      chromaTolerance: 0.10,
      chromaFeather: 0.00,
    };
  }

  function ensureStateForKey(key){
    if (!key) return null;
    let st = stateByKey.get(key);
    if (!st){
      st = defaultState();
      stateByKey.set(key, st);
    }
    return st;
  }

  // ---- scene から現在値を推定 ----
  function inferStateFromScene(key){
    try{
      const br = window.__lm_viewer_bridge || window.viewerBridge || window.__LM_VIEWER_BRIDGE__ || window.__LM_VIEWER_BRIDGE || window.__lm_viewerBridge;
      if (!br || typeof br.getScene !== 'function'){
        return null;
      }
      const root = br.getScene && br.getScene();
      const THREE_ = window.THREE;
      if (!root || !THREE_){
        return null;
      }
      let found = null;
      root.traverse(obj=>{
        if (found || !obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats){
          if (!m) continue;
          const name = m.name || '';
          if (name !== key) continue;

          const opacity = (typeof m.opacity === 'number') ? m.opacity : 1;
          const doubleSided = (m.side === THREE_.DoubleSide);
          const unlitLike   = (m.type === 'MeshBasicMaterial'); // MeshBasic をアンリット風とみなす

          found = {
            opacity,
            doubleSided,
            unlitLike,
            chromaEnable: false,
            chromaColor: '#000000',
            chromaTolerance: 0.10,
            chromaFeather: 0.00,
          };
          break;
        }
      });
      if (found) log('infer from scene', key, found);
      return found;
    }catch(e){
      warn('inferStateFromScene failed', e);
      return null;
    }
  }

  // ---- viewer への即時適用 ----
  function applyToViewer(key, st){
    if (!key || !st) return;
    const br =
      window.__lm_viewer_bridge ||
      window.viewerBridge ||
      window.__LM_VIEWER_BRIDGE__ ||
      window.__LM_VIEWER_BRIDGE ||
      window.__lm_viewerBridge;
    if (!br || typeof br.applyMaterialProps !== 'function') return;
    const props = {};
    if (typeof st.opacity === 'number' && !Number.isNaN(st.opacity)){
      props.opacity = st.opacity;
    }
    if (typeof st.doubleSided === 'boolean'){
      props.doubleSide = st.doubleSided;
    }
    if (typeof st.unlitLike === 'boolean'){
      props.unlit = st.unlitLike;
    }
    try{
      br.applyMaterialProps(key, props);
    }catch(e){
      console.warn(TAG, 'applyToViewer failed', e);
    }
  }

  // ---- UI -> state 読み出し ----
  function readUI(){
    const sel = $('pm-material');
    const rng = $('pm-opacity-range');
    const ds  = $('pm-flag-doublesided');
    const ul  = $('pm-flag-unlit');
    const ckE = $('pm-chroma-enable');
    const ckC = $('pm-chroma-color');
    const ckT = $('pm-chroma-tol');
    const ckF = $('pm-chroma-feather');

    const key = sel && sel.value || '';

    return {
      key,
      opacity: rng ? parseFloat(rng.value) : undefined,
      doubleSided: ds ? !!ds.checked : undefined,
      unlitLike:   ul ? !!ul.checked : undefined,
      chromaEnable: ckE ? !!ckE.checked : undefined,
      chromaColor:  ckC ? ckC.value : undefined,
      chromaTolerance: ckT ? parseFloat(ckT.value) : undefined,
      chromaFeather:   ckF ? parseFloat(ckF.value) : undefined,
    };
  }

  // ---- state -> UI 反映（イベントは飛ばさない = 再保存はしない） ----
  function applyStateToUI(st){
    if (!st) return;
    const rng = $('pm-opacity-range');
    const out = $('pm-opacity-val');
    const ds  = $('pm-flag-doublesided');
    const ul  = $('pm-flag-unlit');
    const ckE = $('pm-chroma-enable');
    const ckC = $('pm-chroma-color');
    const ckT = $('pm-chroma-tol');
    const ckF = $('pm-chroma-feather');

    if (rng && typeof st.opacity === 'number' && !Number.isNaN(st.opacity)){
      rng.value = String(st.opacity);
      if (out){
        out.value = Number(st.opacity).toFixed(2);
      }
    }
    if (ds && typeof st.doubleSided === 'boolean'){
      ds.checked = !!st.doubleSided;
    }
    if (ul && typeof st.unlitLike === 'boolean'){
      ul.checked = !!st.unlitLike;
    }
    if (ckE && typeof st.chromaEnable === 'boolean'){
      ckE.checked = !!st.chromaEnable;
    }
    if (ckC && typeof st.chromaColor === 'string'){
      ckC.value = st.chromaColor;
    }
    if (ckT && typeof st.chromaTolerance === 'number' && !Number.isNaN(st.chromaTolerance)){
      ckT.value = String(st.chromaTolerance);
    }
    if (ckF && typeof st.chromaFeather === 'number' && !Number.isNaN(st.chromaFeather)){
      ckF.value = String(st.chromaFeather);
    }
  }

  // ---- 保存（localStorage + Sheets） ----
  function persistState(materialKey, st){
    const ctx = getCurrentSheetCtx() || {};

    // 1) localStorage（material.state.local.v1.js 経由）
    try{
      const api = window.__lm_material_state;
      if (api && typeof api.save === 'function'){
        api.save(ctx, materialKey, st);
      }
    }catch(e){
      warn('local save failed', e);
    }

    // 2) Sheets (__LM_MATERIALS)
    try{
      const P = window.LM_MaterialsPersist;
      if (P && typeof P.upsert === 'function'){
        P.upsert({
          materialKey,
          opacity: st.opacity,
          doubleSided: st.doubleSided,
          unlitLike: st.unlitLike,
          chromaEnable: st.chromaEnable,
          chromaColor: st.chromaColor,
          chromaTolerance: st.chromaTolerance,
          chromaFeather: st.chromaFeather,
        });
      }
    }catch(e){
      warn('sheet upsert failed', e);
    }
  }

  // ---- コントロール変更時ハンドラ ----
  function onControlChanged(shouldPersist = true){
    if (!currentKey) return;
    const ui = readUI();
    const key = currentKey || ui.key;
    if (!key) return;

    const st = ensureStateForKey(key);
    // UI から state へマージ
    [
      'opacity',
      'doubleSided',
      'unlitLike',
      'chromaEnable',
      'chromaColor',
      'chromaTolerance',
      'chromaFeather',
    ].forEach(k=>{
      const v = ui[k];
      if (v === undefined || (typeof v === 'number' && Number.isNaN(v))) return;
      st[k] = v;
    });

    if (shouldPersist) persistState(key, st);
    applyToViewer(key, st); // ★ UI操作毎に viewer に即時反映
  }

  function onControlInput(){
    onControlChanged(false);
  }

  function onControlCommit(){
    onControlChanged(true);
  }

  // ---- マテリアル選択時（material.runtime.patch.js が発火） ----
  function onMaterialSelected(ev){
    const detail = ev && ev.detail || {};
    const key = detail.key || '';
    currentKey = key;
    if (!key) return;

    // 既存 state or scene から推定した state を UI に反映
    let st = ensureStateForKey(key);
    if (!st || st._fromSceneOnce !== true){
      const inferred = inferStateFromScene(key);
      if (inferred){
        st = Object.assign(st||{}, inferred, { _fromSceneOnce:true });
        stateByKey.set(key, st);
      }
    }
    applyStateToUI(st);
  }

  // ---- sheet-context 取得 ----
  window.addEventListener('lm:sheet-context', (e)=>{
    sheetCtx = e && e.detail || sheetCtx;
  });

  // ---- バインド ----
  function bind(){
    const sel = $('pm-material');
    const rng = $('pm-opacity-range');
    if (!sel || !rng){
      warn('UI not ready yet, will retry on DOMContentLoaded');
      return false;
    }
    const ds  = $('pm-flag-doublesided');
    const ul  = $('pm-flag-unlit');
    const ckE = $('pm-chroma-enable');
    const ckC = $('pm-chroma-color');
    const ckT = $('pm-chroma-tol');
    const ckF = $('pm-chroma-feather');

    // material 選択は runtime.patch が custom event を投げる
    window.addEventListener('lm:pm-material-selected', onMaterialSelected, { passive:true });

    // 値変更 → state 更新 & 保存
    rng.addEventListener('input',  onControlInput, { passive:true });
    rng.addEventListener('change', onControlCommit, { passive:true });
    if (ds){
      ds.addEventListener('change', onControlCommit, { passive:true });
    }
    if (ul){
      ul.addEventListener('change', onControlCommit, { passive:true });
    }
    if (ckE){
      ckE.addEventListener('change', onControlCommit, { passive:true });
    }
    if (ckC){
      ckC.addEventListener('change', onControlCommit, { passive:true });
    }
    if (ckT){
      ckT.addEventListener('input',  onControlInput, { passive:true });
      ckT.addEventListener('change', onControlCommit, { passive:true });
    }
    if (ckF){
      ckF.addEventListener('input',  onControlInput, { passive:true });
      ckF.addEventListener('change', onControlCommit, { passive:true });
    }

    // すでにマテリアルが選択されている場合は同期を試みる
    if (sel.value){
      onMaterialSelected({ detail: { key: sel.value } });
    }

    return true;
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind, { once:true });
  }else{
    bind();
  }
})();
