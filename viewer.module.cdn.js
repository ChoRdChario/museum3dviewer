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
                       : (typeof window.getAccessToken
                            ? window.getAccessToken
                            : async function(){
                                const tok = window.__LM_TOK;
                                if (!tok){
                                  await (this.ensureToken || (async function(){}))();
                                  return window.__LM_TOK;
                                }
                                return tok;
                              })),
  };
}

// --- OLD code that used dynamic import (for reference only, not used) ---
// async function __lm_getAuth_dynamic() {
//   const g = await import('./gauth.module.js');
//   return {
//     ensureToken: g.ensureToken,
//     getAccessToken: g.getAccessToken,
//   };
// }

// ------------------ Viewer module core ------------------

// we intentionally wrap in an IIFE-free style to stay ESM-friendly

let renderer;
let camera;
let controls;
let scene;
let _canvas;
let _currentGlbId = null;
const _pinCallbacks = {
  onShiftPick: null,
  onSelect: null,
  onRenderTick: null,
};
let _clock;
let _rafId;
let _resizeObserver;
const _materials = new Map(); // key -> Set(material)
const _materialKeyByMat = new WeakMap(); // material -> key
const __origMat = new WeakMap(); // Mesh -> snapshot
let __globalOverlay = null;

// --- utils ---

function __lm_getCanvas() {
  if (_canvas) return _canvas;
  const c = document.querySelector('#glcanvas') || document.querySelector('canvas');
  if (!c){
    console.warn('[viewer] canvas not found');
    return null;
  }
  _canvas = c;
  return c;
}

function __lm_ensureRenderer() {
  if (renderer) return renderer;
  const canvas = __lm_getCanvas();
  if (!canvas) return null;
  const THREE = window.THREE;
  renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  return renderer;
}

function __lm_ensureScene() {
  if (scene) return scene;
  const THREE = window.THREE;
  scene = new THREE.Scene();
  scene.background = null;
  return scene;
}

function __lm_ensureCamera() {
  if (camera) return camera;
  const THREE = window.THREE;
  const canvas = __lm_getCanvas();
  const rect = canvas.getBoundingClientRect();
  camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.01, 1000);
  camera.position.set(0, 0, 5);
  return camera;
}

function __lm_ensureControls() {
  if (controls) return controls;
  const THREE = window.THREE;
  const canvas = __lm_getCanvas();
  const OrbitControls = THREE.OrbitControls || THREE.OrbitControlsImpl || THREE.OrbitControlsDefault;
  if (!OrbitControls) {
    console.warn('[viewer] OrbitControls not found in THREE namespace');
    return null;
  }
  controls = new OrbitControls(__lm_ensureCamera(), canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.01;
  controls.maxDistance = 1000;
  return controls;
}

function __lm_ensureClock() {
  if (_clock) return _clock;
  const THREE = window.THREE;
  _clock = new THREE.Clock();
  return _clock;
}

function __lm_onResize() {
  const canvas = __lm_getCanvas();
  if (!canvas || !renderer || !camera) return;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (width <= 0 || height <= 0) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function __lm_ensureResizeObserver() {
  if (_resizeObserver) return;
  const canvas = __lm_getCanvas();
  if (!canvas) return;
  _resizeObserver = new ResizeObserver(() => {
    __lm_onResize();
  });
  _resizeObserver.observe(canvas);
}

// --- pin overlay (minimal) ---

function __lm_installOverlay() {
  if (__globalOverlay) return __globalOverlay;
  const canvas = __lm_getCanvas();
  if (!canvas) return null;
  const overlay = document.createElement('div');
  overlay.className = 'lm-viewer-overlay';
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  const parent = canvas.parentElement || document.body;
  parent.style.position = parent.style.position || 'relative';
  parent.appendChild(overlay);
  __globalOverlay = overlay;
  return overlay;
}

function __lm_projectToScreen(vec3) {
  const canvas = __lm_getCanvas();
  if (!canvas || !camera) return null;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const v = vec3.clone();
  v.project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: ( -v.y * 0.5 + 0.5 ) * height,
  };
}

// --- materials registry ---

function __clearMaterialsRegistry() {
  _materials.clear();
  _materialKeyByMat.clear();
}

function __registerMaterial(key, mat) {
  if (!key || !mat) return;
  let set = _materials.get(key);
  if (!set) {
    set = new Set();
    _materials.set(key, set);
  }
  set.add(mat);
  _materialKeyByMat.set(mat, key);
}

function __materialsByKey(key) {
  return _materials.get(key) || [];
}

function __rebuildMaterialList() {
  __clearMaterialsRegistry();
  if (!scene) return;
  scene.traverse(obj => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      const key = mat.name || mat.uuid;
      if (!key) continue;
      __registerMaterial(key, mat);
      if (!__origMat.has(obj)) {
        __origMat.set(obj, {
          material: obj.material,
          visible: obj.visible,
        });
      }
    }
  });
}

