// ---------------------------------------------------------------------------
// LociMyu viewer.module.cdn.js (patched for GLB auth + materials)
// ---------------------------------------------------------------------------

// --- LM auth resolver (classic-safe, no dynamic import name collisions) ---
function __lm_auth_resolver_v2() {
  // すでにグローバルにブリッジがあればそれを使う
  if (window.__lm_auth_bridge && typeof window.__lm_auth_bridge.getAccessToken === 'function') {
    return {
      ensureToken: window.__lm_auth_bridge.ensureToken || (async () => {
        const t = await window.__lm_auth_bridge.getAccessToken();
        if (!t) throw new Error('no token from __lm_auth_bridge');
        return t;
      }),
      getAccessToken: window.__lm_auth_bridge.getAccessToken,
    };
  }

  // gauth.module.js がロードされていればそれを使う
  const gauth = window.__lm_gauth_module || window.gauthModule || null;
  if (gauth && typeof gauth.getAccessToken === 'function') {
    return {
      ensureToken: gauth.ensureToken || (async () => {
        const t = await gauth.getAccessToken();
        if (!t) throw new Error('no token from gauth.module');
        return t;
      }),
      getAccessToken: gauth.getAccessToken,
    };
  }

  console.warn('[viewer.auth] no explicit auth bridge; falling back to noop token');
  return {
    ensureToken: async () => null,
    getAccessToken: async () => null,
  };
}

// ---------------------------------------------------------------------------
// THREE.js import（import map 経由）
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log('[viewer.module] using THREE from import map', !!THREE);

// ---------------------------------------------------------------------------
// 内部状態
// ---------------------------------------------------------------------------
let renderer = null;
let scene = null;
let camera = null;
let currentGlbId = null;
let currentRoot = null;
const clock = new THREE.Clock();

// material.id => { baseEmissive: Color|null, baseLights:boolean|undefined, baseToneMapped:boolean|undefined }
const materialState = new Map();

function getCanvas() {
  const c = document.getElementById('gl');
  if (!c) throw new Error('canvas#gl not found');
  return c;
}

// ---------------------------------------------------------------------------
// ビューア初期化
// ---------------------------------------------------------------------------
export function ensureViewer(opts = {}) {
  if (renderer && scene && camera) {
    return { renderer, scene, camera };
  }

  const canvas = getCanvas();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);

  camera = new THREE.PerspectiveCamera(
    45,
    (canvas.clientWidth || 800) / (canvas.clientHeight || 600),
    0.1,
    1000,
  );
  camera.position.set(0, 2, 5);

  // 簡易ライト
  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(5, 10, 7.5);
  scene.add(light);

  const amb = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(amb);

  window.addEventListener('resize', () => {
    if (!renderer || !camera) return;
    const canvas = getCanvas();
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  console.log('[viewer.module] viewer initialized');
  return { renderer, scene, camera };
}

// ---------------------------------------------------------------------------
// GLB ロード（Drive）
// ---------------------------------------------------------------------------
export async function loadGlbFromDrive(fileId) {
  const { renderer, scene, camera } = ensureViewer();

  // 既存のモデルを削除
  if (currentRoot) {
    scene.remove(currentRoot);
    currentRoot.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m) return;
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    currentRoot = null;
  }

  // Drive URL を組み立てる（認可ヘッダは fetch 側に任せる）
  const baseUrl = 'https://www.googleapis.com/drive/v3/files/';
  const url = `${baseUrl}${fileId}?alt=media`;

  // ★ここで毎回、最新の auth ブリッジを取得する
  const { ensureToken, getAccessToken } = __lm_auth_resolver_v2();
  await ensureToken();
  const token = await getAccessToken();

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  console.log('[viewer.module] loading GLB from Drive', { fileId, hasToken: !!token });

  const loader = new GLTFLoader();
  loader.setCrossOrigin('anonymous');

  // fetch して Blob URL に変換
  const blob = await fetch(url, { headers }).then((r) => {
    if (!r.ok) throw new Error(`Drive fetch failed: ${r.status}`);
    return r.blob();
  });

  const blobUrl = URL.createObjectURL(blob);

  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      blobUrl,
      (g) => resolve(g),
      undefined,
      (err) => reject(err),
    );
  });

  URL.revokeObjectURL(blobUrl);

  currentRoot = gltf.scene || gltf.scenes?.[0] || null;
  if (currentRoot) {
    scene.add(currentRoot);
  }

  // ざっくりバウンディングからカメラ位置を決める
  if (currentRoot) {
    const box = new THREE.Box3().setFromObject(currentRoot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera.fov * Math.PI) / 180;
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;

    camera.position.set(center.x, center.y, cameraZ);
    camera.lookAt(center);
  }

  currentGlbId = fileId;
  console.log('[viewer.module] glb loaded, id=', fileId, 'meshes=', listMeshes().length);

  return gltf;
}

