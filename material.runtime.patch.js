// material.runtime.patch.js
// LociMyu material runtime patch – chroma-key config bridge only
// v3.14  (A案: viewer.module にシェーダフックを一本化)

(function () {
  const TAG = '[mat-rt v3.14]';

  function log() {
    console.log.apply(console, [TAG, ...arguments]);
  }
  function warn() {
    console.warn.apply(console, [TAG, ...arguments]);
  }

  // デフォルト設定（シート未保存時など）
  const DEFAULT_CHROMA = {
    enabled: false,
    colorHex: '#ffffff',
    tolerance: 0.75,
    feather: 1.0,
  };

  // materialKey ごとの設定キャッシュ
  //   key: materialKey (例: 'texture.002')
  //   value: { enabled, colorHex, tolerance, feather }
  const chromaByKey = new Map();

  // 0–1 クランプ
  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  // #rrggbb → {r,g,b} (0–1)
  function hexToRGB(hex) {
    if (!hex || typeof hex !== 'string') return { r: 1, g: 1, b: 1 };
    let h = hex.trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6) return { r: 1, g: 1, b: 1 };
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return { r, g, b };
  }

  // applyMaterialProps から来る props からクロマ設定を吸い上げる
  //   - props.chromaEnable / chromaColor / chromaTolerance / chromaFeather
  //   - props.chroma.{enabled,colorHex,tolerance,feather}
  // など、複数の表現に対応
  function normalizeChromaFromProps(prevCfg, props) {
    const cfg = Object.assign({}, DEFAULT_CHROMA, prevCfg || {});
    if (!props || typeof props !== 'object') return cfg;

    const root = props;
    const nested = root.chroma || root.chromaKey || null;
    const sources = [root, nested];

    let enabled = null;
    let colorHex = null;
    let tol = null;
    let feather = null;

    for (const src of sources) {
      if (!src) continue;

      // enabled 系（いずれか最初に見つかったものを採用）
      if (enabled === null) {
        if (typeof src.enabled === 'boolean') {
          enabled = src.enabled;
        } else if (typeof src.chromaEnabled === 'boolean') {
          enabled = src.chromaEnabled;
        } else if (typeof src.chromaEnable === 'boolean') {
          enabled = src.chromaEnable;
        } else if (src.chroma && typeof src.chroma.enabled === 'boolean') {
          enabled = src.chroma.enabled;
        }
      }

      // color
      if (colorHex === null) {
        if (typeof src.colorHex === 'string') {
          colorHex = src.colorHex;
        } else if (typeof src.chromaColor === 'string') {
          colorHex = src.chromaColor;
        } else if (src.chroma && typeof src.chroma.colorHex === 'string') {
          colorHex = src.chroma.colorHex;
        }
      }

      // tolerance
      if (tol === null) {
        if (typeof src.tolerance === 'number') {
          tol = src.tolerance;
        } else if (typeof src.chromaTolerance === 'number') {
          tol = src.chromaTolerance;
        } else if (src.chroma && typeof src.chroma.tolerance === 'number') {
          tol = src.chroma.tolerance;
        }
      }

      // feather
      if (feather === null) {
        if (typeof src.feather === 'number') {
          feather = src.feather;
        } else if (typeof src.chromaFeather === 'number') {
          feather = src.chromaFeather;
        } else if (src.chroma && typeof src.chroma.feather === 'number') {
          feather = src.chroma.feather;
        }
      }
    }

    if (enabled !== null) cfg.enabled = !!enabled;
    if (colorHex !== null) cfg.colorHex = colorHex;
    if (tol !== null && isFinite(tol)) cfg.tolerance = clamp01(tol);
    if (feather !== null && isFinite(feather)) cfg.feather = clamp01(feather);

    return cfg;
  }

  // ---------------------------------------------------------------------------
  //  viewer.applyMaterialProps の後ろにぶら下がって、
  //  「いまどのマテリアルにどんなクロマ設定が乗っているか」を記録するだけの処理。
  //  シェーダ(onBeforeCompile)には一切介入しない。
  // ---------------------------------------------------------------------------
  function handleApplyMaterialProps(bridge, materialKey, props) {
    if (!materialKey) return;
    const prev = chromaByKey.get(materialKey);
    const cfg = normalizeChromaFromProps(prev, props || {});
    chromaByKey.set(materialKey, cfg);
    log('set chroma config', materialKey, cfg);
  }

  // ---------------------------------------------------------------------------
  //  viewer bridge の applyMaterialProps をパッチ
  //   - 元の処理（viewer.module 側）を先に実行
  //   - そのあと handleApplyMaterialProps でキャッシュ更新のみ行う
  // ---------------------------------------------------------------------------
  function patchViewerBridgeOnce() {
    const bridge = window.__lm_viewer_bridge;
    if (!bridge) return false;
    if (bridge.__lmChromaPatched) return true;

    const origApply =
      (bridge.applyMaterialProps && bridge.applyMaterialProps.bind(bridge)) ||
      null;
    if (!origApply) {
      warn('viewer bridge has no applyMaterialProps');
      return false;
    }

    bridge.applyMaterialProps = function (materialKey, props) {
      // 先に元の処理（不透明度・ダブルサイド・シェーダ uniform 更新など）を実行
      origApply(materialKey, props);
      try {
        handleApplyMaterialProps(bridge, materialKey, props || {});
      } catch (e) {
        warn('applyMaterialProps chroma cache error', e);
      }
    };

    bridge.__lmChromaPatched = true;
    log('patched viewer bridge.applyMaterialProps (cache only)');
    return true;
  }

  // ---------------------------------------------------------------------------
  //  material.orchestrator.js から呼ばれるエントリ:
  //    window.__lm_applyChromaForKey(materialKey, props)
  //
  //  ここでもシェーダには触らず、
  //   - chromaByKey キャッシュ更新
  //   - viewer.applyMaterialProps() を使って viewer.module 側に値を渡す
  //  だけを行う。
  // ---------------------------------------------------------------------------
  function applyChromaForKey(materialKey, props) {
    if (!materialKey) return;

    const bridge = window.__lm_viewer_bridge;
    if (!bridge || typeof bridge.applyMaterialProps !== 'function') {
      warn('applyChromaForKey: viewer bridge missing');
      return;
    }

    const prev = chromaByKey.get(materialKey);
    const cfg = normalizeChromaFromProps(prev, props || {});
    chromaByKey.set(materialKey, cfg);

    // viewer.module 側の applyMaterialProps が理解できる形に整形
    const viewerProps = {
      chromaEnable: cfg.enabled,
      chromaColor: cfg.colorHex,
      chromaTolerance: cfg.tolerance,
      chromaFeather: cfg.feather,
    };

    try {
      bridge.applyMaterialProps(materialKey, viewerProps);
      log('applyChromaForKey -> viewer', materialKey, viewerProps);
    } catch (e) {
      warn('applyChromaForKey error', e);
    }
  }

  // グローバル公開（material.orchestrator.js から呼ばれる）
  window.__lm_applyChromaForKey = applyChromaForKey;

  // ---------------------------------------------------------------------------
  //  Boot
  // ---------------------------------------------------------------------------
  function boot() {
    log('ready (config bridge only)');

    // ポーリングで viewer bridge を待つ（既に在れば即パッチ）
    let tries = 0;
    const maxTries = 200; // 200 * 150ms ≒ 30秒
    const timer = setInterval(function () {
      if (patchViewerBridgeOnce()) {
        clearInterval(timer);
        return;
      }
      if (++tries >= maxTries) {
        clearInterval(timer);
        warn('viewer bridge not found (timeout)');
      }
    }, 150);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
  }
})();
