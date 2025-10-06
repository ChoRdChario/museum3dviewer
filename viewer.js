// viewer.js — drop-in replacement
// TDZエラー解消（readyCbs参照順）、描画ループ安定化、Material操作API維持

let _ready = false;
const _readyCbs = [];

let renderer, scene, camera, controls;
let clock;

let canvasEl;
let materials = [];
let rootObject3D = null;

export function onReady(cb) {
  if (_ready) cb();
  else _readyCbs.push(cb);
}
function notifyReadyOnce() {
  if (_ready) return;
  _ready = true;
  while (_readyCbs.length) {
    try { _readyCbs.shift()?.(); } catch (e) { console.error(e); }
  }
}

function collectUniqueMaterials(root) {
  const set = new Set();
  root?.traverse?.((obj) => {
    if (obj.isMesh && obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => set.add(m));
      else set.add(obj.material);
    }
  });
  materials = Array.from(set);
}

function applyToTarget(targetIndex, fn) {
  if (!materials || materials.length === 0) return;
  if (targetIndex == null || targetIndex === -1) {
    materials.forEach((m, i) => fn(m, i));
  } else if (materials[targetIndex]) {
    fn(materials[targetIndex], targetIndex);
  }
}

export function getMaterials() {
  return materials.map((m, i) => `${i}: ${m.name || '(unnamed)'}`);
}

export function setOpacity(value, targetIndex = -1) {
  const v = Math.max(0, Math.min(1, Number(value)));
  applyToTarget(targetIndex, (m) => {
    m.userData.__forceTransparent ??= false;
    m.transparent = v < 1 || m.userData.__forceTransparent;
    m.opacity = v;
    if (m.transparent) {
      m.depthWrite = false;
      m.alphaTest = 0.0;
    } else {
      m.depthWrite = true;
    }
    m.needsUpdate = true;
  });
}

export function setDoubleSide(on, targetIndex = -1) {
  applyToTarget(targetIndex, (m) => {
    m.side = on ? THREE.DoubleSide : THREE.FrontSide;
    m.needsUpdate = true;
  });
}

export function setUnlit(on, targetIndex = -1) {
  applyToTarget(targetIndex, (m) => {
    if (on) {
      if (!m.userData.__origLights) {
        m.userData.__origLights = {
          lights: m.lights === undefined ? true : m.lights,
          envMap: m.envMap ?? null
        };
      }
      m.lights = false;
      if ('emissiveIntensity' in m) m.emissiveIntensity = 1.0;
    } else {
      if (m.userData.__origLights) {
        m.lights = m.userData.__origLights.lights;
        if (m.userData.__origLights.envMap !== null) {
          m.envMap = m.userData.__origLights.envMap;
        }
      } else {
        m.lights = true;
      }
    }
    m.needsUpdate = true;
  });
}

export function setWhiteKey(enabled, threshold = 0.95, targetIndex = -1) {
  const t = Math.max(0, Math.min(1, Number(threshold)));
  applyToTarget(targetIndex, (m) => {
    if (enabled) {
      if (!m.userData.__whiteKeyPatched) {
        m.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            /}\s*$/m,
            `
            float lmy_luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            if (lmy_luma > ${t.toFixed(4)}) {
              gl_FragColor.a *= max(0.0, 1.0 - (lmy_luma - ${t.toFixed(4)}) / max(0.0001, 1.0 - ${t.toFixed(4)}));
            }
            if (gl_FragColor.a < 0.01) discard;
            }
            `
          );
        };
        m.userData.__whiteKeyPatched = true;
      }
      m.transparent = true;
      m.userData.__forceTransparent = true;
      m.depthWrite = false;
      m.needsUpdate = true;
    } else {
      m.userData.__forceTransparent = false;
      if (m.opacity >= 1.0) {
        m.transparent = false;
        m.depthWrite = true;
      }
      m.needsUpdate = true;
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;
  controls?.update?.();
  renderer.render(scene, camera);
}

function handleResize() {
  if (!renderer || !camera || !canvasEl) return;
  const w = canvasEl.clientWidth || window.innerWidth;
  const h = canvasEl.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  if (camera.isPerspectiveCamera) {
    camera.aspect = w / h;
  }
  camera.updateProjectionMatrix();
}

export function setRoot(root) {
  rootObject3D = root;
  collectUniqueMaterials(rootObject3D);
  if (rootObject3D && scene && !scene.children.includes(rootObject3D)) {
    scene.add(rootObject3D);
  }
  console.log('[viewer] GLB loaded; unique materials:', materials.length);
}

export function ensureViewer(app) {
  if (app.viewer) return app.viewer;

  canvasEl = document.getElementById('stage') || document.querySelector('#stage canvas') || undefined;

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    canvas: canvasEl instanceof HTMLCanvasElement ? canvasEl : undefined
  });
  const w = canvasEl?.clientWidth || window.innerWidth;
  const h = canvasEl?.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
  camera.position.set(0, 1, 3);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(3, 5, 2);
  scene.add(dir);

  if (THREE.OrbitControls) {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
  }

  clock = new THREE.Clock();

  window.addEventListener('resize', handleResize);
  animate();
  notifyReadyOnce();

  const api = {
    renderer, scene, camera, controls,
    onReady,
    getMaterials,
    setOpacity,
    setDoubleSide,
    setUnlit,
    setWhiteKey,
    setRoot,
  };

  app.viewer = api;
  return api;
}