// ---------------------------------------------------------------------------
// メッシュ / マテリアル列挙
// ---------------------------------------------------------------------------
function listMeshes() {
  const meshes = [];
  if (!currentRoot) return meshes;
  currentRoot.traverse((obj) => {
    if (obj.isMesh) meshes.push(obj);
  });
  return meshes;
}

export function listMaterials() {
  const mats = new Map();
  listMeshes().forEach((mesh) => {
    const mm = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mm.forEach((mat) => {
      if (!mat || !mat.name) return;
      if (!mats.has(mat.name)) mats.set(mat.name, mat);
    });
  });
  return Array.from(mats.keys());
}

export function getScene() {
  return { renderer, scene, camera, root: currentRoot };
}

export function getCurrentGlbId() {
  return currentGlbId;
}

// ---------------------------------------------------------------------------
// マテリアル適用ロジック（opacity / double-sided / unlit / chroma-key）
// ---------------------------------------------------------------------------
function getOrInitMatState(mat) {
  let st = materialState.get(mat.uuid);
  if (!st) {
    st = {
      baseEmissive: mat.emissive ? mat.emissive.clone() : null,
      baseLights: 'lights' in mat ? !!mat.lights : undefined,
      baseToneMapped: 'toneMapped' in mat ? !!mat.toneMapped : undefined,
    };
    materialState.set(mat.uuid, st);
  }
  return st;
}

export function applyMaterialProps(materialName, props) {
  if (!currentRoot) return;

  const meshes = listMeshes().filter((m) => {
    const mm = Array.isArray(m.material) ? m.material : [m.material];
    return mm.some((mat) => mat && mat.name === materialName);
  });

  if (!meshes.length) {
    console.warn('[viewer.materials] no meshes for material', materialName);
    return;
  }

  meshes.forEach((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    mats.forEach((mat) => {
      if (!mat || mat.name !== materialName) return;

      const st = getOrInitMatState(mat);

      // --- opacity ---
      if (typeof props.opacity === 'number') {
        const o = props.opacity;
        mat.opacity = o;
        mat.transparent = o < 0.999;
        mat.needsUpdate = true;
      }

      // --- double sided (doubleSide / doubleSided 両対応) ---
      if (
        typeof props.doubleSide !== 'undefined' ||
        typeof props.doubleSided !== 'undefined'
      ) {
        try {
          const THREE_NS =
            window.THREE || (window.viewer && window.viewer.THREE) || null;
          if (THREE_NS) {
            const doubleSided =
              typeof props.doubleSided !== 'undefined'
                ? props.doubleSided
                : props.doubleSide;
            mat.side = doubleSided
              ? THREE_NS.DoubleSide
              : THREE_NS.FrontSide;
            mat.needsUpdate = true;
          } else {
            console.warn(
              '[viewer.materials] THREE namespace not found for doubleSide',
            );
          }
        } catch (e) {
          console.warn('[viewer.materials] doubleSide apply failed', e);
        }
      }

      // --- unlit like ---
      if (
        typeof props.unlit !== 'undefined' ||
        typeof props.unlitLike !== 'undefined'
      ) {
        const flag = !!(props.unlit ?? props.unlitLike);

        if (st.baseLights === undefined && 'lights' in mat) {
          st.baseLights = !!mat.lights;
        }
        if (st.baseToneMapped === undefined && 'toneMapped' in mat) {
          st.baseToneMapped = !!mat.toneMapped;
        }

        if (flag) {
          if ('lights' in mat) mat.lights = false;
          if ('toneMapped' in mat) mat.toneMapped = false;

          if (mat.emissive) {
            if (!st.baseEmissive) {
              st.baseEmissive = mat.emissive.clone();
            }
            if (
              mat.emissiveIntensity !== undefined &&
              mat.emissiveIntensity < 1.0
            ) {
              mat.emissiveIntensity = 1.0;
            }
          }
        } else {
          if ('lights' in mat && st.baseLights !== undefined) {
            mat.lights = st.baseLights;
          }
          if ('toneMapped' in mat && st.baseToneMapped !== undefined) {
            mat.toneMapped = st.baseToneMapped;
          }
          if (mat.emissive && st.baseEmissive) {
            mat.emissive.copy(st.baseEmissive);
          }
        }

        mat.needsUpdate = true;
      }

      // --- chroma key: 今は保存専用。描画ロジックは別フェーズで。 ---
      const ck = {};
      if (typeof props.chromaEnable !== 'undefined') {
        ck.enable = !!props.chromaEnable;
      }
      if (typeof props.chromaColor === 'string') {
        ck.color = props.chromaColor;
      }
      if (typeof props.chromaTolerance === 'number') {
        ck.tolerance = props.chromaTolerance;
      }
      if (typeof props.chromaFeather === 'number') {
        ck.feather = props.chromaFeather;
      }
      if (Object.keys(ck).length) {
        mat.userData.__lm_chromaKey = Object.assign(
          mat.userData.__lm_chromaKey || {},
          ck,
        );
      }
    });
  });

  console.log(
    '[viewer.materials] applyMaterialProps',
    materialName,
    props,
    'targets',
    meshes.length,
  );
}

