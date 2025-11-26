// --- LM auth resolver without dynamic import (classic-safe) ---
function __lm_getAuth() {
  const gauth = window.__LM_auth || {};
  return {
    ensureToken: (typeof gauth.ensureToken === 'function'
                    ? gauth.ensureToken
                    : (typeof window.ensureToken === 'function'
                        ? window.ensureToken
                        : async function(){ return null; })),
    getAccessToken: (typeof gauth.getAccessToken === 'function'
                       ? gauth.getAccessToken
                       : (typeof window.getAccessToken === 'function'
                           ? window.getAccessToken
                           : async function(){ return null; }))
  };
}

// --- Globals/state for viewer ---
let renderer;
let scene;
let camera;
let controls;
let currentGlb;
let currentGlbId = null;
let materialsCache = {};
let clock;
let canvasEl;
let onRenderTickCb = null;

// expose a minimal viewer state for debugging if needed
const __lm_viewer_state = {
  get renderer(){ return renderer; },
  get scene(){ return scene; },
  get camera(){ return camera; },
  get controls(){ return controls; },
  get currentGlb(){ return currentGlb; },
  get currentGlbId(){ return currentGlbId; },
  get materialsCache(){ return materialsCache; },
};
window.__lm_viewer_state = __lm_viewer_state;

// --- THREE / loaders ---

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LoadingManager = new THREE.LoadingManager();

// --- Google Drive helper (alt=media fetch → Blob) ---

async function fetchDriveFileBlob(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error('[viewer] Drive fetch failed', res.status, await res.text());
    throw new Error(`Drive fetch failed: ${res.status}`);
  }
  return await res.blob();
}

// ------------------------------------------------------------------------------------
//  Viewer bootstrap
// ------------------------------------------------------------------------------------

// NOTE: glb.btn.bridge.v3 からは ensureViewer(canvasElement) 形式で呼ばれる想定。
// 既存コードとの互換性のため、
//   - canvasElement（HTMLCanvasElement）
//   - { canvas: HTMLCanvasElement }
//   の両方を受け付けるようにしている。
export function ensureViewer(arg){
  if (renderer) return;

  const canvas = (arg && arg.tagName) ? arg
                : (arg && arg.canvas) ? arg.canvas
                : document.getElementById('gl');

  if (!canvas || typeof canvas.getContext !== 'function') {
    console.error('[viewer] ensureViewer: invalid canvas', canvas);
    throw new Error('Viewer canvas not found or invalid');
  }

  canvasEl = canvas;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const width  = canvas.clientWidth  || canvas.width  || 800;
  const height = canvas.clientHeight || canvas.height || 600;
  renderer.setSize(width, height, false);
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101015);

  const fov = 35;
  const aspect = width / height;
  const near = 0.1;
  const far = 2000;
  camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(5, 3, 8);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.screenSpacePanning = true;
  controls.target.set(0, 1, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7.5);
  dir.castShadow = true;
  scene.add(dir);

  clock = new THREE.Clock();

  function onResize() {
    if (!canvasEl || !renderer || !camera) return;
    const w = canvasEl.clientWidth  || canvasEl.width  || 800;
    const h = canvasEl.clientHeight || canvasEl.height || 600;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', onResize);

  function renderLoop() {
    requestAnimationFrame(renderLoop);
    if (!renderer || !scene || !camera) return;

    const dt = clock ? clock.getDelta() : 0.016;
    if (controls) controls.update();

    if (typeof onRenderTickCb === 'function') {
      try { onRenderTickCb(dt); } catch (e) {
        console.warn('[viewer] onRenderTick callback error', e);
      }
    }

    renderer.render(scene, camera);
  }
  renderLoop();
}

// ------------------------------------------------------------------------------------
//  GLB loading (from Google Drive)
// ------------------------------------------------------------------------------------

