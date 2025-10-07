// viewer.js — ESM with import map
console.log('[viewer] module loaded');

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export async function createViewer(canvas){
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:false});
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth/canvas.clientHeight, 0.01, 2000);
  camera.position.set(1.6, 0.8, 2.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(2,3,1); scene.add(dir);

  let model = null;

  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w/h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  function animate(){
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  async function loadGLBFromArrayBuffer(ab){
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(ab, '');
    if (model) scene.remove(model);
    model = gltf.scene;
    scene.add(model);
    fitCameraToObject(camera, controls, model, 1.2);
    return model;
  }

  function fitCameraToObject(cam, ctrls, object, offset=1.25){
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    const halfSizeToFitOnScreen = size * 0.5;
    const fov = cam.fov * (Math.PI / 180);
    const distance = halfSizeToFitOnScreen / Math.tan(fov/2) * offset;
    const dir = new THREE.Vector3(0,0,1);
    cam.position.copy(center).add(dir.multiplyScalar(distance));
    cam.near = size/1000; cam.far = size*10; cam.updateProjectionMatrix();
    ctrls.target.copy(center); ctrls.update();
  }

  function applyMaterialDelta({h=0,s=0,l=0,opacity=1}){
    if (!model) return;
    model.traverse((obj)=>{
      const m = obj.material;
      if (!m) return;
      if (m.color){
        const c = m.color.clone();
        const hsl = {}; c.getHSL(hsl);
        hsl.h = (hsl.h + (h/360)) % 1; if (hsl.h<0) hsl.h+=1;
        hsl.s = Math.min(1, Math.max(0, hsl.s + (s/100)));
        hsl.l = Math.min(1, Math.max(0, hsl.l + (l/100)));
        c.setHSL(hsl.h,hsl.s,hsl.l);
        m.color.copy(c);
      }
      if ('opacity' in m){
        m.transparent = opacity < 1 ? true : m.transparent;
        m.opacity = opacity;
      }
      m.needsUpdate = true;
    });
  }

  return {
    THREE,
    scene, camera, renderer, controls,
    loadGLBFromArrayBuffer,
    applyMaterialDelta,
  };
}

// Google Drive helper (download GLB by fileId + token)
export async function fetchDriveArrayBuffer(fileId, accessToken){
  if (!fileId) throw new Error('fileId required');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!res.ok) throw new Error('Drive download failed: ' + res.status);
  return await res.arrayBuffer();
}
