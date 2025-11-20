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
                           : function(){ return window.__LM_TOK; }))
  };
}
// --- end resolver ---


// viewer.module.cdn.js — Three.js viewer with pins & picking/filters

// ===== Materials API (WIP) =====
const __matList = []; // {index, name, material, key}
const __origMat = new WeakMap(); // Mesh -> snapshot
let __glbId = null;

function __snapshotIfNeeded(mesh){
  if(!__origMat.has(mesh)){
    const m = mesh.material;
    const mats = Array.isArray(m) ? m : [m];
    const snap = mats.map(mm => {
      if(!mm) return null;
      return {
        transparent: mm.transparent,
        opacity: mm.opacity,
        side: mm.side,
        depthWrite: mm.depthWrite,
        colorWrite: mm.colorWrite,
        alphaTest: mm.alphaTest,
        color: mm.color ? mm.color.clone() : null,
      };
    });
    __origMat.set(mesh, snap);
  }
  return __origMat.get(mesh);
}

function __restoreMaterial(mesh){
  const snap = __origMat.get(mesh);
  if(!snap) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for(let i=0;i<mats.length;i++){
    const mm = mats[i];
    const ss = snap[i];
    if(!mm || !ss) continue;
    mm.transparent = ss.transparent;
    mm.opacity = ss.opacity;
    mm.side = ss.side;
    mm.depthWrite = ss.depthWrite;
    mm.colorWrite = ss.colorWrite;
    mm.alphaTest = ss.alphaTest;
    if(mm.color && ss.color){
      mm.color.copy(ss.color);
    }
    mm.needsUpdate = true;
  }
}

// traverse scene and build unique material list
function __rebuildMaterialList(){
  __matList.length = 0;
  if(!scene) return;
  const matSet = new Map(); // material -> record
  let idx = 0;
  scene.traverse(obj => {
    if(obj && obj.isMesh){
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats){
        if(!mat) continue;
        const baseName = (mat.name || '').trim() || `#${idx}`;
        const key = baseName; // use plain material name as key (UI + sheet compatible)
        if(!matSet.has(mat)){
          const rec = { index: idx, name: baseName, material: mat, key };
          matSet.set(mat, rec);
          __matList.push(rec);
          idx++;
        }
      }
    }
  });
}


export function listMaterials(){
  __rebuildMaterialList();
  return __matList.map(({index,name,key})=>({index,name,materialKey:key}));
}

function __materialsByKey(materialKey){
  const out=[];
  for(const {material, key} of __matList){
    if(key === materialKey) out.push(material);
  }
  return out;
}

// apply properties to all materials that match the 'materialKey'
export function applyMaterialProps(materialKey, props={}){
  __rebuildMaterialList();
  const mats = __materialsByKey(materialKey);
  if(!mats.length){
    console.warn('[viewer.materials] no materials with key', materialKey);
    return;
  }
  for(const mat of mats){
    if(!mat) continue;

    // if the material belongs to some mesh, capture snapshot first
    // we only handle MeshStandardMaterial / MeshPhongMaterial for now
    try {
      if(mat.userData && mat.userData.__lm_mesh_ref){
        __snapshotIfNeeded(mat.userData.__lm_mesh_ref);
      }
    } catch(_){}

    if('opacity' in props){
      mat.transparent = props.opacity < 1.0;
      mat.opacity = props.opacity;
    }
    if('doubleSide' in props){
      mat.side = props.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
    }
    if('unlit' in props){
      // naive unlit emulation: disable lighting-related flags
      if(props.unlit){
        mat.lights = false;
        mat.emissive = mat.emissive || new THREE.Color(0xffffff);
        mat.emissiveIntensity = 1.0;
      } else {
        mat.lights = true;
      }
    }
    if('chromaKeyColor' in props){
      // store into userData; shader patch is handled in material.runtime.patch.js
      mat.userData = mat.userData || {};
      mat.userData.__lm_chroma = {
        color: props.chromaKeyColor || '#000000',
        tolerance: props.chromaKeyTolerance ?? 0.1,
        feather: props.chromaKeyFeather ?? 0.05
      };
    }
    mat.needsUpdate = true;
  }
}

// export to be reachable from window.viewerBridge (bridge pattern)
if(typeof window !== 'undefined'){
  window.__lm_viewer_materialApi = {
    listMaterials,
    applyMaterialProps
  };
}

// ===== end Materials API (WIP) =====




// ===== Core viewer code (existing) =====

// Minimal Three.js viewer with GLB loading, picking & simple pin overlay API.
// This file is designed to be imported as an ES module from boot.esm.cdn.js.

let renderer, scene, camera, controls, raycaster, pointer;
let _currentGLB = null;
let _rootGroup = null;
let _pinLayer = 10;
let _pinObjects = []; // { mesh, data }
let _canvas, _domContainer;
let _resizeObserver;

// For filters / visibility
const _filter = {
  onlyMeshName: null,
  hideNonMatching: false,
};

// Utility: create renderer
function createRenderer(canvas){
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  r.setPixelRatio(window.devicePixelRatio || 1);
  r.setSize(canvas.clientWidth, canvas.clientHeight, false);
  r.outputEncoding = THREE.sRGBEncoding || THREE.LinearEncoding;
  return r;
}

// Utility: create default camera
function createCamera(canvas){
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const cam = new THREE.PerspectiveCamera(45, aspect, 0.01, 1000);
  cam.position.set(0, 0, 5);
  return cam;
}

// Utility: create scene
function createScene(){
  const sc = new THREE.Scene();
  sc.background = null; // transparent
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 1, 0);
  sc.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 10, 10);
  dir.castShadow = true;
  sc.add(dir);

  return sc;
}

