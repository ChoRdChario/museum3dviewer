// --- LM auth resolver without dynamic import (classic-safe) ---
function __lm_getAuth() {
  const gauth = window.__LM_auth || {};
  return {
    ensureToken: (typeof gauth.ensureToken === 'function'
                    ? gauth.ensureToken
                    : (typeof window.ensureToken === 'function'
                        ? window.ensureToken
                        : async function(){ return window.__LM_TOK; })),
    getAccessToken: (typeof gauth.getAccessToken === 'function'
                       ? gauth.getAccessToken
                       : (typeof window.getAccessToken === 'function'
                           ? window.getAccessToken
                           : async function(){
                               const tok = await (this.ensureToken());
                               return tok || window.__LM_TOK;
                             }))
  };
}

// --- LM Sheets fetch helper (uses auth resolver above) ---
async function __lm_fetchJSONAuth(url, options={}) {
  const { getAccessToken } = __lm_getAuth();
  const token = await getAccessToken();
  if (!token) {
    console.warn('[viewer.module] no access token available');
  }
  const headers = Object.assign(
    {
      'Accept': 'application/json',
    },
    options.headers || {},
    token ? { 'Authorization': `Bearer ${token}` } : {}
  );
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if (!res.ok) {
    const text = await res.text();
    console.warn('[viewer.module] fetchJSONAuth error', res.status, text);
    throw new Error(`fetchJSONAuth failed: ${res.status}`);
  }
  return res.json();
}

// Sheets read helper specialized for LM materials
async function __lm_readMaterialsConfig(spreadsheetId, materialsGid, sheetGid) {
  if (!spreadsheetId || !materialsGid) {
    console.warn('[viewer.module] __lm_readMaterialsConfig missing ids', { spreadsheetId, materialsGid });
    return {};
  }
  try {
    const range = `'__LM_MATERIALS'!A2:J`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
    const data = await __lm_fetchJSONAuth(url, { method: 'GET' });

    const rows = (data.values || []);
    const cfg = {};
    for (const row of rows) {
      // 想定カラム:
      // A: materialKey
      // B: sheetGid
      // C: opacity
      // D: doubleSided
      // E: unlitLike
      // F: chromaEnable
      // G: chromaColor
      // H: chromaTolerance
      // I: chromaFeather
      // J: reserved
      const matKey = row[0] || '';
      const gidStr = row[1] || '';
      if (!matKey) continue;
      if (gidStr !== String(sheetGid)) continue;

      const entry = cfg[matKey] || (cfg[matKey] = {});
      if (typeof row[2] !== 'undefined' && row[2] !== '') {
        const v = parseFloat(row[2]);
        if (!Number.isNaN(v)) entry.opacity = v;
      }
      if (typeof row[3] !== 'undefined' && row[3] !== '') {
        entry.doubleSided = (row[3] === 'TRUE' || row[3] === 'true' || row[3] === '1');
      }
      if (typeof row[4] !== 'undefined' && row[4] !== '') {
        entry.unlitLike = (row[4] === 'TRUE' || row[4] === 'true' || row[4] === '1');
      }
      if (typeof row[5] !== 'undefined' && row[5] !== '') {
        entry.chromaEnable = (row[5] === 'TRUE' || row[5] === 'true' || row[5] === '1');
      }
      if (typeof row[6] !== 'undefined' && row[6] !== '') {
        entry.chromaColor = row[6];
      }
      if (typeof row[7] !== 'undefined' && row[7] !== '') {
        const v = parseFloat(row[7]);
        if (!Number.isNaN(v)) entry.chromaTolerance = v;
      }
      if (typeof row[8] !== 'undefined' && row[8] !== '') {
        const v = parseFloat(row[8]);
        if (!Number.isNaN(v)) entry.chromaFeather = v;
      }
    }
    console.log('[viewer.module] __lm_readMaterialsConfig loaded', Object.keys(cfg).length, 'entries for sheet', sheetGid);
    return cfg;
  } catch (e) {
    console.warn('[viewer.module] __lm_readMaterialsConfig error', e);
    return {};
  }
}

// --- Three.js viewer core ---

let renderer, scene, camera, controls, animationId;
let currentGlb = null;
let mixer = null;
let clock = null;
let renderCallbacks = [];
let canvasElementRef = null;
let currentGlbId = null;
let orbitTarget = null;

const viewerMaterials = Object.create(null);

function clearScene() {
  if (!scene) return;
  while (scene.children.length > 0) {
    scene.remove(scene.children[0]);
  }
}

function disposeRenderer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement = null;
    renderer = null;
  }
  scene = null;
  camera = null;
  controls = null;
  clock = null;
  renderCallbacks = [];
  currentGlb = null;
  mixer = null;
  orbitTarget = null;
}

function addRenderCallback(fn) {
  if (typeof fn !== 'function') return;
  renderCallbacks.push(fn);
}

