// viewer.module.cdn.js — unified viewer exports (no external delegates)
// Requires: importmap provides 'three' and 'three/addons/*'

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log('[viewer-impl] loaded (three r' + (THREE.REVISION||'?') + ')');

// --- internal state ---
let _scene = null;
let _renderer = null;
let _camera = null;
let _controls = null;
let _canvas = null;
let _tickers = new Set();
let _pins = new Map(); // id -> Object3D (for basic support)

// helper: try get scene from bridge (if viewer.bridge.module.js exposes it)
function _getBridgeScene() {
  try {
    if (window.lm && typeof window.lm.getScene === 'function') return window.lm.getScene();
    if (typeof window.getScene === 'function') return window.getScene();
  } catch(e) {}
  return null;
}

// ensure a basic viewer if host hasn't provided one
export function ensureViewer(canvasSelector = '#stage canvas') {
  // 1) prefer host/bridge scene if it exists
  const bridged = _getBridgeScene();
  if (bridged) {
    _scene = bridged;
    // try to locate camera/renderer via common globals (optional)
    if (window.lm && window.lm.__viewerCamera) _camera = window.lm.__viewerCamera;
    if (window.lm && window.lm.__renderer) _renderer = window.lm.__renderer;
    // we still install RAF tick to satisfy onRenderTick
    _installRAF();
    console.log('[viewer-impl] using bridged scene');
    return;
  }

  // 2) fallback: make a minimal scene
  if (!_scene) {
    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x111111);
  }
  if (!_canvas) {
    const host = document.querySelector(canvasSelector) || document.querySelector('#stage');
    _canvas = document.createElement('canvas');
    (host || document.body).appendChild(_canvas);
  }
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ canvas: _canvas, antialias: true });
    _renderer.setPixelRatio(window.devicePixelRatio || 1);
    _renderer.setSize(window.innerWidth, window.innerHeight);
    // update to new API
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  if (!_camera) {
    _camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);
    _camera.position.set(1.5, 1.5, 1.5);
  }
  if (!_controls) {
    _controls = new OrbitControls(_camera, _renderer.domElement);
  }
  window.addEventListener('resize', ()=>{
    if (!_renderer || !_camera) return;
    _renderer.setSize(window.innerWidth, window.innerHeight);
    _camera.aspect = window.innerWidth / window.innerHeight;
    _camera.updateProjectionMatrix();
  });
  _installRAF();
  console.log('[viewer-impl] minimal viewer ensured');
}

function _installRAF(){
  if (_installRAF._installed) return;
  _installRAF._installed = true;
  function loop(t){
    try {
      for (const fn of _tickers) {
        try { fn(t); } catch(e){ console.warn('[viewer-impl] ticker error', e); }
      }
      if (_renderer && _scene && _camera) {
        _renderer.render(_scene, _camera);
      }
    } finally {
      requestAnimationFrame(loop);
    }
  }
  requestAnimationFrame(loop);
}

export function onRenderTick(fn){
  if (typeof fn === 'function') _tickers.add(fn);
  return ()=>_tickers.delete(fn);
}

// drive download helper
async function fetchDriveFileBlob(fileId, token){
  if (!fileId) throw new Error('fileId required');
  if (!token) throw new Error('oauth token required');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`drive fetch failed ${res.status}`);
  return await res.blob();
}

export async function loadGlbFromDrive(token, fileId){
  // always return a Promise
  ensureViewer();
  const blob = await fetchDriveFileBlob(fileId, token);
  const url = URL.createObjectURL(blob);
  try {
    // clear old
    if (_scene) {
      // remove all children
      const toRemove = [..._scene.children];
      toRemove.forEach(c=>_scene.remove(c));
      // some light
      const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1.0);
      _scene.add(hemi);
    }
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    _scene.add(gltf.scene);

    // fit camera if we own it
    if (_camera) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const radius = Math.max(size.x, size.y, size.z) * 0.5;
      const dist = radius / Math.tan((_camera.fov * Math.PI/180)/2);
      _camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.6, dist)));
      _camera.lookAt(center);
    }

    // notify bridge listeners if present
    try {
      window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail: { scene: _scene }}));
      if (window.lm && typeof window.lm.__resolveReadyScene === 'function') {
        window.lm.__resolveReadyScene(_scene);
      }
    } catch(e){ console.warn('[viewer-impl] notify ready failed', e); }

    return { scene: _scene, gltf };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// simple helpers for pins (safe no-ops if not used)
export function addPinMarker(id, position = {x:0,y:0,z:0}){
  ensureViewer();
  const geom = new THREE.SphereGeometry(0.01, 16, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff4444 });
  const m = new THREE.Mesh(geom, mat);
  m.position.set(position.x, position.y, position.z);
  _scene.add(m);
  _pins.set(id, m);
  return m;
}
export function removePinMarker(id){
  const m = _pins.get(id);
  if (m && _scene) _scene.remove(m);
  _pins.delete(id);
}
export function clearPins(){
  for (const id of Array.from(_pins.keys())) removePinMarker(id);
}
export function onCanvasShiftPick(fn){ /* no-op hook, kept for API compatibility */ }
export function onPinSelect(fn){ /* no-op hook, kept for API compatibility */ }
export function setPinSelected(id, sel){ /* no-op */ }

export function projectPoint(world){
  // returns {x,y} in CSS pixels relative to renderer dom
  if (!_camera || !_renderer) return {x:0,y:0};
  const v = new THREE.Vector3(world.x, world.y, world.z);
  v.project(_camera);
  const w = _renderer.domElement.clientWidth;
  const h = _renderer.domElement.clientHeight;
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
}

export function getScene(){
  return _scene || _getBridgeScene();
}

// also attach minimal bridge so others can discover camera/renderer if needed
if (!window.lm) window.lm = {};
window.lm.__viewerCamera = _camera;
window.lm.__renderer = _renderer;