async function disposeCurrentGlb() {
  if (!currentGlb || !scene) return;

  scene.remove(currentGlb);

  currentGlb.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.dispose();
        if (m.normalMap) m.normalMap.dispose();
        if (m.roughnessMap) m.roughnessMap.dispose();
        if (m.metalnessMap) m.metalnessMap.dispose();
        if (m.alphaMap) m.alphaMap.dispose();
        if (m.envMap) m.envMap.dispose();
        m.dispose();
      }
    }
  });

  currentGlb = null;
  currentGlbId = null;
  materialsCache = {};
}

// fileId: Google Drive file id (string)
export async function loadGlbFromDrive(fileId) {
  if (!fileId) throw new Error('fileId is required');

  const { ensureToken, getAccessToken } = __lm_getAuth();
  if (ensureToken) await ensureToken();
  const token = getAccessToken ? await getAccessToken() : null;

  await disposeCurrentGlb();

  let objectURL = null;

  try {
    const blob = await fetchDriveFileBlob(fileId, token);
    objectURL = URL.createObjectURL(blob);

    const loader = new GLTFLoader(LoadingManager);
    const gltf = await loader.loadAsync(objectURL);

    currentGlb = gltf.scene || gltf.scenes[0];
    currentGlbId = fileId;
    scene.add(currentGlb);

    // fit camera
    const box = new THREE.Box3().setFromObject(currentGlb);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.4;

    camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.3, center.z + cameraZ);
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(center);
      controls.update();
    }

    // cache materials by material.name
    materialsCache = {};
    currentGlb.traverse(obj => {
      if (!obj.isMesh) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        if (!mat || !mat.name) continue;
        if (!materialsCache[mat.name]) {
          materialsCache[mat.name] = mat;
        }
      }
    });

    console.log('[viewer] GLB loaded', {
      fileId,
      materialKeys: Object.keys(materialsCache),
    });

    return {
      gltf,
      scene: currentGlb,
      materials: materialsCache,
    };
  } catch (err) {
    console.error('[viewer] loadGlbFromDrive failed', err);
    throw err;
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}

// ------------------------------------------------------------------------------------
//  Materials helpers + applyMaterialProps
// ------------------------------------------------------------------------------------

// returns array of material keys (names)
export function listMaterials() {
  return Object.keys(materialsCache || {});
}

// internal: get material object(s) by name
function getMaterialTargets(materialName) {
  const targets = [];
  if (!currentGlb) return targets;

  currentGlb.traverse(obj => {
    if (!obj.isMesh) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

    for (const mat of materials) {
      if (!mat || mat.name !== materialName) continue;
      targets.push({ mesh: obj, material: mat });
    }
  });

  return targets;
}

/**
 * props:
 *  - opacity: number (0–1)
 *  - doubleSided: boolean
 *  - unlitLike: boolean
 *  - chromaEnable: boolean
 *  - chromaColor: '#rrggbb'
 *  - chromaTolerance: number
 *  - chromaFeather: number
 */
export function applyMaterialProps(materialName, props = {}) {
  if (!materialName || !currentGlb) return;

  const targets = getMaterialTargets(materialName);
  if (!targets.length) return;

  const {
    opacity,
    doubleSided,
    unlitLike,
    chromaEnable,
    chromaColor,
    chromaTolerance,
    chromaFeather,
  } = props;

  targets.forEach(({ mesh, material }) => {
    // --- Opacity / transparency ---
    if (typeof opacity === 'number') {
      const o = THREE.MathUtils.clamp(opacity, 0, 1);
      material.opacity = o;
      material.transparent = o < 0.999;
      material.needsUpdate = true;
    }

    // --- Double sided flag ---
    if (typeof doubleSided === 'boolean') {
      material.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      material.needsUpdate = true;
    }

    // --- Unlit-like flag ---
    if (typeof unlitLike === 'boolean') {
      if (unlitLike) {
        // bake current color/texture, then disable lighting influence as much as possible
        material.emissive = material.emissive || new THREE.Color(0x000000);
        if (material.color) {
          material.emissive.copy(material.color);
        }
        material.emissiveIntensity = 1.0;
        material.lights = false;
      } else {
        material.lights = true;
        material.emissiveIntensity = 0.0;
      }
      material.needsUpdate = true;
    }

    // --- Chroma key stub (color only; actual keying処理は今後のフェーズ) ---
    if (typeof chromaEnable === 'boolean') {
      material.userData.__lm_chromaEnable = chromaEnable;
    }
    if (typeof chromaColor === 'string') {
      material.userData.__lm_chromaColor = chromaColor;
    }
    if (typeof chromaTolerance === 'number') {
      material.userData.__lm_chromaTolerance = chromaTolerance;
    }
    if (typeof chromaFeather === 'number') {
      material.userData.__lm_chromaFeather = chromaFeather;
    }

    mesh.material = material;
  });
}

