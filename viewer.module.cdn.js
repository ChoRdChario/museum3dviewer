
// --- LM auth resolver without dynamic import (classic-safe) ---
function __lm_getAuth() {
  return {
    ensureToken: (window.__LM_auth && window.__LM_auth.ensureToken) || (window.ensureToken) || (async function(){ return window.__LM_TOK; }),
    getAccessToken: (window.__LM_auth && window.__LM_auth.getAccessToken) || (window.getAccessToken) || (function(){ return window.__LM_TOK; })
  };
}
// --- end resolver ---

// viewer.module.cdn.js — Three.js viewer with pins & picking/filters

// ===== Materials API (WIP) =====
const __matList = []; // {index, name, material, key}
const __origMat = new WeakMap(); // Mesh -> snapshot
let __glbId = null;

export function setCurrentGlbId(glbId){
  __glbId = glbId || null;
}

// traverse scene and build unique material list
function __rebuildMaterialList(){
  __matList.length = 0;
  if(!scene) return;
  const matSet = new Map(); // key -> record
  let idx = 0;
  scene.traverse(obj => {
    if(obj.isMesh){
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats){
        if(!mat) continue;
        const key = `${__glbId||'glb'}::${idx}::${mat.name||''}`;
        if(!matSet.has(mat)){
          const rec = { index: idx, name: mat.name||`#${idx}`, material: mat, key };
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

function __snapshotIfNeeded(mesh){
  if(!__origMat.has(mesh)){
    __origMat.set(mesh, {
      material: mesh.material,
      onBeforeCompile: mesh.material?.onBeforeCompile,
      transparent: mesh.material?.transparent,
      side: mesh.material?.side,
      alphaTest: mesh.material?.alphaTest
    });
  }
}

function __hookMaterial(mat){
  if (!mat || mat.__lmHooked) return;
  mat.__lmHooked = true;
  mat.userData.__lmUniforms = {
    uWhiteThr: { value: 0.92 },
    uBlackThr: { value: 0.08 },
    uWhiteToAlpha: { value: false },
    uBlackToAlpha: { value: false },
    uUnlit: { value: false },
  };
  const u = mat.userData.__lmUniforms;
  mat.onBeforeCompile = (shader)=>{
    shader.uniforms = { ...shader.uniforms, ...u };
    // Inject at alpha computation
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <dithering_fragment>', `
        // LociMyu material hook
        vec3 lmColor = diffuseColor.rgb;
        float lmLuma = dot(lmColor, vec3(0.299, 0.587, 0.114));
        if (uWhiteToAlpha && lmLuma >= uWhiteThr) diffuseColor.a = 0.0;
        if (uBlackToAlpha && lmLuma <= uBlackThr) diffuseColor.a = 0.0;
        #include <dithering_fragment>
      `)
      .replace('#include <lights_fragment_begin>', `
        // Unlit toggle
        if (!uUnlit) {
          #include <lights_fragment_begin>
        }
      `);
  };
  mat.needsUpdate = true;
}

function __allMeshes(){
  const arr=[]; if(!scene) return arr;
  scene.traverse(o=>{ if(o.isMesh) arr.push(o); });
  return arr;
}

function __materialsByKey(materialKey){
  // match by key prefix without index part to avoid instability if needed
  // here we match full key
  const out=[];
  for(const {material, key} of __matList){
    if(key === materialKey) out.push(material);
  }
  return out;
}

export function applyMaterialProps(materialKey, props={}){
  __rebuildMaterialList();
  const mats = __materialsByKey(materialKey);
  for(const mat of mats){
    __hookMaterial(mat);
    if('unlit' in props){
      mat.userData.__lmUniforms.uUnlit.value = !!props.unlit;
    }
    if('opacity' in props){
      const v = Math.max(0, Math.min(1, Number(props.opacity)));
      mat.opacity = v;
      mat.transparent = v < 1 || mat.userData.__lmUniforms.uWhiteToAlpha.value || mat.userData.__lmUniforms.uBlackToAlpha.value;
      mat.alphaTest = (v < 1 ? 0.003 : 0.0);
      mat.needsUpdate = true;
    }
    if('doubleSide' in props){
      mat.side = props.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
      mat.needsUpdate = true;
    }
    if('whiteToTransparent' in props){
      mat.userData.__lmUniforms.uWhiteToAlpha.value = !!props.whiteToTransparent;
      mat.transparent = mat.transparent || !!props.whiteToTransparent;
      mat.needsUpdate = true;
    }
    if('whiteThreshold' in props){
      mat.userData.__lmUniforms.uWhiteThr.value = Number(props.whiteThreshold);
    }
    if('blackToTransparent' in props){
      mat.userData.__lmUniforms.uBlackToAlpha.value = !!props.blackToTransparent;
      mat.transparent = mat.transparent || !!props.blackToTransparent;
      mat.needsUpdate = true;
    }
    if('blackThreshold' in props){
      mat.userData.__lmUniforms.uBlackThr.value = Number(props.blackThreshold);
    }
  }
}

export function resetMaterial(materialKey){
  __rebuildMaterialList();
  const mats = __materialsByKey(materialKey);
  for(const mat of mats){
    if(!mat) continue;
    // remove hook flags
    if(mat.userData && mat.userData.__lmUniforms){
      delete mat.userData.__lmUniforms;
    }
    mat.__lmHooked = false;
    mat.onBeforeCompile = null;
    mat.transparent = false;
    mat.alphaTest = 0.0;
    mat.side = THREE.FrontSide;
    mat.needsUpdate = true;
  }
}

export function resetAllMaterials(){
  __rebuildMaterialList();
  for(const rec of __matList){
    resetMaterial(rec.key);
  }
}

import * as THREE from 'https://unpkg.com/three@0.159.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.159.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.159.0/examples/jsm/loaders/GLTFLoader.js';

let renderer, scene, camera, controls, raycaster, canvasEl;
const pickHandlers = new Set();
const pinSelectHandlers = new Set();
const renderCbs = new Set();
let pinGroup;

export function ensureViewer({ canvas }){
  if (renderer) return;
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  scene = new THREE.Scene();
// [LM patch] expose scene for UI and tools
try {
  window.__LM_SCENE = scene;
  document.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { scene } }));
} catch (e) { console.warn('[LM patch] scene expose failed', e); }

  scene.background = null;

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
  camera.position.set(3, 2, 6);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.0); d1.position.set(5,10,7); scene.add(d1);

  pinGroup = new THREE.Group(); pinGroup.name = 'PinGroup'; scene.add(pinGroup);

  raycaster = new THREE.Raycaster();

  const onResize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  canvas.addEventListener('pointerdown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (ev.shiftKey){
      const hit = intersects.find(i => i && i.object !== pinGroup && !pinGroup.children.includes(i.object));
      if (hit && hit.point){
        pickHandlers.forEach(fn => { try { fn({ x: hit.point.x, y: hit.point.y, z: hit.point.z }); } catch(_){} });
      }
    } else {
      const pinHit = intersects.find(i => i.object && i.object.userData && i.object.userData.pinId);
      if (pinHit && pinHit.object){
        const id = pinHit.object.userData.pinId;
        pinSelectHandlers.forEach(fn => { try { fn(id); } catch(_){} });
        setPinSelected(id, true);
      }
    }
  });

  document.addEventListener('pinFilterChange', (e)=>{
    const selected = new Set(e.detail?.selected || []);
    if (!pinGroup) return;
    pinGroup.children.forEach(ch => {
      const c = ch.userData?.pinColor;
      ch.visible = !c || selected.has(c);
    });
  });

  const tick = () => {
    controls.update(); renderer.render(scene, camera);
    renderCbs.forEach(fn => { try{ fn(); }catch(e){} });
    requestAnimationFrame(tick);
  };
  tick();
}

export function onRenderTick(fn){ renderCbs.add(fn); return ()=>renderCbs.delete(fn); }
export function projectPoint(x, y, z){
  const v = new THREE.Vector3(x,y,z).project(camera);
  const rect = canvasEl.getBoundingClientRect();
  const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
  const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
  const visible = v.z > -1 && v.z < 1;
  return { x: sx, y: sy, visible };
}

export function onCanvasShiftPick(handler){ pickHandlers.add(handler); return () => pickHandlers.delete(handler); }
export function onPinSelect(handler){ pinSelectHandlers.add(handler); return () => pinSelectHandlers.delete(handler); }

export function addPinMarker({ id, x, y, z, color = '#ff6b6b' }){
  if (!pinGroup) return;
  // small sphere based on model size
  let radius = 0.008;
  try {
    const objList = scene.children.filter(o=>!o.isLight && o!==pinGroup);
    const box = new THREE.Box3().makeEmpty();
    objList.forEach(o=>box.expandByObject(o));
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    radius = Math.max(0.005, Math.min(0.02, size * 0.0018));
  } catch(_){}
  const geo = new THREE.SphereGeometry(radius, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.userData.pinId = id;
  m.userData.pinColor = color;
  pinGroup.add(m);
}
export function clearPins(){ if (!pinGroup) return; while (pinGroup.children.length) pinGroup.remove(pinGroup.children[0]); }
export function removePinMarker(id){
  if (!pinGroup) return;
  for (let i=pinGroup.children.length-1; i>=0; i--){
    const ch = pinGroup.children[i];
    if (ch.userData?.pinId === id){ pinGroup.remove(ch); break; }
  }
}
export function setPinSelected(id, on){
  if (!pinGroup) return;
  pinGroup.children.forEach(ch => {
    if (ch.userData.pinId === id){
      ch.scale.set(on?1.5:1, on?1.5:1, on?1.5:1);
      ch.material.opacity = on?1:0.85;
    } else {
      ch.scale.set(1,1,1);
      ch.material.opacity = 0.6;
    }
  });
}

export async function loadGlbFromDrive(fileId, { token }) {
  // Build Drive media URL
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
// Normalize/resolve token (support Promise; acquire silently if missing)
try {
  if (token && typeof token.then === 'function') {
    token = await token.catch(()=>null);
  }
  if (!token) {
    const g = __lm_getAuth();
    token = (g.getAccessToken && g.getAccessToken()) || window.__LM_TOK || null;
    if (!token && g.ensureToken) {
      try { token = await g.ensureToken({ prompt: undefined }); } catch {}
      if (!token && g.getAccessToken) token = g.getAccessToken();
    }
  }
} catch {}


  // Resolve token if not provided
  let useToken = token;
  try {
    if (!useToken) {
      const g = await import('./gauth.module.js');
      useToken = (g.getAccessToken && g.getAccessToken()) || window.__LM_TOK || null;
      if (!useToken) {
        // try interactive/silent fetch (without forcing consent) to avoid popup unless necessary
        try { useToken = await g.ensureToken({ prompt: undefined }); } catch(_) {}
        if (!useToken && g.getAccessToken) useToken = g.getAccessToken();
      }
    }
  } catch (_) { /* keep going; we'll try without token (will 401) and handle below */ }

  async function fetchWith(tok) {
    const headers = tok ? { Authorization: `Bearer ${tok}` } : undefined;
    return await fetch(url, { headers });
  }

  // First attempt
  let r = await fetchWith(useToken);

  // If unauthorized, try to (re)acquire token once and retry
  if (r.status === 401) {
    try {
      const g = await import('./gauth.module.js');
      const fresh = await (g.ensureToken ? g.ensureToken({ prompt: undefined }) : Promise.resolve(window.__LM_TOK));
      if (fresh) {
        useToken = fresh;
        r = await fetchWith(useToken);
      }
    } catch(_) {}
  }

  if (!r.ok) throw new Error(`GLB fetch failed ${r.status}`);

  const blob = await r.blob();
  const objectURL = URL.createObjectURL(blob);
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(objectURL);
    // remove previous (except lights & pin group)
    const keep = new Set([pinGroup]);
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const obj = scene.children[i];
      if (obj.isLight || keep.has(obj)) continue;
      scene.remove(obj);
    }
    scene.add(gltf.scene);

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(size*0.8, size*0.6, size*0.8));
    camera.near = Math.max(size/1000, 0.01); camera.far = size*10; camera.updateProjectionMatrix();
  } finally {
    URL.revokeObjectURL(objectURL);
  }

}

// === [ADD] 名前で適用・列挙API（Step1） ===============================

// 指定した名前のすべてのマテリアルに props を適用
export function applyMaterialPropsByName(materialName, props = {}) {
  try {
    if (typeof __rebuildMaterialList === 'function') __rebuildMaterialList();
  } catch (_) {}
  const targetName = String(materialName || '');
  if (!targetName) return 0;
  let count = 0;
  try {
    for (const rec of (__matList || [])) {
      if ((rec.name || '') === targetName) {
        try {
          applyMaterialProps(rec.key, props);
          count++;
        } catch (e) { console.warn('[viewer] apply by key failed', e); }
      }
    }
  } catch (e) { console.warn('[viewer] list not ready', e); }
  return count;
}

// マテリアル名の配列を返す（空名は除外）
export function listMaterialNames() {
  try {
    return (listMaterials ? listMaterials() : [])
      .map(m => m && m.name)
      .filter(n => !!n && typeof n === 'string');
  } catch (e) {
    console.warn('[viewer] listMaterialNames failed', e);
    return [];
  }
}

// window へブリッジを公開（index.html から参照するため）
try {
  window.LM_viewer = Object.assign(window.LM_viewer || {}, {
    listMaterialNames,
    applyMaterialPropsByName,
  });
} catch (_) {}
// ======================================================================

