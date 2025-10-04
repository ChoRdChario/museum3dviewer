// features/auto_viewer_boot.js
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const log = (...a)=>console.log('[viewer]', ...a);

function ensureStage() {
  let s = document.getElementById('stage');
  if (!s) {
    s = document.createElement('div');
    s.id = 'stage';
    document.body.appendChild(s);
  }
  Object.assign(s.style, { position:'fixed', inset:'0', zIndex:'0' });
  return s;
}

const stage = ensureStage();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(stage.clientWidth || innerWidth, stage.clientHeight || innerHeight, false);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0f0f);

const camera = new THREE.PerspectiveCamera(50, (stage.clientWidth||innerWidth)/(stage.clientHeight||innerHeight), 0.01, 1e6);
camera.position.set(1.6, 1.0, 1.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

const loader = new GLTFLoader();
let currentRoot = null;

function fit(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 1.8;
  const dir = new THREE.Vector3(1, 0.6, 1).normalize();

  controls.target.copy(center);
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.near = Math.max(dist/1000, 0.01);
  camera.far  = dist * 10;
  camera.updateProjectionMatrix();
}

function clearScene() {
  if (!currentRoot) return;
  currentRoot.traverse(o=>{
    if (o.isMesh) {
      if (o.geometry?.dispose) o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach(m=>m?.dispose?.());
      else o.material?.dispose?.();
    }
  });
  scene.remove(currentRoot);
  currentRoot = null;
}

async function loadBlob(blob, name='model.glb') {
  try {
    const ab = await blob.arrayBuffer();
    loader.parse(ab, '', (gltf)=>{
      clearScene();
      currentRoot = gltf.scene || gltf.scenes?.[0];
      if (!currentRoot) return console.error('[viewer] no scene in glTF');

      scene.add(currentRoot);
      fit(currentRoot);
      log('model loaded', name);
    }, (err)=>{
      console.error('[viewer] parse failed', err);
    });
  } catch (e) {
    console.error('[viewer] load exception', e);
  }
}

addEventListener('resize', ()=>{
  const w = stage.clientWidth || innerWidth;
  const h = stage.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}, { passive: true });

(function loop(){
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();

addEventListener('lmy:load-glb-blob', (ev)=>{
  const { blob, name='model.glb' } = ev.detail || {};
  if (!(blob instanceof Blob)) return;
  log('blob received (explicit)', name, blob.size);
  loadBlob(blob, name);
});
addEventListener('lmy:auto-glb-blob', (ev)=>{
  const { blob, name='drive.glb' } = ev.detail || {};
  if (!(blob instanceof Blob)) return;
  log('blob received (auto)', name, blob.size);
  loadBlob(blob, name);
});

console.log('[viewer_boot] armed');
