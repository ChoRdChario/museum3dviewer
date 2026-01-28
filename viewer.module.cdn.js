import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * LociMyu viewer module
 *
 * Public API (used by glb.btn.bridge.v3.js):
 *   addPinMarker, applyMaterialProps, clearPins, ensureViewer, getScene,
 *   listMaterials, loadGlbFromDrive, onCanvasShiftPick, onPinSelect,
 *   onRenderTick, projectPoint, removePinMarker, resetAllMaterials,
 *   resetMaterial, setCurrentGlbId, setPinSelected
 *
 * Extended material properties:
 *   props.opacity        : number 0..1
 *   props.doubleSided    : boolean
 *   props.unlitLike      : boolean
 *   props.chromaEnable   : boolean
 *   props.chromaColor    : "#rrggbb"
 *   props.chromaTolerance: number
 *   props.chromaFeather  : number
 */

console.log('[viewer.module] Three version', THREE.REVISION);

// ---------------------------------------------------------------------------
// Core state
// ---------------------------------------------------------------------------

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let canvasRef = null;
let gltfRoot = null;
let currentGlbId = null;

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const materialsByName = Object.create(null);   // materialName -> [material]
const materialBaselines = new Map();          // material -> baselineProps
const renderCallbacks = new Set();            // fn({renderer, scene, camera})
const shiftPickHandlers = new Set();          // fn({point, event, hit})
const pinMarkers = new Map();                 // id -> Object3D
const pinSelectHandlers = new Set();          // fn({id})

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
    const aspect = width / Math.max(height, 1);

    if (camera.isPerspectiveCamera) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    } else if (camera.isOrthographicCamera) {
      // keep vertical size (__lm_ortho_height) and adapt width by aspect
      const h = (__lm_ortho_height != null) ? __lm_ortho_height : Math.max(1, (camera.top - camera.bottom));
      const halfH = h / 2;
      const halfW = halfH * aspect;
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    }

    renderer.setSize(width, height, false);
  };

  window.addEventListener('resize', handleResize);
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

// --- Shader patch: Unlit / Chroma -----------------------------------------

