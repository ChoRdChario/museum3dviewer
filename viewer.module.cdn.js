// --- LM auth resolver without dynamic import (classic-safe) -----------------
// This block provides a token resolver that tries to use a globally bridged
// __lm_getAuth() if it exists (boot.esm.cdn.js side). If not available, it
// gracefully falls back to a no-token mode (403 from Drive is handled
// upstream).
//
// Expectation:
//   - window.__lm_getAuth(): Promise<{ access_token: string }> | null
// -----------------------------------------------------------------------------

const tokenResolver = typeof window !== 'undefined' && typeof window.__lm_getAuth === 'function'
  ? async () => {
      try {
        const tok = await window.__lm_getAuth();
        const accessToken = tok && tok.access_token;
        console.log('[viewer.auth] bridged token ok?', !!accessToken);
        return accessToken || null;
      } catch (e) {
        console.warn('[viewer.auth] token resolver failed', e);
        return null;
      }
    }
  : async () => {
      console.warn('[viewer.auth] no explicit auth bridge; falling back to noop token');
      return null;
    };

// -----------------------------------------------------------------------------
// viewer.module.cdn.js — Three.js viewer with LociMyu material hooks
// -----------------------------------------------------------------------------
// Public exports (consumed by glb.btn.bridge.v3.js / pin.runtime.bridge.js):
//   - ensureViewer(opts)
//   - loadGlbFromDrive(fileIdOrOptions)
//   - getScene()
//   - onRenderTick(cb)
//   - listMaterials()
//   - applyMaterialProps(materialKey, props)
//   - resetMaterial(materialKey)
//   - resetAllMaterials()
//   - addPinMarker(...)
//   - clearPins()
//   - removePinMarker(...)
//   - projectPoint(...)
//   - onCanvasShiftPick(...)
//   - setCurrentGlbId(id)
//   - getCurrentGlbId()
//   - setPinSelected(...)
// -----------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let _renderer = null;
let _scene = null;
let _camera = null;
let _canvas = null;
let _currentGlbId = null;
let _rootGroup = null;

let _onRenderCbs = [];
let _materialsByKey = new Map();    // materialKey -> material
let _materialOriginal = new Map();  // material -> shallow clone of original props

// -----------------------------------------------------------------------------
// Viewer core
// -----------------------------------------------------------------------------

function ensureViewer(opts = {}) {
  if (_renderer && _scene && _camera) {
    return { renderer: _renderer, scene: _scene, camera: _camera };
  }

  const { canvas } = opts;
  if (!canvas) throw new Error('ensureViewer requires { canvas }');

  _canvas = canvas;

  _renderer = new THREE.WebGLRenderer({ canvas: _canvas, antialias: true, alpha: true });
  _renderer.setPixelRatio(window.devicePixelRatio || 1);
  _renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0xffffff);

  _camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  _camera.position.set(0, 1, 3);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  _scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 10, 10);
  _scene.add(dir);

  // --- Very simple orbit-like controls (no OrbitControls dependency) --------
  let isDragging = false;
  let prev = { x: 0, y: 0 };
  let target = new THREE.Vector3(0, 0, 0);
  let spherical = new THREE.Spherical(3, Math.PI / 3, Math.PI / 4);

  const updateCamera = () => {
    spherical.makeSafe();
    const sinPhiRadius = Math.sin(spherical.phi) * spherical.radius;
    _camera.position.set(
      sinPhiRadius * Math.sin(spherical.theta),
      Math.cos(spherical.phi) * spherical.radius,
      sinPhiRadius * Math.cos(spherical.theta)
    );
    _camera.lookAt(target);
  };

  canvas.addEventListener('mousedown', (ev) => {
    isDragging = true;
    prev.x = ev.clientX;
    prev.y = ev.clientY;
  });
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
  window.addEventListener('mousemove', (ev) => {
    if (!isDragging) return;
    const dx = ev.clientX - prev.x;
    const dy = ev.clientY - prev.y;
    prev.x = ev.clientX;
    prev.y = ev.clientY;

    const ROT_SPEED = 0.005;
    spherical.theta -= dx * ROT_SPEED;
    spherical.phi   -= dy * ROT_SPEED;
    spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));
    updateCamera();
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const ZOOM_SPEED = 0.001;
    spherical.radius *= (1 + ev.deltaY * ZOOM_SPEED);
    spherical.radius = Math.max(0.5, Math.min(100, spherical.radius));
    updateCamera();
  }, { passive: false });

  updateCamera();

  const renderLoop = () => {
    requestAnimationFrame(renderLoop);
    _onRenderCbs.forEach((cb) => cb && cb());
    if (_renderer && _scene && _camera) {
      _renderer.render(_scene, _camera);
    }
  };
  renderLoop();

  console.log('[viewer.module] viewer initialized');
  return { renderer: _renderer, scene: _scene, camera: _camera };
}

