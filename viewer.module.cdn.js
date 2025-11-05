// viewer.module.cdn.js — shim exports to satisfy boot.esm.cdn.js and delegate to window.lm when available.
/* eslint-disable no-console */
const log = (...a)=>console.log('%c[viewer-shim]', 'color:#8a2be2', ...a);

// --- internal scene reference (fallback when window.lm.getScene is absent) ---
let __sceneRef = null;

// Generic safe delegate
function safeCall(path, ...args){
  try{
    const fn = path.split('.').reduce((o,k)=> (o && o[k]) , window);
    if (typeof fn === 'function') return fn(...args);
  }catch(e){ /* ignore */ }
  return undefined;
}

// Simple event bus helpers (subscribe to CustomEvent and return unsubscriber)
function on(eventName, handler){
  const wrapped = (e)=>handler?.(e.detail);
  window.addEventListener(eventName, wrapped);
  return ()=>window.removeEventListener(eventName, wrapped);
}
function emit(eventName, detail){
  try{ window.dispatchEvent(new CustomEvent(eventName, {detail})); }
  catch(e){ /* ignore */ }
}

// -----------------------------------------------------------
// Exports
// -----------------------------------------------------------

export function __set_lm_scene(scene){
  __sceneRef = scene || null;
  // try to resolve any ready-scene promise provided by bridge
  try{
    if (window.lm && typeof window.lm.__resolveReadyScene === 'function'){
      window.lm.__resolveReadyScene(scene);
    }
  }catch(e){ /* ignore */ }
  emit('pm:scene-deep-ready', {scene});
  log('__set_lm_scene called');
}

export function getScene(){
  // Prefer real impl if present
  const s = safeCall('lm.getScene');
  return s ?? __sceneRef ?? null;
}

export async function ensureViewer(opts={}){
  const r = safeCall('lm.ensureViewer', opts);
  if (r && typeof r.then === 'function') return r;
  // emit a hint for any listeners to initialize viewer
  emit('pm:ensure-viewer', {opts});
  return Promise.resolve(true);
}

export async function loadGlbFromDrive(source){
  const r = safeCall('lm.loadGlbFromDrive', source);
  if (r && typeof r.then === 'function') return r;
  // Fallback: broadcast request; return a resolved Promise so callers don't break
  emit('pm:load-glb', {source});
  return Promise.resolve({ok:false, reason:'delegated'});
}

export function addPinMarker(payload){
  const r = safeCall('lm.addPinMarker', payload);
  if (r !== undefined) return r;
  emit('pm:add-pin', {payload});
  return true;
}

export function clearPins(){
  const r = safeCall('lm.clearPins');
  if (r !== undefined) return r;
  emit('pm:clear-pins');
  return true;
}

// Subscription style APIs
export function onCanvasShiftPick(handler){
  // Prefer delegate registration if exposed
  const reg = safeCall('lm.onCanvasShiftPick', handler);
  if (typeof reg === 'function') return reg;
  // Fallback to CustomEvent bus
  return on('pm:canvas-shift-pick', handler);
}

export function onPinSelect(handler){
  const reg = safeCall('lm.onPinSelect', handler);
  if (typeof reg === 'function') return reg;
  return on('pm:pin-select', handler);
}

// New: onRenderTick requested by boot.esm.cdn.js
export function onRenderTick(handler){
  const reg = safeCall('lm.onRenderTick', handler);
  if (typeof reg === 'function') return reg;
  return on('pm:render-tick', handler);
}

// Default export (compat)
const api = {
  __set_lm_scene,
  getScene,
  ensureViewer,
  loadGlbFromDrive,
  addPinMarker,
  clearPins,
  onCanvasShiftPick,
  onPinSelect,
  onRenderTick,
};
export default api;

// Dev hint
log('shim loaded with exports:', Object.keys(api));