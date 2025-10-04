// viewer_min_loader.js — minimal Three.js fallback into #stage (uses importmap 'three')
import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';

function getStageHost(){
  return document.getElementById('stage') || document.body;
}
function ensureCanvas(host){
  let canvas = host.querySelector('canvas');
  if (!canvas){
    canvas = document.createElement('canvas');
    host.appendChild(canvas);
  }
  return canvas;
}

export async function loadGLBArrayBufferIntoStage(arrayBuffer){
  const host = getStageHost();
  const canvas = ensureCanvas(host);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(host.clientWidth, host.clientHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, host.clientWidth/host.clientHeight, 0.01, 1000);
  camera.position.set(1.8,1.2,2.4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(2,3,4);
  scene.add(dir);

  const loader = new GLTFLoader();
  const blob = new Blob([arrayBuffer], { type:'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const gltf = await loader.loadAsync(url);
  URL.revokeObjectURL(url);
  const root = gltf.scene || gltf.scenes[0];
  scene.add(root);

  function frame(){
    requestAnimationFrame(frame);
    controls.update();
    renderer.render(scene, camera);
  }
  frame();

  window.__lmy_fallback_viewer = {
    setSpin:(on)=>{}, setOpacity:()=>{}, setUnlit:()=>{}, setHSL:()=>{}, setWhiteKey:()=>{}, setWhiteKeyEnabled:()=>{},
  };
  window.dispatchEvent(new CustomEvent('lmy:fallback-viewer-loaded', { detail:{ viewer: window.__lmy_fallback_viewer } }));
  return { ok:true };
}
