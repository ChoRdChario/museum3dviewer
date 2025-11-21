// material.orchestrator.js
// LociMyu material UI orchestrator (rebuild)
// UI と viewer.bridge・各種保存ロジックの仲立ちを行う
// VERSION_TAG: V6_XX_MATERIAL_FIX_OPACITY

(function () {
  const LOG_PREFIX = '[mat-orch]';
  const RETRY_MS = 250;
  const RETRY_MAX = 40;

  let ui = null;
  let retryCount = 0;

  /**
   * DOM から UI 要素を取得
   */
  function queryUI() {
    const materialSelect = document.getElementById('materialSelect');
    const opacityRange = document.getElementById('opacityRange');

    // 他のコントロールは存在すれば拾う（無ければ undefined のまま）
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
   * - data-material-key
   * - value
   * - textContent
   * の順で見る
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
   * 0〜1 の opacity を range から読む
   * - range の min/max が 0〜1 or 0〜100 のどちらでも動くようにする
   */
  function readOpacityFromRange(range) {
    if (!range) return 1;

    const raw = Number(range.value);
    if (Number.isNaN(raw)) return 1;

    const min = Number(range.min || '0');
    const max = Number(range.max || '1');

    if (max <= 1.0000001) {
      // 0〜1 スライダ
      return clamp(raw, 0, 1);
    } else {
      // 0〜100 等 -> 0〜1 に正規化
      const norm = raw / max;
      return clamp(norm, 0, 1);
    }
  }

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  /**
   * 現在の UI 状態を 1 つのオブジェクトにまとめる
   * - materialKey
   * - props (viewer.applyMaterialProps に渡す)
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
      doubleSide: doubleSided,
      unlit: unlitLike,
      chromaEnable,
      chromaColor,
      chromaTolerance,
      chromaFeather,
      roughness,
      metalness,
      emissiveHex,
      emissiveIntensity,
    };

    // デバッグ用にグローバルへも出しておく
    window.__LM_materialControls = {
      materialKey: key,
      props,
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
   * UI の input/change イベントハンドラ
   * - input: viewer へ即反映 + lm:material-change
   * - change: viewer へ反映 + lm:material-commit（保存トリガ）
   */
  function onControlInput() {
    const state = collectControls();
    if (!state.materialKey) return;

    applyToViewer(state.materialKey, state.props);
    emitChange('lm:material-change', state);
  }

  function onControlCommit() {
    const state = collectControls();
    if (!state.materialKey) return;

    applyToViewer(state.materialKey, state.props);
    emitChange('lm:material-commit', state);
  }

  /**
   * UI イベントの配線
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

    // 他のコントロールもあればまとめて change で commit 扱い
    const commitTargets = [
      ui.chkDoubleSided,
      ui.chkUnlitLike,
      ui.chkChromaEnable,
      ui.inpChromaColor,
      ui.rngChromaTolerance,
      ui.rngChromaFeather,
      ui.rngRoughness,
      ui.rngMetalness,
      ui.inpEmissiveHex,
      ui.rngEmissiveIntensity,
    ].filter(Boolean);

    commitTargets.forEach((el) => {
      el.removeEventListener('change', onControlCommit);
      el.addEventListener('change', onControlCommit, { passive: true });
    });

    console.log(LOG_PREFIX, 'ui bound', {
      materialSelect: !!materialSelect,
      opacityRange: !!opacityRange,
    });

    // 初期状態を一度適用
    const state = collectControls();
    if (state.materialKey) {
      applyToViewer(state.materialKey, state.props);
      emitChange('lm:material-change', state);
    }
  }

  function boot() {
    console.log(LOG_PREFIX, 'loaded VERSION_TAG:V6_XX_MATERIAL_FIX_OPACITY');
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
