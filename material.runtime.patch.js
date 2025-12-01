// material.runtime.patch.js
// v3.9 – chroma key with clip (discard)
//
// ・クロマキー対象画素は gl_FragColor を書き換えた直後に discard する方式
// ・奥のメッシュまで完全に抜けて見える
// ・tolerance / feather で「どこまで近い色を切るか」「どれくらいなだらかに切るか」を調整
// ・window.__lm_viewer_bridge.getScene() を前提に、material.name === materialKey で対象マテリアルを特定

(function (global) {
  const LOG_TAG = '[mat-rt v3.9]';

  function log () {
    console.log.apply(console, [LOG_TAG, ...arguments]);
  }

  function warn () {
    console.warn.apply(console, [LOG_TAG, ...arguments]);
  }

  // "#rrggbb" → 0.0〜1.0 の RGB
  function hexToRgb01 (hex) {
    if (!hex) hex = '#ffffff';
    if (hex.charAt(0) === '#') hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(function (c) { return c + c; }).join('');
    }
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return { r, g, b };
  }

  // シーンを取得
  function getScene () {
    const br = global.__lm_viewer_bridge || global.__lm_viewer_bridge_autobind || global.__lm_viewer;
    if (br && typeof br.getScene === 'function') {
      return br.getScene();
    }
    if (global.scene && typeof global.scene.traverse === 'function') {
      return global.scene;
    }
    return null;
  }

  // material.name === materialKey なマテリアルを列挙
  function collectMaterialsByKey (materialKey) {
    const scene = getScene();
    if (!scene) {
      warn('no scene found; chroma skipped');
      return [];
    }
    const found = [];
    scene.traverse(function (obj) {
      if (!obj.material) return;

      if (Array.isArray(obj.material)) {
        obj.material.forEach(function (m) {
          if (m && m.name === materialKey && found.indexOf(m) === -1) {
            found.push(m);
          }
        });
      } else {
        const m = obj.material;
        if (m && m.name === materialKey && found.indexOf(m) === -1) {
          found.push(m);
        }
      }
    });
    return found;
  }

  // クリッピング用の GLSL チャンクを生成
  function buildClipChunk (params) {
    const rgb = hexToRgb01(params.colorHex || '#ffffff');

    // tolerance: 0〜1 を 0.01〜0.4 くらいの距離にマップ
    const tol = typeof params.tolerance === 'number' ? params.tolerance : 0.15;
    const hard = 0.01 + tol * 0.35;

    // feather: 0〜1 → ソフトエッジ幅 0.0〜0.1 くらい
    const feather = typeof params.feather === 'number' ? params.feather : 0.5;
    const soft = hard + (0.02 + feather * 0.08);

    return `
      // === LociMyu chroma clip ===
      vec3 lmKeyColor = vec3(${rgb.r.toFixed(6)}, ${rgb.g.toFixed(6)}, ${rgb.b.toFixed(6)});
      float lmChromaDist = distance(gl_FragColor.rgb, lmKeyColor);
      float lmHard = ${hard.toFixed(6)};
      float lmSoft = ${soft.toFixed(6)};

      // lmMask: 1.0 = 保持 / 0.0 = 完全にカット
      float lmMask = smoothstep(lmSoft, lmHard, lmChromaDist);

      // ほぼキー色 → 完全 discard して奥のメッシュを表示
      if (lmMask <= 0.0) {
        discard;
      }

      // エッジ付近だけ少し残したい場合のために α にも反映
      gl_FragColor.a *= lmMask;
      // === /LociMyu chroma clip ===
    `;
  }

  // 個々のマテリアルに対して onBeforeCompile でフラグメントを書き換える
  function applyClipToMaterial (material, params) {
    material.userData = material.userData || {};
    material.userData.__lm_chromaClipParams = params;

    // off のときはフック解除だけして終わり
    if (!params.enabled) {
      if (material.__lm_hasChromaClip) {
        material.onBeforeCompile = function (shader) {
          // 何もしなければ three.js デフォルトのシェーダが使われる
          return;
        };
        material.__lm_hasChromaClip = false;
        material.needsUpdate = true;
      }
      return;
    }

    const chunk = buildClipChunk(params);

    material.onBeforeCompile = function (shader) {
      const src = shader.fragmentShader;
      // もっとも安定して存在する行にフックする
      // PBR マテリアルならだいたいこの行がある
      const anchor = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
      const idx = src.indexOf(anchor);

      if (idx === -1) {
        warn('no gl_FragColor hook; chroma disabled for this material (', material.name, ')');
        return;
      }

      const injected =
        src.slice(0, idx) +
        chunk + '\n' +
        src.slice(idx);

      shader.fragmentShader = injected;
    };

    material.__lm_hasChromaClip = true;
    material.needsUpdate = true;
  }

  // orchestrator から呼ばれるエントリポイント
  function applyChroma (params) {
    // 既存コードとの互換性: materialKey / key どちらでも受ける
    const key = params.materialKey || params.key;
    if (!key) {
      warn('applyChroma called without materialKey');
      return;
    }

    log('apply chroma', params);

    const materials = collectMaterialsByKey(key);
    materials.forEach(function (m) {
      applyClipToMaterial(m, params);
    });

    log('chroma applied to', materials.length, 'material(s) for key', key);
  }

  // 公開 API
  const api = {
    applyChroma: applyChroma
  };

  // 既存のどの呼び名でも拾えるように同じオブジェクトを複数名で公開しておく
  global.__lm_materialRuntime = api;
  global.__LM_MATERIAL_RUNTIME = api;
  global.__LM_MATERIALS_RUNTIME = api;
  global.__LM_MATERIAL_CHROMA = api;
  global.__lm_applyChroma = applyChroma;

  log('ready');

})(window);