// ------------------------------------------------------------------------------------
//  Misc exports used by bridges
// ------------------------------------------------------------------------------------

export function getScene() {
  return scene;
}

export function getCurrentGlbId() {
  return currentGlbId;
}

export function setCurrentGlbId(id) {
  currentGlbId = id;
}

export function resetAllMaterials() {
  if (!currentGlb) return;
  currentGlb.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.material && obj.material.isMaterial && obj.material.userData && obj.material.userData.__lm_orig) {
      obj.material.copy(obj.material.userData.__lm_orig);
    }
  });
}

export function resetMaterial(/* materialName */) {
  // 仕様上まだ細分化リセットは使っていないので、必要になったら実装
}

export function onRenderTick(cb) {
  onRenderTickCb = cb;
}

// ピン関連のダミー実装（現状 LociMyu v6.x では viewer 側で処理していないため、
// 既存の bridge との互換用に空関数を残す）
export function addPinMarker() {}
export function clearPins() {}
export function onCanvasShiftPick() {}
export function onPinSelect() {}
export function projectPoint() { return null; }
export function removePinMarker() {}
export function setPinSelected() {}
// --- LM auth resolver without dynamic import (classic-safe) ---
function __lm_getAuth() {
  const gauth = window.__LM_auth || {};
  return {
    ensureToken: (typeof gauth.ensureToken === 'function'
                    ? gauth.ensureToken
                    : (typeof window.ensureToken === 'function'
                        ? window.ensureToken
                        : async function(){ return null; })),
    getAccessToken: (typeof gauth.getAccessToken === 'function'
                       ? gauth.getAccessToken
                       : (typeof window.getAccessToken === 'function'
                           ? window.getAccessToken
                           : async function(){ return null; }))
  };
}

// --- Globals/state for viewer ---
let renderer;
let scene;
let camera;
let controls;
let currentGlb;
let currentGlbId = null;
let materialsCache = {};
let clock;
let canvasEl;
let onRenderTickCb = null;

// expose a minimal viewer state for debugging if needed
const __lm_viewer_state = {
  get renderer(){ return renderer; },
  get scene(){ return scene; },
  get camera(){ return camera; },
  get controls(){ return controls; },
  get currentGlb(){ return currentGlb; },
  get currentGlbId(){ return currentGlbId; },
  get materialsCache(){ return materialsCache; },
};
window.__lm_viewer_state = __lm_viewer_state;

// --- THREE / loaders ---

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LoadingManager = new THREE.LoadingManager();

// --- Google Drive helper (alt=media fetch → Blob) ---

async function fetchDriveFileBlob(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error('[viewer] Drive fetch failed', res.status, await res.text());
    throw new Error(`Drive fetch failed: ${res.status}`);
  }
  return await res.blob();
}

// ------------------------------------------------------------------------------------
//  Viewer bootstrap
// ------------------------------------------------------------------------------------