function patchMaterialShader(mat) {
  if (!mat) return;
  if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) return;

  mat.userData = mat.userData || {};
  if (mat.userData.__lmShaderPatched) return;
  mat.userData.__lmShaderPatched = true;

  // note: GLSL 側ではすべて float として扱う
  const uniforms = mat.userData.__lmUniforms = {
    uUnlit:           { value: 0.0 },             // 0 or 1
    uChromaEnable:    { value: 0.0 },             // 0 or 1
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

    // (0) GLSL に uniform 宣言を注入
    // ----------------------------------------------------------------
    if (!src.includes('uUnlit') && !src.includes('uChromaEnable')) {
      const header = `
uniform float uUnlit;
uniform float uChromaEnable;
uniform vec3  uChromaColor;
uniform float uChromaTolerance;
uniform float uChromaFeather;
`;
      const tokenMain = 'void main()';
      if (src.includes(tokenMain)) {
        src = src.replace(tokenMain, header + '\n' + tokenMain);
      } else {
        src = header + '\n' + src;
      }
    }

    // (1) クロマキー注入: <dithering_fragment> の直後
    // ----------------------------------------------------------------
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

    // (2) Unlit: トーンマッピング直前で gl_FragColor を差し替え
    // ----------------------------------------------------------------
    const tokenTone = '#include <tonemapping_fragment>';
    if (src.includes(tokenTone)) {
      src = src.replace(
        tokenTone,
        `
if (uUnlit > 0.5) {
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


function handleCanvasPinClick(ev) {
  // Normal click: select pin -> emit onPinSelect handlers.
  // Do not interfere with shift-click (used for placing new captions).
  if (ev && ev.shiftKey) return;
  if (!scene || !camera || !canvasRef) return;
  // Only handle primary button if present
  if (ev && typeof ev.button === 'number' && ev.button !== 0) return;

  // If no pins, nothing to do
  if (!pinMarkers || pinMarkers.size === 0) return;

  const rect = canvasRef.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  pointerNdc.set(x, y);
  raycaster.setFromCamera(pointerNdc, camera);

  // Intersect only pin meshes so model geometry does not steal the click.
  const objs = Array.from(pinMarkers.values());
  const intersects = raycaster.intersectObjects(objs, true);
  const hit = intersects[0];
  if (!hit) return;

  // Resolve id from userData, allow nested hits just in case
  let obj = hit.object;
  let pid = null;
  for (let i = 0; i < 3 && obj; i++) {
    if (obj.userData && obj.userData.__lmPin && obj.userData.__lmPin.id) { pid = obj.userData.__lmPin.id; break; }
    obj = obj.parent;
  }
  if (!pid) return;

  // Prevent bubbling into UI overlay clicks, etc.
  try { ev.stopPropagation(); } catch (_) {}

  setPinSelected(pid);
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
// Public API: viewer bootstrap
// ---------------------------------------------------------------------------

export async function ensureViewer(opts = {}) {
  const canvas = opts.canvas || opts.el || opts.dom || opts;

  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('[viewer.module] ensureViewer: canvas is required');
  }

  if (renderer && canvasRef === canvas && scene && camera) {
    return { renderer, scene, camera };
  }

  canvasRef = canvas;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });

  // three r15x 系の仕様に合わせる
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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7.5);
  scene.add(dir);

  canvas.removeEventListener('click', handleCanvasShiftClick);
  canvas.addEventListener('click', handleCanvasShiftClick);
  canvas.removeEventListener('click', handleCanvasPinClick);
  canvas.addEventListener('click', handleCanvasPinClick);

  ensureResizeHandler();
  ensureRenderLoop();
  emitSceneReady();

  console.log('[viewer.module] viewer initialized');

  return { renderer, scene, camera };
}

// GLB fetch from Drive
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

        const box = new THREE.Box3().setFromObject(gltfRoot);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
        const fov = THREE.MathUtils.degToRad(camera.fov);
        let distance = maxDim / (2 * Math.tan(fov / 2));
        distance *= 1.5;

        const dz = new THREE.Vector3(0, 0, 1);
        camera.position.copy(center).addScaledVector(dz, distance);
        camera.near = maxDim / 100;
        camera.far  = maxDim * 100;
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
      err => reject(err || new Error('GLTFLoader parse error'))
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
    // scalar props
    if (typeof props.opacity === 'number') {
      mat.opacity = props.opacity;
      mat.transparent = props.opacity < 1.0; // chroma handled by material.runtime.patch (cutout/discard)
    }

    if (typeof props.doubleSided !== 'undefined') {
      mat.side = props.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    }

    // uniforms
    const uniforms = mat.userData && mat.userData.__lmUniforms;
    if (uniforms) {
      if (typeof props.unlitLike !== 'undefined' && uniforms.uUnlit) {
        uniforms.uUnlit.value = props.unlitLike ? 1.0 : 0.0;
        if ('toneMapped' in mat) mat.toneMapped = !props.unlitLike;
      }

      // NOTE: chroma* props are intentionally ignored here.
      // Chroma-key is implemented as cutout/discard in material.runtime.patch.js to avoid transparency sorting artifacts.




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
      opacity:    base.opacity,
      transparent: base.transparent,
      side:        base.side,
      toneMapped:  base.toneMapped,
      depthWrite:  base.depthWrite,
      depthTest:   base.depthTest
    });

    const uniforms = mat.userData && mat.userData.__lmUniforms;
    if (uniforms) {
      uniforms.uUnlit.value           = 0.0;
      uniforms.uChromaEnable.value    = 0.0;
      uniforms.uChromaColor.value.set(0, 0, 0);
      uniforms.uChromaTolerance.value = 0.0;
      uniforms.uChromaFeather.value   = 0.0;
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
// Pins / overlay
// ---------------------------------------------------------------------------

export function getScene() {
  return scene;
}

export function projectPoint(pos) {
  if (!camera || !canvasRef || !pos) return null;

  const v = new THREE.Vector3(pos.x, pos.y, pos.z);
  v.project(camera);

  const rect = (typeof canvasRef.getBoundingClientRect === 'function')
    ? canvasRef.getBoundingClientRect()
    : null;

  const width = rect && rect.width ? rect.width
    : (canvasRef.clientWidth || canvasRef.width || (typeof window !== 'undefined' ? window.innerWidth : 0));

  const height = rect && rect.height ? rect.height
    : (canvasRef.clientHeight || canvasRef.height || (typeof window !== 'undefined' ? window.innerHeight : 0));

  if (!width || !height) {
    // フォールバックとして 0..1 の正規化座標を返す
    return {
      x: (v.x + 1) / 2,
      y: 1 - (v.y + 1) / 2,
      z: v.z
    };
  }

  const x = (rect ? rect.left : 0) + (v.x + 1) / 2 * width;
  const y = (rect ? rect.top  : 0) + (1 - (v.y + 1) / 2) * height;

  return { x, y, z: v.z };
}

export function addPinMarker(pin) {
  if (!scene) return;
  if (!pin || !pin.id || !pin.position) return;

  removePinMarker(pin.id);

  const geom = new THREE.SphereGeometry(0.006, 8, 8);

  // ピンカラー: UI / シートから渡される pin.color を優先し、なければ赤
  let color = 0xff0000;
  try {
    if (pin.color != null) {
      if (typeof pin.color === 'number') {
        color = pin.color;
      } else if (typeof pin.color === 'string') {
        const c = new THREE.Color(pin.color);
        color = c;
      }
    }
  } catch (e) {
    try { console.warn('[viewer.module] invalid pin color', pin.color, e); } catch (_) {}
  }

  const mat  = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(pin.position.x, pin.position.y, pin.position.z);
  mesh.userData.__lmPin = { id: pin.id, data: pin };

  scene.add(mesh);
  pinMarkers.set(pin.id, mesh);
  try{ __lm_applyPinColorFilter(); }catch(_){ }
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


// --- Pin visibility filter / pulse (UI tuning) -------------------------------

let __lm_pin_color_filter = null;      // Set("#rrggbb") or null
let __lm_pin_filter_always_id = null;  // id to force visible (e.g., selected)

function __lm_pinColorToHex(pinColor, mesh){
  // Prefer explicit pinColor (string) from caption store; fallback to mesh material
  try{
    if (pinColor != null){
      if (typeof pinColor === 'string'){
        return __lm_normHex(pinColor);
      }
      if (typeof pinColor === 'number' && isFinite(pinColor)){
        const s = (pinColor >>> 0).toString(16).padStart(6,'0');
        return '#' + s.slice(-6).toLowerCase();
      }
    }
  }catch(_){}
  try{
    const c = mesh && mesh.material && mesh.material.color;
    if (c && typeof c.getHexString === 'function'){
      return '#' + c.getHexString().toLowerCase();
    }
  }catch(_){}
  return null;
}

function __lm_applyPinColorFilter(){
  const active = (__lm_pin_color_filter === null) ? null : __lm_pin_color_filter;
  for (const [id, mesh] of pinMarkers.entries()){
    if (!mesh) continue;
    if (!active){
      mesh.visible = true;
      continue;
    }
    if (__lm_pin_filter_always_id && String(id) === String(__lm_pin_filter_always_id)){
      mesh.visible = true;
      continue;
    }
    const data = (mesh.userData && mesh.userData.__lmPin && mesh.userData.__lmPin.data) ? mesh.userData.__lmPin.data : null;
    const hex = __lm_pinColorToHex(data && data.color, mesh);
    mesh.visible = !!(hex && active.has(hex));
  }
}

export function setPinColorFilter(colors, opts){
  // colors: array of "#rrggbb" strings
  //   - null/undefined => filter OFF (show all)
  //   - []             => filter ON but empty (show none)
  //   - ["#rrggbb",..] => filter ON (show subset)
  // opts: { alwaysShowId?: string }
  let set = null;
  try{
    if (Array.isArray(colors) && colors.length === 0){
      // Explicit empty list means "hide all pins"
      set = new Set();
    }else{
      const arr = Array.isArray(colors) ? colors : (colors ? [colors] : []);
      for (const c of arr){
        const hex = __lm_normHex(c);
        if (!hex) continue;
        if (!set) set = new Set();
        set.add(hex);
      }
    }
  }catch(_){ set = null; }

  __lm_pin_color_filter = set;
  __lm_pin_filter_always_id = (opts && opts.alwaysShowId) ? String(opts.alwaysShowId) : null;

  try{ __lm_applyPinColorFilter(); }catch(e){
    console.warn('[viewer.module] apply pin filter failed', e);
  }
}

export function getPinColorFilter(){
  try{
    if (!__lm_pin_color_filter) return [];
    return Array.from(__lm_pin_color_filter.values());
  }catch(_){
    return [];
  }
}

// Pulse effect (visual aid for selected pin)
const __lm_pin_pulses = new Map(); // pinId -> { mesh, startMs, durMs }
let __lm_pulse_tick_installed = false;

function __lm_removePulse(pinId){
  const st = __lm_pin_pulses.get(pinId);
  if (!st || !st.mesh) { __lm_pin_pulses.delete(pinId); return; }
  try{ if (scene) scene.remove(st.mesh); }catch(_){}
  try{ if (st.mesh.geometry && st.mesh.geometry.dispose) st.mesh.geometry.dispose(); }catch(_){}
  try{ if (st.mesh.material && st.mesh.material.dispose) st.mesh.material.dispose(); }catch(_){}
  __lm_pin_pulses.delete(pinId);
}

function __lm_ensurePulseTick(){
  if (__lm_pulse_tick_installed) return;
  __lm_pulse_tick_installed = true;
  renderCallbacks.add(({camera})=>{
    if (!camera) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    for (const [pinId, st] of Array.from(__lm_pin_pulses.entries())){
      const mesh = st.mesh;
      if (!mesh) { __lm_pin_pulses.delete(pinId); continue; }
      const t = (now - st.startMs) / Math.max(st.durMs, 1);
      if (t >= 1){
        __lm_removePulse(pinId);
        continue;
      }
      // easeOutCubic
      const tt = 1 - Math.pow(1 - t, 3);
      const s = 1 + tt * 6.0; // scale up to ~7x
      mesh.scale.setScalar(s);

      if (mesh.material){
        mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
      }
      // billboard
      try{ mesh.quaternion.copy(camera.quaternion); }catch(_){}
    }
  });
}

export function pulsePin(pinId, opts){
  const id = pinId != null ? String(pinId) : '';
  if (!id) return false;
  const marker = pinMarkers.get(id);
  if (!marker || !scene) return false;

  // Respect active filter: if the marker is currently not visible, do not pulse
  if (marker.visible === false) return false;

  // Replace existing pulse for this pin (coalesce)
  try{ __lm_removePulse(id); }catch(_){}

  const rIn = 0.0072;// 60% size
  const rOut = 0.0108;// 60% size
  const geom = new THREE.RingGeometry(rIn, rOut, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(geom, mat);
  ring.renderOrder = 999;
  ring.position.copy(marker.position);

  scene.add(ring);

  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  __lm_pin_pulses.set(id, { mesh: ring, startMs: now, durMs: 750 });

  __lm_ensurePulseTick();
  return true;
}


export function onRenderTick(fn) {
  if (typeof fn !== 'function') return () => {};
  renderCallbacks.add(fn);
  return () => { renderCallbacks.delete(fn); };
}

export function onCanvasShiftPick(fn) {
  if (typeof fn !== 'function') return () => {};
  shiftPickHandlers.add(fn);
  return () => { shiftPickHandlers.delete(fn); };
}

export function onPinSelect(fn) {
  if (typeof fn !== 'function') return () => {};
  pinSelectHandlers.add(fn);
  return () => { pinSelectHandlers.delete(fn); };
}

export function setPinSelected(id) {
  for (const fn of pinSelectHandlers) {
    try { fn(id); } catch (e) {
      console.warn('[viewer.module] pinSelect handler error', e);
    }
  }
}

export function setCurrentGlbId(id) {
  currentGlbId = id;
}


// ---------------------------------------------------------------------------
// Views API (Phase 1: runtime-only)
// ---------------------------------------------------------------------------

let __lm_bg_hex = null;          // "#rrggbb" when explicitly set
let __lm_bg_unset = true;        // true => "unset" (transparent, CSS background)
let __lm_ortho_height = null;    // vertical view size in world units (for Ortho)
let __lm_last_persp_fov = 45;    // last known perspective fov

function __lm_normHex(hex) {
  if (hex == null) return null;
  let s = String(hex).trim();
  if (!s) return null;
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#' + s.toLowerCase();
}
function __lm_hexToInt(hex6) {
  const s = String(hex6).replace('#', '');
  return parseInt(s, 16);
}
function __lm_getCanvasWH() {
  const w = (canvasRef && (canvasRef.clientWidth || canvasRef.width)) || 800;
  const h = (canvasRef && (canvasRef.clientHeight || canvasRef.height)) || 600;
  return { w, h, aspect: w / Math.max(h, 1) };
}
function __lm_rebuildControls(targetVec3) {
  if (!canvasRef || !camera) return;
  try {
    const old = controls;
    controls = new OrbitControls(camera, canvasRef);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    if (targetVec3) controls.target.copy(targetVec3);
    else if (old && old.target) controls.target.copy(old.target);
    controls.update();
  } catch (e) {
    console.warn('[viewer.module] rebuild controls failed', e);
  }
}

export function getBackgroundColor() {
  return __lm_bg_unset ? null : __lm_bg_hex;
}

export function setBackgroundColor(hex) {
  if (!renderer) return;
  const n = __lm_normHex(hex);
  if (!n) {
    // Unset => transparent, let CSS background show through
    __lm_bg_hex = null;
    __lm_bg_unset = true;
    try { renderer.setClearColor(0x000000, 0); } catch (e) {}
    return;
  }
  __lm_bg_hex = n;
  __lm_bg_unset = false;
  try { renderer.setClearColor(__lm_hexToInt(n), 1); } catch (e) {}
}

export function getCameraState() {
  const type = (camera && camera.isOrthographicCamera) ? 'orthographic' : 'perspective';
  const eye = camera ? camera.position : new THREE.Vector3();
  const up = camera ? camera.up : new THREE.Vector3(0, 1, 0);
  const tgt = (controls && controls.target) ? controls.target : new THREE.Vector3();

  const state = {
    type,
    eye: { x: eye.x, y: eye.y, z: eye.z },
    target: { x: tgt.x, y: tgt.y, z: tgt.z },
    up: { x: up.x, y: up.y, z: up.z }
  };

  if (camera && camera.isPerspectiveCamera) {
    state.fov = camera.fov;
  } else if (camera && camera.isOrthographicCamera) {
    state.orthoHeight = Math.max(0.0001, (camera.top - camera.bottom));
  }
  return state;
}

export function setProjection(mode) {
  if (!renderer || !canvasRef) return;
  const m = String(mode || '').toLowerCase();
  if (m !== 'perspective' && m !== 'orthographic') return;
  if (!camera) return;

  const wantOrtho = (m === 'orthographic');
  const isOrtho = !!camera.isOrthographicCamera;
  if (wantOrtho === isOrtho) return;

  const { aspect } = __lm_getCanvasWH();

  const eye = camera.position.clone();
  const up = camera.up.clone();
  const tgt = (controls && controls.target) ? controls.target.clone() : new THREE.Vector3(0, 0, 0);

  // distance from eye to target (used for sensible default)
  const dist = Math.max(0.0001, eye.distanceTo(tgt));

  if (wantOrtho) {
    // derive ortho vertical size from current perspective fov + distance
    if (camera.isPerspectiveCamera) __lm_last_persp_fov = camera.fov;
    const fov = (camera.isPerspectiveCamera ? camera.fov : __lm_last_persp_fov) * Math.PI / 180;
    const viewH = 2 * dist * Math.tan(fov / 2);
    __lm_ortho_height = Math.max(0.0001, viewH);

    const halfH = __lm_ortho_height / 2;
    const halfW = halfH * aspect;

    const ortho = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, camera.near, camera.far);
    ortho.position.copy(eye);
    ortho.up.copy(up);
    ortho.lookAt(tgt);

    camera = ortho;
    __lm_rebuildControls(tgt);
  } else {
    // restore perspective (fov from last known)
    const persp = new THREE.PerspectiveCamera(__lm_last_persp_fov || 45, aspect, camera.near, camera.far);
    persp.position.copy(eye);
    persp.up.copy(up);
    persp.lookAt(tgt);

    camera = persp;
    __lm_rebuildControls(tgt);
  }

  try { window.__LM_CAMERA = camera; } catch (e) {}
  try { emitSceneReady(); } catch (e) {}
}

export function setCameraState(state) {
  if (!state || !camera) return;

  const desired = (state.type || state.cameraType || '').toLowerCase();
  if (desired === 'orthographic' || desired === 'perspective') {
    setProjection(desired);
  }
  if (!camera) return;

  const tgt = state.target || state.lookAt || state.center;
  if (state.eye) {
    camera.position.set(state.eye.x, state.eye.y, state.eye.z);
  }
  if (state.up) {
    camera.up.set(state.up.x, state.up.y, state.up.z);
  }

  if (tgt) {
    if (controls && controls.target) controls.target.set(tgt.x, tgt.y, tgt.z);
    try { camera.lookAt(tgt.x, tgt.y, tgt.z); } catch (e) {}
  }

  if (camera.isPerspectiveCamera && typeof state.fov === 'number' && isFinite(state.fov)) {
    camera.fov = state.fov;
    __lm_last_persp_fov = state.fov;
    camera.updateProjectionMatrix();
  }

  if (camera.isOrthographicCamera) {
    const h = (typeof state.orthoHeight === 'number' && isFinite(state.orthoHeight)) ? state.orthoHeight : null;
    if (h != null) {
      __lm_ortho_height = Math.max(0.0001, h);
      // resize handler will apply aspect; apply immediately too
      const { aspect } = __lm_getCanvasWH();
      const halfH = __lm_ortho_height / 2;
      const halfW = halfH * aspect;
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    }
  }

  try { if (controls) controls.update(); } catch (e) {}
}

export function getModelBounds() {
  if (!gltfRoot) return null;
  try {
    const box = new THREE.Box3().setFromObject(gltfRoot);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return null;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = size.length() / 2;
    return {
      center: { x: center.x, y: center.y, z: center.z },
      size: { x: size.x, y: size.y, z: size.z },
      radius
    };
  } catch (e) {
    console.warn('[viewer.module] getModelBounds failed', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// default export
// ---------------------------------------------------------------------------

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
  setCurrentGlbId,
  getCameraState,
  setCameraState,
  setProjection,
  setBackgroundColor,
  getBackgroundColor,
  getModelBounds
};
