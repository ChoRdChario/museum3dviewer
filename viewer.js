
/**
 * viewer.js
 * Minimal but complete GLB viewer utilities.
 * - Dynamically loads THREE (prefer local ./lib path → fallback to ../lib → CDN).
 * - Boots a WebGLRenderer on <canvas id="viewer">.
 * - Exposes material editing helpers expected by ui.js.
 * - Loads GLB from ArrayBuffer using GLTFLoader (CDN-matched version).
 *
 * Public API (named export):
 *   ensureViewer(): Promise<ViewerAPI>
 *
 * And it stores the instance at window.app.viewer for backward compatibility.
 */

const THREE_VERSION = '0.160.1';

let THREE_NS = null;
let LOADER_NS = null;

const state = {
  scene: null,
  camera: null,
  renderer: null,
  root: null, // loaded gltf.scene
  materials: new Set(),
  whiteKey: {
    enabled: false,
    threshold: 0.9,
  },
};

/* ------------------------------------------------------
 * Dynamic imports (safe fallbacks, no syntax surprises)
 * ----------------------------------------------------*/
async function importAttempt(url) {
  try {
    const mod = await import(/* @vite-ignore */ url);
    return mod;
  } catch (err) {
    console.warn('[viewer] import failed:', url, err?.message || err);
    return null;
  }
}

async function ensureThree() {
  if (THREE_NS) return THREE_NS;
  const candidates = [
    './lib/three/build/three.module.js',
    '../lib/three/build/three.module.js',
  ];
  for (const u of candidates) {
    const mod = await importAttempt(u);
    if (mod && mod.WebGLRenderer) {
      THREE_NS = mod;
      console.log('[viewer] three ok via', u);
      return THREE_NS;
    }
  }
  // CDN fallback
  const cdn = `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`;
  const mod = await importAttempt(cdn);
  if (!mod || !mod.WebGLRenderer) {
    throw new Error('THREE unavailable');
  }
  THREE_NS = mod;
  console.log('[viewer] three ok via', cdn);
  return THREE_NS;
}

async function ensureGLTFLoader() {
  if (LOADER_NS) return LOADER_NS;
  await ensureThree();
  // Always use a version-matched CDN loader to avoid path issues
  const cdn = `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js`;
  const mod = await importAttempt(cdn);
  if (!mod || !mod.GLTFLoader) {
    throw new Error('GLTFLoader unavailable');
  }
  LOADER_NS = mod;
  return LOADER_NS;
}

/* ------------------------------------------------------
 * Scene bootstrap
 * ----------------------------------------------------*/
function collectUniqueMaterials(obj) {
  state.materials.clear();
  obj.traverse((child) => {
    if (child.isMesh) {
      const m = child.material;
      if (Array.isArray(m)) {
        m.forEach((mm) => mm && state.materials.add(mm));
      } else if (m) {
        state.materials.add(m);
      }
    }
  });
}

function applyWhiteKeyToMaterial(mat) {
  // Keep this minimal & safe: don't mutate shader unless needed.
  // Here we just set alphaTest based on "lightness" heuristic from color.
  // (This avoids shader compile errors while still offering a simple toggle.)
  if (!mat) return;
  if (state.whiteKey.enabled) {
    mat.transparent = true;
    // crude: if color is close to white, fade by threshold
    // we can't read final fragment color; use color luminance heuristic
    const c = mat.color || { r: 1, g: 1, b: 1 };
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const threshold = state.whiteKey.threshold; // 0..1
    // Use alphaTest to discard fragments below threshold-derived alpha
    mat.alphaTest = Math.min(0.99, Math.max(0.0, (luminance - threshold) * 2.0));
  } else {
    mat.alphaTest = 0.0;
  }
  mat.needsUpdate = true;
}

function applyWhiteKeyAll() {
  state.materials.forEach(applyWhiteKeyToMaterial);
}

