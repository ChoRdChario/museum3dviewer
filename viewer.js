// viewer.js — LociMyu bootstrap (THREE singleton strict)
// 2025-10-06

console.log('[viewer] ready');

let THREE = null;
let THREE_BASE = null;
const THREE_CDN = 'https://unpkg.com/three@0.160.1/build/three.module.js';
const THREE_EX_BASE = 'https://unpkg.com/three@0.160.1/examples/jsm/';

let ctx = {
  host: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  mixer: null,
  clock: null,
  current: null,
  animId: null,
  isRunning: false,
};

// ────────────────────────────────────────────────────────────────────────────
// THREE singleton
// ────────────────────────────────────────────────────────────────────────────
async function ensureThree() {
  // Reuse a global promise so EVERY importer shares the same instance
  if (window.__THREE_PROMISE) {
    const mod = await window.__THREE_PROMISE;
    THREE = mod; THREE_BASE = THREE_EX_BASE;
    return THREE;
  }

  // If global THREE is already there (e.g., another script tag), reuse and normalize
  if (window.THREE && !window.__THREE_PROMISE) {
    window.__THREE_PROMISE = Promise.resolve(window.THREE);
    const mod = await window.__THREE_PROMISE;
    THREE = mod; THREE_BASE = THREE_EX_BASE;
    return THREE;
  }

  // First caller sets the promise (single import URL only to avoid duplicates)
  window.__THREE_PROMISE = import(THREE_CDN).then((mod) => {
    if (!window.THREE) window.THREE = mod;
    return mod;
  });

  const mod = await window.__THREE_PROMISE;
  THREE = mod; THREE_BASE = THREE_EX_BASE;
  console.log('[viewer] three ok via', THREE_CDN);
  return THREE;
}

// ────────────────────────────────────────────────────────────────────────────
// stage / renderer
// ────────────────────────────────────────────────────────────────────────────
function ensureStage() {
  if (ctx.host) return ctx.host;
  const host = document.getElementById('stage');
  if (!host) throw new Error('No #stage element');
  host.style.position = 'relative';
  ctx.host = host;
  return host;
}

