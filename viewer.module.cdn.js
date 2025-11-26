// viewer.module.cdn.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene, camera, controls;
let __currentGlbId = null;

// ---------------------------------------------------------------------------
// Internals: mesh & material tracking for material UI
// ---------------------------------------------------------------------------

const __meshRegistry = new Set();
const __materialRegistry = new Map(); // key -> Set<THREE.Material>

function __scanSceneForMeshes(root) {
  __meshRegistry.clear();
  root.traverse(obj => {
    if (obj.isMesh) {
      __meshRegistry.add(obj);
    }
  });
}

function __allMeshes() {
  return Array.from(__meshRegistry);
}

function __rebuildMaterialList() {
  __materialRegistry.clear();

  for (const mesh of __meshRegistry) {
    const mat = mesh.material;
    const key = mesh.userData && mesh.userData.__lm_materialKey
      ? mesh.userData.__lm_materialKey
      : (mat && mat.name) || 'default';

    mesh.userData = mesh.userData || {};
    mesh.userData.__lm_materialKey = key;

    if (!__materialRegistry.has(key)) {
      __materialRegistry.set(key, new Set());
    }

    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && m.isMaterial) {
          __materialRegistry.get(key).add(m);
        }
      }
    } else if (mat && mat.isMaterial) {
      __materialRegistry.get(key).add(mat);
    }
  }
}

function __materialsByKey(materialKey) {
  const set = __materialRegistry.get(materialKey);
  return set ? Array.from(set) : [];
}

