// features/viewer_host.js
// Three + GLTFLoader を動的ロードして、"lmy:load-glb-blob" を受けて描画する最小ホスト

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

console.log('[viewer_host] boot');

const container = document.getElementById('stage') || document.body;

// renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
container.appendChild(renderer.domElement);

// scene & camera
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0b);

const camera = new THREE.PerspectiveCamera(
  50,
  (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
  0.01,
  1000
);
camera.position.set(1.6, 1.0, 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.3);
dir.position.set(3, 5, 4);
scene.add(dir);

let currentRoot = null;

function fit(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.near = size / 1000;
  camera.far = size * 10;
  camera.updateProjectionMatrix();
  camera.position.copy(center).add(new THREE.Vector3(size * 0.5, size * 0.3, size * 0.5));
}

const loader = new GLTFLoader();

async function loadBlob(blob, name = 'model.glb') {
  try {
    const url = URL.createObjectURL(blob);
    console.log('[viewer] loading blob', name, blob.size, 'bytes');
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        if (currentRoot) scene.remove(currentRoot);
        currentRoot = gltf.scene || gltf.scenes?.[0];
        scene.add(currentRoot);
        fit(currentRoot);
        console.log('[viewer] model loaded');
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(url);
        console.error('[viewer] load failed', err);
      }
    );
  } catch (e) {
    console.error('[viewer] exception', e);
  }
}

// イベント橋渡し
window.addEventListener('lmy:load-glb-blob', (ev) => {
  const { blob, name } = ev.detail || {};
  if (!(blob instanceof Blob)) return console.warn('[viewer] bad payload');
  loadBlob(blob, name);
});
console.log('[viewer_host] armed');

// 手動デバッグ用フック（任意）
window.__LMY_LOAD_GLB = loadBlob;

function onResize() {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();