// ★ここを修正：文字列 / オブジェクト両対応にする
async function loadGlbFromDrive(fileIdOrOptions) {
  if (!_renderer || !_scene || !_camera || !_canvas) {
    throw new Error('Viewer not initialized; call ensureViewer({ canvas }) first');
  }

  let fileId = null;
  if (typeof fileIdOrOptions === 'string') {
    fileId = fileIdOrOptions;
  } else if (fileIdOrOptions && typeof fileIdOrOptions === 'object') {
    fileId = fileIdOrOptions.fileId || null;
  }

  if (!fileId) {
    throw new Error('loadGlbFromDrive requires fileId');
  }

  const accessToken = await tokenResolver();
  const hasToken = !!accessToken;

  console.log('[viewer.module] loading GLB from Drive', { fileId, hasToken });

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set('alt', 'media');

  const headers = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    console.error('[viewer.module] Drive fetch failed', res.status, res.statusText);
    throw new Error(`Drive fetch failed: ${res.status}`);
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      blobUrl,
      (gltf) => {
        if (_rootGroup) {
          _scene.remove(_rootGroup);
        }

        _rootGroup = gltf.scene || gltf.scenes[0];
        _scene.add(_rootGroup);

        _rootGroup.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });

        _rebuildMaterialList();
        console.log('[viewer.module] GLB loaded');

        resolve({ scene: _scene, root: _rootGroup, gltf });
      },
      undefined,
      (err) => {
        console.error('[viewer.module] GLTF load error', err);
        reject(err);
      }
    );
  });
}

function getScene() {
  return _scene;
}

function onRenderTick(cb) {
  if (typeof cb === 'function') {
    _onRenderCbs.push(cb);
  }
}

// -----------------------------------------------------------------------------
// Material utilities
// -----------------------------------------------------------------------------

function _materialKeyFromMaterial(mat) {
  if (!mat) return null;
  if (mat.name && mat.name.length > 0) return mat.name;
  return `mat_${mat.id}`;
}

function _allMeshes() {
  const meshes = [];
  if (!_rootGroup) return meshes;
  _rootGroup.traverse((obj) => {
    if (obj.isMesh) meshes.push(obj);
  });
  return meshes;
}

function _rebuildMaterialList() {
  _materialsByKey.clear();
  _materialOriginal.clear();

  const meshes = _allMeshes();
  for (const mesh of meshes) {
    const m = mesh.material;
    if (Array.isArray(m)) {
      m.forEach((mat) => {
        if (!mat) return;
        const key = _materialKeyFromMaterial(mat);
        _materialsByKey.set(key, mat);
        if (!_materialOriginal.has(mat)) {
          _materialOriginal.set(mat, {
            side: mat.side,
            transparent: mat.transparent,
            opacity: mat.opacity,
            toneMapped: mat.toneMapped !== undefined ? mat.toneMapped : true,
            color: mat.color ? mat.color.clone() : null,
            emissive: mat.emissive ? mat.emissive.clone() : null,
            emissiveIntensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1.0,
            lights: mat.lights !== undefined ? mat.lights : true,
          });
        }
        __hookMaterial(mat);
      });
    } else if (m) {
      const key = _materialKeyFromMaterial(m);
      _materialsByKey.set(key, m);
      if (!_materialOriginal.has(m)) {
        _materialOriginal.set(m, {
          side: m.side,
          transparent: m.transparent,
          opacity: m.opacity,
          toneMapped: m.toneMapped !== undefined ? m.toneMapped : true,
          color: m.color ? mat.color.clone() : null,
          emissive: m.emissive ? m.emissive.clone() : null,
          emissiveIntensity: m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1.0,
          lights: m.lights !== undefined ? m.lights : true,
        });
      }
      __hookMaterial(m);
    }
  }
}

// -----------------------------------------------------------------------------
// LociMyu material hook (safe shader patch + JS-side fallbacks)
// -----------------------------------------------------------------------------

