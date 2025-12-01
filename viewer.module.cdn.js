import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- Viewer state ----------------------------------------------------------

let scene, camera, renderer, controls;
let canvas;
let gltfLoader;
let currentGlbId = null;
let animationFrameId = null;

const materialsByName = {};
const materialBaselines = new Map();

const pinMarkers = new Map();
let pinGroup = null;

const renderTickHandlers = new Set();

// --- Init / ensure viewer --------------------------------------------------

function ensureRenderer() {
  if (renderer && canvas) return;

  canvas = document.getElementById('viewerCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'viewerCanvas';
    document.body.appendChild(canvas);
  }

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene = new THREE.Scene();
  scene.background = null;

  const aspect = (canvas.clientWidth || 800) / (canvas.clientHeight || 600);
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 2, 5);

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  light.position.set(0, 1, 0);
  scene.add(light);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5, 10, 7.5);
  scene.add(dirLight);

  const { OrbitControls } = window.THREE_ADDONS || {};
  if (OrbitControls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
  }

  gltfLoader = new GLTFLoader();
}

function ensureRenderLoop() {
  if (animationFrameId != null) return;

  function loop() {
    animationFrameId = requestAnimationFrame(loop);
    if (controls) controls.update();
    for (const fn of renderTickHandlers) {
      try { fn(); } catch (e) {
        console.warn('[viewer.module] render tick error', e);
      }
    }
    renderer.render(scene, camera);
  }
  loop();
}

// --- Pins -------------------------------------------------------------------

function ensurePinGroup() {
  if (pinGroup) return;
  pinGroup = new THREE.Group();
  pinGroup.name = 'LociMyuPins';
  scene.add(pinGroup);
}

