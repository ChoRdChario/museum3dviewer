
// viewer.js — patched to avoid multiple-three import and to expose UI-facing APIs
// Minimal surface: do not add files; only replace this file.
// Logs are prefixed with [viewer] for quick grepping.

console.log("[viewer] ready");

/** ------------------------------------------------------------------------
 * Utilities
 * --------------------------------------------------------------------- */
const log = (...args) => console.log("[viewer]", ...args);
const err = (...args) => console.error("[viewer]", ...args);

const CDN_VER = "0.160.1";
const THREE_CDN_BUILD = `https://unpkg.com/three@${CDN_VER}/build/three.module.js`;
const JSM_BASE = `https://unpkg.com/three@${CDN_VER}/examples/jsm`;

/** Singleton import of THREE (prevents "Multiple instances" warning)
 *  - Reuses the same Promise across calls
 *  - Prefers local relative paths; falls back to CDN
 */
async function ensureThree() {
  // If someone already loaded THREE (module or global), reuse it.
  if (globalThis.__three_promise) return globalThis.__three_promise;

  globalThis.__three_promise = (async () => {
    // Already present as a global (via <script src="three.min.js">)?
    if (globalThis.THREE && globalThis.THREE.WebGLRenderer) {
      log("THREE found on window");
      return { default: globalThis.THREE };
    }

    const candidates = [
      "./lib/three/build/three.module.js",
      "../lib/three/build/three.module.js",
      THREE_CDN_BUILD,
    ];

    for (const url of candidates) {
      try {
        // dynamic import keeps module instance singleton per URL
        const mod = await import(/* @vite-ignore */ url);
        // Normalize: expose global to help any legacy code that expects window.THREE
        if (!globalThis.THREE && mod?.WebGLRenderer) {
          globalThis.THREE = mod;
        }
        log(`three ok via ${url}`);
        return mod;
      } catch (e) {
        if (url !== candidates[candidates.length - 1]) {
          log(`three candidate failed: ${url}`, e?.message || e);
          continue;
        }
        throw e;
      }
    }
  })();

  return globalThis.__three_promise;
}

/** Import helpers that always align with the resolved THREE base (CDN_VER) */
async function importJSM(relative) {
  // Always pair loaders/helpers with the same version as THREE_CDN_BUILD to avoid duplication
  const url = `${JSM_BASE}/${relative}`;
  return import(/* @vite-ignore */ url);
}

/** ------------------------------------------------------------------------
 * Viewer bootstrap
 * --------------------------------------------------------------------- */
let _renderer, _scene, _camera, _controls, _clock;
let _meshList = [];
let _originalMaterials = new Map();
let _activeMatIndex = 0;

async function bootstrapRenderer(canvas) {
  const THREE = await ensureThree();

  // Late-load OrbitControls with same base/version as THREE
  const { OrbitControls } = await importJSM("controls/OrbitControls.js");

  // Canvas
  const cnv = canvas || document.querySelector("canvas#viewer");
  if (!cnv) throw new Error("canvas#viewer not found");

  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: cnv, alpha: true });
  // Newer three uses outputColorSpace; keep compatibility
  if ("outputColorSpace" in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ("outputEncoding" in renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(cnv.clientWidth || window.innerWidth, cnv.clientHeight || window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, (cnv.clientWidth || window.innerWidth) / (cnv.clientHeight || window.innerHeight), 0.01, 1000);
  camera.position.set(0, 1, 3);

  const controls = new OrbitControls(camera, cnv);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  _renderer = renderer;
  _scene = scene;
  _camera = camera;
  _controls = controls;
  _clock = new THREE.Clock();

  window.addEventListener("resize", () => {
    const w = cnv.clientWidth || window.innerWidth;
    const h = cnv.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  // animation loop
  (function animate() {
    requestAnimationFrame(animate);
    if (_controls) _controls.update();
    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
  })();

  return { THREE, renderer, scene, camera, controls };
}

/** ------------------------------------------------------------------------
 * GLB loader
 * --------------------------------------------------------------------- */
async function parseGLB(arrayBuffer) {
  const THREE = await ensureThree();
  const { GLTFLoader } = await importJSM("loaders/GLTFLoader.js");

  const loader = new GLTFLoader();
  return await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, "", gltf => resolve(gltf), err => reject(err));
  });
}

