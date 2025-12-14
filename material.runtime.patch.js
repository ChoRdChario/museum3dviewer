// material.runtime.patch.js
// v3.13 — chroma clip via shader discard, UV channel aware (uses vMapUv), hooked at viewer bridge
(function (global) {
  const TAG = '[mat-rt v3.13]';

  if (global.__LM_MaterialsRuntime && global.__LM_MaterialsRuntime.__v === '3.13') {
    console.log(TAG, 'already loaded');
    return;
  }

  // ----- 内部状態 -----
  const state = {
    // materialKey -> { chroma: { enabled, colorHex, tolerance, feather } }
    byKey: new Map()
  };

  function normalizeChromaConfig(raw) {
    if (!raw) return null;

    // props.chroma 形式と、フラットな chromaEnabled 形式の両方に対応
    const src = raw.chroma || raw;

    const pickBool = (...vals) => {
      for (const v of vals) {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        if (typeof v === 'string') {
          const s = v.trim().toLowerCase();
          if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
          if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
        }
      }
      return false;
    };

    // NOTE: The rest of the codebase historically used `chromaEnable`.
    // Keep accepting `chromaEnabled` too (older runtime experiments).
    const enabled =
      typeof src.enabled === 'boolean'
        ? src.enabled
        : pickBool(src.chromaEnable, src.chromaEnabled);

    const colorHex =
      src.colorHex ||
      src.chromaColor ||
      '#000000';

    const tolerance =
      typeof src.tolerance === 'number'
        ? src.tolerance
        : (typeof src.chromaTolerance === 'number' ? src.chromaTolerance : 0.10);

    const feather =
      typeof src.feather === 'number'
        ? src.feather
        : (typeof src.chromaFeather === 'number' ? src.chromaFeather : 0.0);

    return {
      enabled,
      colorHex,
      tolerance,
      feather
    };
  }

  function setChromaConfig(materialKey, props) {
    const chroma = normalizeChromaConfig(props);
    if (!chroma) return;

    let entry = state.byKey.get(materialKey);
    if (!entry) {
      entry = {};
      state.byKey.set(materialKey, entry);
    }
    entry.chroma = chroma;

    console.log(TAG, 'set chroma config', materialKey, chroma);
  }

  // ----- THREE / viewer bridge 取得 -----
  function getTHREE() {
    // viewer.module.cdn.js は importmap で three を読むので、
    // グローバル THREE が無い可能性もあるが、通常は expose されている前提。
    return global.THREE || null;
  }

  function getViewerBridge() {
    return global.__lm_viewer_bridge || global.__LM_VIEWER_BRIDGE || null;
  }

  function getSceneFromBridge(bridge) {
    if (!bridge) return null;
    if (typeof bridge.getScene === 'function') {
      try {
        return bridge.getScene();
      } catch (e) {
        console.warn(TAG, 'getScene() failed', e);
      }
    }
    return null;
  }

  // materialKey に紐づく Material をシーンから探す（名前ベース）。
  function findMaterialsForKey(bridge, materialKey) {
    const scene = getSceneFromBridge(bridge);
    const found = [];
    if (!scene) return found;

    scene.traverse(obj => {
      const mat = obj.material;
      if (!mat) return;

      const matchOne = m => {
        if (!m) return;
        const name = m.name || m.userData?.lmKey || m.userData?.materialKey;
        if (name === materialKey) {
          found.push(m);
        }
      };

      if (Array.isArray(mat)) {
        mat.forEach(matchOne);
      } else {
        matchOne(mat);
      }
    });

    return found;
  }

  // ----- シェーダパッチ -----
  function patchMaterialShaderForChroma(material, materialKey) {
    const THREE = getTHREE();
    if (!THREE || !material || material.__lmChromaPatched) return;

    material.__lmChromaPatched = true;
    material.userData = material.userData || {};
    material.userData.__lmMaterialKey = materialKey;

    const key = materialKey; // クロージャに固定

    material.onBeforeCompile = function (shader) {
      const entry = state.byKey.get(key) || {};
      const chroma = entry.chroma || {
        enabled: false,
        colorHex: '#000000',
        tolerance: 0.1,
        feather: 0.0
      };

      // ユニフォーム定義
      shader.uniforms.uLmChromaEnabled = { value: !!chroma.enabled };
      shader.uniforms.uLmChromaColor = { value: new THREE.Color(chroma.colorHex || '#000000') };
      shader.uniforms.uLmChromaTolerance = { value: chroma.tolerance };
      shader.uniforms.uLmChromaFeather = { value: chroma.feather };

      material.userData.__lmChromaUniforms = shader.uniforms;

      let frag = shader.fragmentShader;
      // Three.js r159 では Map 用 UV 変数が vMapUv の場合がある。
      // ここを誤ると「見た目が変わらない」(誤サンプルで距離が常に外れる) になりやすい。
      const uvVar = frag.includes('vMapUv') ? 'vMapUv' : 'vUv';

      const header = `
uniform bool uLmChromaEnabled;
uniform vec3 uLmChromaColor;
uniform float uLmChromaTolerance;
uniform float uLmChromaFeather;
#define USE_LM_CHROMA
`;

      if (!frag.includes('uLmChromaEnabled')) {
        frag = header + frag;
      }

      const hookBlock = `
#ifdef USE_LM_CHROMA
  #ifdef USE_MAP
    // sample original baseColor (同じ UV で再サンプリング)
	    vec4 lmTexel = texture2D( map, ${uvVar} );
    lmTexel = mapTexelToLinear( lmTexel );
    vec3 lmColor = lmTexel.rgb;
    float lmDist = length(lmColor - uLmChromaColor);

    if (uLmChromaEnabled) {
      // feather 0: 純粋なクリップ、>0 ならエッジを少しだけ残す
      float tol = uLmChromaTolerance;
      float feather = max(uLmChromaFeather, 0.0);
      if (feather <= 0.0001) {
        if (lmDist < tol) {
          discard;
        }
      } else {
        float edge = smoothstep(tol, tol + feather, lmDist);
        if (edge <= 0.0001) {
          discard;
        }
      }
    }
  #endif
#endif
`;

      if (frag.includes('#include <output_fragment>')) {
        frag = frag.replace(
          '#include <output_fragment>',
          hookBlock + '\n#include <output_fragment>'
        );
      } else {
        // 保険：output_fragment ブロックが無い場合は main の末尾に差し込む
        const mainEnd = frag.lastIndexOf('}');
        if (mainEnd !== -1) {
          frag =
            frag.slice(0, mainEnd) +
            '\n' +
            hookBlock +
            '\n' +
            frag.slice(mainEnd);
        }
        console.warn(TAG, 'no <output_fragment> hook; injected fallback block for', key);
      }

      shader.fragmentShader = frag;
    };

    // コンパイルやり直し
    material.needsUpdate = true;
  }

  function applyChromaToMaterials(bridge, materialKey) {
    const entry = state.byKey.get(materialKey);
    if (!entry || !entry.chroma) return;

    const materials = findMaterialsForKey(bridge, materialKey);
    if (!materials.length) {
      console.log(TAG, 'no materials found for key', materialKey);
      return;
    }

    materials.forEach(mat => {
      patchMaterialShaderForChroma(mat, materialKey);

      const uniforms = mat.userData && mat.userData.__lmChromaUniforms;
      const chroma = entry.chroma;

      if (uniforms) {
        uniforms.uLmChromaEnabled.value = !!chroma.enabled;
        uniforms.uLmChromaColor.value.set(chroma.colorHex || '#000000');
        uniforms.uLmChromaTolerance.value = chroma.tolerance;
        uniforms.uLmChromaFeather.value = chroma.feather;
      }
    });

    console.log(TAG, 'applied chroma to', materialKey, 'mats=', materials.length);
  }

  // ----- viewer bridge の applyMaterialProps をフック -----
  function patchViewerBridgeOnce() {
    const bridge = getViewerBridge();
    if (!bridge || bridge.__lmChromaHooked) return;

    if (typeof bridge.applyMaterialProps !== 'function') {
      console.warn(TAG, 'viewer bridge has no applyMaterialProps; chroma disabled');
      return;
    }

    const original = bridge.applyMaterialProps.bind(bridge);

    bridge.applyMaterialProps = function (materialKey, props) {
      // 既存処理（透明度 / double-sided / unlit など）を先に実行
      const result = original(materialKey, props);

      // クロマ設定を記録・適用
      setChromaConfig(materialKey, props);
      applyChromaToMaterials(bridge, materialKey);

      return result;
    };

    bridge.__lmChromaHooked = true;
    console.log(TAG, 'patched viewer bridge.applyMaterialProps');
  }

  function waitForBridge() {
    const bridge = getViewerBridge();
    if (bridge && typeof bridge.applyMaterialProps === 'function') {
      patchViewerBridgeOnce();
      return;
    }
    setTimeout(waitForBridge, 500);
  }

  // ----- 公開 API（簡易版。将来拡張用） -----
  const runtime = {
    __v: '3.13',
    setChromaConfig,
    applyChromaNow: function (materialKey) {
      const bridge = getViewerBridge();
      if (!bridge) return;
      applyChromaToMaterials(bridge, materialKey);
    }
  };

  global.__LM_MaterialsRuntime = runtime;
  console.log(TAG, 'ready');

  waitForBridge();
})(window);
