// material.runtime.patch.js
// LociMyu runtime patch for chroma key on viewer materials
// v3.6

(function () {
  const LOG_PREFIX = '[mat-rt v3.6]';

  console.log(LOG_PREFIX, 'ready');

  /**
   * props に入ってくるクロマキー関連の値を「いい感じ」に正規化する
   */
  function normalizeChromaProps(rawProps) {
    const props = rawProps || {};

    const enabled =
      !!(props.chromaEnabled ??
        props.chromaEnable ??
        props.ChromaEnable ??
        props.chroma);

    const colorRaw =
      props.chromaColor ??
      props.ChromaColor ??
      props.chroma_color ??
      '#ffffff';

    const tolRaw =
      props.chromaTolerance ??
      props.ChromaTolerance ??
      props.chroma_tol ??
      0;

    const featherRaw =
      props.chromaFeather ??
      props.ChromaFeather ??
      props.chroma_feather ??
      0;

    function normalizeFloat(v, def) {
      if (v === undefined || v === null || v === '') return def;
      const n = Number(v);
      if (!isFinite(n)) return def;
      if (n < 0) return 0;
      // 0–255 を想定した値なら 255 で割る
      if (n > 1.0) return n / 255.0;
      return n;
    }

    const tolerance = normalizeFloat(tolRaw, 0.0);
    const feather = normalizeFloat(featherRaw, 0.0);

    return {
      enabled,
      colorRaw,
      tolerance,
      feather
    };
  }

  /**
   * シーン内から materialKey に該当する THREE.Material を列挙
   */
  function findMaterialsByKey(bridge, materialKey) {
    const scene =
      (bridge && typeof bridge.getScene === 'function' && bridge.getScene()) ||
      window.__LM_SCENE;

    const result = [];
    if (!scene) return result;

    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      const mats = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      mats.forEach(m => {
        if (!m) return;
        if (
          m.name === materialKey ||
          (m.userData && m.userData.__lmMaterialKey === materialKey)
        ) {
          result.push(m);
        }
      });
    });

    return result;
  }

  /**
   * 1 度だけ shader にクロマキー用のコードを差し込む
   */
  function ensureChromaPatched(mat, THREE) {
    if (!mat) return;
    mat.userData = mat.userData || {};

    if (mat.userData.__lmChromaPatched) return;

    const originalOnBeforeCompile = mat.onBeforeCompile;

    mat.onBeforeCompile = function (shader) {
      if (typeof originalOnBeforeCompile === 'function') {
        originalOnBeforeCompile.call(this, shader);
      }

      shader.uniforms.lmChromaEnable = { value: 0.0 };
      shader.uniforms.lmChromaColor = { value: new THREE.Color(1, 1, 1) };
      shader.uniforms.lmChromaTolerance = { value: 0.05 };
      shader.uniforms.lmChromaFeather = { value: 0.02 };

      // MeshStandardMaterial 想定: alpha 決定直前の行を書き換える
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
        `
          // ---- LociMyu chroma key begin ----
          vec4 lmSample;
          #ifdef USE_MAP
            lmSample = texture2D( map, vUv );
          #else
            lmSample = vec4( diffuseColor.rgb, diffuseColor.a );
          #endif

          float lmMask = 1.0;

          if (lmChromaEnable > 0.5) {
            vec3 diff = lmSample.rgb - lmChromaColor;
            float dist = length(diff);

            float tol = max(lmChromaTolerance, 0.0001);
            float feather = max(lmChromaFeather, 0.0);
            float inner = max(tol - feather, 0.0);

            if (dist <= inner) {
              lmMask = 0.0;
            } else if (dist < tol) {
              float denom = max(feather, 0.0001);
              lmMask = (dist - inner) / denom;
            }
          }

          float lmAlpha = diffuseColor.a * lmMask;
          gl_FragColor = vec4( outgoingLight, lmAlpha );
          // ---- LociMyu chroma key end ----
        `
      );

      mat.userData.__lmChromaShader = shader;
    };

    mat.userData.__lmChromaPatched = true;
    mat.needsUpdate = true;
  }

  /**
   * 上で差し込んだ uniform に対して値を流し込む
   */
  function updateChromaUniforms(mat, THREE, chroma) {
    if (!mat || !mat.userData) return;
    const shader = mat.userData.__lmChromaShader;
    if (!shader || !shader.uniforms) return;

    const uniforms = shader.uniforms;

    uniforms.lmChromaEnable.value = chroma.enabled ? 1.0 : 0.0;

    // カラー
    try {
      if (typeof chroma.colorRaw === 'string') {
        uniforms.lmChromaColor.value.set(chroma.colorRaw);
      } else if (Array.isArray(chroma.colorRaw)) {
        const r = chroma.colorRaw[0] > 1 ? chroma.colorRaw[0] / 255 : chroma.colorRaw[0];
        const g = chroma.colorRaw[1] > 1 ? chroma.colorRaw[1] / 255 : chroma.colorRaw[1];
        const b = chroma.colorRaw[2] > 1 ? chroma.colorRaw[2] / 255 : chroma.colorRaw[2];
        uniforms.lmChromaColor.value.setRGB(r, g, b);
      }
    } catch (e) {
      console.warn(LOG_PREFIX, 'chroma color parse error', e);
    }

    uniforms.lmChromaTolerance.value = chroma.tolerance;
    uniforms.lmChromaFeather.value = chroma.feather;
  }

  /**
   * applyMaterialProps をラップして、標準の適用後に
   * クロマキー用の shader patch + uniform 更新を行う
   */
  function installPatch() {
    const bridge = window.__lm_viewer_bridge;
    const THREE = window.__THREE__ || window.THREE;

    if (!bridge || typeof bridge.applyMaterialProps !== 'function') {
      return false;
    }
    if (!THREE) {
      console.warn(LOG_PREFIX, 'THREE not found; abort chroma patch');
      return false;
    }
    if (bridge.__lmChromaPatched) {
      return true;
    }

    const originalApply = bridge.applyMaterialProps.bind(bridge);

    bridge.applyMaterialProps = function (materialKey, props) {
      // まず元の処理をそのまま実行（不透明度・Unlit・DoubleSided など）
      const result = originalApply(materialKey, props);

      try {
        const chroma = normalizeChromaProps(props);
        const mats = findMaterialsByKey(bridge, materialKey);

        mats.forEach(mat => {
          // shader patch を 1 度だけ実施
          ensureChromaPatched(mat, THREE);
          // uniform を毎回更新
          updateChromaUniforms(mat, THREE, chroma);

          // 透明マテリアルの基本設定を軽く調整（過度な干渉は避ける）
          const hasOpacity =
            (props && props.opacity !== undefined && Number(props.opacity) < 1.0) ||
            chroma.enabled;

          if (hasOpacity) {
            mat.transparent = true;
            // depthWrite を false にすることで、完全に裏側が消えるケースを多少緩和
            mat.depthWrite = false;
          }
        });
      } catch (e) {
        console.warn(LOG_PREFIX, 'apply chroma failed', e);
      }

      return result;
    };

    // orchestrator から直接叩きたい場合向けのフック（既に使っているならそのまま動く）
    window.__lm_applyChromaForKey = function (materialKey, props) {
      const chroma = normalizeChromaProps(props);
      const mats = findMaterialsByKey(bridge, materialKey);
      mats.forEach(mat => {
        ensureChromaPatched(mat, THREE);
        updateChromaUniforms(mat, THREE, chroma);
      });
    };

    bridge.__lmChromaPatched = true;

    console.log(LOG_PREFIX, 'patched viewer bridge for chroma key');
    return true;
  }

  // __lm_viewer_bridge が立ち上がるまでポーリング
  (function waitAndInstall() {
    if (installPatch()) return;

    let tries = 0;
    const maxTries = 50;
    const timer = setInterval(() => {
      if (installPatch()) {
        clearInterval(timer);
        return;
      }
      tries++;
      if (tries >= maxTries) {
        clearInterval(timer);
        console.warn(LOG_PREFIX, 'gave up patching viewer bridge');
      }
    }, 200);
  })();
})();
