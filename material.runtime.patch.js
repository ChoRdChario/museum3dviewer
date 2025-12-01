// material.runtime.patch.js
// v3.10 – chroma key with clip (discard) + compatibility wrapper
//
// ・クロマキー対象画素は discard で完全に抜く（奥のメッシュが見える）
// ・tolerance / feather で距離とソフトエッジ幅を調整
// ・オーケストレータからの呼び出し形式が違っても受け止められるよう、
//   applyChroma / applyChromaKey / chromaKey など複数の名前に対応

(function (global) {
  const LOG_TAG = '[mat-rt v3.10]';

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
    const br =
      global.__lm_viewer_bridge ||
      global.__lm_viewer_bridge_autobind ||
      global.__lm_viewer;

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
      warn('no scene found; chroma skipped for key', materialKey);
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

      // lmMask: 1.0 = 保持 / 0.0 = 完全カット
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

    if (!params.enabled) {
      // off のときはフック解除
      if (material.__lm_hasChromaClip) {
        material.onBeforeCompile = function () { /* no-op → デフォルトシェーダ */ };
        material.__lm_hasChromaClip = false;
        material.needsUpdate = true;
        log('chroma disabled for material', material.name);
      }
      return;
    }

    const chunk = buildClipChunk(params);

    material.onBeforeCompile = function (shader) {
      const src = shader.fragmentShader;

      // PBR 系ならだいたいこの行が存在するはず
      const anchor = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
      const idx = src.indexOf(anchor);

      if (idx === -1) {
        warn('no gl_FragColor hook; chroma disabled for material', material.name);
        return;
      }

      const injected =
        src.slice(0, idx) +
        chunk + '\n' +
        src.slice(idx);

      shader.fragmentShader = injected;
      log('shader patched for material', material.name);
    };

    material.__lm_hasChromaClip = true;
    material.needsUpdate = true;
  }

  // 内部コア: 正規化済み params を受けて実際に適用
  function applyChromaCore (params) {
    const key = params.materialKey || params.key;
    if (!key) {
      warn('applyChromaCore called without materialKey', params);
      return;
    }

    log('applyChromaCore', JSON.stringify(params));

    const materials = collectMaterialsByKey(key);
    materials.forEach(function (m) {
      applyClipToMaterial(m, params);
    });

    log('chroma applied to', materials.length, 'material(s) for key', key);
  }

  // 互換レイヤ: どんな呼び方でもここに集約する
  //
  // 1) オブジェクト形式:
  //    applyChroma({ materialKey, enabled, colorHex, tolerance, feather })
  //
  // 2) 位置引数形式:
  //    applyChroma(materialKey, enabled, colorHex, tolerance, feather)
  //
  function applyChromaUniversal () {
    let params;

    if (arguments.length === 1 && typeof arguments[0] === 'object') {
      params = Object.assign(
        {
          enabled: true,
          colorHex: '#ffffff',
          tolerance: 0.15,
          feather: 0.5
        },
        arguments[0] || {}
      );
    } else if (arguments.length >= 1 && typeof arguments[0] === 'string') {
      params = {
        materialKey: arguments[0],
        enabled: arguments.length > 1 ? !!arguments[1] : true,
        colorHex: arguments.length > 2 ? (arguments[2] || '#ffffff') : '#ffffff',
        tolerance: arguments.length > 3 ? (arguments[3] || 0.15) : 0.15,
        feather: arguments.length > 4 ? (arguments[4] || 0.5) : 0.5
      };
    } else {
      warn('applyChromaUniversal called with unexpected args', arguments);
      return;
    }

    log('applyChromaUniversal', params);
    applyChromaCore(params);
  }

  // 公開 API オブジェクト
  const api = {
    // メイン
    applyChroma: applyChromaUniversal,

    // 旧名っぽいものを全部ラップしておく
    applyChromaKey: applyChromaUniversal,
    chromaKey: applyChromaUniversal,
    setChroma: applyChromaUniversal
  };

  // 既存のどの呼び名でも拾えるように同じオブジェクト／関数を複数名で公開
  global.__LM_MATERIAL_RUNTIME = api;
  global.__LM_MATERIALS_RUNTIME = api;
  global.__lm_materialRuntime = api;
  global.__lm_material_runtime = api;

  // 関数として直接持っていそうなケースもカバー
  global.__lm_applyChroma = applyChromaUniversal;
  global.__LM_APPLY_CHROMA = applyChromaUniversal;
  global.applyChromaKey = applyChromaUniversal;

  log('ready');

})(window);
