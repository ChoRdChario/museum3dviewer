{
type: uploaded file
fileName: material.orchestrator.js
fullContent:
// material.orchestrator.js v4.1
// - Material タブ UI を 1 箇所で束ねる
// - per-material state を保持し、localStorage + Sheets に保存
// - マテリアル選択時に scene から現在値を推定して UI に反映
// - v4.1: 複合キー対応、runtime.patchの統合、即時描画の強化
(function(){
  const TAG = '[mat-orch v4.1]';

  /** key: materialKey -> state */
  const stateByKey = new Map();
  /** sheet-context {spreadsheetId, sheetGid} */
  let sheetCtx = null;
  /** 現在選択中の materialKey */
  let currentKey = '';

  function log(...a){ console.log(TAG, ...a); }
  function warn(...a){ console.warn(TAG, ...a); }

  function $(id){ return document.getElementById(id); }

  // ---- Context Helpers ----
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
      const br = window.__lm_viewer_bridge || window.viewerBridge;
      if (!br || typeof br.getScene !== 'function'){
        return null;
      }
      const root = br.getScene();
      const THREE_ = window.THREE;
      if (!root || !THREE_) return null;

      // key が "glb::0::MaterialName" のような形式の場合、末尾の名前で検索する
      // (Mesh上のマテリアル名は単純名のままのため)
      const simpleName = key.split('::').pop() || key;

      let found = null;
      root.traverse(obj=>{
        if (found || !obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats){
          if (!m) continue;
          // 完全一致 または 単純名一致
          if (m.name !== key && m.name !== simpleName) continue;

          const opacity = (typeof m.opacity === 'number') ? m.opacity : 1;
          const doubleSided = (m.side === THREE_.DoubleSide);
          const unlitLike   = (m.userData?.__lmUniforms?.uUnlit?.value === true); 

          found = {
            opacity,
            doubleSided,
            unlitLike,
            chromaEnable: false, // シェーダー解析は複雑なのでデフォルト
            chromaColor: '#000000',
            chromaTolerance: 0.10,
            chromaFeather: 0.00,
          };
          break;
        }
      });
      if (found) log('inferred state for', simpleName, found);
      return found;
    }catch(e){
      warn('inferStateFromScene failed', e);
      return null;
    }
  }

  // ---- viewer への即時適用 (Drawing Update) ----
  function applyToViewer(key, st){
    if (!key || !st) return;
    const br = window.__lm_viewer_bridge || window.viewerBridge;
    if (!br || typeof br.applyMaterialProps !== 'function') {
      warn('Bridge missing applyMaterialProps');
      return;
    }
    
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
    // Chroma props could be added here if viewer supports them in applyMaterialProps

    try{
      // ここで渡す key が viewer.module 側の期待するキーと一致している必要がある
      // (material.dropdown.patch.js v3.6 で一致を保証している)
      br.applyMaterialProps(key, props);
    }catch(e){
      console.warn(TAG, 'applyToViewer failed', e);
    }
  }

  // ---- UI -> state 読み出し ----
  function readUI(){
    const sel = $('pm-material') || $('materialSelect');
    const rng = $('pm-opacity-range') || $('opacityRange');
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

  // ---- state -> UI 反映 ----
  function applyStateToUI(st){
    if (!st) return;
    const rng = $('pm-opacity-range') || $('opacityRange');
    const out = $('pm-opacity-val') || $('pm-value'); // 互換性
    const ds  = $('pm-flag-doublesided');
    const ul  = $('pm-flag-unlit');
    const ckE = $('pm-chroma-enable');
    const ckC = $('pm-chroma-color');
    const ckT = $('pm-chroma-tol');
    const ckF = $('pm-chroma-feather');

    if (rng && typeof st.opacity === 'number' && !Number.isNaN(st.opacity)){
      rng.value = String(st.opacity);
      if (out){
        // 数値表示の更新 (runtime.patchの機能を統合)
        out.textContent = Number(st.opacity).toFixed(2);
        if (out.value !== undefined) out.value = Number(st.opacity).toFixed(2);
      }
    }
    if (ds) ds.checked = !!st.doubleSided;
    if (ul) ul.checked = !!st.unlitLike;
    if (ckE) ckE.checked = !!st.chromaEnable;
    if (ckC && st.chromaColor) ckC.value = st.chromaColor;
    if (ckT && st.chromaTolerance != null) ckT.value = String(st.chromaTolerance);
    if (ckF && st.chromaFeather != null) ckF.value = String(st.chromaFeather);
  }

  // ---- 保存（localStorage + Sheets） ----
  function persistState(materialKey, st){
    const ctx = getCurrentSheetCtx() || {};
    if (!materialKey) return;

    // 1) localStorage
    try{
      const api = window.__lm_material_state;
      if (api && typeof api.save === 'function'){
        api.save(ctx, materialKey, st);
      }
    }catch(e){ warn('local save failed', e); }

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
    }catch(e){ warn('sheet upsert failed', e); }
  }

  // ---- コントロール変更時ハンドラ ----
  function onControlChanged(shouldPersist = true){
    const ui = readUI();
    const key = ui.key; // ドロップダウンの値を正とする
    if (!key) return;
    currentKey = key;

    const st = ensureStateForKey(key);
    
    // UI値をstateにマージ
    if (ui.opacity !== undefined && !isNaN(ui.opacity)) st.opacity = ui.opacity;
    if (ui.doubleSided !== undefined) st.doubleSided = ui.doubleSided;
    if (ui.unlitLike !== undefined) st.unlitLike = ui.unlitLike;
    
    // 数値表示の即時更新 (inputイベント用)
    const out = $('pm-opacity-val') || $('pm-value');
    if (out && typeof st.opacity === 'number') {
      out.textContent = st.opacity.toFixed(2);
      if (out.value !== undefined) out.value = st.opacity.toFixed(2);
    }

    applyToViewer(key, st); // ★ ビューア即時反映

    if (shouldPersist) {
      persistState(key, st); // ★ 保存
    }
  }

  function onControlInput(){ onControlChanged(false); } // ドラッグ中
  function onControlCommit(){ onControlChanged(true); } // 確定時

  // ---- マテリアル選択時 ----
  function onMaterialSelected(){
    const sel = $('pm-material') || $('materialSelect');
    const key = sel ? sel.value : '';
    currentKey = key;
    if (!key) return;

    log('selected', key);

    // 既存 state or scene から推定した state を UI に反映
    let st = ensureStateForKey(key);
    
    // まだシーンから読み取っていない、かつ保存された値がない場合のみ推定
    // (リセットの意味合いも含め、毎回推定するかは要件次第だが、
    //  ここでは「保存値があれば優先、なければシーン値」とする)
    //  -> Sheetsからロードされた値は auto.apply が適用済みのはずなので、
    //     シーンの値 = 保存値 となっていることが期待される。
    //     よって常にシーンから現在値を吸い上げるのが安全。
    
    const inferred = inferStateFromScene(key);
    if (inferred){
      // 既存のメモリ上stateより、シーンの現状(auto-apply適用後)を優先する
      Object.assign(st, inferred);
    }

    applyStateToUI(st);
  }

  // ---- バインド ----
  function bind(){
    const sel = $('pm-material') || $('materialSelect');
    const rng = $('pm-opacity-range') || $('opacityRange');
    
    if (!sel || !rng){
      warn('UI not ready yet, retrying...');
      setTimeout(bind, 500);
      return;
    }

    const ds  = $('pm-flag-doublesided');
    const ul  = $('pm-flag-unlit');
    // Chroma controls...
    const ckE = $('pm-chroma-enable');
    const ckC = $('pm-chroma-color');
    const ckT = $('pm-chroma-tol');
    const ckF = $('pm-chroma-feather');

    // マテリアル変更
    sel.addEventListener('change', onMaterialSelected);

    // 値変更 → state 更新 & 保存
    rng.addEventListener('input',  onControlInput);
    rng.addEventListener('change', onControlCommit);
    
    if (ds) ds.addEventListener('change', onControlCommit);
    if (ul) ul.addEventListener('change', onControlCommit);
    if (ckE) ckE.addEventListener('change', onControlCommit);
    if (ckC) ckC.addEventListener('change', onControlCommit);
    if (ckT) { ckT.addEventListener('input', onControlInput); ckT.addEventListener('change', onControlCommit); }
    if (ckF) { ckF.addEventListener('input', onControlInput); ckF.addEventListener('change', onControlCommit); }

    log('bound events');

    // 初期選択があれば反映
    if (sel.value) onMaterialSelected();
  }

  // sheet-context 更新時
  window.addEventListener('lm:sheet-context', (e)=>{
    sheetCtx = e.detail;
  });

  // ドロップダウン生成完了時 (material.dropdown.patch.js から発火)
  window.addEventListener('lm:mat-dd-populated', ()=>{
    log('dropdown populated signal');
    bind();
  });

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind, { once:true });
  }else{
    bind();
  }
})();
}