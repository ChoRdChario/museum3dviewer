// viewer.module.cdn.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const log = (...a)=>console.log('[viewer]', ...a);
const warn = (...a)=>console.warn('[viewer]', ...a);

const canvasHost = document.getElementById('stage') || document.body;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(canvasHost.clientWidth || window.innerWidth, canvasHost.clientHeight || window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  60,
  (canvasHost.clientWidth || window.innerWidth) / (canvasHost.clientHeight || window.innerHeight),
  0.01,
  2000
);
camera.position.set(0, 0.5, 2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
hemi.position.set(0, 1, 0);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 10, 7.5);
scene.add(dir);

window.lm = window.lm || {};
window.lm.getScene = () => scene;

let _resolveReady = null;
window.lm.readyScenePromise = new Promise(res=>{ _resolveReady = res; });
window.lm.__resolveReadyScene = (sc)=>{
  try { _resolveReady && _resolveReady(sc || scene); }
  catch(e){ warn('readyScene resolve failed', e); }
};

function onResize(){
  const w = canvasHost.clientWidth || window.innerWidth;
  const h = canvasHost.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

async function loadGLB(url){
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const child = scene.children[i];
    if (!(child.isLight || child.isCamera)) scene.remove(child);
  }
  scene.add(gltf.scene);
  window.__lm_scene = scene;

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitDist = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
  camera.position.copy(center.clone().add(new THREE.Vector3(0, maxDim * 0.2, fitDist * 1.2)));
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();

  try {
    if (window.lm && typeof window.lm.__resolveReadyScene === 'function') {
      window.lm.__resolveReadyScene(scene);
      window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail: { scene } }));
      log('deep-ready signaled');
    }
  } catch(e){ warn('Failed to signal deep-ready', e); }
}

const autoUrl = (canvasHost.getAttribute('data-lm-glb') || document.body.getAttribute('data-lm-glb') || '').trim();
if (autoUrl) {
  loadGLB(autoUrl).catch(e=>warn('auto load failed', e));
}

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

export { scene, camera, renderer, controls, loadGLB };
