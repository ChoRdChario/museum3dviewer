// material.orchestrator.js
// LociMyu material UI orchestrator
// UI と viewer.bridge・各種保存ロジックの仲立ちを行う
// VERSION_TAG: V6_XX_MATERIAL_FIX_OPACITY_SYNC_UI

(function () {
  const LOG_PREFIX = '[mat-orch]';
  const RETRY_MS = 250;
  const RETRY_MAX = 40;
  const MATERIALS_RANGE = '__LM_MATERIALS!A:N';

  let ui = null;
  let retryCount = 0;

  // pm-* ベースの現在状態（単純化：まずは opacity のみ扱う）
  let currentMaterialKey = '';
  // sheetPersist 経由で復元された「マテリアル → opacity」マップ
  const sessionMaterialState = new Map(); // key: materialKey, value: props
  let currentOpacity = 1;
  let pmEventsWired = false;
  let defaultProps = null;

  // シートコンテキストごとのキャッシュ
  let currentSheetGid = '';
  let currentSheetCtx = null;
  const sheetMaterialCache = new Map(); // sheetGid -> Map(materialKey -> props)
  let sheetCacheLoading = null;

  /**
   * DOM から UI 要素を取得
   * - なるべく canonical な ID (#materialSelect / #opacityRange)
   * - 無ければ pm-* をフォールバックとして見る
   */
  function queryUI() {
    const materialSelect =
      document.getElementById('materialSelect') ||
      document.getElementById('pm-material');

    const opacityRange =
      document.getElementById('opacityRange') ||
      document.getElementById('pm-opacity-range');

    // 将来拡張用のコントロールは存在すれば拾う（無ければ undefined のまま）
    const chkDoubleSided =
      document.getElementById('matDoubleSided') ||
      document.getElementById('materialDoubleSided');
    const chkUnlitLike =
      document.getElementById('matUnlitLike') ||
      document.getElementById('materialUnlitLike');

    const chkChromaEnable =
      document.getElementById('matChromaEnable') ||
      document.getElementById('chromaEnable');
    const inpChromaColor =
      document.getElementById('matChromaColor') ||
      document.getElementById('chromaColor');
    const rngChromaTolerance =
      document.getElementById('matChromaTolerance') ||
      document.getElementById('chromaTolerance');
    const rngChromaFeather =
      document.getElementById('matChromaFeather') ||
      document.getElementById('chromaFeather');

    const rngRoughness =
      document.getElementById('matRoughness') ||
      document.getElementById('roughnessRange');
    const rngMetalness =
      document.getElementById('matMetalness') ||
      document.getElementById('metalnessRange');

    const inpEmissiveHex =
      document.getElementById('matEmissiveHex') ||
      document.getElementById('emissiveHex');
    const rngEmissiveIntensity =
      document.getElementById('matEmissiveIntensity') ||
      document.getElementById('emissiveIntensityRange');

    return {
      materialSelect,
      opacityRange,
      chkDoubleSided,
      chkUnlitLike,
      chkChromaEnable,
      inpChromaColor,
      rngChromaTolerance,
      rngChromaFeather,
      rngRoughness,
      rngMetalness,
      inpEmissiveHex,
      rngEmissiveIntensity,
    };
  }

  /**
   * dropdown から materialKey を取得
   */
  function getSelectedMaterialKey(materialSelect) {
    if (!materialSelect) return '';

    const opt = materialSelect.options[materialSelect.selectedIndex];
    if (!opt) return '';

    return (
      (opt.dataset && opt.dataset.materialKey) ||
      opt.value ||
      opt.textContent ||
      ''
    ).trim();
  }

  /**
   * range 要素から opacity を 0〜1 の値として取得
   */
  function readOpacityFromRange(range) {
    if (!range) return 1;
    const raw = Number(range.value);
    const max = Number(range.max || '1');

    if (!isFinite(raw)) return 1;

    // 0〜1 っぽい設定
    if (max <= 1.0000001) {
      return clamp(raw, 0, 1);
    }

    // 0〜100 などのケースを想定して正規化
    const norm = raw / max;
    return clamp(norm, 0, 1);
  }

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  /**
   * 正規化された opacity(0〜1) を range 要素に反映
   * - max が 1 以下ならそのまま
   * - max が 1 より大きければ 0〜max にスケール
   */
  function writeOpacityToRange(range, normalizedOpacity) {
    if (!range) return;
    const v = clamp(
      typeof normalizedOpacity === 'number' ? normalizedOpacity : 1,
      0,
      1
    );
    const max = Number(range.max || '1');

    if (!isFinite(max) || max <= 1.0000001) {
      range.value = String(v);
    } else {
      const scaled = v * max;
      range.value = String(scaled);
    }
  }

  function applyPropsToUI(props) {
    if (!ui) ui = queryUI();
    const base = Object.assign({}, ensureDefaultProps(), props || {});

    if (ui.opacityRange) writeOpacityToRange(ui.opacityRange, base.opacity);
    if (ui.chkDoubleSided) ui.chkDoubleSided.checked = !!base.doubleSided;
    if (ui.chkUnlitLike) ui.chkUnlitLike.checked = !!base.unlitLike;
    if (ui.chkChromaEnable) ui.chkChromaEnable.checked = !!base.chromaEnable;
    if (ui.inpChromaColor) ui.inpChromaColor.value = base.chromaColor;
    if (ui.rngChromaTolerance)
      ui.rngChromaTolerance.value = String(base.chromaTolerance);
    if (ui.rngChromaFeather)
      ui.rngChromaFeather.value = String(base.chromaFeather);
    if (ui.rngRoughness) ui.rngRoughness.value = String(base.roughness);
    if (ui.rngMetalness) ui.rngMetalness.value = String(base.metalness);
    if (ui.inpEmissiveHex) ui.inpEmissiveHex.value = base.emissiveHex;
    if (ui.rngEmissiveIntensity)
      ui.rngEmissiveIntensity.value = String(base.emissiveIntensity);
  }

  /**
   * 現在の UI 状態を 1 つのオブジェクトにまとめる
   * - materialKey
   * - props (viewer.applyMaterialProps に渡す)
   *   ※ 将来的に opacity 以外もここに集約
   */
  function collectControls() {
    if (!ui) ui = queryUI();

    const key = getSelectedMaterialKey(ui.materialSelect);

    const opacity = readOpacityFromRange(ui.opacityRange);

    const doubleSided =
      ui.chkDoubleSided ? !!ui.chkDoubleSided.checked : false;
    const unlitLike = ui.chkUnlitLike ? !!ui.chkUnlitLike.checked : false;

    const chromaEnable =
      ui.chkChromaEnable ? !!ui.chkChromaEnable.checked : false;
    const chromaColor = ui.inpChromaColor
      ? ui.inpChromaColor.value || '#000000'
      : '#000000';
    const chromaTolerance = ui.rngChromaTolerance
      ? Number(ui.rngChromaTolerance.value || '0.1')
      : 0.1;
    const chromaFeather = ui.rngChromaFeather
      ? Number(ui.rngChromaFeather.value || '0')
      : 0;

    const roughness = ui.rngRoughness
      ? Number(ui.rngRoughness.value || '0')
      : 0;
    const metalness = ui.rngMetalness
      ? Number(ui.rngMetalness.value || '0')
      : 0;

    const emissiveHex = ui.inpEmissiveHex
      ? ui.inpEmissiveHex.value || '#000000'
      : '#000000';
    const emissiveIntensity = ui.rngEmissiveIntensity
      ? Number(ui.rngEmissiveIntensity.value || '0')
      : 0;

    const props = {
      opacity,
      doubleSided,
      unlitLike,
      chromaEnable,
      chromaColor,
      chromaTolerance,
      chromaFeather,
      roughness,
      metalness,
      emissiveHex,
      emissiveIntensity,
    };

    return { materialKey: key, props };
  }

  function ensureDefaultProps() {
    if (defaultProps) return defaultProps;
    defaultProps = {
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
    return defaultProps;
  }

  /**
   * viewer 側へ反映
   */
  function applyToViewer(materialKey, props) {
    const bridge = window.__lm_viewer_bridge;
    if (!bridge || typeof bridge.applyMaterialProps !== 'function') {
      console.warn(LOG_PREFIX, 'viewer bridge not ready');
      return;
    }
    if (!materialKey) {
      console.warn(LOG_PREFIX, 'no materialKey; skip applyToViewer');
      return;
    }
    bridge.applyMaterialProps(materialKey, props || {});
  }

  /**
   * __LM_MATERIALS への永続化
   * - LM_MaterialsPersist が存在する場合のみ呼び出す
   * - 非同期だが、呼び出し側は待たない（fire-and-forget）
   */
  function persistToSheet(materialKey, props) {
    const persist = window.LM_MaterialsPersist;
    if (!persist || typeof persist.upsert !== 'function') {
      return;
    }
    if (!materialKey) return;

    // Debounced write:
    //  - UI / pm events may fire many times while the user drags the slider.
    //  - To avoid spamming Sheets, we keep only the latest state and
    //    send a single upsert after a short delay.
    if (persistToSheet._timer) {
      clearTimeout(persistToSheet._timer);
    }

    persistToSheet._lastKey = materialKey;
    // clone to avoid accidental external mutation
    persistToSheet._lastProps = Object.assign({}, props || {});

    const delay =
      typeof persistToSheet.DEBOUNCE_MS === 'number'
        ? persistToSheet.DEBOUNCE_MS
        : 800;

    persistToSheet._timer = setTimeout(() => {
      try {
        const key = persistToSheet._lastKey;
        const latestProps = persistToSheet._lastProps || {};
        if (!key) {
          return;
        }
        const patch = Object.assign({ materialKey: key }, latestProps);
        const p = persist.upsert(patch);
        if (p && typeof p.catch === 'function') {
          p.catch((e) =>
            console.warn(LOG_PREFIX, 'persistToSheet failed', e)
          );
        }
      } catch (e) {
        console.warn(LOG_PREFIX, 'persistToSheet threw', e);
      } finally {
        persistToSheet._timer = null;
      }
    }, delay);
  }

  /**
   * 変更イベントを外部へ通知
   */
  function emitChange(type, state) {
    const detail = {
      materialKey: state.materialKey,
      props: state.props,
    };
    window.dispatchEvent(
      new CustomEvent(type, {
        detail,
      })
    );
  }

  /**
   * 現在の state を元に viewer へ apply するヘルパー
   * - opacity は currentOpacity を優先（明示 override があればそれ）
   */
  function applyState(key, opacityOverride) {
    return applyStateWithOptions(key, opacityOverride, { persist: true });
  }

  function applyStateWithOptions(
    key,
    opacityOverride,
    { persist = true, useCache = true } = {}
  ) {
    if (!key) {
      console.warn(LOG_PREFIX, 'applyState called with empty key');
      return null;
    }

    const defaults = ensureDefaultProps();
    const cache = useCache ? getCurrentSheetMap() : null;
    const cachedProps = cache ? cache.get(key) : null;
    const prevSession = sessionMaterialState.get(key) || {};

    const props = Object.assign({}, defaults, cachedProps || {}, prevSession);

    if (typeof opacityOverride === 'number') {
      props.opacity = clamp(opacityOverride, 0, 1);
    } else {
      props.opacity = clamp(props.opacity, 0, 1);
    }

    currentMaterialKey = key;
    currentOpacity = props.opacity;

    applyPropsToUI(props);

    applyToViewer(key, props);
    sessionMaterialState.set(key, Object.assign({}, props));
    if (persist) {
      persistToSheet(key, props);
    }

    return { materialKey: key, props: props };
  }

  // ===== シートコンテキスト / __LM_MATERIALS キャッシュ =====

  function getActiveSheetGid() {
    const gid =
      window.__LM_ACTIVE_SHEET_GID ||
      (window.__LM_SHEET_CTX && window.__LM_SHEET_CTX.sheetGid) ||
      '';
    return String(gid || '');
  }

  function getCurrentSheetMap() {
    const gid = currentSheetGid || getActiveSheetGid();
    if (!gid) return null;
    return sheetMaterialCache.get(String(gid)) || null;
  }

  function ensureSheetCache(ctx) {
    const gid = String((ctx && ctx.sheetGid) || currentSheetGid || getActiveSheetGid() || '');
    if (!gid) return Promise.resolve(null);

    const cached = sheetMaterialCache.get(gid);
    if (cached) return Promise.resolve(cached);

    if (sheetCacheLoading) return sheetCacheLoading;

    const promise = loadMaterialsForSheet(ctx || currentSheetCtx || window.__LM_SHEET_CTX).then((map) => {
      if (gid !== (currentSheetGid || getActiveSheetGid())) return null;
      sheetMaterialCache.set(gid, map);
      return map;
    });

    sheetCacheLoading = promise.finally(() => {
      if (sheetCacheLoading === promise) sheetCacheLoading = null;
    });

    return promise;
  }

  function rowToObj(row) {
    return {
      materialKey: row[0] || '',
      opacity: row[1] !== undefined ? parseFloat(row[1]) : 1,
      doubleSided: (row[2] || '').toString().toUpperCase() === 'TRUE',
      unlitLike: (row[3] || '').toString().toUpperCase() === 'TRUE',
      chromaEnable: (row[4] || '').toString().toUpperCase() === 'TRUE',
      chromaColor: row[5] || '#000000',
      chromaTolerance: parseFloat(row[6] || '0'),
      chromaFeather: parseFloat(row[7] || '0'),
      roughness: row[8] || '',
      metalness: row[9] || '',
      emissiveHex: row[10] || '',
      emissiveIntensity: 0,
      sheetGid: row[13] || '',
    };
  }

  function buildMap(rows, sheetGid) {
    const exact = new Map();
    const fallback = new Map();
    for (let i = 1; i < rows.length; i++) {
      const o = rowToObj(rows[i]);
      if (!o.materialKey) continue;
      if (String(o.sheetGid) === String(sheetGid)) {
        exact.set(o.materialKey, o);
      } else if (o.sheetGid === '' && !fallback.has(o.materialKey)) {
        fallback.set(o.materialKey, o);
      }
    }
    const m = new Map(fallback);
    for (const [k, v] of exact) m.set(k, v);
    return m;
  }

  async function fetchMaterialsTable(spreadsheetId) {
    const fetchAuth = window.__lm_fetchJSONAuth;
    if (typeof fetchAuth !== 'function') {
      console.warn(LOG_PREFIX, '__lm_fetchJSONAuth missing; skip material fetch');
      return [];
    }
    const range = encodeURIComponent(MATERIALS_RANGE);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    const got = await fetchAuth(url);
    return got && got.values ? got.values : [];
  }

  async function loadMaterialsForSheet(ctx) {
    if (!ctx || !ctx.spreadsheetId) return new Map();
    try {
      const rows = await fetchMaterialsTable(ctx.spreadsheetId);
      return buildMap(rows, ctx.sheetGid ?? '');
    } catch (e) {
      console.warn(LOG_PREFIX, 'loadMaterialsForSheet failed', e);
      return new Map();
    }
  }

  function refreshSheetCache(ctx) {
    const gid = String((ctx && ctx.sheetGid) || '');
    currentSheetCtx = ctx || null;
    currentSheetGid = gid;
    sessionMaterialState.clear();
    sheetMaterialCache.delete(gid);
    sheetCacheLoading = null;

    applyPropsToUI(ensureDefaultProps());
    currentOpacity = ensureDefaultProps().opacity;

    const selectedKey = (() => {
      try {
        if (!ui) ui = queryUI();
        return getSelectedMaterialKey(ui.materialSelect);
      } catch (e) {
        console.warn(LOG_PREFIX, 'failed to read selected key on sheet change', e);
        return '';
      }
    })();

    const promise = ensureSheetCache(ctx);
    sheetCacheLoading = promise;

    promise
      .then(() => {
        if (!selectedKey || currentSheetGid !== gid) return;
        const state = applyStateWithOptions(selectedKey, undefined, {
          persist: false,
          useCache: true,
        });
        if (state) {
          emitChange('lm:material-change', state);
        }
      })
      .catch((e) => console.warn(LOG_PREFIX, 'refreshSheetCache failed', e));
  }

  // ===== DOM ベースのフォールバック（旧来の oninput/onchange） =====

  function onControlInput() {
    const state = collectControls();
    if (!state.materialKey) return;

    currentMaterialKey = state.materialKey || currentMaterialKey;
    currentOpacity =
      typeof state.props.opacity === 'number'
        ? clamp(state.props.opacity, 0, 1)
        : currentOpacity;

    sessionMaterialState.set(state.materialKey, Object.assign({}, state.props));
    applyToViewer(state.materialKey, state.props);
    emitChange('lm:material-change', state);
  }

  function onControlCommit() {
    const state = collectControls();
    if (!state.materialKey) return;

    currentMaterialKey = state.materialKey || currentMaterialKey;
    currentOpacity =
      typeof state.props.opacity === 'number'
        ? clamp(state.props.opacity, 0, 1)
        : currentOpacity;

    sessionMaterialState.set(state.materialKey, Object.assign({}, state.props));
    applyToViewer(state.materialKey, state.props);
    emitChange('lm:material-commit', state);
    // 永続化は pm-events 側（lm:pm-opacity-change 等）で行う想定
    // ここでは保存しない（将来 runtime.patch が無い環境をサポートするならここで persistToSheet を呼ぶ）
  }

  /**
   * UI イベントの配線（フォールバック用）
   */
  function bindUI() {
    if (!ui) ui = queryUI();

    const { materialSelect, opacityRange } = ui;

    ensureDefaultProps();

    if (!materialSelect || !opacityRange) {
      console.warn(
        LOG_PREFIX,
        'ui not ready yet, retry...',
        'UI elements not found (materialSelect/opacityRange)'
      );
      if (retryCount++ < RETRY_MAX) {
        setTimeout(bindUI, RETRY_MS);
      } else {
        console.error(LOG_PREFIX, 'ui init failed (max retries)');
      }
      return;
    }

    // 既存のリスナがあっても二重にならないように一旦 remove してから add
    materialSelect.removeEventListener('change', onControlCommit);
    materialSelect.addEventListener('change', onControlCommit, {
      passive: true,
    });

    opacityRange.removeEventListener('input', onControlInput);
    opacityRange.removeEventListener('change', onControlCommit);
    opacityRange.addEventListener('input', onControlInput, { passive: true });
    opacityRange.addEventListener('change', onControlCommit, { passive: true });

    // 初期 opacity を UI から拾って state に反映しておく
    currentOpacity = readOpacityFromRange(opacityRange);

    console.log(LOG_PREFIX, 'ui bound', {
      materialSelect: !!materialSelect,
      opacityRange: !!opacityRange,
    });

    // 初期状態を一度適用（materialKey が空なら何もしない）
    const state = collectControls();
    if (state.materialKey) {
      sessionMaterialState.set(state.materialKey, Object.assign({}, state.props));
      const applied = applyStateWithOptions(state.materialKey, state.props.opacity, {
        persist: false,
        useCache: true,
      });
      if (applied) {
        emitChange('lm:material-change', applied);
      }
    }
  }

  /**
   * シーン / ドロップダウンの準備完了後に UI を再バインドするための補助
   */
  function scheduleRebind(reason) {
    ui = null;
    retryCount = 0;
    console.log(LOG_PREFIX, 'scheduleRebind', reason);
    bindUI();
  }

  // ===== pm-* ベースのイベント駆動ライン（本命） =====

  function wirePmEvents() {
    if (pmEventsWired) return;
    pmEventsWired = true;

    window.addEventListener('lm:pm-material-selected', onPmMaterialSelected);
    window.addEventListener('lm:pm-opacity-input', onPmOpacityInput);
    window.addEventListener('lm:pm-opacity-change', onPmOpacityChange);

    console.log(LOG_PREFIX, 'pm-events wired');
  }

  function onPmMaterialSelected(e) {
    const detail = (e && e.detail) || {};
    const key = (detail.key || '').trim();
    if (!key) {
      currentMaterialKey = '';
      return;
    }
    currentMaterialKey = key;

    const applyFromCache = () => {
      const state = applyStateWithOptions(currentMaterialKey, undefined, {
        persist: false,
        useCache: true,
      });
      if (!state) return;

      console.log(LOG_PREFIX, 'pm-material-selected', detail, '=>', state);
      emitChange('lm:material-commit', state);
    };

    ensureSheetCache(currentSheetCtx)
      .then(applyFromCache)
      .catch((err) =>
        console.warn(LOG_PREFIX, 'apply after sheet load failed', err)
      );
  }

  function onPmOpacityInput(e) {
    if (!currentMaterialKey) return;
    const detail = (e && e.detail) || {};
    const v =
      typeof detail.value === 'number' && isFinite(detail.value)
        ? clamp(detail.value, 0, 1)
        : currentOpacity;

    currentOpacity = v;
    const state = applyStateWithOptions(currentMaterialKey, currentOpacity, {
      persist: false,
      useCache: true,
    });
    if (!state) return;

    console.log(
      LOG_PREFIX,
      'pm-opacity-input',
      detail,
      '=>',
      state.props.opacity
    );
    emitChange('lm:material-change', state);
  }

  function onPmOpacityChange(e) {
    if (!currentMaterialKey) return;
    const detail = (e && e.detail) || {};
    const v =
      typeof detail.value === 'number' && isFinite(detail.value)
        ? clamp(detail.value, 0, 1)
        : currentOpacity;

    currentOpacity = v;
    const state = applyStateWithOptions(currentMaterialKey, currentOpacity, {
      persist: true,
      useCache: true,
    });
    if (!state) return;

    console.log(
      LOG_PREFIX,
      'pm-opacity-change',
      detail,
      '=>',
      state.props.opacity
    );
    emitChange('lm:material-commit', state);
  }

  // ===== イベントフック =====

  window.addEventListener('lm:sheet-context', function (e) {
    const detail = (e && e.detail) || {};
    refreshSheetCache(detail);
  });

  // scene-ready や material ドロップダウン populate 後にも再バインドしておく
  window.addEventListener('lm:scene-ready', function () {
    scheduleRebind('scene-ready');
  });

  window.addEventListener('lm:mat-dd-populated', function () {
    scheduleRebind('mat-dd-populated');
  });

  function boot() {
    console.log(
      LOG_PREFIX,
      'loaded VERSION_TAG:V6_XX_MATERIAL_FIX_OPACITY_SYNC_UI'
    );
    wirePmEvents();
    if (window.__LM_SHEET_CTX) {
      refreshSheetCache(window.__LM_SHEET_CTX);
    }
    bindUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // デバッグ用フック
  window.__LM_materialOrch = {
    collectControls,
    applyToViewer,
    _bindUI: bindUI,
  };
})();
