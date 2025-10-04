// viewer_min_loader.js — minimal Three.js fallback into #stage
import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { OrbitControls } from './lib/OrbitControls.js';

function getStageHost(){
  return document.getElementById('stage') || document.body;
}
function ensureCanvas(host){
  let canvas = host.querySelector('canvas');
  if (!canvas){
    canvas = document.createElement('canvas');
    canvas.id = 'lmy-fallback-canvas';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.appendChild(canvas);
  }
  return canvas;
}

export async function loadGLBArrayBufferIntoStage(arrayBuffer){
  console.log('[fallback] start');
  const host = getStageHost();
  const canvas = ensureCanvas(host);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
  camera.position.set(1.5, 1.2, 2.0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7.5);
  scene.add(dir);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const loader = new GLTFLoader();
  const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  let root = null;
  try{
    const gltf = await loader.loadAsync(url);
    root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('No scene in GLB');
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(size*0.4, size*0.3, size*0.5));
    camera.near = size/1000; camera.far = size*10; camera.updateProjectionMatrix();
  }finally{
    URL.revokeObjectURL(url);
  }

  const resize = ()=>{
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  function animate(){
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  console.log('[fallback] rendered');
  window.__lmy_fallback_viewer = { renderer, scene, camera, controls };
  window.dispatchEvent(new CustomEvent('lmy:fallback-viewer-loaded', { detail: { scene, camera } }));
  return { renderer, scene, camera, controls };
}
