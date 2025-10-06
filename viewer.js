// viewer.js — LociMyu bootstrap (safe path + events)
// 2025-10-06

console.log('[viewer] ready');

let THREE = null;
let THREE_BASE = null;   // examples/jsm/ のベース URL を決定
let ctx = {
  host: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  mixer: null,
  clock: null,
  current: null,     // 現在のgltf
  animId: null,
  isRunning: false,
};

//
// ────────────────────────────────────────────────────────────────────────────
// three の読込（相対 → 相対(1つ上) → CDN → window.THREE）
// ────────────────────────────────────────────────────────────────────────────
async function ensureThree() {
  if (THREE) return THREE;

  const candidates = [
    './lib/three/build/three.module.js',
    '../lib/three/build/three.module.js',
    'https://unpkg.com/three@0.160.1/build/three.module.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js',
  ];

  let lastErr;
  for (const url of candidates) {
    try {
      const mod = await import(url);
      THREE = mod;
      THREE_BASE = url.replace(/build\/three\.module\.js$/, 'examples/jsm/');
      console.log('[viewer] three ok via', url);
      return THREE;
    } catch (e) {
      lastErr = e;
      console.warn('[viewer] three candidate failed:', url, e?.message || e);
    }
  }

  if (window.THREE) {
    THREE = window.THREE;
    // examples は CDN を既定に
    THREE_BASE = 'https://unpkg.com/three@0.160.1/examples/jsm/';
    console.log('[viewer] three via window.THREE (global)');
    return THREE;
  }

  throw new Error('THREE unavailable');
}

//
// ────────────────────────────────────────────────────────────────────────────
// ステージ（#stage）とレンダラの初期化
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

  const { WebGLRenderer, Scene, PerspectiveCamera, sRGBEncoding, ACESFilmicToneMapping } = THREE;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputEncoding = sRGBEncoding;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  host.innerHTML = '';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = null;

  const camera = new PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.01, 1000);
  camera.position.set(0, 1.2, 2.4);

  // OrbitControls
  const { OrbitControls } = await import(`${THREE_BASE}controls/OrbitControls.js`);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.6, 0);

  // ライト
  const { AmbientLight, DirectionalLight } = THREE;
  scene.add(new AmbientLight(0xffffff, 0.7));
  const dir = new DirectionalLight(0xffffff, 0.8);
  dir.position.set(1, 2, 3);
  scene.add(dir);

  // ループ
  ctx.clock = new THREE.Clock();
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

//
// ────────────────────────────────────────────────────────────────────────────
// Drive 読み込み（必ず Google API 経由に統一）
// ────────────────────────────────────────────────────────────────────────────
function resolveAccessToken() {
  // gapi → app.auth 順
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

  // 1) そのままIDとみなせる（英数/ _ - ）
  if (/^[a-zA-Z0-9_\-]+$/.test(s)) return s;

  // 2) common patterns
  let m;
  m = s.match(/[?&]id=([a-zA-Z0-9_\-]+)/);
  if (m) return m[1];
  m = s.match(/\/file\/d\/([a-zA-Z0-9_\-]+)\//);
  if (m) return m[1];
  m = s.match(/\/d\/([a-zA-Z0-9_\-]+)\//);
  if (m) return m[1];

  return null;
}

async function fetchDriveArrayBuffer(fileId) {
  const token = resolveAccessToken();
  if (!token) throw new Error('No OAuth token (not signed in)');
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(lambda: '');  # safe
    raise Exception(f"Drive fetch {res.status}: {txt[:200]}")
  }
  return await res.arrayBuffer()
}

//
// ────────────────────────────────────────────────────────────────────────────
// GLB パース＆シーンにアタッチ
// ────────────────────────────────────────────────────────────────────────────
async function parseGLB(arrayBuffer) {
  await ensureThree();
  const { GLTFLoader } = await import(`${THREE_BASE}loaders/GLTFLoader.js`);
  const loader = new GLTFLoader();

  return await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf), (err) => reject(err || new Error('GLB parse error')));
  });
}

