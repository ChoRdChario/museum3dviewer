// viewer.js (patched): use global THREE + non-module OrbitControls (r149)
console.log('[viewer] module loaded');

let renderer, scene, camera, controls, grid;

export function ensureViewer() {
  const canvas = document.getElementById('viewport');
  if (!canvas) throw new Error('[viewer] canvas/host missing');

  if (renderer) return { renderer, scene, camera, controls };

  const { innerWidth: w, innerHeight: h } = window;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth || w - 360, canvas.clientHeight || h);
  renderer.setClearColor(0x0f1115, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, (canvas.clientWidth || w) / (canvas.clientHeight || h), 0.1, 1000);
  camera.position.set(2.5, 2.0, 2.5);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x111122, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 5, 2);
  scene.add(dir);

  grid = new THREE.GridHelper(10, 10, 0x334155, 0x1f2937);
  scene.add(grid);

  // OrbitControls from non-module examples/js/controls/OrbitControls.js
  controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.update();

  animate();
  window.addEventListener('resize', onResize);
  console.log('[viewer] ready');
  return { renderer, scene, camera, controls };
}

function onResize() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth || (window.innerWidth - 360);
  const h = canvas.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  if (!renderer) return;
  requestAnimationFrame(animate);
  controls && controls.update();
  renderer.render(scene, camera);
}

// convenience: simple color setter to match current UI testing flow
export function setPinColor(hex) {
  console.log('[viewer] color set', hex);
}

ensureViewer();
