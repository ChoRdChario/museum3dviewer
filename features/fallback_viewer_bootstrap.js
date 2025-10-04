
/**
 * fallback_viewer_bootstrap.js
 * Purpose: if upstream viewer didn't create a canvas, create one and show a basic Three renderer.
 * This is PURELY a safety net so that GL rendering is guaranteed while wiring is under repair.
 */
import * as THREE from "../lib/three.module.js";

const host = document.getElementById("stage") || document.getElementById("viewer-host") || document.body;
let canvas = document.querySelector("canvas");
if (!canvas) {
  canvas = document.createElement("canvas");
  canvas.id = "fallback-canvas";
  canvas.style.cssText = "position:absolute;inset:0;display:block;";
  host.appendChild(canvas);
}
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(window.devicePixelRatio||1);

function fit(){
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w,h,false);
  camera.aspect = Math.max(1e-6, w/h); camera.updateProjectionMatrix();
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(1.2,1.0,1.8);

const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7,1), new THREE.MeshStandardMaterial({metalness:0.1, roughness:0.4, color:0x66aaff}));
scene.add(mesh);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(2,2,2); scene.add(dl);

fit(); window.addEventListener("resize", fit);

(function tick(){
  mesh.rotation.y += 0.01;
  mesh.rotation.x += 0.008;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
})();

console.log("[fallback] renderer mounted");
