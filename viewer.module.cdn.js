import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * LociMyu viewer module (reconstructed, shader-patch fixed)
 * - Public API (called from glb.btn.bridge.v3.js):
 *   addPinMarker, applyMaterialProps, clearPins, ensureViewer, getScene,
 *   listMaterials, loadGlbFromDrive, onCanvasShiftPick, onPinSelect,
 *   onRenderTick, projectPoint, removePinMarker, resetAllMaterials,
 *   resetMaterial, setCurrentGlbId, setPinSelected
 *
 * - Material extensions:
 *   props.opacity        : number 0..1
 *   props.doubleSided    : boolean
 *   props.unlitLike      : boolean (lightingを無視してdiffuseColorベースに)
 *   props.chromaEnable   : boolean
 *   props.chromaColor    : '#rrggbb'
 *   props.chromaTolerance: number
 *   props.chromaFeather  : number
 */

console.log('[viewer.module] Three version', THREE.REVISION);

// Core viewer state
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let canvasRef = null;
let gltfRoot = null;
let currentGlbId = null;

// Helpers
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const materialsByName = Object.create(null);   // name -> [THREE.Material]
const materialBaselines = new Map();          // material -> { ...props }
const renderCallbacks = new Set();            // fn({renderer, scene, camera})
const shiftPickHandlers = new Set();          // fn({ point, event, hit })
const pinMarkers = new Map();                 // id -> THREE.Object3D

let animationFrameId = null;
let resizeHandlerInstalled = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureRenderLoop() {
  if (animationFrameId != null) return;

  const loop = () => {
    animationFrameId = requestAnimationFrame(loop);
    if (!renderer || !scene || !camera) return;

    if (controls) {
      try { controls.update(); } catch (e) {
        console.warn('[viewer.module] controls.update error', e);
      }
    }

    for (const fn of renderCallbacks) {
      try { fn({ renderer, scene, camera }); }
      catch (e) { console.warn('[viewer.module] render callback error', e); }
    }

    try {
      renderer.render(scene, camera);
    } catch (e) {
      console.warn('[viewer.module] render error', e);
    }
  };

  loop();
}

function ensureResizeHandler() {
  if (resizeHandlerInstalled || !canvasRef) return;
  resizeHandlerInstalled = true;

  const handleResize = () => {
    if (!renderer || !camera || !canvasRef) return;
    const width  = canvasRef.clientWidth  || canvasRef.width  || 800;
    const height = canvasRef.clientHeight || canvasRef.height || 600;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  window.addEventListener('resize', handleResize);
  // 初回
  handleResize();
}

function emitSceneReady() {
  try {
    window.__LM_SCENE = scene;
    window.__LM_CAMERA = camera;
    window.__LM_RENDERER = renderer;
    window.__LM_VIEWER_CANVAS = canvasRef;
    window.dispatchEvent(new CustomEvent('lm:scene-ready', {
      detail: { scene, camera, renderer, canvas: canvasRef, glbId: currentGlbId }
    }));
  } catch (e) {
    console.warn('[viewer.module] scene-ready dispatch failed', e);
  }
}

// GLSL patch for unlit / chroma key
function patchMaterialShader(mat) {
  if (!mat) return;
  if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) return;

  mat.userData = mat.userData || {};
  if (mat.userData.__lmShaderPatched) return;
  mat.userData.__lmShaderPatched = true;

  const uniforms = mat.userData.__lmUniforms = {
    uUnlit:           { value: false },
    uChromaEnable:    { value: 0 },
    uChromaColor:     { value: new THREE.Color(0, 0, 0) },
    uChromaTolerance: { value: 0.0 },
    uChromaFeather:   { value: 0.0 }
  };

  const prev = mat.onBeforeCompile;

  mat.onBeforeCompile = function (shader) {
    if (typeof prev === 'function') {
      try { prev.call(this, shader); } catch (e) {
        console.warn('[viewer.module] previous onBeforeCompile error', e);
      }
    }
    if (!shader || !shader.fragmentShader || !shader.uniforms) return;

    Object.assign(shader.uniforms, uniforms);

    let src = shader.fragmentShader;

    // --- (1) クロマキー注入: <dithering_fragment> の後に追加 -----------------
    const tokenDither = '#include <dithering_fragment>';
    if (src.includes(tokenDither)) {
      src = src.replace(
        tokenDither,
        `
#include <dithering_fragment>
if (uChromaEnable > 0.5) {
  vec3 keyColor = uChromaColor.rgb;
  float dist = distance(diffuseColor.rgb, keyColor);
  float a = smoothstep(uChromaTolerance,
                       uChromaTolerance + uChromaFeather,
                       dist);
  diffuseColor.a *= a;
}
`
      );
    }

    // --- (2) Unlit: トーンマッピング直前で gl_FragColor を上書き ----------
    //
    // 標準の PBR フラグメントシェーダでは、
    //   gl_FragColor = vec4( outgoingLight, diffuseColor.a );
    // の後で <tonemapping_fragment> が挿入される。
    // そこで、<tonemapping_fragment> の直前に
    //   if (uUnlit) gl_FragColor = vec4(diffuseColor.rgb, diffuseColor.a);
    // を挿入して、ライト計算はそのままに、最終出力だけ差し替える。
    //
    const tokenTone = '#include <tonemapping_fragment>';
    if (src.includes(tokenTone)) {
      src = src.replace(
        tokenTone,
        `
if (uUnlit) {
  gl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );
}
` + '\n' + tokenTone
      );
    }

    shader.fragmentShader = src;
  };

  mat.needsUpdate = true;
}

