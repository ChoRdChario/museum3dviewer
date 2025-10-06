// viewer.js — minimal, robust viewer with CDN-three (esm.sh) + Drive fetch
// Exports: ensureViewer(app), and attaches a lightweight API to app.viewer
// - ensureViewer: initializes three.js renderer/scene/camera/controls and animation loop
// - app.viewer.loadByInput(fileIdOrUrl): loads a GLB from Google Drive (file ID or URL) or direct URL
// - app.viewer.setHSLOpacity / toggleUnlit: no-ops kept for backward compatibility

const THREE_CDN   = 'https://esm.sh/three@0.160.1';
const ORBIT_CDN   = 'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls';
const GLTF_CDN    = 'https://esm.sh/three@0.160.1/examples/jsm/loaders/GLTFLoader';

let THREE = null;
let OrbitControls = null;
let GLTFLoader = null;

console.log('[viewer] ready');

async function importThree() {
  // Try esm.sh (resolves bare imports in JSM examples)
  const mod = await import(THREE_CDN);
  console.log('[viewer] three ok via', THREE_CDN);
  return mod;
}

async function ensureThree() {
  if (THREE && OrbitControls && GLTFLoader) return;
  const threeMod = await importThree();
  // threeMod itself is the namespace export in esm.sh
  THREE = threeMod;
  const orbit = await import(ORBIT_CDN);
  OrbitControls = orbit.OrbitControls ?? orbit.default ?? orbit;
  const gltf = await import(GLTF_CDN);
  GLTFLoader = gltf.GLTFLoader ?? gltf.default ?? gltf;
}

function ensureCanvas() {
  let canvas = document.querySelector('canvas#viewer');
  if (!canvas) {
    // Auto-create if missing (safety net)
    canvas = document.createElement('canvas');
    canvas.id = 'viewer';
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    document.body.appendChild(canvas);
  }
  return canvas;
}

async function bootstrapRenderer(app) {
  // DOM ready guard
  if (document.readyState === 'loading') {
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }
  const canvas = ensureCanvas();
  if (!canvas) throw new Error('canvas#viewer not found');

  await ensureThree();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; // new API

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 5000);
  camera.position.set(2.5, 1.5, 3.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  // Ground (optional, very light)
  const grid = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
  grid.position.y = -0.001;
  scene.add(grid);

  const state = { renderer, scene, camera, controls, model: null, clock: new THREE.Clock() };

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // attach minimal API expected by ui.js and legacy UI
  app.viewer = {
    async loadByInput(input) {
      const urlOrId = (input || '').trim();
      if (!urlOrId) throw new Error('No file id/url');
      const ab = await fetchArrayBuffer(urlOrId, app);
      await loadGLBArrayBuffer(ab, state);
    },
    // Legacy no-ops to avoid crashes when UI wires old handlers
    setHSLOpacity() {},
    toggleUnlit() {},
  };

  return state;
}

async function fetchArrayBuffer(fileIdOrUrl, app) {
  // If looks like full URL and is not Drive fileId, try direct fetch
  if (/^https?:\/\//i.test(fileIdOrUrl) && !/drive\.googleapis\.com|googleusercontent\.com|drive\.google\.com/.test(fileIdOrUrl)) {
    const res = await fetch(fileIdOrUrl);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    return res.arrayBuffer();
  }

  // Normalize Drive fileId
  let fileId = fileIdOrUrl;
  const m = fileIdOrUrl.match(/[-\w]{25,}/); // extract plausible id from URL
  if (m) fileId = m[0];

  // Require OAuth token from gauth
  const token = app?.auth?.getAccessToken?.();
  if (!token) throw new Error('Not signed in');

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive fetch failed: ${res.status} ${await res.text().catch(()=> '')}`);
  return res.arrayBuffer();
}

async function loadGLBArrayBuffer(arrayBuffer, state) {
  const loader = new GLTFLoader();
  const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      // remove previous
      if (state.model) {
        state.scene.remove(state.model);
        state.model.traverse(o => o.geometry && o.geometry.dispose());
      }
      state.model = gltf.scene;
      state.scene.add(gltf.scene);
      // frame model
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const center = box.getCenter(new THREE.Vector3());
      state.controls.reset();
      state.controls.target.copy(center);
      const distance = size * 1.5;
      const dir = new THREE.Vector3(1, 0.75, 1).normalize();
      state.camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));
      state.camera.near = size / 1000;
      state.camera.far = size * 1000;
      state.camera.updateProjectionMatrix();
      console.log('[viewer] GLB loaded');
      URL.revokeObjectURL(url);
      resolve();
    }, undefined, (err) => reject(err));
  });
}

export async function ensureViewer(app) {
  if (!app) window.app = (window.app || {}), app = window.app;
  return bootstrapRenderer(app);
}
