// material.orchestrator.js
// LociMyu material UI orchestrator (Unified)
// Integrates full-scene application (replacing auto.apply.js) and direct DOM event handling.
// VERSION_TAG: V6_SHEET_MATERIAL_SOT_DS_UNLIT

(function () {
  const LOG_PREFIX = '[mat-orch-unified]';
  const MATERIALS_RANGE = '__LM_MATERIALS!A:N';
  const VERSION_TAG = 'V6_SHEET_MATERIAL_SOT_DS_UNLIT';

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

  // ▼▼▼ 修正ポイント：UI の参照先を #pane-material 優先にする ▼▼▼
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
  // ▲▲▲ ここまでが変更点 ▲▲▲

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

  function getScene() {
    return window.__LM_SCENE || window.scene || (window.viewer && window.viewer.scene) || null;
  }

  function normalizeForViewer(props) {
    const out = Object.assign({}, props || {});
    if (Object.prototype.hasOwnProperty.call(out, 'doubleSided')) {
      // viewer.module 側は side='DoubleSide' / 'FrontSide' で受ける想定
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

  // ▼▼▼ DoubleSided / Unlit 用の直接シーン適用ヘルパ ▼▼▼
  function applyFlagsToMaterial(material, materialKey, props) {
    if (!material || !materialKey || !props) return;

    // doubleSided: THREE.Namespace に依存せず、数値で side を切り替える
    if (Object.prototype.hasOwnProperty.call(props, 'doubleSided') && typeof material.side !== 'undefined') {
      // Three.js: FrontSide = 0, DoubleSide = 2
      material.side = props.doubleSided ? 2 : 0;
      material.needsUpdate = true;
    }

    // UnlitLike については、現状は viewer.module 側の実装に委譲。
    // 将来ここで material.lights=false 等のローカル実装を追加する余地を残す。
  }

  function applyFlagsDirectToScene(key, props) {
    const scene = getScene();
    if (!scene || !key || !props) return;

    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (!m) return;
        const matKey = (m.name || o.name || '').trim();
        if (!matKey) return;
        if (matKey !== key) return;
        applyFlagsToMaterial(m, matKey, props);
      });
    });
  }
  // ▲▲▲ DoubleSided / Unlit 用ヘルパここまで ▲▲▲

  function persistAndCache(key, props) {
    if (!key) return;
    persistToSheet(key, props);

    const cache = sheetMaterialCache.get(currentSheetGid) || new Map();
    cache.set(key, props);
    sheetMaterialCache.set(currentSheetGid, cache);
  }

  function applyAllToScene(map) {
    const scene = getScene();
    if (!scene) return;

    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (!m) return;
        const key = (m.name || o.name || '').trim();
        if (!key) return;
        if (map.has(key)) {
          const conf = map.get(key);
          // Sheets に保存された値をビューアへブリッジ
          applyToViewer(key, conf);
          // THREE グローバルに依存せず、ここで side だけは直接反映
          applyFlagsToMaterial(m, key, conf);
        }
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
    const patch = Object.assign({ materialKey: key, sheetGid: currentSheetGid }, props);
    persist.upsert(patch).catch(e => console.warn(LOG_PREFIX, 'Persist failed', e));
  }

  // --- Core Sync Logic ---

  function syncMaterialState(key) {
    if (!key) return;
    const cache = sheetMaterialCache.get(currentSheetGid);
    const cachedProps = cache ? cache.get(key) : null;
    const finalProps = cachedProps ? Object.assign({}, cachedProps) : Object.assign({}, defaultProps);

    applyPropsToUI(finalProps);
    applyToViewer(key, finalProps);
    // シート切替・マテリアル選択時にも doubleSided を直接反映
    applyFlagsDirectToScene(key, finalProps);
  }

  // --- Data Loading from __LM_MATERIALS ---

  async function loadMaterialsForContext(spreadsheetId, sheetGid) {
    if (!spreadsheetId || !sheetGid) return;
    const fetchJSON = window.__lm_fetchJSONAuth;
    if (!fetchJSON) {
      console.warn(LOG_PREFIX, 'No auth fetch available; cannot load materials');
      return;
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(MATERIALS_RANGE)}?majorDimension=ROWS`;
    const res = await fetchJSON(url);
    const rows = ensureArray(res && res.values).slice(1); // skip header

    const map = new Map();
    rows.forEach(row => {
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
        chromaFeather,
      ] = row;

      if (!materialKey || rowSheetGid !== String(sheetGid)) return;

      const props = {
        opacity: opacity !== undefined ? Number(opacity) : 1,
        doubleSided: doubleSided === 'TRUE',
        unlitLike: unlitLike === 'TRUE',
        chromaEnable: chromaEnable === 'TRUE',
        chromaColor: chromaColor || '#000000',
        chromaTolerance: chromaTolerance !== undefined ? Number(chromaTolerance) : 0,
        chromaFeather: chromaFeather !== undefined ? Number(chromaFeather) : 0,
      };

      map.set(materialKey, props);
    });

    sheetMaterialCache.set(String(sheetGid), map);
    return map;
  }

  // --- Sheet Context Handling ---

  async function handleSheetContextChange(ctx) {
    const spreadsheetId = ctx && ctx.spreadsheetId;
    const sheetGid = ctx && ctx.sheetGid;
    currentSheetGid = sheetGid ? String(sheetGid) : '';

    console.log(LOG_PREFIX, 'Sheet Context Change ->', currentSheetGid);

    if (!spreadsheetId || !currentSheetGid) return;

    const map = await loadMaterialsForContext(spreadsheetId, currentSheetGid);
    console.log(LOG_PREFIX, 'Data Loaded. Keys:', map ? map.size : 0, 'for sheet', currentSheetGid);

    if (!ui) ui = queryUI();
    if (ui && ui.materialSelect && ui.materialSelect.value) {
      // 既に選択されているマテリアルがあれば、その状態を優先して同期
      syncMaterialState(ui.materialSelect.value);
    } else if (map && map.size) {
      const firstKey = map.keys().next().value;
      if (firstKey && ui && ui.materialSelect) {
        ui.materialSelect.value = firstKey;
      }
      applyAllToScene(map);
    } else {
      applyAllToScene(new Map());
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
      syncMaterialState(key);
    });

    if (ui.opacityRange) {
      ui.opacityRange.addEventListener('input', () => {
        const state = collectControls();
        if (!state.materialKey) return;
        if (ui.opacityVal) {
          const disp = Number(state.props.opacity).toFixed(2);
          if (ui.opacityVal.tagName === 'INPUT' || ui.opacityVal.tagName === 'OUTPUT') {
            ui.opacityVal.value = disp;
          } else {
            ui.opacityVal.textContent = disp;
          }
        }
        // スライダーのリアルタイム反映はビューアブリッジのみ（シーン traverse はしない）
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

      // DoubleSided / UnlitLike のトグル時のみ、シーンに直接 side/unlit を反映
      if (label === 'DoubleSided' || label === 'UnlitLike') {
        applyFlagsDirectToScene(state.materialKey, state.props);
      }

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

    window.addEventListener('lm:sheet-context', (e) => {
      if (e.detail) handleSheetContextChange(e.detail);
    });
    if (window.__LM_SHEET_CTX) {
      handleSheetContextChange(window.__LM_SHEET_CTX);
    }

    const t = setInterval(() => {
      const res = queryUI();
      if (res.materialSelect) {
        bindDirectEvents();
        const key = getSelectedMaterialKey();
        if (key && currentSheetGid) syncMaterialState(key);
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