const MATERIAL_DEFAULTS = {
  opacity: 1.0,
  doubleSided: false,
  unlitLike: false,
  chromaEnable: false,
  chromaColor: '#000000',
  chromaTolerance: 0.0,
  chromaFeather: 0.0,
};

function getScene() {
  return scene || null;
}

function setCurrentGlbId(id) {
  currentGlbId = id || null;
}

function applyMaterialStateToMeshMaterial(mat, nextState){
  if (!mat) return;
  const s = nextState || {};
  const opaqueOpacity = (typeof s.opacity === 'number' ? s.opacity : MATERIAL_DEFAULTS.opacity);
  mat.transparent = opaqueOpacity < 1.0;
  mat.opacity = opaqueOpacity;

  if (typeof s.doubleSided === 'boolean') {
    mat.side = s.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  } else {
    mat.side = MATERIAL_DEFAULTS.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  }

  if (typeof s.unlitLike === 'boolean') {
    mat.userData = mat.userData || {};
    mat.userData.__lm_unlitEnabled = !!s.unlitLike;
  } else {
    if (mat.userData) delete mat.userData.__lm_unlitEnabled;
  }

  mat.needsUpdate = true;
}

// ★★ ここが今回差し替えた Unlit 用フック本体 ★★
function ensureUnlitHook(mat){
  if (!mat) return;
  mat.userData = mat.userData || {};
  if (mat.userData.__lm_unlitHookInstalled) return;
  mat.userData.__lm_unlitHookInstalled = true;

  const backupOnBeforeCompile = mat.onBeforeCompile;
  mat.userData.__lm_unlitBackupOnBeforeCompile = backupOnBeforeCompile || null;

  mat.onBeforeCompile = function(shader){
    if (typeof backupOnBeforeCompile === 'function'){
      backupOnBeforeCompile.call(this, shader);
    }

    let src = shader.fragmentShader || '';
    const tokenMain = 'void main() {';
    const tokenTone = '#include <tonemapping_fragment>';

    const hasMain = src.includes(tokenMain);
    const hasTone = src.includes(tokenTone);
    if (!(hasMain && hasTone)){
      // パターンが見つからない場合は何もせず安全側に倒す
      shader.fragmentShader = src;
      return;
    }

    // uniform の注入
    const uniformsDecl = [
      'uniform bool uLmUnlit;',
      ''
    ].join('\n');
    src = src.replace(tokenMain, uniformsDecl + '\n' + tokenMain);

    // lit/unlit の切り替えロジックをトーンマッピング直前に挿入
    const inject = [
      '',
      '// [lm-unlit] conditional unlit override',
      'if (uLmUnlit) {',
      '  gl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );',
      '}',
      ''
    ].join('\n');

    src = src.replace(tokenTone, inject + '\n' + tokenTone);

    shader.fragmentShader = src;
    shader.uniforms = shader.uniforms || {};
    shader.uniforms.uLmUnlit = shader.uniforms.uLmUnlit || { value: !!(mat.userData && mat.userData.__lm_unlitEnabled) };

    // 後からトグルできるように参照を保持
    mat.userData.__lm_unlitUniformRef = shader.uniforms.uLmUnlit;
  };
}

function resetMaterial(materialKey){
  if (!scene) return;
  scene.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || mat.name !== materialKey) continue;

      if (mat.userData && mat.userData.__lm_unlitUniformRef){
        mat.userData.__lm_unlitUniformRef.value = false;
      }
      if (mat.userData && mat.userData.__lm_unlitEnabled){
        delete mat.userData.__lm_unlitEnabled;
      }
      mat.opacity = 1.0;
      mat.transparent = false;
      mat.side = THREE.FrontSide;
      mat.needsUpdate = true;
    }
  });
}

function resetAllMaterials(){
  if (!scene) return;
  scene.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.userData && mat.userData.__lm_unlitUniformRef){
        mat.userData.__lm_unlitUniformRef.value = false;
      }
      if (mat.userData && mat.userData.__lm_unlitEnabled){
        delete mat.userData.__lm_unlitEnabled;
      }
      mat.opacity = 1.0;
      mat.transparent = false;
      mat.side = THREE.FrontSide;
      mat.needsUpdate = true;
    }
  });
}

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

console.log('[viewer.module] Three version', THREE.REVISION);