function listMaterials() {
  _rebuildMaterialList();
  const out = [];
  for (const [key, mat] of _materialsByKey.entries()) {
    out.push({
      key,
      name: mat.name || key,
    });
  }
  return out;
}

/**
 * Apply per-material properties coming from the Material tab UI.
 *
 * props:
 *   - opacity: number (0.0–1.0)
 *   - doubleSided: boolean
 *   - unlitLike: boolean
 *   - chromaEnable: boolean
 *   - chromaColor: string "#rrggbb"
 *   - chromaTolerance: number
 */
function applyMaterialProps(materialKey, props) {
  if (!_rootGroup) return;
  if (!materialKey) return;

  _rebuildMaterialList();

  const mat = _materialsByKey.get(materialKey);
  if (!mat) {
    console.warn('[viewer.materials] applyMaterialProps: no material for key', materialKey);
    return;
  }

  const original = _materialOriginal.get(mat) || {};

  const {
    opacity = mat.opacity,
    doubleSided = (mat.side === THREE.DoubleSide),
    unlitLike = false,
    chromaEnable = false,
    chromaColor = '#000000',
    chromaTolerance = 0.1,
  } = props || {};

  // Opacity
  mat.opacity = opacity;
  mat.transparent = opacity < 1.0 || original.transparent;

  // Double-sided
  mat.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;

  // JS-side unlit approximation (in addition to shader hook)
  if (unlitLike) {
    if (!mat.userData.__lmUnlitBackup) {
      mat.userData.__lmUnlitBackup = {
        emissive: mat.emissive ? mat.emissive.clone() : null,
        emissiveIntensity: mat.emissiveIntensity,
        toneMapped: mat.toneMapped,
        lights: mat.lights,
      };
    }
    mat.lights = false;
    if (mat.emissive && mat.color) {
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = 1.0;
    }
    if (mat.toneMapped !== undefined) {
      mat.toneMapped = false;
    }
  } else if (mat.userData.__lmUnlitBackup) {
    const b = mat.userData.__lmUnlitBackup;
    if (mat.emissive && b.emissive) {
      mat.emissive.copy(b.emissive);
    }
    if (b.emissiveIntensity !== undefined) {
      mat.emissiveIntensity = b.emissiveIntensity;
    }
    if (b.toneMapped !== undefined && mat.toneMapped !== undefined) {
      mat.toneMapped = b.toneMapped;
    }
    if (b.lights !== undefined) {
      mat.lights = b.lights;
    }
  }

  // Shader-uniform bridge
  if (!mat.userData.__lmUniforms) {
    mat.userData.__lmUniforms = {
      uWhiteThr:     { value: 0.92 },
      uBlackThr:     { value: 0.08 },
      uWhiteToAlpha: { value: false },
      uBlackToAlpha: { value: false },
      uUnlit:        { value: false },
    };
  }

  const u = mat.userData.__lmUniforms;
  u.uUnlit.value = !!unlitLike;

  // クロマキー系はまだ無効だが、将来用に値だけ受け取っている
  u.uWhiteToAlpha.value = false;
  u.uBlackToAlpha.value = false;

  mat.needsUpdate = true;

  console.log('[viewer.materials] applyMaterialProps', materialKey, {
    opacity: mat.opacity,
    doubleSided,
    unlitLike,
  });
}

function resetMaterial(materialKey) {
  if (!materialKey) return;
  _rebuildMaterialList();
  const mat = _materialsByKey.get(materialKey);
  if (!mat) return;

  const original = _materialOriginal.get(mat);
  if (!original) return;

  mat.side = original.side;
  mat.transparent = original.transparent;
  mat.opacity = original.opacity;
  if (mat.toneMapped !== undefined && original.toneMapped !== undefined) {
    mat.toneMapped = original.toneMapped;
  }
  if (mat.color && original.color) {
    mat.color.copy(original.color);
  }
  if (mat.emissive && original.emissive) {
    mat.emissive.copy(original.emissive);
  }
  if (original.emissiveIntensity !== undefined) {
    mat.emissiveIntensity = original.emissiveIntensity;
  }
  if (original.lights !== undefined) {
    mat.lights = original.lights;
  }

  if (mat.userData.__lmUniforms) {
    mat.userData.__lmUniforms.uUnlit.value = false;
    mat.userData.__lmUniforms.uWhiteToAlpha.value = false;
    mat.userData.__lmUniforms.uBlackToAlpha.value = false;
  }

  mat.needsUpdate = true;
  console.log('[viewer.materials] resetMaterial', materialKey);
}

