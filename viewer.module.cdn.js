// viewer.module.cdn.js — smaller pins + selection + filter visibility
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let renderer, scene, camera, controls, raycaster, canvasEl;
const pickHandlers = new Set();
const pinSelectHandlers = new Set();
let pinGroup;

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

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.0); d1.position.set(5,10,7); scene.add(d1);

  pinGroup = new THREE.Group(); pinGroup.name = 'PinGroup'; scene.add(pinGroup);

  raycaster = new THREE.Raycaster();

  const onResize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  canvas.addEventListener('pointerdown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (ev.shiftKey){
      const hit = intersects.find(i => i && i.object !== pinGroup && !pinGroup.children.includes(i.object));
      if (hit && hit.point){
        pickHandlers.forEach(fn => { try { fn({ x: hit.point.x, y: hit.point.y, z: hit.point.z }); } catch(_){} });
      }
    } else {
      const pinHit = intersects.find(i => i.object && i.object.userData && i.object.userData.pinId);
      if (pinHit && pinHit.object){
        const id = pinHit.object.userData.pinId;
        pinSelectHandlers.forEach(fn => { try { fn(id); } catch(_){} });
        setPinSelected(id, true);
      }
    }
  });

  // visibility by color filter
  document.addEventListener('pinFilterChange', (e)=>{
    const selected = new Set(e.detail?.selected || []);
    if (!pinGroup) return;
    pinGroup.children.forEach(ch => {
      const c = ch.userData?.pinColor;
      ch.visible = !c || selected.has(c);
    });
  });

  const tick = () => { controls.update(); renderer.render(scene, camera); requestAnimationFrame(tick); };
  tick();
}

export function onCanvasShiftPick(handler){ pickHandlers.add(handler); return () => pickHandlers.delete(handler); }
export function onPinSelect(handler){ pinSelectHandlers.add(handler); return () => pinSelectHandlers.delete(handler); }

export function addPinMarker({ id, x, y, z, color = '#ff6b6b' }){
  if (!pinGroup) return;
  // Smaller pin: radius ~ model size aware (use scene bounding box fallback)
  let radius = 0.01;
  try {
    const objList = scene.children.filter(o=>!o.isLight && o!==pinGroup);
    const box = new THREE.Box3().makeEmpty();
    objList.forEach(o=>box.expandByObject(o));
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    radius = Math.max(0.006, Math.min(0.02, size * 0.002));
  } catch(_){}
  const geo = new THREE.SphereGeometry(radius, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.userData.pinId = id;
  m.userData.pinColor = color;
  pinGroup.add(m);
}
export function clearPins(){ if (!pinGroup) return; while (pinGroup.children.length) pinGroup.remove(pinGroup.children[0]); }
export function setPinSelected(id, on){
  if (!pinGroup) return;
  pinGroup.children.forEach(ch => {
    if (ch.userData.pinId === id){
      ch.scale.set(on?1.6:1, on?1.6:1, on?1.6:1);
      ch.material.opacity = on?1:0.8;
    } else {
      ch.scale.set(1,1,1);
      ch.material.opacity = 0.6;
    }
  });
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
    // remove old (except lights & pinGroup)
    const keep = new Set([pinGroup]);
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const obj = scene.children[i];
      if (obj.isLight || keep.has(obj)) continue;
      scene.remove(obj);
    }
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
