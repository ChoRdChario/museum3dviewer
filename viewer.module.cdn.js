// viewer.module.cdn.js
import * as THREE from 'https://unpkg.com/three@0.155.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.155.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.155.0/examples/jsm/loaders/GLTFLoader.js';

let renderer, scene, camera, controls, loader;
let current;

export function ensureViewer({ canvas }) {
  if (renderer) return;
  if (!canvas) throw new Error('Viewer canvas not found');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  resize();

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 2000);
  camera.position.set(3, 2, 6);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(3, 10, 10);
  scene.add(dir);

  loader = new GLTFLoader();

  window.addEventListener('resize', resize);
  requestAnimationFrame(tick);
}

function resize() {
  if (!renderer) return;
  const c = renderer.domElement;
  const w = c.clientWidth || (c.parentElement ? c.parentElement.clientWidth : c.width);
  const h = c.clientHeight || (c.parentElement ? c.parentElement.clientHeight : c.height || 1);
  renderer.setSize(w, h, false);
  if (camera) {
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
}

function tick() {
  controls && controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

export async function loadGlbFromUrl(url, { token } = {}) {
  const isDrive = /google\.com\/uc\?/.test(url);
  let blobUrl = url;

  if (isDrive && token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive fetch failed: ${res.status}`);
    const blob = await res.blob();
    blobUrl = URL.createObjectURL(blob);
  }

  const gltf = await new GLTFLoader().loadAsync(blobUrl);
  if (isDrive && blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);

  if (current) {
    scene.remove(current);
    current.traverse?.(o => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach(mm => mm?.dispose?.());
      else m?.dispose?.();
    });
  }
  current = gltf.scene || gltf.scenes?.[0];
  scene.add(current);

  frameToObject(current);
}

function frameToObject(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.6, size * 0.4, size * 0.6));
  camera.near = Math.max(0.01, size / 1000);
  camera.far = Math.max(1000, size * 10);
  camera.updateProjectionMatrix();
  controls.update();
}

export const getScene = () => scene;
export const getCamera = () => camera;
export const getRenderer = () => renderer;