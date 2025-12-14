// material.runtime.patch.js
// v3.14.3 — chroma cutout via shader discard (no blending), hooked at viewer bridge
import * as THREE from 'three';

const global = window;
const TAG = '[mat-rt v3.14.3]';

const __LM_RT_ALREADY = (global.__LM_MaterialsRuntime && global.__LM_MaterialsRuntime.__v === '3.14.2');
if (__LM_RT_ALREADY) {
  console.log(TAG, 'already loaded');
} else {

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
  return THREE;
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

  const prevOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = function (shader) {
    if (typeof prevOnBeforeCompile === 'function') {
      try { prevOnBeforeCompile(shader); } catch (e) { console.warn(TAG, 'prev onBeforeCompile error', e); }
    }
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
    // 既存のシェーダ断片文字列

    // 追加 uniform + feature flag
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

    // NOTE:
    // - vUv/vMapUv 等の varying に依存すると、材質種別や three.js 内部変更でコンパイルが壊れやすい。
    // - ここでは map_fragment 後に確実に存在する "diffuseColor" をキーにして discard する。
    //   (diffuseColor はベース色で、マップ適用後も保持される)
    const hookBlock = `
#ifdef USE_LM_CHROMA
  if (uLmChromaEnabled) {
    float lmDist = length(diffuseColor.rgb - uLmChromaColor);
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
`;

    // まず安定して存在する include を狙う（dithering_fragment は多くの材質で末尾付近にある）
    if (frag.includes('#include <dithering_fragment>')) {
      frag = frag.replace(
        '#include <dithering_fragment>',
        hookBlock + '\n#include <dithering_fragment>'
      );
    } else if (frag.includes('#include <output_fragment>')) {
      // 念のため: output_fragment を持つ場合はこちらでもOK
      frag = frag.replace(
        '#include <output_fragment>',
        hookBlock + '\n#include <output_fragment>'
      );
    } else {
      // 保険：末尾に差し込む（main の終端直前）
      const mainEnd = frag.lastIndexOf('}');
      if (mainEnd !== -1) {
        frag =
          frag.slice(0, mainEnd) +
          '\n' +
          hookBlock +
          '\n' +
          frag.slice(mainEnd);
      }
      console.warn(TAG, 'no hook include; injected fallback block for', key);
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
    let propsNoChroma = props;
      if (props && typeof props === 'object') {
        propsNoChroma = { ...props };
        // strip chroma props so viewer.module.cdn.js does not apply transparency-based chroma
        delete propsNoChroma.chroma;
        delete propsNoChroma.chromaEnable;
        delete propsNoChroma.chromaEnabled;
        delete propsNoChroma.chromaColor;
        delete propsNoChroma.chromaTolerance;
        delete propsNoChroma.chromaFeather;
      }

      const result = original(materialKey, propsNoChroma);

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
  __v: '3.14.3',
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

} // end __LM_RT_ALREADY guard