// NOTE: glb.btn.bridge.v3 からは ensureViewer(canvasElement) 形式で呼ばれる想定。
// 既存コードとの互換性のため、
//   - canvasElement（HTMLCanvasElement）
//   - { canvas: HTMLCanvasElement }
//   の両方を受け付けるようにしている。
export function ensureViewer(arg){
  if (renderer) return;

  const canvas = (arg && arg.tagName) ? arg
                : (arg && arg.canvas) ? arg.canvas
                : document.getElementById('gl');

  if (!canvas || typeof canvas.getContext !== 'function') {
    console.error('[viewer] ensureViewer: invalid canvas', canvas);
    throw new Error('Viewer canvas not found or invalid');
  }

  canvasEl = canvas;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const width  = canvas.clientWidth  || canvas.width  || 800;
  const height = canvas.clientHeight || canvas.height || 600;
  renderer.setSize(width, height, false);
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101015);

  const fov = 35;
  const aspect = width / height;
  const near = 0.1;
  const far = 2000;
  camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(5, 3, 8);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.screenSpacePanning = true;
  controls.target.set(0, 1, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7.5);
  dir.castShadow = true;
  scene.add(dir);

  clock = new THREE.Clock();

  function onResize() {
    if (!canvasEl || !renderer || !camera) return;
    const w = canvasEl.clientWidth  || canvasEl.width  || 800;
    const h = canvasEl.clientHeight || canvasEl.height || 600;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', onResize);

  function renderLoop() {
    requestAnimationFrame(renderLoop);
    if (!renderer || !scene || !camera) return;

    const dt = clock ? clock.getDelta() : 0.016;
    if (controls) controls.update();

    if (typeof onRenderTickCb === 'function') {
      try { onRenderTickCb(dt); } catch (e) {
        console.warn('[viewer] onRenderTick callback error', e);
      }
    }

    renderer.render(scene, camera);
  }
  renderLoop();
}

// ------------------------------------------------------------------------------------
//  GLB loading (from Google Drive)
// ------------------------------------------------------------------------------------

async function disposeCurrentGlb() {
  if (!currentGlb || !scene) return;

  scene.remove(currentGlb);

  currentGlb.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.dispose();
        if (m.normalMap) m.normalMap.dispose();
        if (m.roughnessMap) m.roughnessMap.dispose();
        if (m.metalnessMap) m.metalnessMap.dispose();
        if (m.alphaMap) m.alphaMap.dispose();
        if (m.envMap) m.envMap.dispose();
        m.dispose();
      }
    }
  });

  currentGlb = null;
  currentGlbId = null;
  materialsCache = {};
}

// fileId: Google Drive file id (string)
export async function loadGlbFromDrive(fileId) {
  if (!fileId) throw new Error('fileId is required');

  const { ensureToken, getAccessToken } = __lm_getAuth();
  if (ensureToken) await ensureToken();
  const token = getAccessToken ? await getAccessToken() : null;

  await disposeCurrentGlb();

  let objectURL = null;

  try {
    const blob = await fetchDriveFileBlob(fileId, token);
    objectURL = URL.createObjectURL(blob);

    const loader = new GLTFLoader(LoadingManager);
    const gltf = await loader.loadAsync(objectURL);

    currentGlb = gltf.scene || gltf.scenes[0];
    currentGlbId = fileId;
    scene.add(currentGlb);

    // fit camera
    const box = new THREE.Box3().setFromObject(currentGlb);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.4;

    camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.3, center.z + cameraZ);
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(center);
      controls.update();
    }

    // cache materials by material.name
    materialsCache = {};
    currentGlb.traverse(obj => {
      if (!obj.isMesh) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        if (!mat || !mat.name) continue;
        if (!materialsCache[mat.name]) {
          materialsCache[mat.name] = mat;
        }
      }
    });

    console.log('[viewer] GLB loaded', {
      fileId,
      materialKeys: Object.keys(materialsCache),
    });

    return {
      gltf,
      scene: currentGlb,
      materials: materialsCache,
    };
  } catch (err) {
    console.error('[viewer] loadGlbFromDrive failed', err);
    throw err;
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}

