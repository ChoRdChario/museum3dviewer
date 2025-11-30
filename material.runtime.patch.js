(function () {
  const LOG_PREFIX = '[mat-rt v3.5]';

  console.log(LOG_PREFIX, 'ready');

  function installChromaPatch() {
    const bridge = window.__lm_viewer_bridge;
    const THREE = window.THREE;

    if (!bridge) {
      console.warn(LOG_PREFIX, 'viewer bridge not found');
      return;
    }
    if (bridge.__lm_chroma_patched) {
      return;
    }
    if (typeof bridge.applyMaterialProps !== 'function' ||
        typeof bridge.getScene !== 'function') {
      console.warn(LOG_PREFIX, 'viewer bridge missing methods');
    }

    bridge.__lm_chroma_patched = true;

    /**
     * 対象マテリアルに chroma 用の uniform とシェーダーパッチを入れる
     */
    function ensureChromaOnMaterial(mat) {
      if (!mat || mat.userData.__lmChromaReady || !THREE) return;

      const prevOnBeforeCompile = mat.onBeforeCompile;

      mat.onBeforeCompile = function (shader) {
        if (typeof prevOnBeforeCompile === 'function') {
          try {
            prevOnBeforeCompile(shader);
          } catch (e) {
            console.warn(LOG_PREFIX, 'prev onBeforeCompile error', e);
          }
        }

        // chroma 用 uniform
        shader.uniforms.lmChromaEnabled   = { value: 0.0 };
        shader.uniforms.lmChromaKeyColor  = { value: new THREE.Color(0xffffff) };
        shader.uniforms.lmChromaTolerance = { value: 0.0 };
        shader.uniforms.lmChromaFeather   = { value: 0.0 };

        mat.userData.__lmChromaUniforms = {
          enabled:   shader.uniforms.lmChromaEnabled,
          color:     shader.uniforms.lmChromaKeyColor,
          tolerance: shader.uniforms.lmChromaTolerance,
          feather:   shader.uniforms.lmChromaFeather
        };

        // フラグメントシェーダの先頭に uniform 宣言を追加し、
        // dithering の直前で α をクロマキー処理
        shader.fragmentShader =
          [
            'uniform float lmChromaEnabled;',
            'uniform vec3  lmChromaKeyColor;',
            'uniform float lmChromaTolerance;',
            'uniform float lmChromaFeather;',
            ''
          ].join('\n') +
          shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            [
              '#include <dithering_fragment>',
              '  if (lmChromaEnabled > 0.5) {',
              '    float dist  = length(gl_FragColor.rgb - lmChromaKeyColor);',
              '    float edge0 = max(lmChromaTolerance - lmChromaFeather, 0.0);',
              '    float edge1 = lmChromaTolerance + lmChromaFeather;',
              '    float mask  = smoothstep(edge0, edge1, dist);',
              '    gl_FragColor.a *= mask;',
              '  }'
            ].join('\n')
          );
      };

      mat.needsUpdate = true;
      mat.userData.__lmChromaReady = true;
    }

    /**
     * applyMaterialProps 呼び出しごとに chroma 用 uniform を更新
     */
    function applyChromaFor(materialKey, props) {
      if (!materialKey || !props) return;

      const scene = typeof bridge.getScene === 'function'
        ? bridge.getScene()
        : null;
      if (!scene) return;

      // props 名の違いにはある程度寛容にする
      const enabled =
        !!(props.chromaEnable ??
           props.chromaEnabled ??
           props.chroma_enable ??
           props.chroma_flag);

      let keyColor =
        props.chromaColor ??
        props.chroma_color ??
        '#ffffff';

      let tol = Number(
        props.chromaTolerance ??
        props.chroma_tolerance ??
        props.chromaTol ??
        0
      );
      let feather = Number(
        props.chromaFeather ??
        props.chroma_feather ??
        props.chromaFeathering ??
        0
      );

      // clamp
      tol = Math.max(0, Math.min(1, isFinite(tol) ? tol : 0));
      feather = Math.max(0, Math.min(1, isFinite(feather) ? feather : 0));

      // 色のパース（#ffffff / "255,255,255" 両対応）
      let r = 1, g = 1, b = 1;
      if (typeof keyColor === 'string') {
        const s = keyColor.trim();
        if (s[0] === '#' && THREE) {
          const c = new THREE.Color(s);
          r = c.r; g = c.g; b = c.b;
        } else {
          const parts = s.split(',');
          if (parts.length === 3) {
            let pr = parseFloat(parts[0]);
            let pg = parseFloat(parts[1]);
            let pb = parseFloat(parts[2]);
            if (!isFinite(pr)) pr = 255;
            if (!isFinite(pg)) pg = 255;
            if (!isFinite(pb)) pb = 255;
            if (pr > 1 || pg > 1 || pb > 1) {
              r = pr / 255;
              g = pg / 255;
              b = pb / 255;
            } else {
              r = pr;
              g = pg;
              b = pb;
            }
          }
        }
      }

      scene.traverse(function (obj) {
        if (!obj.isMesh || !obj.material) return;

        const mats = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];

        for (let i = 0; i < mats.length; i++) {
          const mat = mats[i];
          if (!mat || mat.name !== materialKey) continue;

          ensureChromaOnMaterial(mat);

          const uniforms = mat.userData.__lmChromaUniforms;
          if (!uniforms) continue;

          uniforms.enabled.value = enabled ? 1.0 : 0.0;
          if (uniforms.color && uniforms.color.value && THREE) {
            uniforms.color.value.setRGB(r, g, b);
          }
          uniforms.tolerance.value = tol;
          uniforms.feather.value   = feather;

          mat.needsUpdate = true;
        }
      });
    }

    const origApply = bridge.applyMaterialProps
      ? bridge.applyMaterialProps.bind(bridge)
      : null;

    if (origApply) {
      bridge.applyMaterialProps = function (materialKey, props) {
        const result = origApply(materialKey, props);
        try {
          applyChromaFor(materialKey, props);
        } catch (e) {
          console.warn(LOG_PREFIX, 'apply chroma error', e);
        }
        return result;
      };

      console.log(LOG_PREFIX, 'patched viewer bridge for chroma key');
    }
  }

  // viewer.bridge が生えてくるのを待つ
  let tries = 0;
  const maxTries = 60;
  const interval = setInterval(function () {
    tries++;
    if (window.__lm_viewer_bridge) {
      clearInterval(interval);
      try {
        installChromaPatch();
      } catch (e) {
        console.warn(LOG_PREFIX, 'install patch error', e);
      }
    } else if (tries >= maxTries) {
      clearInterval(interval);
      console.warn(LOG_PREFIX, 'viewer bridge not found (timeout)');
    }
  }, 500);
})();