// ------------------ public API ------------------

export function listMaterials() {
  __rebuildMaterialList();
  const result = [];
  for (const [key, set] of _materials.entries()) {
    let sample = null;
    for (const m of set) { sample = m; break; }
    if (!sample) continue;
    result.push({
      key,
      name: key,
      count: set.size,
      opacity: sample.opacity,
      side: sample.side,
      transparent: sample.transparent,
      depthWrite: sample.depthWrite,
      depthTest: sample.depthTest,
      alphaTest: sample.alphaTest,
      type: sample.type,
    });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ---- patched applyMaterialProps with Unlit handling ----
export function applyMaterialProps(materialKey, props = {}){
  if (!materialKey) {
    console.warn('[viewer.materials] applyMaterialProps called without materialKey');
    return;
  }

  __rebuildMaterialList();
  const mats = __materialsByKey(materialKey);
  if (!mats || !mats.length){
    console.warn('[viewer.materials] no materials with key', materialKey);
    return;
  }

  console.log('[viewer.materials] applyMaterialProps', materialKey, props, 'targets', mats.length);

  for (const mat of mats){
    if (!mat) continue;

    // --- opacity ---
    if (typeof props.opacity !== 'undefined'){
      const v = Math.max(0, Math.min(1, Number(props.opacity)));
      if (!Number.isNaN(v)){
        mat.opacity = v;
        mat.transparent = v < 1.0 || !!mat.transparent;
        mat.needsUpdate = true;
      }
    }

    // --- double sided / side ---
    if (typeof props.doubleSide !== 'undefined' ||
        typeof props.doubleSided !== 'undefined' ||
        typeof props.side !== 'undefined'){
      try{
        const THREE_NS = window.THREE || (window.viewer && window.viewer.THREE) || null;
        if (!THREE_NS){
          console.warn('[viewer.materials] THREE namespace not found for side/doubleSide');
        } else {
          let sideToken = null;

          // 1) orchestrator から来る props.side を優先
          if (typeof props.side === 'string'){
            sideToken = props.side;
          }
          // 2) props.doubleSided (sheet/オーケストレータ側) もサポート
          else if (typeof props.doubleSided !== 'undefined'){
            sideToken = props.doubleSided ? 'DoubleSide' : 'FrontSide';
          }
          // 3) 旧来の props.doubleSide も後方互換で対応
          else if (typeof props.doubleSide !== 'undefined'){
            sideToken = props.doubleSide ? 'DoubleSide' : 'FrontSide';
          }

          if (sideToken && THREE_NS[sideToken] != null){
            mat.side = THREE_NS[sideToken];
            mat.needsUpdate = true;
          }
        }
      } catch (e){
        console.warn('[viewer.materials] side/doubleSide apply failed', e);
      }
    }

    // --- Unlit / UnlitLike ---
    if (typeof props.unlit !== 'undefined' || typeof props.unlitLike !== 'undefined'){
      const flag = !!(props.unlit ?? props.unlitLike);

      mat.userData = mat.userData || {};
      const ud = mat.userData;

      // 一度だけ、オリジナルのライティング関連プロパティを退避
      if (!ud.__lm_unlitBackup){
        ud.__lm_unlitBackup = {
          lights:          ('lights' in mat) ? mat.lights : undefined,
          toneMapped:      ('toneMapped' in mat) ? mat.toneMapped : undefined,
          envMap:          ('envMap' in mat) ? mat.envMap : undefined,
          envMapIntensity: ('envMapIntensity' in mat) ? mat.envMapIntensity : undefined,
          metalness:       ('metalness' in mat) ? mat.metalness : undefined,
          roughness:       ('roughness' in mat) ? mat.roughness : undefined,
        };
      }
      const backup = ud.__lm_unlitBackup;

      if (flag){
        // 環境光・反射・PBR の影響を極力殺して「テクスチャ色優先」に寄せる
        if ('lights' in mat) mat.lights = false;
        if ('toneMapped' in mat) mat.toneMapped = false;

        if ('envMapIntensity' in mat && typeof mat.envMapIntensity === 'number'){
          mat.envMapIntensity = 0;
        }
        if ('envMap' in mat){
          mat.envMap = null;
        }

        if ('metalness' in mat && typeof mat.metalness === 'number'){
          mat.metalness = 0;
        }
        if ('roughness' in mat && typeof mat.roughness === 'number'){
          mat.roughness = 1;
        }

        // 必要に応じて、エミッシブを少し持ち上げておく（真っ暗対策）
        if (mat.emissive && mat.emissiveIntensity !== undefined && mat.emissiveIntensity < 1.0){
          mat.emissiveIntensity = 1.0;
        }
      } else if (backup){
        // Unlit解除時は退避した値を戻す
        if ('lights' in mat && backup.lights !== undefined){
          mat.lights = backup.lights;
        }
        if ('toneMapped' in mat && backup.toneMapped !== undefined){
          mat.toneMapped = backup.toneMapped;
        }
        if ('envMapIntensity' in mat && backup.envMapIntensity !== undefined){
          mat.envMapIntensity = backup.envMapIntensity;
        }
        if ('envMap' in mat){
          mat.envMap = backup.envMap;
        }
        if ('metalness' in mat && backup.metalness !== undefined){
          mat.metalness = backup.metalness;
        }
        if ('roughness' in mat && backup.roughness !== undefined){
          mat.roughness = backup.roughness;
        }
      }

      mat.needsUpdate = true;
    }

    // --- chroma key (保存のみ。実際のシェーダ適用は別モジュールで) ---
    const ck = {};
    if (typeof props.chromaEnable !== 'undefined') ck.enable = !!props.chromaEnable;
    if (typeof props.chromaColor === 'string')     ck.color = props.chromaColor;
    if (typeof props.chromaTolerance === 'number') ck.tolerance = props.chromaTolerance;
    if (typeof props.chromaFeather === 'number')   ck.feather = props.chromaFeather;

    if (Object.keys(ck).length){
      mat.userData = mat.userData || {};
      mat.userData.__lm_chroma = Object.assign(mat.userData.__lm_chroma || {}, ck);
    }
  }
}

export function resetMaterial(materialKey){
  __rebuildMaterialList();
  const mats = __materialsByKey(materialKey);
  if (!mats || !mats.length){
    console.warn('[viewer.materials] no materials with key for reset', materialKey);
    return;
  }
  for (const mat of mats){
    if (!mat) continue;
    mat.opacity = 1;
    mat.transparent = false;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.alphaTest = 0;
    if (mat.userData){
      delete mat.userData.__lm_chroma;
      delete mat.userData.__lm_unlitBackup;
    }
    if ('lights' in mat) mat.lights = true;
    if ('toneMapped' in mat) mat.toneMapped = true;
    mat.needsUpdate = true;
  }
}

export function resetAllMaterials(){
  __rebuildMaterialList();
  for (const [key, set] of _materials.entries()){
    resetMaterial(key);
  }
}

// ---- pin / interaction API ----

export function projectPoint(vec3){
  return __lm_projectToScreen(vec3);
}

export function setCurrentGlbId(glbId){
  _currentGlbId = glbId;
}

export function onCanvasShiftPick(handler){
  _pinCallbacks.onShiftPick = handler || null;
}

export function onPinSelect(handler){
  _pinCallbacks.onSelect = handler || null;
}

export function onRenderTick(handler){
  _pinCallbacks.onRenderTick = handler || null;
}

// ---- GLB loading ----

async function __lm_loadGLBFromDriveImpl(fileId, accessToken){
  const auth = __lm_getAuth();
  const tok = accessToken || (await auth.getAccessToken());
  if (!tok){
    throw new Error('no access token');
  }
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (!res.ok){
    throw new Error(`drive fetch failed: ${res.status}`);
  }
  const blob = await res.blob();
  return blob;
}

export async function loadGlbFromDrive(fileId, options = {}){
  const canvas = __lm_getCanvas();
  if (!canvas){
    throw new Error('canvas not found');
  }
  const THREE = window.THREE;
  __lm_ensureRenderer();
  __lm_ensureScene();
  __lm_ensureCamera();
  __lm_ensureControls();
  __lm_installOverlay();
  __lm_ensureClock();
  __lm_ensureResizeObserver();

  // cancel previous animation loop if any
  if (_rafId){
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  // clear scene
  if (scene){
    while (scene.children.length){
      scene.remove(scene.children[0]);
    }
  }

  __clearMaterialsRegistry();

  const auth = __lm_getAuth();
  await auth.ensureToken();

  const blob = await __lm_loadGLBFromDriveImpl(fileId);
  const objectURL = URL.createObjectURL(blob);

  const loadingManager = new THREE.LoadingManager();
  const loader = new THREE.GLTFLoader(loadingManager);

  return new Promise((resolve, reject) => {
    loader.load(objectURL, gltf => {
      try {
        scene.add(gltf.scene);
        __rebuildMaterialList();

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3()).length();
        const center = box.getCenter(new THREE.Vector3());

        camera.near = Math.max(size / 1000, 0.01);
        camera.far = size * 10;
        camera.updateProjectionMatrix();

        camera.position.copy(center).add(new THREE.Vector3(size * 0.8, size * 0.6, size * 0.8));
        camera.lookAt(center);
        controls.target.copy(center);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        hemiLight.position.set(0, 1, 0);
        scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 7.5);
        scene.add(dirLight);

        function animate(){
          _rafId = requestAnimationFrame(animate);
          const delta = __lm_ensureClock().getDelta();
          if (controls){
            controls.update();
          }
          if (_pinCallbacks.onRenderTick){
            try {
              _pinCallbacks.onRenderTick({delta});
            } catch (e){
              console.warn('[viewer] onRenderTick handler error', e);
            }
          }
          if (renderer && scene && camera){
            renderer.render(scene, camera);
          }
        }
        animate();

        resolve({
          scene,
          camera,
          controls,
          renderer,
          fileId,
        });
      } catch (e){
        reject(e);
      } finally {
        URL.revokeObjectURL(objectURL);
      }
    }, undefined, err => {
      URL.revokeObjectURL(objectURL);
      reject(err);
    });
  });
}

// ---- ensureViewer (for bridge) ----

export async function ensureViewer(canvasEl){
  if (canvasEl){
    _canvas = canvasEl;
  }
  __lm_getCanvas();
  __lm_ensureRenderer();
  __lm_ensureScene();
  __lm_ensureCamera();
  __lm_ensureControls();
  __lm_installOverlay();
  __lm_ensureClock();
  __lm_ensureResizeObserver();

  if (!_rafId){
    const THREE = window.THREE;
    const animate = () => {
      _rafId = requestAnimationFrame(animate);
      const delta = __lm_ensureClock().getDelta();
      if (controls){
        controls.update();
      }
      if (_pinCallbacks.onRenderTick){
        try {
          _pinCallbacks.onRenderTick({delta});
        } catch (e){
          console.warn('[viewer] onRenderTick handler error', e);
        }
      }
      if (renderer && scene && camera){
        renderer.render(scene, camera);
      }
    };
    animate();
  }
  return { scene, camera, controls, renderer };
}

// ---- canvas events for picking ----

function __lm_installCanvasEvents(){
  const canvas = __lm_getCanvas();
  if (!canvas) return;
  canvas.addEventListener('click', ev => {
    if (!ev.shiftKey) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height * 2 - 1);
    const THREE = window.THREE;
    const mouse = new THREE.Vector2(x, y);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (!intersects.length) return;
    const hit = intersects[0];
    const point = hit.point;
    if (_pinCallbacks.onShiftPick){
      try {
        _pinCallbacks.onShiftPick({point, event: ev});
      } catch (e){
        console.warn('[viewer] onShiftPick handler error', e);
      }
    }
  });
}

__lm_installCanvasEvents();

// ---- debugging helpers (optional) ----

if (typeof window !== 'undefined'){
  window.__lm_viewer = {
    listMaterials,
    applyMaterialProps,
    resetMaterial,
    resetAllMaterials,
    loadGlbFromDrive,
    ensureViewer,
    setCurrentGlbId,
    onCanvasShiftPick,
    onPinSelect,
    onRenderTick,
  };
}

// ---- LociMyu patch: export getScene for external callers ----
export function getScene(){ try{ return scene; }catch(_){ return __lm_scene_ref; } }