// ------------------------------------------------------------------------------------
//  Materials helpers + applyMaterialProps
// ------------------------------------------------------------------------------------

// returns array of material keys (names)
export function listMaterials() {
  return Object.keys(materialsCache || {});
}

// internal: get material object(s) by name
function getMaterialTargets(materialName) {
  const targets = [];
  if (!currentGlb) return targets;

  currentGlb.traverse(obj => {
    if (!obj.isMesh) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

    for (const mat of materials) {
      if (!mat || mat.name !== materialName) continue;
      targets.push({ mesh: obj, material: mat });
    }
  });

  return targets;
}

/**
 * props:
 *  - opacity: number (0–1)
 *  - doubleSided: boolean
 *  - unlitLike: boolean
 *  - chromaEnable: boolean
 *  - chromaColor: '#rrggbb'
 *  - chromaTolerance: number
 *  - chromaFeather: number
 */
export function applyMaterialProps(materialName, props = {}) {
  if (!materialName || !currentGlb) return;

  const targets = getMaterialTargets(materialName);
  if (!targets.length) return;

  const {
    opacity,
    doubleSided,
    unlitLike,
    chromaEnable,
    chromaColor,
    chromaTolerance,
    chromaFeather,
  } = props;

  targets.forEach(({ mesh, material }) => {
    // --- Opacity / transparency ---
    if (typeof opacity === 'number') {
      const o = THREE.MathUtils.clamp(opacity, 0, 1);
      material.opacity = o;
      material.transparent = o < 0.999;
      material.needsUpdate = true;
    }

    // --- Double sided flag ---
    if (typeof doubleSided === 'boolean') {
      material.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      material.needsUpdate = true;
    }

    // --- Unlit-like flag ---
    if (typeof unlitLike === 'boolean') {
      if (unlitLike) {
        // bake current color/texture, then disable lighting influence as much as possible
        material.emissive = material.emissive || new THREE.Color(0x000000);
        if (material.color) {
          material.emissive.copy(material.color);
        }
        material.emissiveIntensity = 1.0;
        material.lights = false;
      } else {
        material.lights = true;
        material.emissiveIntensity = 0.0;
      }
      material.needsUpdate = true;
    }

    // --- Chroma key stub (color only; actual keying処理は今後のフェーズ) ---
    if (typeof chromaEnable === 'boolean') {
      material.userData.__lm_chromaEnable = chromaEnable;
    }
    if (typeof chromaColor === 'string') {
      material.userData.__lm_chromaColor = chromaColor;
    }
    if (typeof chromaTolerance === 'number') {
      material.userData.__lm_chromaTolerance = chromaTolerance;
    }
    if (typeof chromaFeather === 'number') {
      material.userData.__lm_chromaFeather = chromaFeather;
    }

    mesh.material = material;
  });
}

// ------------------------------------------------------------------------------------
//  Misc exports used by bridges
// ------------------------------------------------------------------------------------

export function getScene() {
  return scene;
}

export function getCurrentGlbId() {
  return currentGlbId;
}

export function setCurrentGlbId(id) {
  currentGlbId = id;
}

export function resetAllMaterials() {
  if (!currentGlb) return;
  currentGlb.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.material && obj.material.isMaterial && obj.material.userData && obj.material.userData.__lm_orig) {
      obj.material.copy(obj.material.userData.__lm_orig);
    }
  });
}

export function resetMaterial(/* materialName */) {
  // 仕様上まだ細分化リセットは使っていないので、必要になったら実装
}

export function onRenderTick(cb) {
  onRenderTickCb = cb;
}

// ピン関連のダミー実装（現状 LociMyu v6.x では viewer 側で処理していないため、
// 既存の bridge との互換用に空関数を残す）
export function addPinMarker() {}
export function clearPins() {}
export function onCanvasShiftPick() {}
export function onPinSelect() {}
export function projectPoint() { return null; }
export function removePinMarker() {}
export function setPinSelected() {}