// Utility: create controls
function createControls(camera, domElement){
  const c = new THREE.OrbitControls(camera, domElement);
  c.enableDamping = true;
  c.dampingFactor = 0.05;
  c.screenSpacePanning = true;
  c.minDistance = 0.1;
  c.maxDistance = 1000;
  return c;
}

// Initialize viewer
export function initViewer(options){
  const {
    canvas,
    container,
    glbId = null,
  } = options || {};

  if(!canvas) throw new Error('initViewer: canvas is required');

  _canvas = canvas;
  _domContainer = container || canvas.parentElement || document.body;

  renderer = createRenderer(canvas);
  scene = createScene();
  camera = createCamera(canvas);
  controls = createControls(camera, canvas);
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  __glbId = glbId || null;

  // resize handling
  const onResize = () => {
    if(!renderer || !camera || !_canvas) return;
    const { clientWidth, clientHeight } = _canvas;
    if(clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  if('ResizeObserver' in window){
    _resizeObserver = new ResizeObserver(onResize);
    _resizeObserver.observe(_canvas);
  }

  // animation loop
  const tick = () => {
    if(!renderer || !scene || !camera) return;
    requestAnimationFrame(tick);
    if(controls) controls.update();
    renderer.render(scene, camera);
  };
  tick();
}

// Load GLB from URL/Blob
export async function loadGLB(objectURL, opts={}){
  if(!_canvas) throw new Error('initViewer must be called before loadGLB');

  const {
    onProgress,
    onLoaded,
  } = opts;

  const loader = new THREE.GLTFLoader();
  loader.setCrossOrigin('anonymous');

  // Clean up previous
  if(_rootGroup && scene){
    scene.remove(_rootGroup);
    _rootGroup.traverse(obj => {
      if(obj.isMesh && obj.geometry){
        obj.geometry.dispose();
      }
      if(obj.material){
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for(const m of mats){
          if(m && m.map) m.map.dispose();
          if(m && m.dispose) m.dispose();
        }
      }
    });
  }

  return new Promise((resolve, reject) => {
    loader.load(
      objectURL,
      gltf => {
        _currentGLB = gltf;
        _rootGroup = gltf.scene || gltf.scenes[0];

        // attach mesh-ref to materials for snapshot
        _rootGroup.traverse(obj => {
          if(obj.isMesh){
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of mats){
              if(!mat) continue;
              mat.userData = mat.userData || {};
              mat.userData.__lm_mesh_ref = obj;
            }
          }
        });

        scene.add(_rootGroup);

        // fit camera
        const box = new THREE.Box3().setFromObject(_rootGroup);
        const size = box.getSize(new THREE.Vector3()).length();
        const center = box.getCenter(new THREE.Vector3());
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(size*0.8, size*0.6, size*0.8));
        camera.near = Math.max(size/1000, 0.01); camera.far = size*10; camera.updateProjectionMatrix();

        if(onLoaded) onLoaded({ gltf, scene, camera, controls });

        resolve({ gltf, scene, camera, controls });
      },
      xhr => {
        if(onProgress){
          try{
            onProgress(xhr);
          }catch(_){}
        }
      },
      err => {
        console.error('GLB load error', err);
        reject(err);
      }
    );
  });
}

// Picking API (basic)
export function pickAt(clientX, clientY){
  if(!renderer || !camera || !scene) return null;
  const rect = _canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersects = raycaster.intersectObjects(scene.children, true);
  if(!intersects.length) return null;
  const hit = intersects[0];
  return {
    point: hit.point.clone(),
    object: hit.object,
  };
}

// Pin overlay API (very simple: just record & return world positions)
export function addPinAt(worldPos, data){
  const pin = {
    position: worldPos.clone(),
    data: data || null,
  };
  _pinObjects.push(pin);
  return pin;
}

export function listPins(){
  return _pinObjects.slice();
}

export function clearPins(){
  _pinObjects.length = 0;
}

// Filter API
export function setMeshNameFilter(name, hideNonMatching=false){
  _filter.onlyMeshName = name || null;
  _filter.hideNonMatching = !!hideNonMatching;
  if(!_rootGroup) return;
  _rootGroup.traverse(obj => {
    if(!obj.isMesh) return;
    if(!_filter.onlyMeshName){
      obj.visible = true;
    } else {
      const match = (obj.name||'').includes(_filter.onlyMeshName);
      obj.visible = _filter.hideNonMatching ? match : (obj.visible && match);
    }
  });
}

// Simple helper to restore all materials to original
export function restoreAllMaterials(){
  if(!_rootGroup) return;
  _rootGroup.traverse(obj => {
    if(obj.isMesh){
      __restoreMaterial(obj);
    }
  });
}

// Allow external callers to get the underlying scene for more advanced usage
export function getCurrentScene(){
  return scene;
}

// Destroy viewer
export function disposeViewer(){
  try{
    if(_resizeObserver && _canvas){
      _resizeObserver.unobserve(_canvas);
      _resizeObserver.disconnect();
    }
  }catch(_){}
  window.removeEventListener('resize', ()=>{});

  if(renderer){
    renderer.dispose();
    renderer = null;
  }
  if(scene){
    scene.traverse(obj => {
      if(obj.isMesh && obj.geometry) obj.geometry.dispose();
      if(obj.material){
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for(const m of mats){
          if(m && m.map) m.map.dispose();
          if(m && m.dispose) m.dispose();
        }
      }
    });
  }
  scene = null;
  camera = null;
  controls = null;
  _currentGLB = null;
  _rootGroup = null;
  _pinObjects.length = 0;
}

// ---- LociMyu patch: export getScene for external callers ----
export function getScene(){ try{ return scene; }catch(_){ return __lm_scene_ref; } }

