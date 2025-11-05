
// viewer.module.cdn.js (patched)
// - Normalizes Drive fileId argument (accepts string or picker file object)
// - Uses auth-aware fetch if available (window.__lm_fetchAuth), falling back to fetch
// - Keeps three.js imports via import map alias "three"
// - Emits pm:scene-deep-ready after successful GLB load

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

console.log('[viewer-impl] loaded (three r' + THREE.REVISION + ')');

let _scene, _renderer, _camera, _controls;

// ---------------- auth-aware fetch ----------------
async function authFetch(url, init = {}) {
  // Prefer a host-provided auth fetch (adds Bearer automatically)
  if (typeof window.__lm_fetchAuth === 'function') {
    return window.__lm_fetchAuth(url, init);
  }
  // Fallback: attempt to inject an access token if host exposes a getter
  const tokGetter =
    (typeof window.__lm_getAccessToken === 'function' && window.__lm_getAccessToken) ||
    (typeof window.__lm_getToken === 'function' && window.__lm_getToken) ||
    null;

  if (tokGetter) {
    try {
      const tok = await tokGetter();
      if (tok) {
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', `Bearer ${tok}`);
        return fetch(url, { ...init, headers });
      }
    } catch (e) {
      console.warn('[viewer] token getter failed, falling back to fetch', e);
    }
  }
  // Last resort: plain fetch (will 401 if the file is private)
  return fetch(url, init);
}

// --------------- utils ----------------
function _resolveContainer(arg) {
  // Accepts: string CSS selector, HTMLElement, HTMLCanvasElement, or {container, canvas, selector}
  if (!arg) return document.getElementById('stage') || document.body;

  if (typeof arg === 'string') {
    const el = document.querySelector(arg);
    if (el) return el;
  }
  // HTMLElement / Canvas directly
  if (arg instanceof HTMLElement) return arg;

  // options bag
  if (typeof arg === 'object') {
    if (arg.canvas instanceof HTMLCanvasElement) return arg.canvas;
    if (arg.container instanceof HTMLElement) return arg.container;
    if (typeof arg.selector === 'string') {
      const el = document.querySelector(arg.selector);
      if (el) return el;
    }
  }
  // fallback
  return document.getElementById('stage') || document.body;
}

function _normalizeFileId(input) {
  // Accepts: fileId string OR Google Drive Picker/Files API object
  if (!input) return null;
  if (typeof input === 'string') return input.trim();
  if (typeof input === 'object') {
    // common shapes: {id}, {fileId}, {resourceId}
    if (input.id) return String(input.id);
    if (input.fileId) return String(input.fileId);
    if (input.resourceId) return String(input.resourceId);
    // sometimes picker returns array: [{id: '...'}]
    if (Array.isArray(input) && input.length && input[0].id) return String(input[0].id);
  }
  return null;
}

// --------------- core viewer ----------------
export function getScene() { return _scene; }

export function ensureViewer(opts) {
  const mount = _resolveContainer(opts);
  // create or reuse renderer/camera/controls
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ antialias: true, canvas: (mount instanceof HTMLCanvasElement) ? mount : undefined });
    _renderer.setPixelRatio(window.devicePixelRatio || 1);
    _renderer.setSize(mount.clientWidth || 1280, mount.clientHeight || 720, false);
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (!(mount instanceof HTMLCanvasElement)) {
      mount.innerHTML = ''; // clear previous
      mount.appendChild(_renderer.domElement);
    }
  }

  if (!_scene) {
    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x0b0e13);
  }

  if (!_camera) {
    _camera = new THREE.PerspectiveCamera(50, (_renderer.domElement.width || 1280) / (_renderer.domElement.height || 720), 0.1, 5000);
    _camera.position.set(2.5, 1.5, 3.5);
  }

  if (!_controls) {
    _controls = new OrbitControls(_camera, _renderer.domElement);
    _controls.enableDamping = true;
  }

  // RAF loop
  if (!ensureViewer._loop) {
    const loop = () => {
      requestAnimationFrame(loop);
      _controls && _controls.update();
      if (typeof onRenderTick === 'function') onRenderTick();
      if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
    };
    ensureViewer._loop = true;
    loop();
  }

  return { scene: _scene, renderer: _renderer, camera: _camera, controls: _controls };
}

export async function loadGlbFromDrive(fileRef) {
  const fileId = _normalizeFileId(fileRef);
  if (!fileId) {
    throw new Error('Invalid Drive file reference (expected fileId or {id:...})');
  }
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await authFetch(url);
  if (!res.ok) {
    throw new Error(`Drive fetch failed ${res.status}`);
  }
  const blob = await res.blob();
  const objectURL = URL.createObjectURL(blob);

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(objectURL);

  // clear old
  if (_scene) {
    while (_scene.children.length) _scene.remove(_scene.children.pop());
  } else {
    ensureViewer();
  }
  _scene.add(gltf.scene);

  // center & frame
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDist = maxDim / (2 * Math.atan((Math.PI * 50) / 360));
  _camera.position.copy(center).add(new THREE.Vector3(fitDist, fitDist, fitDist));
  _camera.near = maxDim / 1000; _camera.far = maxDim * 1000; _camera.updateProjectionMatrix();
  _controls && _controls.target.copy(center);

  // notify deep-ready for UI/material population
  try {
    window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail: { scene: _scene } }));
    if (window.lm && typeof window.lm.__resolveReadyScene === 'function') {
      window.lm.__resolveReadyScene(_scene);
    }
  } catch (e) {
    console.warn('[viewer] deep-ready notify failed', e);
  }

  return gltf;
}

// ---- pins API (minimal, no-op-safe) ----
const _pins = new Map();

export function addPinMarker(id, position = { x: 0, y: 0, z: 0 }) {
  if (!_scene) ensureViewer();
  const geom = new THREE.SphereGeometry(0.01, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8844 });
  const m = new THREE.Mesh(geom, mat);
  m.position.set(position.x, position.y, position.z);
  _scene.add(m);
  _pins.set(id, m);
  return m;
}
export function removePinMarker(id) {
  const m = _pins.get(id);
  if (m && _scene) { _scene.remove(m); _pins.delete(id); }
}
export function clearPins() {
  for (const m of _pins.values()) { _scene && _scene.remove(m); }
  _pins.clear();
}
export function setPinSelected(id, sel) {
  const m = _pins.get(id);
  if (m) m.material.emissive && (m.material.emissiveIntensity = sel ? 1.0 : 0.2);
}
export function onCanvasShiftPick() { /* placeholder */ }
export function onPinSelect() { /* placeholder */ }
export function onRenderTick() { /* placeholder */ }

export function projectPoint(world) {
  if (!_camera || !_renderer) return null;
  const v = new THREE.Vector3(world.x, world.y, world.z);
  v.project(_camera);
  const halfW = _renderer.domElement.clientWidth / 2;
  const halfH = _renderer.domElement.clientHeight / 2;
  return { x: (v.x * halfW) + halfW, y: (-v.y * halfH) + halfH };
}

// allow boot code to set scene explicitly if needed
export function __set_lm_scene(s) { _scene = s; }
