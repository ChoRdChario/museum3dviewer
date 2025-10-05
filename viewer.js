// viewer.js (ESM) — three は Import Map で解決
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader }   from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function createDemoScene(canvas){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x111216);
  const camera=new THREE.PerspectiveCamera(60,1,0.01,100); camera.position.set(1.5,1.2,1.6);

  const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true;
  scene.add(new THREE.AmbientLight(0xffffff,0.8), new THREE.DirectionalLight(0xffffff,0.6));

  const mesh=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6), new THREE.MeshStandardMaterial({color:0x3e6bd6, metalness:0.1, roughness:0.9}));
  scene.add(mesh);

  function resize(){ const w=canvas.clientWidth,h=canvas.clientHeight; if(w===0||h===0) return; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
  window.addEventListener('resize',resize); resize();

  (function tick(){ requestAnimationFrame(tick); mesh.rotation.y+=0.01; controls.update(); renderer.render(scene,camera); })();
}

export async function loadGLBFromArrayBuffer(canvas, arrayBuffer){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x111216);
  const camera=new THREE.PerspectiveCamera(60,1,0.01,100); camera.position.set(1.5,1.2,1.6);
  const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true;
  scene.add(new THREE.AmbientLight(0xffffff,0.8), new THREE.DirectionalLight(0xffffff,0.6));

  const loader=new GLTFLoader();
  const gltf = await loader.parseAsync(arrayBuffer, '');
  scene.add(gltf.scene || gltf.scenes?.[0]);

  function resize(){ const w=canvas.clientWidth,h=canvas.clientHeight; if(w===0||h===0) return; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
  window.addEventListener('resize',resize); resize();
  (function tick(){ requestAnimationFrame(tick); controls.update(); renderer.render(scene,camera); })();
}
