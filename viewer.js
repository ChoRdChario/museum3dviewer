// viewer.js (ESM)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const state = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  canvasHost: null,
  ready: false,
};

function createRenderer(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);
  return renderer;
}

export async function ensureViewer() {
  const host = document.querySelector('#viewer');
  if (!host) throw new Error('[viewer] #viewer not found');

  if (!state.renderer) {
    state.canvasHost = host;
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x111318);

    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) throw new Error('[viewer] invalid host size (clientWidth/Height)');

    state.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 5000);
    state.camera.position.set(2.8, 1.8, 3.0);

    state.renderer = createRenderer(host);

    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(5, 10, 7);
    state.scene.add(light, new THREE.AmbientLight(0xffffff, 0.25));

    state.controls = new OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;

    window.addEventListener('resize', onResize);
    animate();
    state.ready = true;
  }
  return state;
}

function onResize() {
  if (!state.canvasHost || !state.renderer || !state.camera) return;
  const w = state.canvasHost.clientWidth;
  const h = state.canvasHost.clientHeight || 1;
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
  if (!state.ready) return;
  state.controls?.update();
  state.renderer.render(state.scene, state.camera);
}

// --- public helpers ---------------------------------------------------------
export function addHelperGrid() {
  if (!state.scene) return;
  const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
  state.scene.add(grid);
}

// 起動
ensureViewer().catch(err => {
  console.error('[viewer] ensureViewer failed', err);
});