function resetAllMaterials() {
  _rebuildMaterialList();
  for (const key of _materialsByKey.keys()) {
    resetMaterial(key);
  }
}

// -----------------------------------------------------------------------------
// Safe shader hook: only post-process at the end of the fragment shader
// -----------------------------------------------------------------------------

function __hookMaterial(mat) {
  if (!mat || mat.__lmHooked) return;
  mat.__lmHooked = true;

  mat.userData.__lmUniforms = {
    uWhiteThr:     { value: 0.92 },
    uBlackThr:     { value: 0.08 },
    uWhiteToAlpha: { value: false },
    uBlackToAlpha: { value: false },
    uUnlit:        { value: false },
  };
  const u = mat.userData.__lmUniforms;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms = { ...shader.uniforms, ...u };

    if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        #include <dithering_fragment>

        // LociMyu material hook (unlit & chroma-like)
        vec3 lmColor = gl_FragColor.rgb;
        float lmLuma = dot(lmColor, vec3(0.299, 0.587, 0.114));

        if (uWhiteToAlpha && lmLuma >= uWhiteThr) {
          gl_FragColor.a = 0.0;
        }
        if (uBlackToAlpha && lmLuma <= uBlackThr) {
          gl_FragColor.a = 0.0;
        }

        // Unlit-like: overwrite final lit color with the base diffuse color
        // so the result is effectively unshaded.
        if (uUnlit) {
          gl_FragColor.rgb = diffuseColor.rgb;
        }
        `
      );
    }
  };

  mat.needsUpdate = true;
}

// -----------------------------------------------------------------------------
// Pin API (既存仕様を維持)
// -----------------------------------------------------------------------------

let _pinGroup = null;

function _ensurePinGroup() {
  if (!_scene) return null;
  if (!_pinGroup) {
    _pinGroup = new THREE.Group();
    _pinGroup.name = 'LociMyuPinGroup';
    _scene.add(_pinGroup);
  }
  return _pinGroup;
}

function addPinMarker({ id, position, color = 0xff0000 }) {
  const group = _ensurePinGroup();
  if (!group) return;

  const geo = new THREE.SphereGeometry(0.01, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(position.x, position.y, position.z);
  mesh.userData.lmPinId = id;

  group.add(mesh);
}

function clearPins() {
  if (!_pinGroup) return;
  while (_pinGroup.children.length) {
    const c = _pinGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}

function removePinMarker(id) {
  if (!_pinGroup) return;
  const toRemove = _pinGroup.children.filter((c) => c.userData.lmPinId === id);
  for (const c of toRemove) {
    _pinGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}

function projectPoint(worldPosition) {
  if (!_camera || !_renderer) return null;
  const vector = new THREE.Vector3(worldPosition.x, worldPosition.y, worldPosition.z);
  vector.project(_camera);
  const x = (vector.x * 0.5 + 0.5) * _renderer.domElement.clientWidth;
  const y = (-vector.y * 0.5 + 0.5) * _renderer.domElement.clientHeight;
  return { x, y };
}

function onCanvasShiftPick(cb) {
  if (!_canvas) return;
  _canvas.addEventListener('click', (ev) => {
    if (!ev.shiftKey) return;
    if (!cb) return;
    cb({ clientX: ev.clientX, clientY: ev.clientY });
  });
}

function setCurrentGlbId(id) {
  _currentGlbId = id;
}

function getCurrentGlbId() {
  return _currentGlbId;
}

function setPinSelected(/* id, selected */) {
  // no-op for now
}

// -----------------------------------------------------------------------------
// Expose API
// -----------------------------------------------------------------------------

export {
  ensureViewer,
  loadGlbFromDrive,
  getScene,
  onRenderTick,
  listMaterials,
  applyMaterialProps,
  resetMaterial,
  resetAllMaterials,
  addPinMarker,
  clearPins,
  removePinMarker,
  projectPoint,
  onCanvasShiftPick,
  setCurrentGlbId,
  getCurrentGlbId,
  setPinSelected,
};

export default {
  ensureViewer,
  loadGlbFromDrive,
  getScene,
  onRenderTick,
  listMaterials,
  applyMaterialProps,
  resetMaterial,
  resetAllMaterials,
  addPinMarker,
  clearPins,
  removePinMarker,
  projectPoint,
  onCanvasShiftPick,
  setCurrentGlbId,
  getCurrentGlbId,
  setPinSelected,
};
