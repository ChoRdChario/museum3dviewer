
// viewer.js — patched, CDN統一 + DOMReadyガード + 安全なエクスポート
// 依存: three, OrbitControls, GLTFLoader（すべて esm.sh から動的 import）

console.log('[viewer] module loaded');

const THREE_ESM = 'https://esm.sh/three@0.160.1';
const ORBIT_ESM = 'https://esm.sh/three@0.160.1/examples/jsm/controls/OrbitControls';
const GLTF_ESM  = 'https://esm.sh/three@0.160.1/examples/jsm/loaders/GLTFLoader';

async function dynamicImport(url) {
  try {
    return await import(url);
  } catch (e) {
    console.warn('[viewer] import failed:', url, e && e.message);
    throw e;
  }
}

async function ensureThree() {
  // ローカル候補 → 見つからなければ esm.sh（最終）
  const candidates = [
    './lib/three/build/three.module.js',
    '../lib/three/build/three.module.js',
    THREE_ESM,
  ];
  for (const url of candidates) {
    try {
      const mod = await import(url);
      console.log('[viewer] three ok via', url);
      return mod;
    } catch (e) {
      console.warn('[viewer] three candidate failed:', url, e && e.message);
      continue;
    }
  }
  throw new Error('three import failed for all candidates');
}

async function ensureOrbit() {
  return await dynamicImport(ORBIT_ESM);
}

async function ensureGLTF() {
  return await dynamicImport(GLTF_ESM);
}

function extractDriveFileId(input) {
  if (!input) return null;
  const idParam = /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(input);
  if (idParam) return idParam[1];
  const share = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(input);
  if (share) return share[1];
  // 裸の fileId 想定
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;
  return null;
}

async function arrayBufferFromDrive(fileId) {
  if (!fileId) throw new Error('fileId required');
  const token = (globalThis.app && app.auth && typeof app.auth.getAccessToken === 'function')
    ? app.auth.getAccessToken()
    : null;
  if (!token) {
    throw new Error('Not signed in. Click "Sign in" first.');
  }
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`Drive fetch failed ${res.status} ${res.statusText} ${text}`);
  }
  return await res.arrayBuffer();
}

async function bootstrapRenderer() {
  if (document.readyState === 'loading') {
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }
  const canvas = document.querySelector('canvas#viewer') || document.getElementById('viewer');
  if (!canvas) throw new Error('canvas#viewer not found');

  const THREE = await ensureThree();
  const { OrbitControls } = await ensureOrbit();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(3, 2, 6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // light
  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(light);

  // simple grid/floor (optional)
  try {
    const grid = new THREE.GridHelper(10, 10);
    scene.add(grid);
  } catch {}

  let currentRoot = null;

  function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(animate);

  async function loadByInput(input) {
    const fileId = extractDriveFileId(input);
    if (!fileId) throw new Error('入力は Google Drive の fileId か共有URL（?id=... or /d/...）にしてください。');
    const buffer = await arrayBufferFromDrive(fileId);
    await loadArrayBuffer(buffer);
  }

  async function loadArrayBuffer(buffer) {
    const THREE = await ensureThree();
    const { GLTFLoader } = await ensureGLTF();
    const loader = new GLTFLoader();

    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });

    if (currentRoot) {
      scene.remove(currentRoot);
      currentRoot.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
      currentRoot = null;
    }
    currentRoot = gltf.scene || gltf.scenes?.[0];
    if (!currentRoot) throw new Error('GLB has no scene');
    scene.add(currentRoot);

    // 自動で全体が入るようにカメラ調整
    new THREE.Box3().setFromObject(currentRoot).getCenter(controls.target);
    controls.update();
    console.log('[viewer] GLB loaded');
  }

  return {
    renderer, scene, camera, controls,
    loadByInput, loadArrayBuffer,
  };
}

export async function ensureViewer() {
  const viewer = await bootstrapRenderer();
  globalThis.app = globalThis.app || {};
  app.viewer = viewer;
  return viewer;
}

console.log('[viewer] ready');
