// viewer.js — compat + singleton three loader + GLB + material/caption utilities
// Logs
console.log("[viewer] ready");

// ------------------------------
// THREE loader (singleton)
// ------------------------------
const THREE_VERSION = "0.160.1";
const THREE_CDN = `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`;
const EXAMPLES_BASE = `https://unpkg.com/three@${THREE_VERSION}/examples/jsm`;

function importAttempt(url) {
  return import(url);
}

/** Ensure THREE (single instance). Returns { THREE } */
async function ensureThree() {
  if (!window.__THREE_PROMISE) {
    // try local first, then fallback to CDN
    window.__THREE_PROMISE = (async () => {
      const candidates = [
        "./lib/three/build/three.module.js",
        "../lib/three/build/three.module.js",
        THREE_CDN,
      ];
      let mod = null;
      for (const url of candidates) {
        try {
          mod = await importAttempt(url);
          console.log("[viewer] three ok via", url);
          break;
        } catch (err) {
          console.log("[viewer] three candidate failed:", url, err?.message || err);
        }
      }
      if (!mod) throw new Error("THREE unavailable");
      const THREE = mod.default ? mod.default : mod;
      // expose to window (some older code might rely on global)
      window.THREE = window.THREE || THREE;
      return { THREE };
    })();
  }
  return window.__THREE_PROMISE;
}

/** Load examples module with the same version */
async function ensureExamples(modulePath /* e.g. '/loaders/GLTFLoader.js' */) {
  // Always pair with the singleton THREE above
  const url = `${EXAMPLES_BASE}${modulePath}`;
  return import(url);
}

// ------------------------------
// Renderer/Scene bootstrap
// ------------------------------
let renderer, scene, camera, controls;
let clock;
let canvasEl;
let mixers = [];

// materials / meshes bookkeeping for per-material ops
const materialCache = new Map(); // key: material.uuid -> { originalLitMat: THREE.Material|null, isUnlit:boolean }
let activeMaterialIndex = null; // selected index if UI provides

// caption layer
let captionDiv = null;

function ensureCaptionLayer() {
  if (!captionDiv) {
    captionDiv = document.getElementById("viewer-caption");
    if (!captionDiv) {
      captionDiv = document.createElement("div");
      captionDiv.id = "viewer-caption";
      Object.assign(captionDiv.style, {
        position: "absolute",
        left: "0",
        bottom: "0",
        right: "0",
        padding: "8px 12px",
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#fff",
        background: "rgba(0,0,0,0.4)",
        pointerEvents: "none",
        display: "none",
      });
      // try to append into a container that holds the canvas
      const host = document.getElementById("viewer-host") || document.body;
      host.appendChild(captionDiv);
    }
  }
  return captionDiv;
}

// Utility: get all unique materials from the scene in stable order
function collectMaterials(root) {
  const mats = [];
  const set = new Set();
  root.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of arr) {
        if (m && !set.has(m.uuid)) {
          set.add(m.uuid);
          mats.push(m);
        }
      }
    }
  });
  return mats;
}

async function bootstrapRenderer() {
  const { THREE } = await ensureThree();
  // renderer
  canvasEl = document.querySelector("canvas#viewer") || document.querySelector("canvas");
  if (!canvasEl) {
    // auto-inject canvas
    canvasEl = document.createElement("canvas");
    canvasEl.id = "viewer";
    const host = document.getElementById("viewer-host") || document.body;
    host.appendChild(canvasEl);
  }
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.position.set(2.5, 1.6, 3.5);

  const { OrbitControls } = await ensureExamples("/controls/OrbitControls.js");
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3, 5, 2);
  dir.castShadow = false;
  scene.add(dir);

  clock = new THREE.Clock();

  window.addEventListener("resize", onWindowResize);
  animate();
}

function onWindowResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock ? clock.getDelta() : 0.016;
  for (const m of mixers) m.update(dt);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

