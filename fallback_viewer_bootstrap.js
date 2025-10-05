// fallback_viewer_bootstrap.js  (ESM, bare specifiers — works with import map)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const host = document.getElementById('stage') || document.body;

export async function ensureDemo(){
  if(document.querySelector('canvas')) return;
  const canvas=document.createElement('canvas'); canvas.style.width='100%'; canvas.style.height='100%'; host.appendChild(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true}); renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x111216);
  const camera=new THREE.PerspectiveCamera(60,1,0.01,100); camera.position.set(1.5,1.2,1.6);
  const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true;
  scene.add(new THREE.AmbientLight(0xffffff,0.8));
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6), new THREE.MeshStandardMaterial({color:0x355481, metalness:0.1, roughness:0.9})); scene.add(mesh);
  function resize(){ const w=canvas.clientWidth,h=canvas.clientHeight; if(w===0||h===0) return; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
  window.addEventListener('resize',resize); resize();
  (function tick(){ requestAnimationFrame(tick); mesh.rotation.y+=0.01; controls.update(); renderer.render(scene,camera); })();
}
