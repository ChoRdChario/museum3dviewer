// material.orchestrator.js
// LociMyu material UI orchestrator (Unified)
// Sheet × Material state-table driven orchestrator.
// VERSION_TAG: V6_SHEET_MATERIAL_SOT
//
// ポリシー:
// - 「キャプションシート × マテリアル」の状態テーブル（__LM_MATERIALS）を唯一のソース・オブ・トゥルースとする。
// - UI や Three.js 側は常にこの状態テーブルから同期される一時的なビュー。
// - マテリアル切替・シート切替のたびに、必ず状態テーブル（＋デフォルト値）から UI / Viewer を再同期する。
// - Viewer の状態を読み取ってシートへ書き戻すことはしない（片方向：シート → UI / Viewer, UI → シート）。

(function () {
  const LOG_PREFIX = '[mat-orch-unified]';
  const MATERIALS_RANGE = '__LM_MATERIALS!A:N';
  const VERSION_TAG = 'V6_SHEET_MATERIAL_SOT';
  console.log(LOG_PREFIX, 'loaded', VERSION_TAG);

  // UI State
  let ui = null;
  let retryCount = 0;
  let listenersBound = false;

  // Data State
  let currentSheetGid = '';
  // Cache: sheetGid -> Map<materialKey, PropsObject>
  const sheetMaterialCache = new Map();

  const defaultProps = {
    opacity: 1,
    doubleSided: false,
    unlitLike: false,
    chromaEnable: false,
    chromaColor: '#000000',
    chromaTolerance: 0,
    chromaFeather: 0,
  };

  // --- Helpers ---

  function ensureArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    return [x];
  }

  // ▼▼▼ UI の参照先: #pane-material を最優先とし、旧 UI もフォールバックで拾う ▼▼▼
  function queryUI() {
    const doc = document;
    // Prefer controls inside the new material pane to avoid accidentally
    // binding to legacy/hidden anchors (e.g. #panel-material).
    const pane = doc.querySelector('#pane-material') || doc;
    const root = pane;

    // Canonical material select: #materialSelect inside #pane-material.
    // Fallbacks exist only for backward compatibility.
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
      chkDoubleSided: root.querySelector('#pm-flag-doublesided') || doc.getElementById('pm-flag-doublesided'),
      chkUnlitLike: root.querySelector('#pm-flag-unlit') || doc.getElementById('pm-flag-unlit'),
      chkChromaEnable: root.querySelector('#pm-chroma-enable') || doc.getElementById('pm-chroma-enable'),
      inpChromaColor: root.querySelector('#pm-chroma-color') || doc.getElementById('pm-chroma-color'),
      rngChromaTolerance: root.querySelector('#pm-chroma-tol') || doc.getElementById('pm-chroma-tol'),
      rngChromaFeather: root.querySelector('#pm-chroma-feather') || doc.getElementById('pm-chroma-feather')
    };
  }
  // ▲▲▲ UI 参照先ここまで ▲▲▲

  function getSelectedMaterialKey() {
    if (!ui) ui = queryUI();
    return ui.materialSelect ? (ui.materialSelect.value || '').trim() : '';
  }

  function clamp(v, min, max) {
    return Math.min(Math.max(Number(v), min), max);
  }

  function applyPropsToUI(props) {
    if (!ui) ui = queryUI();
    const p = Object.assign({}, defaultProps, props || {});

    // Opacity
    if (ui.opacityRange) ui.opacityRange.value = String(p.opacity);

    // Text readout update
    if (ui.opacityVal) {
      const disp = Number(p.opacity).toFixed(2);
      if (ui.opacityVal.tagName === 'INPUT' || ui.opacityVal.tagName === 'OUTPUT') {
        ui.opacityVal.value = disp;
      } else {
        ui.opacityVal.textContent = disp;
      }
    }

    if (ui.chkDoubleSided) ui.chkDoubleSided.checked = !!p.doubleSided;
    if (ui.chkUnlitLike) ui.chkUnlitLike.checked = !!p.unlitLike;
    if (ui.chkChromaEnable) ui.chkChromaEnable.checked = !!p.chromaEnable;
    if (ui.inpChromaColor) ui.inpChromaColor.value = p.chromaColor || '#000000';
    if (ui.rngChromaTolerance) ui.rngChromaTolerance.value = String(p.chromaTolerance || 0);
    if (ui.rngChromaFeather) ui.rngChromaFeather.value = String(p.chromaFeather || 0);
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
      chromaTolerance: ui.rngChromaTolerance ? Number(ui.rngChromaTolerance.value) : 0,
      chromaFeather: ui.rngChromaFeather ? Number(ui.rngChromaFeather.value) : 0
    };

    return {
      materialKey: getSelectedMaterialKey(),
      props
    };
  }

  // --- Scene / Bridge Interaction ---

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

  function persistAndCache(key, props) {
    if (!key) return;
    if (!currentSheetGid) {
      console.warn(LOG_PREFIX, 'No sheet context yet; skip persist for', key);
      return;
    }
    persistToSheet(key, props);

    const gid = String(currentSheetGid);
    const cache = sheetMaterialCache.get(gid) || new Map();
    cache.set(key, Object.assign({}, defaultProps, props || {}));
    sheetMaterialCache.set(gid, cache);
  }

  // --- 全マテリアルへ状態テーブルを適用（シートごとの完全同期） ---

  function applyAllToScene(mapForSheet) {
    const scene = window.__LM_SCENE || window.scene || (window.viewer && window.viewer.scene);
    if (!scene) return;

    const activeMap = mapForSheet instanceof Map ? mapForSheet : null;

    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        const key = (m.name || o.name || '').trim();
        if (!key) return;

        // 「キャプションシート × マテリアル」の状態テーブルから props を決定
        // 該当行がなければ必ず defaultProps を使う（前シートの値が残らないようにする）。
        let props = activeMap && activeMap.get(key);
        if (!props) {
          props = Object.assign({}, defaultProps);
        } else {
          props = Object.assign({}, defaultProps, props);
        }
        applyToViewer(key, props);
      });
    });
    console.log(LOG_PREFIX, 'Applied full configuration to scene for sheet', currentSheetGid);
  }

  // --- Persistence ---

  function persistToSheet(key, props) {
    const persist = window.LM_MaterialsPersist;
    if (!persist || typeof persist.upsert !== 'function') {
      console.warn(LOG_PREFIX, 'Persistence module missing');
      return;
    }
    const patch = Object.assign({ materialKey: key, sheetGid: String(currentSheetGid || '') }, props);
    persist.upsert(patch).catch((e) => console.warn(LOG_PREFIX, 'Persist failed', e));
  }

  // --- Core Sync Logic ---

  function syncMaterialState(key) {
    if (!key) return;
    const gid = String(currentSheetGid || '');
    const cache = sheetMaterialCache.get(gid);
    const cachedProps = cache ? cache.get(key) : null;

    // 状態テーブルから props を取得。なければ defaultProps を明示的に使用。
    const finalProps = cachedProps
      ? Object.assign({}, defaultProps, cachedProps)
      : Object.assign({}, defaultProps);

    applyPropsToUI(finalProps);
    applyToViewer(key, finalProps);
  }

  // --- Data Loading from __LM_MATERIALS ---

  async function loadMaterialsForContext(spreadsheetId, sheetGid) {
    if (!spreadsheetId || !sheetGid) return;
    const fetchJSON = window.__lm_fetchJSONAuth;
    if (!fetchJSON) {
      console.warn(LOG_PREFIX, 'No auth fetch available; cannot load materials');
      return;
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(MATERIALS_RANGE)}?majorDimension=ROWS`;

    let res;
    try {
      res = await fetchJSON(url);
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to load materials from Sheets', e);
      return;
    }

    const rows = ensureArray(res && res.values).slice(1); // skip header

    const map = new Map();
    rows.forEach((row) => {
      const [
        updatedAt,
        updatedBy,
        rowSheetGid,
        materialKey,
        opacity,
        doubleSided,
        unlitLike,
        chromaEnable,
        chromaColor,
        chromaTolerance,
        chromaFeather
      ] = row;

      if (!materialKey || rowSheetGid !== String(sheetGid)) return;

      const props = {
        opacity: opacity !== undefined ? Number(opacity) : 1,
        doubleSided: doubleSided === 'TRUE',
        unlitLike: unlitLike === 'TRUE',
        chromaEnable: chromaEnable === 'TRUE',
        chromaColor: chromaColor || '#000000',
        chromaTolerance: chromaTolerance !== undefined ? Number(chromaTolerance) : 0,
        chromaFeather: chromaFeather !== undefined ? Number(chromaFeather) : 0
      };

      map.set(materialKey, props);
    });

    const gid = String(sheetGid);
    sheetMaterialCache.set(gid, map);
    return map;
  }

  // --- Sheet Context Handling ---

  async function handleSheetContextChange(ctx) {
    const spreadsheetId = ctx && ctx.spreadsheetId;
    const sheetGid = ctx && ctx.sheetGid;
    currentSheetGid = sheetGid ? String(sheetGid) : '';

    console.log(LOG_PREFIX, 'Sheet Context Change ->', currentSheetGid);

    if (!spreadsheetId || !currentSheetGid) return;

    const map = (await loadMaterialsForContext(spreadsheetId, currentSheetGid)) || new Map();
    console.log(LOG_PREFIX, 'Data Loaded. Keys:', map.size);

    if (!ui) ui = queryUI();

    // 1. Viewer 側を、当該シートの状態テーブルに完全同期
    applyAllToScene(map);

    // 2. UI 側を、現在選択中のマテリアル（あれば）で同期
    if (ui && ui.materialSelect) {
      const currentKey = getSelectedMaterialKey();
      if (currentKey) {
        syncMaterialState(currentKey);
      } else if (ui.materialSelect.options.length > 0) {
        // 何も選ばれていなければ先頭を選択し、その状態で同期する
        ui.materialSelect.value = ui.materialSelect.options[0].value;
        syncMaterialState(ui.materialSelect.value);
      }
    }
  }

  // --- Direct DOM Event Binding ---

  function bindDirectEvents() {
    if (listenersBound) return;
    if (!ui) ui = queryUI();
    if (!ui.materialSelect) return;

    listenersBound = true;
    console.log(LOG_PREFIX, 'Binding Direct DOM Events');

    ui.materialSelect.addEventListener('change', () => {
      const key = getSelectedMaterialKey();
      console.log(LOG_PREFIX, 'Select Change:', key);
      // マテリアル切替ごとに状態テーブル（＋デフォルト）から同期
      syncMaterialState(key);
    });

    if (ui.opacityRange) {
      ui.opacityRange.addEventListener('input', () => {
        const state = collectControls();
        if (!state.materialKey) return;
        // 即時プレビューはシートに書かず Viewer のみに反映
        if (ui.opacityVal) {
          const disp = Number(state.props.opacity).toFixed(2);
          if (ui.opacityVal.tagName === 'INPUT' || ui.opacityVal.tagName === 'OUTPUT') {
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
        // コミットタイミングでのみ状態テーブルを更新
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

    if (ui.chkDoubleSided) ui.chkDoubleSided.addEventListener('change', () => commit('DoubleSided'));
    if (ui.chkUnlitLike) ui.chkUnlitLike.addEventListener('change', () => commit('UnlitLike'));
    if (ui.chkChromaEnable) ui.chkChromaEnable.addEventListener('change', () => commit('ChromaEnable'));
    if (ui.inpChromaColor) ui.inpChromaColor.addEventListener('change', () => commit('ChromaColor'));

    if (ui.rngChromaTolerance) {
      ui.rngChromaTolerance.addEventListener('input', preview);
      ui.rngChromaTolerance.addEventListener('change', () => commit('ChromaTolerance'));
    }

    if (ui.rngChromaFeather) {
      ui.rngChromaFeather.addEventListener('input', preview);
      ui.rngChromaFeather.addEventListener('change', () => commit('ChromaFeather'));
    }
  }

  // --- Bootstrapping ---

  function boot() {
    console.log(LOG_PREFIX, 'Booting...', VERSION_TAG);

    // シートコンテキスト変更イベント
    window.addEventListener('lm:sheet-context', (e) => {
      if (e.detail) handleSheetContextChange(e.detail);
    });
    if (window.__LM_SHEET_CTX) {
      handleSheetContextChange(window.__LM_SHEET_CTX);
    }

    // UI 要素の出現をポーリングしてイベントバインド
    const t = setInterval(() => {
      const res = queryUI();
      if (res.materialSelect) {
        ui = res;
        bindDirectEvents();
        const key = getSelectedMaterialKey();
        if (key && currentSheetGid) {
          // 初期表示時も状態テーブルから同期
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
