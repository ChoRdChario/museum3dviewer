// features/viewer_adapter.three.js
// Minimal viewer using CDN (ESM) three.js. Provides initViewer() and loadFromBlob().

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

export function initViewer(hostEl) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(hostEl.clientWidth || innerWidth, hostEl.clientHeight || innerHeight, false);
  hostEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0f0f);
  const camera = new THREE.PerspectiveCamera(50, (hostEl.clientWidth || innerWidth)/(hostEl.clientHeight || innerHeight), 0.01, 1000);
  camera.position.set(1.6, 1.0, 1.8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

  const state = { renderer, scene, camera, controls, model: null, THREE };

  function onResize(){
    const w = hostEl.clientWidth || innerWidth;
    const h = hostEl.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', onResize, { passive: true });
  onResize();

  (function loop(){
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  console.log('[viewer] armed');
  return state;
}

export async function loadFromBlob(state, blob, name='model.glb'){
  const ab = await blob.arrayBuffer();
  const loader = new GLTFLoader();
  return new Promise((resolve, reject)=>{
    loader.parse(ab, '', (gltf)=>{
      if (state.model) {
        state.scene.remove(state.model);
        state.model.traverse(o=>{
          if (o.isMesh) {
            o.geometry?.dispose?.();
            if (Array.isArray(o.material)) o.material.forEach(m=>m?.dispose?.());
            else o.material?.dispose?.();
          }
        });
      }
      state.model = gltf.scene || gltf.scenes?.[0];
      state.scene.add(state.model);

      const box = new state.THREE.Box3().setFromObject(state.model);
      const size = box.getSize(new state.THREE.Vector3());
      const center = box.getCenter(new state.THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = maxDim * 1.8;
      const dir = new state.THREE.Vector3(1,0.6,1).normalize();

      state.controls.target.copy(center);
      state.camera.position.copy(center).add(dir.multiplyScalar(dist));
      state.camera.near = Math.max(dist/1000, 0.01);
      state.camera.far  = dist*10;
      state.camera.updateProjectionMatrix();

      console.log('[viewer] model loaded', name, {size});
      resolve();
    }, (err)=> reject(err));
  });
}