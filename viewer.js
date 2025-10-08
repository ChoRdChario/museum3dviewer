// viewer.js
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

let renderer, scene, camera;
let mountEl, spinnerEl;
let current;

export async function ensureViewer({ mount, spinner }){
  mountEl = document.querySelector(mount);
  spinnerEl = document.querySelector(spinner);
  if (!mountEl) throw new Error('mount element not found');

  // renderer
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
  mountEl.appendChild(renderer.domElement);

  // scene / camera
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);

  camera = new THREE.PerspectiveCamera(50, mountEl.clientWidth/mountEl.clientHeight, 0.1, 2000);
  camera.position.set(2.5, 1.6, 3.2);

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(2,4,2);
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.35));

  // resize
  const onResize = ()=>{
    if(!renderer) return;
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
    camera.aspect = mountEl.clientWidth/mountEl.clientHeight;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(onResize).observe(mountEl);
  window.addEventListener('resize', onResize);

  // animate
  (function loop(){
    requestAnimationFrame(loop);
    renderer.render(scene, camera);
  })();
}

export function setBackground(hex){
  if (scene) scene.background = new THREE.Color(hex);
}

export function setProjection(mode){
  // 将来拡張：Orthographic対応
}

export async function loadGLB(fileIdOrUrl){
  if (!scene) return;
  toggleSpinner(true);
  try{
    const url = normalizeUrl(fileIdOrUrl);
    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';
    const glb = await loader.loadAsync(url);
    if (current){
      scene.remove(current);
      current.traverse?.(o=>{ if (o.material?.dispose) o.material.dispose(); if (o.geometry?.dispose) o.geometry.dispose(); });
    }
    current = glb.scene;
    scene.add(current);
  }finally{
    toggleSpinner(false);
  }
}

function normalizeUrl(input){
  // Drive共有URLや fileId を適当にGLB URLへする場所（後でAPI差し替え）
  // ここではそのまま input を使える前提（ローカル/直リンク対応）
  return input.trim();
}

function toggleSpinner(on){
  if (!spinnerEl) return;
  spinnerEl.hidden = !on;
}
