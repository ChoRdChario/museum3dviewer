
// viewer.module.cdn.js — robust single-THREE implementation (r159-compatible)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log('[viewer-impl] loaded (three r' + THREE.REVISION + ')');

// ----- module-scoped state -----
let _renderer = null;
let _scene = null;
let _camera = null;
let _controls = null;
let _canvas = null;
let _rafId = null;
let _onRenderTick = null;

// expose a minimal lm namespace for bridges, but don't overwrite existing getters
const lm = (window.lm ||= {});
if (!('getScene' in lm)) {
  Object.defineProperty(lm, 'getScene', { get: () => _scene });
}

// Promise that resolves when a scene has been populated by GLB loader
let _resolveReadyScene;
lm.readyScenePromise = new Promise((res) => { _resolveReadyScene = res; });

function _getElementFromMaybeSelector(maybe, fallbackSelector) {
  // Accept: string(css), HTMLElement, null/undefined, or options object with .selector/.container/.canvas
  if (!maybe) return document.querySelector(fallbackSelector);
  if (typeof maybe === 'string') return document.querySelector(maybe);
  // HTMLElement?
  if (maybe instanceof HTMLElement) return maybe;
  // Options object?
  if (typeof maybe === 'object') {
    if (maybe.canvas instanceof HTMLCanvasElement) return maybe.canvas;
    if (typeof maybe.canvas === 'string') {
      const el = document.querySelector(maybe.canvas);
      if (el) return el;
    }
    if (maybe.container instanceof HTMLElement) return maybe.container;
    if (typeof maybe.container === 'string') {
      const el = document.querySelector(maybe.container);
      if (el) return el;
    }
    if (typeof maybe.selector === 'string') return document.querySelector(maybe.selector);
  }
  // Fallback
  return document.querySelector(fallbackSelector);
}

function _ensureCanvas(containerOrCanvas) {
  // If canvas provided, use it. If container provided, find/create a canvas inside.
  if (containerOrCanvas instanceof HTMLCanvasElement) return containerOrCanvas;

  const container = containerOrCanvas || document.body;
  let cvs = container.querySelector?.('canvas');
  if (!cvs) {
    cvs = document.createElement('canvas');
    cvs.id = 'lm-canvas';
    cvs.style.width = '100%';
    cvs.style.height = '100%';
    cvs.style.display = 'block';
    container.appendChild(cvs);
  }
  return cvs;
}

export function getScene() {
  return _scene;
}

export function onRenderTick(fn) {
  _onRenderTick = typeof fn === 'function' ? fn : null;
}

export function ensureViewer(opts) {
  // opts can be: string selector, HTMLElement, HTMLCanvasElement, or {container, canvas, selector, antialias}
  const target = _getElementFromMaybeSelector(opts, '#stage');
  _canvas = _ensureCanvas(target);

  // renderer
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ canvas: _canvas, antialias: !!(opts && opts.antialias) });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    _renderer.setSize(_canvas.clientWidth || window.innerWidth, _canvas.clientHeight || window.innerHeight, false);
    // r159+: outputColorSpace
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  // scene/camera
  if (!_scene) _scene = new THREE.Scene();
  if (!_camera) {
    _camera = new THREE.PerspectiveCamera(60, (_canvas.clientWidth || window.innerWidth) / (_canvas.clientHeight || window.innerHeight), 0.1, 2000);
    _camera.position.set(0, 1.2, 3);
  }

  // controls
  if (!_controls) {
    _controls = new OrbitControls(_camera, _renderer.domElement);
    _controls.enableDamping = true;
  }

  // resize
  function onResize() {
    const w = _canvas.clientWidth || window.innerWidth;
    const h = _canvas.clientHeight || window.innerHeight;
    _renderer.setSize(w, h, false);
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  // loop
  function loop(t) {
    _rafId = requestAnimationFrame(loop);
    _controls?.update();
    _onRenderTick?.(t, { renderer: _renderer, scene: _scene, camera: _camera });
    _renderer.render(_scene, _camera);
  }
  if (!_rafId) _rafId = requestAnimationFrame(loop);

  return { renderer: _renderer, scene: _scene, camera: _camera, controls: _controls };
}

// Drive fetch helper
async function _fetchDriveFileBlob(token, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive fetch failed ${res.status}`);
  return await res.blob();
}

export async function loadGlbFromDrive(token, fileId) {
  if (!token) throw new Error('token is required');
  if (!fileId) throw new Error('fileId is required');
  if (!_renderer) ensureViewer('#stage');

  const blob = await _fetchDriveFileBlob(token, fileId);
  const objectURL = URL.createObjectURL(blob);
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(objectURL);

    // clear old
    if (_scene) {
      const toRemove = [];
      _scene.traverse((o) => {
        if (o.isMesh || o.isGroup || o.isObject3D) {
          if (o.parent === _scene) toRemove.push(o);
        }
      });
      toRemove.forEach(o => _scene.remove(o));
    }

    _scene.add(gltf.scene);

    // fit camera
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = _camera.fov * (Math.PI / 180);
    const dist = (maxDim / 2) / Math.tan(fov / 2);
    _camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist * 0.6, dist)));
    _camera.lookAt(center);
    _controls?.target.copy(center);
    _controls?.update();

    // notify deep-ready
    try {
      window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail: { scene: _scene } }));
      if (typeof _resolveReadyScene === 'function') _resolveReadyScene(_scene);
      if (window.lm && typeof window.lm.__resolveReadyScene === 'function') window.lm.__resolveReadyScene(_scene);
    } catch (e) {
      console.warn('[viewer-impl] ready dispatch failed', e);
    }
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

// ----- pins (minimal stub so boot.esm.cdn.js doesn’t break) -----
const _pinMeshes = new Map(); // id -> mesh

export function addPinMarker(id, position /* {x,y,z} */, color = 0xff0000) {
  if (!id) return;
  const geom = new THREE.SphereGeometry(0.01, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color });
  const m = new THREE.Mesh(geom, mat);
  m.position.set(position?.x || 0, position?.y || 0, position?.z || 0);
  _scene.add(m);
  _pinMeshes.set(id, m);
}

export function removePinMarker(id) {
  const m = _pinMeshes.get(id);
  if (m) {
    _scene.remove(m);
    _pinMeshes.delete(id);
  }
}

export function clearPins() {
  for (const m of _pinMeshes.values()) _scene.remove(m);
  _pinMeshes.clear();
}

export function onCanvasShiftPick(fn) {
  // wiring happens in boot.esm.cdn.js; here we just keep API surface
  // (left as no-op hook; if needed, attach raycaster handlers)
}

export function onPinSelect(fn) {
  // API hook (no-op here)
}

export function setPinSelected(id, selected) {
  const m = _pinMeshes.get(id);
  if (m) m.material.wireframe = !!selected;
}

export function onRenderTickDebug() {
  // utility to verify rAF calls; not used by boot
}

export function projectPoint(vec3) {
  if (!_camera || !_renderer) return null;
  const v = new THREE.Vector3(vec3.x, vec3.y, vec3.z).project(_camera);
  const halfW = (_renderer.domElement.width) / 2;
  const halfH = (_renderer.domElement.height) / 2;
  return { x: (v.x * halfW) + halfW, y: (-v.y * halfH) + halfH };
}