export function listMaterials() {
  const out = [];
  for (const [key, mats] of __materialRegistry.entries()) {
    const anyMat = Array.from(mats)[0];
    out.push({
      key,
      name: anyMat && anyMat.name ? anyMat.name : key,
      count: mats.size
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Material application (opacity, double-sided, unlit-like, chroma key props)
// ---------------------------------------------------------------------------

export function applyMaterialProps(materialKey, props = {}) {
  if (!materialKey) {
    console.warn('[viewer.materials] applyMaterialProps called without materialKey');
    return;
  }

  // Support both "unlitLike" (UI) and legacy "unlit" flag
  const hasUnlitFlag =
    Object.prototype.hasOwnProperty.call(props, 'unlitLike') ||
    Object.prototype.hasOwnProperty.call(props, 'unlit');
  const unlitRequested = hasUnlitFlag
    ? !!(Object.prototype.hasOwnProperty.call(props, 'unlitLike') ? props.unlitLike : props.unlit)
    : null;

  // Create / reuse an unlit (MeshBasicMaterial) variant for a lit material
  function ensureUnlitVariant(litMat) {
    if (!litMat) return null;
    litMat.userData = litMat.userData || {};
    if (litMat.userData.__lm_unlitVariant && litMat.userData.__lm_unlitVariant.isMaterial) {
      return litMat.userData.__lm_unlitVariant;
    }

    const basicParams = {
      name: litMat.name || materialKey,
      map: litMat.map || null,
      color:
        litMat.color && typeof litMat.color.clone === 'function'
          ? litMat.color.clone()
          : new THREE.Color(0xffffff),
      side: litMat.side,
      transparent: !!litMat.transparent,
      opacity: typeof litMat.opacity === 'number' ? litMat.opacity : 1.0,
      alphaTest: typeof litMat.alphaTest === 'number' ? litMat.alphaTest : 0,
      wireframe: !!litMat.wireframe
    };

    const basic = new THREE.MeshBasicMaterial(basicParams);
    basic.userData = basic.userData || {};
    basic.userData.__lm_litOrigin = litMat;

    litMat.userData.__lm_unlitVariant = basic;
    return basic;
  }

  // Switch all meshes using this materialKey between lit <-> unlit variants
  function applyUnlitState(materialKey, enable) {
    const meshes = __allMeshes();
    for (const mesh of meshes) {
      if (!mesh || !mesh.userData) continue;
      if (mesh.userData.__lm_materialKey !== materialKey) continue;

      let mat = mesh.material;
      if (!mat) continue;

      if (Array.isArray(mat)) {
        console.warn(
          '[viewer.materials] unlitLike for multi-material mesh is not yet supported:',
          materialKey
        );
        continue;
      }

      mat.userData = mat.userData || {};

      if (enable) {
        // Move to MeshBasicMaterial variant
        const litMat =
          (mat.userData && mat.userData.__lm_litOrigin) ||
          (mat.userData && mat.userData.__lm_litBackup) ||
          mat;
        const basic = ensureUnlitVariant(litMat);
        if (basic) {
          mesh.material = basic;
          basic.userData = basic.userData || {};
          basic.userData.__lm_unlitActive = true;
        }
      } else {
        // Restore original lit material if we have it
        let litTarget = null;
        if (mat.userData && mat.userData.__lm_litOrigin) {
          litTarget = mat.userData.__lm_litOrigin;
        } else if (
          mat.userData &&
          mat.userData.__lm_unlitVariant &&
          mat.userData.__lm_unlitVariant.userData &&
          mat.userData.__lm_unlitVariant.userData.__lm_litOrigin
        ) {
          litTarget = mat.userData.__lm_unlitVariant.userData.__lm_litOrigin;
        }

        if (litTarget) {
          litTarget.userData = litTarget.userData || {};
          litTarget.userData.__lm_unlitActive = false;
          mesh.material = litTarget;
        }
      }
    }

    // Material instances attached to meshes have changed; rebuild list
    __rebuildMaterialList();
  }

  // First, if unlit flag is explicitly toggled, switch variants at mesh level.
  if (hasUnlitFlag && unlitRequested !== null) {
    applyUnlitState(materialKey, !!unlitRequested);
  }

  // Refresh material list and pick all materials associated with this key
  __rebuildMaterialList();
  const mats = __materialsByKey(materialKey);
  if (!mats || !mats.length) {
    console.warn('[viewer.materials] no materials found for key', materialKey);
    return;
  }

  console.log('[viewer.materials] applyMaterialProps', materialKey, props, 'targets', mats.length);

  // Build a unique set of all related variants (lit / unlit) so that
  // opacity, double-sided, chroma parameters etc. stay in sync.
  const targetSet = new Set();
  for (const mat of mats) {
    if (!mat) continue;
    targetSet.add(mat);
    if (mat.userData) {
      if (mat.userData.__lm_unlitVariant) targetSet.add(mat.userData.__lm_unlitVariant);
      if (mat.userData.__lm_litOrigin) targetSet.add(mat.userData.__lm_litOrigin);
    }
  }
  const targets = Array.from(targetSet);

  for (const mat of targets) {
    if (!mat) continue;
    mat.userData = mat.userData || {};

    // Persist unlit flag on both variants, but actual switching is handled above.
    if (hasUnlitFlag && unlitRequested !== null) {
      mat.userData.__lm_unlit = !!unlitRequested;
    }

    // Opacity
    if (typeof props.opacity !== 'undefined') {
      const opacity = Math.max(0, Math.min(1, props.opacity));
      mat.opacity = opacity;
      mat.transparent = opacity < 1.0 || !!mat.transparent;
      mat.needsUpdate = true;
      mat.userData.__lm_opacity = opacity;
    }

    // Double sided
    if (typeof props.doubleSided !== 'undefined') {
      mat.side = props.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      mat.needsUpdate = true;
      mat.userData.__lm_doubleSided = !!props.doubleSided;
    }

    // Chroma key settings are only persisted for now; actual shaderパッチは後続フェーズで実装予定。
    if (typeof props.chromaEnable !== 'undefined') {
      mat.userData.__lm_chromaEnable = !!props.chromaEnable;
    }
    if (typeof props.chromaColor !== 'undefined') {
      mat.userData.__lm_chromaColor = props.chromaColor;
    }
    if (typeof props.chromaTolerance !== 'undefined') {
      mat.userData.__lm_chromaTolerance = props.chromaTolerance;
    }
    if (typeof props.chromaFeather !== 'undefined') {
      mat.userData.__lm_chromaFeather = props.chromaFeather;
    }
  }
}

export function resetMaterial(materialKey) {
  const mats = __materialsByKey(materialKey);
  if (!mats || !mats.length) return;

  for (const mat of mats) {
    if (!mat) continue;
    if (!mat.userData) continue;

    if (typeof mat.userData.__lm_opacity === 'number') {
      mat.opacity = mat.userData.__lm_opacity;
      mat.transparent = mat.opacity < 1.0 || !!mat.transparent;
    }

    if (typeof mat.userData.__lm_doubleSided === 'boolean') {
      mat.side = mat.userData.__lm_doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    }

    // unlit や chroma 系は将来的にリセット対応を拡張
    mat.needsUpdate = true;
  }
}

export function resetAllMaterials() {
  for (const [key] of __materialRegistry.entries()) {
    resetMaterial(key);
  }
}

// ---------------------------------------------------------------------------
// GLB loading & viewer boot (既存実装)
// ---------------------------------------------------------------------------

export async function ensureViewer(canvas) {
  if (renderer) {
    return;
  }

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  camera = new THREE.PerspectiveCamera(
    45,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    1000
  );
  camera.position.set(0, 2, 5);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
  scene.add(grid);

  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
}

export async function loadGlbFromDrive({ fileId, url }) {
  const GLTFLoader = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      gltf => {
        if (!scene) {
          reject(new Error('scene not initialized'));
          return;
        }

        // clean previous
        while (scene.children.length > 0) {
          scene.remove(scene.children[0]);
        }

        scene.add(gltf.scene);
        __scanSceneForMeshes(gltf.scene);
        __rebuildMaterialList();

        __currentGlbId = fileId || null;

        resolve({
          glbId: __currentGlbId,
          materials: listMaterials()
        });
      },
      undefined,
      err => reject(err)
    );
  });
}

export function getScene() {
  return scene;
}

export function setCurrentGlbId(id) {
  __currentGlbId = id;
}

export function getCurrentGlbId() {
  return __currentGlbId;
}

export function onRenderTick(fn) {
  // 将来的に render-loop の hook を整理する場合に拡張
}