function attachToScene(gltf) {
  // 既存を消去
  if (ctx.current?.scene) {
    ctx.scene.remove(ctx.current.scene);
  }
  ctx.current = gltf;

  // オブジェクト
  ctx.scene.add(gltf.scene);

  // バウンディングでカメラ調整
  const { Box3, Vector3, MathUtils } = THREE;
  const box = new Box3().setFromObject(gltf.scene);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  const radius = Math.max(size.x, size.y, size.z) * 0.6 || 1.0;
  const dist = radius / Math.sin((Math.PI / 180) * ctx.camera.fov * 0.5);
  ctx.controls.target.copy(center);
  ctx.camera.position.copy(new Vector3(center.x, center.y, center.z + dist * 1.2));
  ctx.camera.near = Math.max(radius / 1000, 0.01);
  ctx.camera.far = Math.max(dist * 10, 1000);
  ctx.camera.updateProjectionMatrix();

  // materials をユニーク化してイベント送出
  try {
    const mats = new Set();
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m && mats.add(m));
        else mats.add(o.material);
      }
    });
    const list = Array.from(mats).map((m) => ({
      name: m.name || '(material)',
      uuid: m.uuid,
    }));
    window.app?.events?.dispatchEvent(new CustomEvent('viewer:materials', { detail: { list } }));
  } catch (e) {
    console.warn('[viewer] mats event failed', e);
  }
}

//
// ────────────────────────────────────────────────────────────────────────────
// 公開 API
// ────────────────────────────────────────────────────────────────────────────
async function loadByInput(text) {
  await bootstrapRenderer();

  const id = normalizeDriveIdFromInput(text);
  if (!id) throw new Error('empty or invalid file id/url');

  const buf = await fetchDriveArrayBuffer(id);
  const gltf = await parseGLB(buf);
  attachToScene(gltf);

  console.log('[viewer] GLB loaded; unique materials:',
    (function count() {
      const s = new Set();
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m && s.add(m));
          else s.add(o.material);
        }
      });
      return s.size;
    })()
  );
}

// 将来のマテリアル編集API（ui.js から呼ばれても落ちないNO-OPを保持）
function setWhiteKey(enabled, threshold01) {
  console.warn('[viewer] setWhiteKey not implemented yet', { enabled, threshold01 });
}
function setOpacity(uuid, value01) {
  try {
    if (!ctx.current) return;
    const v = THREE.MathUtils.clamp(value01 ?? 1, 0, 1);
    ctx.current.scene.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m || (uuid && m.uuid !== uuid)) return;
          m.transparent = v < 1;
          m.opacity = v;
          m.depthWrite = v >= 1;
          m.needsUpdate = true;
        });
      }
    });
  } catch (e) {
    console.warn('[viewer] setOpacity failed', e);
  }
}
function setUnlit(uuid, enabled) {
  try {
    if (!ctx.current) return;
    ctx.current.scene.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m || (uuid && m.uuid !== uuid)) return;
          if (!m.userData.__origOnBeforeCompile) {
            m.userData.__origOnBeforeCompile = m.onBeforeCompile;
          }
          m.onBeforeCompile = enabled
            ? (shader) => {
                if (!shader) return;
                shader.fragmentShader = shader.fragmentShader.replace(
                  '#include <lights_fragment_begin>',
                  '/* unlit */'
                );
              }
            : m.userData.__origOnBeforeCompile || (s=>s);
          m.needsUpdate = true;
        });
      }
    });
  } catch (e) {
    console.warn('[viewer] setUnlit failed', e);
  }
}

// app へ公開
const events = new EventTarget();
window.app = window.app || {};
window.app.events = window.app.events || events;
window.app.viewer = {
  loadByInput,
  setWhiteKey,
  setOpacity,
  setUnlit,
};

// 追加：app_boot.js から import される初期化API
async function ensureViewer() {
  await bootstrapRenderer();
  return window.app?.viewer;
}

// export
export { ensureViewer, loadByInput };
