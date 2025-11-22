// material.orchestrator.js
// LociMyu material UI orchestrator
// UI と viewer.bridge・各種保存ロジックの仲立ちを行う
// VERSION_TAG: V6_XX_MATERIAL_FIX_OPACITY_PM_EVENTS

(function () {
  const LOG_PREFIX = '[mat-orch]';
  const RETRY_MS = 250;
  const RETRY_MAX = 40;

  let ui = null;
  let retryCount = 0;

  // pm-* ベースの現在状態（単純化：まずは opacity のみ扱う）
  let currentMaterialKey = '';
  // sheetPersist 経由で復元された「マテリアル → opacity」マップ
  const materialOpacity = new Map();
  // 現在 UI 上で扱っている opacity
  let currentOpacity = 1;

  /**
   * UI 要素の取得
   */
  function queryUI() {
    const materialSelect = document.querySelector('#mat-material-select');
    const opacityRange = document.querySelector('#mat-opacity-range');

    const chkDoubleSided = document.querySelector('#mat-double-sided');
    const chkUnlitLike = document.querySelector('#mat-unlit-like');

    const chkChromaEnable = document.querySelector('#mat-chroma-enable');
    const inpChromaColor = document.querySelector('#mat-chroma-color');
    const rngChromaTolerance = document.querySelector('#mat-chroma-tolerance');
    const rngChromaFeather = document.querySelector('#mat-chroma-feather');

    const rngRoughness = document.querySelector('#mat-roughness-range');
    const rngMetalness = document.querySelector('#mat-metalness-range');
    const inpEmissiveHex = document.querySelector('#mat-emissive-hex');
    const rngEmissiveIntensity = document.querySelector(
      '#mat-emissive-intensity-range'
    );

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

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
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
   * シート永続化レイヤーへの委譲
   */
  function persistToSheet(materialKey, props) {
    try {
      const persist = window.LM_MaterialsPersist;
      if (!persist || typeof persist.upsert !== 'function') {
        console.warn(LOG_PREFIX, 'LM_MaterialsPersist not ready');
        return;
      }
      persist.upsert({
        materialKey,
        ...props,
      });
    } catch (e) {
      console.warn(LOG_PREFIX, 'persistToSheet threw', e);
    }
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

  function getSelectedMaterialKey(selectEl) {
    if (!selectEl) return '';
    const opt = selectEl.selectedOptions
      ? selectEl.selectedOptions[0]
      : selectEl.options[selectEl.selectedIndex];

    if (!opt) return '';
    // option.value を materialKey として扱う（viewer 側と一致している前提）
    return (opt.value || '').trim();
  }

  function readOpacityFromRange(rangeEl) {
    if (!rangeEl) return currentOpacity;
    const v = Number(rangeEl.value || '1');
    if (!isFinite(v)) return currentOpacity;
    return clamp(v, 0, 1);
  }

  /**
   * 現在の state を元に viewer へ apply するヘルパー
   * - opacity は currentOpacity を優先（明示 override があればそれ）
   */
  function applyState(key, opacityOverride) {
    if (!key) {
      console.warn(LOG_PREFIX, 'applyState called with empty key');
      return null;
    }

    // 優先度:
    //  1) 呼び出し元からの opacityOverride
    //  2) materialOpacity マップに保存されている値
    //  3) デフォルト値 1
    var baseOpacity;
    if (typeof opacityOverride === 'number') {
      baseOpacity = clamp(opacityOverride, 0, 1);
    } else if (materialOpacity.has(key)) {
      baseOpacity = materialOpacity.get(key);
    } else {
      baseOpacity = 1;
    }

    var newOpacity = baseOpacity;

    // 状態を更新
    materialOpacity.set(key, newOpacity);
    currentMaterialKey = key;
    currentOpacity = newOpacity;

    // UI コントロールに反映（プルダウン切り替え時など）
    try {
      if (typeof opacityRange !== 'undefined' && opacityRange) {
        opacityRange.value = String(newOpacity);
      }
    } catch (e) {
      console.warn(LOG_PREFIX, 'failed to sync opacityRange', e);
    }

    var props = { opacity: newOpacity };

    // シートへの保存はここでは行わない。
    // ドラッグ終了や明示コミット時に、呼び出し側(onPmOpacityChange 等)で persistToSheet を呼ぶ。
    applyToViewer(key, props);

    return { materialKey: key, props: props };
  }

  // ===== DOM ベースのフォールバック（旧来の oninput/onchange） =====

  function onControlInput() {
    const state = collectControls();
    if (!state.materialKey) return;

    currentMaterialKey = state.materialKey || currentMaterialKey;
    currentOpacity = typeof state.props.opacity === 'number'
      ? clamp(state.props.opacity, 0, 1)
      : currentOpacity;

    applyToViewer(state.materialKey, state.props);
    emitChange('lm:material-change', state);
  }

  function onControlCommit() {
    const state = collectControls();
    if (!state.materialKey) return;

    currentMaterialKey = state.materialKey || currentMaterialKey;
    currentOpacity = typeof state.props.opacity === 'number'
      ? clamp(state.props.opacity, 0, 1)
      : currentOpacity;

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

    if (!materialSelect || !opacityRange) {
      console.warn(
        LOG_PREFIX,
        'ui not ready yet, retry...',
        'UI elements not found (materialSelect/opacityRange)'
      );
      if (retryCount++ < RETRY_MAX) {
        setTimeout(bindUI, RETRY_MS);
      }
      return;
    }

    retryCount = 0;

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
  }

  /**
   * 再バインドを少し遅延させて行う
   */
  function scheduleRebind(reason) {
    console.log(LOG_PREFIX, 'scheduleRebind', reason);
    setTimeout(bindUI, 0);
  }

  // ===== pm-* イベントベースの経路 =====

  function wirePmEvents() {
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

    const state = applyState(currentMaterialKey);
    if (!state) return;

    console.log(LOG_PREFIX, 'pm-material-selected', detail, '=>', state);
    emitChange('lm:material-commit', state);
    // 単なる選択時は保存しない（編集が行われたタイミングで persistToSheet を呼ぶ）
  }

  function onPmOpacityInput(e) {
    if (!currentMaterialKey) return;
    const detail = (e && e.detail) || {};
    const v =
      typeof detail.value === 'number' && isFinite(detail.value)
        ? clamp(detail.value, 0, 1)
        : currentOpacity;

    currentOpacity = v;
    const state = applyState(currentMaterialKey, currentOpacity);
    if (!state) return;

    console.log(LOG_PREFIX, 'pm-opacity-input', detail, '=>', state.props.opacity);
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
    const state = applyState(currentMaterialKey, currentOpacity);
    if (!state) return;

    console.log(LOG_PREFIX, 'pm-opacity-change', detail, '=>', state.props.opacity);
    emitChange('lm:material-commit', state);
    // ドラッグ終了時（change）にだけシートへ保存する
    persistToSheet(state.materialKey, state.props);
  }

  // ===== イベントフック =====

  // scene-ready や material ドロップダウン populate 後にも再バインドしておく
  window.addEventListener('lm:scene-ready', function () {
    scheduleRebind('scene-ready');
  });

  window.addEventListener('lm:mat-dd-populated', function () {
    scheduleRebind('mat-dd-populated');
  });

  function boot() {
    console.log(LOG_PREFIX, 'loaded VERSION_TAG:V6_XX_MATERIAL_FIX_OPACITY_PM_EVENTS');
    wirePmEvents();
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