async function bootstrapRenderer() {
  const THREE = await ensureThree();

  const canvas = document.getElementById('viewer');
  if (!canvas) throw new Error('canvas#viewer not found');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, (canvas.clientWidth || 800) / (canvas.clientHeight || 600), 0.01, 1000);
  camera.position.set(2.5, 1.5, 2.5);

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(5, 10, 5);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  // simple controls (OrbitControls via CDN to avoid local path pitfalls)
  const controlsMod = await importAttempt(`https://unpkg.com/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`);
  if (controlsMod && controlsMod.OrbitControls) {
    const controls = new controlsMod.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    // animate loop with controls
    function tick() {
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    tick();
  } else {
    // minimal render loop fallback
    function tick() {
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    tick();
  }

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
}

async function parseGLB(arrayBuffer) {
  const THREE = await ensureThree();
  const { GLTFLoader } = await ensureGLTFLoader();

  const loader = new GLTFLoader();
  return await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf), (err) => reject(err));
  });
}

function clearCurrentModel() {
  if (state.root && state.scene) {
    state.scene.remove(state.root);
    state.root.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose?.();
          m.dispose?.();
        });
      }
    });
    state.root = null;
    state.materials.clear();
  }
}

/* ------------------------------------------------------
 * Public API for UI
 * ----------------------------------------------------*/
const viewerAPI = {
  /** call once */
  async ensure() {
    if (!state.renderer) {
      await bootstrapRenderer();
    }
    return viewerAPI;
  },

  async loadGLBFromArrayBuffer(buf) {
    const gltf = await parseGLB(buf);
    clearCurrentModel();
    state.root = gltf.scene || gltf.scenes?.[0];
    if (!state.root) throw new Error('GLB parse ok but no scene');

    collectUniqueMaterials(state.root);
    applyWhiteKeyAll();
    state.scene.add(state.root);
    console.log('[viewer] GLB loaded; unique materials:', state.materials.size);
  },

  /** UI helpers */
  setHSL(h = 0, s = 0, l = 0) {
    state.materials.forEach((m) => {
      if (m && m.color && m.color.isColor) {
        // work on a clone to avoid cumulative drift
        const c = m.color.clone();
        c.offsetHSL((h - 0.5) * 2.0, (s - 0.5) * 2.0, (l - 0.5) * 2.0);
        m.color.copy(c);
        m.needsUpdate = true;
      }
    });
  },

  setOpacity(op = 1.0) {
    state.materials.forEach((m) => {
      if (!m) return;
      m.transparent = op < 0.999;
      m.depthWrite = op >= 0.999; // avoid sorting artefacts at near-opaque
      m.opacity = Math.max(0, Math.min(1, op));
      m.needsUpdate = true;
    });
  },

  setUnlit(enabled = false) {
    // switch shading by flipping to MeshBasicMaterial-like flags
    state.materials.forEach((m) => {
      if (!m) return;
      m.envMapIntensity = enabled ? 0 : 1;
      m.metalness = enabled ? 0 : m.metalness;
      m.roughness = enabled ? 1 : m.roughness;
      m.lights = !enabled;
      m.needsUpdate = true;
    });
  },

  setDoubleSide(enabled = false) {
    const THREE = THREE_NS;
    state.materials.forEach((m) => {
      if (!m) return;
      m.side = enabled ? (THREE ? THREE.DoubleSide : 2) : (THREE ? THREE.FrontSide : 0);
      m.needsUpdate = true;
    });
  },

  setWhiteKeyEnabled(enabled = false) {
    state.whiteKey.enabled = !!enabled;
    applyWhiteKeyAll();
  },

  setWhiteKeyThreshold(t = 0.9) {
    state.whiteKey.threshold = Math.max(0, Math.min(1, t));
    applyWhiteKeyAll();
  },
};

/* ------------------------------------------------------
 * ensureViewer(): main entry
 * ----------------------------------------------------*/
export async function ensureViewer() {
  if (!window.app) window.app = {};
  if (window.app.viewer) return window.app.viewer;
  await viewerAPI.ensure();
  window.app.viewer = viewerAPI;
  console.log('[viewer] ready');
  return viewerAPI;
}

// for debugging in console
if (typeof window !== 'undefined') {
  window.__viewerAPI = viewerAPI;
}
