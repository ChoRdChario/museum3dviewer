// viewer.module.cdn.js — bridge/shim (no direct three.js import)
// Provides named exports expected by boot.esm.cdn.js without creating an extra THREE instance.
// Delegates to window.lm.* when available, otherwise uses lightweight events/promises.

const NAMESPACE = 'viewer-bridge-shim';

function log(...a){ try{ console.log(`[${NAMESPACE}]`, ...a);}catch(_){} }
function warn(...a){ try{ console.warn(`[${NAMESPACE}]`, ...a);}catch(_){} }

// Internal ready promise for a scene set from the host
let __resolveScene = null;
let __sceneReadyP = new Promise(res=>{ __resolveScene = res; });

// Public helper for host code to set the scene safely
export function __set_lm_scene(scene){
  try {
    window.__lm_scene = scene;
    if (__resolveScene){ __resolveScene(scene); __resolveScene = null; }
    // Also emit a generic event many patches listen to
    window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', { detail: { scene } }));
    log('__set_lm_scene called; scene registered');
  } catch(e){ warn('__set_lm_scene failed', e); }
}

// Named exports expected by boot.esm.cdn.js
export async function ensureViewer(options={}){
  // If host provides a real ensureViewer, use it
  if (window.lm && typeof window.lm.ensureViewer === 'function'){
    log('delegating ensureViewer to window.lm.ensureViewer');
    return window.lm.ensureViewer(options);
  }

  // If a scene already exists, return it immediately
  if (window.__lm_scene){
    log('ensureViewer: existing __lm_scene found');
    return window.__lm_scene;
  }

  // Ask host/viewer to create/ensure the viewer
  try {
    window.dispatchEvent(new CustomEvent('pm:ensure-viewer', { detail: { options } }));
  } catch(e){ warn('dispatch pm:ensure-viewer failed', e); }

  // Wait for scene to be set via __set_lm_scene or for a direct getScene to appear
  const timeoutMs = options.timeoutMs ?? 5000;
  const start = performance.now();
  const race = Promise.race([
    __sceneReadyP,
    new Promise(res=>{
      const iv = setInterval(()=>{
        if (window.lm && typeof window.lm.getScene === 'function'){
          const s = window.lm.getScene();
          if (s){ clearInterval(iv); res(s); }
        } else if (window.__lm_scene){
          clearInterval(iv); res(window.__lm_scene);
        }
        if (performance.now() - start > timeoutMs){
          clearInterval(iv); res(null);
        }
      }, 50);
    })
  ]);

  const scene = await race;
  if (!scene) warn('ensureViewer timeout without scene');
  return scene;
}

export function getScene(){
  if (window.lm && typeof window.lm.getScene === 'function'){
    return window.lm.getScene();
  }
  return window.__lm_scene || null;
}

export function addPinMarker(pin){
  if (window.lm && typeof window.lm.addPinMarker === 'function'){
    return window.lm.addPinMarker(pin);
  }
  // Fallback: tell host to add a pin
  try { window.dispatchEvent(new CustomEvent('pm:add-pin', { detail: { pin } })); }
  catch(e){ warn('dispatch pm:add-pin failed', e); }
  return undefined;
}

export function clearPins(){
  if (window.lm && typeof window.lm.clearPins === 'function'){
    return window.lm.clearPins();
  }
  try { window.dispatchEvent(new CustomEvent('pm:clear-pins')); }
  catch(e){ warn('dispatch pm:clear-pins failed', e); }
  return undefined;
}

// Optional: expose a minimal API for external inspection without clobbering getters
try {
  window.lm = window.lm || {};
  if (!('getScene' in window.lm)){
    Object.defineProperty(window.lm, 'getScene', { enumerable: true, configurable: true, value: getScene });
  }
  if (!('__set_lm_scene' in window.lm)){
    Object.defineProperty(window.lm, '__set_lm_scene', { enumerable: true, configurable: true, value: __set_lm_scene });
  }
} catch(e){ /* ignore */ }
