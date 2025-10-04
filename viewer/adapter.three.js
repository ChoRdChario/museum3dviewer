// viewer/adapter.three.js
import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/OrbitControls.js';

let scene, camera, renderer, controls, rafId = null;

export function createViewerAdapter(canvasEl) {
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new Error('[viewer] canvas element not found');
  }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, canvasEl.clientWidth / canvasEl.clientHeight || 1, 0.01, 10000);
  camera.position.set(0, 1, 3);
  controls = new OrbitControls(camera, canvasEl);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvasEl.clientWidth, canvasEl.clientHeight, false);
  window.addEventListener('resize', onResize, { passive: true });
  onResize();
  return { addModel, fitToObject, startIfNeeded, resize: onResize, setOrthographic, setPerspective, get three(){ return { scene, camera, renderer, controls, THREE }; } };
}

function onResize(){
  if(!renderer) return;
  const parent = renderer.domElement.parentElement;
  const w = (parent?.clientWidth ?? window.innerWidth) || 1;
  const h = (parent?.clientHeight ?? window.innerHeight) || 1;
  if (camera.isPerspectiveCamera){ camera.aspect = w/h; }
  else if (camera.isOrthographicCamera){
    const aspect = w/h, fr=1.5;
    camera.left=-fr*aspect; camera.right=fr*aspect; camera.top=fr; camera.bottom=-fr;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(w,h,false);
  renderer.render(scene,camera);
}

function animate(){ rafId=requestAnimationFrame(animate); controls.update(); renderer.render(scene,camera); }
function startIfNeeded(){ if(rafId==null) animate(); }

async function addModel(gltf){
  for (let i=scene.children.length-1; i>=0; i--){
    const c = scene.children[i];
    if (c?.userData?.isMainModel) scene.remove(c);
  }
  const root = gltf?.scene || (Array.isArray(gltf?.scenes) ? gltf.scenes[0] : null);
  if(!root){ console.warn('[viewer] no root scene in gltf'); return; }
  root.traverse(o=>{
    if(o.isMesh && o.material){
      o.material.depthWrite = true;
      if('transparent' in o.material) o.material.transparent = !!(o.material.alphaMap || o.material.opacity < 1.0);
    }
  });
  root.userData.isMainModel = true;
  scene.add(root);
  fitToObject(root);
  startIfNeeded();
}

function fitToObject(obj){
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x,size.y,size.z) || 1;
  const fov = (camera.isPerspectiveCamera ? camera.fov : 60) * Math.PI/180;
  const dist = (maxDim / (2*Math.tan(fov/2))) * 1.4;
  const dir = new THREE.Vector3(0.7,0.5,1).normalize();
  controls.target.copy(center);
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  camera.near = dist/100; camera.far = dist*100; camera.updateProjectionMatrix();
  controls.update();
  renderer.render(scene,camera);
}

function setOrthographic(){
  if (camera.isOrthographicCamera) return;
  const { position, near, far } = camera;
  const aspect = (renderer.domElement.clientWidth / renderer.domElement.clientHeight) || 1;
  const fr=1.5;
  const cam = new THREE.OrthographicCamera(-fr*aspect, fr*aspect, fr, -fr, 0.01, 10000);
  cam.position.copy(position); cam.near=near; cam.far=far;
  controls.object = cam; camera = cam; onResize();
}
function setPerspective(){
  if (camera.isPerspectiveCamera) return;
  const { position, near, far } = camera;
  const cam = new THREE.PerspectiveCamera(60, 1, 0.01, 10000);
  cam.position.copy(position); cam.near=near; cam.far=far;
  controls.object = cam; camera = cam; onResize();
}
