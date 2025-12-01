// material.runtime.patch.js
// v3.7 - Chromakey runtime patch (Scene direct, no viewer-bridge race)

(function () {
  const LOG_PREFIX = '[mat-rt v3.7]';

  const log = (...args) => console.log(LOG_PREFIX, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, ...args);

  log('ready');

  /**
   * props からクロマキー関連の値を抽出し、正規化する
   */
  function resolveChromaConfig(rawProps) {
    const p = rawProps || {};
    const nested = p.chroma || {};

    const enabled =
      !!(p.chromaEnable ?? p.flagChromaEnable ?? nested.enable ?? false);

    const colorHex =
      p.chromaColor ??
      nested.color ??
      '#000000'; // デフォルトは黒キー

    const tolerance =
      p.chromaTolerance ??
      nested.tolerance ??
      0.1; // 0.0 - 1.0

    const feather =
      p.chromaFeather ??
      nested.feather ??
      0.0; // 0.0 - 1.0

    return {
      enabled,
      colorHex,
      tolerance,
      feather
    };
  }

  /**
   * "#rrggbb" → [r,g,b] (0-1)
   */
  function hexToRgb01(hex) {
    if (typeof hex !== 'string') return [0, 0, 0];
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return [0, 0, 0];
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255;
    const g = (v >> 8) & 255;
    const b = v & 255;
    return [r / 255, g / 255, b / 255];
  }

  /**
   * fragmentShader にクロマキー処理をインジェクト
   */
  function injectChromaIntoFragment(fragmentSrc) {
    if (!fragmentSrc || typeof fragmentSrc !== 'string') {
      warn('fragmentShader missing or not a string');
      return fragmentSrc;
    }

    // 二重インジェクト防止
    if (fragmentSrc.indexOf('uLmChromaEnable') !== -1) {
      return fragmentSrc;
    }

    const header = `
uniform float uLmChromaEnable;
uniform vec3  uLmChromaColor;
uniform float uLmChromaTolerance;
uniform float uLmChromaFeather;
`;

    const hook = '#include <output_fragment>';
    if (fragmentSrc.indexOf(hook) === -1) {
      warn('no <output_fragment> hook; chroma disabled for this material');
      return header + fragmentSrc;
    }

    const injection = `
${hook}
  if (uLmChromaEnable > 0.5) {
    float dist  = distance(gl_FragColor.rgb, uLmChromaColor);
    float edge0 = uLmChromaTolerance;
    float edge1 = uLmChromaTolerance + uLmChromaFeather;
    float alpha = smoothstep(edge1, edge0, dist);
    gl_FragColor.a *= alpha;
  }
`;

    return header + fragmentSrc.replace(hook, injection);
  }

  /**
   * 単一マテリアルにクロマキー情報を設定＆シェーダーパッチ
   */
  function applyChromaToMaterial(material, cfg) {
    if (!material) return;

    material.userData = material.userData || {};
    const data =
      material.userData.__lmChroma ||
      (material.userData.__lmChroma = {
        enabled: false,
        color: [0, 0, 0],
        tolerance: 0.1,
        feather: 0.0
      });

    const rgb = hexToRgb01(cfg.colorHex);
    data.enabled = !!cfg.enabled;
    data.color = rgb;
    data.tolerance = cfg.tolerance;
    data.feather = cfg.feather;

    // onBeforeCompile パッチ（初回のみ）
    if (!material.userData.__lmChromaPatched) {
      material.userData.__lmChromaPatched = true;

      material.onBeforeCompile = function (shader) {
        // uniforms の追加
        const u = shader.uniforms;
        u.uLmChromaEnable = { value: data.enabled ? 1.0 : 0.0 };

        // Three.Color を利用（material.color が Color のはず）
        let chromaColor = null;
        if (material.color && material.color.isColor) {
          chromaColor = material.color.clone();
          chromaColor.setRGB(data.color[0], data.color[1], data.color[2]);
        }

        u.uLmChromaColor = {
          value: chromaColor || { r: data.color[0], g: data.color[1], b: data.color[2] }
        };
        u.uLmChromaTolerance = { value: data.tolerance };
        u.uLmChromaFeather = { value: data.feather };

        shader.fragmentShader = injectChromaIntoFragment(shader.fragmentShader);

        // 後から更新できるように保持
        material.userData.__lmChromaShader = shader;
      };
    }

    // すでに onBeforeCompile 済みで shader があるなら uniforms を更新
    const shader = material.userData.__lmChromaShader;
    if (shader && shader.uniforms) {
      const u = shader.uniforms;
      if (u.uLmChromaEnable) u.uLmChromaEnable.value = data.enabled ? 1.0 : 0.0;
      if (u.uLmChromaTolerance) u.uLmChromaTolerance.value = data.tolerance;
      if (u.uLmChromaFeather) u.uLmChromaFeather.value = data.feather;
      if (u.uLmChromaColor && u.uLmChromaColor.value) {
        const c = u.uLmChromaColor.value;
        if (c.isColor && Array.isArray(data.color)) {
          c.setRGB(data.color[0], data.color[1], data.color[2]);
        } else {
          c.r = data.color[0];
          c.g = data.color[1];
          c.b = data.color[2];
        }
      }
    }

    // 透明系のフラグもある程度こちらで面倒を見る
    if (data.enabled) {
      material.transparent = true;
      // 完全厳密ではないが、Z-fighting/ちらつき対策として depthWrite を落とし気味にする
      material.depthWrite = false;
    }
    material.needsUpdate = true;
  }

  /**
   * グローバルに公開されるエントリポイント
   * material.orchestrator.js から呼ばれる想定
   */
  window.__lm_applyChromaForKey = function (materialKey, props) {
    const scene = window.__LM_SCENE;
    if (!scene) {
      warn('__LM_SCENE not ready; chroma skipped', { materialKey });
      return;
    }
    if (!materialKey) {
      warn('materialKey missing; chroma skipped');
      return;
    }

    const cfg = resolveChromaConfig(props);
    const debugSummary = {
      materialKey,
      enabled: cfg.enabled,
      colorHex: cfg.colorHex,
      tolerance: cfg.tolerance,
      feather: cfg.feather
    };
    log('apply chroma', debugSummary);

    let touched = 0;

    scene.traverse(obj => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        if (!mat) return;
        if (mat.name === materialKey) {
          applyChromaToMaterial(mat, cfg);
          touched++;
        }
      });
    });

    log('chroma applied to', touched, 'material(s) for key', materialKey);
  };
})();
