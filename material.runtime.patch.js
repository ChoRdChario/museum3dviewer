// material.runtime.patch.js
// LociMyu material runtime patch – chroma-key, double-sided, unlit bridging
// v3.13

(function () {
  const TAG = '[mat-rt v3.13]';

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

  // シーンから materialKey に対応する THREE.Material を拾う
  function findMaterialsForKey(bridge, materialKey) {
    const mats = [];
    if (!bridge || !bridge.getScene) return mats;
    const scene = bridge.getScene();
    if (!scene || !scene.traverse) return mats;

    scene.traverse(function (obj) {
      if (!obj || !obj.isMesh) return;
      let mat = obj.material;
      if (!mat) return;
      if (Array.isArray(mat)) {
        mat.forEach(function (m) {
          if (!m) return;
          const key =
            (m.userData && (m.userData.lmMatKey || m.userData.matKey)) ||
            m.name;
          if (key === materialKey) mats.push(m);
        });
      } else {
        const key =
          (mat.userData && (mat.userData.lmMatKey || mat.userData.matKey)) ||
          mat.name;
        if (key === materialKey) mats.push(mat);
      }
    });

    return mats;
  }

  function ensureChromaUniforms(material) {
    material.userData = material.userData || {};
    if (material.userData.__lmChromaUniforms) {
      return material.userData.__lmChromaUniforms;
    }

    const uniforms = {
      uLmChromaEnabled: { value: 0 },
      uLmChromaColor: { value: { x: 1, y: 1, z: 1 } },
      uLmChromaTolerance: { value: 0.0 },
      uLmChromaFeather: { value: 0.0 },
    };

    const origOnBeforeCompile = material.onBeforeCompile || null;
    material.onBeforeCompile = function (shader) {
      // 既存 onBeforeCompile を尊重
      if (origOnBeforeCompile) {
        try {
          origOnBeforeCompile.call(this, shader);
        } catch (e) {
          warn('orig onBeforeCompile error', e);
        }
      }

      // ユニフォームを注入
      shader.uniforms.uLmChromaEnabled =
        shader.uniforms.uLmChromaEnabled || uniforms.uLmChromaEnabled;
      shader.uniforms.uLmChromaColor =
        shader.uniforms.uLmChromaColor || uniforms.uLmChromaColor;
      shader.uniforms.uLmChromaTolerance =
        shader.uniforms.uLmChromaTolerance || uniforms.uLmChromaTolerance;
      shader.uniforms.uLmChromaFeather =
        shader.uniforms.uLmChromaFeather || uniforms.uLmChromaFeather;

      // フラグ
      shader.defines = shader.defines || {};
      shader.defines.LM_USE_CHROMA_KEY = 1;

      // map サンプリング部分を書き換え
      const hook =
        '#ifdef USE_MAP\n' +
        '\tvec4 texelColor = texture2D( map, vUv );';

      if (shader.fragmentShader.indexOf(hook) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(
          hook,
          [
            '#ifdef USE_MAP',
            '\tvec4 texelColor = texture2D( map, vUv );',
            '\t#ifdef LM_USE_CHROMA_KEY',
            '\t\tvec3 lmSample = texelColor.rgb;',
            '\t\tfloat lmDist = distance(lmSample, uLmChromaColor);',
            '\t\tfloat lmEdgeLo = max(uLmChromaTolerance - uLmChromaFeather, 0.0);',
            '\t\tfloat lmEdgeHi = min(uLmChromaTolerance + uLmChromaFeather, 1.732);',
            '\t\tfloat lmAlpha = smoothstep(lmEdgeLo, lmEdgeHi, lmDist);',
            '\t\tif (uLmChromaEnabled > 0.5 && lmAlpha < 0.0001) discard;',
            '\t#endif',
          ].join('\n')
        );
      } else {
        // フォールバック：map 周りにフックが見つからない場合もある
        warn('map hook not found; chroma may not work for this material');
      }
    };

    material.userData.__lmChromaUniforms = uniforms;
    return uniforms;
  }

  function applyChromaToMaterials(bridge, materialKey, cfg) {
    const mats = findMaterialsForKey(bridge, materialKey);
    if (!mats.length) {
      log('no materials found for key', materialKey);
      return;
    }

    const rgb = hexToRGB(cfg.colorHex);
    mats.forEach(function (mat) {
      const uniforms = ensureChromaUniforms(mat);
      uniforms.uLmChromaEnabled.value = cfg.enabled ? 1 : 0;
      uniforms.uLmChromaColor.value.x = rgb.r;
      uniforms.uLmChromaColor.value.y = rgb.g;
      uniforms.uLmChromaColor.value.z = rgb.b;
      uniforms.uLmChromaTolerance.value = clamp01(cfg.tolerance);
      uniforms.uLmChromaFeather.value = clamp01(cfg.feather);
      mat.needsUpdate = true;
    });

    log('applied chroma to', materialKey, 'mats=', mats.length, cfg);
  }

  // applyMaterialProps をフックして、クロマ設定を反映
  function handleApplyMaterialProps(bridge, materialKey, props) {
    const prev = chromaByKey.get(materialKey);
    const cfg = normalizeChromaFromProps(prev, props);
    chromaByKey.set(materialKey, cfg);
    log('set chroma config', materialKey, cfg);
    applyChromaToMaterials(bridge, materialKey, cfg);
  }

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
      // 先に元の処理（不透明度・ダブルサイドなど）を実行
      origApply(materialKey, props);
      try {
        handleApplyMaterialProps(bridge, materialKey, props || {});
      } catch (e) {
        warn('applyMaterialProps chroma error', e);
      }
    };

    bridge.__lmChromaPatched = true;
    log('patched viewer bridge.applyMaterialProps');
    return true;
  }

  function boot() {
    log('ready');

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
