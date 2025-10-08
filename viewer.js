
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseDriveId, buildDriveDownloadUrl } from './utils_drive_api.js';
import { getAccessToken } from './gauth.module.js';

let renderer, scene, camera, controls;
let currentColor = '#60a5fa';

function log(...a){ console.log('[viewer]', ...a); }

export function ensureViewer() {
  if (renderer) return { renderer, scene, camera, controls };
  const canvas = document.getElementById('viewer-canvas');
  const status = document.getElementById('viewer-status');

  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight || 600;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);

  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
  camera.position.set(2.5, 1.5, 2.5);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(2, 3, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  const grid = new THREE.GridHelper(10, 10, 0x222222, 0x222222);
  grid.position.y = -1;
  scene.add(grid);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    const w2 = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h2 = canvas.clientHeight || canvas.parentElement.clientHeight || 600;
    renderer.setSize(w2, h2);
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
  });

  status.textContent = 'ready';
  log('ready');
  return { renderer, scene, camera, controls };
}

export function setPinColor(hex) {
  currentColor = hex;
  log('color set', hex);
}

export async function loadGLB(input) {
  ensureViewer();
  const id = parseDriveId(input);
  let url = input;
  let headers = {};

  if (id) {
    url = buildDriveDownloadUrl(id);
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  // Clear previous
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const obj = scene.children[i];
    if (obj.isMesh || obj.isGroup) scene.remove(obj);
  }

  const loader = new GLTFLoader();
  // Inject fetch with headers for Drive
  loader.manager.setURLModifier((u) => u);
  const origFetch = self.fetch.bind(self);
  self.fetch = (resource, init={}) => {
    const ru = String(resource);
    if (ru.startsWith('https://www.googleapis.com/drive/v3/files/')) {
      init.headers = Object.assign({}, init.headers || {}, headers);
    }
    return origFetch(resource, init);
  };

  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      scene.add(gltf.scene);
      controls.fitToBox?.(gltf.scene, true);
      resolve(gltf);
    }, undefined, (e) => {
      reject(e);
    });
  }).finally(() => {
    self.fetch = origFetch; // restore
  });
}

// Minimal pin APIs kept for compatibility with pins.js (no-op visuals yet)
export function addPinAtCenter(title, body) {
  console.log('[viewer] addPinAtCenter', title, body, currentColor);
}
export function clearPins() {
  console.log('[viewer] clearPins');
}