function rebuildMaterialIndex() {
  // reset maps
  for (const k of Object.keys(materialsByName)) delete materialsByName[k];
  materialBaselines.clear();
  if (!scene) return;

  scene.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      const name = m.name || '(noname)';
      (materialsByName[name] || (materialsByName[name] = [])).push(m);
      if (!materialBaselines.has(m)) {
        materialBaselines.set(m, {
          opacity: m.opacity,
          transparent: m.transparent,
          side: m.side,
          toneMapped: m.toneMapped !== undefined ? m.toneMapped : true,
          depthWrite: m.depthWrite,
          depthTest: m.depthTest
        });
      }
      patchMaterialShader(m);
    }
  });

  console.log('[viewer.materials] ready', Object.keys(materialsByName));
}

function getMaterialsByName(name) {
  return materialsByName[name] || [];
}

function handleCanvasShiftClick(ev) {
  if (!ev.shiftKey || !scene || !camera || !canvasRef) return;

  const rect = canvasRef.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  pointerNdc.set(x, y);
  raycaster.setFromCamera(pointerNdc, camera);

  const intersects = raycaster.intersectObjects(scene.children, true);
  const hit = intersects[0];
  if (!hit) return;

  const p = hit.point;
  const payload = {
    point: { x: p.x, y: p.y, z: p.z },
    event: ev,
    hit
  };

  for (const fn of shiftPickHandlers) {
    try { fn(payload); } catch (e) {
      console.warn('[viewer.module] shift-pick handler error', e);
    }
  }
}

function disposeGltfRoot() {
  if (!gltfRoot || !scene) return;
  try {
    scene.remove(gltfRoot);
  } catch (e) {
    console.warn('[viewer.module] remove gltfRoot failed', e);
  }
  gltfRoot.traverse(obj => {
    if (!obj.isMesh) return;
    const geom = obj.geometry;
    const mat  = obj.material;
    if (geom && typeof geom.dispose === 'function') geom.dispose();
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && typeof m.dispose === 'function') m.dispose();
      }
    } else if (mat && typeof mat.dispose === 'function') {
      mat.dispose();
    }
  });
  gltfRoot = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function ensureViewer(opts = {}) {
  const canvas = opts.canvas || opts.el || opts.dom || opts;

  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('[viewer.module] ensureViewer: canvas is required');
  }

  // Reuse if already initialized with same canvas
  if (renderer && canvasRef === canvas && scene && camera) {
    return { renderer, scene, camera };
  }

  canvasRef = canvas;

  // Initialize renderer / scene / camera
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });

  // Three r1xx 系の仕様変更に合わせる
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.useLegacyLights = false;

  scene = new THREE.Scene();

  const width  = canvas.clientWidth  || canvas.width  || 800;
  const height = canvas.clientHeight || canvas.height || 600;
  camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.1, 2000);
  camera.position.set(0, 0, 5);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);
  controls.update();

  // Simple hemisphere light + directional light
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7.5);
  scene.add(dir);

  // Events
  canvas.removeEventListener('click', handleCanvasShiftClick);
  canvas.addEventListener('click', handleCanvasShiftClick);

  ensureResizeHandler();
  ensureRenderLoop();
  emitSceneReady();

  console.log('[viewer.module] viewer initialized');

  return { renderer, scene, camera };
}