async function fetchDriveArrayBuffer(fileIdOrUrl, accessToken) {
  // Accept both fileId and full URL (uc?export=download&id=...)
  let url;
  const idMatch = String(fileIdOrUrl || "").match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || String(fileIdOrUrl || "").match(/^([a-zA-Z0-9_-]{10,})$/);
  if (idMatch) {
    const fileId = idMatch[1] || idMatch[0];
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  } else {
    // Fallback: treat as direct URL
    url = fileIdOrUrl;
  }

  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Drive fetch failed ${res.status} ${res.statusText}`);
  }
  return await res.arrayBuffer();
}

/** ------------------------------------------------------------------------
 * Public API expected by ui.js
 * --------------------------------------------------------------------- */
const api = {
  /** Ensure renderer exists */
  async ensure() {
    if (!_renderer) await bootstrapRenderer();
    return api;
  },

  /** Load from an <input>, fileId, or URL */
  async loadByInput(inputOrString) {
    await api.ensure();
    const src = typeof inputOrString === "string" ? inputOrString : (inputOrString?.value || "");
    const token = (globalThis.app && app.auth && app.auth.accessToken) || null;

    let ab;
    if (/^https?:/.test(src) || /^[a-zA-Z0-9_-]{10,}$/.test(src) || /[?&]id=/.test(src)) {
      ab = await fetchDriveArrayBuffer(src, token);
    } else if (inputOrString && inputOrString.files && inputOrString.files[0]) {
      ab = await inputOrString.files[0].arrayBuffer();
    } else {
      throw new Error("No input/URL/fileId provided");
    }

    const gltf = await parseGLB(ab);
    // Clear previous
    _meshList.length = 0;
    _originalMaterials.clear();
    // Reset scene
    while (_scene.children.length) _scene.remove(_scene.children[0]);
    // Re-add lights
    const THREE = await ensureThree();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    hemi.position.set(0, 1, 0);
    _scene.add(hemi);

    const root = gltf.scene || gltf.scenes?.[0];
    _scene.add(root);

    root.traverse(obj => {
      if (obj.isMesh) {
        _meshList.push(obj);
      }
    });

    log("GLB loaded");
    return api;
  },

  /** UI compatibility: setHSLOpacity(op) or (index, op) or ({index,opacity}) */
  setHSLOpacity(a, b) {
    let index, opacity;
    if (typeof a === "number" && typeof b === "number") {
      index = a; opacity = b;
    } else if (typeof a === "number") {
      index = _activeMatIndex; opacity = a;
    } else if (a && typeof a === "object") {
      index = a.index ?? _activeMatIndex; opacity = a.opacity ?? a.value ?? a.op ?? 1;
    } else {
      opacity = 1; index = _activeMatIndex;
    }
    opacity = Math.max(0, Math.min(1, Number(opacity)));
    const mesh = _meshList[index] || _meshList[0];
    if (!mesh) return;
    const mat = mesh.material;
    if (!mat) return;

    // enable transparency
    mat.transparent = true;
    if ("opacity" in mat) mat.opacity = opacity;
    // Render order to avoid z-fighting when semi-transparent
    mesh.renderOrder = 1;
    mat.needsUpdate = true;
  },

  /** UI compatibility: toggleUnlit(index?) */
  toggleUnlit(idxMaybe) {
    const index = (typeof idxMaybe === "number") ? idxMaybe : _activeMatIndex;
    const mesh = _meshList[index] || _meshList[0];
    if (!mesh) return;

    const key = mesh.uuid;
    if (!_originalMaterials.has(key)) {
      _originalMaterials.set(key, mesh.material);
      const THREE = globalThis.THREE || {};
      // Make a basic unlit replacement; preserve color & opacity
      const baseColor = mesh.material?.color ? mesh.material.color.clone() : undefined;
      const baseOpacity = (mesh.material && "opacity" in mesh.material) ? mesh.material.opacity : 1;
      const unlit = new THREE.MeshBasicMaterial({
        color: baseColor || 0xffffff,
        transparent: true,
        opacity: baseOpacity,
      });
      mesh.material = unlit;
    } else {
      mesh.material = _originalMaterials.get(key);
      _originalMaterials.delete(key);
    }
    if (mesh.material) mesh.material.needsUpdate = true;
  },

  /** Optional: select active target for UI */
  setActiveMaterialIndex(i) {
    if (typeof i === "number") _activeMatIndex = Math.max(0, Math.min(i, _meshList.length - 1));
  },

  /** No-op shims so older UI doesn’t crash */
  setWhiteKey(_) { /* kept for compatibility; implementation omitted here */ },
  setCaptionText(_){},
  setCaptionVisible(_){},
  setCaptionStyle(_){},
};

/** Keep the API on global app.viewer (as existing code expects) */
if (!globalThis.app) globalThis.app = {};
globalThis.app.viewer = api;

// For app_boot.js that imports ensureViewer: expose a named export too.
export async function ensureViewer() {
  await api.ensure();
  return api;
}
export default api;
