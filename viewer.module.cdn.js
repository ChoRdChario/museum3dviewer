// viewer.module.cdn.js — add onCanvasShiftPick for Shift+Click pinning
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let renderer, scene, camera, controls, raycaster, canvasEl;
const pickHandlers = new Set();

export function ensureViewer({ canvas }){
  if (renderer) return;
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
  camera.position.set(3, 2, 6);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const d1 = new THREE.DirectionalLight(0xffffff, 1.0); d1.position.set(5,10,7); scene.add(d1);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  raycaster = new THREE.Raycaster();

  const onResize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  canvas.addEventListener('pointerdown', (ev) => {
    if (!ev.shiftKey) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const hit = intersects.find(i => i && i.point);
    if (hit) {
      const p = hit.point;
      pickHandlers.forEach(fn => { try { fn({ x: p.x, y: p.y, z: p.z }); } catch(_){} });
    }
  });

  const tick = () => { controls.update(); renderer.render(scene, camera); requestAnimationFrame(tick); };
  tick();
}

export function onCanvasShiftPick(handler){
  pickHandlers.add(handler);
  return () => pickHandlers.delete(handler);
}

export async function loadGlbFromDrive(fileId, { token }){
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GLB fetch failed ${r.status}`);
  const blob = await r.blob();
  const objectURL = URL.createObjectURL(blob);
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(objectURL);
    // clear previous objects except lights
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const obj = scene.children[i];
      if (!(obj.isLight)) scene.remove(obj);
    }
    // lights again just in case
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.0); d1.position.set(5,10,7); scene.add(d1);

    scene.add(gltf.scene);

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(size*0.8, size*0.6, size*0.8));
    camera.near = Math.max(size/1000, 0.01); camera.far = size*10; camera.updateProjectionMatrix();
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}
