// material.orchestrator.js
// LociMyu material UI orchestrator (Refactored)
// UI と viewer.bridge・各種保存ロジックの仲立ちを行う
// VERSION_TAG: V6_FIXED_SYNC_AND_SHEET_CONTEXT

(function () {
  const LOG_PREFIX = '[mat-orch]';
  const RETRY_MS = 250;
  const RETRY_MAX = 40;
  const MATERIALS_RANGE = '__LM_MATERIALS!A:N';

  // UI Element Cache
  let ui = null;
  let retryCount = 0;

  // State
  let currentMaterialKey = '';
  let currentOpacity = 1;
  let pmEventsWired = false;
  
  // Cache System
  // sheetGid -> Map<materialKey, ConfigObject>
  const sheetMaterialCache = new Map();
  let currentSheetGid = '';
  let activeFetchPromise = null;

  // Default Configuration
  const defaultProps = {
    opacity: 1,
    doubleSided: false,
    unlitLike: false,
    chromaEnable: false,
    chromaColor: '#000000',
    chromaTolerance: 0,
    chromaFeather: 0,
    roughness: 0,
    metalness: 0,
    emissiveHex: '#000000',
    emissiveIntensity: 0,
  };

  /**
   * DOM要素の取得
   * 数値表示用の output 要素 (#pm-opacity-val, #pm-value) も確実に取得する
   */
  function queryUI() {
    const materialSelect =
      document.getElementById('materialSelect') ||
      document.getElementById('pm-material');

    const opacityRange =
      document.getElementById('opacityRange') ||
      document.getElementById('pm-opacity-range');
    
    // 数値表示用エレメント (material.runtime.patch.js や material.id.unify.v2.js が生成)
    const opacityVal = 
      document.getElementById('pm-opacity-val') || 
      document.getElementById('pm-value');

    const chkDoubleSided = document.getElementById('pm-flag-doublesided');
    const chkUnlitLike = document.getElementById('pm-flag-unlit');
    const chkChromaEnable = document.getElementById('pm-chroma-enable');
    const inpChromaColor = document.getElementById('pm-chroma-color');
    const rngChromaTolerance = document.getElementById('pm-chroma-tol');
    const rngChromaFeather = document.getElementById('pm-chroma-feather');

    return {
      materialSelect,
      opacityRange,
      opacityVal,
      chkDoubleSided,
      chkUnlitLike,
      chkChromaEnable,
      inpChromaColor,
      rngChromaTolerance,
      rngChromaFeather,
    };
  }

  // --- Helper Functions ---

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }

  function getSelectedMaterialKey() {
    if (!ui) ui = queryUI();
    if (!ui.materialSelect) return '';
    return ui.materialSelect.value || '';
  }

  /**
   * UIへの反映
   * 重要: ここでスライダーだけでなく、数値テキストも更新する
   */
  function applyPropsToUI(props) {
    if (!ui) ui = queryUI();
    const p = Object.assign({}, defaultProps, props || {});

    // Opacity Sync
    if (ui.opacityRange) {
      ui.opacityRange.value = String(p.opacity);
    }
    // 【修正】数値テキストの明示的更新 (イベント発火に頼らない)
    if (ui.opacityVal) {
      ui.opacityVal.textContent = Number(p.opacity).toFixed(2);
      // input要素の場合はvalueも更新
      if (ui.opacityVal.tagName === 'INPUT' || ui.opacityVal.tagName === 'OUTPUT') {
        ui.opacityVal.value = Number(p.opacity).toFixed(2);
      }
    }

    // Other props
    if (ui.chkDoubleSided) ui.chkDoubleSided.checked = !!p.doubleSided;
    if (ui.chkUnlitLike) ui.chkUnlitLike.checked = !!p.unlitLike;
    if (ui.chkChromaEnable) ui.chkChromaEnable.checked = !!p.chromaEnable;
    if (ui.inpChromaColor) ui.inpChromaColor.value = p.chromaColor;
    if (ui.rngChromaTolerance) ui.rngChromaTolerance.value = String(p.chromaTolerance);
    if (ui.rngChromaFeather) ui.rngChromaFeather.value = String(p.chromaFeather);
  }

  /**
   * 現在のUI状態を収集してオブジェクト化
   */
  function collectControls() {
    if (!ui) ui = queryUI();
    
    const opacity = ui.opacityRange ? Number(ui.opacityRange.value) : 1;
    
    // 他のプロパティ収集（簡易実装）
    const props = {
      opacity: clamp(opacity, 0, 1),
      doubleSided: ui.chkDoubleSided ? ui.chkDoubleSided.checked : false,
      unlitLike: ui.chkUnlitLike ? ui.chkUnlitLike.checked : false,
      chromaEnable: ui.chkChromaEnable ? ui.chkChromaEnable.checked : false,
      chromaColor: ui.inpChromaColor ? ui.inpChromaColor.value : '#000000',
      chromaTolerance: ui.rngChromaTolerance ? Number(ui.rngChromaTolerance.value) : 0,
      chromaFeather: ui.rngChromaFeather ? Number(ui.rngChromaFeather.value) : 0
    };

    return {
      materialKey: getSelectedMaterialKey(),
      props
    };
  }

  // --- Core Logic ---

  /**
   * マテリアル切り替え、またはデータロード完了時の状態適用
   * 1. キャッシュを確認 (現在のSheet GID + マテリアルKey)
   * 2. なければデフォルト値
   * 3. UIに反映
   * 4. Viewerに反映
   */
  function syncMaterialState(key) {
    if (!key) return;
    currentMaterialKey = key;

    // 現在のシート用キャッシュから設定を取得
    const sheetCache = sheetMaterialCache.get(currentSheetGid);
    const cachedProps = sheetCache ? sheetCache.get(key) : null;
    
    // キャッシュがあればそれを使用、なければデフォルト
    // マテリアル切り替え時は「検索に引っかからなければ初期値」という仕様に従う
    const finalProps = cachedProps ? Object.assign({}, cachedProps) : Object.assign({}, defaultProps);

    currentOpacity = finalProps.opacity;

    // UIとViewerへ適用
    applyPropsToUI(finalProps);
    applyToViewer(key, finalProps);
    
    console.log(LOG_PREFIX, 'Synced state for:', key, 'Sheet:', currentSheetGid, 'Source:', cachedProps ? 'Cache' : 'Default');
  }

  function applyToViewer(key, props) {
    const bridge = window.__lm_viewer_bridge;
    if (bridge && typeof bridge.applyMaterialProps === 'function') {
      bridge.applyMaterialProps(key, props);
    }
  }

  /**
   * 保存処理
   * ドラッグ解除時 (persist=true) のみ実行される
   */
  function persistToSheet(key, props) {
    const persist = window.LM_MaterialsPersist;
    if (!persist || typeof persist.upsert !== 'function') return;

    // 念のためGidを補完
    const patch = Object.assign({ materialKey: key, sheetGid: currentSheetGid }, props);
    
    // デバウンスなしで即要求を出す（UI側でイベントが間引かれている前提）
    // もし連打される懸念がある場合はここに短いデバウンスを入れても良い
    persist.upsert(patch).catch(e => console.warn(LOG_PREFIX, 'Persist failed', e));
  }

  // --- Data Fetching ---

  async function fetchAndCacheMaterials(spreadsheetId, sheetGid) {
    const fetchAuth = window.__lm_fetchJSONAuth;
    if (!fetchAuth || !spreadsheetId) return new Map();

    const range = encodeURIComponent(MATERIALS_RANGE);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    
    try {
      const res = await fetchAuth(url);
      const rows = res.values || [];
      const map = new Map();
      
      // Row parsing matches auto.apply logic
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const mKey = r[0];
        const mGid = r[13] || ''; // Column N is sheetGid
        
        // 空のGIDはグローバル設定として扱うなどの仕様がある場合はここで分岐
        // 今回の仕様:「キャプションシート毎の設定」なので、Gidが一致するものだけを拾う
        // (またはGid空をフォールバックにするならここで制御)
        
        if (mKey && String(mGid) === String(sheetGid)) {
           map.set(mKey, {
             opacity: r[1] !== undefined ? parseFloat(r[1]) : 1,
             doubleSided: (r[2]||"").toUpperCase() === "TRUE",
             unlitLike: (r[3]||"").toUpperCase() === "TRUE",
             chromaEnable: (r[4]||"").toUpperCase() === "TRUE",
             chromaColor: r[5] || "#000000",
             chromaTolerance: parseFloat(r[6]||"0"),
             chromaFeather: parseFloat(r[7]||"0"),
             // ...others
           });
        }
      }
      return map;
    } catch (e) {
      console.warn(LOG_PREFIX, 'Fetch failed', e);
      return new Map();
    }
  }

  /**
   * シート切り替え時のハンドラ
   */
  function handleSheetContextChange(ctx) {
    const newSid = ctx.spreadsheetId || '';
    const newGid = String(ctx.sheetGid !== undefined ? ctx.sheetGid : '');

    // 同じなら何もしない (ただし初回ロード時は通す)
    // if (currentSheetGid === newGid && sheetMaterialCache.has(newGid)) return;

    currentSheetGid = newGid;
    console.log(LOG_PREFIX, 'Sheet Context Changed -> GID:', newGid);

    // 1. キャッシュをクリアしてリロード開始
    sheetMaterialCache.delete(newGid);
    
    // 2. ロード中は一旦UIを触らせないなどの制御が必要ならここで行う
    // 今回は「ロード完了後にUI反映」とする
    
    activeFetchPromise = fetchAndCacheMaterials(newSid, newGid)
      .then(map => {
        // ロード完了時にまだ同じシートにいるか確認
        if (currentSheetGid !== newGid) return;
        
        sheetMaterialCache.set(newGid, map);
        console.log(LOG_PREFIX, 'Cache loaded. Keys:', map.size);

        // 3. 現在選択中のマテリアルに対して設定を即時適用
        const key = getSelectedMaterialKey();
        if (key) {
          syncMaterialState(key);
        }
      });
  }


  // --- Event Handling (The "PM" Protocol) ---

  function wirePmEvents() {
    if (pmEventsWired) return;
    pmEventsWired = true;

    // マテリアル選択変更
    window.addEventListener('lm:pm-material-selected', (e) => {
      const key = (e.detail && e.detail.key || '').trim();
      if (key) {
        // 選択直後に自動で設定を検索して読み込み、UI反映
        syncMaterialState(key);
      } else {
        currentMaterialKey = '';
      }
    });

    // スライダー操作中 (Input) -> 保存しない
    window.addEventListener('lm:pm-opacity-input', (e) => {
      if (!currentMaterialKey) return;
      const val = e.detail ? Number(e.detail.value) : 1;
      
      // UIの数値表示は runtime.patch がやるかもしれないが、念のためここでも状態同期
      // ただし applyPropsToUI を呼ぶとループする恐れがあるので、
      // ここでは Viewer への適用のみを行う
      const state = collectControls();
      state.props.opacity = val;
      
      applyToViewer(currentMaterialKey, state.props);
    });

    // スライダー操作終了 (Change/DragEnd) -> 保存する
    window.addEventListener('lm:pm-opacity-change', (e) => {
      if (!currentMaterialKey) return;
      
      const state = collectControls(); // 現在のUI値を正とする
      const val = e.detail ? Number(e.detail.value) : state.props.opacity;
      state.props.opacity = val;

      console.log(LOG_PREFIX, 'Commit (Drag End):', currentMaterialKey, val);
      
      // Viewer適用 & 保存
      applyToViewer(currentMaterialKey, state.props);
      persistToSheet(currentMaterialKey, state.props);
      
      // キャッシュも更新しておく（次回のUI同期のため）
      let cache = sheetMaterialCache.get(currentSheetGid);
      if (!cache) {
        cache = new Map();
        sheetMaterialCache.set(currentSheetGid, cache);
      }
      cache.set(currentMaterialKey, state.props);
    });

    // チェックボックス等の変更 (即保存でOKとするか、仕様によるが今回はChange扱い)
    // 必要に応じてリスナーを追加
  }

  function bindDirectEvents() {
    if (!ui) ui = queryUI();
    // material.runtime.patch.js がない環境へのフォールバックが必要ならここに記述
    // 今回は割愛
  }

  // --- Boot ---

  function boot() {
    console.log(LOG_PREFIX, 'Booting...');
    wirePmEvents();

    // 初期ロード
    if (window.__LM_SHEET_CTX) {
      handleSheetContextChange(window.__LM_SHEET_CTX);
    }
    
    // イベント監視
    window.addEventListener('lm:sheet-context', (e) => {
      if (e.detail) handleSheetContextChange(e.detail);
    });

    // DOM準備待ちリトライ
    const t = setInterval(() => {
      const ready = queryUI().materialSelect;
      if (ready || retryCount++ > 20) {
        clearInterval(t);
        if (ready) {
           const key = getSelectedMaterialKey();
           if (key) syncMaterialState(key);
        }
      }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Debug API
  window.__LM_matOrch = {
    forceSync: syncMaterialState,
    getCache: () => sheetMaterialCache
  };

})();