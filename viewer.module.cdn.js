
// viewer.module.cdn.js — robust Drive auth + single THREE instance + bridge signals
// Version: V6_15_drive403_fix1
// Assumes import map defines "three" and "three/addons/*"

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------- internal state ----------------
let __scene = null;
let __renderer = null;
let __camera = null;
let __controls = null;
let __rootEl = null;
let __onRenderTick = null;

function _log(...a){ console.log('[viewer-impl]', ...a); }
function _warn(...a){ console.warn('[viewer-impl]', ...a); }

// ---------------- exports required by boot.esm.cdn.js ----------------
export function getScene(){ return __scene; }
export function onRenderTick(fn){ __onRenderTick = typeof fn === 'function' ? fn : null; }

export function ensureViewer(rootSelectorOrEl = '#stage'){
  // root can be string or element
  const root = (typeof rootSelectorOrEl === 'string')
    ? document.querySelector(rootSelectorOrEl)
    : rootSelectorOrEl;
  if (!root) throw new Error('ensureViewer: root element not found');
  __rootEl = root;

  if (__renderer) return; // already

  // canvas / renderer
  __renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  __renderer.setSize(root.clientWidth, root.clientHeight);
  __renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.innerHTML = '';
  root.appendChild(__renderer.domElement);

  // scene / camera
  __scene = new THREE.Scene();
  __scene.background = null;

  __camera = new THREE.PerspectiveCamera(60, root.clientWidth / root.clientHeight, 0.1, 10000);
  __camera.position.set(2.5, 1.8, 3.5);

  __controls = new OrbitControls(__camera, __renderer.domElement);
  __controls.enableDamping = true;

  // resize
  const onResize = () => {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    __renderer.setSize(w, h);
    __camera.aspect = w / h;
    __camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();

  // main loop
  const loop = () => {
    requestAnimationFrame(loop);
    __controls && __controls.update();
    if (__onRenderTick) { try { __onRenderTick({scene:__scene, camera:__camera, renderer:__renderer}); } catch(e){} }
    __renderer.render(__scene, __camera);
  };
  loop();

  _log('ready (three r' + THREE.REVISION + ')');
}

// ---------------- Drive auth helpers ----------------
async function getAccessToken(){
  try {
    if (typeof window.__lm_getAccessToken === 'function') return await window.__lm_getAccessToken();
    if (window.lm && window.lm.auth && typeof window.lm.auth.getAccessToken === 'function') return await window.lm.auth.getAccessToken();
    if (window.gauth && typeof window.gauth.getAccessToken === 'function') return await window.gauth.getAccessToken();
  } catch(e){ _warn('getAccessToken failed', e); }
  return null;
}

async function authFetch(url, init={}){
  // allow upstream custom wrapper first
  if (typeof window.__lm_fetchAuth === 'function'){
    return await window.__lm_fetchAuth(url, init);
  }
  const token = await getAccessToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, {...init, headers});
}

// normalize various Drive picker shapes into string id
function normalizeFileId(ref){
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (Array.isArray(ref) && ref.length > 0) return normalizeFileId(ref[0]);
  if (ref.id) return ref.id;
  if (ref.fileId) return ref.fileId;
  if (ref.resourceId) return ref.resourceId;
  return null;
}

// ---------------- GLB loading ----------------
export async function loadGlbFromDrive(fileRef){
  if (!__scene) throw new Error('ensureViewer() must be called before loadGlbFromDrive()');
  const fileId = normalizeFileId(fileRef);
  if (!fileId) throw new Error('loadGlbFromDrive: invalid file id');

  // Drive media endpoint (supports Shared Drives & large files)
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const qs = 'alt=media&supportsAllDrives=true&acknowledgeAbuse=true';
  const url = `${base}?${qs}`;

  // fetch as blob with auth
  const res = await authFetch(url);
  if (!res.ok){
    const text = await res.text().catch(()=>'');
    const msg = `[Drive fetch failed ${res.status}] ${text.slice(0,180)}`;
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectURL = URL.createObjectURL(blob);

  // clear scene
  while(__scene.children.length) __scene.remove(__scene.children[0]);
  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  __scene.add(hemi);

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(objectURL);
  URL.revokeObjectURL(objectURL);

  __scene.add(gltf.scene);

  // center / frame
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  __controls && __controls.target.copy(center);
  __camera && __camera.position.set(center.x + size*0.6, center.y + size*0.3, center.z + size*0.6);
  __camera && __camera.lookAt(center);

  // notify UI/bridge
  try {
    window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', {detail:{scene:__scene}}));
    if (window.lm && typeof window.lm.__resolveReadyScene === 'function'){
      window.lm.__resolveReadyScene(__scene);
    }
  } catch(e){ _warn('ready signal failed', e); }

  _log('GLB loaded from Drive', fileId);
}

// ---------------- Pins (minimal stubs preserved) ----------------
const __pins = new Map();
export function addPinMarker(id, position=[0,0,0]){
  if (!__scene) return;
  const geom = new THREE.SphereGeometry(0.01, 12, 12);
  const mat = new THREE.MeshBasicMaterial({color:0xff8800});
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.fromArray(position);
  __scene.add(mesh);
  __pins.set(id, mesh);
}
export function removePinMarker(id){
  const m = __pins.get(id);
  if (m && __scene){ __scene.remove(m); __pins.delete(id); }
}
export function clearPins(){
  for (const m of __pins.values()){ __scene && __scene.remove(m); }
  __pins.clear();
}
export function setPinSelected(id, selected){
  const m = __pins.get(id);
  if (m) m.material.color.set(selected ? 0x33ccff : 0xff8800);
}
export function onCanvasShiftPick(){ /* no-op here; boot file can attach */ }
export function onPinSelect(){ /* no-op; passed in from boot as needed */ }

export function projectPoint(x,y,z){
  if (!__camera || !__renderer) return null;
  const v = new THREE.Vector3(x,y,z).project(__camera);
  // from NDC to screen px
  const w = __renderer.domElement.clientWidth;
  const h = __renderer.domElement.clientHeight;
  return { x: (v.x + 1) * 0.5 * w, y: (1 - (v.y + 1) * 0.5) * h };
}

_log('loaded (three r'+THREE.REVISION+')');
