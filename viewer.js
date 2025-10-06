// viewer.js — Drive CORS fix + stable ensureViewer shim
// This file keeps surface API expected by app_boot.js/ui.js:
//   export function ensureViewer() -> Promise<{ ...app.viewer API ... }>
//   app.viewer provides: onceReady(cb) [optional], loadByInput(input), loadFromUrl(url), loadArrayBuffer(ab)
// NOTE: We do not add new files; this is a drop-in replacement.

// ---- Utilities --------------------------------------------------------------

function log(...args){ console.log('[viewer]', ...args); }

// Parse Drive file id from common inputs (raw id, share URL, "id=<id>" etc)
function normalizeDriveId(input){
  if (!input) return null;
  // id param
  const mId = String(input).match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (mId) return mId[1];
  // /file/d/<id>
  const mUrl = String(input).match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (mUrl) return mUrl[1];
  // Looks like raw id
  const mRaw = String(input).match(/^([a-zA-Z0-9_-]{10,})$/);
  if (mRaw) return mRaw[1];
  return null;
}

// Resolve OAuth access token from whichever auth wire is available.
function resolveAccessToken(){
  try {
    // Prefer app.auth (from gauth.js) if wired
    if (window.app && window.app.auth && typeof window.app.auth.getAccessToken === 'function'){
      const t = window.app.auth.getAccessToken();
      if (t) return t;
    }
  } catch(e){}
  try {
    if (window.gapi && window.gapi.client && typeof window.gapi.client.getToken === 'function'){
      const tok = window.gapi.client.getToken();
      if (tok && tok.access_token) return tok.access_token;
    }
  } catch(e){}
  try {
    // Last resort (GIS token instance on window) — best effort
    const maybe = (window.google && window.google.accounts && window.google.accounts.oauth2 && window.google.accounts.oauth2._token);
    if (maybe && maybe.access_token) return maybe.access_token;
  } catch(e){}
  return null;
}

// Fetch Google Drive file bytes with OAuth (avoids CORS on uc? links)
async function fetchDriveArrayBuffer(fileId){
  const token = resolveAccessToken();
  if (!token) throw new Error('No OAuth token (not signed in)');
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok){
    const txt = await res.text().catch(()=>'');
    throw new Error(`Drive fetch failed ${res.status} ${res.statusText} :: ${txt.slice(0,200)}`);
  }
  return await res.arrayBuffer();
}

// Generic fetch for CORS-allowed URL
async function fetchArrayBuffer(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.arrayBuffer();
}

// ---- THREE bootstrap (lightweight) -----------------------------------------
let THREE_ref = null;
async function ensureThree(){
  if (THREE_ref) return THREE_ref;
  // Use global THREE if already present (import map / script tag)
  if (window.THREE) { THREE_ref = window.THREE; return THREE_ref; }
  // Try ESM dynamic import if import map defines "three"
  try {
    const mod = await import('./lib/three/build/three.module.js');
    THREE_ref = mod;
    // GLTFLoader
    try {
      const loaders = await import('./lib/three/examples/jsm/loaders/GLTFLoader.js');
      THREE_ref.GLTFLoader = loaders.GLTFLoader;
    } catch(e){ /* external loader may be provided elsewhere */ }
    return THREE_ref;
  } catch(e){
    console.warn('[viewer] three import failed; expecting global THREE set elsewhere', e);
    // Fallback to global later
    return window.THREE || null;
  }
}

// ---- Minimal viewer impl ----------------------------------------------------
let viewerInstance = null;
let readyListeners = [];
let isReady = false;

function emitReady(){
  isReady = true;
  readyListeners.splice(0).forEach(cb=>{ try{ cb(); }catch(e){console.error(e);} });
}

// Create renderer/camera/scene if not provided elsewhere
async function bootstrapRenderer(container){
  const THREE = await ensureThree();
  if (!THREE) throw new Error('THREE unavailable');
  const root = container || document.getElementById('stage') || document.body;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, root.clientWidth/root.clientHeight, 0.1, 2000);
  camera.position.set(0, 1.5, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  root.appendChild(renderer.domElement);

  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(light);

  function onResize(){
    const w = root.clientWidth, h = root.clientHeight;
    camera.aspect = w/h || 1;
    camera.updateProjectionMatrix();
    renderer.setSize(w,h);
  }
  window.addEventListener('resize', onResize);

  // simple animate
  function animate(){
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  return { THREE, scene, camera, renderer };
}

// GLTF parse utility
async function parseGLB(ab){
  const THREE = await ensureThree();
  if (!THREE) throw new Error('THREE unavailable for GLTF parsing');
  let GLTFLoader = THREE.GLTFLoader;
  if (!GLTFLoader){
    // try dynamic import again (environment dependent)
    const loaders = await import('./lib/three/examples/jsm/loaders/GLTFLoader.js');
    GLTFLoader = loaders.GLTFLoader;
  }
  return await new Promise((resolve, reject)=>{
    const loader = new GLTFLoader();
    loader.parse(ab, '', gltf => resolve(gltf), err => reject(err));
  });
}

// Attach gltf to current scene (naive)
function attachToScene(ctx, gltf){
  // collect unique materials and dispatch to UI
  try{
    const mats = new Set();
    gltf.scene.traverse(o=>{
      if (o.isMesh && o.material){
        if (Array.isArray(o.material)) o.material.forEach(m=>m&&m.name!=null&&mats.add(m));
        else mats.add(o.material);
      }
    });
    const list = Array.from(mats).map(m=>({ name: m.name||'(mat)', uuid: m.uuid }));
    (window.app && window.app.events) && window.app.events.dispatchEvent(new CustomEvent('viewer:materials', {detail:{list}}));
  }catch(e){ console.warn('[viewer] mats event failed', e); }

  // Remove previous root if exists
  if (ctx._root){ ctx.scene.remove(ctx._root); }
  const root = gltf.scene || gltf.scenes?.[0];
  if (root){ ctx.scene.add(root); ctx._root = root; }
}

// ---- Public API -------------------------------------------------------------
export async function ensureViewer(){
  if (viewerInstance) return viewerInstance;
  log('ready');

  const ctx = await bootstrapRenderer();
  const events = new EventTarget();
  const api = {
    // legacy hook; executes immediately if already ready
    onceReady(cb){ if (isReady) cb(); else readyListeners.push(cb); },
    // UI calls this with an input value (Drive URL/ID or http URL)
    async loadByInput(input){
      try {
        const id = normalizeDriveId(input);
        if (id){
          const ab = await fetchDriveArrayBuffer(id);
          const gltf = await parseGLB(ab);
          attachToScene(ctx, gltf);
          return;
        }
        // treat as URL
        if (/^https?:\/\//i.test(String(input))){
          const ab = await fetchArrayBuffer(String(input));
          const gltf = await parseGLB(ab);
          attachToScene(ctx, gltf);
          return;
        }
        throw new Error('Unrecognized input');
      } catch(err){
        console.error(err);
        alert(`GLBの読み込みに失敗しました（詳細はコンソール）\n${err?.message||err}`);
      }
    },
    async loadFromUrl(url){
      const ab = await fetchArrayBuffer(url);
      const gltf = await parseGLB(ab);
      attachToScene(ctx, gltf);
    },
    async loadArrayBuffer(ab){
      const gltf = await parseGLB(ab);
      attachToScene(ctx, gltf);
    }
  };
  // Expose on app.viewer and app.events
  window.app = window.app || {};
  window.app.viewer = api;
  window.app.events = window.app.events || events;

  // Ready
  emitReady();
  return (viewerInstance = api);
}