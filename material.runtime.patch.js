// material.runtime.patch.js
// LociMyu / Material runtime shader patch (chroma clip version)
// v3.11

(function () {
  'use strict';

  var TAG = '[mat-rt v3.11]';

  function log() {
    if (!console || !console.log) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift(TAG);
    console.log.apply(console, args);
  }

  function warn() {
    if (!console || !console.warn) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift(TAG);
    console.warn.apply(console, args);
  }

  /**
   * シェーダにクロマ用のユニフォームと処理を注入する
   *  - キー色は一旦無視し、「明度が高い部分＝白地」をクロップ対象とする
   *  - tolerance: 「どこまで白を飛ばすか」（0〜1, 高いほど広く飛ばす）
   *  - feather:   エッジのソフトさ（0〜1, 高いほどふんわり）
   */
  function patchShaderForChroma(shader) {
    // 既にパッチ済みなら二重適用を避ける
    if (shader.__lm_chroma_patched) return;

    shader.uniforms.lmChromaEnabled = { value: false };
    shader.uniforms.lmChromaTolerance = { value: 0.3 };
    shader.uniforms.lmChromaFeather = { value: 0.5 };

    // MeshStandardMaterial 系のフラグメント末尾近辺にある行
    var hook = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';

    if (shader.fragmentShader.indexOf(hook) === -1) {
      // Material の種類によってはこの行が無いケースもあるので、その場合は諦める
      warn('no hook line; chroma disabled for this material');
      return;
    }

    var injection = [
      '',
      '  // --- LociMyu chroma clip (brightness based) ---',
      '  if ( lmChromaEnabled ) {',
      '    // diffuseColor.rgb は sRGB → Linear 変換後の色想定',
      '    float lmLuma = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );',
      '',
      '    // tolerance が大きいほど「白に近い広い範囲」を飛ばす',
      '    // 例: tol=0.3 → luma が 0.7〜1.0 の領域が対象',
      '    float edge0 = 1.0 - clamp( lmChromaTolerance, 0.0, 1.0 );',
      '    float edge1 = edge0 + clamp( lmChromaFeather, 0.0, 1.0 ) * 0.25;', // feather で境界幅を調整
      '',
      '    float k = smoothstep( edge0, edge1, lmLuma );',
      '',
      '    // ほぼ完全に白地な領域は深度も含めて完全に捨てる',
      '    if ( k >= 0.999 ) {',
      '      discard;',
      '    }',
      '',
      '    // 境界部分はフェードアウトさせてジャギを抑える',
      '    diffuseColor.a *= ( 1.0 - k );',
      '  }',
      '  // --- end chroma clip ---',
      ''
    ].join('\n');

    shader.fragmentShader = shader.fragmentShader.replace(hook, injection + hook);
    shader.__lm_chroma_patched = true;
  }

  /**
   * 個々の THREE.Material に対して chroma パッチを設定
   */
  function ensureMaterialPatchedForChroma(material, state) {
    if (!material || !material.isMaterial) return;

    // 透明表現と discard の両立をさせるための基本設定
    material.transparent = true;
    material.depthWrite = true;
    material.depthTest = true;

    // onBeforeCompile はマテリアル単位で一度だけ差し込めばよい
    var originalOnBeforeCompile = material.onBeforeCompile;

    material.onBeforeCompile = function (shader) {
      if (typeof originalOnBeforeCompile === 'function') {
        originalOnBeforeCompile.call(this, shader);
      }

      patchShaderForChroma(shader);

      if (shader.uniforms.lmChromaEnabled) {
        shader.uniforms.lmChromaEnabled.value = !!state.enabled;
      }
      if (shader.uniforms.lmChromaTolerance) {
        shader.uniforms.lmChromaTolerance.value =
          typeof state.tolerance === 'number' ? state.tolerance : 0.0;
      }
      if (shader.uniforms.lmChromaFeather) {
        shader.uniforms.lmChromaFeather.value =
          typeof state.feather === 'number' ? state.feather : 0.0;
      }

      material.userData.__lm_chromaShader = shader;
    };

    // 再コンパイルを促す
    material.needsUpdate = true;
  }

  /**
   * シーン内の「指定された material.name を持つマテリアル」に対して
   * chroma 設定を適用
   */
  function applyChromaToScene(materialKey, options) {
    if (!materialKey) {
      warn('applyChromaToScene called without materialKey');
      return;
    }

    var bridge = window.__lm_viewer_bridge;
    if (!bridge || typeof bridge.getScene !== 'function') {
      warn('no viewer bridge / getScene not ready');
      return;
    }

    var scene = bridge.getScene && bridge.getScene();
    if (!scene) {
      warn('scene not ready yet');
      return;
    }

    var state = {
      enabled: !!options.enabled,
      tolerance:
        typeof options.tolerance === 'number' ? options.tolerance : 0.0,
      feather: typeof options.feather === 'number' ? options.feather : 0.0
    };

    scene.traverse(function (obj) {
      if (!obj.isMesh) return;

      var mats = obj.material;
      if (!mats) return;
      if (!Array.isArray(mats)) mats = [mats];

      for (var i = 0; i < mats.length; i++) {
        var mat = mats[i];
        if (!mat || !mat.name) continue;
        if (mat.name !== materialKey) continue;

        ensureMaterialPatchedForChroma(mat, state);

        // すでにコンパイル済みで userData に shader があれば、直接 uniform を更新
        var shader = mat.userData.__lm_chromaShader;
        if (shader) {
          if (shader.uniforms.lmChromaEnabled) {
            shader.uniforms.lmChromaEnabled.value = state.enabled;
          }
          if (shader.uniforms.lmChromaTolerance) {
            shader.uniforms.lmChromaTolerance.value = state.tolerance;
          }
          if (shader.uniforms.lmChromaFeather) {
            shader.uniforms.lmChromaFeather.value = state.feather;
          }
        }
      }
    });
  }

  /**
   * オーケストレータ側から呼ばれる公開 API
   *
   * 既存実装との互換性を考えて、いくつか名前違いのメソッド／グローバル名を
   * まとめて生やしておく。
   */
  function apiApplyChroma(opts) {
    opts = opts || {};
    log('apply chroma', opts);
    applyChromaToScene(opts.materialKey, {
      enabled: opts.enabled,
      tolerance: opts.tolerance,
      feather: opts.feather
    });
  }

  var api = {
    // メイン想定
    applyChroma: apiApplyChroma,

    // 互換用エイリアス（過去の実装で違う名前を使っていても拾えるように）
    applyChromaForKey: apiApplyChroma,
    setChroma: apiApplyChroma,
    updateChroma: apiApplyChroma
  };

  // グローバル公開名も複数用意しておく（どれかに既存コードがぶら下がっている想定）
  window.__lm_material_runtime_patch = api;
  window.__LM_MaterialRuntime = api;
  window.__LM_MaterialsRuntime = api;
  window.__LM_MaterialsRuntimePatch = api;

  log('ready');
})();