async function bootstrapRenderer() {
  await ensureThree();
  if (ctx.renderer) return;

  const host = ensureStage();
  const { WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Clock, MathUtils } = THREE;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  // modern color space
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  host.innerHTML = '';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = null;

  const camera = new PerspectiveCamera(50, Math.max(host.clientWidth / Math.max(host.clientHeight,1), 0.0001), 0.01, 1000);
  camera.position.set(0, 1.2, 2.4);

  const { OrbitControls } = await import(`${THREE_EX_BASE}controls/OrbitControls.js`);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.6, 0);

  scene.add(new AmbientLight(0xffffff, 0.7));
  const dir = new DirectionalLight(0xffffff, 0.8);
  dir.position.set(1, 2, 3);
  scene.add(dir);

  ctx.clock = new Clock();
  ctx.renderer = renderer;
  ctx.scene = scene;
  ctx.camera = camera;
  ctx.controls = controls;

  const onResize = () => {
    const w = host.clientWidth || host.offsetWidth || window.innerWidth;
    const h = host.clientHeight || host.offsetHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = Math.max(w / Math.max(h, 1), 0.0001);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();

  const animate = () => {
    ctx.animId = requestAnimationFrame(animate);
    const dt = ctx.clock.getDelta();
    if (ctx.mixer) ctx.mixer.update(dt);
    ctx.controls.update();
    renderer.render(ctx.scene, ctx.camera);
  };
  if (!ctx.isRunning) {
    ctx.isRunning = true;
    animate();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Drive helpers
// ────────────────────────────────────────────────────────────────────────────
function resolveAccessToken() {
  try {
    if (window.gapi?.client?.getToken) {
      const tok = window.gapi.client.getToken();
      if (tok?.access_token) return tok.access_token;
    }
  } catch (_) {}
  try {
    if (window.app?.auth?.getAccessToken) {
      const t = window.app.auth.getAccessToken();
      if (t) return t;
    }
  } catch (_) {}
  return null;
}

function normalizeDriveIdFromInput(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[a-zA-Z0-9_\-]+$/.test(s)) return s;
  let m;
  if ((m = s.match(/[?&]id=([a-zA-Z0-9_\-]+)/))) return m[1];
  if ((m = s.match(/\/file\/d\/([a-zA-Z0-9_\-]+)\//))) return m[1];
  if ((m = s.match(/\/d\/([a-zA-Z0-9_\-]+)\//))) return m[1];
  return null;
}

async function fetchDriveArrayBuffer(fileId) {
  const token = resolveAccessToken();
  if (!token) throw new Error('No OAuth token (not signed in)');
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let txt = ''; try { txt = await res.text(); } catch(e) {}
    throw new Error(`Drive fetch ${res.status}: ${txt.slice(0, 200)}`);
  }
  return await res.arrayBuffer();
}

// ────────────────────────────────────────────────────────────────────────────
// GLB attach
// ────────────────────────────────────────────────────────────────────────────
async function parseGLB(arrayBuffer) {
  await ensureThree();
  const { GLTFLoader } = await import(`${THREE_EX_BASE}loaders/GLTFLoader.js`);
  const loader = new GLTFLoader();
  return await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf), (err) => reject(err || new Error('GLB parse error')));
  });
}

function attachToScene(gltf) {
  if (ctx.current?.scene) ctx.scene.remove(ctx.current.scene);
  ctx.current = gltf;
  ctx.scene.add(gltf.scene);

  const { Box3, Vector3 } = THREE;
  const box = new Box3().setFromObject(gltf.scene);
  const size = new Vector3(); const center = new Vector3();
  box.getSize(size); box.getCenter(center);

  const radius = Math.max(size.x, size.y, size.z) * 0.6 || 1.0;
  const dist = radius / Math.sin((Math.PI / 180) * ctx.camera.fov * 0.5);
  ctx.controls.target.copy(center);
  ctx.camera.position.copy(new Vector3(center.x, center.y, center.z + dist * 1.2));
  ctx.camera.near = Math.max(radius / 1000, 0.01);
  ctx.camera.far  = Math.max(dist * 10, 1000);
  ctx.camera.updateProjectionMatrix();

  try {
    const mats = new Set();
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m && mats.add(m));
        else mats.add(o.material);
      }
    });
    const list = Array.from(mats).map((m) => ({ name: m.name || '(material)', uuid: m.uuid }));
    window.app?.events?.dispatchEvent(new CustomEvent('viewer:materials', { detail: { list } }));
  } catch (e) {
    console.warn('[viewer] mats event failed', e);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────
async function loadByInput(text) {
  await bootstrapRenderer();
  const id = normalizeDriveIdFromInput(text);
  if (!id) throw new Error('empty or invalid file id/url');
  const buf = await fetchDriveArrayBuffer(id);
  const gltf = await parseGLB(buf);
  attachToScene(gltf);
  console.log('[viewer] GLB loaded');
}

function setWhiteKey(enabled, threshold01) {
  console.warn('[viewer] setWhiteKey not implemented yet', { enabled, threshold01 });
}
function setOpacity(uuid, value01) {
  try {
    if (!ctx.current) return;
    const v = THREE.MathUtils.clamp(value01 ?? 1, 0, 1);
    ctx.current.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m || (uuid && m.uuid !== uuid)) return;
        m.transparent = v < 1;
        m.opacity = v;
        m.depthWrite = v >= 1;
        m.needsUpdate = true;
      });
    });
  } catch (e) { console.warn('[viewer] setOpacity failed', e); }
}
function setUnlit(uuid, enabled) {
  try {
    if (!ctx.current) return;
    ctx.current.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m || (uuid && m.uuid !== uuid)) return;
        if (!m.userData.__origOnBeforeCompile) m.userData.__origOnBeforeCompile = m.onBeforeCompile;
        m.onBeforeCompile = enabled
          ? (shader) => { if (shader) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', '/* unlit */'); }
          : m.userData.__origOnBeforeCompile || (s=>s);
        m.needsUpdate = true;
      });
    });
  } catch (e) { console.warn('[viewer] setUnlit failed', e); }
}

const events = new EventTarget();
window.app = window.app || {};
window.app.events = window.app.events || events;
window.app.viewer = { loadByInput, setWhiteKey, setOpacity, setUnlit };

async function ensureViewer() { await bootstrapRenderer(); return window.app?.viewer; }

export { ensureViewer, loadByInput };