function addPinMarker(id, position, color = 0x00ff00) {
  ensurePinGroup();
  const geometry = new THREE.SphereGeometry(0.02, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.userData.pinId = id;
  pinGroup.add(mesh);
  pinMarkers.set(id, mesh);
}

function removePinMarker(id) {
  const mesh = pinMarkers.get(id);
  if (!mesh || !pinGroup) return;
  pinGroup.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  pinMarkers.delete(id);
}

function clearPins() {
  if (!pinGroup) return;
  for (const mesh of pinMarkers.values()) {
    pinGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  pinMarkers.clear();
}

function setPinSelected(id, selected) {
  const mesh = pinMarkers.get(id);
  if (!mesh) return;
  mesh.scale.setScalar(selected ? 1.6 : 1.0);
  if (mesh.material && mesh.material.color) {
    mesh.material.color.offsetHSL(0, 0, selected ? 0.2 : -0.2);
  }
}

// --- GLB load --------------------------------------------------------------

function resetScene() {
  // dispose previous
  clearPins();
  if (scene) {
    const toRemove = [];
    scene.traverse(obj => {
      if (obj.isMesh || obj.isGroup) {
        if (obj.userData && obj.userData.__lmRoot) {
          toRemove.push(obj);
        }
      }
    });
    toRemove.forEach(obj => {
      scene.remove(obj);
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (!m) return;
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  for (const k of Object.keys(materialsByName)) delete materialsByName[k];
  materialBaselines.clear();
}

function loadGlbFromDrive(fileUrl, fileId) {
  ensureRenderer();
  ensureRenderLoop();

  resetScene();

  console.log('[viewer.module] loading GLB', fileId || fileUrl);

  gltfLoader.load(
    fileUrl,
    (gltf) => {
      const root = gltf.scene || gltf.scenes[0];
      root.userData.__lmRoot = true;
      scene.add(root);

      // center and frame
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      root.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
      cameraZ *= 1.5;

      camera.position.set(0, maxDim * 0.2, cameraZ);
      camera.lookAt(new THREE.Vector3(0, 0, 0));
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }

      rebuildMaterialIndex();
      currentGlbId = fileId;
      emitSceneReady();
    },
    undefined,
    (err) => {
      console.error('[viewer.module] gltf load error', err);
    }
  );
}

function emitSceneReady() {
  try {
    const ev = new CustomEvent('lm:scene-ready', {
      detail: { scene, camera, renderer, glbId: currentGlbId }
    });
    window.dispatchEvent(ev);
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
    //     → キー色近傍は discard、エッジのみフェザー
    // ----------------------------------------------------------------
    const tokenDither = '#include <dithering_fragment>';
    if (src.includes(tokenDither)) {
      src = src.replace(
        tokenDither,
        `
#include <dithering_fragment>
if (uChromaEnable > 0.5) {
  // Key color and current pixel color distance in RGB space (0.0 - ~1.732)
  vec3 keyColor = uChromaColor.rgb;
  float dist = distance(diffuseColor.rgb, keyColor);

  // Tolerance +/- feather defines the smooth band
  float edgeLo = max(uChromaTolerance - uChromaFeather, 0.0);
  float edgeHi = uChromaTolerance + uChromaFeather;

  // dist <= edgeLo -> mask ~= 0,  dist >= edgeHi -> mask ~= 1
  float mask = smoothstep(edgeLo, edgeHi, dist);

  // Treat near-key-color region as fully cut out (no depth write)
  if (mask < 0.001) {
    discard;
  }

  // Feather band: gradually reduce alpha
  diffuseColor.a *= mask;
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

// --- Materials index / apply ----------------------------------------------

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
          opacity:    m.opacity,
          transparent:m.transparent,
          side:       m.side,
          toneMapped: m.toneMapped !== undefined ? m.toneMapped : true,
          depthWrite: m.depthWrite,
          depthTest:  m.depthTest
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

export function listMaterials() {
  return Object.keys(materialsByName);
}

export function resetAllMaterials() {
  for (const [mat, baseline] of materialBaselines.entries()) {
    mat.opacity    = baseline.opacity;
    mat.transparent= baseline.transparent;
    mat.side       = baseline.side;
    if ('toneMapped' in mat) mat.toneMapped = baseline.toneMapped;
    mat.depthWrite = baseline.depthWrite;
    mat.depthTest  = baseline.depthTest;

    const uniforms = mat.userData && mat.userData.__lmUniforms;
    if (uniforms) {
      uniforms.uUnlit.value           = 0.0;
      uniforms.uChromaEnable.value    = 0.0;
      uniforms.uChromaTolerance.value = 0.0;
      uniforms.uChromaFeather.value   = 0.0;
      uniforms.uChromaColor.value.set(0, 0, 0);
    }

    mat.needsUpdate = true;
  }
}

export function resetMaterial(name) {
  const mats = getMaterialsByName(name);
  if (!mats.length) return;
  for (const mat of mats) {
    const baseline = materialBaselines.get(mat);
    if (!baseline) continue;
    mat.opacity    = baseline.opacity;
    mat.transparent= baseline.transparent;
    mat.side       = baseline.side;
    if ('toneMapped' in mat) mat.toneMapped = baseline.toneMapped;
    mat.depthWrite = baseline.depthWrite;
    mat.depthTest  = baseline.depthTest;

    const uniforms = mat.userData && mat.userData.__lmUniforms;
    if (uniforms) {
      uniforms.uUnlit.value           = 0.0;
      uniforms.uChromaEnable.value    = 0.0;
      uniforms.uChromaTolerance.value = 0.0;
      uniforms.uChromaFeather.value   = 0.0;
      uniforms.uChromaColor.value.set(0, 0, 0);
    }

    mat.needsUpdate = true;
  }
}

export function applyMaterialProps(materialName, props = {}) {
  const mats = getMaterialsByName(materialName);
  if (!mats.length) return;

  for (const mat of mats) {
    if (typeof props.opacity === 'number') {
      mat.opacity = props.opacity;
      const uniforms = mat.userData && mat.userData.__lmUniforms;
      const chromaOn = uniforms && uniforms.uChromaEnable && uniforms.uChromaEnable.value > 0.5;
      mat.transparent = props.opacity < 1.0 || chromaOn;
    }

    if (typeof props.doubleSided !== 'undefined') {
      mat.side = props.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    }

    const uniforms = mat.userData && mat.userData.__lmUniforms;
    if (uniforms) {
      if (typeof props.unlitLike !== 'undefined' && uniforms.uUnlit) {
        uniforms.uUnlit.value = props.unlitLike ? 1.0 : 0.0;
        if ('toneMapped' in mat) mat.toneMapped = !props.unlitLike;
      }

      if (typeof props.chromaEnable !== 'undefined' && uniforms.uChromaEnable) {
        uniforms.uChromaEnable.value = props.chromaEnable ? 1.0 : 0.0;
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

// --- Projection / picking helper -------------------------------------------

export function getScene() {
  return scene;
}

export function projectPoint(worldPosition) {
  if (!camera || !renderer) return null;
  const vector = worldPosition.clone().project(camera);
  const widthHalf  = (renderer.domElement.clientWidth  || 1) / 2;
  const heightHalf = (renderer.domElement.clientHeight || 1) / 2;
  return {
    x: ( vector.x * widthHalf ) + widthHalf,
    y: ( -vector.y * heightHalf ) + heightHalf
  };
}

export function onCanvasShiftPick(handler) {
  // 外部スクリプト側で実装されている想定
  // ここではダミー（viewer.bridge.autobind 側で上書きされる）
  console.warn('[viewer.module] onCanvasShiftPick default impl; should be overridden');
}

export function onPinSelect(handler) {
  // 外部スクリプト側で実装されている想定
  console.warn('[viewer.module] onPinSelect default impl; should be overridden');
}

// --- Render tick subscription ----------------------------------------------

export function onRenderTick(fn) {
  if (typeof fn === 'function') {
    renderTickHandlers.add(fn);
  }
  return () => renderTickHandlers.delete(fn);
}

// --- Public entrypoints ----------------------------------------------------

export function ensureViewer() {
  ensureRenderer();
  ensureRenderLoop();
}

export function loadGlbFromUrl(url, id) {
  return loadGlbFromDrive(url, id);
}

export function setCurrentGlbId(id) {
  currentGlbId = id;
}

export function addPin(position, color) {
  const id = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  addPinMarker(id, position, color);
  return id;
}

export {
  addPinMarker,
  clearPins,
  removePinMarker,
  setPinSelected,
  rebuildMaterialIndex,
};
