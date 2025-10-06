
// viewer.js — shim + minimal viewer bootstrap that satisfies app_boot/ui expectations.
// Exports: ensureViewer()
// Side-effect: defines window.app.viewer with loadByInput / loadArrayBuffer / loadFromUrl / onceReady.

/* eslint-disable no-console */
function log(...args){ console.log('[viewer]', ...args); }

// --- tiny helpers ------------------------------------------------------------
function isDriveUrl(s){
  try{ const u = new URL(s); return /drive\.google\.com$/.test(u.hostname); }catch(e){ return false; }
}
function normalizeIdFromInput(input){
  if(!input) return null;
  const s = String(input).trim();
  if(!s) return null;
  // Support: ?id=<fileId> or plain id
  const m1 = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if(m1) return m1[1];
  // drive file url patterns
  if(isDriveUrl(s)){
    // /file/d/<id>
    const m2 = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    if(m2) return m2[1];
    // /uc?id=<id>
    const m3 = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if(m3) return m3[1];
  }
  // likely a bare id
  if(/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

// fetch GLB ArrayBuffer from Google Drive (public or authorized).
// If global utils exist (utils_drive_api or utils_drive_stub), prefer them.
async function fetchDriveArrayBuffer(fileId){
  // Prefer project-provided helpers if present
  if (window.fetchDriveFileAsArrayBuffer) {
    return await window.fetchDriveFileAsArrayBuffer(fileId);
  }
  if (window.utils_drive_api && typeof window.utils_drive_api.fetchDriveFileAsArrayBuffer === 'function'){
    return await window.utils_drive_api.fetchDriveFileAsArrayBuffer(fileId);
  }
  if (window.utils_drive_stub && typeof window.utils_drive_stub.fetchDriveFileAsArrayBuffer === 'function'){
    return await window.utils_drive_stub.fetchDriveFileAsArrayBuffer(fileId);
  }
  // Fallback to uc export (works only if CORS allows)
  const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Drive fetch failed ${res.status}`);
  return await res.arrayBuffer();
}

// naive GLB loader using THREE.GLTFLoader if available
async function glbFromArrayBuffer(arrayBuffer){
  // If app.viewer has an internal method, use it
  if (window.app && app.viewer && typeof app.viewer.loadGLBFromArrayBuffer === 'function'){
    return await app.viewer.loadGLBFromArrayBuffer(arrayBuffer);
  }
  // Otherwise do a minimal dynamic import path. Expect three to already be available globally or via import map.
  let THREE_NS = (window.THREE) ? window.THREE : null;
  let GLTFLoaderCtor = null;

  try{
    if(!THREE_NS){
      // Try ESM import of 'three' if import map provides it
      THREE_NS = await import('three');
    }
  }catch(e){
    // ignore; will try global
  }
  try{
    // Prefer local examples path if available
    GLTFLoaderCtor = (await import('./lib/GLTFLoader.js')).GLTFLoader;
  }catch(e){
    try{
      GLTFLoaderCtor = (await import('three/examples/jsm/loaders/GLTFLoader.js')).GLTFLoader;
    }catch(e2){
      // last resort: global
      GLTFLoaderCtor = (window.THREE && window.THREE.GLTFLoader) ? window.THREE.GLTFLoader : null;
    }
  }

  if(!THREE_NS || !GLTFLoaderCtor){
    throw new Error('THREE or GLTFLoader not available');
  }

  // Minimal scene: if there is an existing scene hook, pass data to it instead of creating a new renderer
  if (window.app && app.viewer && typeof app.viewer._attachGLTF === 'function'){
    const loader = new GLTFLoaderCtor();
    return await new Promise((resolve, reject)=>{
      loader.parse(arrayBuffer, '', (gltf)=>{
        try{
          app.viewer._attachGLTF(gltf);
          resolve(gltf);
        }catch(err){ reject(err); }
      }, (err)=>reject(err));
    });
  }

  // Fallback: no-op parse so that upstream can proceed
  const loader = new GLTFLoaderCtor();
  return await new Promise((resolve, reject)=>{
    loader.parse(arrayBuffer, '', (gltf)=>resolve(gltf), (err)=>reject(err));
  });
}

// --- viewer singleton & ensureViewer() ---------------------------------------
let viewerSingleton = null;

export async function ensureViewer(){
  if (viewerSingleton) return viewerSingleton;
  if (!window.app) window.app = {};
  const v = {
    ready: true,
    _readyCbs: [],
    onceReady(cb){ if (this.ready) { try{ cb(); }catch(_e){} } else { this._readyCbs.push(cb); } },
    _emitReady(){ this.ready = true; const q = this._readyCbs.splice(0); q.forEach(cb=>{ try{cb();}catch(_e){} }); },

    async loadByInput(input){
      const id = normalizeIdFromInput(input);
      if (id){
        const ab = await fetchDriveArrayBuffer(id);
        return await this.loadArrayBuffer(ab);
      }
      // treat as direct url
      if (/^https?:\/\//.test(String(input))) return await this.loadFromUrl(String(input));
      throw new Error('empty or invalid input');
    },
    async loadFromUrl(url){
      const res = await fetch(url);
      if(!res.ok) throw new Error(`fetch failed ${res.status}`);
      const ab = await res.arrayBuffer();
      return await this.loadArrayBuffer(ab);
    },
    async loadArrayBuffer(ab){
      return await glbFromArrayBuffer(ab);
    },
  };

  window.app.viewer = v; // legacy global
  viewerSingleton = v;
  v._emitReady();
  log('ready');
  return viewerSingleton;
}

// Also expose a default for convenience (unused by app_boot, but harmless)
export default { ensureViewer };
