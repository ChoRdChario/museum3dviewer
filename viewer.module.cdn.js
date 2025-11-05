
// viewer.module.cdn.js — hardened ensureViewer root handling (three r159)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const log = (...a)=>console.log('[viewer-impl]', ...a);
const warn = (...a)=>console.warn('[viewer-impl]', ...a);

let _scene = null;
let _renderer = null;
let _camera = null;
let _controls = null;

function _resolveRoot(arg) {
  // Accepts: undefined | string selector | HTMLElement | {root|el|selector}
  if (!arg) return document.querySelector('#stage') || document.body;
  if (typeof arg === 'string') return document.querySelector(arg);
  if (arg instanceof HTMLElement) return arg;
  if (arg && arg.root) return _resolveRoot(arg.root);
  if (arg && arg.el) return _resolveRoot(arg.el);
  if (arg && arg.selector) return _resolveRoot(arg.selector);
  // Fallback
  return document.querySelector('#stage') || document.body;
}

function _ensureRenderer(rootEl) {
  if (_renderer) return _renderer;
  const canvas = document.createElement('canvas');
  const ctxAttr = { antialias: true, alpha: true, powerPreference: 'high-performance' };
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  // three r159: use outputColorSpace instead of outputEncoding
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  _renderer.setPixelRatio(window.devicePixelRatio || 1);
  _renderer.setSize(rootEl.clientWidth || rootEl.offsetWidth || 800, rootEl.clientHeight || rootEl.offsetHeight || 600);
  if (typeof rootEl.appendChild === 'function') {
    rootEl.appendChild(_renderer.domElement);
  } else {
    warn('root.appendChild not available; falling back to document.body');
    document.body.appendChild(_renderer.domElement);
  }
  return _renderer;
}

export function ensureViewer(arg) {
  const rootEl = _resolveRoot(arg);
  if (!rootEl) {
    warn('ensureViewer(): root element not found; aborting init');
    return;
  }
  if (!_scene) {
    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x000000);
  }
  const W = (rootEl.clientWidth || 1280);
  const H = (rootEl.clientHeight || 720);
  if (!_camera) {
    _camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 5000);
    _camera.position.set(0, 1, 3);
  } else {
    _camera.aspect = W / H;
    _camera.updateProjectionMatrix();
  }
  const r = _ensureRenderer(rootEl);
  if (!_controls) {
    _controls = new OrbitControls(_camera, r.domElement);
  }
  // simple animate hook (idempotent)
  if (!ensureViewer._animBound) {
    ensureViewer._animBound = true;
    const tick = ()=>{
      onRenderTick();
      r.render(_scene, _camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

export function getScene() { return _scene; }

export async function loadGlbFromDrive(fileIdOrUrl) {
  // Token getters (any of the known surfaces)
  async function _getToken() {
    try {
      if (window.__lm_getAccessToken) return await window.__lm_getAccessToken();
      if (window.lm && window.lm.auth && window.lm.auth.getAccessToken) return await window.lm.auth.getAccessToken();
      if (window.gauth && window.gauth.getAccessToken) return await window.gauth.getAccessToken();
    } catch(e){ /* ignore */ }
    return null;
  }
  function _extractFileId(s) {
    if (!s) return s;
    if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s; // looks like an ID
    // try URL forms
    try {
      const u = new URL(s);
      // /file/d/<id>/
      const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/);
      if (m) return m[1];
      if (u.searchParams.get('id')) return u.searchParams.get('id');
    } catch(e){}
    return s;
  }

  const fileId = _extractFileId(fileIdOrUrl);
  const token = await _getToken();
  if (!token) throw new Error('No OAuth token; please Sign in.');

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    throw new Error(`Drive fetch failed ${res.status}: ${txt.slice(0,120)}`);
  }
  const blob = await res.blob();
  const objectURL = URL.createObjectURL(blob);

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(objectURL);
  URL.revokeObjectURL(objectURL);

  // clear scene
  if (!_scene) _scene = new THREE.Scene();
  for (let i = _scene.children.length - 1; i >= 0; i--) _scene.remove(_scene.children[i]);

  _scene.add(gltf.scene);
  _scene.updateMatrixWorld(true);

  // auto frame
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = new THREE.Vector3(); const center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 1.8;
  if (!_camera) _camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 5000);
  _camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.6, dist)));
  _camera.lookAt(center);

  // notify UI/bridge
  try {
    if (window.lm && typeof window.lm.__resolveReadyScene === 'function') window.lm.__resolveReadyScene(_scene);
    window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail: { scene: _scene }}));
  } catch(e){ warn('notify ready failed', e); }

  return true;
}

// --- Pins & helpers (implemented as safe no-ops unless overridden later) ---
export function addPinMarker() {}
export function removePinMarker() {}
export function clearPins() {}
export function onCanvasShiftPick() {}
export function onPinSelect() {}
export function onRenderTick() {}
export function setPinSelected() {}
export function projectPoint() {}

log('loaded (three r159)');