// ---------------------------------------------------------------------------
// 全リセット系
// ---------------------------------------------------------------------------
export function resetMaterial(materialName) {
  if (!currentRoot) return;

  listMeshes().forEach((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat || mat.name !== materialName) return;

      const st = materialState.get(mat.uuid);
      if (st && st.baseEmissive && mat.emissive) {
        mat.emissive.copy(st.baseEmissive);
      }
      if (st && st.baseLights !== undefined && 'lights' in mat) {
        mat.lights = st.baseLights;
      }
      if (st && st.baseToneMapped !== undefined && 'toneMapped' in mat) {
        mat.toneMapped = st.baseToneMapped;
      }

      mat.opacity = 1.0;
      mat.transparent = false;
      mat.side = THREE.FrontSide;
      mat.needsUpdate = true;
    });
  });

  console.log('[viewer.materials] resetMaterial', materialName);
}

export function resetAllMaterials() {
  if (!currentRoot) return;

  listMeshes().forEach((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat) return;

      const st = materialState.get(mat.uuid);
      if (st && st.baseEmissive && mat.emissive) {
        mat.emissive.copy(st.baseEmissive);
      }
      if (st && st.baseLights !== undefined && 'lights' in mat) {
        mat.lights = st.baseLights;
      }
      if (st && st.baseToneMapped !== undefined && 'toneMapped' in mat) {
        mat.toneMapped = st.baseToneMapped;
      }

      mat.opacity = 1.0;
      mat.transparent = false;
      mat.side = THREE.FrontSide;
      mat.needsUpdate = true;
    });
  });

  console.log('[viewer.materials] resetAllMaterials');
}

// ---------------------------------------------------------------------------
// 描画ループ
// ---------------------------------------------------------------------------
export function onRenderTick() {
  if (!renderer || !scene || !camera) return;
  const dt = clock.getDelta();
  renderer.render(scene, camera);
  // 必要ならアニメーション等に dt を利用
}

// ---------------------------------------------------------------------------
// 旧ブリッジ API 互換用ダミー
// （pin 周りは別モジュールなのでここでは no-op とする）
// ---------------------------------------------------------------------------
export function addPinMarker() { /* no-op here */ }
export function removePinMarker() { /* no-op here */ }
export function clearPins() { /* no-op here */ }
export function projectPoint() { return null; }
export function onCanvasShiftPick() { /* handled elsewhere */ }
export function setPinSelected() { /* handled elsewhere */ }

// ---------------------------------------------------------------------------
// デフォルトエクスポート
// ---------------------------------------------------------------------------
export default {
  ensureViewer,
  loadGlbFromDrive,
  listMaterials,
  getScene,
  getCurrentGlbId,
  applyMaterialProps,
  resetMaterial,
  resetAllMaterials,
  onRenderTick,
  addPinMarker,
  removePinMarker,
  clearPins,
  projectPoint,
  onCanvasShiftPick,
  setPinSelected,
};