export async function ensureViewer(canvasElement) {
  if (canvasElementRef && canvasElementRef !== canvasElement) {
    disposeRenderer();
  }

  canvasElementRef = canvasElement;

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);
  }

  if (!scene) {
    scene = new THREE.Scene();
    scene.background = null;
  }

  if (!camera) {
    camera = new THREE.PerspectiveCamera(
      45,
      canvasElement.clientWidth / canvasElement.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 3);
  }

  if (!controls) {
    controls = new OrbitControls(camera, canvasElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.target.set(0, 0, 0);
    controls.update();
  }

  if (!clock) {
    clock = new THREE.Clock();
  }

  function onWindowResize() {
    if (!renderer || !camera || !canvasElementRef) return;
    const width = canvasElementRef.clientWidth;
    const height = canvasElementRef.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', onWindowResize);

  function renderLoop() {
    animationId = requestAnimationFrame(renderLoop);

    const delta = clock.getDelta();

    if (mixer) {
      mixer.update(delta);
    }

    if (controls) controls.update();

    for (const fn of renderCallbacks) {
      try {
        fn(delta);
      } catch (e) {
        console.warn('[viewer.module] render callback error', e);
      }
    }

    renderer.render(scene, camera);
  }

  if (!animationId) {
    renderLoop();
  }

  return { renderer, scene, camera, controls };
}

export async function loadGlbFromDrive(fileId, opts = {}) {
  const { applyMaterialsFromSheet } = opts;
  if (!fileId) throw new Error('fileId is required');

  const canvas = canvasElementRef;
  if (!canvas) throw new Error('Canvas not set; call ensureViewer first');

  const { renderer, scene, camera, controls } = await ensureViewer(canvas);
  clearScene();

  const { getAccessToken } = __lm_getAuth();
  const token = await getAccessToken();
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text();
    console.error('[viewer.module] GLB fetch error', res.status, text);
    throw new Error(`GLB fetch failed: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const loader = new THREE.GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', gltf => {
      currentGlb = gltf;

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
      }

      scene.add(gltf.scene);

      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fov = camera.fov * (Math.PI / 180);
      const cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.3;

      camera.position.set(center.x, center.y, center.z + cameraZ);
      camera.near = maxDim / 100;
      camera.far = maxDim * 10;
      camera.updateProjectionMatrix();

      controls.target.copy(center);
      controls.update();

      orbitTarget = center.clone();

      viewerMaterials.__lm_materialsMap = Object.create(null);
      gltf.scene.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) return;
          const key = mat.name || '(noname)';
          viewerMaterials.__lm_materialsMap[key] = viewerMaterials.__lm_materialsMap[key] || [];
          viewerMaterials.__lm_materialsMap[key].push(mat);

          ensureUnlitHook(mat);
        }
      });

      console.log('[viewer.module] materials indexed', Object.keys(viewerMaterials.__lm_materialsMap));

      if (typeof applyMaterialsFromSheet === 'function') {
        try {
          applyMaterialsFromSheet();
        } catch (e) {
          console.warn('[viewer.module] applyMaterialsFromSheet error', e);
        }
      }

      resolve({ gltf, scene, camera, controls });
    }, err => {
      console.error('[viewer.module] GLB parse error', err);
      reject(err);
    });
  });
}

export function listMaterials() {
  const map = viewerMaterials.__lm_materialsMap || {};
  return Object.keys(map);
}

export function applyMaterialProps(materialKey, nextState){
  const map = viewerMaterials.__lm_materialsMap || {};
  const targets = map[materialKey] || [];
  console.log('[viewer.materials] applyMaterialProps', materialKey, nextState, 'targets', targets.length);

  for (const mat of targets) {
    applyMaterialStateToMeshMaterial(mat, nextState);

    if (mat.userData && mat.userData.__lm_unlitUniformRef){
      mat.userData.__lm_unlitUniformRef.value = !!nextState.unlitLike;
    }

    mat.needsUpdate = true;
  }
}

console.log('[viewer.materials] ready', Object.keys(viewerMaterials));

export function addPinMarker(position, options = {}) {
  if (!scene) return null;
  const size = options.size || 0.01;
  const color = options.color || 0xff0000;
  const geom = new THREE.SphereGeometry(size, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(position);
  scene.add(mesh);
  return mesh;
}

export function removePinMarker(mesh) {
  if (!scene || !mesh) return;
  scene.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) mesh.material.dispose();
}

export function clearPins() {
  if (!scene) return;
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.__lm_isPinMarker) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
}

export function projectPoint(worldPos, cameraOverride) {
  const cam = cameraOverride || camera;
  if (!renderer || !cam) return null;
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  const projected = worldPos.clone().project(cam);
  const x = (projected.x + 1) / 2 * width;
  const y = (-projected.y + 1) / 2 * height;
  return { x, y, z: projected.z };
}

export function onRenderTick(fn) {
  addRenderCallback(fn);
}

export function onCanvasShiftPick(domCanvas, handler) {
  if (!domCanvas || typeof handler !== 'function') return;
  domCanvas.addEventListener('click', ev => {
    if (!ev.shiftKey) return;
    if (!scene || !camera) return;
    const rect = domCanvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length > 0) {
      const p = intersects[0].point.clone();
      handler(p, intersects[0]);
    }
  });
}

// LociMyu patch: export getScene for external callers
export { getScene, resetMaterial, resetAllMaterials, setCurrentGlbId };