// ------------------------------
// GLB loading (via Drive or URL)
// ------------------------------
async function fetchDriveArrayBuffer(fileId, oauthToken) {
  if (!oauthToken) throw new Error("No OAuth token (not signed in)");
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${oauthToken}` },
  });
  if (!res.ok) throw new Error(`Drive fetch failed: ${res.status}`);
  return await res.arrayBuffer();
}

async function parseGLB(arrayBuffer) {
  const { THREE } = await ensureThree();
  const { GLTFLoader } = await ensureExamples("/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  // use KTX2/DRACO only if available in the same CDN (skip to keep small)
  return await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, "", (gltf) => resolve(gltf), (err) => reject(err));
  });
}

async function loadByInput(input) {
  // input could be:
  // - fileId string for Drive
  // - { driveId, token } object
  // - direct URL string (CORS-enabled)
  let arrayBuffer = null;
  if (!input) throw new Error("No input");
  if (typeof input === "object" && input.driveId) {
    arrayBuffer = await fetchDriveArrayBuffer(input.driveId, input.token);
  } else if (typeof input === "string" && input.startsWith("drive:")) {
    const [_, id, token] = input.split(":"); // "drive:<id>:<token>"
    arrayBuffer = await fetchDriveArrayBuffer(id, token);
  } else if (typeof input === "string") {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`URL fetch failed: ${res.status}`);
    arrayBuffer = await res.arrayBuffer();
  } else {
    throw new Error("Unsupported input");
  }

  const gltf = await parseGLB(arrayBuffer);
  mountGLTF(gltf);
  console.log("[viewer] GLB loaded");
  return gltf;
}

function clearScene() {
  if (!scene) return;
  // dispose previous
  while (scene.children.length) scene.remove(scene.children[0]);
  mixers.length = 0;
}

function mountGLTF(gltf) {
  const { THREE } = window;
  clearScene();
  // lights again (removed by clear)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3, 5, 2);
  scene.add(dir);

  const root = gltf.scene || gltf.scenes?.[0];
  scene.add(root);

  // animations
  if (gltf.animations && gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(root);
    mixers.push(mixer);
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.play();
    }
  }

  // reset material cache
  materialCache.clear();
  const mats = collectMaterials(root);
  mats.forEach((m) => {
    materialCache.set(m.uuid, { originalLitMat: null, isUnlit: false });
  });

  // frame the object
  frameObject(root);
}

function frameObject(obj) {
  const { THREE } = window;
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxDim / (2 * Math.atan((Math.PI * camera.fov) / 360));
  const fitWidthDistance = fitHeightDistance / camera.aspect;
  const distance = Math.max(fitHeightDistance, fitWidthDistance);

  const dir = controls ? controls.target.clone().sub(camera.position).normalize() : new THREE.Vector3(0, 0, -1);
  const newPos = center.clone().add(dir.multiplyScalar(-distance * 1.2));
  camera.position.copy(newPos);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}

// ------------------------------
// Material helpers (compat shims)
// ------------------------------

function getTargetMaterials(matIndex = null) {
  const mats = collectMaterials(scene);
  if (matIndex == null || matIndex < 0 || matIndex >= mats.length) return mats;
  return [mats[matIndex]];
}

function setOpacity(opacity, matIndex = null) {
  const mats = getTargetMaterials(matIndex ?? activeMaterialIndex);
  mats.forEach((m) => {
    m.transparent = opacity < 1 || m.transparent;
    m.opacity = Math.max(0, Math.min(1, Number(opacity)));
    m.needsUpdate = true;
  });
}

// Older UI calls this name:
function setHSLOpacity(a, b) {
  // flexible signature:
  // setHSLOpacity(opacity)
  // setHSLOpacity(index, opacity)
  // setHSLOpacity({ index, opacity })
  let idx = null;
  let opacity = null;
  if (typeof a === "number" && typeof b === "number") {
    idx = a; opacity = b;
  } else if (typeof a === "object" && a) {
    idx = a.index ?? a.materialIndex ?? null;
    opacity = a.opacity ?? a.o ?? null;
  } else if (typeof a === "number") {
    opacity = a;
  }
  if (opacity == null) return;
  setOpacity(opacity, idx);
}

function setActiveMaterialIndex(idx) {
  activeMaterialIndex = (typeof idx === "number" && isFinite(idx)) ? (idx|0) : null;
}

// unlit on/off for a target material(s)
async function setUnlit(enabled, matIndex = null) {
  const { THREE } = await ensureThree();
  const mats = getTargetMaterials(matIndex ?? activeMaterialIndex);
  mats.forEach((m) => {
    const rec = materialCache.get(m.uuid) || { originalLitMat: null, isUnlit: false };
    if (enabled) {
      if (!rec.isUnlit) {
        rec.originalLitMat = m;
        const basic = new THREE.MeshBasicMaterial({
          map: m.map || null,
          color: m.color ? m.color.clone() : 0xffffff,
          transparent: m.transparent,
          opacity: m.opacity,
          side: m.side,
          depthWrite: m.depthWrite,
          depthTest: m.depthTest,
          alphaTest: m.alphaTest || 0,
        });
        replaceMaterial(m, basic);
        rec.isUnlit = true;
      }
    } else {
      if (rec.isUnlit && rec.originalLitMat) {
        replaceMaterial(m, rec.originalLitMat);
        rec.isUnlit = false;
      }
    }
    materialCache.set((rec.isUnlit ? (m.uuid || Math.random()) : (rec.originalLitMat?.uuid || m.uuid)), rec);
  });
}

// helper to replace a material on all meshes referencing it
function replaceMaterial(oldMat, newMat) {
  scene.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map((mm) => (mm === oldMat ? newMat : mm));
      } else if (obj.material === oldMat) {
        obj.material = newMat;
      }
    }
  });
}

// shim: toggleUnlit()
function toggleUnlit(matIndex = null) {
  const mats = getTargetMaterials(matIndex ?? activeMaterialIndex);
  if (!mats.length) return;
  const m = mats[0];
  const rec = materialCache.get(m.uuid);
  const isCurrentlyUnlit = rec?.isUnlit === true;
  setUnlit(!isCurrentlyUnlit, matIndex);
}

// white key (best-effort; simple alphaTest approach)
function setWhiteKey(threshold = 1.0, matIndex = null) {
  const mats = getTargetMaterials(matIndex ?? activeMaterialIndex);
  mats.forEach((m) => {
    // simplest: raise alphaTest to punch-through near-white fragments if map has alpha baked.
    // Without custom shader, we can't chroma-key white in RGB; this is a no-op unless alpha present.
    m.alphaTest = Math.max(0, Math.min(1, Number(threshold)));
    m.needsUpdate = true;
  });
}

// caption helpers (non-breaking)
function setCaptionText(text) {
  const div = ensureCaptionLayer();
  div.textContent = text == null ? "" : String(text);
}
function setCaptionVisible(visible) {
  const div = ensureCaptionLayer();
  div.style.display = visible ? "block" : "none";
}
function setCaptionStyle(style = {}) {
  const div = ensureCaptionLayer();
  if (!style) return;
  if (style.color) div.style.color = style.color;
  if (typeof style.bgAlpha === "number") {
    const a = Math.max(0, Math.min(1, style.bgAlpha));
    div.style.background = `rgba(0,0,0,${a})`;
  }
}

// ------------------------------
// Public surface
// ------------------------------
export async function ensureViewer() {
  if (!renderer) await bootstrapRenderer();
  return {
    renderer, scene, camera, controls,
  };
}

// Back-compat global API consumed by ui.js
window.app = window.app || {};
window.app.viewer = {
  // loading
  loadByInput,

  // material selection
  setActiveMaterialIndex,

  // opacity (compat)
  setOpacity,
  setHSLOpacity, // shim name used by ui.js

  // unlit
  setUnlit,        // explicit on/off
  toggleUnlit,     // shim name used by ui.js

  // earlier white-key slider hook (best-effort)
  setWhiteKey,

  // captions
  setCaptionText,
  setCaptionVisible,
  setCaptionStyle,
};