async function fetchGlbArrayBuffer(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) {
    throw new Error(`[viewer.module] Drive fetch failed ${res.status} ${res.statusText}`);
  }
  return await res.arrayBuffer();
}

export async function loadGlbFromDrive(fileId, opts = {}) {
  if (!renderer || !scene || !camera || !canvasRef) {
    throw new Error('[viewer.module] loadGlbFromDrive: call ensureViewer() first');
  }
  if (!opts || !opts.token) {
    throw new Error('[viewer.module] loadGlbFromDrive: token is required');
  }

  const token = opts.token;
  console.log('[viewer.module] loadGlbFromDrive', fileId);

  const loader = new GLTFLoader();

  const arrayBuffer = await fetchGlbArrayBuffer(fileId, token);

  // Dispose previous model
  disposeGltfRoot();

  await new Promise((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      '',
      gltf => {
        gltfRoot = gltf.scene || gltf.scenes[0];
        if (!gltfRoot) {
          reject(new Error('GLTF has no scene'));
          return;
        }

        scene.add(gltfRoot);

        // Center & fit camera
        const box = new THREE.Box3().setFromObject(gltfRoot);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
        const fov = THREE.MathUtils.degToRad(camera.fov);
        let distance = maxDim / (2 * Math.tan(fov / 2));
        distance *= 1.5;

        const dir = new THREE.Vector3(0, 0, 1);
        camera.position.copy(center).addScaledVector(dir, distance);
        camera.near = maxDim / 100;
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();

        if (controls) {
          controls.target.copy(center);
          controls.update();
        }

        rebuildMaterialIndex();
        currentGlbId = fileId;
        emitSceneReady();
        resolve();
      },
      err => {
        reject(err || new Error('GLTFLoader parse error'));
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Materials API
// ---------------------------------------------------------------------------

export function listMaterials() {
  return Object.keys(materialsByName);
}

export function applyMaterialProps(materialName, props = {}) {
  const mats = getMaterialsByName(materialName);
  if (!mats.length) return;

  for (const mat of mats) {
    // basic scalar props
    if (typeof props.opacity === 'number') {
      mat.opacity = props.opacity;
      // 半透明 or chroma有効時は transparent を true
      const uniforms = mat.userData && mat.userData.__lmUniforms;
      const chromaOn = uniforms && uniforms.uChromaEnable && uniforms.uChromaEnable.value > 0.5;
      mat.transparent = props.opacity < 1.0 || chromaOn;
    }

    if (typeof props.doubleSided !== 'undefined') {
      mat.side = props.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    }

    // unlit-like / chroma uniforms
    const uniforms = mat.userData && mat.userData.__lmUniforms;
    if (uniforms) {
      if (typeof props.unlitLike !== 'undefined' && uniforms.uUnlit) {
        uniforms.uUnlit.value = !!props.unlitLike;
        if ('toneMapped' in mat) mat.toneMapped = !props.unlitLike;
      }

      if (typeof props.chromaEnable !== 'undefined' && uniforms.uChromaEnable) {
        uniforms.uChromaEnable.value = props.chromaEnable ? 1 : 0;
      }

      if (typeof props.chromaColor === 'string' && uniforms.uChromaColor) {
        try { uniforms.uChromaColor.value.set(props.chromaColor); }
        catch (e) { console.warn('[viewer.module] invalid chromaColor', props.chromaColor, e); }
      }

      if (typeof props.chromaTolerance === 'number' && uniforms.uChromaTolerance) {
        uniforms.uChromaTolerance.value = props.chromaTolerance;
      }

      if (typeof props.chromaFeather === 'number' && uniforms.uChromaFeather) {
        uniforms.uChromaFeather.value = props.chromaFeather;
      }
    }

    mat.needsUpdate = true;
  }
}

export function resetMaterial(materialName) {
  const mats = getMaterialsByName(materialName);
  if (!mats.length) return;
  for (const mat of mats) {
    const base = materialBaselines.get(mat);
    if (!base) continue;
    Object.assign(mat, {
      opacity: base.opacity,
      transparent: base.transparent,
      side: base.side,
      toneMapped: base.toneMapped,
      depthWrite: base.depthWrite,
      depthTest: base.depthTest
    });
    const uniforms = mat.userData && mat.userData.__lmUniforms;
    if (uniforms) {
      uniforms.uUnlit.value = false;
      uniforms.uChromaEnable.value = 0;
      uniforms.uChromaColor.value.set(0, 0, 0);
      uniforms.uChromaTolerance.value = 0.0;
      uniforms.uChromaFeather.value = 0.0;
    }
    mat.needsUpdate = true;
  }
}

export function resetAllMaterials() {
  for (const name of Object.keys(materialsByName)) {
    resetMaterial(name);
  }
}

// ---------------------------------------------------------------------------
// Pins / overlay support
// ---------------------------------------------------------------------------

export function getScene() {
  return scene;
}

export function projectPoint(pos) {
  if (!camera || !canvasRef || !pos) return null;

  const v = new THREE.Vector3(pos.x, pos.y, pos.z);
  v.project(camera);

  return {
    x: (v.x + 1) / 2,
    y: 1 - (v.y + 1) / 2,
    z: v.z
  };
}

export function addPinMarker(pin) {
  if (!scene) return;
  if (!pin || !pin.id || !pin.position) return;

  removePinMarker(pin.id);

  const geom = new THREE.SphereGeometry(0.01, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(pin.position.x, pin.position.y, pin.position.z);
  mesh.userData.__lmPin = { id: pin.id, data: pin };

  scene.add(mesh);
  pinMarkers.set(pin.id, mesh);
}

export function removePinMarker(pinId) {
  if (!scene) return;
  const mesh = pinMarkers.get(pinId);
  if (!mesh) return;
  try {
    scene.remove(mesh);
  } catch (e) {
    console.warn('[viewer.module] removePinMarker failed', e);
  }
  if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
    mesh.geometry.dispose();
  }
  if (mesh.material && typeof mesh.material.dispose === 'function') {
    mesh.material.dispose();
  }
  pinMarkers.delete(pinId);
}

export function clearPins() {
  for (const id of Array.from(pinMarkers.keys())) {
    removePinMarker(id);
  }
}

// Simple onRenderTick registration
export function onRenderTick(fn) {
  if (typeof fn !== 'function') return () => {};
  renderCallbacks.add(fn);
  return () => { renderCallbacks.delete(fn); };
}

// Shift-pick registration
export function onCanvasShiftPick(fn) {
  if (typeof fn !== 'function') return () => {};
  shiftPickHandlers.add(fn);
  return () => { shiftPickHandlers.delete(fn); };
}

// Pin selection hook (no-op placeholder; kept for API compatibility)
const pinSelectHandlers = new Set();

export function onPinSelect(fn) {
  if (typeof fn !== 'function') return () => {};
  pinSelectHandlers.add(fn);
  return () => { pinSelectHandlers.delete(fn); };
}

export function setPinSelected(id) {
  for (const fn of pinSelectHandlers) {
    try { fn({ id }); } catch (e) {
      console.warn('[viewer.module] pinSelect handler error', e);
    }
  }
}

// GLB id (used for telemetry / sheet binding)
export function setCurrentGlbId(id) {
  currentGlbId = id;
}

// Default export
export default {
  ensureViewer,
  loadGlbFromDrive,
  listMaterials,
  applyMaterialProps,
  resetMaterial,
  resetAllMaterials,
  getScene,
  projectPoint,
  addPinMarker,
  removePinMarker,
  clearPins,
  onRenderTick,
  onCanvasShiftPick,
  onPinSelect,
  setPinSelected,
  setCurrentGlbId
};
