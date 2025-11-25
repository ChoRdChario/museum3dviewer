// material.orchestrator.js
// LociMyu material UI orchestrator (Sheet × Material SOT)
// VERSION_TAG: V6_SHEET_MATERIAL_SOT_FIX1
//
// ポリシー:
// - 「キャプションシート × マテリアル」の状態テーブル（__LM_MATERIALS）を唯一のソース・オブ・トゥルースとする。
// - UI / Viewer は常にこの状態テーブルから再構成される一時ビュー。
// - シート切替・マテリアル切替のたびに、必ず「状態テーブル → UI/Viewer」を行う。
// - Viewer からシートへの逆流は行わず、UI コミット時のみ upsert で追記更新する。

(function () {
  const LOG_PREFIX = '[mat-orch-unified]';
  const MATERIALS_RANGE = '__LM_MATERIALS!A:N';
  const VERSION_TAG = 'V6_SHEET_MATERIAL_SOT_FIX1';
  console.log(LOG_PREFIX, 'loaded', VERSION_TAG);

  // UI State
  let ui = null;
  let retryCount = 0;
  let listenersBound = false;

  // Data State
  let currentSheetGid = '';
  // sheetGid(string) -> Map<materialKey, props>
  const sheetMaterialCache = new Map();

  // シートの状態テーブルに存在しない場合に使うデフォルト値
  const defaultProps = {
    opacity: 1,
    doubleSided: false,
    unlitLike: false,
    chromaEnable: false,
    chromaColor: '#000000',
    chromaTolerance: 0,
    chromaFeather: 0,
    // 将来拡張用（現状 UI なし）
    roughness: undefined,
    metalness: undefined,
    emissiveHex: undefined,
  };

  // ---- small helpers -------------------------------------------------------

  function ensureArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    return [x];
  }

  function clamp(v, min, max) {
    return Math.min(Math.max(Number(v), min), max);
  }

  // ---- UI lookup -----------------------------------------------------------

  // なるべく #pane-material 配下を優先して拾う（旧 #panel-material などはフォールバック）
  function queryUI() {
    const doc = document;
    const pane = doc.querySelector('#pane-material') || doc;
    const root = pane;

    const materialSelect =
      root.querySelector('#materialSelect') ||
      root.querySelector('#pm-material') ||
      doc.getElementById('pm-material') ||
      doc.getElementById('materialSelect');

    const opacityRange =
      root.querySelector('#opacityRange') ||
      root.querySelector('#pm-opacity-range') ||
      doc.getElementById('pm-opacity-range') ||
      doc.getElementById('opacityRange');

    const opacityVal =
      root.querySelector('#pm-opacity-val') ||
      root.querySelector('#pm-value') ||
      doc.getElementById('pm-opacity-val') ||
      doc.getElementById('pm-value');

    return {
      materialSelect,
      opacityRange,
      opacityVal,
      chkDoubleSided:
        root.querySelector('#pm-flag-doublesided') ||
        doc.getElementById('pm-flag-doublesided'),
      chkUnlitLike:
        root.querySelector('#pm-flag-unlit') ||
        doc.getElementById('pm-flag-unlit'),
      chkChromaEnable:
        root.querySelector('#pm-chroma-enable') ||
        doc.getElementById('pm-chroma-enable'),
      inpChromaColor:
        root.querySelector('#pm-chroma-color') ||
        doc.getElementById('pm-chroma-color'),
      rngChromaTolerance:
        root.querySelector('#pm-chroma-tol') ||
        doc.getElementById('pm-chroma-tol'),
      rngChromaFeather:
        root.querySelector('#pm-chroma-feather') ||
        doc.getElementById('pm-chroma-feather'),
    };
  }

  function getSelectedMaterialKey() {
    if (!ui) ui = queryUI();
    return ui.materialSelect ? (ui.materialSelect.value || '').trim() : '';
  }

  function applyPropsToUI(props) {
    if (!ui) ui = queryUI();
    const p = Object.assign({}, defaultProps, props || {});

    // opacity
    if (ui.opacityRange) {
      ui.opacityRange.value = String(p.opacity);
    }

    if (ui.opacityVal) {
      const disp = Number(p.opacity).toFixed(2);
      if (
        ui.opacityVal.tagName === 'INPUT' ||
        ui.opacityVal.tagName === 'OUTPUT'
      ) {
        ui.opacityVal.value = disp;
      } else {
        ui.opacityVal.textContent = disp;
      }
    }

    if (ui.chkDoubleSided) ui.chkDoubleSided.checked = !!p.doubleSided;
    if (ui.chkUnlitLike) ui.chkUnlitLike.checked = !!p.unlitLike;
    if (ui.chkChromaEnable) ui.chkChromaEnable.checked = !!p.chromaEnable;
    if (ui.inpChromaColor) ui.inpChromaColor.value = p.chromaColor || '#000000';
    if (ui.rngChromaTolerance)
      ui.rngChromaTolerance.value = String(p.chromaTolerance || 0);
    if (ui.rngChromaFeather)
      ui.rngChromaFeather.value = String(p.chromaFeather || 0);
  }

  function collectControls() {
    if (!ui) ui = queryUI();
    const opacity = ui.opacityRange ? Number(ui.opacityRange.value) : 1;

    const props = {
      opacity: clamp(opacity, 0, 1),
      doubleSided: ui.chkDoubleSided ? ui.chkDoubleSided.checked : false,
      unlitLike: ui.chkUnlitLike ? ui.chkUnlitLike.checked : false,
      chromaEnable: ui.chkChromaEnable ? ui.chkChromaEnable.checked : false,
      chromaColor: ui.inpChromaColor ? ui.inpChromaColor.value : '#000000',
      chromaTolerance: ui.rngChromaTolerance
        ? Number(ui.rngChromaTolerance.value)
        : 0,
      chromaFeather: ui.rngChromaFeather
        ? Number(ui.rngChromaFeather.value)
        : 0,
    };

    return {
      materialKey: getSelectedMaterialKey(),
      props,
    };
  }

  // ---- viewer bridge -------------------------------------------------------

  function getViewerBridge() {
    return window.__lm_viewer_bridge || window.viewerBridge || null;
  }

  function normalizeForViewer(props) {
    const out = Object.assign({}, props || {});
    if (Object.prototype.hasOwnProperty.call(out, 'doubleSided')) {
      out.side = out.doubleSided ? 'DoubleSide' : 'FrontSide';
    }
    if (Object.prototype.hasOwnProperty.call(out, 'unlitLike')) {
      out.unlitLike = !!out.unlitLike;
    }
    return out;
  }

  function applyToViewer(key, props) {
    const bridge = getViewerBridge();
    if (bridge && typeof bridge.applyMaterialProps === 'function') {
      bridge.applyMaterialProps(key, normalizeForViewer(props));
    } else {
      console.warn(LOG_PREFIX, 'Bridge missing, cannot apply props');
    }
  }

  // ---- キャッシュ ＋ 永続化 ------------------------------------------------

  function persistToSheet(key, props) {
    const persist = window.LM_MaterialsPersist;
    if (!persist || typeof persist.upsert !== 'function') {
      console.warn(LOG_PREFIX, 'Persistence module missing');
      return;
    }
    const patch = Object.assign(
      {
        materialKey: key,
        sheetGid: String(currentSheetGid || ''),
      },
      props || {},
    );
    persist
      .upsert(patch)
      .catch((e) => console.warn(LOG_PREFIX, 'Persist failed', e));
  }

  function persistAndCache(key, props) {
    if (!key) return;
    if (!currentSheetGid) {
      console.warn(LOG_PREFIX, 'No sheet context; skip persist for', key);
      return;
    }

    // シートテーブル更新
    const gid = String(currentSheetGid);
    const cache = sheetMaterialCache.get(gid) || new Map();
    cache.set(key, Object.assign({}, defaultProps, props || {}));
    sheetMaterialCache.set(gid, cache);

    // シート永続化
    persistToSheet(key, props);
  }

  // ---- シーン全体への適用 ---------------------------------------------------

  function getScene() {
    return (
      window.__LM_SCENE ||
      window.scene ||
      (window.viewer && window.viewer.scene) ||
      null
    );
  }

  function applyAllToScene(mapForSheet) {
    const scene = getScene();
    if (!scene) return;

    const activeMap = mapForSheet instanceof Map ? mapForSheet : null;

    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        const key = (m.name || o.name || '').trim();
        if (!key) return;

        let props = activeMap && activeMap.get(key);
        // 行がないものは必ず defaultProps に戻す
        if (!props) {
          props = Object.assign({}, defaultProps);
        } else {
          props = Object.assign({}, defaultProps, props);
        }
        applyToViewer(key, props);
      });
    });

    console.log(
      LOG_PREFIX,
      'Applied full configuration to scene for sheet',
      currentSheetGid,
    );
  }

  // ---- シート × マテリアル状態テーブルの読込 -------------------------------

  async function loadMaterialsForContext(spreadsheetId, sheetGid) {
    if (!spreadsheetId || sheetGid == null) return;
    const fetchJSON = window.__lm_fetchJSONAuth;
    if (!fetchJSON) {
      console.warn(LOG_PREFIX, 'No auth fetch available; cannot load materials');
      return;
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values/${encodeURIComponent(MATERIALS_RANGE)}?majorDimension=ROWS`;

    let res;
    try {
      res = await fetchJSON(url);
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to load materials from Sheets', e);
      return;
    }

    const rows = ensureArray(res && res.values).slice(1); // skip header row
    const gidStr = String(sheetGid);
    const map = new Map();

    // ヘッダ順に厳密に合わせる（boot.esm.cdn.js の MATERIAL_HEADERS と一致）
    rows.forEach((row, idx) => {
      const [
        materialKey, // A
        opacity, // B
        doubleSided, // C
        unlitLike, // D
        chromaEnable, // E
        chromaColor, // F
        chromaTolerance, // G
        chromaFeather, // H
        roughness, // I
        metalness, // J
        emissiveHex, // K
        updatedAt, // L
        updatedBy, // M
        rowSheetGid, // N
      ] = row;

      if (!materialKey) return;

      // sheetGid が指定されている行のみ、そのシートに属するとみなす
      // （rowSheetGid が空の古い行があれば、グローバル扱いにしてもよいが
      //  今回は「指定されていれば必ず一致すること」を優先）
      if (rowSheetGid && String(rowSheetGid) !== gidStr) return;

      const props = {
        opacity: opacity !== undefined ? Number(opacity) : 1,
        doubleSided: doubleSided === 'TRUE',
        unlitLike: unlitLike === 'TRUE',
        chromaEnable: chromaEnable === 'TRUE',
        chromaColor: chromaColor || '#000000',
        chromaTolerance:
          chromaTolerance !== undefined ? Number(chromaTolerance) : 0,
        chromaFeather:
          chromaFeather !== undefined ? Number(chromaFeather) : 0,
        roughness:
          roughness !== undefined && roughness !== ''
            ? Number(roughness)
            : undefined,
        metalness:
          metalness !== undefined && metalness !== ''
            ? Number(metalness)
            : undefined,
        emissiveHex: emissiveHex || undefined,
        // updatedAt / updatedBy / sheetGid は props には含めない（メタ情報）
      };

      map.set(String(materialKey), props);
    });

    sheetMaterialCache.set(gidStr, map);
    console.log(LOG_PREFIX, 'Data Loaded. Keys:', map.size, 'for sheet', gidStr);
    return map;
  }

  // ---- 1 マテリアル分の同期（状態テーブル → UI / Viewer） -----------------

  function syncMaterialState(materialKey) {
    if (!materialKey) return;
    const gid = String(currentSheetGid || '');
    const cache = sheetMaterialCache.get(gid);
    const cachedProps = cache ? cache.get(materialKey) : null;

    const finalProps = cachedProps
      ? Object.assign({}, defaultProps, cachedProps)
      : Object.assign({}, defaultProps);

    applyPropsToUI(finalProps);
    applyToViewer(materialKey, finalProps);
  }

  // ---- シートコンテキスト変更イベント --------------------------------------

  async function handleSheetContextChange(ctx) {
    const spreadsheetId = ctx && ctx.spreadsheetId;
    const sheetGid = ctx && ctx.sheetGid;
    currentSheetGid = sheetGid != null ? String(sheetGid) : '';

    console.log(LOG_PREFIX, 'Sheet Context Change ->', currentSheetGid);

    if (!spreadsheetId || !currentSheetGid) return;

    const map = (await loadMaterialsForContext(
      spreadsheetId,
      currentSheetGid,
    )) || new Map();

    // 1. シーン全体を、このシートの状態テーブルに完全同期
    applyAllToScene(map);

    // 2. UI を、現在選択中（なければ先頭）のマテリアルで同期
    if (!ui) ui = queryUI();
    if (ui && ui.materialSelect) {
      let key = getSelectedMaterialKey();
      if (!key && ui.materialSelect.options.length > 0) {
        ui.materialSelect.value = ui.materialSelect.options[0].value;
        key = ui.materialSelect.value;
      }
      if (key) {
        syncMaterialState(key);
      }
    }
  }

  // ---- DOM イベントバインド -------------------------------------------------

  function bindDirectEvents() {
    if (listenersBound) return;
    if (!ui) ui = queryUI();
    if (!ui.materialSelect) return;

    listenersBound = true;
    console.log(LOG_PREFIX, 'Binding Direct DOM Events');

    ui.materialSelect.addEventListener('change', () => {
      const key = getSelectedMaterialKey();
      console.log(LOG_PREFIX, 'Select Change:', key);
      syncMaterialState(key);
    });

    if (ui.opacityRange) {
      ui.opacityRange.addEventListener('input', () => {
        const state = collectControls();
        if (!state.materialKey) return;

        // 即時プレビュー（シートに書かず、UI/Viewer だけ更新）
        if (ui.opacityVal) {
          const disp = Number(state.props.opacity).toFixed(2);
          if (
            ui.opacityVal.tagName === 'INPUT' ||
            ui.opacityVal.tagName === 'OUTPUT'
          ) {
            ui.opacityVal.value = disp;
          } else {
            ui.opacityVal.textContent = disp;
          }
        }
        applyToViewer(state.materialKey, state.props);
      });

      ui.opacityRange.addEventListener('change', () => {
        const state = collectControls();
        if (!state.materialKey) return;
        console.log(LOG_PREFIX, 'Slider Commit:', state.materialKey);
        applyToViewer(state.materialKey, state.props);
        persistAndCache(state.materialKey, state.props);
      });
    }

    const commit = (label) => {
      const state = collectControls();
      if (!state.materialKey) return;
      console.log(LOG_PREFIX, label, state.materialKey);
      applyToViewer(state.materialKey, state.props);
      persistAndCache(state.materialKey, state.props);
    };

    const preview = () => {
      const state = collectControls();
      if (!state.materialKey) return;
      applyToViewer(state.materialKey, state.props);
    };

    if (ui.chkDoubleSided)
      ui.chkDoubleSided.addEventListener('change', () =>
        commit('DoubleSided'),
      );
    if (ui.chkUnlitLike)
      ui.chkUnlitLike.addEventListener('change', () => commit('UnlitLike'));
    if (ui.chkChromaEnable)
      ui.chkChromaEnable.addEventListener('change', () =>
        commit('ChromaEnable'),
      );
    if (ui.inpChromaColor)
      ui.inpChromaColor.addEventListener('change', () =>
        commit('ChromaColor'),
      );

    if (ui.rngChromaTolerance) {
      ui.rngChromaTolerance.addEventListener('input', preview);
      ui.rngChromaTolerance.addEventListener('change', () =>
        commit('ChromaTolerance'),
      );
    }

    if (ui.rngChromaFeather) {
      ui.rngChromaFeather.addEventListener('input', preview);
      ui.rngChromaFeather.addEventListener('change', () =>
        commit('ChromaFeather'),
      );
    }
  }

  // ---- boot ---------------------------------------------------------------

  function boot() {
    console.log(LOG_PREFIX, 'Booting...', VERSION_TAG);

    // シートコンテキストイベント
    window.addEventListener('lm:sheet-context', (e) => {
      if (e.detail) handleSheetContextChange(e.detail);
    });
    if (window.__LM_SHEET_CTX) {
      handleSheetContextChange(window.__LM_SHEET_CTX);
    }

    // UI が張られるまでポーリングしてイベントをバインド
    const t = setInterval(() => {
      const res = queryUI();
      if (res.materialSelect) {
        ui = res;
        bindDirectEvents();

        const key = getSelectedMaterialKey();
        if (key && currentSheetGid) {
          syncMaterialState(key);
        }
        clearInterval(t);
      } else if (retryCount++ > 50) {
        console.warn(LOG_PREFIX, 'UI bind timeout');
        clearInterval(t);
      }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
